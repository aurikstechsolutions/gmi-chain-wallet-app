import { Router } from "express";
import { recoverMessageAddress } from "viem";
import { bech32 } from "bech32";
import { GMI_RPC_URL } from "../lib/chain";

const router = Router();

const CHAIN_BASE = process.env["GMI_API_BASE_URL"] ?? GMI_RPC_URL;

// ── Address normalisation ─────────────────────────────────────────────────────
// recoverMessageAddress always returns a 0x ETH hex address.
// fromAddress in the body may arrive as either gmi1... or 0x...
// We normalise to 0x for comparison only; the message is built with the raw string.
function mxcToEth(addr: string): string {
  if (!addr.startsWith("gmi1")) return addr.toLowerCase();
  try {
    const { words } = bech32.decode(addr);
    const bytes = Uint8Array.from(bech32.fromWords(words));
    return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return addr.toLowerCase();
  }
}

// ── Build the canonical message that the client must sign ─────────────────────
// • toAddress: use the exact string from the body; if absent/empty, use "null"
// • fromAddress: use the exact string from the body (gmi1... or 0x...) — do NOT convert
function buildTransferMessage(params: {
  fromAddress: string;
  toAddress: string | null | undefined;
  amount: string;
  nonce: number;
}): string {
  return [
    "GMI Transfer",
    `from: ${params.fromAddress}`,
    `to: ${params.toAddress || "null"}`,
    `amount: ${params.amount}`,
    `nonce: ${params.nonce}`,
  ].join("\n");
}

// ── Shared handler ────────────────────────────────────────────────────────────
async function handleTransaction(
  req: import("express").Request,
  res: import("express").Response,
  walletKeyOverride?: string,
): Promise<void> {
  const body = req.body as {
    from?: string;
    fromAddress?: string;
    to?: string;
    toAddress?: string;
    amount?: string;
    nonce?: number;
    signature?: string;
    data?: string;
    txType?: string;
  };

  // Accept both from/to (chain docs) and fromAddress/toAddress (legacy)
  const fromAddress = body.from ?? body.fromAddress;
  const toAddress   = body.to   ?? body.toAddress;
  const { amount, nonce, signature, data, txType } = body;

  // ── Validate required fields ──────────────────────────────────────────────
  if (!fromAddress || !amount || nonce === undefined || !signature) {
    res.status(400).json({
      error: "Missing required fields: from (or fromAddress), amount, nonce, signature",
    });
    return;
  }

  if (typeof nonce !== "number" || !Number.isInteger(nonce) || nonce < 0) {
    res.status(400).json({ error: "nonce must be a non-negative integer" });
    return;
  }

  if (!/^\d+$/.test(amount)) {
    res.status(400).json({ error: "amount must be a numeric string (in base units / wei)" });
    return;
  }

  // Native transfers require amount > 0; contract calls may legitimately send 0
  if (amount === "0" && txType !== "contract_call") {
    res.status(400).json({ error: "amount must be greater than 0 for native transfers" });
    return;
  }

  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    res.status(400).json({ error: "signature must be a valid 65-byte hex string (0x + 130 hex chars)" });
    return;
  }

  // ── Verify signature ──────────────────────────────────────────────────────
  try {
    const message = buildTransferMessage({ fromAddress, toAddress, amount, nonce });

    const recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });

    const fromNorm = mxcToEth(fromAddress);
    if (recovered.toLowerCase() !== fromNorm.toLowerCase()) {
      req.log.warn({ recovered, fromAddress, fromNorm }, "signature mismatch");
      res.status(401).json({
        error: "Signature verification failed — recovered address does not match sender",
        recovered,
      });
      return;
    }
  } catch (err) {
    req.log.error({ err }, "signature recovery failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  // ── Forward to chain node ─────────────────────────────────────────────────
  try {
    // Use server-side WALLET_API_KEY env var to authenticate with the chain node.
    // This means the mobile app never needs to know the key — the backend injects it.
    const walletKey =
      process.env["WALLET_API_KEY"] ??
      walletKeyOverride ??
      req.headers["x-wallet-key"];
    const upstream = await fetch(`${CHAIN_BASE}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(walletKey ? { "X-Wallet-Key": String(walletKey) } : {}),
      },
      body: JSON.stringify({
        // Send both naming conventions — chain node accepts either
        from: fromAddress,
        fromAddress,
        to: toAddress || null,
        toAddress: toAddress || null,
        amount,
        nonce,
        signature,
        ...(txType ? { txType } : {}),
        ...(data   ? { data }   : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await upstream.text();
    req.log.info({ status: upstream.status, fromAddress, toAddress, amount }, "transaction forwarded");

    res.setHeader("Content-Type", "application/json");
    res.status(upstream.status).send(text);
  } catch (err) {
    req.log.error({ err }, "transaction forward failed");
    res.status(502).json({ error: "Chain node unavailable" });
  }
}

// ── POST /transactions — requires X-Wallet-Key header (if WALLET_API_KEY is set) ──
router.post("/transactions", (req, res) => handleTransaction(req, res));

// ── POST /transactions/send — no wallet key required ─────────────────────────
router.post("/transactions/send", (req, res) => handleTransaction(req, res));

export default router;
