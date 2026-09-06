/**
 * Telegram notification helper.
 * Sends trade open / trade resolved messages to a configured chat.
 * Requires: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars.
 */

const TG_API = "https://api.telegram.org";

function getToken(): string | null  { return process.env["TELEGRAM_BOT_TOKEN"] ?? null; }
function getChatId(): string | null { return process.env["TELEGRAM_CHAT_ID"]   ?? null; }

export function isTelegramConfigured(): boolean {
  return !!(getToken() && getChatId());
}

async function send(text: string): Promise<void> {
  const token  = getToken();
  const chatId = getChatId();
  if (!token || !chatId) return;

  try {
    await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    chatId,
        text,
        parse_mode: "HTML",
      }),
    });
  } catch {
    // Never crash the server over a notification failure
  }
}

// ── Notification templates ────────────────────────────────────────────────────

export async function notifyTradeOpened(params: {
  asset:       string;
  direction:   "UP" | "DOWN";
  amount:      number;
  duration:    string;
  entryPrice:  number | null;
  confidence:  number;
  reason:      string;
  tradeId:     string;
}): Promise<void> {
  const dir   = params.direction === "UP" ? "🟢 CALL ▲" : "🔴 PUT ▼";
  const asset = params.asset === "GOLD" ? "🥇 GOLD" : "💶 EUR/USD";
  const entry = params.entryPrice ? params.entryPrice.toFixed(params.asset === "GOLD" ? 2 : 5) : "—";

  const lines = [
    `<b>🤖 AlphaBot — Trade Opened</b>`,
    ``,
    `${dir}  <b>${asset}</b>`,
    `💵 Stake: <b>$${params.amount.toFixed(2)} USDT</b>`,
    `⏱ Duration: <b>${params.duration}</b>`,
    `📈 Entry: <b>${entry}</b>`,
    `🎯 Confidence: <b>${params.confidence}%</b>`,
    ``,
    `<b>📊 Signal reasoning:</b>`,
    ...params.reason.split(" · ").map(r => `  • ${r}`),
    ``,
    `<code>${params.tradeId.slice(0, 8)}</code>`,
  ];

  await send(lines.join("\n"));
}

export async function notifyTradeResolved(params: {
  asset:      string;
  direction:  "UP" | "DOWN";
  status:     "won" | "lost" | "draw";
  amount:     number;
  payout:     number;
  entryPrice: number | null;
  exitPrice:  number | null;
  pnl:        number;
  tradeId:    string;
  newBalance: number;
}): Promise<void> {
  const resultIcon = params.status === "won"  ? "✅ WON"
                   : params.status === "lost" ? "❌ LOST"
                   : "➖ DRAW";
  const asset = params.asset === "GOLD" ? "🥇 GOLD" : "💶 EUR/USD";
  const dir   = params.direction === "UP" ? "▲ CALL" : "▼ PUT";
  const dp    = params.asset === "GOLD" ? 2 : 5;
  const entry = params.entryPrice ? params.entryPrice.toFixed(dp) : "—";
  const exit  = params.exitPrice  ? params.exitPrice.toFixed(dp)  : "—";
  const pnlStr = params.pnl >= 0 ? `+$${params.pnl.toFixed(2)}` : `-$${Math.abs(params.pnl).toFixed(2)}`;

  const lines = [
    `<b>🤖 AlphaBot — Trade ${resultIcon}</b>`,
    ``,
    `${asset}  ${dir}`,
    `💵 Stake: $${params.amount.toFixed(2)} → Payout: $${params.payout.toFixed(2)}`,
    `📈 Entry: <b>${entry}</b>  →  Exit: <b>${exit}</b>`,
    ``,
    `<b>${params.pnl >= 0 ? "💰" : "💸"} P&L: ${pnlStr} USDT</b>`,
    `💼 New balance: <b>$${params.newBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}</b>`,
    ``,
    `<code>${params.tradeId.slice(0, 8)}</code>`,
  ];

  await send(lines.join("\n"));
}

export async function notifyTickSkipped(params: {
  asset:    string;
  reason:   string;
  detail:   string;
  candles:  number;
  mlLoaded: boolean;
  time:     string;
}): Promise<void> {
  const asset = params.asset === "GOLD" ? "🥇 GOLD" : "💶 EUR/USD";
  const lines = [
    `<b>🤖 AlphaBot — No Trade</b>  <code>${params.time}</code>`,
    ``,
    `📌 Asset scanned: <b>${asset}</b>`,
    `⛔ Reason: <b>${params.reason}</b>`,
    `   ${params.detail}`,
    ``,
    `📊 Candles: <b>${params.candles}</b>  |  Model: <b>${params.mlLoaded ? "✅ loaded" : "⏳ not loaded yet"}</b>`,
  ];
  await send(lines.join("\n"));
}

export async function notifySessionSummary(params: {
  wins:       number;
  losses:     number;
  winRate:    number;
  totalPnl:   number;
  balance:    number;
  hours:      number;
}): Promise<void> {
  const trend = params.totalPnl >= 0 ? "📈" : "📉";
  const lines = [
    `<b>🤖 AlphaBot — ${params.hours}h Session Summary</b>`,
    ``,
    `✅ Wins:   <b>${params.wins}</b>`,
    `❌ Losses: <b>${params.losses}</b>`,
    `🎯 Win Rate: <b>${params.winRate}%</b>`,
    ``,
    `${trend} Total P&L: <b>${params.totalPnl >= 0 ? "+" : ""}$${params.totalPnl.toFixed(2)} USDT</b>`,
    `💼 Balance: <b>$${params.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}</b>`,
  ];
  await send(lines.join("\n"));
}
