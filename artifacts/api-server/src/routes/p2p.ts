import { Router } from "express";
import { db, pool } from "@workspace/db";
import { cached, invalidate } from "../lib/redis";
import { GMI_RPC_URL, gmiChain } from "../lib/chain";

// ── Migration: add ad-level escrow columns if they don't exist ────────────────
(async () => {
  try {
    // Create the enum type first (idempotent)
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE p2p_escrow_status AS ENUM ('none', 'locked', 'released', 'refunded');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    // Add columns only if missing
    await pool.query(`
      ALTER TABLE p2p_ads
        ADD COLUMN IF NOT EXISTS escrow_tx_hash    TEXT,
        ADD COLUMN IF NOT EXISTS escrow_locked_at  TIMESTAMPTZ;
    `);
    // escrow_status needs the enum — add separately so it can use a cast
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE p2p_ads
          ADD COLUMN escrow_status p2p_escrow_status NOT NULL DEFAULT 'none';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);
  } catch (e) {
    console.error("p2p_ads escrow migration failed:", e);
  }
})();

// Cache key for the public active-ads feed (no owner filter).
// Per-filter combinations are encoded in the key; owner-specific queries are never cached.
function adsCacheKey(token?: string, side?: string, offset?: number) {
  return `p2p:ads:${token ?? "all"}:${side ?? "all"}:${offset ?? 0}`;
}
const ADS_CACHE_TTL = 30; // 30 seconds — ads change frequently
import {
  p2pAds, p2pOrders, p2pMessages, p2pDisputes, p2pRatings, p2pProfiles, p2pPaymentDetails,
  createAdRequestSchema, createOrderRequestSchema, createDisputeRequestSchema,
  sendMessageRequestSchema, rateOrderRequestSchema, kycSubmitRequestSchema,
} from "@workspace/db";
import { eq, and, or, desc, sql, count } from "drizzle-orm";
import { z } from "zod";
import {
  broadcastMcTransaction, broadcastUsdtTransaction, mcToWei,
  isEscrowConfigured, getEscrowAddress, getEscrowPrivateKey, normalizeAddress,
} from "../escrow";

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function validate<T>(schema: z.ZodType<T>, body: unknown): { data: T } | { error: string } {
  const result = schema.safeParse(body);
  if (!result.success) return { error: result.error.issues.map((i: z.ZodIssue) => i.message).join(", ") };
  return { data: result.data };
}

/** Normalize any incoming address to lowercase 0x ETH format. */
function toEth(addr: string | undefined): string {
  if (!addr) return addr as unknown as string;
  try { return normalizeAddress(addr); } catch { return addr; }
}

async function ensureProfile(address: string, displayName?: string): Promise<void> {
  const existing = await db.select().from(p2pProfiles).where(eq(p2pProfiles.mxcAddress, address)).limit(1);
  if (existing.length === 0) {
    await db.insert(p2pProfiles).values({
      mxcAddress: address,
      displayName: displayName ?? address.slice(0, 10) + "…",
    });
  }
}

async function enrichAds(ads: (typeof p2pAds.$inferSelect)[]) {
  if (ads.length === 0) return [];
  const addresses = [...new Set(ads.map(a => a.ownerAddress))];
  const profiles = await db.select().from(p2pProfiles).where(
    sql`${p2pProfiles.mxcAddress} = ANY(${sql`ARRAY[${sql.join(addresses.map(a => sql`${a}`), sql`, `)}]::text[]`})`
  );
  const profileMap = new Map(profiles.map(p => [p.mxcAddress, p]));
  const enriched = ads.map(ad => {
    const profile = profileMap.get(ad.ownerAddress);
    const completion = profile && profile.totalTrades > 0
      ? ((profile.completedTrades / profile.totalTrades) * 100).toFixed(1)
      : "100.0";
    return {
      ...ad,
      displayName: profile?.displayName,
      kycVerified: profile?.kycStatus === "verified",
      isMerchant: profile?.isMerchant ?? false,
      isPinned: profile?.isPinned ?? false,
      completionRate: completion,
      avgRating: profile?.avgRating ?? "0",
    };
  });
  enriched.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
  return enriched;
}

// ── Profiles ─────────────────────────────────────────────────────────────────

router.get("/p2p/profiles/:address", async (req, res) => {
  const address = toEth(req.params.address);
  const [profile] = await db.select().from(p2pProfiles).where(eq(p2pProfiles.mxcAddress, address)).limit(1);
  if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
  const completionRate = profile.totalTrades > 0
    ? ((profile.completedTrades / profile.totalTrades) * 100).toFixed(1)
    : "100.0";
  res.json({ ...profile, completionRate });
});

router.post("/p2p/profiles", async (req, res) => {
  const body = req.body as { mxcAddress?: string; displayName?: string; phone?: string };
  if (!body.mxcAddress) { res.status(400).json({ error: "mxcAddress required" }); return; }
  const ethAddress = toEth(body.mxcAddress);
  const existing = await db.select().from(p2pProfiles).where(eq(p2pProfiles.mxcAddress, ethAddress)).limit(1);
  if (existing.length > 0) {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.displayName) updateData.displayName = body.displayName;
    if (body.phone !== undefined) updateData.phone = body.phone;
    const [updated] = await db.update(p2pProfiles)
      .set(updateData)
      .where(eq(p2pProfiles.mxcAddress, ethAddress))
      .returning();
    res.json(updated);
    return;
  }
  const [created] = await db.insert(p2pProfiles).values({
    mxcAddress: ethAddress,
    displayName: body.displayName ?? ethAddress.slice(0, 12) + "…",
    phone: body.phone,
  }).returning();
  res.status(201).json(created);
});

router.delete("/p2p/profiles/:address", async (req, res) => {
  const address = toEth(req.params.address);
  const existing = await db.select().from(p2pProfiles).where(eq(p2pProfiles.mxcAddress, address)).limit(1);
  if (!existing.length) { res.status(404).json({ error: "Profile not found" }); return; }
  if ((existing[0].completedTrades ?? 0) > 0) {
    res.status(409).json({ error: "Cannot disconnect — you have completed trades. Contact support." });
    return;
  }
  await db.delete(p2pProfiles).where(eq(p2pProfiles.mxcAddress, address));
  res.json({ ok: true });
});

router.post("/p2p/profiles/kyc", async (req, res) => {
  const v = validate(kycSubmitRequestSchema, req.body);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const { mxcAddress: rawAddr, kycName, kycDocType, displayName, kycDocImage } = v.data as { mxcAddress: string; kycName: string; kycDocType: string; displayName: string; kycDocImage?: string };
  const mxcAddress = toEth(rawAddr);
  await ensureProfile(mxcAddress, displayName);
  const [updated] = await db.update(p2pProfiles)
    .set({ kycName, kycDocType, kycDocImage, kycStatus: "pending", kycSubmittedAt: new Date(), displayName, updatedAt: new Date() })
    .where(eq(p2pProfiles.mxcAddress, mxcAddress))
    .returning();
  res.json(updated);
});

// ── Ads ───────────────────────────────────────────────────────────────────────

router.get("/p2p/ads", async (req, res) => {
  const { token, side, owner: rawOwner } = req.query as { token?: string; side?: string; owner?: string };
  const owner = rawOwner ? toEth(rawOwner) : undefined;
  const offset = Math.max(0, Number(req.query["offset"] ?? 0));
  const limit = owner ? 100 : 20;

  // Owner-specific queries are never cached (per-user, low traffic)
  if (owner) {
    const conditions = [
      eq(p2pAds.ownerAddress, owner),
      ...(token ? [eq(p2pAds.token, token as "MC" | "USDT")] : []),
      ...(side  ? [eq(p2pAds.side,  side  as "buy" | "sell")] : []),
    ];
    const where = and(...conditions);
    const ads = await db.select().from(p2pAds).where(where).orderBy(desc(p2pAds.createdAt)).limit(limit).offset(offset);
    const [totalRow] = await db.select({ count: count() }).from(p2pAds).where(where);
    res.json({ ads: await enrichAds(ads), total: Number(totalRow?.count ?? 0), limit, offset });
    return;
  }

  // Public active-ads feed — cache per filter combination
  const cacheKey = adsCacheKey(token, side, offset);
  const result = await cached(cacheKey, ADS_CACHE_TTL, async () => {
    const conditions = [
      eq(p2pAds.status, "active"),
      ...(token ? [eq(p2pAds.token, token as "MC" | "USDT")] : []),
      ...(side  ? [eq(p2pAds.side,  side  as "buy" | "sell")] : []),
    ];
    const where = and(...conditions);
    const ads = await db.select().from(p2pAds).where(where).orderBy(desc(p2pAds.createdAt)).limit(limit).offset(offset);
    const [totalRow] = await db.select({ count: count() }).from(p2pAds).where(where);
    return { ads: await enrichAds(ads), total: Number(totalRow?.count ?? 0), limit, offset };
  });
  res.json(result);
});

router.post("/p2p/ads", async (req, res) => {
  try {
    const v = validate(createAdRequestSchema, req.body);
    if ("error" in v) { res.status(400).json({ error: v.error }); return; }
    const body = v.data as z.infer<typeof createAdRequestSchema> & { ownerAddress?: string };
    const ownerAddress = toEth((req.body as { ownerAddress?: string }).ownerAddress);
    if (!ownerAddress) { res.status(400).json({ error: "ownerAddress required" }); return; }
    // Sell ads must have escrow locked before posting
    if (body.side === "sell" && !body.escrowTxHash && isEscrowConfigured()) {
      res.status(400).json({ error: "Sell ads require escrow. Please lock funds in escrow first." }); return;
    }
    await ensureProfile(ownerAddress);
    const escrowLocked = !!body.escrowTxHash;
    const [ad] = await db.insert(p2pAds).values({
      ownerAddress,
      token: body.token,
      side: body.side,
      price: body.price,
      minAmount: body.minAmount,
      maxAmount: body.maxAmount,
      availableAmount: body.availableAmount,
      paymentMethods: body.paymentMethods,
      paymentWindow: body.paymentWindow,
      terms: body.terms,
      escrowTxHash: body.escrowTxHash ?? null,
      escrowStatus: escrowLocked ? "locked" : "none",
      escrowLockedAt: escrowLocked ? new Date() : null,
    }).returning();
    // New ad posted — bust all public ad feed cache keys
    await Promise.all([
      invalidate(adsCacheKey()), invalidate(adsCacheKey("MC")), invalidate(adsCacheKey("USDT")),
      invalidate(adsCacheKey(undefined, "buy")), invalidate(adsCacheKey(undefined, "sell")),
      invalidate(adsCacheKey("MC", "buy")), invalidate(adsCacheKey("MC", "sell")),
      invalidate(adsCacheKey("USDT", "buy")), invalidate(adsCacheKey("USDT", "sell")),
    ]);
    res.status(201).json(ad);
  } catch (e) {
    console.error("POST /p2p/ads error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to create ad" });
  }
});

router.patch("/p2p/ads/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body as { status?: string };
  if (!["active", "paused", "cancelled"].includes(status ?? "")) {
    res.status(400).json({ error: "Invalid status" }); return;
  }
  const [updated] = await db.update(p2pAds)
    .set({ status: status as "active" | "paused" | "cancelled", updatedAt: new Date() })
    .where(eq(p2pAds.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Ad not found" }); return; }
  // Status changed — bust all public ad feed cache keys
  await Promise.all([
    invalidate(adsCacheKey()), invalidate(adsCacheKey("MC")), invalidate(adsCacheKey("USDT")),
    invalidate(adsCacheKey(undefined, "buy")), invalidate(adsCacheKey(undefined, "sell")),
    invalidate(adsCacheKey("MC", "buy")), invalidate(adsCacheKey("MC", "sell")),
    invalidate(adsCacheKey("USDT", "buy")), invalidate(adsCacheKey("USDT", "sell")),
  ]);
  res.json(updated);
});

// ── Cancel ad with escrow refund ──────────────────────────────────────────────
router.post("/p2p/ads/:id/cancel", async (req, res) => {
  const { id } = req.params;
  const ownerAddress = toEth((req.body as { ownerAddress?: string }).ownerAddress);
  if (!ownerAddress) { res.status(400).json({ error: "ownerAddress required" }); return; }

  const [ad] = await db.select().from(p2pAds).where(eq(p2pAds.id, id)).limit(1);
  if (!ad) { res.status(404).json({ error: "Ad not found" }); return; }
  if (ad.ownerAddress !== ownerAddress) { res.status(403).json({ error: "Not your ad" }); return; }
  if (ad.status === "cancelled") { res.status(409).json({ error: "Ad already cancelled" }); return; }

  // Block cancel if any active orders exist
  const activeOrders = await db.select({ id: p2pOrders.id }).from(p2pOrders)
    .where(and(
      eq(p2pOrders.adId, id),
      sql`${p2pOrders.status} IN ('pending', 'paid', 'disputed')`,
    )).limit(1);
  if (activeOrders.length > 0) {
    res.status(409).json({ error: "Cannot cancel — there is an active order in progress" }); return;
  }

  // Refund escrow back to seller if funds were locked
  let refundTxHash: string | null = null;
  if (ad.escrowStatus === "locked" && ad.escrowTxHash && isEscrowConfigured()) {
    try {
      const remaining = parseFloat(String(ad.availableAmount));
      if (remaining > 0) {
        const escrowPk   = getEscrowPrivateKey();
        const escrowAddr = getEscrowAddress();
        if (ad.token === "MC") {
          refundTxHash = await broadcastMcTransaction(escrowAddr, ownerAddress, mcToWei(String(remaining)), escrowPk);
        } else if (ad.token === "USDT") {
          refundTxHash = await broadcastUsdtTransaction(escrowPk, ownerAddress, String(remaining));
        }
      }
    } catch (e) {
      console.error("Escrow refund failed:", e);
      res.status(500).json({ error: "Failed to refund escrow — please contact support", detail: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  const [cancelled] = await db.update(p2pAds)
    .set({
      status: "cancelled",
      escrowStatus: refundTxHash ? "refunded" : ad.escrowStatus,
      updatedAt: new Date(),
    })
    .where(eq(p2pAds.id, id))
    .returning();

  await Promise.all([
    invalidate(adsCacheKey()), invalidate(adsCacheKey(ad.token)), invalidate(adsCacheKey(undefined, ad.side)),
    invalidate(adsCacheKey(ad.token, ad.side)),
  ]);

  res.json({ ...cancelled, refundTxHash });
});

// ── Orders ────────────────────────────────────────────────────────────────────

router.get("/p2p/orders", async (req, res) => {
  const address = toEth((req.query as { address?: string }).address);
  if (!address) { res.status(400).json({ error: "address required" }); return; }
  const offset = Math.max(0, Number(req.query["offset"] ?? 0));
  const limit = 20;

  const where = or(eq(p2pOrders.buyerAddress, address), eq(p2pOrders.sellerAddress, address));

  const orders = await db.select().from(p2pOrders)
    .where(where)
    .orderBy(desc(p2pOrders.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db.select({ count: count() }).from(p2pOrders).where(where);

  res.json({ orders, total: Number(totalRow?.count ?? 0), limit, offset });
});

router.get("/p2p/orders/:id", async (req, res) => {
  const { id } = req.params;
  const [order] = await db.select().from(p2pOrders).where(eq(p2pOrders.id, id)).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  const [ad] = await db.select().from(p2pAds).where(eq(p2pAds.id, order.adId)).limit(1);
  const [sellerPaymentDetail] = await db.select().from(p2pPaymentDetails).where(and(
    eq(p2pPaymentDetails.ownerAddress, order.sellerAddress),
    eq(p2pPaymentDetails.paymentMethod, order.paymentMethod),
  )).limit(1);
  res.json({ ...order, ad, sellerPaymentDetail: sellerPaymentDetail ?? null });
});

router.post("/p2p/orders", async (req, res) => {
  const v = validate(createOrderRequestSchema, req.body);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const body = v.data as z.infer<typeof createOrderRequestSchema>;
  const { buyerAddress: rawBuyer, paymentDetails, escrowTxHash: orderEscrowTxHash } = req.body as { buyerAddress?: string; paymentDetails?: string; escrowTxHash?: string };
  const buyerAddress = toEth(rawBuyer);
  if (!buyerAddress) { res.status(400).json({ error: "buyerAddress required" }); return; }

  const [ad] = await db.select().from(p2pAds).where(and(eq(p2pAds.id, body.adId), eq(p2pAds.status, "active"))).limit(1);
  if (!ad) { res.status(404).json({ error: "Ad not found or inactive" }); return; }
  if (ad.ownerAddress === buyerAddress) { res.status(400).json({ error: "Cannot trade with your own ad" }); return; }

  const crypto = parseFloat(body.cryptoAmount);
  const min = parseFloat(String(ad.minAmount));
  const max = parseFloat(String(ad.maxAmount));
  const available = parseFloat(String(ad.availableAmount));
  if (crypto < min || crypto > max) { res.status(400).json({ error: `Amount must be between ${min} and ${max}` }); return; }
  if (crypto > available) { res.status(400).json({ error: "Insufficient available amount" }); return; }

  const fiatAmount = (crypto * parseFloat(String(ad.price))).toFixed(6);
  const deadline = new Date(Date.now() + ad.paymentWindow * 60 * 1000);

  const sellerAddress = ad.side === "sell" ? ad.ownerAddress : buyerAddress;
  const buyerFinal = ad.side === "sell" ? buyerAddress : ad.ownerAddress;

  // SELL ad → escrow inherited from the ad-level lock (set at ad creation)
  // BUY ad  → seller locks at order creation, escrowTxHash comes from the request
  const inheritEscrow = ad.side === "sell" && ad.escrowStatus === "locked";
  const sellerEscrow  = ad.side === "buy"  && !!orderEscrowTxHash;

  // For BUY ads: seller must have locked escrow before placing the order
  if (ad.side === "buy" && isEscrowConfigured() && !orderEscrowTxHash) {
    res.status(400).json({ error: "Escrow required — lock your funds in escrow before placing this order" }); return;
  }

  const escrowStatus: "locked" | "none" = (inheritEscrow || sellerEscrow) ? "locked" : "none";
  const escrowTxHash = inheritEscrow ? ad.escrowTxHash : (sellerEscrow ? orderEscrowTxHash : null);

  const [order] = await db.insert(p2pOrders).values({
    adId: ad.id,
    buyerAddress: buyerFinal,
    sellerAddress,
    token: ad.token,
    side: ad.side,
    cryptoAmount: body.cryptoAmount,
    fiatAmount,
    price: String(ad.price),
    paymentMethod: body.paymentMethod,
    paymentDetails: paymentDetails ?? "",
    paymentDeadline: deadline,
    escrowStatus,
    escrowTxHash: escrowTxHash ?? null,
    escrowLockedAt: escrowStatus === "locked" ? new Date() : null,
  }).returning();

  // Deduct from available amount
  const newAvailable = (available - crypto).toFixed(6);
  await db.update(p2pAds).set({ availableAmount: newAvailable, updatedAt: new Date() }).where(eq(p2pAds.id, ad.id));

  // System message
  await db.insert(p2pMessages).values({
    orderId: order.id,
    senderAddress: "system",
    content: `Order created. ${buyerFinal.slice(0, 8)}… must pay ${crypto} ${ad.token} worth ${fiatAmount} USDT via ${body.paymentMethod.replace(/_/g, " ")} within ${ad.paymentWindow} minutes.`,
    isSystem: true,
  });

  await ensureProfile(buyerAddress);
  res.status(201).json(order);
});

router.post("/p2p/orders/:id/pay", async (req, res) => {
  const { id } = req.params;
  const address = toEth((req.body as { address?: string }).address);
  const [order] = await db.select().from(p2pOrders).where(eq(p2pOrders.id, id)).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.buyerAddress !== address) { res.status(403).json({ error: "Not the buyer" }); return; }
  if (order.status !== "pending") { res.status(400).json({ error: "Order is not pending" }); return; }

  const [updated] = await db.update(p2pOrders)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(p2pOrders.id, id)).returning();

  await db.insert(p2pMessages).values({ orderId: id, senderAddress: "system", content: "Buyer marked payment as sent. Seller please verify and release.", isSystem: true });
  res.json(updated);
});

router.post("/p2p/orders/:id/release", async (req, res) => {
  const { id } = req.params;
  const address = toEth((req.body as { address?: string }).address);
  const [order] = await db.select().from(p2pOrders).where(eq(p2pOrders.id, id)).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.sellerAddress !== address) { res.status(403).json({ error: "Not the seller" }); return; }
  if (!["paid", "disputed"].includes(order.status)) { res.status(400).json({ error: "Cannot release at this stage" }); return; }

  let releaseTxHash: string | null = null;
  let broadcastWarning: string | null = null;

  // ── On-chain release for orders with locked escrow ────────────────────────
  if (order.escrowStatus === "locked" && isEscrowConfigured()) {
    try {
      const escrowAddr = getEscrowAddress();
      const escrowPk   = getEscrowPrivateKey();
      if (order.token === "MC") {
        releaseTxHash = await broadcastMcTransaction(escrowAddr, order.buyerAddress, mcToWei(String(order.cryptoAmount)), escrowPk);
      } else {
        releaseTxHash = await broadcastUsdtTransaction(escrowPk, order.buyerAddress, String(order.cryptoAmount));
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Unknown error";

      // ── Definite failures: transaction was rejected before broadcast ──────
      // These mean the tx never reached the chain — safe to abort.
      const isDefiniteFailure = /insufficient funds|nonce too low|already known|replacement transaction|invalid signature|execution reverted|gas required exceeds/i.test(errMsg);
      if (isDefiniteFailure) {
        res.status(502).json({ error: `Escrow release failed: ${errMsg}` });
        return;
      }

      // ── Ambiguous failures: network/timeout after broadcast ───────────────
      // The transaction may have been submitted and the buyer already received
      // funds. Mark the order as released anyway and flag for admin review.
      broadcastWarning = `Broadcast error (tx may have gone through): ${errMsg}`;
    }
  }

  const setData: Record<string, unknown> = {
    status: "released",
    releasedAt: new Date(),
    updatedAt: new Date(),
    escrowStatus: order.escrowStatus === "locked" ? "released" : order.escrowStatus,
  };
  if (releaseTxHash) setData.releaseTxHash = releaseTxHash;

  const [updated] = await db.update(p2pOrders)
    .set(setData)
    .where(eq(p2pOrders.id, id)).returning();

  // Update stats
  await db.update(p2pProfiles).set({ completedTrades: sql`${p2pProfiles.completedTrades} + 1`, totalTrades: sql`${p2pProfiles.totalTrades} + 1`, updatedAt: new Date() })
    .where(or(eq(p2pProfiles.mxcAddress, order.buyerAddress), eq(p2pProfiles.mxcAddress, order.sellerAddress)));
  await db.update(p2pAds).set({ completedOrders: sql`${p2pAds.completedOrders} + 1`, updatedAt: new Date() }).where(eq(p2pAds.id, order.adId));

  const releaseMsg = releaseTxHash
    ? `Trade completed. ${order.cryptoAmount} ${order.token} released to buyer on-chain (tx: ${releaseTxHash.slice(0, 12)}…).`
    : broadcastWarning
    ? `Trade marked complete. Broadcast may have succeeded — buyer should check their balance. Admin note: ${broadcastWarning}`
    : "Trade completed. Crypto has been released to the buyer.";

  await db.insert(p2pMessages).values({ orderId: id, senderAddress: "system", content: releaseMsg, isSystem: true });
  res.json({ ...updated, broadcastWarning });
});

// ── Escrow ─────────────────────────────────────────────────────────────────────

router.get("/p2p/escrow/info", (_req, res) => {
  const usdtContractAddress = process.env["USDT_CONTRACT_ADDRESS"] ?? null;
  if (!isEscrowConfigured()) {
    res.json({ configured: false, escrowAddress: null, usdtContractAddress });
    return;
  }
  res.json({ configured: true, escrowAddress: toEth(getEscrowAddress()), usdtContractAddress });
});

router.post("/p2p/orders/:id/lock-escrow", async (req, res) => {
  const { id } = req.params;
  const { sellerAddress: rawSeller, txHash } = req.body as { sellerAddress?: string; txHash?: string };
  const sellerAddress = toEth(rawSeller);
  if (!sellerAddress || !txHash) { res.status(400).json({ error: "sellerAddress and txHash required" }); return; }

  const [order] = await db.select().from(p2pOrders).where(eq(p2pOrders.id, id)).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.sellerAddress !== sellerAddress) { res.status(403).json({ error: "Not the seller" }); return; }
  if (order.escrowStatus !== "none") { res.status(409).json({ error: "Escrow already locked" }); return; }
  if (!["pending", "paid"].includes(order.status)) { res.status(400).json({ error: "Cannot lock escrow at this stage" }); return; }

  const [updated] = await db.update(p2pOrders)
    .set({ escrowTxHash: txHash, escrowStatus: "locked", escrowLockedAt: new Date(), updatedAt: new Date() })
    .where(eq(p2pOrders.id, id)).returning();

  await db.insert(p2pMessages).values({
    orderId: id, senderAddress: "system",
    content: `Seller has locked ${order.cryptoAmount} ${order.token} in escrow (tx: ${txHash.slice(0, 12)}…). Funds are secured — buyer can safely proceed with payment.`,
    isSystem: true,
  });

  res.json(updated);
});

router.post("/p2p/orders/:id/refund-escrow", async (req, res) => {
  const { id } = req.params;
  const { adminKey, reason } = req.body as { adminKey?: string; reason?: string };

  const secret = process.env["ADMIN_SECRET"];
  if (!secret || adminKey !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [order] = await db.select().from(p2pOrders).where(eq(p2pOrders.id, id)).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.escrowStatus !== "locked") { res.status(400).json({ error: "No locked escrow to refund" }); return; }

  let refundTxHash: string | null = null;

  if (order.token === "MC" && isEscrowConfigured()) {
    try {
      const escrowAddr = getEscrowAddress();
      const escrowPk = getEscrowPrivateKey();
      const amountWei = mcToWei(String(order.cryptoAmount));
      refundTxHash = await broadcastMcTransaction(escrowAddr, order.sellerAddress, amountWei, escrowPk);
    } catch (e) {
      res.status(502).json({ error: `Refund broadcast failed: ${e instanceof Error ? e.message : "Unknown error"}` });
      return;
    }
  }

  const setData: Record<string, unknown> = { escrowStatus: "refunded", updatedAt: new Date() };
  if (refundTxHash) setData.releaseTxHash = refundTxHash;

  const [updated] = await db.update(p2pOrders).set(setData).where(eq(p2pOrders.id, id)).returning();

  await db.insert(p2pMessages).values({
    orderId: id, senderAddress: "system",
    content: `Escrow refunded to seller by admin. Reason: ${reason ?? "Dispute resolved in seller's favour"}.${refundTxHash ? ` (tx: ${refundTxHash.slice(0, 12)}…)` : ""}`,
    isSystem: true,
  });

  res.json(updated);
});

router.post("/p2p/orders/:id/cancel", async (req, res) => {
  const { id } = req.params;
  const { address: rawAddr, reason } = req.body as { address?: string; reason?: string };
  const address = toEth(rawAddr);
  const [order] = await db.select().from(p2pOrders).where(eq(p2pOrders.id, id)).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (![order.buyerAddress, order.sellerAddress].includes(address ?? "")) { res.status(403).json({ error: "Not a party to this order" }); return; }
  if (!["pending", "paid"].includes(order.status)) { res.status(400).json({ error: "Cannot cancel at this stage" }); return; }

  // Restore available amount
  const [ad] = await db.select().from(p2pAds).where(eq(p2pAds.id, order.adId)).limit(1);
  if (ad) {
    const restored = (parseFloat(String(ad.availableAmount)) + parseFloat(String(order.cryptoAmount))).toFixed(6);
    await db.update(p2pAds).set({ availableAmount: restored, updatedAt: new Date() }).where(eq(p2pAds.id, ad.id));
  }

  const [updated] = await db.update(p2pOrders)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason ?? "Cancelled by user", updatedAt: new Date() })
    .where(eq(p2pOrders.id, id)).returning();

  await db.update(p2pProfiles).set({ totalTrades: sql`${p2pProfiles.totalTrades} + 1`, updatedAt: new Date() })
    .where(or(eq(p2pProfiles.mxcAddress, order.buyerAddress), eq(p2pProfiles.mxcAddress, order.sellerAddress)));

  await db.insert(p2pMessages).values({ orderId: id, senderAddress: "system", content: `Order cancelled. Reason: ${reason ?? "No reason given"}.`, isSystem: true });
  res.json(updated);
});

// ── Messages ──────────────────────────────────────────────────────────────────

router.get("/p2p/orders/:id/messages", async (req, res) => {
  const { id } = req.params;
  const messages = await db.select().from(p2pMessages).where(eq(p2pMessages.orderId, id)).orderBy(p2pMessages.createdAt);
  res.json(messages);
});

router.post("/p2p/orders/:id/messages", async (req, res) => {
  const { id } = req.params;
  const v = validate(sendMessageRequestSchema, req.body);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const senderAddress = toEth((req.body as { senderAddress?: string }).senderAddress);
  if (!senderAddress) { res.status(400).json({ error: "senderAddress required" }); return; }

  const [order] = await db.select().from(p2pOrders).where(eq(p2pOrders.id, id)).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (![order.buyerAddress, order.sellerAddress].includes(senderAddress)) { res.status(403).json({ error: "Not a party to this order" }); return; }

  const data = v.data as { content?: string; imageUrl?: string };
  const [msg] = await db.insert(p2pMessages).values({
    orderId: id,
    senderAddress,
    content: data.content?.trim() ?? "",
    imageUrl: data.imageUrl ?? null,
    isSystem: false,
  }).returning();
  res.status(201).json(msg);
});

// ── Disputes ──────────────────────────────────────────────────────────────────

router.get("/p2p/orders/:id/dispute", async (req, res) => {
  const { id } = req.params;
  const [dispute] = await db.select().from(p2pDisputes).where(eq(p2pDisputes.orderId, id)).limit(1);
  if (!dispute) { res.status(404).json({ error: "No dispute found" }); return; }
  res.json(dispute);
});

router.post("/p2p/orders/:id/dispute", async (req, res) => {
  const { id } = req.params;
  const v = validate(createDisputeRequestSchema, req.body);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const openedBy = toEth((req.body as { openedBy?: string }).openedBy);
  if (!openedBy) { res.status(400).json({ error: "openedBy required" }); return; }

  const [order] = await db.select().from(p2pOrders).where(eq(p2pOrders.id, id)).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (![order.buyerAddress, order.sellerAddress].includes(openedBy)) { res.status(403).json({ error: "Not a party to this order" }); return; }
  if (!["paid"].includes(order.status)) { res.status(400).json({ error: "Can only dispute paid orders" }); return; }

  const existing = await db.select().from(p2pDisputes).where(eq(p2pDisputes.orderId, id)).limit(1);
  if (existing.length > 0) { res.status(409).json({ error: "Dispute already exists" }); return; }

  const data = v.data as { reason: "payment_not_received" | "payment_received_but_not_released" | "wrong_amount" | "other"; description: string; evidence?: string };
  const [dispute] = await db.insert(p2pDisputes).values({
    orderId: id, openedBy, reason: data.reason, description: data.description, evidence: data.evidence,
  }).returning();

  await db.update(p2pOrders).set({ status: "disputed", updatedAt: new Date() }).where(eq(p2pOrders.id, id));
  await db.insert(p2pMessages).values({ orderId: id, senderAddress: "system", content: `A dispute has been opened by ${openedBy.slice(0, 8)}…. Our team will review and resolve within 24 hours.`, isSystem: true });
  res.status(201).json(dispute);
});

// ── Payment Details ───────────────────────────────────────────────────────────

router.get("/p2p/payment-details/:address", async (req, res) => {
  const address = toEth(req.params.address);
  const rows = await db.select().from(p2pPaymentDetails)
    .where(eq(p2pPaymentDetails.ownerAddress, address))
    .orderBy(p2pPaymentDetails.paymentMethod, p2pPaymentDetails.createdAt);
  res.json(rows);
});

router.get("/p2p/payment-details/:address/:method", async (req, res) => {
  const { method } = req.params;
  const address = toEth(req.params.address);
  const rows = await db.select().from(p2pPaymentDetails)
    .where(and(
      eq(p2pPaymentDetails.ownerAddress, address),
      eq(p2pPaymentDetails.paymentMethod, method),
    ))
    .orderBy(p2pPaymentDetails.createdAt);
  res.json(rows);
});

router.post("/p2p/payment-details", async (req, res) => {
  const { ownerAddress: rawOwner, paymentMethod, label, details } = req.body as {
    ownerAddress?: string; paymentMethod?: string; label?: string; details?: Record<string, string>;
  };
  const ownerAddress = toEth(rawOwner);
  if (!ownerAddress || !paymentMethod || !details) {
    res.status(400).json({ error: "ownerAddress, paymentMethod and details required" }); return;
  }
  const existing = await db.select().from(p2pPaymentDetails).where(and(
    eq(p2pPaymentDetails.ownerAddress, ownerAddress),
    eq(p2pPaymentDetails.paymentMethod, paymentMethod),
  )).limit(1);

  if (existing.length > 0) {
    const [updated] = await db.update(p2pPaymentDetails)
      .set({ label: label ?? existing[0].label, details, updatedAt: new Date() })
      .where(eq(p2pPaymentDetails.id, existing[0].id))
      .returning();
    res.json(updated);
  } else {
    const [created] = await db.insert(p2pPaymentDetails)
      .values({ ownerAddress, paymentMethod, label: label ?? "", details })
      .returning();
    res.status(201).json(created);
  }
});

router.delete("/p2p/payment-details/:id", async (req, res) => {
  const { id } = req.params;
  const ownerAddress = toEth((req.body as { ownerAddress?: string }).ownerAddress);
  if (!ownerAddress) { res.status(400).json({ error: "ownerAddress required" }); return; }
  const [deleted] = await db.delete(p2pPaymentDetails)
    .where(and(eq(p2pPaymentDetails.id, id), eq(p2pPaymentDetails.ownerAddress, ownerAddress)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

// ── Ratings ───────────────────────────────────────────────────────────────────

router.post("/p2p/orders/:id/rate", async (req, res) => {
  const { id } = req.params;
  const v = validate(rateOrderRequestSchema, req.body);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const raterAddress = toEth((req.body as { raterAddress?: string }).raterAddress);
  const ratedAddress = toEth((req.body as { ratedAddress?: string }).ratedAddress);
  if (!raterAddress || !ratedAddress) { res.status(400).json({ error: "raterAddress and ratedAddress required" }); return; }

  const [order] = await db.select().from(p2pOrders).where(and(eq(p2pOrders.id, id), eq(p2pOrders.status, "released"))).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found or not completed" }); return; }

  const data = v.data as { score: number; comment?: string };
  await db.insert(p2pRatings).values({ orderId: id, raterAddress, ratedAddress, score: data.score, comment: data.comment }).onConflictDoNothing();

  // Recalculate avg rating
  const ratings = await db.select().from(p2pRatings).where(eq(p2pRatings.ratedAddress, ratedAddress));
  const avg = ratings.reduce((s, r) => s + r.score, 0) / ratings.length;
  await db.update(p2pProfiles).set({ avgRating: avg.toFixed(2), updatedAt: new Date() }).where(eq(p2pProfiles.mxcAddress, ratedAddress));

  res.json({ ok: true });
});

// ── GET /p2p/market-price — lowest/highest price from active ads ──────────────
router.get("/p2p/market-price", async (req, res) => {
  const { token, side } = req.query as { token?: string; side?: string };
  try {
    const where = and(
      eq(p2pAds.status, "active"),
      ...(token ? [eq(p2pAds.token, token as "MC" | "USDT")] : []),
      ...(side  ? [eq(p2pAds.side,  side  as "buy" | "sell")] : []),
    );
    const rows = await db.select({ price: p2pAds.price }).from(p2pAds).where(where);
    const prices = rows.map(r => parseFloat(r.price)).filter(p => !isNaN(p) && p > 0);
    if (prices.length === 0) {
      res.json({ lowestPrice: null, highestPrice: null, count: 0 });
      return;
    }
    res.json({
      lowestPrice:  Math.min(...prices),
      highestPrice: Math.max(...prices),
      count: prices.length,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch market price" });
  }
});

// ── GET /p2p/wallet-balance/:address — GMI + verified stablecoin ─────────────
router.get("/p2p/wallet-balance/:address", async (req, res) => {
  const { address } = req.params;
  if (!address) { res.status(400).json({ error: "address required" }); return; }

  const { createPublicClient, http, formatEther, parseAbi } = await import("viem");
  try {
    const addr = address.toLowerCase() as `0x${string}`;
    const client = createPublicClient({ chain: gmiChain, transport: http(GMI_RPC_URL) });

    const [mcWei, usdtRaw] = await Promise.allSettled([
      client.getBalance({ address: addr }),
      (async () => {
        const usdtContract = process.env["USDT_CONTRACT_ADDRESS"];
        if (!usdtContract) return 0n;
        const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
        return client.readContract({
          address: usdtContract.toLowerCase() as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [addr],
        }) as Promise<bigint>;
      })(),
    ]);

    const mc   = mcWei.status   === "fulfilled" ? parseFloat(formatEther(mcWei.value)).toFixed(6)   : "0";
    const usdt = usdtRaw.status === "fulfilled" ? (Number(usdtRaw.value) / 1e6).toFixed(6) : "0";

    res.json({ mc, usdt });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch balance" });
  }
});

export default router;
