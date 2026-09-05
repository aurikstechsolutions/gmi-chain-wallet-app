import { Icon } from "@/components/Icon";
import { usePinContext } from "@/context/PinContext";
import { useWallet } from "@/context/WalletContext";
import { api, getPublicApiBase, initCardAccount, verifyCardDeposit } from "@/services/api";
import { buildErc20TransferDataHex } from "@/services/crypto";
import { fetchTokenBalanceRaw } from "@/services/tokens";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Defs,
  Line as SvgLine,
  LinearGradient as SvgGrad,
  Path,
  Stop,
  Text as SvgText,
} from "react-native-svg";

// ── Design tokens for the light GMI Wallet trading experience ────────────────
const D = {
  bg:       "#F6F8FB",
  card:     "#FFFFFF",
  card2:    "#EEF4FA",
  border:   "#D9E2EC",
  text:     "#101828",
  muted:    "#667085",
  dim:      "#D0D5DD",
  green:    "#039855",
  red:      "#D92D20",
  yellow:   "#F0B90B",
  blue:     "#3B82F6",
  purple:   "#8B5CF6",
  cyan:     "#06B6D4",
};

// ── Asset config ──────────────────────────────────────────────────────────────
type Asset    = "V100" | "V50" | "GOLD" | "EURUSD";
type Dir      = "UP" | "DOWN";
type Duration = "1m" | "5m" | "15m" | "1h";
type Screen   = "trade" | "active" | "result";

const ASSETS: Asset[]  = ["V100", "V50", "GOLD", "EURUSD"];

const ASSET_TAG: Record<Asset, string>   = { V100: "VOL100", V50: "VOL50", GOLD: "XAU/USD", EURUSD: "EUR/USD" };
const ASSET_LABEL: Record<Asset, string> = { V100: "Volatility 100 Index", V50: "Volatility 50 Index", GOLD: "Gold / USD", EURUSD: "EUR / USD" };
const ASSET_COLOR: Record<Asset, string> = { V100: D.purple, V50: D.cyan, GOLD: D.yellow, EURUSD: D.blue };

const DURATIONS: Duration[] = ["1m", "5m", "15m", "1h"];
const DURATION_LABEL: Record<Duration, string> = { "1m": "1 Min", "5m": "5 Min", "15m": "15 Min", "1h": "1 Hour" };
const DURATION_MS: Record<Duration, number>    = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000 };

// ── Interfaces ────────────────────────────────────────────────────────────────
interface Candle { epoch: number; open: number; high: number; low: number; close: number }
interface Prices  { V100: number; V50: number; GOLD: number; EURUSD: number }
interface Proposal { proposalId: string; payout: number; askPrice: number; spotPrice: number; longCode: string }
interface Trade    { tradeId: string; asset: Asset; direction: Dir; amount: number; payout: number; entryPrice: number; expiresAt: string; status: string }
interface TradeResult {
  id: string; asset: string; direction: string; duration: string; amount_usdt: number;
  payout_usdt: number; entry_price: number; exit_price: number | null;
  status: string; opened_at: string; resolved_at: string | null;
}

// ── Price formatting ──────────────────────────────────────────────────────────
function fmt(p: number): string {
  if (!p) return "—";
  if (p >= 10000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 100)   return p.toFixed(3);
  return p.toFixed(5);
}

function fmtCd(expiresAt: string): string {
  const diff = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const s = Math.floor(diff / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── SVG Price Chart ───────────────────────────────────────────────────────────
interface ChartProps {
  prices: number[];
  width: number;
  height: number;
  color: string;
  entryPrice?: number | null;
}

function PriceChart({ prices, width, height, color, entryPrice }: ChartProps) {
  if (prices.length < 2) {
    return (
      <View style={{ width, height, alignItems: "center", justifyContent: "center", backgroundColor: D.bg }}>
        <ActivityIndicator color={color} />
        <Text style={{ color: D.muted, fontSize: 11, marginTop: 8, fontFamily: "Inter_400Regular" }}>
          Loading chart…
        </Text>
      </View>
    );
  }

  const pH = 56;  // right padding for price labels
  const pL = 6;   // left padding
  const pV = 10;  // vertical padding
  const w  = width  - pH - pL;
  const h  = height - pV * 2;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || min * 0.001 || 1;
  const pad   = range * 0.12;
  const yMin  = min - pad;
  const yMax  = max + pad;
  const yRange = yMax - yMin;

  const toX = (i: number) => pL + (i / (prices.length - 1)) * w;
  const toY = (p: number) => pV + h - ((p - yMin) / yRange) * h;

  const pts = prices.map((p, i) =>
    `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p).toFixed(1)}`
  ).join(" ");

  const lastX = toX(prices.length - 1);
  const lastY = toY(prices[prices.length - 1]);
  const area  = `${pts} L${lastX.toFixed(1)},${(pV + h).toFixed(1)} L${pL},${(pV + h).toFixed(1)} Z`;

  const entryY = (entryPrice != null)
    ? Math.min(pV + h, Math.max(pV, toY(entryPrice)))
    : null;

  const priceUp = prices[prices.length - 1] >= prices[0];

  const gridPrices = [max, (max + min) / 2, min];

  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgGrad id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%"    stopColor={color} stopOpacity="0.28" />
          <Stop offset="60%"   stopColor={color} stopOpacity="0.06" />
          <Stop offset="100%"  stopColor={color} stopOpacity="0" />
        </SvgGrad>
      </Defs>

      {/* Horizontal grid lines */}
      {gridPrices.map((gp, i) => (
        <SvgLine
          key={i}
          x1={pL} y1={toY(gp)} x2={width - pH + 2} y2={toY(gp)}
          stroke={D.border} strokeWidth="1"
        />
      ))}

      {/* Area fill */}
      <Path d={area} fill="url(#chartFill)" />

      {/* Main price line */}
      <Path d={pts} stroke={color} strokeWidth="2" fill="none"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* Entry price dashed line */}
      {entryY !== null && (
        <>
          <SvgLine
            x1={pL} y1={entryY!} x2={width - pH + 2} y2={entryY!}
            stroke={D.yellow} strokeWidth="1.5" strokeDasharray="6,4" opacity="0.9"
          />
          <SvgText
            x={width - pH + 6} y={entryY! + 4}
            fontSize="9" fill={D.yellow} fontFamily="monospace"
          >
            entry
          </SvgText>
        </>
      )}

      {/* Price labels on right axis */}
      {gridPrices.map((gp, i) => (
        <SvgText
          key={i}
          x={width - pH + 6} y={toY(gp) + 4}
          fontSize="9.5" fill={D.muted} fontFamily="monospace"
        >
          {fmt(gp)}
        </SvgText>
      ))}

      {/* Current price label */}
      <SvgText
        x={width - pH + 6} y={lastY + 4}
        fontSize="9.5" fill={color} fontFamily="monospace" fontWeight="bold"
      >
        {fmt(prices[prices.length - 1])}
      </SvgText>

      {/* Pulse rings at current price */}
      <Circle cx={lastX} cy={lastY} r="12" fill={color} opacity="0.08" />
      <Circle cx={lastX} cy={lastY} r="6"  fill={color} opacity="0.2" />
      <Circle cx={lastX} cy={lastY} r="3"  fill={color} />

      {/* Vertical dotted line at current price */}
      <SvgLine
        x1={lastX} y1={pV} x2={lastX} y2={pV + h}
        stroke={color} strokeWidth="1" strokeDasharray="3,4" opacity="0.25"
      />
    </Svg>
  );
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiCandles(asset: Asset): Promise<number[]> {
  const r = await fetch(`${getPublicApiBase()}/trading/candles/${asset}?count=200&granularity=60`);
  if (!r.ok) return [];
  const c: Candle[] = await r.json();
  return c.map(x => x.close);
}

async function apiPrices(): Promise<Prices> {
  const r = await fetch(`${getPublicApiBase()}/trading/prices`);
  if (!r.ok) throw new Error("Prices unavailable");
  return r.json();
}

async function apiProposal(asset: Asset, dir: Dir, amount: number, dur: Duration): Promise<Proposal> {
  const r = await fetch(`${getPublicApiBase()}/trading/proposal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset, direction: dir, amount, duration: dur }),
  });
  const d = await r.json() as Proposal & { error?: string };
  if (!r.ok) throw new Error(d.error ?? "Quote failed");
  return d;
}

async function apiOpenTrade(p: { walletAddress: string; asset: Asset; direction: Dir; amount: number; duration: Duration }): Promise<Trade> {
  const r = await fetch(`${getPublicApiBase()}/trading/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  const d = await r.json() as Trade & { error?: string };
  if (!r.ok) throw new Error(d.error ?? "Trade failed");
  return d;
}

async function apiTradeStatus(tradeId: string): Promise<TradeResult> {
  const r = await fetch(`${getPublicApiBase()}/trading/trade/${tradeId}`);
  if (!r.ok) throw new Error("Status unavailable");
  return r.json();
}

async function apiBalance(address: string): Promise<number> {
  const r = await fetch(`${getPublicApiBase()}/trading/balance/${address}`);
  if (!r.ok) return 0;
  return ((await r.json()) as { balance: number }).balance ?? 0;
}

async function apiHistory(address: string): Promise<TradeResult[]> {
  const r = await fetch(`${getPublicApiBase()}/trading/history/${address}`);
  if (!r.ok) return [];
  return r.json();
}

// ── Deposit Modal ─────────────────────────────────────────────────────────────
const USDT_CONTRACT = "0x07daf7bda0aaea88e910879b2cd6ec9ecdc87238";
const USDT_DECIMALS = 6;
type DepositStep = "input" | "broadcasting" | "confirming" | "verifying" | "success" | "error";

interface DepositModalProps {
  visible: boolean;
  onClose: () => void;
  address: string;
  tradingBalance: number;
  onSuccess: () => void;
}

function DepositModal({ visible, onClose, address, tradingBalance, onSuccess }: DepositModalProps) {
  const { getPrivateKey }  = useWallet();
  const { requestPin }     = usePinContext();
  const insets             = useSafeAreaInsets();
  const slideAnim          = useRef(new Animated.Value(700)).current;
  const overlayOpacity     = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);

  const [amount,     setAmount]     = useState("10");
  const [step,       setStep]       = useState<DepositStep>("input");
  const [statusMsg,  setStatusMsg]  = useState("");
  const [newBalance, setNewBalance] = useState<number | null>(null);
  const [depositErr, setDepositErr] = useState("");

  const { data: walletBalRaw } = useQuery<bigint>({
    queryKey: ["t_walletBal", address],
    queryFn:  () => fetchTokenBalanceRaw(USDT_CONTRACT, address) as Promise<bigint>,
    enabled:  !!address && visible,
    staleTime: 10000,
  });
  const walletBal = walletBalRaw ? Number(walletBalRaw) / Math.pow(10, USDT_DECIMALS) : 0;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setStep("input"); setDepositErr(""); setStatusMsg(""); setNewBalance(null);
      Animated.parallel([
        Animated.spring(slideAnim,      { toValue: 0,   useNativeDriver: true, bounciness: 4 }),
        Animated.timing(overlayOpacity, { toValue: 1,   duration: 250, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim,      { toValue: 700, duration: 260, useNativeDriver: true }),
        Animated.timing(overlayOpacity, { toValue: 0,   duration: 200, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  async function performDeposit() {
    try {
      const amt = parseFloat(amount);
      setStep("broadcasting");

      setStatusMsg("Preparing transaction…");
      const { account } = await initCardAccount(address);
      const depositAddr  = account.deposit_address;

      setStatusMsg("Broadcasting transaction…");
      const amountRaw = BigInt(Math.round(amt * Math.pow(10, USDT_DECIMALS)));
      const { nonce } = await api.getAccount(address);
      const data      = buildErc20TransferDataHex(depositAddr, amountRaw);
      const privateKey = await getPrivateKey();
      if (!privateKey) throw new Error("Could not retrieve private key — please unlock your wallet and retry");
      const { txHash } = await api.sendTransaction({
        fromAddress: address,
        toAddress: USDT_CONTRACT,
        amount: "0",
        data,
        txType: "contract_call",
        nonce,
        privateKey,
      });

      setStep("confirming");
      setStatusMsg("Waiting for 2 confirmations…");
      await api.waitForReceipt(txHash);

      setStep("verifying");
      setStatusMsg("Crediting trading balance…");
      await verifyCardDeposit(address);

      const balRes = await fetch(`${getPublicApiBase()}/trading/balance/${address}`);
      const balData = (await balRes.json()) as { balance: number };
      setNewBalance(balData.balance ?? 0);

      setStep("success");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
    } catch (err) {
      setDepositErr(err instanceof Error ? err.message : "Deposit failed");
      setStep("error");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  function handleDepositTap() {
    const amt = parseFloat(amount);
    if (!amt || amt < 0.01) { setDepositErr("Enter a valid amount"); return; }
    if (amt > walletBal)    { setDepositErr(`Max available: ${walletBal.toFixed(2)} USDT`); return; }
    setDepositErr("");
    void requestPin({
      title:    "Confirm Deposit",
      subtitle: `Transfer $${amt.toFixed(2)} USDT from your wallet to your trading balance`,
      onSuccess: async () => {
        void performDeposit();
      },
      onCancel: () => {},
    });
  }

  if (!mounted) return null;

  const canDismiss = step === "input" || step === "error";

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      {/* Dim overlay */}
      <Animated.View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: "#000", opacity: Animated.multiply(overlayOpacity, new Animated.Value(0.65)) }]}
        pointerEvents={canDismiss ? "auto" : "none"}>
        <TouchableOpacity style={{ flex: 1 }} onPress={canDismiss ? onClose : undefined} activeOpacity={1} />
      </Animated.View>

      {/* Bottom sheet */}
      <Animated.View style={{ position: "absolute", left: 0, right: 0, bottom: 0,
        transform: [{ translateY: slideAnim }] }}>
        <View style={{ backgroundColor: D.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTopWidth: 1, borderTopColor: D.border }}>

          {/* Handle */}
          <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 2 }}>
            <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: D.dim }} />
          </View>

          {/* Sheet header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            paddingHorizontal: 20, paddingVertical: 14,
            borderBottomWidth: 1, borderBottomColor: D.border }}>
            <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: D.text }}>
              Deposit to Trading
            </Text>
            {canDismiss && (
              <TouchableOpacity onPress={onClose}
                style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: D.dim,
                  alignItems: "center", justifyContent: "center" }}>
                <Icon name="close" size={16} color={D.muted} />
              </TouchableOpacity>
            )}
          </View>

          {/* ── INPUT / ERROR ── */}
          {(step === "input" || step === "error") && (
            <View style={{ padding: 20, gap: 14 }}>
              {/* Balance cards */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                {[
                  { label: "WALLET BALANCE", value: `${walletBal.toFixed(2)}`, color: D.text },
                  { label: "TRADING BALANCE", value: `$${tradingBalance.toFixed(2)}`, color: D.green },
                ].map(({ label, value, color }) => (
                  <View key={label} style={{ flex: 1, backgroundColor: D.bg, borderRadius: 12,
                    borderWidth: 1, borderColor: D.border, padding: 12 }}>
                    <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: D.muted,
                      letterSpacing: 1.4, marginBottom: 5 }}>{label}</Text>
                    <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color }}>
                      {value} <Text style={{ fontSize: 11, color: D.muted }}>USDT</Text>
                    </Text>
                  </View>
                ))}
              </View>

              {/* Amount input */}
              <View>
                <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: D.muted,
                  letterSpacing: 1.6, marginBottom: 10 }}>AMOUNT TO DEPOSIT</Text>
                <View style={{ flexDirection: "row", alignItems: "center",
                  backgroundColor: D.bg, borderRadius: 12, borderWidth: 1.5,
                  borderColor: depositErr ? D.red : D.border, overflow: "hidden" }}>
                  <Text style={{ paddingHorizontal: 16, fontSize: 20, fontFamily: "Inter_600SemiBold",
                    color: D.green }}>$</Text>
                  <TextInput
                    style={{ flex: 1, paddingVertical: 14, fontSize: 28, fontFamily: "Inter_700Bold",
                      color: D.text }}
                    value={amount}
                    onChangeText={v => { setAmount(v); setDepositErr(""); }}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={D.muted}
                    autoFocus={false}
                  />
                  <Text style={{ paddingHorizontal: 14, fontSize: 12, fontFamily: "Inter_600SemiBold",
                    color: D.muted }}>USDT</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 7, marginTop: 10 }}>
                  {["5", "10", "25", "50"].map(v => {
                    const active = amount === v;
                    return (
                      <TouchableOpacity key={v}
                        onPress={() => { setAmount(v); setDepositErr(""); }}
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

              {/* Transfer summary */}
              <View style={{ backgroundColor: D.bg, borderRadius: 12, borderWidth: 1,
                borderColor: D.border, padding: 14, gap: 10 }}>
                {[
                  { label: "From",    value: "Your Wallet",     icon: "wallet-outline" as const },
                  { label: "To",      value: "Trading Balance", icon: "trending-up-outline" as const },
                  { label: "Network", value: "GMI Chain · ~8s", icon: "flash-outline" as const },
                ].map(({ label, value, icon }) => (
                  <View key={label} style={{ flexDirection: "row", alignItems: "center",
                    justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: D.muted }}>{label}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Icon name={icon} size={13} color={D.muted} />
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: D.text }}>{value}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* Error */}
              {!!depositErr && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8,
                  backgroundColor: D.red + "15", borderRadius: 10, borderWidth: 1,
                  borderColor: D.red + "40", padding: 12 }}>
                  <Icon name="alert-circle-outline" size={15} color={D.red} />
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: D.red }}>
                    {depositErr}
                  </Text>
                </View>
              )}

              {/* CTA */}
              <TouchableOpacity style={{ borderRadius: 14, overflow: "hidden" }}
                onPress={handleDepositTap} activeOpacity={0.85}>
                <View


                  style={{ paddingVertical: 17, alignItems: "center", flexDirection: "row",
                    justifyContent: "center", gap: 10 }}>
                  <Icon name="lock-closed-outline" size={16} color="#FFF" />
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFF" }}>
                    Deposit ${parseFloat(amount || "0").toFixed(2)} USDT
                  </Text>
                </View>
              </TouchableOpacity>
              <View style={{ height: insets.bottom + 88 }} />
            </View>
          )}

          {/* ── PROCESSING ── */}
          {(step === "broadcasting" || step === "confirming" || step === "verifying") && (
            <View style={{ padding: 36, alignItems: "center", gap: 24 }}>
              <View style={{ width: 80, height: 80, borderRadius: 40,
                backgroundColor: D.blue + "18", borderWidth: 2, borderColor: D.blue + "40",
                alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator color={D.blue} size="large" />
              </View>
              <View style={{ alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: D.text }}>
                  {step === "broadcasting" ? "Sending Transaction"
                   : step === "confirming"  ? "Confirming on Chain"
                   : "Crediting Balance"}
                </Text>
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: D.muted,
                  textAlign: "center", lineHeight: 20 }}>
                  {statusMsg}
                </Text>
              </View>
              <View style={{ width: "100%", gap: 8 }}>
                {([
                  { label: "Transaction signed",     done: true },
                  { label: "Broadcast to network",   done: step !== "broadcasting" },
                  { label: "Block confirmed",         done: step === "verifying" },
                  { label: "Balance credited",        done: false },
                ] as { label: string; done: boolean }[]).map(({ label, done }, i) => (
                  <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11,
                      backgroundColor: done ? D.green + "25" : D.dim,
                      borderWidth: 1.5, borderColor: done ? D.green : D.border,
                      alignItems: "center", justifyContent: "center" }}>
                      {done
                        ? <Icon name="checkmark" size={12} color={D.green} />
                        : <Text style={{ fontSize: 9, color: D.muted, fontFamily: "Inter_600SemiBold" }}>{i + 1}</Text>}
                    </View>
                    <Text style={{ fontSize: 13, fontFamily: done ? "Inter_600SemiBold" : "Inter_400Regular",
                      color: done ? D.text : D.muted }}>
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={{ height: 12 }} />
            </View>
          )}

          {/* ── SUCCESS ── */}
          {step === "success" && (
            <View style={{ padding: 32, alignItems: "center", gap: 18 }}>
              <View style={{ width: 84, height: 84, borderRadius: 42,
                backgroundColor: D.green + "18", borderWidth: 2, borderColor: D.green + "50",
                alignItems: "center", justifyContent: "center" }}>
                <Icon name="checkmark-circle" size={48} color={D.green} />
              </View>
              <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: D.green }}>
                Deposit Successful!
              </Text>
              <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: D.muted,
                textAlign: "center" }}>
                ${parseFloat(amount).toFixed(2)} USDT added to your trading balance
              </Text>
              {newBalance !== null && (
                <View style={{ backgroundColor: D.bg, borderRadius: 14, borderWidth: 1,
                  borderColor: D.border, padding: 16, width: "100%", alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: D.muted,
                    letterSpacing: 1.6 }}>NEW TRADING BALANCE</Text>
                  <Text style={{ fontSize: 30, fontFamily: "Inter_700Bold", color: D.green,
                    letterSpacing: -1 }}>
                    ${newBalance.toFixed(2)} USDT
                  </Text>
                </View>
              )}
              <TouchableOpacity style={{ width: "100%", borderRadius: 14, overflow: "hidden" }}
                onPress={onClose} activeOpacity={0.85}>
                <View
                  style={{ paddingVertical: 16, alignItems: "center", flexDirection: "row",
                    justifyContent: "center", gap: 8 }}>
                  <Icon name="trending-up-outline" size={18} color="#FFF" />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" }}>
                    Start Trading
                  </Text>
                </View>
              </TouchableOpacity>
              <View style={{ height: 10 }} />
            </View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function TradeScreen() {
  const { width: W }  = useWindowDimensions();
  const insets        = useSafeAreaInsets();
  const { ethAddress, mxcAddress } = useWallet();
  const qc            = useQueryClient();
  const address       = (ethAddress ?? mxcAddress ?? "").toLowerCase();

  const [asset,       setAsset]       = useState<Asset>("V100");
  const [dir,         setDir]         = useState<Dir>("UP");
  const [duration,    setDuration]    = useState<Duration>("1m");
  const [amount,      setAmount]      = useState("1");
  const [screen,      setScreen]      = useState<Screen>("trade");
  const [activeTrade, setActiveTrade] = useState<Trade | null>(null);
  const [result,      setResult]      = useState<TradeResult | null>(null);
  const [err,         setErr]         = useState("");
  const [countdown,   setCountdown]   = useState("");
  const [showHistory,  setShowHistory]  = useState(false);
  const [showDeposit,  setShowDeposit]  = useState(false);
  const [chartData,    setChartData]    = useState<Record<Asset, number[]>>({ V100: [], V50: [], GOLD: [], EURUSD: [] });

  const priceFlash    = useRef(new Animated.Value(1)).current;
  const prevPriceRef  = useRef<Partial<Prices>>({});
  const loadedRef     = useRef<Set<Asset>>(new Set());

  const CHART_H = 230;
  const activeAsset = screen === "active" && activeTrade ? activeTrade.asset : asset;
  const chartColor  = screen === "active" && activeTrade
    ? (activeTrade.direction === "UP" ? D.green : D.red)
    : ASSET_COLOR[asset];

  // Load candle history
  useEffect(() => {
    if (loadedRef.current.has(asset)) return;
    loadedRef.current.add(asset);
    apiCandles(asset).then(prices => {
      if (prices.length > 0) setChartData(prev => ({ ...prev, [asset]: prices }));
    }).catch(() => {});
  }, [asset]);

  useFocusEffect(useCallback(() => {
    qc.invalidateQueries({ queryKey: ["t_prices"] });
  }, [qc]));

  // Live prices (2 s)
  const { data: prices } = useQuery<Prices>({
    queryKey: ["t_prices"],
    queryFn:  apiPrices,
    refetchInterval: 2000,
    staleTime:       1500,
  });

  // Append live price to chart
  useEffect(() => {
    if (!prices) return;
    const cur  = prices[asset];
    const prev = prevPriceRef.current[asset];
    if (prev !== undefined && prev !== cur) {
      Animated.sequence([
        Animated.timing(priceFlash, { toValue: 0.15, duration: 60, useNativeDriver: true }),
        Animated.timing(priceFlash, { toValue: 1,    duration: 220, useNativeDriver: true }),
      ]).start();
    }
    prevPriceRef.current = { ...prevPriceRef.current, [asset]: cur };
    setChartData(prev => ({ ...prev, [asset]: [...prev[asset], cur].slice(-300) }));
  }, [prices?.[asset]]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: balance = 0, refetch: refetchBalance } = useQuery<number>({
    queryKey: ["t_balance", address],
    queryFn:  () => apiBalance(address),
    enabled:  !!address,
    staleTime: 15000,
  });

  const { data: history = [] } = useQuery<TradeResult[]>({
    queryKey: ["t_history", address],
    queryFn:  () => apiHistory(address),
    enabled:  !!address && showHistory,
    staleTime: 30000,
  });

  // Countdown
  useEffect(() => {
    if (screen !== "active" || !activeTrade) return;
    const t = setInterval(() => setCountdown(fmtCd(activeTrade.expiresAt)), 400);
    return () => clearInterval(t);
  }, [screen, activeTrade]);

  // Poll trade status
  const { data: liveStatus } = useQuery<TradeResult>({
    queryKey: ["t_status", activeTrade?.tradeId],
    queryFn:  () => apiTradeStatus(activeTrade!.tradeId),
    enabled:  screen === "active" && !!activeTrade,
    refetchInterval: 3500,
    staleTime:       3000,
  });

  useEffect(() => {
    if (!liveStatus || liveStatus.status === "open") return;
    setResult(liveStatus);
    setScreen("result");
    void refetchBalance();
    qc.invalidateQueries({ queryKey: ["t_history", address] });
    if (Platform.OS !== "web") {
      if (liveStatus.status === "won") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [liveStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const tradeMut = useMutation({
    mutationFn: () => {
      if (!address) throw new Error("No wallet connected");
      const amt = parseFloat(amount);
      if (!amt || amt < 0.35) throw new Error("Minimum stake is $0.35");
      if (amt > balance) throw new Error("Insufficient USDT balance");
      return apiOpenTrade({ walletAddress: address, asset, direction: dir, amount: amt, duration });
    },
    onSuccess: (t) => {
      setActiveTrade(t); setScreen("active");
      setCountdown(fmtCd(t.expiresAt)); setErr("");
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Trade failed"),
  });

  function reset() {
    setScreen("trade"); setActiveTrade(null); setResult(null);
    setErr(""); setAmount("1");
  }

  const curPrice   = prices?.[asset] ?? 0;
  const chartPts   = chartData[activeAsset] ?? [];
  const change     = chartPts.length > 1
    ? ((chartPts[chartPts.length - 1] - chartPts[0]) / chartPts[0]) * 100
    : 0;
  const hi         = chartPts.length ? Math.max(...chartPts) : 0;
  const lo         = chartPts.length ? Math.min(...chartPts) : 0;
  const amt        = parseFloat(amount || "0") || 0;
  const estPayout  = amt * 1.87;
  const entryPrice = screen === "active" ? (activeTrade?.entryPrice ?? null) : null;

  // ── RESULT SCREEN ───────────────────────────────────────────────────────────
  if (screen === "result" && result) {
    const won  = result.status === "won";
    const draw = result.status === "draw";
    const profit = won ? result.payout_usdt - result.amount_usdt : 0;
    return (
      <View style={{ flex: 1, backgroundColor: D.bg }}>
        <View style={{
          paddingTop: insets.top + (Platform.OS === "web" ? 67 : 14),
          paddingHorizontal: 20, paddingBottom: 14, flexDirection: "row",
          alignItems: "center", justifyContent: "space-between",
          borderBottomWidth: 1, borderBottomColor: D.border,
        }}>
          <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: D.text }}>Trade Result</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6,
            backgroundColor: D.card, paddingHorizontal: 10, paddingVertical: 5,
            borderRadius: 20, borderWidth: 1, borderColor: D.border }}>
            <Icon name="wallet-outline" size={12} color={D.green} />
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: D.green }}>
              ${balance.toFixed(2)}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, alignItems: "center" }}>
          <View style={{ width: 110, height: 110, borderRadius: 55,
            backgroundColor: won ? D.green + "15" : draw ? D.yellow + "15" : D.red + "15",
            borderWidth: 2, borderColor: won ? D.green + "60" : draw ? D.yellow + "60" : D.red + "60",
            alignItems: "center", justifyContent: "center", marginBottom: 22 }}>
            <View style={{ marginBottom: 10 }}>
              <Icon name={won ? "trophy-outline" : draw ? "swap-horizontal-outline" : "close-circle"} size={50} color={won ? D.green : draw ? D.muted : D.red} />
            </View>
          </View>

          <Text style={{ fontSize: 34, fontFamily: "Inter_700Bold",
            color: won ? D.green : draw ? D.yellow : D.red, letterSpacing: -1, marginBottom: 6 }}>
            {won ? "You Won!" : draw ? "Draw" : "You Lost"}
          </Text>

          {won && (
            <View style={{ paddingHorizontal: 20, paddingVertical: 8, borderRadius: 10,
              backgroundColor: D.green + "20", borderWidth: 1, borderColor: D.green + "40", marginBottom: 24 }}>
              <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: D.green }}>
                +${profit.toFixed(2)} profit
              </Text>
            </View>
          )}
          {!won && (
            <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: D.muted, marginBottom: 24 }}>
              {draw ? "Your stake has been refunded" : `You lost $${result.amount_usdt.toFixed(2)}`}
            </Text>
          )}

          <View style={{ width: "100%", backgroundColor: D.card, borderRadius: 18,
            borderWidth: 1, borderColor: D.border, padding: 6, marginBottom: 24 }}>
            {[
              ["Asset",       result.asset],
              ["Direction",   result.direction === "UP" ? "▲ UP" : "▼ DOWN"],
              ["Staked",      `$${result.amount_usdt.toFixed(2)} USDT`],
              ["Payout",      won ? `$${result.payout_usdt.toFixed(2)} USDT` : "$0.00"],
              ["Entry Price", result.entry_price ? fmt(result.entry_price) : "—"],
              ["Exit Price",  result.exit_price  ? fmt(result.exit_price)  : "—"],
            ].map(([label, val], i, arr) => (
              <View key={label} style={{
                flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                paddingVertical: 13, paddingHorizontal: 14,
                borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: D.border,
              }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: D.muted }}>{label}</Text>
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold",
                  color: label === "Payout" && won ? D.green
                       : label === "Direction" && result.direction === "UP" ? D.green
                       : label === "Direction" ? D.red
                       : D.text }}>
                  {val}
                </Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={{ width: "100%", borderRadius: 16, overflow: "hidden" }}
            onPress={reset} activeOpacity={0.85}>
            <View
              style={{ paddingVertical: 18, alignItems: "center", flexDirection: "row",
                justifyContent: "center", gap: 8 }}>
              <Icon name="refresh-outline" size={18} color="#FFF" />
              <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFF" }}>Trade Again</Text>
            </View>
          </TouchableOpacity>

          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      </View>
    );
  }

  // ── MAIN / ACTIVE SCREEN ───────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: D.bg }}>

      {/* Header */}
      <View style={{
        paddingTop: insets.top + (Platform.OS === "web" ? 67 : 14),
        paddingHorizontal: 16, paddingBottom: 12,
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        borderBottomWidth: 1, borderBottomColor: D.border,
      }}>
        <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: D.text, letterSpacing: -0.5 }}>
          Trade
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TouchableOpacity onPress={() => setShowHistory(v => !v)}
            style={{ padding: 6, borderRadius: 10,
              backgroundColor: showHistory ? D.yellow + "20" : "transparent" }}>
            <Icon name="time-outline" size={20} color={showHistory ? D.yellow : D.muted} />
          </TouchableOpacity>

          {/* Deposit button */}
          <TouchableOpacity
            onPress={() => setShowDeposit(true)}
            style={{ flexDirection: "row", alignItems: "center", gap: 5,
              backgroundColor: D.green + "18", paddingHorizontal: 10, paddingVertical: 6,
              borderRadius: 20, borderWidth: 1, borderColor: D.green + "40" }}>
            <Icon name="add-circle-outline" size={14} color={D.green} />
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: D.green }}>
              Deposit
            </Text>
          </TouchableOpacity>

          {/* Balance pill */}
          <TouchableOpacity
            onPress={() => setShowDeposit(true)}
            style={{ flexDirection: "row", alignItems: "center", gap: 5,
              backgroundColor: D.card, paddingHorizontal: 10, paddingVertical: 6,
              borderRadius: 20, borderWidth: 1, borderColor: D.border }}>
            <Icon name="wallet-outline" size={12} color={D.green} />
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: D.green }}>
              ${balance.toFixed(2)}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>

        {/* Asset tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={{ borderBottomWidth: 1, borderBottomColor: D.border }}
          contentContainerStyle={{ paddingHorizontal: 8 }}>
          {ASSETS.map(a => {
            const active = a === (screen === "active" ? activeAsset : asset);
            return (
              <TouchableOpacity key={a}
                style={{ paddingHorizontal: 16, paddingVertical: 13, marginHorizontal: 2,
                  borderBottomWidth: 2.5,
                  borderBottomColor: active ? ASSET_COLOR[a] : "transparent" }}
                onPress={() => {
                  if (screen !== "active") {
                    setAsset(a);
                    if (!loadedRef.current.has(a)) {
                      loadedRef.current.add(a);
                      apiCandles(a).then(pts => {
                        if (pts.length) setChartData(prev => ({ ...prev, [a]: pts }));
                      }).catch(() => {});
                    }
                  }
                }}>
                <Text style={{ fontSize: 13, fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                  color: active ? D.text : D.muted }}>
                  {ASSET_TAG[a]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Price display */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
          flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
          <View>
            <Animated.Text style={{ fontSize: 34, fontFamily: "Inter_700Bold", letterSpacing: -1.5,
              color: change >= 0 ? D.green : D.red, opacity: priceFlash }}>
              {curPrice ? fmt(curPrice) : "—"}
            </Animated.Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: D.muted, marginTop: 2 }}>
              {ASSET_LABEL[screen === "active" && activeTrade ? activeTrade.asset : asset]}
            </Text>
          </View>

          <View style={{ alignItems: "flex-end", gap: 4 }}>
            {change !== 0 && (
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                backgroundColor: change >= 0 ? D.green + "18" : D.red + "18" }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold",
                  color: change >= 0 ? D.green : D.red }}>
                  {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
                </Text>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 12 }}>
              {hi > 0 && (
                <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: D.muted }}>
                  H: <Text style={{ color: D.green }}>{fmt(hi)}</Text>
                </Text>
              )}
              {lo > 0 && (
                <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: D.muted }}>
                  L: <Text style={{ color: D.red }}>{fmt(lo)}</Text>
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Chart */}
        <View style={{ backgroundColor: D.bg }}>
          <PriceChart
            prices={chartPts}
            width={W}
            height={CHART_H}
            color={chartColor}
            entryPrice={entryPrice}
          />
        </View>

        {/* Chart period label */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center",
          paddingHorizontal: 16, paddingVertical: 8,
          borderTopWidth: 1, borderTopColor: D.border }}>
          <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: D.muted }}>
            {chartPts.length > 0 ? `${chartPts.length} data points` : ""}
          </Text>
          <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: D.muted }}>
            1-min candles · live
          </Text>
        </View>

        {/* ── ACTIVE TRADE PANEL ── */}
        {screen === "active" && activeTrade && (
          <View style={{ margin: 16, borderRadius: 18,
            borderWidth: 1, borderColor: D.border, overflow: "hidden" }}>
            <View
              style={{ padding: 18 }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: D.muted,
                letterSpacing: 1.8, marginBottom: 14 }}>
                TRADE IN PROGRESS
              </Text>

              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: D.muted, marginBottom: 4 }}>
                    Time Remaining
                  </Text>
                  <Text style={{ fontSize: 46, fontFamily: "Inter_700Bold", color: D.text, letterSpacing: -2 }}>
                    {countdown || "—"}
                  </Text>
                </View>

                <View style={{ alignItems: "flex-end", gap: 10 }}>
                  <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
                    backgroundColor: activeTrade.direction === "UP" ? D.green + "20" : D.red + "20",
                    borderWidth: 1,
                    borderColor: activeTrade.direction === "UP" ? D.green + "50" : D.red + "50" }}>
                    <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold",
                      color: activeTrade.direction === "UP" ? D.green : D.red }}>
                      {activeTrade.direction === "UP" ? "▲ UP" : "▼ DOWN"}
                    </Text>
                  </View>

                  <View>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: D.muted, textAlign: "right" }}>
                      Entry Price
                    </Text>
                    <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: D.yellow, textAlign: "right" }}>
                      {fmt(activeTrade.entryPrice)}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: "row", marginTop: 16, gap: 1 }}>
                {[
                  { label: "Staked", value: `$${activeTrade.amount.toFixed(2)}`, color: D.text },
                  { label: "Win Amount", value: `$${activeTrade.payout.toFixed(2)}`, color: D.green },
                  { label: "Duration", value: activeTrade.expiresAt ? duration : "—", color: D.text },
                ].map(({ label, value, color }) => (
                  <View key={label} style={{ flex: 1, alignItems: "center", padding: 10,
                    backgroundColor: D.dim + "80", borderRadius: 10, marginHorizontal: 3 }}>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: D.muted, marginBottom: 4 }}>
                      {label}
                    </Text>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color }}>{value}</Text>
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center",
                marginTop: 14, gap: 8 }}>
                <ActivityIndicator color={activeTrade.direction === "UP" ? D.green : D.red} size="small" />
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: D.muted }}>
                  Waiting for result…
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ── TRADE CONTROLS ── */}
        {screen === "trade" && (
          <View style={{ padding: 16, gap: 12 }}>

            {/* No balance banner */}
            {balance < 0.35 && (
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center",
                backgroundColor: D.yellow + "12", borderRadius: 12, borderWidth: 1,
                borderColor: D.yellow + "30", padding: 12 }}>
                <Icon name="information-circle-outline" size={16} color={D.yellow} />
                <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular",
                  color: D.yellow, lineHeight: 18 }}>
                  Deposit USDT via the Card tab to start trading.
                </Text>
              </View>
            )}

            {/* Direction */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(["UP", "DOWN"] as Dir[]).map(d => {
                const isUp   = d === "UP";
                const active = dir === d;
                const clr    = isUp ? D.green : D.red;
                return (
                  <TouchableOpacity key={d}
                    style={{ flex: 1, paddingVertical: 22, borderRadius: 16,
                      alignItems: "center", gap: 5,
                      borderWidth: active ? 2 : 1,
                      borderColor: active ? clr : D.border,
                      backgroundColor: active ? clr + "18" : D.card }}
                    onPress={() => {
                      setDir(d);
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}>
                    <Text style={{ fontSize: 24 }}>{isUp ? "▲" : "▼"}</Text>
                    <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold",
                      color: active ? clr : D.muted }}>
                      {isUp ? "UP" : "DOWN"}
                    </Text>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular",
                      color: active ? clr + "CC" : D.muted }}>
                      {isUp ? "Price rises" : "Price falls"}
                    </Text>
                    {active && (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                        backgroundColor: clr + "25" }}>
                        <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: clr }}>
                          +87% payout
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Duration */}
            <View style={{ backgroundColor: D.card, borderRadius: 16, borderWidth: 1,
              borderColor: D.border, padding: 14 }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: D.muted,
                letterSpacing: 1.8, marginBottom: 12 }}>
                DURATION
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {DURATIONS.map(d => {
                  const active = duration === d;
                  return (
                    <TouchableOpacity key={d}
                      style={{ flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: "center",
                        backgroundColor: active ? D.blue + "25" : D.bg,
                        borderWidth: 1, borderColor: active ? D.blue : D.border }}
                      onPress={() => setDuration(d)}>
                      <Text style={{ fontSize: 12, fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                        color: active ? D.blue : D.muted }}>
                        {DURATION_LABEL[d]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Stake amount */}
            <View style={{ backgroundColor: D.card, borderRadius: 16, borderWidth: 1,
              borderColor: D.border, padding: 14 }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: D.muted,
                letterSpacing: 1.8, marginBottom: 12 }}>
                STAKE AMOUNT
              </Text>

              <View style={{ flexDirection: "row", alignItems: "center",
                backgroundColor: D.bg, borderRadius: 12, borderWidth: 1.5,
                borderColor: D.border, overflow: "hidden", marginBottom: 10 }}>
                <Text style={{ paddingHorizontal: 14, fontSize: 18, fontFamily: "Inter_600SemiBold",
                  color: D.green }}>$</Text>
                <TextInput
                  style={{ flex: 1, paddingVertical: 14, fontSize: 28, fontFamily: "Inter_700Bold",
                    color: D.text }}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholderTextColor={D.muted}
                  placeholder="0.00"
                />
                <Text style={{ paddingHorizontal: 14, fontSize: 13, fontFamily: "Inter_600SemiBold",
                  color: D.muted }}>USDT</Text>
              </View>

              <View style={{ flexDirection: "row", gap: 7, marginBottom: 12 }}>
                {["1", "5", "10", "25"].map(v => {
                  const active = amount === v;
                  return (
                    <TouchableOpacity key={v} onPress={() => setAmount(v)}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center",
                        backgroundColor: active ? D.blue + "25" : D.bg,
                        borderWidth: 1, borderColor: active ? D.blue : D.border }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold",
                        color: active ? D.blue : D.muted }}>
                        ${v}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ borderTopWidth: 1, borderTopColor: D.border, paddingTop: 12, gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: D.muted }}>
                    Payout if correct
                  </Text>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: D.green }}>
                    ${estPayout.toFixed(2)} USDT
                  </Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: D.muted }}>
                    Net profit
                  </Text>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: D.green }}>
                    +${Math.max(0, estPayout - amt).toFixed(2)} (+87%)
                  </Text>
                </View>
              </View>
            </View>

            {/* Error */}
            {!!err && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8,
                backgroundColor: D.red + "15", borderRadius: 12, borderWidth: 1,
                borderColor: D.red + "40", padding: 12 }}>
                <Icon name="alert-circle-outline" size={16} color={D.red} />
                <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: D.red }}>
                  {err}
                </Text>
              </View>
            )}

            {/* Place Trade CTA */}
            <TouchableOpacity
              style={{ borderRadius: 16, overflow: "hidden", marginTop: 2,
                opacity: tradeMut.isPending ? 0.7 : 1 }}
              disabled={tradeMut.isPending}
              onPress={() => { setErr(""); tradeMut.mutate(); }}
              activeOpacity={0.85}>
              <View


                style={{ paddingVertical: 20, alignItems: "center", flexDirection: "row",
                  justifyContent: "center", gap: 10 }}>
                {tradeMut.isPending
                  ? <ActivityIndicator color="#FFF" />
                  : (
                    <>
                      <Text style={{ fontSize: 22 }}>{dir === "UP" ? "▲" : "▼"}</Text>
                      <View>
                        <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFF",
                          letterSpacing: 0.3 }}>
                          Place {dir} Trade
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular",
                          color: "#FFFFFF99", textAlign: "center" }}>
                          Stake ${amt.toFixed(2)} · Win ${estPayout.toFixed(2)}
                        </Text>
                      </View>
                    </>
                  )}
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* History panel */}
        {showHistory && (
          <View style={{ margin: 16, backgroundColor: D.card, borderRadius: 18,
            borderWidth: 1, borderColor: D.border, padding: 16 }}>
            <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: D.text, marginBottom: 14 }}>
              Recent Trades
            </Text>
            {history.length === 0 ? (
              <Text style={{ color: D.muted, fontSize: 13, textAlign: "center",
                fontFamily: "Inter_400Regular", paddingVertical: 20 }}>
                No trades yet
              </Text>
            ) : (
              history.map((t, i) => (
                <View key={t.id} style={{ flexDirection: "row", alignItems: "center",
                  paddingVertical: 12,
                  borderBottomWidth: i < history.length - 1 ? 1 : 0, borderBottomColor: D.border }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center",
                    justifyContent: "center", marginRight: 12,
                    backgroundColor: t.status === "won" ? D.green + "20"
                                   : t.status === "draw" ? D.yellow + "20" : D.red + "20" }}>
                    <Text style={{ fontSize: 16 }}>
                      {t.status === "won" ? "✓" : t.status === "draw" ? "=" : "✗"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: D.text }}>
                      {t.asset} · {t.direction} · {t.duration ?? ""}
                    </Text>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: D.muted, marginTop: 2 }}>
                      {new Date(t.opened_at).toLocaleString()}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold",
                      color: t.status === "won" ? D.green : t.status === "draw" ? D.yellow : D.red }}>
                      {t.status === "won"  ? `+$${(t.payout_usdt - t.amount_usdt).toFixed(2)}`
                       : t.status === "draw" ? "Draw"
                       : `-$${t.amount_usdt.toFixed(2)}`}
                    </Text>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 2,
                      color: t.status === "won" ? D.green : t.status === "draw" ? D.yellow : D.red }}>
                      {t.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        <View style={{ height: insets.bottom + 32 }} />
      </ScrollView>

      {/* Deposit modal — rendered over the full screen */}
      <DepositModal
        visible={showDeposit}
        onClose={() => setShowDeposit(false)}
        address={address}
        tradingBalance={balance}
        onSuccess={() => {
          void refetchBalance();
          qc.invalidateQueries({ queryKey: ["t_balance", address] });
        }}
      />
    </View>
  );
}
