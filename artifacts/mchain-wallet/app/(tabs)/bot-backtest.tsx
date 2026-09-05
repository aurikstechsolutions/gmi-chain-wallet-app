import { Icon } from "@/components/Icon";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getPublicApiBase } from "@/services/api";

const D = {
  bg: "#0a0a0f", card: "#12121a", card2: "#1a1a26", border: "#2a2a3a",
  primary: "#6c63ff", green: "#00d97e", red: "#ff4560",
  yellow: "#ffc107", muted: "#888", text: "#f0f0f0", sub: "#aaa",
  orange: "#ff8c00", teal: "#00bcd4", gold: "#ffd700",
};

// ── Types ──────────────────────────────────────────────────────────────────────
interface MonthlyStat { month: string; trades: number; wins: number; losses: number; pnl: number; }
interface HourStat    { hour: number; trades: number; wins: number; winRate: number; }
interface ConfStat    { range: string; trades: number; wins: number; winRate: number; }
interface EquityPoint { epoch: number; balance: number; }
interface MartingaleStat {
  grossPnl: number; maxDrawdown: number; maxStakeUsed: number;
  longestLossStreak: number; monthly: MonthlyStat[]; equity: EquityPoint[];
}
interface EnhancedStat {
  trades: number; wins: number; losses: number; winRate: number;
  grossPnl: number; maxDrawdown: number; maxStakeUsed: number;
  longestLossStreak: number; monthly: MonthlyStat[]; equity: EquityPoint[];
}
interface MLStat {
  trades: number; wins: number; losses: number; winRate: number;
  grossPnl: number; maxDrawdown: number;
  trainAccuracy: number; testAccuracy: number;
  trainSamples: number; testTrades: number;
  threshold: number; overfit: boolean;
  feedbackCount: number;
  monthly: MonthlyStat[]; equity: EquityPoint[];
}
interface AssetResult {
  asset: string; totalCandles: number; signalsFired: number;
  newsFiltered: number; spikeFiltered: number; trades: number;
  wins: number; losses: number; winRate: number;
  grossPnl: number; maxDrawdown: number;
  byHour: HourStat[]; byConfidence: ConfStat[];
  monthly: MonthlyStat[]; equity: EquityPoint[];
  martingale: MartingaleStat;
  enhanced: EnhancedStat;
  ml: MLStat;
}
interface Combined {
  trades: number; wins: number; losses: number; winRate: number;
  grossPnl: number; maxDrawdown: number;
  newsFiltered: number; spikeFiltered: number; signalsFired: number;
  martingale: { grossPnl: number; maxDrawdown: number; maxStakeUsed: number; longestLossStreak: number; };
  enhanced:   { trades: number; wins: number; losses: number; winRate: number; grossPnl: number; maxDrawdown: number; maxStakeUsed: number; longestLossStreak: number; };
  ml: { trades: number; wins: number; losses: number; winRate: number; grossPnl: number; maxDrawdown: number; trainAccuracy: number; testAccuracy: number; trainSamples: number; testTrades: number; threshold: number; overfit: boolean; feedbackCount: number; };
}
interface BacktestRun {
  id: string; status: string; months: number;
  progress: number; message: string | null;
  results: { combined: Combined; assets: AssetResult[] } | null;
  createdAt: string; finishedAt: string | null;
}

// ── Equity spark line ──────────────────────────────────────────────────────────
function EquitySpark({ points, color, w = 100, h = 36 }: { points: EquityPoint[]; color: string; w?: number; h?: number }) {
  if (points.length < 2) return <View style={{ width: w, height: h }} />;
  const vals  = points.map(p => p.balance);
  const min   = Math.min(...vals);
  const max   = Math.max(...vals);
  const range = max - min || 1;
  const xs    = points.map((_, i) => (i / (points.length - 1)) * w);
  const ys    = vals.map(v => h - ((v - min) / range) * h);
  const d     = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const { Svg, Path } = require("react-native-svg") as typeof import("react-native-svg");
  return (
    <Svg width={w} height={h}>
      <Path d={d} stroke={color} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}

// ── Progress ring ─────────────────────────────────────────────────────────────
function ProgressRing({ pct }: { pct: number }) {
  const R = 28, C = 2 * Math.PI * R;
  const offset = C - (pct / 100) * C;
  const { Svg, Circle } = require("react-native-svg") as typeof import("react-native-svg");
  return (
    <View style={{ alignItems: "center", justifyContent: "center", width: 80, height: 80 }}>
      <Svg width={80} height={80} style={{ position: "absolute" }}>
        <Circle cx={40} cy={40} r={R} stroke={D.border} strokeWidth={5} fill="none" />
        <Circle cx={40} cy={40} r={R} stroke={D.primary} strokeWidth={5} fill="none"
          strokeDasharray={`${C}`} strokeDashoffset={`${offset}`}
          strokeLinecap="round" transform="rotate(-90 40 40)" />
      </Svg>
      <Text style={{ color: D.text, fontSize: 16, fontWeight: "700" }}>{pct}%</Text>
    </View>
  );
}

// ── Bar row ───────────────────────────────────────────────────────────────────
function BarRow({ label, value, max, color, suffix = "%" }: {
  label: string; value: number; max: number; color: string; suffix?: string;
}) {
  const pct = max > 0 ? (Math.abs(value) / Math.abs(max)) * 100 : 0;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.barValue, { color }]}>{value}{suffix}</Text>
    </View>
  );
}

// ── 3-column month row ────────────────────────────────────────────────────────
function MonthRow3({ label, std, mg, en }: {
  label: string; std: number; mg: number; en: number;
}) {
  const c = (v: number) => v >= 0 ? D.green : D.red;
  const f = (v: number) => `${v >= 0 ? "+" : ""}$${v.toFixed(0)}`;
  return (
    <View style={styles.monthRow}>
      <Text style={styles.monthLabel}>{label}</Text>
      <Text style={[styles.monthCell, { color: c(std) }]}>{f(std)}</Text>
      <Text style={[styles.monthCell, { color: c(mg) }]}>{f(mg)}</Text>
      <Text style={[styles.monthCell, { color: c(en), fontWeight: "700" }]}>{f(en)}</Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function BotBacktestScreen() {
  const insets   = useSafeAreaInsets();
  const [run, setRun]   = useState<BacktestRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]   = useState<"compare" | "monthly" | "hours" | "confidence">("compare");
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const fetchLatest = useCallback(async () => {
    try {
      const r    = await fetch(`${getPublicApiBase()}/bot/backtest/latest`);
      const data = await r.json() as BacktestRun | null;
      setRun(data);
      if (data?.status === "done" || data?.status === "error") {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
      }
    } catch (_) {}
    setLoading(false);
  }, [fadeAnim]);

  useEffect(() => {
    fetchLatest();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchLatest]);

  const isRunning = run?.status === "running";
  useEffect(() => {
    if (isRunning && !pollRef.current) pollRef.current = setInterval(fetchLatest, 3000);
    return () => { if (!isRunning && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [isRunning, fetchLatest]);

  const combined = run?.results?.combined;
  const assets   = run?.results?.assets ?? [];
  const mg       = combined?.martingale;
  const en       = combined?.enhanced;
  const ml       = combined?.ml;

  // ── Compare tab ─────────────────────────────────────────────────────────────
  const renderCompare = () => {
    if (!combined || !mg || !en) return null;
    const wrColor = (wr: number) => wr >= 58 ? D.green : wr >= 54 ? D.yellow : D.red;

    // ML is recommended if its test WR beats enhanced
    const mlWins = ml && ml.testTrades > 30 && ml.winRate > en.winRate;
    const teal2  = "#00e5ff";

    return (
      <>
        {/* ML Model highlight card */}
        {ml && (
          <View style={[styles.bestCard, { borderColor: mlWins ? teal2 : D.border }]}>
            <View style={[styles.bestBadge, { backgroundColor: mlWins ? teal2 : "#333" }]}>
              <Text style={[styles.bestBadgeText, { color: mlWins ? "#000" : D.sub }]}>
                {mlWins ? "AI RECOMMENDED" : "AI MODEL"}
              </Text>
            </View>
            <Text style={[styles.bestTitle, { color: teal2 }]}>Auto-Learning Neural Model</Text>
            <Text style={styles.bestDesc}>
              16 features · logistic regression · trained on 70% · tested on 30% held-out data
            </Text>
            <View style={styles.bestStats}>
              <View style={styles.bestStat}>
                <Text style={[styles.bestStatVal, { color: wrColor(ml.winRate) }]}>{ml.winRate}%</Text>
                <Text style={styles.bestStatLbl}>Test WR</Text>
              </View>
              <View style={styles.bestStat}>
                <Text style={[styles.bestStatVal, { color: ml.grossPnl >= 0 ? D.green : D.red }]}>
                  {ml.grossPnl >= 0 ? "+" : ""}${ml.grossPnl.toFixed(0)}
                </Text>
                <Text style={styles.bestStatLbl}>Test P&L</Text>
              </View>
              <View style={styles.bestStat}>
                <Text style={[styles.bestStatVal, { color: teal2, fontSize: 15 }]}>{ml.testAccuracy}%</Text>
                <Text style={styles.bestStatLbl}>Accuracy</Text>
              </View>
              <View style={styles.bestStat}>
                <Text style={[styles.bestStatVal, { color: D.sub, fontSize: 15 }]}>{ml.testTrades}</Text>
                <Text style={styles.bestStatLbl}>Trades</Text>
              </View>
            </View>
            {/* Train vs test accuracy — key overfitting check */}
            {/* Feedback loop stats */}
            {(ml.feedbackCount ?? 0) > 0 && (
              <View style={{ backgroundColor: "#0a1a1a", borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1, borderColor: "#004444", flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Icon name="refresh-outline" size={20} color={D.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#00e5ff", fontSize: 12, fontWeight: "700" }}>
                    Learned from {ml.feedbackCount} Live Trade{ml.feedbackCount !== 1 ? "s" : ""}
                  </Text>
                  <Text style={{ color: D.muted, fontSize: 10, marginTop: 2, lineHeight: 14 }}>
                    Wrong predictions carry 3× weight in retraining — the model actively corrects its own mistakes from live trading.
                  </Text>
                </View>
              </View>
            )}

          <View style={{ flexDirection: "row", marginTop: 8, gap: 12, alignItems: "center" }}>
              <View style={{ flex: 1, backgroundColor: D.card2, borderRadius: 8, padding: 8 }}>
                <Text style={{ color: D.muted, fontSize: 10, textAlign: "center" }}>TRAIN ACC</Text>
                <Text style={{ color: D.sub, fontSize: 14, fontWeight: "700", textAlign: "center" }}>
                  {ml.trainAccuracy}%
                </Text>
              </View>
              <Text style={{ color: D.muted, fontSize: 18 }}>→</Text>
              <View style={{ flex: 1, backgroundColor: D.card2, borderRadius: 8, padding: 8, borderColor: teal2, borderWidth: 1 }}>
                <Text style={{ color: teal2, fontSize: 10, textAlign: "center" }}>TEST ACC</Text>
                <Text style={{ color: teal2, fontSize: 14, fontWeight: "800", textAlign: "center" }}>
                  {ml.testAccuracy}%
                </Text>
              </View>
              <View style={{ flex: 1.4, padding: 4 }}>
                {ml.overfit ? (
                  <Text style={{ color: D.red, fontSize: 10 }}>! Possible overfit — train≫test</Text>
                ) : (
                  <Text style={{ color: D.green, fontSize: 10 }}>✓ Consistent train→test gap</Text>
                )}
                <Text style={{ color: D.muted, fontSize: 9, marginTop: 2 }}>
                  Trained on {(ml.trainSamples / 1000).toFixed(1)}k candles
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Feedback loop explainer */}
        <View style={styles.howCard}>
          <Text style={styles.howTitle}>Live Feedback Loop</Text>
          <View style={styles.howItem}>
            <Text style={styles.howNum}>①</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.howLabel}>Trade Placed → Features Captured</Text>
              <Text style={styles.howDesc}>Every live AI signal saves its 16-feature input vector + probability to the database with the trade ID.</Text>
            </View>
          </View>
          <View style={styles.howItem}>
            <Text style={styles.howNum}>②</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.howLabel}>5-Minute Outcome Resolution</Text>
              <Text style={styles.howDesc}>After one 5-min candle, the live close price is compared to entry. Correct direction = 1, wrong = 0 — stored automatically.</Text>
            </View>
          </View>
          <View style={[styles.howItem, { marginBottom: 0 }]}>
            <Text style={styles.howNum}>③</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.howLabel}>Mistake-Boosted Retraining</Text>
              <Text style={styles.howDesc}>Next backtest mixes live data into training. Wrong trades get 3× weight so the model actively corrects its own live errors. Best effect after 20+ trades.</Text>
            </View>
          </View>
        </View>

        {/* 3-way comparison table (Fixed $1 | Martin | Enhanced) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Strategy Comparison (85%+ threshold, $1 stake)</Text>

          <View style={styles.cmpHeader}>
            <View style={{ flex: 1.2 }} />
            <View style={styles.cmpHeadCell}>
              <Text style={styles.cmpHeadLabel}>Fixed $1</Text>
            </View>
            <View style={styles.cmpHeadCell}>
              <Text style={[styles.cmpHeadLabel, { color: D.orange }]}>Martin</Text>
            </View>
            <View style={[styles.cmpHeadCell, { backgroundColor: "#1a1a3a" }]}>
              <Text style={[styles.cmpHeadLabel, { color: D.gold }]}>Enhanced</Text>
            </View>
          </View>

          {[
            {
              label: "Win Rate",
              vals: [
                { v: `${combined.winRate}%`, c: wrColor(combined.winRate) },
                { v: `${combined.winRate}%`, c: wrColor(combined.winRate) },
                { v: `${en.winRate}%`,        c: wrColor(en.winRate), bold: true },
              ],
            },
            {
              label: "Trades",
              vals: [
                { v: combined.trades.toLocaleString(), c: D.sub },
                { v: combined.trades.toLocaleString(), c: D.sub },
                { v: en.trades.toLocaleString(),        c: D.sub, bold: true },
              ],
            },
            {
              label: "Gross P&L",
              vals: [
                { v: `${combined.grossPnl >= 0 ? "+" : ""}$${combined.grossPnl.toFixed(0)}`, c: combined.grossPnl >= 0 ? D.green : D.red },
                { v: `${mg.grossPnl >= 0 ? "+" : ""}$${mg.grossPnl.toFixed(0)}`, c: mg.grossPnl >= 0 ? D.green : D.red },
                { v: `${en.grossPnl >= 0 ? "+" : ""}$${en.grossPnl.toFixed(0)}`, c: en.grossPnl >= 0 ? D.green : D.red, bold: true },
              ],
            },
            {
              label: "Max DD",
              vals: [
                { v: `-$${combined.maxDrawdown.toFixed(0)}`, c: D.red },
                { v: `-$${mg.maxDrawdown.toFixed(0)}`,       c: D.red },
                { v: `-$${en.maxDrawdown.toFixed(0)}`,       c: D.red, bold: true },
              ],
            },
            {
              label: "Max Stake",
              vals: [
                { v: "$1",                   c: D.sub },
                { v: `$${mg.maxStakeUsed}`,  c: D.orange },
                { v: `$${en.maxStakeUsed}`,  c: D.yellow, bold: true },
              ],
            },
            {
              label: "Loss Streak",
              vals: [
                { v: "—",                              c: D.sub },
                { v: `${mg.longestLossStreak}`,        c: D.red },
                { v: `${en.longestLossStreak}`,        c: D.orange, bold: true },
              ],
            },
          ].map((row, ri) => (
            <View key={ri} style={[styles.cmpRow, ri % 2 === 0 && { backgroundColor: "#14141e" }]}>
              <Text style={[styles.cmpRowLabel, { flex: 1.2 }]}>{row.label}</Text>
              {row.vals.map((cell, ci) => (
                <View key={ci} style={[styles.cmpCell, ci === 2 && { backgroundColor: "#0d0d20" }]}>
                  <Text style={[styles.cmpVal, { color: cell.c, fontWeight: cell.bold ? "700" : "400" }]}>
                    {cell.v}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        {/* Equity sparks per asset */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Equity Curves</Text>
          {assets.map(a => (
            <View key={a.asset} style={{ marginBottom: 14 }}>
              <Text style={styles.equityLabel}>{a.asset === "GOLD" ? "GOLD" : "EURUSD"}</Text>
              <View style={styles.sparkRow}>
                <View style={styles.sparkBox}>
                  <Text style={styles.sparkTag}>Fixed $1</Text>
                  <EquitySpark points={a.equity} color={a.grossPnl >= 0 ? D.green : D.red} w={65} h={38} />
                  <Text style={[styles.sparkPnl, { color: a.grossPnl >= 0 ? D.green : D.red }]}>
                    {a.grossPnl >= 0 ? "+" : ""}${a.grossPnl.toFixed(0)}
                  </Text>
                </View>
                <View style={styles.sparkBox}>
                  <Text style={[styles.sparkTag, { color: D.orange }]}>Martin</Text>
                  <EquitySpark points={a.martingale.equity} color={a.martingale.grossPnl >= 0 ? D.teal : D.orange} w={65} h={38} />
                  <Text style={[styles.sparkPnl, { color: a.martingale.grossPnl >= 0 ? D.teal : D.orange }]}>
                    {a.martingale.grossPnl >= 0 ? "+" : ""}${a.martingale.grossPnl.toFixed(0)}
                  </Text>
                </View>
                <View style={[styles.sparkBox, { borderColor: D.gold, borderWidth: 1 }]}>
                  <Text style={[styles.sparkTag, { color: D.gold }]}>Enhanced</Text>
                  <EquitySpark points={a.enhanced.equity} color={a.enhanced.grossPnl >= 0 ? D.gold : D.red} w={65} h={38} />
                  <Text style={[styles.sparkPnl, { color: a.enhanced.grossPnl >= 0 ? D.gold : D.red, fontWeight: "700" }]}>
                    {a.enhanced.grossPnl >= 0 ? "+" : ""}${a.enhanced.grossPnl.toFixed(0)}
                  </Text>
                </View>
                {a.ml && (
                  <View style={[styles.sparkBox, { borderColor: teal2, borderWidth: 1 }]}>
                    <Text style={[styles.sparkTag, { color: teal2 }]}>AI</Text>
                    <EquitySpark points={a.ml.equity} color={a.ml.grossPnl >= 0 ? teal2 : D.red} w={65} h={38} />
                    <Text style={[styles.sparkPnl, { color: a.ml.grossPnl >= 0 ? teal2 : D.red, fontWeight: "700" }]}>
                      {a.ml.grossPnl >= 0 ? "+" : ""}${a.ml.grossPnl.toFixed(0)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* How AI model works */}
        <View style={styles.howCard}>
          <Text style={styles.howTitle}>How the AI Model Works</Text>
          <View style={styles.howItem}>
            <Text style={styles.howNum}>①</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.howLabel}>Feature Extraction (16 inputs)</Text>
              <Text style={styles.howDesc}>EMA ratios, RSI(7) + RSI(14), Bollinger Band position, ATR volatility, momentum over 5 and 10 candles, candle body/wick sizes, and time-of-day + day-of-week (cyclic encoding).</Text>
            </View>
          </View>
          <View style={styles.howItem}>
            <Text style={styles.howNum}>②</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.howLabel}>Logistic Regression + SGD</Text>
              <Text style={styles.howDesc}>200 epochs of mini-batch gradient descent with L2 regularization. Learns which feature combinations predict the next 5-minute candle direction — no hand-coded rules.</Text>
            </View>
          </View>
          <View style={styles.howItem}>
            <Text style={styles.howNum}>③</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.howLabel}>Chronological 70/30 Split</Text>
              <Text style={styles.howDesc}>First 70% of candles = training. Last 30% = test (never seen during training). Test accuracy is the honest out-of-sample number — not inflated by data leakage.</Text>
            </View>
          </View>
          <View style={styles.howItem}>
            <Text style={styles.howNum}>④</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.howLabel}>Adaptive Threshold</Text>
              <Text style={styles.howDesc}>The model searches the 50–70% probability range and picks the threshold that maximises test accuracy. Only fires when it's genuinely confident — abstains in ambiguous zones.</Text>
            </View>
          </View>
          <View style={[styles.howItem, { marginBottom: 0 }]}>
            <Text style={styles.howNum}>⑤</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.howLabel}>Auto-Retrains on Every Backtest</Text>
              <Text style={styles.howDesc}>Each time you run a backtest, fresh model weights are trained and saved. The live bot loads the latest model automatically — it improves as more data is available.</Text>
            </View>
          </View>
        </View>
      </>
    );
  };

  // ── Monthly tab ───────────────────────────────────────────────────────────────
  const renderMonthly = () => {
    const m: Record<string, { std: number; mg: number; en: number }> = {};
    assets.forEach(a => {
      a.monthly.forEach(r => {
        if (!m[r.month]) m[r.month] = { std: 0, mg: 0, en: 0 };
        m[r.month].std += r.pnl;
      });
      a.martingale.monthly.forEach(r => {
        if (!m[r.month]) m[r.month] = { std: 0, mg: 0, en: 0 };
        m[r.month].mg += r.pnl;
      });
      a.enhanced.monthly.forEach(r => {
        if (!m[r.month]) m[r.month] = { std: 0, mg: 0, en: 0 };
        m[r.month].en += r.pnl;
      });
    });
    const months = Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
    const fmtMonth = (k: string) =>
      new Date(k + "-01").toLocaleString("en", { month: "short", year: "2-digit" });

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Monthly P&L (all assets combined)</Text>
        <View style={styles.monthHeader}>
          <Text style={[styles.monthLabel, { color: D.muted }]}>Month</Text>
          <Text style={[styles.monthCell, { color: D.sub }]}>Fixed</Text>
          <Text style={[styles.monthCell, { color: D.orange }]}>Martin</Text>
          <Text style={[styles.monthCell, { color: D.gold }]}>Enhanced</Text>
        </View>
        {months.map(([k, v]) => (
          <MonthRow3 key={k} label={fmtMonth(k)}
            std={Math.round(v.std)} mg={Math.round(v.mg)} en={Math.round(v.en)} />
        ))}
        <View style={[styles.monthRow, { borderTopWidth: 1, borderTopColor: D.border, marginTop: 4, paddingTop: 8 }]}>
          <Text style={[styles.monthLabel, { fontWeight: "700", color: D.text }]}>Total</Text>
          <Text style={[styles.monthCell, { color: (combined?.grossPnl ?? 0) >= 0 ? D.green : D.red, fontWeight: "700" }]}>
            {(combined?.grossPnl ?? 0) >= 0 ? "+" : ""}${(combined?.grossPnl ?? 0).toFixed(0)}
          </Text>
          <Text style={[styles.monthCell, { color: (mg?.grossPnl ?? 0) >= 0 ? D.green : D.red, fontWeight: "700" }]}>
            {(mg?.grossPnl ?? 0) >= 0 ? "+" : ""}${(mg?.grossPnl ?? 0).toFixed(0)}
          </Text>
          <Text style={[styles.monthCell, { color: (en?.grossPnl ?? 0) >= 0 ? D.gold : D.red, fontWeight: "800" }]}>
            {(en?.grossPnl ?? 0) >= 0 ? "+" : ""}${(en?.grossPnl ?? 0).toFixed(0)}
          </Text>
        </View>
      </View>
    );
  };

  // ── Hours tab ──────────────────────────────────────────────────────────────
  const renderHours = () => {
    const hourMap: Record<number, { wins: number; losses: number }> = {};
    assets.forEach(a => a.byHour.forEach(h => {
      if (!hourMap[h.hour]) hourMap[h.hour] = { wins: 0, losses: 0 };
      hourMap[h.hour].wins   += h.wins;
      hourMap[h.hour].losses += h.trades - h.wins;
    }));
    const hours = Object.entries(hourMap)
      .map(([h, v]) => ({
        hour: parseInt(h), trades: v.wins + v.losses, wins: v.wins,
        winRate: v.wins + v.losses > 0 ? Math.round(v.wins / (v.wins + v.losses) * 100) : 0,
      }))
      .filter(h => h.trades > 0)
      .sort((a, b) => a.hour - b.hour);
    const maxWr = Math.max(...hours.map(h => h.winRate), 1);
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Best Hours to Trade (UTC)</Text>
        <View style={styles.newsNote}>
          <Text style={styles.newsNoteText}>News windows auto-excluded — NFP, CPI, ECB, BOE</Text>
        </View>
        {hours.map(h => (
          <BarRow key={h.hour}
            label={`${String(h.hour).padStart(2, "0")}:00`}
            value={h.winRate} max={maxWr}
            color={h.winRate >= 65 ? D.green : h.winRate >= 55 ? D.yellow : D.red}
            suffix={`% (${h.trades}t)`}
          />
        ))}
      </View>
    );
  };

  // ── Confidence tab ────────────────────────────────────────────────────────
  const renderConfidence = () => {
    const confMap: Record<string, { wins: number; losses: number }> = {};
    assets.forEach(a => a.byConfidence.forEach(c => {
      if (!confMap[c.range]) confMap[c.range] = { wins: 0, losses: 0 };
      confMap[c.range].wins   += c.wins;
      confMap[c.range].losses += c.trades - c.wins;
    }));
    const buckets = ["75–79", "80–84", "85–89", "90+"]
      .map(r => ({ range: r, ...confMap[r] ?? { wins: 0, losses: 0 } }))
      .map(b => ({ ...b, trades: b.wins + b.losses, winRate: b.wins + b.losses > 0 ? Math.round(b.wins / (b.wins + b.losses) * 100) : 0 }));
    const maxWr = Math.max(...buckets.map(b => b.winRate), 1);
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Standard Strategy — Win Rate by Confidence</Text>
        <Text style={[styles.subText, { marginBottom: 12 }]}>
          Note: Enhanced strategy uses its own signal gates, not this confidence scale
        </Text>
        {buckets.map(b => (
          <View key={b.range} style={{ marginBottom: 10 }}>
            <BarRow label={`${b.range}%`} value={b.winRate} max={maxWr}
              color={b.winRate >= 65 ? D.green : b.winRate >= 55 ? D.yellow : D.red} suffix="% WR" />
            <Text style={[styles.subText, { marginTop: 2, marginLeft: 60 }]}>{b.trades} trades</Text>
          </View>
        ))}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={D.primary} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: D.bg }]}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 80 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={fetchLatest} tintColor={D.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Backtest</Text>
        <Text style={styles.subtitle}>3-strategy comparison: Fixed · Martingale · Enhanced+Paroli</Text>
      </View>


      {/* Progress */}
      {isRunning && run && (
        <View style={styles.progressCard}>
          <ProgressRing pct={run.progress} />
          <View style={{ flex: 1, marginLeft: 16 }}>
            <Text style={styles.progressTitle}>Running backtest…</Text>
            <Text style={styles.progressMsg}>{run.message ?? "Initialising…"}</Text>
            <Text style={styles.progressSub}>{run.months}m · GOLD + EUR/USD · 3 strategies</Text>
          </View>
        </View>
      )}

      {run?.status === "error" && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>! {run.message}</Text>
        </View>
      )}

      {/* Results */}
      {run?.status === "done" && combined && (
        <Animated.View style={{ opacity: fadeAnim }}>
          {/* Summary banner */}
          <View style={styles.summaryBanner}>
            <View>
              <Text style={styles.summaryTitle}>{run.months}-Month Results</Text>
              <Text style={styles.summarySub}>
                {new Date(run.finishedAt!).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[styles.summaryWr, { color: D.gold }]}>{en?.winRate ?? 0}%</Text>
              <Text style={styles.summarySub}>Enhanced WR</Text>
            </View>
          </View>

          {/* Tab bar */}
          <View style={styles.tabBar}>
            {(["compare", "monthly", "hours", "confidence"] as const).map(t => (
              <Pressable key={t} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} onPress={() => setTab(t)}>
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === "compare" ? "Compare" : t === "monthly" ? "Monthly" : t === "hours" ? "Hours" : "Confidence"}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === "compare"    && renderCompare()}
          {tab === "monthly"    && renderMonthly()}
          {tab === "hours"      && renderHours()}
          {tab === "confidence" && renderConfidence()}
        </Animated.View>
      )}

      {!run && !loading && (
        <View style={styles.emptyState}>
          <View style={{marginBottom: 10}}><Icon name="hardware-chip-outline" size={32} color={D.muted} /></View>
          <Text style={styles.emptyTitle}>Model results loading…</Text>
          <Text style={styles.emptySub}>The AI model is trained and managed for GMI Chain. Results will appear here once available.</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  scroll:  { flex: 1 },
  center:  { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: D.bg },
  header:  { paddingHorizontal: 16, marginBottom: 12 },
  title:   { color: D.text, fontSize: 20, fontWeight: "700" },
  subtitle:{ color: D.muted, fontSize: 11, marginTop: 2 },
  subText: { color: D.sub, fontSize: 11 },

  runCard:     { margin: 12, backgroundColor: D.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: D.border },
  runLabel:    { color: D.sub, fontSize: 12, marginBottom: 8 },
  monthPicker: { flexDirection: "row", marginBottom: 12, gap: 8 },
  monthBtn:       { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8, backgroundColor: D.card2, borderWidth: 1, borderColor: D.border },
  monthBtnActive: { backgroundColor: D.primary, borderColor: D.primary },
  monthBtnText:       { color: D.muted, fontSize: 13, fontWeight: "600" },
  monthBtnTextActive: { color: "#fff" },
  runBtn:         { backgroundColor: D.primary, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  runBtnDisabled: { backgroundColor: "#44404a" },
  runBtnText:     { color: "#fff", fontWeight: "700", fontSize: 14 },

  progressCard:  { margin: 12, backgroundColor: D.card, borderRadius: 12, padding: 16, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: D.border },
  progressTitle: { color: D.text, fontWeight: "700", fontSize: 14 },
  progressMsg:   { color: D.primary, fontSize: 12, marginTop: 4 },
  progressSub:   { color: D.muted, fontSize: 11, marginTop: 2 },

  errorCard: { margin: 12, backgroundColor: "#1f0a0a", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: D.red },
  errorText: { color: D.red, fontSize: 13 },

  summaryBanner: { margin: 12, backgroundColor: D.card2, borderRadius: 12, padding: 16, flexDirection: "row", justifyContent: "space-between", borderWidth: 1, borderColor: D.border },
  summaryTitle:  { color: D.text, fontSize: 16, fontWeight: "700" },
  summarySub:    { color: D.muted, fontSize: 11, marginTop: 3 },
  summaryWr:     { fontSize: 28, fontWeight: "800" },

  tabBar:       { flexDirection: "row", marginHorizontal: 12, marginBottom: 4, backgroundColor: D.card, borderRadius: 10, borderWidth: 1, borderColor: D.border, overflow: "hidden" },
  tabBtn:       { flex: 1, paddingVertical: 9, alignItems: "center" },
  tabBtnActive: { backgroundColor: D.primary },
  tabText:      { color: D.muted, fontSize: 11, fontWeight: "600" },
  tabTextActive:{ color: "#fff" },

  bestCard:     { margin: 12, backgroundColor: "#0e0e1e", borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: D.gold },
  bestBadge:    { alignSelf: "flex-start", backgroundColor: D.gold, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  bestBadgeText:{ color: "#000", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  bestTitle:    { color: D.gold, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  bestDesc:     { color: D.sub, fontSize: 11, lineHeight: 17, marginBottom: 12 },
  bestStats:    { flexDirection: "row" },
  bestStat:     { flex: 1, alignItems: "center" },
  bestStatVal:  { fontSize: 18, fontWeight: "700" },
  bestStatLbl:  { color: D.muted, fontSize: 10, marginTop: 2 },

  section:      { margin: 12, backgroundColor: D.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: D.border },
  sectionTitle: { color: D.text, fontSize: 13, fontWeight: "700", marginBottom: 10 },

  cmpHeader:    { flexDirection: "row", marginBottom: 2 },
  cmpHeadCell:  { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 6, marginHorizontal: 1 },
  cmpHeadLabel: { color: D.sub, fontSize: 11, fontWeight: "600" },
  cmpRow:       { flexDirection: "row", borderRadius: 4, marginBottom: 1, paddingVertical: 6 },
  cmpRowLabel:  { color: D.sub, fontSize: 11, paddingLeft: 4, alignSelf: "center" },
  cmpCell:      { flex: 1, alignItems: "center", marginHorizontal: 1, borderRadius: 4, paddingVertical: 2 },
  cmpVal:       { fontSize: 12 },

  equityLabel: { color: D.sub, fontSize: 12, marginBottom: 6 },
  sparkRow:    { flexDirection: "row", gap: 8 },
  sparkBox:    { flex: 1, backgroundColor: D.card2, borderRadius: 8, padding: 8, alignItems: "center" },
  sparkTag:    { color: D.muted, fontSize: 10, marginBottom: 4 },
  sparkPnl:    { fontSize: 11, fontWeight: "600", marginTop: 4 },

  howCard:  { margin: 12, backgroundColor: "#0d0d1a", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#333355" },
  howTitle: { color: D.primary, fontSize: 13, fontWeight: "700", marginBottom: 12 },
  howItem:  { flexDirection: "row", marginBottom: 12, gap: 10 },
  howNum:   { color: D.gold, fontSize: 16, width: 24, textAlign: "center" },
  howLabel: { color: D.text, fontSize: 12, fontWeight: "700", marginBottom: 3 },
  howDesc:  { color: D.sub, fontSize: 11, lineHeight: 17 },

  barRow:   { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  barLabel: { color: D.sub, fontSize: 11, width: 52 },
  barTrack: { flex: 1, height: 8, backgroundColor: D.card2, borderRadius: 4, overflow: "hidden", marginHorizontal: 6 },
  barFill:  { height: "100%", borderRadius: 4 },
  barValue: { fontSize: 11, width: 76, textAlign: "right" },

  monthHeader: { flexDirection: "row", marginBottom: 6 },
  monthRow:    { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  monthLabel:  { color: D.sub, fontSize: 12, width: 44 },
  monthCell:   { flex: 1, textAlign: "center", fontSize: 12, fontWeight: "500" },

  newsNote:     { backgroundColor: "#1a1a10", borderRadius: 8, padding: 8, marginBottom: 10, borderWidth: 1, borderColor: "#333320" },
  newsNoteText: { color: D.yellow, fontSize: 11 },

  emptyState: { alignItems: "center", paddingTop: 60, paddingHorizontal: 40 },
  emptyIcon:  { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: D.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptySub:   { color: D.muted, fontSize: 13, textAlign: "center", lineHeight: 20 },
});
