import WebSocket from "ws";
import { pool } from "@workspace/db";
import {
  extractFeatures, trainModel, saveModel,
  mlPredict, NUM_FEATURES, MLModelWeights,
  ensureCandleCache, getLatestCachedEpoch,
  loadCandleCache, upsertCandleCache,
  loadFeedbackTrainingData,
} from "./ml-signal.js";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Candle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MartingaleStat {
  grossPnl: number;
  maxDrawdown: number;
  maxStakeUsed: number;
  longestLossStreak: number;
  monthly: MonthlyStat[];
  equity: EquityPoint[];
}

export interface EnhancedStat {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossPnl: number;
  maxDrawdown: number;
  maxStakeUsed: number;   // paroli max
  longestLossStreak: number;
  monthly: MonthlyStat[];
  equity: EquityPoint[];
}

export interface MLStat {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossPnl: number;
  maxDrawdown: number;
  trainAccuracy: number;
  testAccuracy: number;
  trainSamples: number;
  testTrades: number;
  threshold: number;
  feedbackCount: number;   // live trades mixed into training
  monthly: MonthlyStat[];
  equity: EquityPoint[];
  overfit: boolean;
}

export interface AssetBacktestResult {
  asset: string;
  totalCandles: number;
  signalsFired: number;
  newsFiltered: number;
  spikeFiltered: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossPnl: number;
  maxDrawdown: number;
  byHour: HourStat[];
  byConfidence: ConfStat[];
  monthly: MonthlyStat[];
  equity: EquityPoint[];
  martingale: MartingaleStat;
  enhanced: EnhancedStat;
  ml: MLStat;
  mlModel: MLModelWeights;
}

interface HourStat   { hour: number; trades: number; wins: number; winRate: number; }
interface ConfStat   { range: string; trades: number; wins: number; winRate: number; }
interface MonthlyStat{ month: string; trades: number; wins: number; losses: number; pnl: number; }
interface EquityPoint{ epoch: number; balance: number; }

// ── News / high-impact event windows (UTC minutes since midnight) ─────────────
// Covers NFP, CPI, PPI, Retail Sales (13:30 UTC), ECB (12:45 UTC), BOE (12:00 UTC)
const NEWS_WINDOWS: Array<[number, number]> = [
  [13 * 60 + 20, 14 * 60 + 10],
  [12 * 60 + 40, 13 * 60 +  5],
  [11 * 60 + 55, 12 * 60 + 25],
  [ 6 * 60 + 55,  7 * 60 + 15],
  [20 * 60 + 55, 21 * 60 + 15],
];

function isNewsTime(epochSec: number): boolean {
  const d = new Date(epochSec * 1000);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return NEWS_WINDOWS.some(([s, e]) => mins >= s && mins <= e);
}

function isVolatilitySpike(candles: Candle[], i: number): boolean {
  const lookback = 20;
  if (i < lookback + 3) return false;
  const ranges  = candles.slice(i - lookback, i).map(c => c.high - c.low);
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  if (avgRange === 0) return false;
  for (let j = Math.max(0, i - 3); j <= Math.min(candles.length - 1, i + 3); j++) {
    if ((candles[j].high - candles[j].low) > avgRange * 3) return true;
  }
  return false;
}

// ── Deriv WS helpers ──────────────────────────────────────────────────────────
// ticks_history uses the old public Deriv WS (ws.derivws.com) with a numeric
// app_id — completely separate from the newer REST trading API.
// Use DERIV_APP_ID from env if set; fall back to the public demo id 1089.
const DERIV_APP_ID   = process.env.DERIV_APP_ID ?? "1089";
const DERIV_LEGACY_WS = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

function fetchCandlePage(symbol: string, endEpoch: number): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_LEGACY_WS);
    const timer = setTimeout(() => {
      ws.terminate();
      const err = new Error(`WS timeout fetching ${symbol} at epoch ${endEpoch}`);
      console.error("[backtest] fetchCandlePage timeout:", err.message);
      reject(err);
    }, 35000);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        ticks_history: symbol,
        style: "candles",
        granularity: 300,   // 5-min candles — matches binary options expiry
        count: 5000,
        end: endEpoch,
        req_id: 1,
      }));
    });

    ws.on("message", (data) => {
      clearTimeout(timer);
      ws.terminate();
      try {
        const msg = JSON.parse(data.toString()) as {
          error?: { code?: string; message: string };
          candles?: Array<{ epoch: number; open: string; high: string; low: string; close: string }>;
        };
        if (msg.error) {
          const err = new Error(`Deriv error [${msg.error.code ?? "?"}]: ${msg.error.message}`);
          console.error("[backtest] fetchCandlePage Deriv error:", err.message, "symbol:", symbol, "endEpoch:", endEpoch);
          reject(err);
          return;
        }
        const candles: Candle[] = (msg.candles ?? []).map(c => ({
          epoch: c.epoch,
          open:  parseFloat(c.open),
          high:  parseFloat(c.high),
          low:   parseFloat(c.low),
          close: parseFloat(c.close),
        }));
        console.log(`[backtest] fetchCandlePage ${symbol}: received ${candles.length} candles, endEpoch=${endEpoch}`);
        resolve(candles);
      } catch (e) {
        console.error("[backtest] fetchCandlePage parse error:", e);
        reject(e);
      }
    });

    ws.on("error", e => {
      clearTimeout(timer);
      console.error("[backtest] fetchCandlePage WS error:", e.message, "symbol:", symbol);
      reject(e);
    });
  });
}

async function fetchAllCandles(symbol: string, months: number): Promise<Candle[]> {
  const cutoffEpoch = Math.floor(Date.now() / 1000) - months * 30 * 24 * 3600;
  const nowEpoch    = Math.floor(Date.now() / 1000);

  // ── Step 1: load from cache ──────────────────────────────────────────────────
  await ensureCandleCache();
  const latestCached = await getLatestCachedEpoch(symbol);
  const cached = latestCached >= cutoffEpoch
    ? (await loadCandleCache(symbol, cutoffEpoch)) as Candle[]
    : [];

  // ── Step 2: decide what to fetch from Deriv ──────────────────────────────────
  // If cache covers the full range and is recent (< 2 h old), no new fetch needed
  const cacheIsFresh = latestCached > nowEpoch - 7_200;
  const cacheCovers  = cached.length > 0 && cached[0].epoch <= cutoffEpoch + 3600;
  if (cacheIsFresh && cacheCovers) return cached;

  // ── Step 3: fetch pages from the earliest gap to now ─────────────────────────
  // Start from current time, page back until we reach cutoffEpoch or latestCached
  const fetchCutoff  = cacheCovers ? (latestCached || cutoffEpoch) : cutoffEpoch;
  const MAX_ITER     = 130;   // 130 × 5 000 = 650 000 candles — covers 5+ years
  let   endEpoch     = nowEpoch;
  const pages: Candle[][] = [];

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let page: Candle[];
    try {
      page = await fetchCandlePage(symbol, endEpoch);
    } catch (e) {
      // WrongResponse means Deriv has no more data for this symbol at this epoch
      // (common for EURUSD going beyond ~18 months). Keep whatever we collected.
      console.log(`[backtest] fetchAllCandles ${symbol}: stopping at iter ${iter} — ${String(e).substring(0, 120)}`);
      break;
    }
    if (page.length === 0) break;
    const newCandles = cacheCovers
      ? page.filter(c => c.epoch > latestCached)
      : page;
    if (newCandles.length > 0) pages.unshift(newCandles);
    const earliest = page[0].epoch;
    if (earliest <= fetchCutoff) break;
    endEpoch = earliest - 1;
    await new Promise(r => setTimeout(r, 400));
  }

  const fresh = pages.flat();
  if (fresh.length > 0) {
    // Persist to cache (fire-and-forget to not block the backtest)
    upsertCandleCache(symbol, fresh).catch(() => {/* non-critical */});
  }

  // ── Step 4: merge cached + fresh, deduplicate, sort ─────────────────────────
  const epochSet = new Set<number>();
  const merged: Candle[] = [];
  for (const c of [...cached, ...fresh]) {
    if (!epochSet.has(c.epoch)) { epochSet.add(c.epoch); merged.push(c); }
  }
  merged.sort((a, b) => a.epoch - b.epoch);
  return merged.filter(c => c.epoch >= cutoffEpoch);
}

// ── Signal engine ─────────────────────────────────────────────────────────────
function ema(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let e = prices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
  return e;
}

function rsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  return 100 - 100 / (1 + rs);
}

function bollingerPosition(prices: number[], period = 20): number {
  const slice = prices.slice(-period);
  if (slice.length < period) return 0.5;
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const sd   = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  if (sd === 0) return 0.5;
  const cur = prices[prices.length - 1];
  return Math.min(1, Math.max(0, (cur - (mean - 2 * sd)) / (4 * sd)));
}

// ── Legacy signal (Standard strategy — kept for comparison) ───────────────────
function computeSignal(prices: number[]): { direction: "UP" | "DOWN"; confidence: number } | null {
  if (prices.length < 30) return null;
  const fast   = ema(prices, 9);
  const slow   = ema(prices, 21);
  const rsiVal = rsi(prices);
  const bbPos  = bollingerPosition(prices);
  const cur    = prices[prices.length - 1];
  const prev   = prices[prices.length - 2];

  const emaDiff  = (fast - slow) / slow * 100;
  const trendUp  = fast > slow;
  const momentum = (cur - prev) / prev * 100;

  let confidence = 50;
  let direction: "UP" | "DOWN";

  if (trendUp) {
    direction = "UP";
    confidence += Math.min(15, Math.abs(emaDiff) * 50);
    if (rsiVal < 70 && rsiVal > 40) confidence += 12;
    if (bbPos < 0.6)  confidence += 8;
    if (momentum > 0) confidence += 5;
    if (rsiVal > 75)  confidence -= 20;
  } else {
    direction = "DOWN";
    confidence += Math.min(15, Math.abs(emaDiff) * 50);
    if (rsiVal > 30 && rsiVal < 60) confidence += 12;
    if (bbPos > 0.4)  confidence += 8;
    if (momentum < 0) confidence += 5;
    if (rsiVal < 25)  confidence -= 20;
  }

  confidence = Math.min(95, Math.max(10, confidence));
  return { direction, confidence };
}

// ── Enhanced signal (EMA triple-stack + tight RSI + BB pullback) ──────────────
// Hard gates — ALL must pass:
//   1. EMA9 > EMA21 > EMA50 (UP) or EMA9 < EMA21 < EMA50 (DOWN) — trend alignment
//   2. |EMA9 − EMA50| / EMA50 > 0.05% — trend must have real separation
//   3. RSI 40–60 — deep neutral zone only (tighter than standard 38–62)
//   4. BB pullback entry: UP → price below mid-band; DOWN → price above mid-band
//      (enter on trend pullback to BB mid, not breakout continuation)
// Paroli staking: $1 → $2 → $4, reset on any loss
function computeEnhancedSignal(
  prices: number[],
): { direction: "UP" | "DOWN"; confidence: number } | null {
  if (prices.length < 55) return null;

  const fast = ema(prices, 9);
  const mid  = ema(prices, 21);
  const slow = ema(prices, 50);

  // Gate 1: strict triple-stack alignment
  const stackUp   = fast > mid && mid > slow;
  const stackDown = fast < mid && mid < slow;
  if (!stackUp && !stackDown) return null;

  const direction: "UP" | "DOWN" = stackUp ? "UP" : "DOWN";

  // Gate 2: minimum trend divergence
  const divergencePct = Math.abs(fast - slow) / slow * 100;
  if (divergencePct < 0.05) return null;

  // Gate 3: tighter RSI neutral zone (40–60 only)
  const rsiVal = rsi(prices);
  if (rsiVal < 40 || rsiVal > 60) return null;

  // Gate 4: BB pullback — enter when price has pulled back toward mid-band
  // (mean-reversion within trend — opposite of candle continuation)
  const bbPos = bollingerPosition(prices);
  if (direction === "UP"   && bbPos > 0.55) return null; // price too high — chasing
  if (direction === "DOWN" && bbPos < 0.45) return null; // price too low — chasing

  // Confidence — base 65 (heavily filtered by all 4 gates)
  let confidence = 65;
  confidence += Math.min(20, divergencePct * 200);          // EMA spread quality
  if (rsiVal >= 44 && rsiVal <= 56) confidence += 10;       // RSI deep neutral bonus
  if (direction === "UP"   && bbPos < 0.45) confidence += 8; // deep pullback bonus
  if (direction === "DOWN" && bbPos > 0.55) confidence += 8;

  confidence = Math.min(95, Math.max(65, confidence));
  return { direction, confidence };
}

// ── Per-asset backtest (standard + martingale + enhanced/paroli in one pass) ──
async function runAssetBacktest(candles: Candle[], asset: string): Promise<AssetBacktestResult> {
  const BASE_STAKE   = 1;
  const MAX_STAKE    = 128;  // 1→2→4→8→16→32→64→128 (7 doublings)
  const PAYOUT_RATIO = 1.85;
  const THRESHOLD    = 85;   // 85%+ — selective quality trades only
  const WINDOW       = 200;

  // ── Standard state ─────────────────────────────────────────────────────────
  let signalsFired = 0, newsFiltered = 0, spikeFiltered = 0;
  let wins = 0, losses = 0, balance = 0, peak = 0, maxDrawdown = 0;
  const hourMap:  Record<number, { wins: number; losses: number }> = {};
  const confMap:  Record<string, { wins: number; losses: number }> = {
    "75–79": { wins: 0, losses: 0 },
    "80–84": { wins: 0, losses: 0 },
    "85–89": { wins: 0, losses: 0 },
    "90+":   { wins: 0, losses: 0 },
  };
  const monthMap: Record<string, { wins: number; losses: number; pnl: number }> = {};
  const equity:   EquityPoint[] = [];

  // ── Martingale state ───────────────────────────────────────────────────────
  let mgBalance = 0, mgPeak = 0, mgMaxDD = 0;
  let mgStake = BASE_STAKE, mgStreak = 0, mgMaxStreak = 0, mgMaxStakeUsed = BASE_STAKE;
  const mgMonthMap: Record<string, { wins: number; losses: number; pnl: number }> = {};
  const mgEquity:   EquityPoint[] = [];

  // ── Enhanced + Paroli state ────────────────────────────────────────────────
  // Paroli: 3-step positive progression  $1 → $2 → $4, reset on loss or after step 3 win
  const PAROLI_STEPS = [1, 2, 4];
  let enWins = 0, enLosses = 0, enBalance = 0, enPeak = 0, enMaxDD = 0;
  let enParoliStep = 0, enMaxStakeUsed = 1, enLossStreak = 0, enMaxLossStreak = 0;
  const enMonthMap: Record<string, { wins: number; losses: number; pnl: number }> = {};
  const enEquity:   EquityPoint[] = [];

  // ── ML data collection (all candles, no signal filter) ───────────────────
  // The model learns to predict next-candle direction from 16 features.
  // We collect ALL valid (feature, label) pairs, then split 70/30 chronologically.
  const mlX: number[][] = [];
  const mlY: number[]   = [];
  const mlEpochs: number[] = [];  // store candle epoch for later simulation

  for (let i = 55; i < candles.length - 1; i++) {
    const c    = candles[i];
    const next = candles[i + 1];

    if (isNewsTime(c.epoch))           { newsFiltered++;  continue; }
    if (isVolatilitySpike(candles, i)) { spikeFiltered++; continue; }

    // ── Collect ML training data (every valid candle) ─────────────────────────
    const feats = extractFeatures(candles, i);
    if (feats) {
      mlX.push(feats);
      mlY.push(next.close > next.open ? 1 : 0);
      mlEpochs.push(c.epoch);
    }

    const window = candles.slice(Math.max(0, i - WINDOW), i + 1).map(x => x.close);

    // ── Standard signal ───────────────────────────────────────────────────────
    const sig = computeSignal(window);
    if (sig && sig.confidence >= THRESHOLD) {
      signalsFired++;
      const won    = sig.direction === "UP" ? next.close > next.open : next.close < next.open;
      const stdPnl = won ? BASE_STAKE * (PAYOUT_RATIO - 1) : -BASE_STAKE;

      balance += stdPnl;
      if (won) wins++; else losses++;
      if (balance > peak) peak = balance;
      const dd = peak - balance;
      if (dd > maxDrawdown) maxDrawdown = dd;

      const hour = new Date(c.epoch * 1000).getUTCHours();
      if (!hourMap[hour]) hourMap[hour] = { wins: 0, losses: 0 };
      if (won) hourMap[hour].wins++; else hourMap[hour].losses++;

      const ck = sig.confidence >= 90 ? "90+" : sig.confidence >= 85 ? "85–89" : sig.confidence >= 80 ? "80–84" : "75–79";
      if (won) confMap[ck].wins++; else confMap[ck].losses++;

      const dObj = new Date(c.epoch * 1000);
      const mk   = `${dObj.getUTCFullYear()}-${String(dObj.getUTCMonth() + 1).padStart(2, "0")}`;
      if (!monthMap[mk]) monthMap[mk] = { wins: 0, losses: 0, pnl: 0 };
      monthMap[mk].pnl += stdPnl;
      if (won) monthMap[mk].wins++; else monthMap[mk].losses++;

      const total = wins + losses;
      if (total % 10 === 0) equity.push({ epoch: c.epoch, balance: Math.round(balance * 100) / 100 });

      // ── Martingale (same signal, different stake) ──────────────────────────
      if (mgStake > mgMaxStakeUsed) mgMaxStakeUsed = mgStake;
      const mgPnl = won ? mgStake * (PAYOUT_RATIO - 1) : -mgStake;
      mgBalance += mgPnl;

      const mk2 = `${new Date(c.epoch * 1000).getUTCFullYear()}-${String(new Date(c.epoch * 1000).getUTCMonth() + 1).padStart(2, "0")}`;
      if (!mgMonthMap[mk2]) mgMonthMap[mk2] = { wins: 0, losses: 0, pnl: 0 };
      mgMonthMap[mk2].pnl += mgPnl;
      if (won) mgMonthMap[mk2].wins++; else mgMonthMap[mk2].losses++;

      if (won) { mgStake = BASE_STAKE; mgStreak = 0; }
      else {
        mgStreak++;
        if (mgStreak > mgMaxStreak) mgMaxStreak = mgStreak;
        mgStake = Math.min(mgStake * 2, MAX_STAKE);
      }
      if (mgBalance > mgPeak) mgPeak = mgBalance;
      const mgDD = mgPeak - mgBalance;
      if (mgDD > mgMaxDD) mgMaxDD = mgDD;
      if (total % 10 === 0) mgEquity.push({ epoch: c.epoch, balance: Math.round(mgBalance * 100) / 100 });
    }

    // ── Enhanced signal (independent gate — different filter) ─────────────────
    const eSig = computeEnhancedSignal(window);
    if (eSig && eSig.confidence >= THRESHOLD) {
      const won   = eSig.direction === "UP" ? next.close > next.open : next.close < next.open;
      const stake = PAROLI_STEPS[Math.min(enParoliStep, PAROLI_STEPS.length - 1)];
      if (stake > enMaxStakeUsed) enMaxStakeUsed = stake;
      const ePnl  = won ? stake * (PAYOUT_RATIO - 1) : -stake;

      enBalance += ePnl;
      if (won) {
        enWins++;
        enLossStreak = 0;
        // advance paroli step (reset after step 2 = $20)
        enParoliStep = enParoliStep >= PAROLI_STEPS.length - 1 ? 0 : enParoliStep + 1;
      } else {
        enLosses++;
        enLossStreak++;
        if (enLossStreak > enMaxLossStreak) enMaxLossStreak = enLossStreak;
        enParoliStep = 0;
      }

      if (enBalance > enPeak) enPeak = enBalance;
      const enDD = enPeak - enBalance;
      if (enDD > enMaxDD) enMaxDD = enDD;

      const dObj = new Date(c.epoch * 1000);
      const mk   = `${dObj.getUTCFullYear()}-${String(dObj.getUTCMonth() + 1).padStart(2, "0")}`;
      if (!enMonthMap[mk]) enMonthMap[mk] = { wins: 0, losses: 0, pnl: 0 };
      enMonthMap[mk].pnl += ePnl;
      if (won) enMonthMap[mk].wins++; else enMonthMap[mk].losses++;

      const enTotal = enWins + enLosses;
      if (enTotal % 10 === 0) enEquity.push({ epoch: c.epoch, balance: Math.round(enBalance * 100) / 100 });
    }
  }

  const totalTrades = wins + losses;
  const enTotal     = enWins + enLosses;

  // ── ML: train on first 70% + live feedback, simulate on last 30% ─────────────
  const splitIdx   = Math.floor(mlX.length * 0.7);
  const baseTrainX = mlX.slice(0, splitIdx);
  const baseTrainY = mlY.slice(0, splitIdx);
  const testX      = mlX.slice(splitIdx);
  const testY      = mlY.slice(splitIdx);
  const testEpochs = mlEpochs.slice(splitIdx);

  // Load live feedback — wrong predictions get 3× weight so model corrects mistakes
  const feedback = await loadFeedbackTrainingData(asset, 3);
  const trainX   = [...baseTrainX, ...feedback.X];
  const trainY   = [...baseTrainY, ...feedback.Y];

  const mlModel = await trainModel(trainX, trainY, testX, testY, asset);

  // Save to DB (fire-and-forget — don't block the return)
  saveModel(mlModel).catch(() => {/* non-blocking */});

  // Simulate ML trades on the held-out test set
  let mlWins = 0, mlLosses = 0, mlBal = 0, mlPeak = 0, mlMaxDD = 0;
  const mlMonthMap: Record<string, { wins: number; losses: number; pnl: number }> = {};
  const mlEquity:   EquityPoint[] = [];

  for (let ti = 0; ti < testX.length; ti++) {
    const prob = mlPredict(testX[ti], mlModel.weights, mlModel.bias);
    let direction: "UP" | "DOWN" | null = null;
    if (prob > mlModel.threshold)         direction = "UP";
    else if (prob < 1 - mlModel.threshold) direction = "DOWN";
    if (!direction) continue;

    const actualUp = testY[ti] === 1;
    const won      = direction === "UP" ? actualUp : !actualUp;
    const pnl      = won ? BASE_STAKE * (PAYOUT_RATIO - 1) : -BASE_STAKE;
    mlBal += pnl;
    if (won) mlWins++; else mlLosses++;
    if (mlBal > mlPeak) mlPeak = mlBal;
    const dd = mlPeak - mlBal;
    if (dd > mlMaxDD) mlMaxDD = dd;

    const ep   = testEpochs[ti];
    const dObj = new Date(ep * 1000);
    const mk   = `${dObj.getUTCFullYear()}-${String(dObj.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!mlMonthMap[mk]) mlMonthMap[mk] = { wins: 0, losses: 0, pnl: 0 };
    mlMonthMap[mk].pnl += pnl;
    if (won) mlMonthMap[mk].wins++; else mlMonthMap[mk].losses++;

    const mlTotal = mlWins + mlLosses;
    if (mlTotal % 10 === 0) mlEquity.push({ epoch: ep, balance: Math.round(mlBal * 100) / 100 });
  }

  const mlTotal = mlWins + mlLosses;
  const mlStat: MLStat = {
    trades:        mlTotal,
    wins:          mlWins,
    losses:        mlLosses,
    winRate:       mlTotal > 0 ? Math.round(mlWins / mlTotal * 100) : 0,
    grossPnl:      Math.round(mlBal * 100) / 100,
    maxDrawdown:   Math.round(mlMaxDD * 100) / 100,
    trainAccuracy: Math.round(mlModel.accuracy     * 10000) / 100,
    testAccuracy:  Math.round(mlModel.testAccuracy * 10000) / 100,
    trainSamples:  trainX.length,
    testTrades:    mlTotal,
    threshold:     mlModel.threshold,
    feedbackCount: feedback.count,
    monthly:       Object.entries(mlMonthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month, trades: v.wins + v.losses, wins: v.wins, losses: v.losses,
        pnl: Math.round(v.pnl * 100) / 100,
      })),
    equity:   mlEquity,
    overfit:  mlModel.accuracy - mlModel.testAccuracy > 0.04,
  };

  return {
    asset,
    totalCandles: candles.length,
    signalsFired,
    newsFiltered,
    spikeFiltered,
    trades: totalTrades,
    wins,
    losses,
    winRate: totalTrades > 0 ? Math.round(wins / totalTrades * 100) : 0,
    grossPnl: Math.round(balance * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    byHour: Object.entries(hourMap)
      .map(([h, v]) => ({
        hour: parseInt(h), trades: v.wins + v.losses, wins: v.wins,
        winRate: v.wins + v.losses > 0 ? Math.round(v.wins / (v.wins + v.losses) * 100) : 0,
      }))
      .sort((a, b) => a.hour - b.hour),
    byConfidence: Object.entries(confMap).map(([range, v]) => ({
      range, trades: v.wins + v.losses, wins: v.wins,
      winRate: v.wins + v.losses > 0 ? Math.round(v.wins / (v.wins + v.losses) * 100) : 0,
    })),
    monthly: Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month, trades: v.wins + v.losses, wins: v.wins, losses: v.losses,
        pnl: Math.round(v.pnl * 100) / 100,
      })),
    equity,
    martingale: {
      grossPnl:          Math.round(mgBalance * 100) / 100,
      maxDrawdown:       Math.round(mgMaxDD * 100) / 100,
      maxStakeUsed:      mgMaxStakeUsed,
      longestLossStreak: mgMaxStreak,
      monthly: Object.entries(mgMonthMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({
          month, trades: v.wins + v.losses, wins: v.wins, losses: v.losses,
          pnl: Math.round(v.pnl * 100) / 100,
        })),
      equity: mgEquity,
    },
    enhanced: {
      trades:            enTotal,
      wins:              enWins,
      losses:            enLosses,
      winRate:           enTotal > 0 ? Math.round(enWins / enTotal * 100) : 0,
      grossPnl:          Math.round(enBalance * 100) / 100,
      maxDrawdown:       Math.round(enMaxDD * 100) / 100,
      maxStakeUsed:      enMaxStakeUsed,
      longestLossStreak: enMaxLossStreak,
      monthly: Object.entries(enMonthMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({
          month, trades: v.wins + v.losses, wins: v.wins, losses: v.losses,
          pnl: Math.round(v.pnl * 100) / 100,
        })),
      equity: enEquity,
    },
    ml:      mlStat,
    mlModel: mlModel,
  };
}

// ── Historical Pre-Train ───────────────────────────────────────────────────────
// Loads cached candles and trains the ML model on ALL valid candles (not just
// signal-fired ones) — giving the model thousands of labeled examples instead
// of a handful of live trades.  Cached data makes this fast (no download needed
// as long as a backtest has been run at least once).
const ASSET_SYMBOL_MAP: Record<string, string> = {
  GOLD: "frxXAUUSD",
  EURUSD: "frxEURUSD",
};

export interface PretrainResult {
  asset:         string;
  candleCount:   number;
  trainSamples:  number;
  trainAccuracy: number;
  testAccuracy:  number;
  threshold:     number;
  feedbackCount: number;
  skipped:       boolean;  // true when cache is empty — run a backtest first
  skipReason?:   string;
}

export async function historicalPretrain(
  asset: string,
  months = 12,
): Promise<PretrainResult> {
  const symbol      = ASSET_SYMBOL_MAP[asset];
  if (!symbol) throw new Error(`Unknown asset: ${asset}`);
  const cutoffEpoch = Math.floor(Date.now() / 1000) - months * 30 * 24 * 3600;

  await ensureCandleCache();
  const candles = (await loadCandleCache(symbol, cutoffEpoch)) as Candle[];

  if (candles.length < 200) {
    return {
      asset, candleCount: candles.length, trainSamples: 0,
      trainAccuracy: 0, testAccuracy: 0, threshold: 0.55,
      feedbackCount: 0, skipped: true,
      skipReason: `Only ${candles.length} cached candles — run a full backtest first to download historical data.`,
    };
  }

  // ── Build (features, label) for EVERY valid candle ─────────────────────────
  const mlX: number[][] = [];
  const mlY: number[]   = [];
  for (let i = 65; i < candles.length - 1; i++) {
    const c    = candles[i];
    const next = candles[i + 1];
    if (isNewsTime(c.epoch))           continue;
    if (isVolatilitySpike(candles, i)) continue;
    const feats = extractFeatures(candles, i);
    if (!feats) continue;
    mlX.push(feats);
    mlY.push(next.close > next.open ? 1 : 0);
  }

  if (mlX.length < 200) {
    return {
      asset, candleCount: candles.length, trainSamples: 0,
      trainAccuracy: 0, testAccuracy: 0, threshold: 0.55,
      feedbackCount: 0, skipped: true,
      skipReason: `Not enough valid feature rows (${mlX.length}) — need at least 200.`,
    };
  }

  // ── Chronological 70/30 split ───────────────────────────────────────────────
  const splitIdx  = Math.floor(mlX.length * 0.7);
  const baseTrainX = mlX.slice(0, splitIdx);
  const baseTrainY = mlY.slice(0, splitIdx);
  const testX      = mlX.slice(splitIdx);
  const testY      = mlY.slice(splitIdx);

  // ── Mix in live feedback with 3× mistake boost ─────────────────────────────
  const feedback   = await loadFeedbackTrainingData(asset, 3);
  const trainX     = [...baseTrainX, ...feedback.X];
  const trainY     = [...baseTrainY, ...feedback.Y];

  const model = await trainModel(trainX, trainY, testX, testY, asset);
  await saveModel(model);

  return {
    asset,
    candleCount:   candles.length,
    trainSamples:  trainX.length,
    trainAccuracy: Math.round(model.accuracy     * 10000) / 100,
    testAccuracy:  Math.round(model.testAccuracy * 10000) / 100,
    threshold:     model.threshold,
    feedbackCount: feedback.count,
    skipped:       false,
  };
}

// ── DB schema ─────────────────────────────────────────────────────────────────
export async function ensureBacktestTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status      TEXT NOT NULL DEFAULT 'running',
      months      INT  NOT NULL DEFAULT 6,
      progress    INT  NOT NULL DEFAULT 0,
      message     TEXT,
      results     JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS backtest_runs_created ON backtest_runs(created_at DESC);
  `);
}

// ── Public entry-point ────────────────────────────────────────────────────────
export async function startBacktest(months: number): Promise<string> {
  await ensureBacktestTable();
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO backtest_runs (months) VALUES ($1) RETURNING id", [months]
  );
  const runId = rows[0].id;
  runBacktestJob(runId, months).catch(async err => {
    await pool.query(
      "UPDATE backtest_runs SET status='error', message=$2, finished_at=NOW() WHERE id=$1",
      [runId, String(err)]
    );
  });
  return runId;
}

async function updateProgress(runId: string, progress: number, message: string) {
  await pool.query(
    "UPDATE backtest_runs SET progress=$2, message=$3 WHERE id=$1",
    [runId, progress, message]
  );
}

async function runBacktestJob(runId: string, months: number) {
  // ── Fetch both assets in parallel (halves download time) ────────────────────
  await updateProgress(runId, 5,
    months >= 48
      ? `Fetching ${months / 12} years of data for both assets in parallel — first 5-year run will download ~500 k candles and cache them; subsequent runs pull only new candles and finish in seconds…`
      : `Fetching ${months} months of historical data for both assets…`
  );

  const [[goldCandles, goldErr], [eurusdCandles, eurusdErr]] = await Promise.all([
    fetchAllCandles("frxXAUUSD", months).then(c => [c, null] as const).catch(e => [[] as Candle[], String(e)] as const),
    fetchAllCandles("frxEURUSD", months).then(c => [c, null] as const).catch(e => [[] as Candle[], String(e)] as const),
  ]);

  if (goldErr)   console.error("[backtest] GOLD fetch failed:", goldErr);
  if (eurusdErr) console.error("[backtest] EURUSD fetch failed:", eurusdErr);

  // Fail fast — if both fetches returned 0 candles, nothing to train on
  if (goldCandles.length === 0 && eurusdCandles.length === 0) {
    const errMsg = [goldErr, eurusdErr].filter(Boolean).join(" | ") || "Deriv returned 0 candles for both assets";
    console.error("[backtest] Aborting — 0 candles received. Error:", errMsg);
    await pool.query(
      "UPDATE backtest_runs SET status='error', progress=30, message=$2, finished_at=NOW() WHERE id=$1",
      [runId, `Candle fetch failed: ${errMsg}`]
    );
    return;
  }

  if (goldErr)   await updateProgress(runId, 30, `GOLD fetch error: ${goldErr}`);
  if (eurusdErr) await updateProgress(runId, 30, `EURUSD fetch error: ${eurusdErr}`);

  await updateProgress(runId, 50,
    `Training AI + simulating (${goldCandles.length.toLocaleString()} GOLD + ${eurusdCandles.length.toLocaleString()} EURUSD candles)…`
  );

  // ── Run simulations in parallel as well ─────────────────────────────────────
  const [goldResult, eurusdResult] = await Promise.all([
    runAssetBacktest(goldCandles,   "GOLD"),
    runAssetBacktest(eurusdCandles, "EURUSD"),
  ]);

  const assetResults: AssetBacktestResult[] = [goldResult, eurusdResult];

  const combined = {
    trades:       assetResults.reduce((s, r) => s + r.trades, 0),
    wins:         assetResults.reduce((s, r) => s + r.wins, 0),
    losses:       assetResults.reduce((s, r) => s + r.losses, 0),
    grossPnl:     Math.round(assetResults.reduce((s, r) => s + r.grossPnl, 0) * 100) / 100,
    maxDrawdown:  Math.max(...assetResults.map(r => r.maxDrawdown)),
    newsFiltered: assetResults.reduce((s, r) => s + r.newsFiltered, 0),
    spikeFiltered:assetResults.reduce((s, r) => s + r.spikeFiltered, 0),
    signalsFired: assetResults.reduce((s, r) => s + r.signalsFired, 0),
    martingale: {
      grossPnl:          Math.round(assetResults.reduce((s, r) => s + r.martingale.grossPnl, 0) * 100) / 100,
      maxDrawdown:       Math.max(...assetResults.map(r => r.martingale.maxDrawdown)),
      maxStakeUsed:      Math.max(...assetResults.map(r => r.martingale.maxStakeUsed)),
      longestLossStreak: Math.max(...assetResults.map(r => r.martingale.longestLossStreak)),
    },
    enhanced: {
      trades:            assetResults.reduce((s, r) => s + r.enhanced.trades, 0),
      wins:              assetResults.reduce((s, r) => s + r.enhanced.wins, 0),
      losses:            assetResults.reduce((s, r) => s + r.enhanced.losses, 0),
      grossPnl:          Math.round(assetResults.reduce((s, r) => s + r.enhanced.grossPnl, 0) * 100) / 100,
      maxDrawdown:       Math.max(...assetResults.map(r => r.enhanced.maxDrawdown)),
      maxStakeUsed:      Math.max(...assetResults.map(r => r.enhanced.maxStakeUsed)),
      longestLossStreak: Math.max(...assetResults.map(r => r.enhanced.longestLossStreak)),
      winRate:           0,
    },
    ml: {
      trades:        assetResults.reduce((s, r) => s + r.ml.trades, 0),
      wins:          assetResults.reduce((s, r) => s + r.ml.wins, 0),
      losses:        assetResults.reduce((s, r) => s + r.ml.losses, 0),
      grossPnl:      Math.round(assetResults.reduce((s, r) => s + r.ml.grossPnl, 0) * 100) / 100,
      maxDrawdown:   Math.max(...assetResults.map(r => r.ml.maxDrawdown)),
      trainAccuracy: Math.round(assetResults.reduce((s, r) => s + r.ml.trainAccuracy, 0) / assetResults.length * 10) / 10,
      testAccuracy:  Math.round(assetResults.reduce((s, r) => s + r.ml.testAccuracy,  0) / assetResults.length * 10) / 10,
      trainSamples:  assetResults.reduce((s, r) => s + r.ml.trainSamples, 0),
      testTrades:    assetResults.reduce((s, r) => s + r.ml.testTrades, 0),
      threshold:     Math.round(assetResults.reduce((s, r) => s + r.ml.threshold, 0) / assetResults.length * 100) / 100,
      overfit:       assetResults.some(r => r.ml.overfit),
      feedbackCount: assetResults.reduce((s, r) => s + r.ml.feedbackCount, 0),
      winRate:       0,
    },
  };
  combined.enhanced.winRate = combined.enhanced.trades > 0
    ? Math.round(combined.enhanced.wins / combined.enhanced.trades * 100) : 0;
  combined.ml.winRate = combined.ml.trades > 0
    ? Math.round(combined.ml.wins / combined.ml.trades * 100) : 0;
  const combinedWinRate = combined.trades > 0
    ? Math.round(combined.wins / combined.trades * 100) : 0;

  await pool.query(
    `UPDATE backtest_runs
     SET status='done', progress=100, message='Complete', results=$2, finished_at=NOW()
     WHERE id=$1`,
    [runId, JSON.stringify({ combined: { ...combined, winRate: combinedWinRate }, assets: assetResults })]
  );
}
