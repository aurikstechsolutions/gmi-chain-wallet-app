import { Router } from "express";
import { pool } from "@workspace/db";
import { createPublicClient, http, parseAbiItem, type Hex } from "viem";
import Stripe from "stripe";
import { GMI_RPC_URL, gmiChain } from "../lib/chain";

const router = Router();

// ── GMI Chain config ─────────────────────────────────────────────────────────
const USDT_DECIMALS = 6;

function getUsdtContract(): `0x${string}` {
  const addr = process.env["USDT_CONTRACT_ADDRESS"];
  if (!addr) throw new Error("USDT_CONTRACT_ADDRESS is not configured");
  return addr.toLowerCase() as `0x${string}`;
}

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

function getPublicClient() {
  return createPublicClient({ chain: gmiChain, transport: http(GMI_RPC_URL) });
}

// ── Stripe helpers ───────────────────────────────────────────────────────────
async function getStripeKey(): Promise<string | null> {
  try {
    const res = await pool.query(
      "SELECT key_value FROM platform_api_keys WHERE key_name = 'stripe_secret_key'"
    );
    return (res.rows[0]?.key_value as string) ?? null;
  } catch {
    return null;
  }
}

async function getStripeClient(): Promise<Stripe | null> {
  const key = await getStripeKey();
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-04-30.basil" });
}

// ── Merchant / admin wallet ───────────────────────────────────────────────────
const CARD_CHARGE_USD = 20;   // collected from user in MUSDT
const KC_ISSUE_AMOUNT = 10;   // amount sent to KripiCard when issuing the card

function getMerchantAddress(): `0x${string}` {
  const addr = process.env["CARD_MERCHANT_ADDRESS"] ?? process.env["P2P_ESCROW_ADDRESS"];
  if (!addr) throw new Error("CARD_MERCHANT_ADDRESS is not configured");
  return addr.toLowerCase() as `0x${string}`;
}

// ── Table setup ──────────────────────────────────────────────────────────────
export async function ensureCardsTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS card_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_address TEXT NOT NULL UNIQUE,
      deposit_address TEXT NOT NULL,
      balance_usdt NUMERIC(20, 6) NOT NULL DEFAULT 0,
      frozen BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'active',
      stripe_cardholder_id TEXT,
      stripe_card_id TEXT,
      cardholder_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE card_accounts ADD COLUMN IF NOT EXISTS stripe_cardholder_id TEXT;
    ALTER TABLE card_accounts ADD COLUMN IF NOT EXISTS stripe_card_id TEXT;
    ALTER TABLE card_accounts ADD COLUMN IF NOT EXISTS cardholder_name TEXT;
    CREATE TABLE IF NOT EXISTS card_deposits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_address TEXT NOT NULL,
      tx_hash TEXT NOT NULL UNIQUE,
      amount_usdt NUMERIC(20, 6) NOT NULL,
      from_address TEXT NOT NULL DEFAULT '',
      network TEXT NOT NULL DEFAULT 'mchain',
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS card_deposits_wallet_idx ON card_deposits(wallet_address);
    ALTER TABLE card_accounts ADD COLUMN IF NOT EXISTS kripicard_card_id TEXT;
    ALTER TABLE card_accounts ADD COLUMN IF NOT EXISTS kripicard_last4 TEXT;
    ALTER TABLE card_accounts ADD COLUMN IF NOT EXISTS kripicard_bin TEXT;
    ALTER TABLE card_accounts ADD COLUMN IF NOT EXISTS kripicard_status TEXT;
  `);
}

// ── Stripe: create cardholder + card ─────────────────────────────────────────
async function provisionStripeCard(
  stripe: Stripe,
  name: string,
  walletAddress: string
): Promise<{ cardholderId: string; cardId: string }> {
  const cardholder = await stripe.issuing.cardholders.create({
    name: name || `GMI User ${walletAddress.slice(2, 8).toUpperCase()}`,
    type: "individual",
    billing: {
      address: {
        line1: "123 Main Street",
        city: "New York",
        state: "NY",
        postal_code: "10001",
        country: "US",
      },
    },
    status: "active",
  });

  const card = await stripe.issuing.cards.create({
    cardholder: cardholder.id,
    currency: "usd",
    type: "virtual",
    status: "active",
  });

  return { cardholderId: cardholder.id, cardId: card.id };
}

// ── Stripe: sync spending limit to current USDT balance ──────────────────────
async function syncStripeSpendingLimit(
  stripe: Stripe,
  cardId: string,
  balanceUsdt: number
): Promise<void> {
  const amountCents = Math.floor(balanceUsdt * 100);
  if (amountCents <= 0) {
    await stripe.issuing.cards.update(cardId, {
      spending_controls: { spending_limits: [] },
    });
    return;
  }
  await stripe.issuing.cards.update(cardId, {
    spending_controls: {
      spending_limits: [{ amount: amountCents, interval: "all_time" }],
    },
  });
}

// ── POST /cards/init ─────────────────────────────────────────────────────────
router.post("/cards/init", async (req, res): Promise<void> => {
  const { walletAddress, name } = req.body as { walletAddress?: string; name?: string };
  if (!walletAddress || typeof walletAddress !== "string") {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }
  const addr = walletAddress.toLowerCase();
  try {
    // Self-heal: ensure the cards tables exist even if startup migration was skipped
    await ensureCardsTables();

    const existing = await pool.query(
      "SELECT * FROM card_accounts WHERE wallet_address = $1",
      [addr]
    );
    if (existing.rows.length > 0) {
      res.json({ account: existing.rows[0] });
      return;
    }

    const depositAddress = getMerchantAddress();
    const displayName = name?.trim() || `GMI ${addr.slice(2, 8).toUpperCase()}`;

    // Provision Stripe cardholder + card if key is configured
    let cardholderId: string | null = null;
    let cardId: string | null = null;
    try {
      const stripe = await getStripeClient();
      if (stripe) {
        const provisioned = await provisionStripeCard(stripe, displayName, addr);
        cardholderId = provisioned.cardholderId;
        cardId = provisioned.cardId;
      }
    } catch (err) {
      console.warn("Stripe provisioning failed:", err instanceof Error ? err.message : err);
    }

    const result = await pool.query(
      `INSERT INTO card_accounts (wallet_address, deposit_address, stripe_cardholder_id, stripe_card_id, cardholder_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [addr, depositAddress.toLowerCase(), cardholderId, cardId, displayName]
    );
    res.json({ account: result.rows[0] });
  } catch (err) {
    console.error("POST /cards/init error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Failed to initialise card account" });
  }
});

// ── GET /cards/account/:walletAddress ────────────────────────────────────────
router.get("/cards/account/:walletAddress", async (req, res): Promise<void> => {
  const addr = (req.params["walletAddress"] ?? "").toLowerCase();
  if (!addr) { res.status(400).json({ error: "walletAddress required" }); return; }
  try {
    const result = await pool.query(
      "SELECT * FROM card_accounts WHERE wallet_address = $1",
      [addr]
    );
    if (result.rows.length === 0) { res.json({ account: null }); return; }
    res.json({ account: result.rows[0] });
  } catch {
    res.status(500).json({ error: "Failed to fetch card account" });
  }
});

// ── GET /cards/deposits/:walletAddress ───────────────────────────────────────
router.get("/cards/deposits/:walletAddress", async (req, res): Promise<void> => {
  const addr = (req.params["walletAddress"] ?? "").toLowerCase();
  if (!addr) { res.status(400).json({ error: "walletAddress required" }); return; }
  try {
    const result = await pool.query(
      "SELECT * FROM card_deposits WHERE wallet_address = $1 ORDER BY created_at DESC LIMIT 50",
      [addr]
    );
    res.json({ deposits: result.rows });
  } catch {
    res.status(500).json({ error: "Failed to fetch deposits" });
  }
});

// ── GET /cards/stripe-details/:walletAddress ─────────────────────────────────
// Returns real card number, CVC, expiry for secure display in app.
// Works in test mode; live mode requires PCI DSS SAQ-D compliance.
router.get("/cards/stripe-details/:walletAddress", async (req, res): Promise<void> => {
  const addr = (req.params["walletAddress"] ?? "").toLowerCase();
  if (!addr) { res.status(400).json({ error: "walletAddress required" }); return; }
  try {
    const accountRes = await pool.query(
      "SELECT stripe_card_id FROM card_accounts WHERE wallet_address = $1",
      [addr]
    );
    if (accountRes.rows.length === 0) {
      res.status(404).json({ error: "Card account not found" });
      return;
    }
    const cardId: string | null = accountRes.rows[0].stripe_card_id as string | null;
    if (!cardId) {
      res.status(404).json({ error: "No Stripe card issued yet — add your Stripe key in admin settings" });
      return;
    }

    const stripe = await getStripeClient();
    if (!stripe) {
      res.status(503).json({ error: "Stripe key not configured" });
      return;
    }

    const card = await stripe.issuing.cards.retrieve(cardId, {
      expand: ["number", "cvc"],
    });

    res.json({
      number: (card as unknown as { number?: string }).number ?? null,
      cvc: (card as unknown as { cvc?: string }).cvc ?? null,
      exp_month: card.exp_month,
      exp_year: card.exp_year,
      last4: card.last4,
      brand: card.brand,
      status: card.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Failed to fetch card details: ${msg}` });
  }
});

// ── POST /cards/verify-deposit ───────────────────────────────────────────────
router.post("/cards/verify-deposit", async (req, res): Promise<void> => {
  const { walletAddress } = req.body as { walletAddress?: string };
  if (!walletAddress || typeof walletAddress !== "string") {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }
  const addr = walletAddress.toLowerCase();

  try {
    const accountResult = await pool.query(
      "SELECT * FROM card_accounts WHERE wallet_address = $1",
      [addr]
    );
    if (accountResult.rows.length === 0) {
      res.status(404).json({ error: "Card account not found" });
      return;
    }
    const account = accountResult.rows[0] as {
      stripe_card_id: string | null;
      balance_usdt: string;
    };

    let usdtContract: Hex;
    let merchantAddr: Hex;
    try {
      usdtContract = getUsdtContract();
      merchantAddr = getMerchantAddress();
    } catch (e) {
      res.status(503).json({ error: e instanceof Error ? e.message : "Server not configured" });
      return;
    }

    const client = getPublicClient();
    const latestBlock = await client.getBlockNumber();
    const fromBlock = latestBlock > 9_000n ? latestBlock - 9_000n : 0n;

    // Look for USDT transfers FROM user's wallet TO the admin/merchant wallet
    const logs = await client.getLogs({
      address: usdtContract,
      event: TRANSFER_EVENT,
      args: { from: addr as Hex, to: merchantAddr },
      fromBlock,
      toBlock: "latest",
    });

    if (logs.length === 0) {
      res.json({ credited: 0, newDeposits: 0, message: "No USDT deposits found on GMI Chain" });
      return;
    }

    const hashes = logs.map((l) => l.transactionHash).filter(Boolean);
    const existingResult = await pool.query(
      `SELECT tx_hash FROM card_deposits WHERE tx_hash = ANY($1)`,
      [hashes]
    );
    const existingHashes = new Set(
      existingResult.rows.map((r: { tx_hash: string }) => r.tx_hash)
    );

    const newLogs = logs.filter(
      (l) => l.transactionHash && !existingHashes.has(l.transactionHash)
    );

    if (newLogs.length === 0) {
      res.json({ credited: 0, newDeposits: 0, message: "All deposits already credited" });
      return;
    }

    let totalCredited = 0;
    for (const log of newLogs) {
      if (!log.args?.value || !log.transactionHash) continue;
      const amountUsdt = Number(log.args.value) / Math.pow(10, USDT_DECIMALS);
      if (amountUsdt <= 0) continue;

      await pool.query(
        `INSERT INTO card_deposits (wallet_address, tx_hash, amount_usdt, from_address, network)
         VALUES ($1, $2, $3, $4, 'gmi')
         ON CONFLICT (tx_hash) DO NOTHING`,
        [addr, log.transactionHash, amountUsdt.toFixed(6), (log.args.from ?? "").toLowerCase()]
      );
      totalCredited += amountUsdt;
    }

    let newBalance = parseFloat(account.balance_usdt);
    if (totalCredited > 0) {
      const updatedAccount = await pool.query(
        `UPDATE card_accounts
         SET balance_usdt = balance_usdt + $1, updated_at = NOW()
         WHERE wallet_address = $2
         RETURNING balance_usdt, stripe_card_id`,
        [totalCredited.toFixed(6), addr]
      );

      newBalance = parseFloat(updatedAccount.rows[0].balance_usdt as string);
      const stripeCardId: string | null = updatedAccount.rows[0].stripe_card_id as string | null;

      // Push new spending limit to Stripe
      if (stripeCardId) {
        try {
          const stripe = await getStripeClient();
          if (stripe) {
            await syncStripeSpendingLimit(stripe, stripeCardId, newBalance);
          }
        } catch (stripeErr) {
          console.warn("Stripe limit sync failed:", stripeErr instanceof Error ? stripeErr.message : stripeErr);
        }
      }

    }

    res.json({
      credited: totalCredited,
      newDeposits: newLogs.length,
      message: totalCredited > 0
        ? `${totalCredited.toFixed(2)} USDT credited to your balance`
        : "All deposits already credited",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Verification failed: ${msg}` });
  }
});

// ── POST /cards/freeze ───────────────────────────────────────────────────────
router.post("/cards/freeze", async (req, res): Promise<void> => {
  const { walletAddress } = req.body as { walletAddress?: string };
  if (!walletAddress || typeof walletAddress !== "string") {
    res.status(400).json({ error: "walletAddress required" }); return;
  }
  const addr = walletAddress.toLowerCase();
  try {
    const result = await pool.query(
      `UPDATE card_accounts
       SET frozen = NOT frozen, updated_at = NOW()
       WHERE wallet_address = $1
       RETURNING frozen, stripe_card_id`,
      [addr]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "Account not found" }); return; }

    const { frozen, stripe_card_id: stripeCardId } = result.rows[0] as {
      frozen: boolean;
      stripe_card_id: string | null;
    };

    // Mirror freeze/unfreeze on the Stripe card
    if (stripeCardId) {
      try {
        const stripe = await getStripeClient();
        if (stripe) {
          await stripe.issuing.cards.update(stripeCardId, {
            status: frozen ? "inactive" : "active",
          });
        }
      } catch (stripeErr) {
        console.warn("Stripe freeze sync failed:", stripeErr instanceof Error ? stripeErr.message : stripeErr);
      }
    }

    res.json({ frozen });
  } catch {
    res.status(500).json({ error: "Failed to update freeze status" });
  }
});

// ── KripiCard helpers ─────────────────────────────────────────────────────────
const KC_BASE = "https://appapi.kripicard.com/api/external";

function getKcKey(): string {
  const key = process.env["KRIPICARD_API_KEY"];
  if (!key) throw new Error("KRIPICARD_API_KEY is not configured");
  return key;
}

async function kcPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${KC_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!data["success"]) throw new Error((data["message"] as string) ?? "KripiCard API error");
  return data as T;
}

// ── POST /cards/kc/issue ──────────────────────────────────────────────────────
router.post("/cards/kc/issue", async (req, res): Promise<void> => {
  const { walletAddress, bin, nameOnCard, email, dateOfBirth } =
    req.body as {
      walletAddress?: string; bin?: string;
      nameOnCard?: string; email?: string; dateOfBirth?: string;
    };
  if (!walletAddress || !bin || !nameOnCard || !email || !dateOfBirth) {
    res.status(400).json({ error: "walletAddress, bin, nameOnCard, email, dateOfBirth are all required" });
    return;
  }
  const addr = walletAddress.toLowerCase();
  try {
    const accountRes = await pool.query(
      "SELECT id, kripicard_card_id, balance_usdt FROM card_accounts WHERE wallet_address = $1",
      [addr]
    );
    if (accountRes.rows.length === 0) {
      res.status(404).json({ error: "Card account not found. Activate your card first." });
      return;
    }
    const row = accountRes.rows[0] as {
      id: string; kripicard_card_id: string | null; balance_usdt: string;
    };
    if (row.kripicard_card_id) {
      res.status(409).json({ error: "A KripiCard has already been issued for this wallet." });
      return;
    }

    const balance = parseFloat(row.balance_usdt);
    if (balance < CARD_CHARGE_USD) {
      res.status(402).json({
        error: `Insufficient balance. You need $${CARD_CHARGE_USD} USDT to get a card. Current balance: $${balance.toFixed(2)}.`,
      });
      return;
    }

    // Deduct $20 from user balance before calling KripiCard
    await pool.query(
      `UPDATE card_accounts SET balance_usdt = balance_usdt - $1, updated_at = NOW() WHERE wallet_address = $2`,
      [CARD_CHARGE_USD.toFixed(6), addr]
    );

    const apiKey = getKcKey();
    const payload: Record<string, unknown> = {
      api_key: apiKey, bin, amount: KC_ISSUE_AMOUNT, name_on_card: nameOnCard,
      email, dateOfBirth,
    };

    let data: { success: boolean; message: string; card_id: string; last_4: string; bin: string; amount: number; fee: number; total_charged: number };
    try {
      data = await kcPost<typeof data>("/cards/createcard", payload);
    } catch (kcErr) {
      // Refund balance if KripiCard fails
      await pool.query(
        `UPDATE card_accounts SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE wallet_address = $2`,
        [CARD_CHARGE_USD.toFixed(6), addr]
      );
      throw kcErr;
    }

    await pool.query(
      `UPDATE card_accounts
       SET kripicard_card_id = $1, kripicard_last4 = $2, kripicard_bin = $3,
           kripicard_status = 'active', updated_at = NOW()
       WHERE wallet_address = $4`,
      [data.card_id, data.last_4, String(bin), addr]
    );

    res.json({
      cardId: data.card_id, last4: data.last_4, bin: data.bin,
      chargedUsdt: CARD_CHARGE_USD, fee: data.fee, totalCharged: data.total_charged,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to issue card" });
  }
});

// ── POST /cards/kc/fund ───────────────────────────────────────────────────────
router.post("/cards/kc/fund", async (req, res): Promise<void> => {
  const { walletAddress, amount } = req.body as { walletAddress?: string; amount?: unknown };
  if (!walletAddress || !amount) {
    res.status(400).json({ error: "walletAddress and amount required" });
    return;
  }
  const topupAmt = Number(amount);
  if (topupAmt < 10) {
    res.status(400).json({ error: "Minimum top-up is $10" });
    return;
  }
  const addr = walletAddress.toLowerCase();
  try {
    const accountRes = await pool.query(
      "SELECT kripicard_card_id, balance_usdt FROM card_accounts WHERE wallet_address = $1",
      [addr]
    );
    const row = accountRes.rows[0] as {
      kripicard_card_id: string | null; balance_usdt: string;
    } | undefined;
    if (!row?.kripicard_card_id) {
      res.status(404).json({ error: "No KripiCard found for this wallet" });
      return;
    }

    const balance = parseFloat(row.balance_usdt);
    if (balance < topupAmt) {
      res.status(402).json({
        error: `Insufficient balance. Requested $${topupAmt}, available $${balance.toFixed(2)} USDT.`,
      });
      return;
    }

    // Deduct from user balance before calling KripiCard
    await pool.query(
      `UPDATE card_accounts SET balance_usdt = balance_usdt - $1, updated_at = NOW() WHERE wallet_address = $2`,
      [topupAmt.toFixed(6), addr]
    );

    let data: { success: boolean; message: string; data: { card_id: string; amount: number; fee: number; total_debited: number } };
    try {
      data = await kcPost<typeof data>("/cards/fundcard", {
        api_key: getKcKey(), card_id: row.kripicard_card_id, amount: topupAmt,
      });
    } catch (kcErr) {
      // Refund if KripiCard fails
      await pool.query(
        `UPDATE card_accounts SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE wallet_address = $2`,
        [topupAmt.toFixed(6), addr]
      );
      throw kcErr;
    }

    res.json({
      cardId: data.data.card_id, amount: data.data.amount,
      fee: data.data.fee, totalDebited: data.data.total_debited,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fund card" });
  }
});

// ── POST /cards/kc/details ────────────────────────────────────────────────────
router.post("/cards/kc/details", async (req, res): Promise<void> => {
  const { walletAddress } = req.body as { walletAddress?: string };
  if (!walletAddress) { res.status(400).json({ error: "walletAddress required" }); return; }
  const addr = walletAddress.toLowerCase();
  try {
    const accountRes = await pool.query(
      "SELECT kripicard_card_id, kripicard_last4, kripicard_bin, kripicard_status FROM card_accounts WHERE wallet_address = $1",
      [addr]
    );
    const row = accountRes.rows[0] as {
      kripicard_card_id: string | null; kripicard_last4: string | null;
      kripicard_bin: string | null; kripicard_status: string | null;
    } | undefined;
    if (!row?.kripicard_card_id) {
      res.status(404).json({ error: "No KripiCard found" });
      return;
    }
    const apiKey = getKcKey();
    const data = await kcPost<{
      success: boolean; card_number: string; expiry: string;
      cvv: string; balance: number; status: string;
    }>("/cards/carddetails", { api_key: apiKey, card_id: row.kripicard_card_id });

    if (data.status) {
      await pool.query(
        "UPDATE card_accounts SET kripicard_status = $1 WHERE wallet_address = $2",
        [data.status, addr]
      );
    }
    res.json({
      cardId: row.kripicard_card_id, last4: row.kripicard_last4,
      bin: row.kripicard_bin, status: data.status || row.kripicard_status,
      cardNumber: data.card_number, expiry: data.expiry, cvv: data.cvv, balance: data.balance,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get card details" });
  }
});

// ── POST /cards/kc/freeze ─────────────────────────────────────────────────────
router.post("/cards/kc/freeze", async (req, res): Promise<void> => {
  const { walletAddress, action } = req.body as { walletAddress?: string; action?: string };
  if (!walletAddress || !action || !["freeze", "unfreeze"].includes(action)) {
    res.status(400).json({ error: "walletAddress and action (freeze|unfreeze) required" });
    return;
  }
  const addr = walletAddress.toLowerCase();
  try {
    const accountRes = await pool.query(
      "SELECT kripicard_card_id FROM card_accounts WHERE wallet_address = $1",
      [addr]
    );
    const row = accountRes.rows[0] as { kripicard_card_id: string | null } | undefined;
    if (!row?.kripicard_card_id) {
      res.status(404).json({ error: "No KripiCard found" });
      return;
    }
    const apiKey = getKcKey();
    await kcPost("/premium/Freeze_Unfreeze", { api_key: apiKey, card_id: row.kripicard_card_id, action });

    const newStatus = action === "freeze" ? "frozen" : "active";
    await pool.query(
      "UPDATE card_accounts SET kripicard_status = $1 WHERE wallet_address = $2",
      [newStatus, addr]
    );
    res.json({ action, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to freeze/unfreeze card" });
  }
});

// ── POST /cards/kc/transactions ───────────────────────────────────────────────
router.post("/cards/kc/transactions", async (req, res): Promise<void> => {
  const { walletAddress } = req.body as { walletAddress?: string };
  if (!walletAddress) { res.status(400).json({ error: "walletAddress required" }); return; }
  const addr = walletAddress.toLowerCase();
  try {
    const accountRes = await pool.query(
      "SELECT kripicard_card_id FROM card_accounts WHERE wallet_address = $1",
      [addr]
    );
    const row = accountRes.rows[0] as { kripicard_card_id: string | null } | undefined;
    if (!row?.kripicard_card_id) {
      res.status(404).json({ error: "No KripiCard found" });
      return;
    }
    const apiKey = getKcKey();
    const data = await kcPost<{
      success: boolean;
      data: {
        card_id: string; balance: number; total_transactions: number;
        transactions: Array<{ date: string; type: string; merchant: string; amount: number; success: boolean }>;
      };
    }>("/cards/transactions", { api_key: apiKey, card_id: row.kripicard_card_id });

    res.json({
      cardId: data.data.card_id,
      balance: data.data.balance,
      totalTransactions: data.data.total_transactions,
      transactions: data.data.transactions,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get transactions" });
  }
});

export default router;
