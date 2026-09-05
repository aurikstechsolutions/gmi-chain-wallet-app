import { Router } from "express";
import { pool } from "@workspace/db";
import WebSocket from "ws";

const router = Router();

// ── Deriv config ──────────────────────────────────────────────────────────────
const DERIV_BASE_URL = "https://api.derivws.com";
const DERIV_PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public";

// Assets that support binary CALL/PUT on new Deriv API
const ASSET_SYMBOLS: Record<string, string> = {
  V100:   "R_100",       // Volatility 100 Index (synthetic, 24/7)
  V50:    "R_50",        // Volatility 50 Index  (synthetic, 24/7)
  GOLD:   "frxXAUUSD",   // Gold vs USD
  EURUSD: "frxEURUSD",   // EUR/USD
};

const ASSET_LABELS: Record<string, string> = {
  V100:   "Volatility 100",
  V50:    "Volatility 50",
  GOLD:   "Gold / USD",
  EURUSD: "EUR / USD",
};

const DURATION_UNIT: Record<string, string> = {
  "30s": "s",
  "1m":  "m",
  "5m":  "m",
  "15m": "m",
  "1h":  "h",
};

const DURATION_VALUE: Record<string, number> = {
  "30s": 30,
  "1m":  1,
  "5m":  5,
  "15m": 15,
  "1h":  1,
};

function getAuthHeaders(): Record<string, string> {
  const token = process.env["DERIV_API_TOKEN"];
  const appId  = process.env["DERIV_APP_ID"];
  if (!token) throw new Error("DERIV_API_TOKEN is not configured");
  if (!appId)  throw new Error("DERIV_APP_ID is not configured");
  return {
    "Authorization": `Bearer ${token}`,
    "Deriv-App-ID":  appId,
    "Content-Type":  "application/json",
  };
}

// ── Account cache (TTL: 60 s) ─────────────────────────────────────────────────
let accountCache: { demo: string; real: string; ts: number } | null = null;

async function getDerivAccounts(): Promise<{ demo: string; real: string }> {
  if (accountCache && Date.now() - accountCache.ts < 60_000) {
    return accountCache;
  }
  const r = await fetch(`${DERIV_BASE_URL}/trading/v1/options/accounts`, {
    headers: getAuthHeaders(),
  });
  if (!r.ok) throw new Error(`Failed to get Deriv accounts: HTTP ${r.status}`);
  const data = await r.json() as { data: Array<{ account_id: string; account_type: string }> };
  const demo = data.data.find(a => a.account_type === "demo")?.account_id ?? "";
  const real = data.data.find(a => a.account_type === "real")?.account_id ?? "";
  accountCache = { demo, real, ts: Date.now() };
  return { demo, real };
}

// ── Open an authenticated Deriv WebSocket session via OTP ─────────────────────
async function openDerivSession(accountType: "demo" | "real" = "demo"): Promise<WebSocket> {
  const headers = getAuthHeaders();
  const accounts = await getDerivAccounts();
  const accountId = accountType === "real" ? accounts.real : accounts.demo;
  if (!accountId) throw new Error(`No ${accountType} account found on Deriv`);

  const r = await fetch(
    `${DERIV_BASE_URL}/trading/v1/options/accounts/${accountId}/otp`,
    { method: "POST", headers }
  );
  if (!r.ok) throw new Error(`Failed to get OTP: HTTP ${r.status}`);
  const otpData = await r.json() as { data?: { url?: string } };
  const wsUrl = otpData.data?.url;
  if (!wsUrl) throw new Error("OTP response missing WebSocket URL");

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => { ws.terminate(); reject(new Error("Deriv WS connect timeout")); }, 10_000);
    ws.on("open", () => { clearTimeout(t); resolve(ws); });
    ws.on("unexpected-response", (_, resp) => {
      clearTimeout(t);
      reject(new Error(`Deriv WS HTTP ${resp.statusCode}`));
    });
    ws.on("error", (err) => { clearTimeout(t); reject(err); });
  });
}

// ── Send a single request on an authenticated session ─────────────────────────
async function derivAuthRequest(
  payload: Record<string, unknown>,
  accountType: "demo" | "real" = "demo"
): Promise<Record<string, unknown>> {
  const ws = await openDerivSession(accountType);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.terminate(); reject(new Error("Deriv API timeout")); }, 20_000);
    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      clearTimeout(t);
      ws.terminate();
      if (msg.error) reject(new Error((msg.error as Record<string, unknown>).message as string));
      else resolve(msg);
    });
    ws.on("error", (err) => { clearTimeout(t); ws.terminate(); reject(err); });
    ws.send(JSON.stringify(payload));
  });
}

// ── Public WS request (no auth — for ticks/prices) ───────────────────────────
async function derivPublicRequest(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_PUBLIC_WS);
    const t = setTimeout(() => { ws.terminate(); reject(new Error("Deriv public WS timeout")); }, 15_000);
    ws.on("open", () => ws.send(JSON.stringify(payload)));
    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      clearTimeout(t);
      ws.terminate();
      if (msg.error) reject(new Error((msg.error as Record<string, unknown>).message as string));
      else resolve(msg);
    });
    ws.on("error", (err) => { clearTimeout(t); reject(err); });
  });
}

// ── Open a session and run a multi-step operation ─────────────────────────────
async function derivMultiStep<T>(
  fn: (ws: WebSocket, send: (p: Record<string, unknown>) => void) => Promise<T>,
  accountType: "demo" | "real" = "demo"
): Promise<T> {
  const ws = await openDerivSession(accountType);
  try {
    const send = (p: Record<string, unknown>) => ws.send(JSON.stringify(p));
    return await fn(ws, send);
  } finally {
    ws.terminate();
  }
}

// ── In-memory price cache (5 s TTL) ──────────────────────────────────────────
const priceCache = new Map<string, { price: number; ts: number }>();

async function getLivePrice(asset: string): Promise<number> {
  const symbol = ASSET_SYMBOLS[asset];
  if (!symbol) throw new Error(`Unknown asset: ${asset}`);
  const cached = priceCache.get(asset);
  if (cached && Date.now() - cached.ts < 5_000) return cached.price;

  const res = await derivPublicRequest({ ticks: symbol });
  const tick = res.tick as Record<string, unknown> | undefined;
  const price = parseFloat(String(tick?.ask ?? tick?.quote ?? 0));
  priceCache.set(asset, { price, ts: Date.now() });
  return price;
}

// ── Table setup ───────────────────────────────────────────────────────────────
export async function ensureTradingTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trades (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_address TEXT NOT NULL,
      asset          TEXT NOT NULL,
      direction      TEXT NOT NULL CHECK (direction IN ('UP','DOWN')),
      amount_usdt    NUMERIC(20,6) NOT NULL,
      payout_usdt    NUMERIC(20,6) NOT NULL,
      duration       TEXT NOT NULL,
      entry_price    NUMERIC(20,6),
      exit_price     NUMERIC(20,6),
      expires_at     TIMESTAMPTZ,
      status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','draw','error')),
      deriv_proposal_id TEXT,
      deriv_contract_id TEXT,
      payout_tx      TEXT,
      opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at    TIMESTAMPTZ,
      error_msg      TEXT
    );
    CREATE INDEX IF NOT EXISTS trades_wallet_idx  ON trades(wallet_address);
    CREATE INDEX IF NOT EXISTS trades_status_idx  ON trades(status);
    CREATE INDEX IF NOT EXISTS trades_expires_idx ON trades(expires_at) WHERE status = 'open';
  `);
}

// ── Card balance helpers ───────────────────────────────────────────────────────
async function getCardBalance(walletAddress: string): Promise<number> {
  const res = await pool.query<{ balance_usdt: string }>(
    "SELECT balance_usdt FROM card_accounts WHERE wallet_address = $1",
    [walletAddress]
  );
  return parseFloat(res.rows[0]?.balance_usdt ?? "0");
}

async function debitCardBalance(walletAddress: string, amount: number): Promise<void> {
  const res = await pool.query(
    `UPDATE card_accounts
     SET balance_usdt = balance_usdt - $1, updated_at = NOW()
     WHERE wallet_address = $2 AND balance_usdt >= $1`,
    [amount, walletAddress]
  );
  if (res.rowCount === 0) throw new Error("Insufficient balance");
}

async function creditCardBalance(walletAddress: string, amount: number): Promise<void> {
  await pool.query(
    `UPDATE card_accounts
     SET balance_usdt = balance_usdt + $1, updated_at = NOW()
     WHERE wallet_address = $2`,
    [amount, walletAddress]
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /trading/candles/:asset — historical OHLC for chart
router.get("/trading/candles/:asset", async (req, res) => {
  const symbol = ASSET_SYMBOLS[req.params.asset ?? ""];
  if (!symbol) { res.status(400).json({ error: "Invalid asset" }); return; }
  const granularity = Math.max(60, parseInt(String(req.query.granularity ?? "60")));
  const count       = Math.min(500, Math.max(10, parseInt(String(req.query.count ?? "200"))));
  try {
    const msg = await derivPublicRequest({
      ticks_history: symbol,
      end:           "latest",
      count,
      granularity,
      style:         "candles",
    });
    res.json(msg.candles ?? []);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Candle fetch failed" });
  }
});

// GET /trading/prices
router.get("/trading/prices", async (_req, res) => {
  try {
    const [v100, v50, gold, eurusd] = await Promise.all([
      getLivePrice("V100"),
      getLivePrice("V50"),
      getLivePrice("GOLD"),
      getLivePrice("EURUSD"),
    ]);
    res.json({ V100: v100, V50: v50, GOLD: gold, EURUSD: eurusd });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Price fetch failed" });
  }
});

// GET /trading/assets — metadata
router.get("/trading/assets", (_req, res) => {
  res.json(
    Object.entries(ASSET_LABELS).map(([key, label]) => ({
      key,
      label,
      symbol: ASSET_SYMBOLS[key],
    }))
  );
});

// POST /trading/proposal — price quote (fresh quote, no proposal ID held)
router.post("/trading/proposal", async (req, res) => {
  const { asset, direction, amount, duration } = req.body as {
    asset?: string; direction?: string; amount?: number; duration?: string;
  };

  if (!asset || !ASSET_SYMBOLS[asset])   { res.status(400).json({ error: "Invalid asset" }); return; }
  if (direction !== "UP" && direction !== "DOWN") { res.status(400).json({ error: "direction must be UP or DOWN" }); return; }
  if (!amount || amount < 0.35)          { res.status(400).json({ error: "Minimum amount is $0.35" }); return; }
  if (!duration || !DURATION_VALUE[duration]) { res.status(400).json({ error: "Invalid duration" }); return; }

  try {
    const contractType = direction === "UP" ? "CALL" : "PUT";
    const msg = await derivAuthRequest({
      proposal:         1,
      amount,
      basis:            "stake",
      contract_type:    contractType,
      currency:         "USD",
      duration:         DURATION_VALUE[duration],
      duration_unit:    DURATION_UNIT[duration],
      underlying_symbol: ASSET_SYMBOLS[asset],
    });

    const proposal = msg.proposal as Record<string, unknown>;
    res.json({
      proposalId:   proposal.id,
      payout:       parseFloat(String(proposal.payout)),
      askPrice:     parseFloat(String(proposal.ask_price)),
      spotPrice:    parseFloat(String(proposal.spot)),
      displayValue: proposal.display_value,
      longCode:     proposal.longcode,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Proposal failed" });
  }
});

// POST /trading/open — place a trade (fresh proposal + buy in one session)
router.post("/trading/open", async (req, res) => {
  const { walletAddress, asset, direction, amount, duration } = req.body as {
    walletAddress?: string; asset?: string; direction?: string;
    amount?: number; duration?: string;
  };

  if (!walletAddress)                    { res.status(400).json({ error: "walletAddress required" }); return; }
  if (!asset || !ASSET_SYMBOLS[asset])   { res.status(400).json({ error: "Invalid asset" }); return; }
  if (direction !== "UP" && direction !== "DOWN") { res.status(400).json({ error: "Invalid direction" }); return; }
  if (!amount || amount < 0.35)          { res.status(400).json({ error: "Minimum $0.35" }); return; }
  if (!duration || !DURATION_VALUE[duration]) { res.status(400).json({ error: "Invalid duration" }); return; }

  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const balance = await getCardBalance(normalizedAddress);
    if (balance < amount) { res.status(400).json({ error: "Insufficient USDT balance" }); return; }

    // Debit first to prevent double-spend
    await debitCardBalance(normalizedAddress, amount);

    let contractId:  string | null = null;
    let entryPrice:  number | null = null;
    let finalPayout: number        = amount * 1.87;
    let proposalId:  string | null = null;

    try {
      const contractType = direction === "UP" ? "CALL" : "PUT";

      // Single authenticated session: propose → buy
      const { pid, buyResult } = await derivMultiStep(async (ws, send) => {
        const result = await new Promise<{ pid: string; buyResult: Record<string, unknown> }>((resolve, reject) => {
          let pid: string | null = null;
          const t = setTimeout(() => reject(new Error("Trade session timeout")), 25_000);

          ws.on("message", (raw) => {
            let msg: Record<string, unknown>;
            try { msg = JSON.parse(raw.toString()); } catch { return; }

            if (msg.error) {
              clearTimeout(t);
              reject(new Error((msg.error as Record<string, unknown>).message as string));
              return;
            }

            if (msg.msg_type === "proposal") {
              const p = msg.proposal as Record<string, unknown>;
              pid = String(p.id);
              // Immediately buy at ask price
              send({ buy: pid, price: p.ask_price });
            }

            if (msg.msg_type === "buy") {
              clearTimeout(t);
              if (!pid) { reject(new Error("Buy arrived before proposal")); return; }
              resolve({ pid, buyResult: msg.buy as Record<string, unknown> });
            }
          });

          ws.on("error", (err) => { clearTimeout(t); reject(err); });

          send({
            proposal:          1,
            amount,
            basis:             "stake",
            contract_type:     contractType,
            currency:          "USD",
            duration:          DURATION_VALUE[duration],
            duration_unit:     DURATION_UNIT[duration],
            underlying_symbol: ASSET_SYMBOLS[asset],
          });
        });
        return result;
      });

      proposalId  = pid;
      contractId  = String(buyResult.contract_id);
      entryPrice  = parseFloat(String(buyResult.buy_price));
      finalPayout = parseFloat(String(buyResult.payout));
    } catch (derivErr) {
      // Refund on Deriv failure
      await creditCardBalance(normalizedAddress, amount);
      throw derivErr;
    }

    const durationMs = (DURATION_VALUE[duration] ?? 1) * (DURATION_UNIT[duration] === "h" ? 3_600_000 : 60_000);
    const expiresAt  = new Date(Date.now() + durationMs);

    const tradeRes = await pool.query<{ id: string }>(
      `INSERT INTO trades
         (wallet_address, asset, direction, amount_usdt, payout_usdt, duration,
          entry_price, expires_at, status, deriv_proposal_id, deriv_contract_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10)
       RETURNING id`,
      [normalizedAddress, asset, direction, amount, finalPayout,
       duration, entryPrice, expiresAt, proposalId, contractId]
    );

    res.json({
      tradeId:    tradeRes.rows[0].id,
      asset,
      direction,
      amount,
      payout:     finalPayout,
      entryPrice,
      expiresAt:  expiresAt.toISOString(),
      status:     "open",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Trade failed" });
  }
});

// GET /trading/trade/:id — poll status, resolve if expired
router.get("/trading/trade/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const tradeRes = await pool.query<{
      id: string; wallet_address: string; asset: string; direction: string;
      amount_usdt: string; payout_usdt: string; duration: string;
      entry_price: string; exit_price: string | null; expires_at: string;
      status: string; deriv_contract_id: string | null; opened_at: string;
      resolved_at: string | null;
    }>("SELECT * FROM trades WHERE id = $1", [id]);

    if (!tradeRes.rows[0]) { res.status(404).json({ error: "Trade not found" }); return; }
    const trade = tradeRes.rows[0];

    if (trade.status !== "open") {
      res.json({
        ...trade,
        amount_usdt: parseFloat(trade.amount_usdt),
        payout_usdt: parseFloat(trade.payout_usdt),
        entry_price: trade.entry_price ? parseFloat(trade.entry_price) : null,
        exit_price:  trade.exit_price  ? parseFloat(trade.exit_price)  : null,
      });
      return;
    }

    const isExpired = new Date(trade.expires_at) <= new Date();
    if (isExpired && trade.deriv_contract_id) {
      try {
        const contractRes = await derivAuthRequest({
          proposal_open_contract: 1,
          contract_id: parseInt(trade.deriv_contract_id),
        });
        const contract = contractRes.proposal_open_contract as Record<string, unknown>;
        const contractStatus = String(contract.status ?? "");

        if (contractStatus === "sold" || contractStatus === "won" || contractStatus === "lost") {
          const profit    = parseFloat(String(contract.profit ?? 0));
          const isWon     = profit > 0;
          const isDraw    = profit === 0 && contractStatus === "sold";
          const outcome   = isDraw ? "draw" : isWon ? "won" : "lost";
          const exitPrice = parseFloat(String(
            contract.exit_tick ?? contract.current_spot ?? trade.entry_price
          ));
          const payoutUsdt = parseFloat(trade.payout_usdt);

          await pool.query(
            `UPDATE trades SET status=$1, exit_price=$2, resolved_at=NOW() WHERE id=$3`,
            [outcome, exitPrice || parseFloat(trade.entry_price), id]
          );

          if (outcome === "won")  await creditCardBalance(trade.wallet_address, payoutUsdt);
          if (outcome === "draw") await creditCardBalance(trade.wallet_address, parseFloat(trade.amount_usdt));

          res.json({
            ...trade,
            status:      outcome,
            exit_price:  exitPrice,
            amount_usdt: parseFloat(trade.amount_usdt),
            payout_usdt: payoutUsdt,
            entry_price: parseFloat(trade.entry_price),
            resolved_at: new Date().toISOString(),
          });
          return;
        }
      } catch {
        // Deriv poll failed — return current status, client will retry
      }
    }

    res.json({
      ...trade,
      amount_usdt: parseFloat(trade.amount_usdt),
      payout_usdt: parseFloat(trade.payout_usdt),
      entry_price: trade.entry_price ? parseFloat(trade.entry_price) : null,
      exit_price:  null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Status check failed" });
  }
});

// GET /trading/history/:address
router.get("/trading/history/:address", async (req, res) => {
  const address = req.params.address.toLowerCase();
  try {
    const result = await pool.query<{
      id: string; asset: string; direction: string; amount_usdt: string;
      payout_usdt: string; duration: string; entry_price: string;
      exit_price: string | null; status: string; opened_at: string; resolved_at: string | null;
    }>(
      `SELECT id, asset, direction, amount_usdt, payout_usdt, duration,
              entry_price, exit_price, status, opened_at, resolved_at
       FROM trades WHERE wallet_address = $1
       ORDER BY opened_at DESC LIMIT 50`,
      [address]
    );
    res.json(result.rows.map(r => ({
      ...r,
      amount_usdt: parseFloat(r.amount_usdt),
      payout_usdt: parseFloat(r.payout_usdt),
      entry_price: r.entry_price ? parseFloat(r.entry_price) : null,
      exit_price:  r.exit_price  ? parseFloat(r.exit_price)  : null,
    })));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "History failed" });
  }
});

// GET /trading/balance/:address
router.get("/trading/balance/:address", async (req, res) => {
  const address = req.params.address.toLowerCase();
  try {
    const balance = await getCardBalance(address);
    res.json({ balance });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Balance check failed" });
  }
});

export default router;
