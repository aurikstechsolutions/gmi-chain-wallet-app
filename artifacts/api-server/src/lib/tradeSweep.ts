/**
 * Background sweep: resolves open Deriv trading contracts that have passed
 * their expiry time. Runs every 30 seconds.
 * For each expired trade it polls Deriv's proposal_open_contract endpoint,
 * updates the DB status, and credits the payout if the trade won.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { notifyTradeResolved, isTelegramConfigured } from "./telegram";

const DERIV_BASE_URL = "https://api.derivws.com";

function getAuthHeaders(): Record<string, string> {
  const token = process.env["DERIV_API_TOKEN"];
  const appId  = process.env["DERIV_APP_ID"];
  if (!token || !appId) throw new Error("DERIV credentials not configured");
  return {
    "Authorization": `Bearer ${token}`,
    "Deriv-App-ID":  appId,
    "Content-Type":  "application/json",
  };
}

async function getDerivAccountId(): Promise<string> {
  const r = await fetch(`${DERIV_BASE_URL}/trading/v1/options/accounts`, {
    headers: getAuthHeaders(),
  });
  if (!r.ok) throw new Error(`Accounts fetch failed: HTTP ${r.status}`);
  const data = await r.json() as { data: Array<{ account_id: string; account_type: string }> };
  const demo = data.data.find(a => a.account_type === "demo")?.account_id ?? "";
  if (!demo) throw new Error("No demo account found");
  return demo;
}

async function getOtpWsUrl(accountId: string): Promise<string> {
  const r = await fetch(
    `${DERIV_BASE_URL}/trading/v1/options/accounts/${accountId}/otp`,
    { method: "POST", headers: getAuthHeaders() }
  );
  if (!r.ok) throw new Error(`OTP failed: HTTP ${r.status}`);
  const data = await r.json() as { data?: { url?: string } };
  const url = data.data?.url;
  if (!url) throw new Error("OTP response missing WebSocket URL");
  return url;
}

async function pollContractStatus(
  contractId: number, wsUrl: string
): Promise<{ status: string; profit: number; exitPrice: number }> {
  const { WebSocket } = await import("ws");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t  = setTimeout(() => { ws.terminate(); reject(new Error("WS timeout")); }, 20_000);
    ws.on("open",  () => ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: contractId })));
    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      clearTimeout(t);
      ws.terminate();
      if (msg.error) { reject(new Error((msg.error as Record<string, unknown>).message as string)); return; }
      const c = msg.proposal_open_contract as Record<string, unknown> | undefined;
      if (!c) { reject(new Error("No contract data")); return; }
      resolve({
        status:    String(c.status ?? "open"),
        profit:    parseFloat(String(c.profit   ?? 0)),
        exitPrice: parseFloat(String(c.exit_tick ?? c.current_spot ?? 0)),
      });
    });
    ws.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}

async function sweepTrades() {
  // Find all expired open trades that have a Deriv contract ID
  const { rows } = await pool.query<{
    id: string; wallet_address: string; amount_usdt: string;
    payout_usdt: string; entry_price: string;
    deriv_contract_id: string; asset: string; direction: "UP" | "DOWN";
  }>(`
    SELECT id, wallet_address, asset, direction, amount_usdt, payout_usdt, entry_price, deriv_contract_id
    FROM trades
    WHERE status = 'open'
      AND expires_at <= NOW()
      AND deriv_contract_id IS NOT NULL
    ORDER BY expires_at ASC
    LIMIT 20
  `);

  if (rows.length === 0) return;

  logger.info({ count: rows.length }, "Trade sweep: resolving expired contracts");

  // Re-use a single WS session for all contracts in this batch
  let wsUrl: string;
  try {
    const accountId = await getDerivAccountId();
    wsUrl = await getOtpWsUrl(accountId);
  } catch (e) {
    logger.error({ err: e }, "Trade sweep: could not open Deriv session");
    return;
  }

  for (const trade of rows) {
    try {
      const contractId = parseInt(trade.deriv_contract_id);
      const { status, profit, exitPrice } = await pollContractStatus(contractId, wsUrl);

      // If Deriv still says "open", skip — contract not yet settled on their side
      if (status === "open") continue;

      const outcome   = profit > 0 ? "won" : profit < 0 ? "lost" : "draw";
      const resolvedAt = new Date();

      await pool.query(
        `UPDATE trades SET status=$1, exit_price=$2, resolved_at=$3 WHERE id=$4`,
        [outcome, exitPrice || parseFloat(trade.entry_price), resolvedAt, trade.id]
      );

      if (outcome === "won") {
        await pool.query(
          `UPDATE card_accounts SET balance_usdt = balance_usdt + $1, updated_at = NOW()
           WHERE wallet_address = $2`,
          [parseFloat(trade.payout_usdt), trade.wallet_address]
        );
      } else if (outcome === "draw") {
        await pool.query(
          `UPDATE card_accounts SET balance_usdt = balance_usdt + $1, updated_at = NOW()
           WHERE wallet_address = $2`,
          [parseFloat(trade.amount_usdt), trade.wallet_address]
        );
      }

      logger.info(
        { tradeId: trade.id, contractId, outcome, profit, exitPrice },
        "Trade sweep: contract resolved"
      );

      // Telegram notification — trade result
      if (isTelegramConfigured() && (outcome === "won" || outcome === "lost")) {
        const balRes = await pool.query<{ balance_usdt: string }>(
          "SELECT balance_usdt FROM card_accounts WHERE wallet_address = $1",
          [trade.wallet_address]
        );
        const newBalance = parseFloat(balRes.rows[0]?.balance_usdt ?? "0");
        const pnl = outcome === "won"
          ? parseFloat(trade.payout_usdt) - parseFloat(trade.amount_usdt)
          : -parseFloat(trade.amount_usdt);

        void notifyTradeResolved({
          asset:      trade.asset,
          direction:  trade.direction,
          status:     outcome,
          amount:     parseFloat(trade.amount_usdt),
          payout:     parseFloat(trade.payout_usdt),
          entryPrice: parseFloat(trade.entry_price) || null,
          exitPrice:  exitPrice || null,
          pnl,
          tradeId:    trade.id,
          newBalance,
        });
      }

      // Brief pause between WS calls to avoid rate-limiting
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      logger.warn({ tradeId: trade.id, err: e }, "Trade sweep: failed to resolve contract");
    }
  }
}

export function startTradeSweep(intervalMs = 30_000) {
  void sweepTrades().catch(e => logger.error({ err: e }, "Initial trade sweep failed"));
  setInterval(() => {
    void sweepTrades().catch(e => logger.error({ err: e }, "Trade sweep failed"));
  }, intervalMs);
  logger.info({ intervalMs }, "Trade settlement sweep started");
}
