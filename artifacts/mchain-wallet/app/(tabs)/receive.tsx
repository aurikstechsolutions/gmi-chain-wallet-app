import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { useColors } from "@/hooks/useColors";
import { useWallet } from "@/context/WalletContext";
import {
  DEFAULT_ASSETS,
  defaultAssetToCustomToken,
  getCustomTokens,
  type CustomToken,
} from "@/services/tokens";
import { GMI_CHAIN_ID, GMI_NATIVE_SYMBOL } from "@/services/chain";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { router, useFocusEffect } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ReceiveScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { mxcAddress, ethAddress, solAddress, activeWallet } = useWallet();

  const [requestAmount, setRequestAmount] = useState("");
  const [showAmountInput, setShowAmountInput] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState("");
  const [amountFocused, setAmountFocused] = useState(false);
  const [showEth, setShowEth] = useState(false);
  const [network, setNetwork] = useState<"gmi" | "solana">("gmi");
  // null = native MC, otherwise a custom token
  const [selectedToken, setSelectedToken] = useState<CustomToken | null>(null);

  const glowAnim = useRef(new Animated.Value(0)).current;
  const glowAnim2 = useRef(new Animated.Value(0)).current;
  const copyScale = useRef(new Animated.Value(1)).current;
  const qrScale = useRef(new Animated.Value(0.92)).current;
  const amountHeight = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);

  const { data: customTokens = [] } = useQuery<CustomToken[]>({
    queryKey: ["customTokens", activeWallet?.id],
    queryFn: () => getCustomTokens(activeWallet?.id ?? "", activeWallet?.nfcTemporary, activeWallet?.mxcAddress),
    enabled: !!activeWallet?.id,
  });

  // Reset amount when token changes
  useEffect(() => {
    setRequestAmount("");
    setShowAmountInput(false);
  }, [selectedToken, network]);

  useFocusEffect(
    React.useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, [])
  );

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ])
    ).start();
    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim2, { toValue: 1, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(glowAnim2, { toValue: 0, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      ).start();
    }, 1100);
    Animated.spring(qrScale, { toValue: 1, useNativeDriver: true, bounciness: 6, speed: 6 }).start();
  }, [glowAnim, glowAnim2, qrScale]);

  useEffect(() => {
    Animated.timing(amountHeight, {
      toValue: showAmountInput ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
      easing: Easing.inOut(Easing.ease),
    }).start();
  }, [showAmountInput, amountHeight]);

  const tokenSymbol = selectedToken
    ? selectedToken.symbol
    : network === "solana"
      ? "SOL"
      : GMI_NATIVE_SYMBOL;
  const hasAmount = !!requestAmount && parseFloat(requestAmount) > 0;

  const activeAddress = network === "solana"
    ? (solAddress ?? "")
    : showEth
      ? (ethAddress ?? "")
      : (mxcAddress ?? "");

  // Build QR value: include amount and token info when set
  const qrValue = (() => {
    if (!activeAddress) return "";
    const params: string[] = [];
    if (hasAmount) params.push(`amount=${requestAmount}`);
    if (selectedToken) {
      params.push(`token=${selectedToken.symbol}`);
      params.push(`contract=${selectedToken.contractAddress}`);
    }
    return params.length > 0 ? `${activeAddress}?${params.join("&")}` : activeAddress;
  })();

  async function handleCopy() {
    if (!activeAddress) return;
    await Clipboard.setStringAsync(activeAddress);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    Animated.sequence([
      Animated.timing(copyScale, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.timing(copyScale, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (!activeAddress) return;
    const networkName = network === "solana" ? "Solana" : "GMI Chain";
    const msg = hasAmount
      ? `Send ${requestAmount} ${tokenSymbol} to my ${networkName} address:\n${activeAddress}`
      : `My ${networkName} address:\n${activeAddress}`;
    try {
      await Share.share({ message: msg });
    } catch {
      // User cancelled
    }
  }

  const glowOpacity1 = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] });
  const glowScale1 = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const glowOpacity2 = glowAnim2.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.25] });
  const glowScale2 = glowAnim2.interpolate({ inputRange: [0, 1], outputRange: [1, 1.28] });

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16),
      paddingHorizontal: 20,
      paddingBottom: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    backBtn: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      alignItems: "center", justifyContent: "center",
    },
    headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground },
    qrSection: { alignItems: "center", paddingHorizontal: 24, paddingTop: 8 },
    networkSwitch: {
      flexDirection: "row", width: "100%", padding: 4, marginBottom: 14,
      borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    },
    networkSwitchBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
    networkSwitchBtnActive: { backgroundColor: colors.primary },
    networkSwitchText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    networkSwitchTextActive: { color: "#FFFFFF" },
    qrOuter: { alignItems: "center", justifyContent: "center", marginBottom: 24 },
    glowRing: {
      position: "absolute", width: 290, height: 290, borderRadius: 145,
      backgroundColor: colors.primary,
    },
    glowRing2: {
      position: "absolute", width: 290, height: 290, borderRadius: 145,
      backgroundColor: colors.primary,
    },
    qrCard: {
      backgroundColor: "#FFFFFF", borderRadius: 20, padding: 20,
      shadowColor: colors.primary, shadowOpacity: 0.2, shadowRadius: 20,
      shadowOffset: { width: 0, height: 4 }, elevation: 8,
    },
    networkBadge: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: colors.primary + "15", paddingHorizontal: 14, paddingVertical: 6,
      borderRadius: 20, borderWidth: 1, borderColor: colors.primary + "25", marginBottom: 20,
    },
    networkBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.primary },

    tokenPickerWrap: { width: "100%", marginBottom: 16 },
    tokenPickerLabel: { fontSize: 10, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 8 },
    tokenPickerRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    tokenChip: {
      flexDirection: "row", alignItems: "center", gap: 6,
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
      borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card,
    },
    tokenChipActive: { borderColor: colors.primary, backgroundColor: colors.primary + "12" },
    tokenChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    tokenChipTextActive: { color: colors.primary },
    tokenChipDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.border },
    tokenChipDotActive: { backgroundColor: colors.primary },

    addressCard: {
      width: "100%", backgroundColor: colors.card, borderRadius: colors.radius + 2,
      borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12,
    },
    addressLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 8 },
    addressText: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.primary, lineHeight: 21 },
    amountRequestRow: {
      width: "100%", flexDirection: "row", alignItems: "center",
      justifyContent: "space-between", marginBottom: 8,
    },
    amountRequestLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    amountToggle: {
      flexDirection: "row", alignItems: "center", gap: 5,
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    },
    amountToggleText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.primary },
    amountInputWrap: { width: "100%", overflow: "hidden", marginBottom: 12 },
    amountInputRow: {
      flexDirection: "row", alignItems: "center",
      backgroundColor: colors.card, borderRadius: colors.radius,
      borderWidth: 1, borderColor: colors.border,
    },
    amountInputRowFocused: { borderColor: colors.primary },
    amountInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    amountSuffix: { paddingHorizontal: 10, fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    amountSetBtn: {
      backgroundColor: colors.primary,
      borderTopRightRadius: colors.radius, borderBottomRightRadius: colors.radius,
      paddingHorizontal: 16, paddingVertical: 12,
      justifyContent: "center", alignItems: "center",
    },
    amountSetBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
    amountHint: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 4 },
    addrToggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    addrTogglePill: {
      flexDirection: "row", borderRadius: 20, overflow: "hidden",
      borderWidth: 1, borderColor: colors.border,
    },
    addrToggleBtn: { paddingHorizontal: 12, paddingVertical: 5 },
    addrToggleBtnActive: { backgroundColor: colors.primary },
    addrToggleBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    addrToggleBtnTextActive: { color: "#FFFFFF" },
    actionRow: { width: "100%", flexDirection: "row", gap: 10, paddingHorizontal: 0 },
    copyBtn: { flex: 1, borderRadius: colors.radius, overflow: "hidden" },
    shareBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: colors.card, borderRadius: colors.radius,
      borderWidth: 1, borderColor: colors.border, paddingVertical: 14,
    },
    shareBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
  });

  const gmiDefaultTokens = DEFAULT_ASSETS
    .filter((asset) => asset.chain === "gmi" && !!asset.contractAddress)
    .map(defaultAssetToCustomToken);
  const solanaTokens = DEFAULT_ASSETS
    .filter((asset) => asset.chain === "solana" && !!asset.contractAddress)
    .map(defaultAssetToCustomToken);
  const allTokens: Array<{ label: string; token: CustomToken | null }> = network === "solana"
    ? [
        { label: "SOL", token: null },
        ...solanaTokens.map((token) => ({ label: token.symbol, token })),
      ]
    : [
        { label: GMI_NATIVE_SYMBOL, token: null },
        ...gmiDefaultTokens.map((token) => ({ label: token.symbol, token })),
        ...customTokens.map((token) => ({ label: token.symbol, token })),
      ];

  return (
    <View style={s.container}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <Icon name="close" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Receive {tokenSymbol}</Text>
        </View>

        <View style={s.qrSection}>
          <View style={s.networkSwitch}>
            {(["gmi", "solana"] as const).map((item) => {
              const active = network === item;
              return (
                <TouchableOpacity
                  key={item}
                  style={[s.networkSwitchBtn, active && s.networkSwitchBtnActive]}
                  onPress={() => {
                    setNetwork(item);
                    setSelectedToken(null);
                    setShowEth(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[s.networkSwitchText, active && s.networkSwitchTextActive]}>
                    {item === "gmi" ? "GMI Chain" : "Solana"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={s.networkBadge}>
            <Icon name="flash-outline" size={12} color={colors.primary} />
            <Text style={s.networkBadgeText}>
              {network === "solana" ? "Solana · Mainnet" : `GMI Chain · Chain ${GMI_CHAIN_ID}`}
            </Text>
          </View>

          <View style={s.qrOuter}>
            <Animated.View style={[s.glowRing2, { opacity: glowOpacity2, transform: [{ scale: glowScale2 }] }]} />
            <Animated.View style={[s.glowRing, { opacity: glowOpacity1, transform: [{ scale: glowScale1 }] }]} />
            <Animated.View style={[s.qrCard, { transform: [{ scale: qrScale }] }]}>
              {activeAddress ? (
                <QRCode value={qrValue || activeAddress} size={200} color="#000000" backgroundColor="#FFFFFF" />
              ) : (
                <View style={{ width: 200, height: 200, backgroundColor: "#F0F0F0", borderRadius: 8 }} />
              )}
            </Animated.View>
          </View>

          {/* ── Token picker ── */}
          {allTokens.length > 1 && (
            <View style={s.tokenPickerWrap}>
              <Text style={s.tokenPickerLabel}>TOKEN</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tokenPickerRow}>
                {allTokens.map(({ label, token }) => {
                  const isActive = selectedToken?.id === token?.id;
                  return (
                    <TouchableOpacity
                      key={`${network}-${token?.id ?? "native"}`}
                      style={[s.tokenChip, isActive && s.tokenChipActive]}
                      onPress={() => setSelectedToken(token)}
                      activeOpacity={0.75}
                    >
                      <View style={[s.tokenChipDot, isActive && s.tokenChipDotActive]} />
                      <Text style={[s.tokenChipText, isActive && s.tokenChipTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <View style={s.amountRequestRow}>
            <Text style={s.amountRequestLabel}>
              {hasAmount
                ? `Requesting ${requestAmount} ${tokenSymbol}`
                : "Request specific amount"}
            </Text>
            <TouchableOpacity style={s.amountToggle} onPress={() => setShowAmountInput((v) => !v)}>
              <Icon name={showAmountInput ? "chevron-up" : "pencil-outline"} size={12} color={colors.primary} />
              <Text style={s.amountToggleText}>{showAmountInput ? "Hide" : "Set Amount"}</Text>
            </TouchableOpacity>
          </View>

          <Animated.View
            style={[
              s.amountInputWrap,
              {
                maxHeight: amountHeight.interpolate({ inputRange: [0, 1], outputRange: [0, 80] }),
                opacity: amountHeight,
              },
            ]}
          >
            <View style={[s.amountInputRow, amountFocused && s.amountInputRowFocused]}>
              <TextInput
                style={s.amountInput}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                value={requestAmount}
                onChangeText={setRequestAmount}
                onFocus={() => setAmountFocused(true)}
                onBlur={() => setAmountFocused(false)}
                keyboardType="decimal-pad"
              />
              <Text style={s.amountSuffix}>{tokenSymbol}</Text>
              <TouchableOpacity
                style={s.amountSetBtn}
                onPress={() => {
                  Keyboard.dismiss();
                  setShowAmountInput(false);
                }}
              >
                <Text style={s.amountSetBtnText}>Set</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.amountHint}>Encodes amount into the QR code</Text>
          </Animated.View>

          <View style={s.addressCard}>
            <View style={s.addrToggleRow}>
              <Text style={s.addressLabel}>
                {network === "solana" ? "YOUR SOLANA ADDRESS" : showEth ? "YOUR 0x ADDRESS" : "YOUR GMI ADDRESS"}
              </Text>
              {network === "gmi" && (
                <View style={s.addrTogglePill}>
                  <TouchableOpacity
                    style={[s.addrToggleBtn, !showEth && s.addrToggleBtnActive]}
                    onPress={() => setShowEth(false)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.addrToggleBtnText, !showEth && s.addrToggleBtnTextActive]}>gmi1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.addrToggleBtn, showEth && s.addrToggleBtnActive]}
                    onPress={() => setShowEth(true)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.addrToggleBtnText, showEth && s.addrToggleBtnTextActive]}>0x</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
            <Text style={s.addressText} selectable>
              {activeAddress || "Loading..."}
            </Text>
          </View>

          <View style={s.actionRow}>
            <Animated.View style={[s.copyBtn, { transform: [{ scale: copyScale }] }]}>
              <TouchableOpacity onPress={handleCopy} activeOpacity={0.85}>
                <View

                  style={{ paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: colors.radius }}
                >
                  <Icon name={copied ? "checkmark" : "copy-outline"} size={16} color="#FFFFFF" />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" }}>
                    {copied ? "Copied!" : "Copy Address"}
                  </Text>
                </View>
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity style={s.shareBtn} onPress={handleShare} activeOpacity={0.85}>
              <Icon name="share-social-outline" size={16} color={colors.foreground} />
              <Text style={s.shareBtnText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      <Toast message={toast} visible={!!toast} onHide={() => setToast("")} />
    </View>
  );
}
