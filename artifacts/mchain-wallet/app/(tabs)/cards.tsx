import { Icon } from "@/components/Icon";
import KripicardModule from "@/components/KripicardModule";
import { useColors } from "@/hooks/useColors";
import { useWallet } from "@/context/WalletContext";
import {
  CardAccount,
  CardDeposit,
  StripeCardDetails,
  getCardAccount,
  getCardDeposits,
  getStripeCardDetails,
  initCardAccount,
  verifyCardDeposit,
  toggleCardFreeze,
} from "@/services/api";

import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";

// ── Chip ──────────────────────────────────────────────────────────────────────
function CardChip({ color = "#FFD700" }: { color?: string }) {
  return (
    <View style={{ width: 34, height: 26, borderRadius: 5, backgroundColor: color, opacity: 0.9,
      borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" }}>
      <View style={{ position: "absolute", top: 8, left: 4, right: 4, height: 1,
        backgroundColor: "rgba(255,255,255,0.35)" }} />
      <View style={{ position: "absolute", top: 4, left: 12, bottom: 4, width: 1,
        backgroundColor: "rgba(255,255,255,0.25)" }} />
    </View>
  );
}

// ── Contactless icon ──────────────────────────────────────────────────────────
function ContactlessIcon({ color = "rgba(255,255,255,0.7)" }: { color?: string }) {
  return (
    <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
      {[8, 13, 18].map((size, i) => (
        <View key={i} style={{
          position: "absolute", width: size, height: size,
          borderRadius: size / 2, borderWidth: 1.5, borderColor: color,
          borderLeftColor: "transparent", borderBottomColor: "transparent",
          transform: [{ rotate: "45deg" }], opacity: 0.55 + i * 0.2,
        }} />
      ))}
    </View>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton({ width, height, borderRadius = 8, style }: {
  width: number | string; height: number; borderRadius?: number; style?: object;
}) {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
    ])).start();
  }, [anim]);
  return <Animated.View style={[{ width, height, borderRadius, backgroundColor: "#ffffff18", opacity: anim }, style]} />;
}

// ── Deposit row ───────────────────────────────────────────────────────────────
function DepositRow({ deposit, colors }: { deposit: CardDeposit; colors: ReturnType<typeof useColors> }) {
  const amount = parseFloat(deposit.amount_usdt);
  const date = new Date(deposit.created_at);
  const shortHash = deposit.tx_hash.slice(0, 8) + "…" + deposit.tx_hash.slice(-6);
  const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12,
      paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ width: 40, height: 40, borderRadius: 20,
        backgroundColor: "#22C55E18", alignItems: "center", justifyContent: "center" }}>
        <Icon name="arrow-down-outline" size={18} color="#22C55E" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>USDT Deposit</Text>
        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>
          {shortHash} · {deposit.network.toUpperCase()}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#22C55E" }}>+{amount.toFixed(2)} USDT</Text>
        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>
          {dateStr} · {timeStr}
        </Text>
      </View>
    </View>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ title, tag, tagColor }: { title: string; tag: string; tagColor: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFF" }}>{title}</Text>
      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
        backgroundColor: tagColor + "22", borderWidth: 1, borderColor: tagColor + "55" }}>
        <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: tagColor, letterSpacing: 0.8 }}>
          {tag}
        </Text>
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function CardsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { ethAddress, mxcAddress, getPrivateKey } = useWallet();

  const [account, setAccount] = useState<CardAccount | null>(null);
  const [deposits, setDeposits] = useState<CardDeposit[]>([]);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [activating, setActivating] = useState(false);
  const [cardTab, setCardTab] = useState<"fiat" | "usdt">("fiat");
  const [fiatTab, setFiatTab] = useState<"deposit" | "history">("deposit");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stripeDetails, setStripeDetails] = useState<StripeCardDetails | null>(null);
  const [loadingCardDetails, setLoadingCardDetails] = useState(false);
  const [showCardDetails, setShowCardDetails] = useState(false);

  const verifyAnim = useRef(new Animated.Value(0)).current;
  const msgAnim = useRef(new Animated.Value(0)).current;

  // ── Load account ──────────────────────────────────────────────────────────
  const loadAccount = useCallback(async (silent = false) => {
    if (!ethAddress) return;
    if (!silent) setLoadingAccount(true);
    try {
      const [accRes, depRes] = await Promise.all([
        getCardAccount(ethAddress),
        getCardDeposits(ethAddress),
      ]);
      setAccount(accRes.account);
      setDeposits(depRes.deposits);
    } catch {
      // silent
    } finally {
      setLoadingAccount(false);
      setRefreshing(false);
    }
  }, [ethAddress]);

  useEffect(() => { loadAccount(); }, [loadAccount]);

  // ── Activate (first-time setup) ───────────────────────────────────────────
  const handleActivate = async () => {
    if (!ethAddress || activating) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActivating(true);
    try {
      const res = await initCardAccount(ethAddress);
      setAccount(res.account);
    } catch {
      showMsg("error", "Failed to activate. Please try again.");
    } finally {
      setActivating(false);
    }
  };

  // ── Feedback banner ───────────────────────────────────────────────────────
  const showMsg = (type: "success" | "error" | "info", text: string) => {
    setVerifyMsg({ type, text });
    msgAnim.setValue(0);
    Animated.timing(msgAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    setTimeout(() => {
      Animated.timing(msgAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setVerifyMsg(null));
    }, 4000);
  };

  // ── Copy address ──────────────────────────────────────────────────────────
  const handleCopy = async () => {
    if (!account?.deposit_address) return;
    await Clipboard.setStringAsync(account.deposit_address);
    setCopied(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopied(false), 2500);
  };

  // ── Verify deposit ────────────────────────────────────────────────────────
  const handleVerify = async () => {
    if (!ethAddress || isVerifying) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsVerifying(true);
    setVerifyMsg(null);
    Animated.loop(Animated.timing(verifyAnim, { toValue: 1, duration: 1200, useNativeDriver: true })).start();
    try {
      const result = await verifyCardDeposit(ethAddress);
      verifyAnim.stopAnimation(); verifyAnim.setValue(0);
      if (result.credited > 0) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showMsg("success", `+${result.credited.toFixed(2)} USDT credited!`);
        await loadAccount(true);
      } else {
        showMsg("info", result.message);
      }
    } catch {
      verifyAnim.stopAnimation(); verifyAnim.setValue(0);
      showMsg("error", "Verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  // ── Show / hide Stripe card details ──────────────────────────────────────
  const handleToggleCardDetails = async () => {
    if (showCardDetails) { setShowCardDetails(false); return; }
    if (stripeDetails) { setShowCardDetails(true); return; }
    if (!ethAddress || loadingCardDetails) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoadingCardDetails(true);
    try {
      const details = await getStripeCardDetails(ethAddress);
      setStripeDetails(details);
      setShowCardDetails(true);
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to load card details");
    } finally {
      setLoadingCardDetails(false);
    }
  };

  // ── Freeze toggle ─────────────────────────────────────────────────────────
  const handleFreeze = async () => {
    if (!ethAddress || isToggling || !account) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsToggling(true);
    try {
      const res = await toggleCardFreeze(ethAddress);
      setAccount((prev) => prev ? { ...prev, frozen: res.frozen } : prev);
      showMsg("info", res.frozen ? "Card frozen — all transactions blocked." : "Card unfrozen — ready to use.");
    } catch {
      showMsg("error", "Failed to update card status.");
    } finally {
      setIsToggling(false);
    }
  };

  const balance = parseFloat(account?.balance_usdt ?? "0");
  const balanceUsd = balance.toFixed(2);
  const depositAddr = account?.deposit_address ?? "";

  const msgColor = verifyMsg?.type === "success" ? "#22C55E"
    : verifyMsg?.type === "error" ? "#EF4444" : "#0EA5E9";

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 12),
      paddingHorizontal: 20, paddingBottom: 20,
      flexDirection: "row", alignItems: "center", gap: 12,
    },
    backBtn: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      alignItems: "center", justifyContent: "center",
    },
    headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.foreground, flex: 1 },
    scroll: { paddingHorizontal: 20, paddingBottom: 140 },

    sectionCard: {
      borderRadius: 24, overflow: "hidden",
      marginBottom: 24,
      shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 }, elevation: 14,
    },
    sectionGrad: { padding: 22 },

    cardVisual: {
      borderRadius: 18, overflow: "hidden",
      aspectRatio: 1.586, marginBottom: 20,
      shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 }, elevation: 12,
    },
    cardGrad: { flex: 1, padding: 22 },

    actionRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
    actionBtn: {
      flex: 1, borderRadius: 14, borderWidth: 1,
      paddingVertical: 12, alignItems: "center", gap: 5,
    },
    actionBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

    tabRow: {
      flexDirection: "row", borderRadius: 12,
      padding: 3, marginBottom: 18, gap: 4,
    },
    tab: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 10 },
    tabText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

    addressBox: {
      borderRadius: 12, borderWidth: 1,
      padding: 12, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14,
    },
    addressText: { flex: 1, fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },

    msgBanner: {
      borderRadius: 12, borderWidth: 1, padding: 12,
      flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 16,
    },
  });

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loadingAccount) {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Icon name="arrow-back" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>My Cards</Text>
        </View>
        <View style={{ paddingHorizontal: 20, gap: 16 }}>
          <Skeleton width="100%" height={360} borderRadius={24} />
          <Skeleton width="100%" height={360} borderRadius={24} />
        </View>
      </View>
    );
  }

  // ── Activate screen (new users) ───────────────────────────────────────────
  if (!account) {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Icon name="arrow-back" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>My Cards</Text>
        </View>

        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center",
            paddingHorizontal: 32, paddingBottom: 80, paddingTop: 20 }}>

            {/* Icon */}
            <View style={{ width: 90, height: 90, borderRadius: 45,
              backgroundColor: colors.primary + "15", borderWidth: 1,
              borderColor: colors.primary + "30", alignItems: "center",
              justifyContent: "center", marginBottom: 28 }}>
              <Icon name="card-outline" size={40} color={colors.primary} />
            </View>

            <Text style={{ fontSize: 26, fontFamily: "Inter_700Bold",
              color: colors.foreground, textAlign: "center", marginBottom: 12 }}>
              Your MWallet Cards
            </Text>
            <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular",
              color: colors.mutedForeground, textAlign: "center", lineHeight: 22, marginBottom: 32 }}>
              Activate to access your Fiat Card and USDT Spending Card — spend anywhere Mastercard is accepted.
            </Text>

            {/* Feature list */}
            {[
              { icon: "card-outline",          text: "Mwallet Fiat Card — spend fiat globally" },
              { icon: "flash-outline",          text: "Mwallet USDT Spending Card — instant USDT spending" },
              { icon: "lock-closed-outline",    text: "Freeze & unfreeze anytime" },
              { icon: "swap-horizontal-outline", text: "USDT automatically converted at checkout" },
            ].map((f, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "center",
                alignSelf: "stretch", marginBottom: 16 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12,
                  backgroundColor: colors.primary + "15", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={f.icon} size={18} color={colors.primary} />
                </View>
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular",
                  color: colors.foreground, flex: 1, lineHeight: 20 }}>{f.text}</Text>
              </View>
            ))}

            {/* Error banner */}
            {verifyMsg && (
              <Animated.View style={[s.msgBanner, {
                backgroundColor: msgColor + "18", borderColor: msgColor + "40",
                opacity: msgAnim, alignSelf: "stretch", marginTop: 8,
              }]}>
                <Icon name="alert-circle-outline" size={18} color={msgColor} />
                <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: msgColor }}>
                  {verifyMsg.text}
                </Text>
              </Animated.View>
            )}

            {/* Activate button */}
            <TouchableOpacity
              style={{ width: "100%", borderRadius: 18, overflow: "hidden", marginTop: 12,
                opacity: activating ? 0.7 : 1,
                shadowColor: colors.primary, shadowOpacity: 0.4,
                shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 10 }}
              activeOpacity={0.85}
              onPress={handleActivate}
              disabled={activating || !ethAddress}
            >
              <View
                style={{ paddingVertical: 19, alignItems: "center",
                  flexDirection: "row", justifyContent: "center", gap: 10 }}>
                {activating
                  ? <ActivityIndicator color="#FFF" size="small" />
                  : <Icon name="card-outline" size={22} color="#FFF" />
                }
                <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFF" }}>
                  {activating ? "Activating…" : "Activate My Cards"}
                </Text>
              </View>
            </TouchableOpacity>

            {!ethAddress && (
              <Text style={{ fontSize: 12, color: colors.mutedForeground,
                textAlign: "center", marginTop: 12 }}>
                Connect a wallet first to activate your cards.
              </Text>
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Icon name="arrow-back" size={18} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Cards</Text>
        {account && (
          <View style={{
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
            backgroundColor: account.frozen ? "#EF444418" : "#22C55E18",
            borderWidth: 1, borderColor: account.frozen ? "#EF444440" : "#22C55E40",
          }}>
            <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold",
              color: account.frozen ? "#EF4444" : "#22C55E", letterSpacing: 1 }}>
              {account.frozen ? "FROZEN" : "ACTIVE"}
            </Text>
          </View>
        )}
      </View>

      {/* Feedback banner */}
      {verifyMsg && (
        <Animated.View style={[s.msgBanner, {
          marginHorizontal: 20, backgroundColor: msgColor + "18",
          borderColor: msgColor + "40", opacity: msgAnim,
        }]}>
          <Icon name={verifyMsg.type === "success" ? "checkmark-circle-outline"
            : verifyMsg.type === "error" ? "alert-circle-outline" : "information-circle-outline"}
            size={18} color={msgColor} />
          <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: msgColor }}>
            {verifyMsg.text}
          </Text>
        </Animated.View>
      )}

      {/* ── Card tab switcher ─────────────────────────────────────────────── */}
      <View style={{
        flexDirection: "row", marginHorizontal: 20, marginBottom: 12,
        backgroundColor: colors.card, borderRadius: 16,
        padding: 4, borderWidth: 1, borderColor: colors.border,
      }}>
        {([
          { key: "fiat", label: "Fiat Card", icon: "card-outline", color: "#0EA5E9" },
          { key: "usdt", label: "USDT Card", icon: "flash-outline", color: "#7C3AED" },
        ] as const).map(tab => {
          const active = cardTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setCardTab(tab.key)}
              activeOpacity={0.8}
              style={{ flex: 1, borderRadius: 13, overflow: "hidden" }}
            >
              <View

                style={{
                  flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 7, paddingVertical: 12, paddingHorizontal: 8,
                }}
              >
                <Icon name={tab.icon} size={16}
                  color={active ? tab.color : colors.mutedForeground} />
                <Text style={{
                  fontSize: 13, fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                  color: active ? tab.color : colors.mutedForeground,
                }}>{tab.label}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadAccount(); }}
            tintColor={colors.primary}
          />
        }
      >

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SECTION 1 — Mwallet Fiat Card                                      */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {cardTab === "fiat" && (<>
        <View style={s.sectionCard}>
          <View


            style={s.sectionGrad}
          >
            <SectionHeader
              title="Mwallet Fiat Card"
              tag="SPENDING AFTER 12 HRS"
              tagColor="#0EA5E9"
            />

            {/* Card visual */}
            {account ? (
              <View style={s.cardVisual}>
                <View


                  style={s.cardGrad}
                >
                  {/* Top */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFF", letterSpacing: 2 }}>
                        MWALLET
                      </Text>
                      <Text style={{ fontSize: 8, fontFamily: "Inter_400Regular",
                        color: "rgba(255,255,255,0.45)", letterSpacing: 2, marginTop: 2 }}>
                        FIAT CARD
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <ContactlessIcon color={account.frozen ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.7)"} />
                      <CardChip color={account.frozen ? "#6B7280" : "#FFD700"} />
                    </View>
                  </View>

                  {/* Centre */}
                  <View style={{ flex: 1, justifyContent: "center" }}>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium",
                      color: "rgba(255,255,255,0.45)", letterSpacing: 1.5, marginBottom: 4 }}>
                      CARD BALANCE
                    </Text>
                    <Text style={{ fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFF", letterSpacing: -0.5 }}>
                      {balance.toFixed(2)}
                      <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.55)" }}> USDT</Text>
                    </Text>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular",
                      color: "rgba(255,255,255,0.4)", marginTop: 3 }}>≈ ${balanceUsd} USD</Text>
                  </View>

                  {/* Bottom */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                    <View>
                      <Text style={{ fontSize: 9, fontFamily: "Inter_500Medium",
                        color: "rgba(255,255,255,0.4)", letterSpacing: 1 }}>CARD NUMBER</Text>
                      {account.stripe_card_id ? (
                        <>
                          <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold",
                            color: "rgba(255,255,255,0.85)", letterSpacing: 2.5, marginTop: 4 }}>
                            {showCardDetails && stripeDetails?.number
                              ? stripeDetails.number.replace(/(\d{4})/g, "$1 ").trim()
                              : showCardDetails && stripeDetails?.last4
                              ? `•••• •••• •••• ${stripeDetails.last4}`
                              : "•••• •••• •••• ••••"}
                          </Text>
                          <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular",
                            color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                            {showCardDetails && stripeDetails
                              ? `VALID THRU  ${String(stripeDetails.exp_month).padStart(2, "0")}/${String(stripeDetails.exp_year).slice(-2)}  CVV ${stripeDetails.cvc ?? "•••"}`
                              : "VALID THRU  ••/••  CVV •••"}
                          </Text>
                        </>
                      ) : (
                        <>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold",
                            color: "rgba(255,255,255,0.45)", letterSpacing: 1.5, marginTop: 5 }}>
                            NOT ISSUED
                          </Text>
                          <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular",
                            color: "rgba(255,255,255,0.3)", marginTop: 3 }}>
                            Contact support to activate
                          </Text>
                        </>
                      )}
                    </View>
                    <View style={{ alignItems: "center", gap: 3 }}>
                      <View style={{ flexDirection: "row" }}>
                        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#EB001B",
                          opacity: account.stripe_card_id ? 0.9 : 0.3 }} />
                        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#F79E1B",
                          opacity: account.stripe_card_id ? 0.9 : 0.3, marginLeft: -8 }} />
                      </View>
                      <Text style={{ fontSize: 7, fontFamily: "Inter_700Bold",
                        color: account.stripe_card_id ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.2)",
                        letterSpacing: 1 }}>MASTERCARD</Text>
                    </View>
                  </View>
                </View>
              </View>
            ) : (
              // No account yet — skeleton while auto-init runs
              <View style={[s.cardVisual, { backgroundColor: "#0f172a", borderRadius: 18, justifyContent: "center", alignItems: "center" }]}>
                <ActivityIndicator color="#0EA5E9" />
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular",
                  color: "rgba(255,255,255,0.4)", marginTop: 10 }}>Setting up your card…</Text>
              </View>
            )}

            {account && (
              <>
                {/* Not-issued banner — shown when no Stripe card has been provisioned */}
                {!account.stripe_card_id && (
                  <View style={{ flexDirection: "row", gap: 10, alignItems: "center",
                    backgroundColor: "#F59E0B10", borderWidth: 1, borderColor: "#F59E0B30",
                    borderRadius: 12, padding: 12, marginBottom: 16 }}>
                    <Icon name="information-circle-outline" size={18} color="#F59E0B" />
                    <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_500Medium",
                      color: "#F59E0B", lineHeight: 17 }}>
                      Your fiat card has not been issued yet. You can still deposit USDT to your card balance. Contact support to get your card issued.
                    </Text>
                  </View>
                )}

                {/* Action buttons */}
                <View style={s.actionRow}>
                  {[
                    { icon: "arrow-down-circle-outline", label: "Deposit", onPress: () => setFiatTab("deposit"),
                      active: fiatTab === "deposit", color: "#0EA5E9", disabled: false },
                    { icon: showCardDetails ? "eye-off-outline" : "eye-outline", label: showCardDetails ? "Hide" : "Details",
                      onPress: handleToggleCardDetails, loading: loadingCardDetails,
                      active: showCardDetails, color: "#0EA5E9", disabled: !account.stripe_card_id },
                    { icon: account.frozen ? "lock-open-outline" : "lock-closed-outline",
                      label: account.frozen ? "Unfreeze" : "Freeze",
                      onPress: handleFreeze, loading: isToggling,
                      active: account.frozen, color: "#EF4444", disabled: !account.stripe_card_id },
                    { icon: "time-outline", label: "History",
                      onPress: () => setFiatTab("history"),
                      active: fiatTab === "history", color: "#0EA5E9", disabled: false },
                  ].map((btn, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[s.actionBtn, {
                        borderColor: btn.disabled ? "rgba(255,255,255,0.06)"
                          : btn.active ? btn.color + "55" : "rgba(255,255,255,0.12)",
                        backgroundColor: btn.disabled ? "rgba(255,255,255,0.03)"
                          : btn.active ? btn.color + "18" : "rgba(255,255,255,0.06)",
                        opacity: btn.disabled ? 0.4 : 1,
                      }]}
                      activeOpacity={0.7}
                      onPress={btn.disabled ? undefined : btn.onPress}
                      disabled={btn.loading || btn.disabled}
                    >
                      {btn.loading
                        ? <ActivityIndicator size="small" color={btn.color} />
                        : <Icon name={btn.icon} size={20} color={btn.active ? btn.color : "rgba(255,255,255,0.65)"} />
                      }
                      <Text style={[s.actionBtnText, { color: btn.active ? btn.color : "rgba(255,255,255,0.65)" }]}>
                        {btn.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Sub-tabs */}
                <View style={[s.tabRow, { backgroundColor: "rgba(0,0,0,0.25)" }]}>
                  {(["deposit", "history"] as const).map((tab) => (
                    <TouchableOpacity
                      key={tab}
                      style={[s.tab, fiatTab === tab && { backgroundColor: "#0EA5E9" }]}
                      onPress={() => setFiatTab(tab)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.tabText, { color: fiatTab === tab ? "#FFF" : "rgba(255,255,255,0.45)" }]}>
                        {tab === "deposit" ? "Deposit USDT"
                          : `History${deposits.length > 0 ? ` (${deposits.length})` : ""}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Deposit panel */}
                {fiatTab === "deposit" && (
                  <View style={{ gap: 14 }}>
                    {/* Network badge */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6,
                      backgroundColor: "#0EA5E914", borderWidth: 1, borderColor: "#0EA5E930",
                      borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, alignSelf: "flex-start" }}>
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#0EA5E9" }} />
                      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#0EA5E9", letterSpacing: 0.3 }}>
                        GMI Chain · USDT
                      </Text>
                    </View>

                    {/* QR */}
                    <View style={{ alignItems: "center", padding: 18,
                      backgroundColor: "#FFF", borderRadius: 16 }}>
                      <QRCode value={depositAddr || "mchain"} size={140}
                        color="#000000" backgroundColor="#FFFFFF" />
                      <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium",
                        color: "#666", marginTop: 10, letterSpacing: 0.5 }}>
                        Scan to deposit USDT
                      </Text>
                    </View>

                    {/* Address */}
                    <View style={[s.addressBox, {
                      borderColor: "rgba(255,255,255,0.12)",
                      backgroundColor: "rgba(0,0,0,0.2)" }]}>
                      <Text style={[s.addressText, { color: "rgba(255,255,255,0.55)" }]}
                        numberOfLines={1} ellipsizeMode="middle">
                        {depositAddr}
                      </Text>
                      <TouchableOpacity
                        style={{ paddingHorizontal: 12, paddingVertical: 7,
                          backgroundColor: "#0EA5E920", borderRadius: 10, borderWidth: 1, borderColor: "#0EA5E940" }}
                        onPress={handleCopy} activeOpacity={0.7}>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#0EA5E9" }}>
                          {copied ? "Copied!" : "Copy"}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Warning */}
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start",
                      backgroundColor: "#F59E0B12", borderRadius: 12, borderWidth: 1,
                      borderColor: "#F59E0B30", padding: 12 }}>
                      <Icon name="warning-outline" size={15} color="#F59E0B" />
                      <Text style={{ flex: 1, fontSize: 11, fontFamily: "Inter_400Regular",
                        color: "#F59E0B", lineHeight: 17 }}>
                        Only send <Text style={{ fontFamily: "Inter_700Bold" }}>USDT</Text> on the{" "}
                        <Text style={{ fontFamily: "Inter_700Bold" }}>GMI Chain</Text>.
                        Other tokens or networks will be lost permanently.
                      </Text>
                    </View>

                    {/* Verify button */}
                    <TouchableOpacity
                      style={{ borderRadius: 14, overflow: "hidden", opacity: isVerifying ? 0.75 : 1 }}
                      activeOpacity={0.85}
                      onPress={handleVerify}
                      disabled={isVerifying}
                    >
                      <View
                        style={{ paddingVertical: 15, alignItems: "center",
                          flexDirection: "row", justifyContent: "center", gap: 8 }}>
                        {isVerifying
                          ? <ActivityIndicator color="#FFF" size="small" />
                          : <Icon name="checkmark-circle-outline" size={19} color="#FFF" />
                        }
                        <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFF" }}>
                          {isVerifying ? "Checking blockchain…" : "Verify Deposit"}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular",
                      color: "rgba(255,255,255,0.35)", textAlign: "center", lineHeight: 17 }}>
                      After sending USDT, tap Verify Deposit to confirm on-chain and credit your balance.
                    </Text>
                  </View>
                )}

                {/* History panel */}
                {fiatTab === "history" && (
                  <View>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold",
                      color: "rgba(255,255,255,0.35)", letterSpacing: 1.2, marginBottom: 8 }}>
                      DEPOSIT HISTORY
                    </Text>
                    {deposits.length === 0 ? (
                      <View style={{ alignItems: "center", paddingVertical: 32, gap: 10 }}>
                        <View style={{ width: 52, height: 52, borderRadius: 26,
                          backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                          <Icon name="receipt-outline" size={22} color="rgba(255,255,255,0.3)" />
                        </View>
                        <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular",
                          color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
                          No deposits yet.{"\n"}Send USDT to get started.
                        </Text>
                      </View>
                    ) : (
                      deposits.map((dep) => (
                        <DepositRow key={dep.id} deposit={dep} colors={colors} />
                      ))
                    )}
                  </View>
                )}
              </>
            )}
          </View>
        </View>

        </>)}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SECTION 2 — Mwallet USDT Spending Card                             */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {cardTab === "usdt" && (<>
        <View style={[s.sectionCard, { marginBottom: 0 }]}>
          <View


            style={s.sectionGrad}
          >
            <SectionHeader
              title="Mwallet USDT Spending Card"
              tag="INSTANT SPENDING"
              tagColor="#7C3AED"
            />

            {account ? (
              <KripicardModule
                ethAddress={ethAddress!}
                mxcAddress={mxcAddress!}
                account={account}
                onAccountUpdated={() => loadAccount(true)}
                showMsg={showMsg}
                getPrivateKey={getPrivateKey}
              />
            ) : (
              <View style={{ alignItems: "center", paddingVertical: 32, gap: 10 }}>
                <ActivityIndicator color="#7C3AED" />
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular",
                  color: "rgba(255,255,255,0.35)" }}>
                  Initialising…
                </Text>
              </View>
            )}
          </View>
        </View>

        </>)}

      </ScrollView>
    </View>
  );
}
