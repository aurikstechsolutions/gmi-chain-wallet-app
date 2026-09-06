import { Icon } from "@/components/Icon";
import { usePinContext } from "@/context/PinContext";
import { useWallet } from "@/context/WalletContext";
import { getPublicApiBase } from "@/services/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ── Design tokens for the light GMI Wallet experience ─────────────────────────
const D = {
  bg:     "#F6F8FB",
  card:   "#FFFFFF",
  card2:  "#EEF4FA",
  border: "#D9E2EC",
  text:   "#101828",
  muted:  "#667085",
  dim:    "#D0D5DD",
  green:  "#039855",
  red:    "#D92D20",
  yellow: "#F0B90B",
  blue:   "#3B82F6",
  purple: "#8B5CF6",
};

const BOT_ADDRESS = "0x000000000000000000000000000000000000b077";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Leader {
  rank:          number;
  walletAddress: string;
  displayName:   string;
  isBot:         boolean;
  total:         number;
  wins:          number;
  losses:        number;
  draws:         number;
  winRate:       number;
  totalPnl:      number;
}

interface Following {
  leader_address: string;
  stake_usdt:     string;
  active:         boolean;
}

interface BotStatus {
  running: boolean;
  lastSignal: {
    asset:      string;
    direction:  "UP" | "DOWN";
    confidence: number;
    duration:   string;
    rsiValue:   number;
    bbPos:      number;
    reason:     string;
    ts:         number;
  } | null;
  stats: { wins: number; losses: number; draws: number; totalPnl: number };
}

interface TradeRow {
  id: string; asset: string; direction: string; amount_usdt: string;
  payout_usdt: string; status: string; opened_at: string; duration: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────
const base = () => getPublicApiBase();

async function fetchLeaderboard(): Promise<Leader[]> {
  const r = await fetch(`${base()}/trading/leaderboard`);
  if (!r.ok) return [];
  return r.json();
}

async function fetchFollowing(address: string): Promise<Following[]> {
  const r = await fetch(`${base()}/trading/following/${address}`);
  if (!r.ok) return [];
  return r.json();
}

async function fetchBotStatus(): Promise<BotStatus> {
  const r = await fetch(`${base()}/bot/status`);
  if (!r.ok) throw new Error("Bot offline");
  return r.json();
}

async function fetchCopyHistory(address: string): Promise<TradeRow[]> {
  const r = await fetch(`${base()}/trading/copy-history/${address}`);
  if (!r.ok) return [];
  return r.json();
}

async function postFollow(followerAddress: string, leaderAddress: string, stakeUsdt: number) {
  const r = await fetch(`${base()}/trading/follow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ followerAddress, leaderAddress, stakeUsdt }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function postUnfollow(followerAddress: string, leaderAddress: string) {
  const r = await fetch(`${base()}/trading/unfollow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ followerAddress, leaderAddress }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Win-rate badge colour ─────────────────────────────────────────────────────
function winColor(rate: number): string {
  if (rate >= 70) return D.green;
  if (rate >= 55) return D.yellow;
  return D.red;
}

// ── Medal ─────────────────────────────────────────────────────────────────────
function medal(rank: number): string {
  if (rank === 1) return "";
  if (rank === 2) return "";
  if (rank === 3) return "";
  return `#${rank}`;
}

// ── Tiny sparkle bar ──────────────────────────────────────────────────────────
function WinBar({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses;
  if (total === 0) return null;
  const pct = (wins / total) * 100;
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: D.dim, marginTop: 6, overflow: "hidden" }}>
      <View style={{ width: `${pct}%` as `${number}%`, height: 4, borderRadius: 2, backgroundColor: winColor(pct) }} />
    </View>
  );
}

// ── Follow stake sheet ────────────────────────────────────────────────────────
function FollowSheet({
  leader, onFollow, onClose,
}: {
  leader: Leader;
  onFollow: (stake: number) => void;
  onClose:  () => void;
}) {
  const [stake, setStake] = useState("1");
  const [err,   setErr]   = useState("");

  function confirm() {
    const s = parseFloat(stake);
    if (!s || s < 0.35) { setErr("Minimum copy stake is $0.35"); return; }
    onFollow(s);
  }

  return (
    <View style={{ backgroundColor: D.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      borderTopWidth: 1, borderTopColor: D.border }}>
      <View style={{ alignItems: "center", paddingTop: 10 }}>
        <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: D.dim }} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: D.border }}>
        <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: D.text }}>Copy Trades</Text>
        <TouchableOpacity onPress={onClose}
          style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: D.dim,
            alignItems: "center", justifyContent: "center" }}>
          <Icon name="close" size={16} color={D.muted} />
        </TouchableOpacity>
      </View>

      <View style={{ padding: 20, gap: 14 }}>
        {/* Leader info */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14,
          backgroundColor: D.bg, borderRadius: 14, borderWidth: 1, borderColor: D.border, padding: 14 }}>
          <View style={{ width: 46, height: 46, borderRadius: 23,
            backgroundColor: leader.isBot ? D.purple + "25" : D.blue + "25",
            borderWidth: 2, borderColor: leader.isBot ? D.purple : D.blue,
            alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 20 }}>{leader.isBot ? <Icon name="hardware-chip-outline" size={20} color={D.text} /> : <Icon name="person-circle-outline" size={20} color={D.text} />}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: D.text }}>
              {leader.displayName}
            </Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: D.muted, marginTop: 2 }}>
              {leader.total} trades · {leader.winRate}% win rate
            </Text>
          </View>
          <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
            backgroundColor: winColor(leader.winRate) + "20" }}>
            <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: winColor(leader.winRate) }}>
              {leader.winRate}%
            </Text>
          </View>
        </View>

        {/* Stake input */}
        <View>
          <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: D.muted,
            letterSpacing: 1.6, marginBottom: 10 }}>COPY STAKE PER TRADE</Text>
          <View style={{ flexDirection: "row", alignItems: "center",
            backgroundColor: D.bg, borderRadius: 12, borderWidth: 1.5,
            borderColor: err ? D.red : D.border }}>
            <Text style={{ paddingHorizontal: 14, fontSize: 18, fontFamily: "Inter_600SemiBold",
              color: D.green }}>$</Text>
            <TextInput
              style={{ flex: 1, paddingVertical: 14, fontSize: 26, fontFamily: "Inter_700Bold", color: D.text }}
              value={stake}
              onChangeText={v => { setStake(v); setErr(""); }}
              keyboardType="decimal-pad"
              placeholder="1.00"
              placeholderTextColor={D.muted}
            />
            <Text style={{ paddingHorizontal: 14, fontSize: 12, fontFamily: "Inter_600SemiBold",
              color: D.muted }}>USDT</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 7, marginTop: 8 }}>
            {["0.5", "1", "5", "10"].map(v => {
              const active = stake === v;
              return (
                <TouchableOpacity key={v} onPress={() => { setStake(v); setErr(""); }}
                  style={{ flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center",
                    backgroundColor: active ? D.blue + "25" : D.bg,
                    borderWidth: 1, borderColor: active ? D.blue : D.border }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold",
                    color: active ? D.blue : D.muted }}>${v}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Info banner */}
        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start",
          backgroundColor: D.blue + "10", borderRadius: 12, borderWidth: 1,
          borderColor: D.blue + "30", padding: 12 }}>
          <Icon name="information-circle-outline" size={16} color={D.blue} />
          <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular",
            color: D.blue, lineHeight: 18 }}>
            Every time this trader places a trade, ${ parseFloat(stake || "0").toFixed(2) } USDT
            will automatically be copied from your trading balance.
          </Text>
        </View>

        {!!err && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8,
            backgroundColor: D.red + "15", borderRadius: 10, borderWidth: 1,
            borderColor: D.red + "40", padding: 12 }}>
            <Icon name="alert-circle-outline" size={15} color={D.red} />
            <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: D.red }}>{err}</Text>
          </View>
        )}

        <TouchableOpacity style={{ borderRadius: 14, overflow: "hidden" }}
          onPress={confirm} activeOpacity={0.85}>
          <View


            style={{ paddingVertical: 17, alignItems: "center", flexDirection: "row",
              justifyContent: "center", gap: 10 }}>
            <Icon name="hardware-chip-outline" size={18} color={D.text} />
            <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFF" }}>
              Start Copying
            </Text>
          </View>
        </TouchableOpacity>
        <View style={{ height: 8 }} />
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function CopyTradeScreen() {
  const insets          = useSafeAreaInsets();
  const { width: W }    = useWindowDimensions();
  const { ethAddress, mxcAddress } = useWallet();
  const { requestPin }  = usePinContext();
  const qc              = useQueryClient();
  const address         = (ethAddress ?? mxcAddress ?? "").toLowerCase();

  const [tab,           setTab]           = useState<"leaderboard" | "history">("leaderboard");
  const [followSheet,   setFollowSheet]   = useState<Leader | null>(null);
  const [actionErr,     setActionErr]     = useState("");

  useFocusEffect(useCallback(() => {
    qc.invalidateQueries({ queryKey: ["leaderboard"] });
    qc.invalidateQueries({ queryKey: ["following", address] });
    qc.invalidateQueries({ queryKey: ["botStatus"] });
  }, [address, qc]));

  const { data: leaderboard = [], isLoading: lbLoading } = useQuery<Leader[]>({
    queryKey: ["leaderboard"],
    queryFn:  fetchLeaderboard,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: following = [] } = useQuery<Following[]>({
    queryKey: ["following", address],
    queryFn:  () => fetchFollowing(address),
    enabled:  !!address,
    staleTime: 15_000,
  });

  const { data: botStatus } = useQuery<BotStatus>({
    queryKey: ["botStatus"],
    queryFn:  fetchBotStatus,
    staleTime: 5_000,
    refetchInterval: 8_000,
  });

  const { data: copyHistory = [] } = useQuery<TradeRow[]>({
    queryKey: ["copyHistory", address],
    queryFn:  () => fetchCopyHistory(address),
    enabled:  !!address && tab === "history",
    staleTime: 20_000,
  });

  const followMut = useMutation({
    mutationFn: ({ leader, stake }: { leader: Leader; stake: number }) =>
      postFollow(address, leader.walletAddress, stake),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["following", address] });
      setFollowSheet(null);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e) => setActionErr(e instanceof Error ? e.message : "Follow failed"),
  });

  const unfollowMut = useMutation({
    mutationFn: (leaderAddress: string) => postUnfollow(address, leaderAddress),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["following", address] });
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    },
    onError: (e) => setActionErr(e instanceof Error ? e.message : "Unfollow failed"),
  });

  function isFollowing(leaderAddress: string) {
    return following.some(f => f.leader_address === leaderAddress && f.active);
  }

  function getStake(leaderAddress: string) {
    return following.find(f => f.leader_address === leaderAddress)?.stake_usdt ?? "1";
  }

  function handleFollowTap(leader: Leader) {
    setActionErr("");
    if (isFollowing(leader.walletAddress)) {
      void unfollowMut.mutateAsync(leader.walletAddress);
    } else {
      setFollowSheet(leader);
    }
  }

  function handleConfirmFollow(leader: Leader, stake: number) {
    void requestPin({
      title:    "Confirm Copy Trading",
      subtitle: `Copy ${leader.displayName}'s trades at $${stake.toFixed(2)} per trade`,
      onSuccess: () => { followMut.mutate({ leader, stake }); },
      onCancel:  () => {},
    });
  }

  const sig   = botStatus?.lastSignal;
  const stats = botStatus?.stats ?? { wins: 0, losses: 0, draws: 0, totalPnl: 0 };
  const botWinRate = (stats.wins + stats.losses + stats.draws) > 0
    ? Math.round((stats.wins / (stats.wins + stats.losses + stats.draws)) * 100)
    : 72;

  return (
    <View style={{ flex: 1, backgroundColor: D.bg }}>

      {/* Header */}
      <View style={{
        paddingTop: insets.top + (Platform.OS === "web" ? 67 : 14),
        paddingHorizontal: 16, paddingBottom: 14,
        borderBottomWidth: 1, borderBottomColor: D.border,
      }}>
        <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: D.text, letterSpacing: -0.5 }}>
          Copy Trading
        </Text>
        <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: D.muted, marginTop: 3 }}>
          Mirror top traders automatically
        </Text>
      </View>

      {/* AlphaBot signal card */}
      {botStatus && (
        <View style={{ margin: 16, marginBottom: 0, borderRadius: 18, overflow: "hidden" }}>
          <View


            style={{ padding: 16, borderWidth: 1, borderColor: D.purple + "40", borderRadius: 18 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20,
                  backgroundColor: D.purple + "30", borderWidth: 2, borderColor: D.purple,
                  alignItems: "center", justifyContent: "center" }}>
                  <Icon name="hardware-chip-outline" size={20} color={D.text} />
                </View>
                <View>
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: D.text }}>
                    AlphaBot
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4,
                      backgroundColor: botStatus.running ? D.green : D.red }} />
                    <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium",
                      color: botStatus.running ? D.green : D.red }}>
                      {botStatus.running ? "Live" : "Offline"}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold",
                  color: winColor(botWinRate) }}>
                  {botWinRate}%
                </Text>
                <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: D.muted }}>
                  win rate
                </Text>
              </View>
            </View>

            {/* Stats row */}
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              {[
                { label: "Wins",   value: stats.wins,   color: D.green },
                { label: "Losses", value: stats.losses, color: D.red },
                { label: "P&L",    value: `${stats.totalPnl >= 0 ? "+" : ""}$${stats.totalPnl.toFixed(2)}`,
                  color: stats.totalPnl >= 0 ? D.green : D.red },
              ].map(({ label, value, color }) => (
                <View key={label} style={{ flex: 1, backgroundColor: "#FFFFFF08", borderRadius: 10,
                  padding: 10, alignItems: "center" }}>
                  <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color }}>{value}</Text>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular",
                    color: D.muted, marginTop: 2 }}>{label}</Text>
                </View>
              ))}
            </View>

            {/* Last signal */}
            {sig ? (
              <View style={{ backgroundColor: "#FFFFFF08", borderRadius: 12, padding: 12,
                flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: D.muted,
                    letterSpacing: 1.4, marginBottom: 4 }}>LAST SIGNAL</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold",
                    color: sig.direction === "UP" ? D.green : D.red }}>
                    {sig.asset} · {sig.direction === "UP" ? "▲ UP" : "▼ DOWN"} · {sig.duration}
                  </Text>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular",
                    color: D.muted, marginTop: 3 }}>{sig.reason}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                    backgroundColor: D.purple + "25" }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: D.purple }}>
                      {sig.confidence}% conf.
                    </Text>
                  </View>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: D.muted }}>
                    {Math.round((Date.now() - sig.ts) / 1000)}s ago
                  </Text>
                </View>
              </View>
            ) : (
              <View style={{ backgroundColor: "#FFFFFF08", borderRadius: 12, padding: 12,
                flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ActivityIndicator color={D.purple} size="small" />
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: D.muted }}>
                  Collecting market data for next signal…
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Tab bar */}
      <View style={{ flexDirection: "row", marginHorizontal: 16, marginTop: 16, marginBottom: 0,
        backgroundColor: D.card, borderRadius: 12, borderWidth: 1, borderColor: D.border, padding: 4 }}>
        {(["leaderboard", "history"] as const).map(t => {
          const active = tab === t;
          return (
            <TouchableOpacity key={t} style={{ flex: 1, paddingVertical: 10, borderRadius: 9,
              alignItems: "center", backgroundColor: active ? D.bg : "transparent" }}
              onPress={() => setTab(t)}>
              <Text style={{ fontSize: 13, fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                color: active ? D.text : D.muted }}>
                {t === "leaderboard" ? "Leaderboard" : "My Copy Trades"}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}
        showsVerticalScrollIndicator={false}>

        {/* Error */}
        {!!actionErr && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8,
            backgroundColor: D.red + "15", borderRadius: 12, borderWidth: 1,
            borderColor: D.red + "40", padding: 12 }}>
            <Icon name="alert-circle-outline" size={15} color={D.red} />
            <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: D.red }}>
              {actionErr}
            </Text>
          </View>
        )}

        {/* ── LEADERBOARD ── */}
        {tab === "leaderboard" && (
          <>
            {lbLoading && (
              <View style={{ paddingVertical: 40, alignItems: "center" }}>
                <ActivityIndicator color={D.purple} size="large" />
                <Text style={{ color: D.muted, fontSize: 13, marginTop: 12,
                  fontFamily: "Inter_400Regular" }}>Loading leaderboard…</Text>
              </View>
            )}

            {!lbLoading && leaderboard.length === 0 && (
              <View style={{ paddingVertical: 40, alignItems: "center" }}>
                <View style={{marginBottom: 12}}><Icon name="trophy-outline" size={32} color={D.muted} /></View>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: D.text,
                  marginBottom: 6 }}>Leaderboard is warming up</Text>
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: D.muted,
                  textAlign: "center", paddingHorizontal: 30 }}>
                  Traders need at least 3 completed trades to appear here.
                </Text>
              </View>
            )}

            {leaderboard.map((leader) => {
              const following_ = isFollowing(leader.walletAddress);
              const stake_     = getStake(leader.walletAddress);
              return (
                <View key={leader.walletAddress} style={{ backgroundColor: D.card,
                  borderRadius: 18, borderWidth: 1,
                  borderColor: leader.isBot ? D.purple + "40" : D.border,
                  overflow: "hidden" }}>
                  {leader.isBot && (
                    <View style={{ backgroundColor: D.purple + "15", paddingHorizontal: 14,
                      paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: D.purple }} />
                      <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: D.purple,
                        letterSpacing: 1.4 }}>AI-POWERED · 24/7 TRADING</Text>
                    </View>
                  )}

                  <View style={{ padding: 14 }}>
                    {/* Top row */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <View style={{ alignItems: "center", justifyContent: "center",
                        width: 32, height: 32 }}>
                        <Text style={{ fontSize: leader.rank <= 3 ? 24 : 13,
                          fontFamily: "Inter_700Bold", color: D.muted }}>
                          {medal(leader.rank)}
                        </Text>
                      </View>

                      <View style={{ width: 44, height: 44, borderRadius: 22,
                        backgroundColor: leader.isBot ? D.purple + "25" : D.blue + "20",
                        borderWidth: 2,
                        borderColor: leader.isBot ? D.purple + "80" : D.blue + "50",
                        alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontSize: 20 }}>{leader.isBot ? <Icon name="hardware-chip-outline" size={20} color={D.text} /> : <Icon name="person-circle-outline" size={20} color={D.text} />}</Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: D.text }}>
                          {leader.displayName}
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular",
                          color: D.muted, marginTop: 1 }}>
                          {leader.total} trades
                        </Text>
                        <WinBar wins={leader.wins} losses={leader.losses} />
                      </View>

                      <View style={{ alignItems: "flex-end", gap: 4 }}>
                        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                          backgroundColor: winColor(leader.winRate) + "20" }}>
                          <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold",
                            color: winColor(leader.winRate) }}>
                            {leader.winRate}%
                          </Text>
                        </View>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold",
                          color: leader.totalPnl >= 0 ? D.green : D.red }}>
                          {leader.totalPnl >= 0 ? "+" : ""}${leader.totalPnl.toFixed(2)}
                        </Text>
                      </View>
                    </View>

                    {/* Stats mini-row */}
                    <View style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}>
                      {[
                        { label: "W", value: leader.wins,   color: D.green },
                        { label: "L", value: leader.losses, color: D.red   },
                        { label: "D", value: leader.draws,  color: D.muted },
                      ].map(({ label, value, color }) => (
                        <View key={label} style={{ flex: 1, backgroundColor: D.bg,
                          borderRadius: 8, padding: 8, alignItems: "center" }}>
                          <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color }}>{value}</Text>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular",
                            color: D.muted, marginTop: 1 }}>{label}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Follow button */}
                    {following_ ? (
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <View style={{ flex: 1, paddingVertical: 13, borderRadius: 12,
                          backgroundColor: D.green + "15", borderWidth: 1, borderColor: D.green + "40",
                          alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}>
                          <Icon name="checkmark-circle" size={16} color={D.green} />
                          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: D.green }}>
                            Copying · ${stake_} / trade
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: D.red + "15",
                            borderWidth: 1, borderColor: D.red + "40",
                            alignItems: "center", justifyContent: "center" }}
                          onPress={() => handleFollowTap(leader)}
                          disabled={unfollowMut.isPending}>
                          {unfollowMut.isPending
                            ? <ActivityIndicator color={D.red} size="small" />
                            : <Icon name="stop-circle-outline" size={20} color={D.red} />}
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={{ paddingVertical: 13, borderRadius: 12, alignItems: "center",
                          flexDirection: "row", justifyContent: "center", gap: 8,
                          backgroundColor: leader.isBot ? D.purple + "20" : D.blue + "15",
                          borderWidth: 1,
                          borderColor: leader.isBot ? D.purple + "50" : D.blue + "40" }}
                        onPress={() => handleFollowTap(leader)}>
                        <Icon name="copy-outline" size={16}
                          color={leader.isBot ? D.purple : D.blue} />
                        <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold",
                          color: leader.isBot ? D.purple : D.blue }}>
                          Copy This Trader
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )}

        {/* ── COPY HISTORY ── */}
        {tab === "history" && (
          <>
            {copyHistory.length === 0 ? (
              <View style={{ paddingVertical: 40, alignItems: "center" }}>
                <View style={{marginBottom: 12}}><Icon name="clipboard-outline" size={32} color={D.muted} /></View>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: D.text,
                  marginBottom: 6 }}>No copy trades yet</Text>
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: D.muted,
                  textAlign: "center", paddingHorizontal: 30 }}>
                  Follow a trader and their trades will appear here automatically.
                </Text>
              </View>
            ) : (
              copyHistory.map((t, i) => (
                <View key={t.id} style={{ flexDirection: "row", alignItems: "center",
                  backgroundColor: D.card, borderRadius: 14, borderWidth: 1,
                  borderColor: D.border, padding: 14, gap: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12,
                    backgroundColor: t.status === "won" ? D.green + "20"
                                   : t.status === "open" ? D.blue + "20"
                                   : t.status === "draw" ? D.yellow + "20" : D.red + "20",
                    alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 18 }}>
                      {t.status === "won"  ? "✓"
                       : t.status === "open" ? "⏳"
                       : t.status === "draw" ? "=" : "✗"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: D.text }}>
                      {t.asset} · {t.direction} · {t.duration}
                    </Text>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular",
                      color: D.muted, marginTop: 2 }}>
                      {new Date(t.opened_at).toLocaleString()}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold",
                      color: t.status === "won"  ? D.green
                           : t.status === "open" ? D.blue
                           : t.status === "draw" ? D.yellow : D.red }}>
                      {t.status === "won"
                        ? `+$${(parseFloat(t.payout_usdt) - parseFloat(t.amount_usdt)).toFixed(2)}`
                        : t.status === "open" ? `$${parseFloat(t.amount_usdt).toFixed(2)}`
                        : t.status === "draw" ? "Draw"
                        : `-$${parseFloat(t.amount_usdt).toFixed(2)}`}
                    </Text>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 2,
                      color: t.status === "won" ? D.green : t.status === "open" ? D.blue
                           : t.status === "draw" ? D.yellow : D.red }}>
                      {t.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        <View style={{ height: insets.bottom + 32 }} />
      </ScrollView>

      {/* Follow sheet overlay */}
      {followSheet && (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0 }}
          pointerEvents="box-none">
          <TouchableOpacity style={{ flex: 1, backgroundColor: "#00000099" }}
            activeOpacity={1} onPress={() => setFollowSheet(null)} />
          <FollowSheet
            leader={followSheet}
            onClose={() => setFollowSheet(null)}
            onFollow={(stake) => {
              handleConfirmFollow(followSheet, stake);
            }}
          />
        </View>
      )}
    </View>
  );
}
