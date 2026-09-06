import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import { getPublicApiBase } from "@/services/api";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TradeSignal {
  confidence: number;
  emaFast: number;
  emaSlow: number;
  rsiValue: number;
  bbPos: number;
  reason: string;
  duration: string;
  reasons: string[];
}

interface BotTrade {
  tradeId: string;
  asset: string;
  direction: "UP" | "DOWN";
  amount: number;
  payout: number;
  status: "open" | "won" | "lost" | "draw" | "error";
  entryPrice: number | null;
  exitPrice: number | null;
  openedAt: string;
  resolvedAt: string | null;
  pnl: number | null;
  signal: TradeSignal | null;
}

interface ByAsset {
  total: number; wins: number; losses: number; winRate: number; pnl: number;
}

interface PnlPoint {
  ts: string; tradeId: string; pnl: number; cumPnl: number;
}

interface Analytics {
  session: {
    startedAt: string | null;
    durationMs: number;
    totalTrades: number;
    wins: number;
    losses: number;
    openTrades: number;
    winRate: number;
    totalPnl: number;
    avgConfidence: number;
    botBalance: number;
    hours: number;
  };
  byAsset: Record<string, ByAsset>;
  indicators: {
    emaAligned: number; rsiFiltered: number; bbFiltered: number; avgConfidence: number;
  };
  trades: BotTrade[];
  pnlOverTime: PnlPoint[];
}

// ── Dark palette ──────────────────────────────────────────────────────────────
const D = {
  bg: "#0a0a0f",
  card: "#12121a",
  card2: "#1a1a26",
  border: "#2a2a3a",
  primary: "#6c63ff",
  green: "#00d97e",
  red: "#ff4560",
  yellow: "#ffc107",
  muted: "#888",
  text: "#f0f0f0",
  sub: "#aaa",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  return h > 0 ? `${h}h ${m}m ${sc}s` : m > 0 ? `${m}m ${sc}s` : `${sc}s`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function statusColor(s: string) {
  if (s === "won")  return D.green;
  if (s === "lost") return D.red;
  if (s === "open") return D.yellow;
  return D.muted;
}

function statusLabel(s: string) {
  if (s === "won")  return "WIN";
  if (s === "lost") return "LOSS";
  if (s === "open") return "LIVE";
  if (s === "draw") return "DRAW";
  return s.toUpperCase();
}

function dirColor(d: string) { return d === "UP" ? D.green : D.red; }
function dirArrow(d: string) { return d === "UP" ? "▲" : "▼"; }

// ── Mini P&L Chart ─────────────────────────────────────────────────────────────
function PnlChart({ points }: { points: PnlPoint[] }) {
  const W = 340, H = 120, PAD = 12;
  if (points.length < 2) {
    return (
      <View style={{ height: H, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: D.muted, fontSize: 13 }}>Waiting for resolved trades…</Text>
      </View>
    );
  }
  const vals  = points.map(p => p.cumPnl);
  const minV  = Math.min(...vals, 0);
  const maxV  = Math.max(...vals, 0);
  const range = maxV - minV || 1;
  const xs    = points.map((_, i) => PAD + (i / (points.length - 1)) * (W - PAD * 2));
  const ys    = vals.map(v => H - PAD - ((v - minV) / range) * (H - PAD * 2));
  const zeroY = H - PAD - ((0 - minV) / range) * (H - PAD * 2);

  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) d += ` L ${xs[i]} ${ys[i]}`;

  const last = vals[vals.length - 1];
  const lineColor = last >= 0 ? D.green : D.red;

  return (
    <Svg width={W} height={H}>
      <Line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke={D.border} strokeWidth={1} strokeDasharray="4,4" />
      <Path d={d} stroke={lineColor} strokeWidth={2} fill="none" />
      {points.map((p, i) => (
        <Circle key={p.tradeId} cx={xs[i]} cy={ys[i]}
          r={i === points.length - 1 ? 5 : 3}
          fill={p.pnl >= 0 ? D.green : D.red}
          stroke={D.bg} strokeWidth={1.5}
        />
      ))}
      <SvgText x={W - PAD} y={PAD + 10} textAnchor="end" fill={lineColor} fontSize={11} fontWeight="700">
        {last >= 0 ? "+" : ""}{last.toFixed(2)} USDT
      </SvgText>
    </Svg>
  );
}

// ── Confidence Ring ────────────────────────────────────────────────────────────
function ConfidenceRing({ value }: { value: number }) {
  const r = 22, circ = 2 * Math.PI * r;
  const arc  = (value / 100) * circ;
  const color = value >= 80 ? D.green : value >= 65 ? D.yellow : D.red;
  return (
    <Svg width={56} height={56}>
      <Circle cx={28} cy={28} r={r} stroke={D.border} strokeWidth={4} fill="none" />
      <Circle cx={28} cy={28} r={r} stroke={color} strokeWidth={4} fill="none"
        strokeDasharray={`${arc} ${circ}`} strokeLinecap="round"
        rotation="-90" origin="28,28"
      />
      <SvgText x={28} y={33} textAnchor="middle" fill={color} fontSize={13} fontWeight="700">
        {value}%
      </SvgText>
    </Svg>
  );
}

// ── Trade Card ─────────────────────────────────────────────────────────────────
function TradeCard({ trade, index }: { trade: BotTrade; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const toggle = useCallback(() => {
    if (!trade.signal) return;
    const toVal = expanded ? 0 : 1;
    setExpanded(!expanded);
    Animated.spring(anim, { toValue: toVal, useNativeDriver: false }).start();
  }, [expanded, trade.signal, anim]);

  const pnlColor = trade.pnl == null ? D.muted : trade.pnl >= 0 ? D.green : D.red;

  return (
    <Pressable onPress={toggle} style={[styles.tradeCard, { borderLeftColor: statusColor(trade.status) }]}>
      {/* Row 1: index + asset + direction + status + PNL */}
      <View style={styles.tradeRow}>
        <Text style={styles.tradeIndex}>#{index}</Text>
        <View style={[styles.dirBadge, { backgroundColor: dirColor(trade.direction) + "22", borderColor: dirColor(trade.direction) }]}>
          <Text style={[styles.dirText, { color: dirColor(trade.direction) }]}>
            {dirArrow(trade.direction)} {trade.direction}
          </Text>
        </View>
        <Text style={styles.tradeAsset}>{trade.asset}</Text>
        <View style={{ flex: 1 }} />
        <View style={[styles.statusBadge, { backgroundColor: statusColor(trade.status) + "22" }]}>
          <Text style={[styles.statusText, { color: statusColor(trade.status) }]}>
            {statusLabel(trade.status)}
          </Text>
        </View>
        {trade.pnl != null && (
          <Text style={[styles.tradePnl, { color: pnlColor }]}>
            {trade.pnl >= 0 ? "+" : ""}{trade.pnl.toFixed(2)}
          </Text>
        )}
      </View>

      {/* Row 2: prices + time */}
      <View style={[styles.tradeRow, { marginTop: 6 }]}>
        <Text style={styles.tradeDetail}>
          Stake: <Text style={styles.tradeDetailVal}>${trade.amount.toFixed(2)}</Text>
        </Text>
        {trade.entryPrice && (
          <Text style={[styles.tradeDetail, { marginLeft: 12 }]}>
            Entry: <Text style={styles.tradeDetailVal}>{trade.entryPrice.toFixed(3)}</Text>
          </Text>
        )}
        {trade.exitPrice && (
          <Text style={[styles.tradeDetail, { marginLeft: 12 }]}>
            Exit: <Text style={styles.tradeDetailVal}>{trade.exitPrice.toFixed(3)}</Text>
          </Text>
        )}
        <View style={{ flex: 1 }} />
        <Text style={styles.tradeTime}>{fmtTime(trade.openedAt)}</Text>
      </View>

      {/* Expandable signal details */}
      {trade.signal && (
        <Animated.View style={[styles.signalBox, {
          maxHeight: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 300] }),
          opacity: anim,
          overflow: "hidden",
        }]}>
          <View style={styles.signalHeader}>
            <Text style={styles.signalTitle}>Why this trade was placed</Text>
            <ConfidenceRing value={trade.signal.confidence} />
          </View>

          {/* Indicator bars */}
          <View style={styles.indicatorRow}>
            <Text style={styles.indLabel}>EMA9</Text>
            <Text style={styles.indValue}>{trade.signal.emaFast?.toFixed(4)}</Text>
            <Text style={[styles.indVsLabel, { color: trade.direction === "UP" ? D.green : D.red }]}>
              {trade.direction === "UP" ? ">" : "<"}
            </Text>
            <Text style={styles.indLabel}>EMA21</Text>
            <Text style={styles.indValue}>{trade.signal.emaSlow?.toFixed(4)}</Text>
          </View>

          <View style={styles.indicatorRow}>
            <Text style={styles.indLabel}>RSI(14)</Text>
            <View style={styles.rsiBar}>
              <View style={[styles.rsiBarFill, {
                width: `${trade.signal.rsiValue}%` as unknown as number,
                backgroundColor: trade.signal.rsiValue > 70 ? D.red : trade.signal.rsiValue < 30 ? D.green : D.yellow,
              }]} />
            </View>
            <Text style={[styles.indValue, { minWidth: 36, textAlign: "right" }]}>
              {trade.signal.rsiValue?.toFixed(1)}
            </Text>
          </View>

          <View style={styles.indicatorRow}>
            <Text style={styles.indLabel}>BB Pos</Text>
            <View style={styles.rsiBar}>
              <View style={[styles.rsiBarFill, {
                width: `${(trade.signal.bbPos ?? 0.5) * 100}%` as unknown as number,
                backgroundColor: D.primary,
              }]} />
            </View>
            <Text style={[styles.indValue, { minWidth: 36, textAlign: "right" }]}>
              {((trade.signal.bbPos ?? 0) * 100).toFixed(0)}%
            </Text>
          </View>

          {/* Reason bullets */}
          <View style={styles.reasonsBox}>
            {trade.signal.reasons.map((r, i) => (
              <View key={i} style={styles.reasonRow}>
                <Text style={styles.reasonDot}>•</Text>
                <Text style={styles.reasonText}>{r}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.durationNote}>Duration: {trade.signal.duration} contract</Text>
        </Animated.View>
      )}

      {trade.signal && (
        <Text style={styles.expandHint}>{expanded ? "▲ hide" : "▼ why this trade?"}</Text>
      )}
    </Pressable>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function BotAnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hours, setHours] = useState(2);

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      const r = await fetch(`${getPublicApiBase()}/bot/analytics?hours=${hours}`);
      if (r.ok) setData(await r.json() as Analytics);
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }, [hours]);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh every 12s
  useEffect(() => {
    const id = setInterval(() => { void load(); }, 12_000);
    return () => clearInterval(id);
  }, [load]);

  // Tick elapsed timer every second
  useEffect(() => {
    const id = setInterval(() => {
      if (data?.session?.startedAt) {
        setElapsed(Date.now() - new Date(data.session.startedAt).getTime());
      }
    }, 1000);
    return () => clearInterval(id);
  }, [data?.session?.startedAt]);

  const s = data?.session;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>AlphaBot Analytics</Text>
          <Text style={styles.headerSub}>
            {s?.startedAt ? `Running ${fmtDuration(elapsed || s.durationMs)}` : "Starting…"}
          </Text>
        </View>
        <View style={styles.liveDot}>
          <View style={styles.livePulse} />
          <Text style={styles.liveLabel}>LIVE</Text>
        </View>
      </View>

      {/* Hours selector */}
      <View style={styles.hoursRow}>
        {[1, 2, 4, 8, 24].map(h => (
          <Pressable key={h} onPress={() => setHours(h)}
            style={[styles.hourBtn, hours === h && styles.hourBtnActive]}>
            <Text style={[styles.hourBtnText, hours === h && styles.hourBtnTextActive]}>
              {h}h
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator color={D.primary} size="large" />
          <Text style={styles.loadingText}>Loading analytics…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={D.primary} />}
        >
          {/* Summary cards */}
          <View style={styles.statsGrid}>
            <View style={[styles.statCard, { flex: 1 }]}>
              <Text style={styles.statLabel}>Trades</Text>
              <Text style={styles.statValue}>{s?.totalTrades ?? 0}</Text>
              <Text style={styles.statSub}>{s?.openTrades ?? 0} live</Text>
            </View>
            <View style={[styles.statCard, { flex: 1 }]}>
              <Text style={styles.statLabel}>Win Rate</Text>
              <Text style={[styles.statValue, { color: (s?.winRate ?? 0) >= 60 ? D.green : D.red }]}>
                {s?.winRate ?? 0}%
              </Text>
              <Text style={styles.statSub}>{s?.wins ?? 0}W / {s?.losses ?? 0}L</Text>
            </View>
            <View style={[styles.statCard, { flex: 1 }]}>
              <Text style={styles.statLabel}>P&L</Text>
              <Text style={[styles.statValue, { color: (s?.totalPnl ?? 0) >= 0 ? D.green : D.red }]}>
                {(s?.totalPnl ?? 0) >= 0 ? "+" : ""}{(s?.totalPnl ?? 0).toFixed(2)}
              </Text>
              <Text style={styles.statSub}>USDT</Text>
            </View>
            <View style={[styles.statCard, { flex: 1 }]}>
              <Text style={styles.statLabel}>Confidence</Text>
              <Text style={styles.statValue}>{s?.avgConfidence ?? 0}%</Text>
              <Text style={styles.statSub}>avg signal</Text>
            </View>
          </View>

          {/* Balance */}
          <View style={styles.balanceCard}>
            <Text style={styles.balLabel}>Bot Demo Balance</Text>
            <Text style={styles.balValue}>${(s?.botBalance ?? 100000).toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
            <Text style={styles.balSub}>Started with $100,000.00</Text>
          </View>

          {/* P&L Chart */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>P&L Over Time</Text>
            <View style={styles.chartBox}>
              <PnlChart points={data?.pnlOverTime ?? []} />
            </View>
          </View>

          {/* Per-asset */}
          {data && Object.keys(data.byAsset).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>By Asset</Text>
              {Object.entries(data.byAsset).map(([asset, a]) => (
                <View key={asset} style={styles.assetRow}>
                  <Text style={styles.assetName}>{asset}</Text>
                  <View style={styles.assetWinBar}>
                    <View style={[styles.assetWinFill, { flex: a.wins, backgroundColor: D.green }]} />
                    <View style={[styles.assetWinFill, { flex: a.losses, backgroundColor: D.red }]} />
                  </View>
                  <Text style={[styles.assetWinRate,
                    { color: a.winRate >= 60 ? D.green : D.red }]}>{a.winRate}%</Text>
                  <Text style={[styles.assetPnl,
                    { color: a.pnl >= 0 ? D.green : D.red }]}>
                    {a.pnl >= 0 ? "+" : ""}{a.pnl.toFixed(2)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Signal indicator breakdown */}
          {data && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Signal Indicators Used</Text>
              {[
                { label: "EMA Crossover", pct: data.indicators.emaAligned, color: D.primary },
                { label: "RSI Filter", pct: data.indicators.rsiFiltered, color: D.yellow },
                { label: "Bollinger Band", pct: data.indicators.bbFiltered, color: "#00bcd4" },
              ].map(ind => (
                <View key={ind.label} style={styles.indBreakRow}>
                  <Text style={styles.indBreakLabel}>{ind.label}</Text>
                  <View style={styles.indBreakBar}>
                    <View style={[styles.indBreakFill, { width: `${ind.pct}%` as unknown as number, backgroundColor: ind.color }]} />
                  </View>
                  <Text style={[styles.indBreakPct, { color: ind.color }]}>{ind.pct}%</Text>
                </View>
              ))}
            </View>
          )}

          {/* Trade log */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Trade Log{data ? ` (${data.trades.length})` : ""}
            </Text>
            {data?.trades.length === 0 && (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>No trades yet — bot fires every ~60 seconds once 30 price samples are collected.</Text>
              </View>
            )}
            {data?.trades.map((t, i) => (
              <TradeCard key={t.tradeId} trade={t} index={data.trades.length - i} />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: D.bg },
  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle:{ color: D.text, fontSize: 20, fontWeight: "700" },
  headerSub:  { color: D.muted, fontSize: 12, marginTop: 2 },
  liveDot:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: D.green + "22", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: D.green + "55" },
  livePulse:  { width: 7, height: 7, borderRadius: 4, backgroundColor: D.green },
  liveLabel:  { color: D.green, fontSize: 11, fontWeight: "700" },
  hoursRow:   { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  hourBtn:    { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: D.border, backgroundColor: D.card },
  hourBtnActive: { backgroundColor: D.primary + "33", borderColor: D.primary },
  hourBtnText:   { color: D.muted, fontSize: 12, fontWeight: "600" },
  hourBtnTextActive: { color: D.primary },
  statsGrid:  { flexDirection: "row", paddingHorizontal: 12, gap: 6, marginBottom: 10 },
  statCard:   { backgroundColor: D.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: D.border, alignItems: "center" },
  statLabel:  { color: D.muted, fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue:  { color: D.text, fontSize: 20, fontWeight: "800", marginTop: 4 },
  statSub:    { color: D.muted, fontSize: 10, marginTop: 2 },
  balanceCard:{ marginHorizontal: 16, backgroundColor: D.card2, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: D.border, alignItems: "center", marginBottom: 10 },
  balLabel:   { color: D.muted, fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  balValue:   { color: D.text, fontSize: 28, fontWeight: "800", marginTop: 4 },
  balSub:     { color: D.muted, fontSize: 11, marginTop: 3 },
  section:    { marginHorizontal: 16, marginBottom: 18 },
  sectionTitle: { color: D.sub, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  chartBox:   { backgroundColor: D.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: D.border, alignItems: "center" },
  assetRow:   { flexDirection: "row", alignItems: "center", backgroundColor: D.card, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: D.border, gap: 10 },
  assetName:  { color: D.text, fontSize: 13, fontWeight: "700", width: 52 },
  assetWinBar:{ flex: 1, flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: D.border },
  assetWinFill: { height: 6 },
  assetWinRate: { fontSize: 13, fontWeight: "700", width: 38, textAlign: "right" },
  assetPnl:   { fontSize: 12, fontWeight: "600", width: 54, textAlign: "right" },
  indBreakRow:{ flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 10 },
  indBreakLabel: { color: D.sub, fontSize: 12, width: 110 },
  indBreakBar:{ flex: 1, height: 6, borderRadius: 3, backgroundColor: D.border, overflow: "hidden" },
  indBreakFill: { height: 6, borderRadius: 3 },
  indBreakPct:{ fontSize: 12, fontWeight: "700", width: 36, textAlign: "right" },
  tradeCard:  { backgroundColor: D.card, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: D.border, borderLeftWidth: 3 },
  tradeRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  tradeIndex: { color: D.muted, fontSize: 11, width: 24 },
  dirBadge:   { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  dirText:    { fontSize: 11, fontWeight: "700" },
  tradeAsset: { color: D.text, fontSize: 13, fontWeight: "600" },
  statusBadge:{ borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  tradePnl:   { fontSize: 13, fontWeight: "700", minWidth: 50, textAlign: "right" },
  tradeDetail:{ color: D.muted, fontSize: 11 },
  tradeDetailVal: { color: D.sub, fontWeight: "600" },
  tradeTime:  { color: D.muted, fontSize: 10 },
  expandHint: { color: D.primary, fontSize: 11, marginTop: 8, textAlign: "center" },
  signalBox:  { marginTop: 12, backgroundColor: D.card2, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: D.border },
  signalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  signalTitle:{ color: D.text, fontSize: 13, fontWeight: "700" },
  indicatorRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  indLabel:   { color: D.muted, fontSize: 11, width: 48 },
  indValue:   { color: D.text, fontSize: 12, fontWeight: "600" },
  indVsLabel: { fontSize: 14, fontWeight: "800", width: 16, textAlign: "center" },
  rsiBar:     { flex: 1, height: 6, backgroundColor: D.border, borderRadius: 3, overflow: "hidden" },
  rsiBarFill: { height: 6, borderRadius: 3 },
  reasonsBox: { marginTop: 8, backgroundColor: D.bg, borderRadius: 8, padding: 10 },
  reasonRow:  { flexDirection: "row", gap: 6, marginBottom: 4 },
  reasonDot:  { color: D.primary, fontSize: 14, lineHeight: 18 },
  reasonText: { color: D.sub, fontSize: 12, flex: 1, lineHeight: 18 },
  durationNote: { color: D.muted, fontSize: 11, marginTop: 8, textAlign: "center" },
  center:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText:{ color: D.muted, fontSize: 14 },
  emptyBox:   { backgroundColor: D.card2, borderRadius: 10, padding: 20, alignItems: "center" },
  emptyText:  { color: D.muted, fontSize: 13, textAlign: "center", lineHeight: 20 },
});
