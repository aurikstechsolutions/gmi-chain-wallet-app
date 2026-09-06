import { AddTokenModal } from "@/components/AddTokenModal";
import { AssetDetailModal, type AssetItem } from "@/components/AssetDetailModal";
import { Icon } from "@/components/Icon";
import { ImportWalletModal } from "@/components/ImportWalletModal";
import { NewWalletModal } from "@/components/NewWalletModal";
import { NfcWalletCard } from "@/components/NfcWalletCard";
import { WalletSwitcherModal } from "@/components/WalletSwitcherModal";
import { QRScannerModal } from "@/components/QRScannerModal";
import { BalanceSkeleton, AssetRowSkeleton } from "@/components/Skeleton";
import { PressableScale } from "@/components/PressableScale";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/context/WalletContext";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { api } from "@/services/api";
import { formatDate, formatUptime, shortenAddress, weiToMc } from "@/services/crypto";
import { fetchTokenBalance, getCustomTokens, removeCustomToken, type CustomToken, DEFAULT_ASSETS, type DefaultAsset, fetchDefaultAssetBalance } from "@/services/tokens";
import { PulsingDot } from "@/components/PulsingDot";
import { SessionTimer } from "@/components/SessionTimer";
import { Toast } from "@/components/Toast";
import { UsdtLogo } from "@/components/UsdtLogo";
import { useColors } from "@/hooks/useColors";
import { GMI_NATIVE_SYMBOL } from "@/services/chain";

const GMI_LOGO = require("../../assets/images/gmi-icon.png");

function TokenBalanceRow({
  token,
  userEthAddress,
  price,
  onRemove,
  onPress,
  onBalanceChange,
}: {
  token: CustomToken;
  userEthAddress: string | null;
  price?: number;
  onRemove: () => void;
  onPress: () => void;
  onBalanceChange?: (bal: string) => void;
}) {
  const colors = useColors();
  const s = StyleSheet.create({
    tokenRow: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 72,
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
      backgroundColor: colors.background,
    },
    tokenIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary + "20",
      borderWidth: 1,
      borderColor: colors.primary + "40",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    tokenIconText: { fontSize: 11, fontFamily: "Inter_700Bold", color: colors.primary },
    tokenInfo: { flex: 1, justifyContent: "center", gap: 3 },
    tokenName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, lineHeight: 18 },
    tokenSymbol: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 15 },
    tokenAmountCol: { alignItems: "flex-end", justifyContent: "center", gap: 2, flexShrink: 0 },
    tokenAmount: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, lineHeight: 18 },
    tokenSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 15 },
    tokenUsd: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 15 },
    tokenLogoImg: { width: 44, height: 44, borderRadius: 22 },
    verifiedBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: "#10B98115", borderWidth: 1, borderColor: "#10B98140" },
    verifiedText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#10B981" },
    deleteAction: {
      backgroundColor: "#EF4444",
      justifyContent: "center",
      alignItems: "center",
      width: 72,
      minHeight: 72,
    },
    deleteActionText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#FFFFFF", marginTop: 3 },
  });

  const { data: balance, isLoading } = useQuery({
    queryKey: ["tokenBalance", token.contractAddress, userEthAddress],
    queryFn: () =>
      userEthAddress
        ? fetchTokenBalance(token.contractAddress, userEthAddress, token.decimals)
        : Promise.resolve("0"),
    enabled: !!userEthAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const prevBalRef = React.useRef<string | undefined>(undefined);
  useEffect(() => {
    if (balance !== undefined && balance !== prevBalRef.current) {
      prevBalRef.current = balance;
      onBalanceChange?.(balance);
    }
  }, [balance, onBalanceChange]);

  const usdValue = price && balance ? parseFloat(balance) * price : 0;

  function renderRightActions() {
    return (
      <TouchableOpacity style={s.deleteAction} onPress={onRemove} activeOpacity={0.85}>
        <Icon name="trash-outline" size={20} color="#FFFFFF" />
        <Text style={s.deleteActionText}>Remove</Text>
      </TouchableOpacity>
    );
  }

  return (
    <Swipeable renderRightActions={renderRightActions} overshootRight={false}>
      <TouchableOpacity style={s.tokenRow} onPress={onPress} activeOpacity={0.8}>
        {token.symbol.toUpperCase().includes("USDT") ? (
          <UsdtLogo />
        ) : token.logoUrl ? (
          <Image source={{ uri: token.logoUrl }} style={s.tokenLogoImg} />
        ) : (
          <View style={s.tokenIconWrap}>
            <Text style={s.tokenIconText}>{token.symbol.slice(0, 3)}</Text>
          </View>
        )}
        <View style={s.tokenInfo}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={s.tokenName}>{token.symbol}</Text>
            {token.verified && (
              <View style={s.verifiedBadge}>
                <Text style={s.verifiedText}>✓</Text>
              </View>
            )}
          </View>
          <Text style={s.tokenSymbol} numberOfLines={1}>{token.name}</Text>
        </View>
        <View style={s.tokenAmountCol}>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginBottom: 4 }} />
          ) : (
            <Text style={[s.tokenAmount, balance && balance !== "0" ? {} : { color: colors.mutedForeground }]}>
              {balance ?? "—"}
            </Text>
          )}
          <Text style={s.tokenSub}>{token.symbol}</Text>
          {usdValue > 0 && <Text style={s.tokenUsd}>$ {usdValue.toFixed(2)}</Text>}
        </View>
        <Icon name="chevron-forward" size={14} color={colors.border} />
      </TouchableOpacity>
    </Swipeable>
  );
}

function DefaultAssetRow({
  asset,
  walletAddress,
  price,
  onPress,
  onBalanceChange,
}: {
  asset: DefaultAsset;
  walletAddress: string | null;
  price?: number;
  onPress: (balance: string) => void;
  onBalanceChange?: (bal: string) => void;
}) {
  const colors = useColors();
  const s = StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 72,
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
      backgroundColor: colors.background,
    },
    logoImg: { width: 44, height: 44, borderRadius: 22 },
    info: { flex: 1, justifyContent: "center", gap: 3 },
    name: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, lineHeight: 18 },
    sub: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 15 },
    amountCol: { alignItems: "flex-end", justifyContent: "center", gap: 2, flexShrink: 0 },
    amount: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, lineHeight: 18 },
    networkBadge: {
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 5,
      backgroundColor: asset.chain === "bsc" ? "#F0B90B15" : colors.primary + "15",
      borderWidth: 1,
      borderColor: asset.chain === "bsc" ? "#F0B90B40" : colors.primary + "40",
    },
    networkText: {
      fontSize: 9,
      fontFamily: "Inter_700Bold",
      color: asset.chain === "bsc" ? "#F0B90B" : colors.primary,
    },
  });

  const { data: balance, isLoading } = useQuery({
    queryKey: ["defaultAssetBalance", asset.id, walletAddress],
    queryFn: () =>
      walletAddress
        ? fetchDefaultAssetBalance(asset, walletAddress)
        : Promise.resolve("0"),
    enabled: !!walletAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const prevBalRef = React.useRef<string | undefined>(undefined);
  useEffect(() => {
    if (balance !== undefined && balance !== prevBalRef.current) {
      prevBalRef.current = balance;
      onBalanceChange?.(balance);
    }
  }, [balance, onBalanceChange]);

  const usdValue = price && balance ? parseFloat(balance.replace(/,/g, "")) * price : 0;

  return (
    <TouchableOpacity style={s.row} onPress={() => onPress(balance ?? "—")} activeOpacity={0.8}>
      {asset.symbol.toUpperCase().includes("USDT") ? (
        <UsdtLogo />
      ) : (
        <Image source={asset.logoSource ?? { uri: asset.logoUrl }} style={s.logoImg} />
      )}
      <View style={s.info}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={s.name}>{asset.symbol}</Text>
          <View style={s.networkBadge}>
            <Text style={s.networkText}>{asset.networkLabel}</Text>
          </View>
        </View>
        <Text style={s.sub} numberOfLines={1}>{asset.name}</Text>
      </View>
      <View style={s.amountCol}>
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginBottom: 4 }} />
        ) : (
             <Text style={[s.amount, balance && balance !== "0" && balance !== "—" ? {} : { color: colors.mutedForeground }]}>
            {balance ?? "—"}
          </Text>
        )}
        <Text style={s.sub}>{asset.symbol}</Text>
        {usdValue > 0 && <Text style={s.sub}>$ {usdValue.toFixed(2)}</Text>}
      </View>
      <Icon name="chevron-forward" size={14} color={colors.border} />
    </TouchableOpacity>
  );
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    mxcAddress,
    ethAddress,
    solAddress,
    moniker,
    validatorStatus,
    setValidatorStatus,
    pendingHeartbeat,
    sessionExpired,
    setSessionExpired,
    sessionExpiresAt,
    isStaked,
    activeWallet,
  } = useWallet();
  const { restartSession } = useHeartbeat();
  const [toastMessage, setToastMessage] = React.useState("");
  const [isRestarting, setIsRestarting] = React.useState(false);
  const [showScanner, setShowScanner] = React.useState(false);
  const [showNfcVault, setShowNfcVault] = React.useState(false);
  const [showNewWallet, setShowNewWallet] = React.useState(false);
  const [showImportWallet, setShowImportWallet] = React.useState(false);
  const [showWalletActions, setShowWalletActions] = React.useState(false);
  const [showSwitcher, setShowSwitcher] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"assets" | "nft" | "approvals">("assets");
  const [showAddToken, setShowAddToken] = React.useState(false);
  const [rpcMs, setRpcMs] = React.useState<number | null>(null);
  const [rpcPinging, setRpcPinging] = React.useState(false);
  const [showRpcBadge, setShowRpcBadge] = React.useState(false);
  const [selectedAsset, setSelectedAsset] = React.useState<AssetItem | null>(null);
  const [tokenBalancesMap, setTokenBalancesMap] = React.useState<Record<string, string>>({});
  const rpcBadgeOpacity = useRef(new Animated.Value(0)).current;
  const rpcHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Silent ping — updates dot colour and, after a 3-second delay, briefly
  // shows the ms badge. Used on app focus so the cold-start DNS/TLS cost
  // doesn't show a misleading number immediately.
  async function silentPing() {
    try {
      const ms = await api.ping() as number;
      setRpcMs(ms);
      // Show the badge 3 s after we have a real reading
      setTimeout(() => {
        setShowRpcBadge(true);
        Animated.timing(rpcBadgeOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        if (rpcHideTimer.current) clearTimeout(rpcHideTimer.current);
        rpcHideTimer.current = setTimeout(() => {
          Animated.timing(rpcBadgeOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
          setTimeout(() => setShowRpcBadge(false), 400);
        }, 4000);
      }, 3000);
    } catch {
      setRpcMs(-1);
    }
  }

  // On-tap ping — updates dot colour AND shows ms badge
  async function handlePingRpc() {
    if (rpcPinging) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRpcPinging(true);
    if (rpcHideTimer.current) clearTimeout(rpcHideTimer.current);
    Animated.timing(rpcBadgeOpacity, { toValue: 0, duration: 100, useNativeDriver: true }).start();
    try {
      const ms = await api.ping() as number;
      setRpcMs(ms);
    } catch {
      setRpcMs(-1);
    } finally {
      setRpcPinging(false);
      setShowRpcBadge(true);
      Animated.timing(rpcBadgeOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      rpcHideTimer.current = setTimeout(() => {
        Animated.timing(rpcBadgeOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
        setTimeout(() => setShowRpcBadge(false), 400);
      }, 4000);
    }
  }

  // Scroll to top + silent ping whenever this tab is focused
  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      void silentPing();
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Silent background poll every 30 s to keep dot colour fresh
  React.useEffect(() => {
    let cancelled = false;
    const id = setInterval(async () => {
      if (cancelled) return;
      try {
        const ms = await api.ping() as number;
        if (!cancelled) setRpcMs(ms);
      } catch {
        if (!cancelled) setRpcMs(-1);
      }
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function handleRestartSession() {
    setIsRestarting(true);
    try {
      await restartSession();
      setToastMessage("Session restarted — you're earning rewards again");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to restart session";
      setToastMessage(msg);
    } finally {
      setIsRestarting(false);
    }
  }

  const { data: account, isLoading: acctLoading, refetch: refetchAccount } = useQuery({
    queryKey: ["account", mxcAddress],
    queryFn: () => api.getAccount(mxcAddress!),
    enabled: !!mxcAddress,
    refetchInterval: 10_000,
  });

  const { data: chainInfo, refetch: refetchChain } = useQuery({
    queryKey: ["chainInfo"],
    queryFn: () => api.getChainInfo(),
    refetchInterval: 10_000,
  });

  const { data: validatorData, refetch: refetchValidator } = useQuery({
    queryKey: ["validator", mxcAddress],
    queryFn: () => api.getValidatorStatus(mxcAddress!),
    enabled: !!mxcAddress,
    refetchInterval: 30_000,
  });

  const {
    data: customTokens = [],
    refetch: refetchTokens,
  } = useQuery<CustomToken[]>({
    queryKey: ["customTokens", activeWallet?.id],
    queryFn: () => getCustomTokens(activeWallet?.id ?? "", activeWallet?.nfcTemporary, activeWallet?.mxcAddress),
    enabled: !!activeWallet?.id,
    staleTime: 0,
  });

  useEffect(() => {
    if (validatorData?.validator?.status) {
      setValidatorStatus(validatorData.validator.status);
    }
  }, [validatorData, setValidatorStatus]);

  const isRefreshing = false;

  async function handleRefresh() {
    await Promise.all([refetchAccount(), refetchChain(), refetchValidator()]);
  }

  async function copyAddress() {
    if (!mxcAddress) return;
    await Clipboard.setStringAsync(mxcAddress);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const balance = account?.balance ? weiToMc(account.balance) : "0.00";
  const vStatus = validatorData?.validator?.status ?? validatorStatus;

  const { data: prices = {} } = useQuery({
    queryKey: ["prices"],
    queryFn: () => api.getPrices(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const mcPrice = prices[GMI_NATIVE_SYMBOL] ?? 0;
  const mcUsdValue = parseFloat(balance) * mcPrice;
  const tokenUsdTotal = customTokens.reduce((sum, t) => {
    const tokenBal = parseFloat(tokenBalancesMap[t.contractAddress] ?? "0") || 0;
    const tokenPrice = prices[t.symbol.toUpperCase()] ?? 0;
    return sum + tokenBal * tokenPrice;
  }, 0);
  const defaultAssetUsdTotal = DEFAULT_ASSETS.reduce((sum, asset) => {
    const bal = parseFloat((tokenBalancesMap[asset.id] ?? "0").replace(/,/g, "")) || 0;
    const price = prices[asset.priceKey] ?? 0;
    return sum + bal * price;
  }, 0);
  const totalUsdValue = (mcUsdValue + tokenUsdTotal + defaultAssetUsdTotal).toFixed(2);

  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      paddingBottom: 100,
    },
    header: {
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 8),
      paddingHorizontal: 20,
      paddingBottom: 16,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    headerIconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    statusDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    rpcBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rpcBadgeDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    rpcBadgeText: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    balanceCard: {
      marginHorizontal: 20,
      borderRadius: colors.radius + 4,
      overflow: "hidden",
      marginBottom: 16,
    },
    balanceGrad: {
      padding: 24,
    },
    balanceLabel: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: "rgba(255,255,255,0.6)",
      letterSpacing: 2,
      marginBottom: 6,
    },
    balanceAmount: {
      fontSize: 44,
      fontFamily: "Inter_700Bold",
      color: "#FFFFFF",
      marginBottom: 4,
    },
    balanceSub: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: "rgba(255,255,255,0.5)",
      marginBottom: 20,
    },
    addressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: "rgba(0,0,0,0.2)",
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    addressText: {
      flex: 1,
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: "rgba(255,255,255,0.7)",
    },
    validatorCard: {
      marginHorizontal: 20,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 16,
    },
    validatorHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    validatorTitle: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      letterSpacing: 1.5,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    statusText: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: vStatus === "active" ? "#10B981" : vStatus === "pending" ? "#F59E0B" : vStatus === "banned" ? "#EF4444" : colors.mutedForeground,
    },
    uptimeText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    pendingBanner: {
      marginHorizontal: 20,
      marginBottom: 16,
      backgroundColor: "#1A1000",
      borderRadius: colors.radius - 4,
      borderWidth: 1,
      borderColor: "#F59E0B40",
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    pendingText: {
      flex: 1,
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: "#D4A017",
    },
    quickActions: {
      flexDirection: "row",
      paddingHorizontal: 20,
      gap: 12,
      marginBottom: 16,
    },
    tabsContainer: {
      marginHorizontal: 20,
      marginBottom: 20,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    tabBar: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tabItem: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 14,
      position: "relative",
    },
    tabLabel: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    tabLabelActive: {
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    tabUnderline: {
      position: "absolute",
      bottom: 0,
      left: "20%",
      right: "20%",
      height: 2,
      borderRadius: 1,
      backgroundColor: colors.primary,
    },
    tabPanel: {
      paddingVertical: 4,
    },
    tokenRow: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 72,
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    tokenIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary + "20",
      borderWidth: 1,
      borderColor: colors.primary + "40",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    tokenIconText: {
      fontSize: 11,
      fontFamily: "Inter_700Bold",
      color: colors.primary,
    },
    tokenInfo: {
      flex: 1,
      justifyContent: "center",
      gap: 3,
    },
    tokenName: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      lineHeight: 18,
    },
    tokenSymbol: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      lineHeight: 15,
    },
    tokenAmountCol: {
      alignItems: "flex-end",
      justifyContent: "center",
      gap: 3,
      flexShrink: 0,
    },
    tokenAmount: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      lineHeight: 18,
    },
    tokenSub: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      lineHeight: 15,
    },
    tokenLogoImg: {
      width: 44,
      height: 44,
      borderRadius: 22,
    },
    verifiedBadge: {
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 5,
      backgroundColor: "#10B98115",
      borderWidth: 1,
      borderColor: "#10B98140",
    },
    verifiedText: {
      fontSize: 9,
      fontFamily: "Inter_700Bold",
      color: "#10B981",
    },
    addTokenRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 10,
      marginBottom: 2,
      paddingVertical: 13,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.primary + "38",
      backgroundColor: colors.primary + "0A",
    },
    addTokenLabel: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
      letterSpacing: 0.25,
    },
    emptyPanel: {
      alignItems: "center",
      paddingVertical: 32,
      paddingHorizontal: 24,
      gap: 10,
    },
    emptyTitle: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    emptyDesc: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 18,
    },
    actionBtn: {
      flex: 1,
      borderRadius: colors.radius - 4,
      overflow: "hidden",
    },
    actionGrad: {
      paddingVertical: 14,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
    },
    actionText: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: "#FFFFFF",
    },
    sessionCard: {
      marginHorizontal: 20,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 16,
    },
    sessionRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      flexWrap: "wrap" as const,
    },
    sessionTimerHint: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 4,
    },
    sessionExpiredHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      marginBottom: 8,
    },
    sessionExpiredTitle: {
      fontSize: 16,
      fontFamily: "Inter_700Bold",
      color: "#F59E0B",
    },
    sessionExpiredDesc: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      lineHeight: 20,
      marginBottom: 16,
    },
    restartBtn: {
      borderRadius: colors.radius - 4,
      overflow: "hidden" as const,
    },
    restartGrad: {
      paddingVertical: 14,
      alignItems: "center" as const,
      flexDirection: "row" as const,
      justifyContent: "center" as const,
      gap: 8,
    },
    restartBtnText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: "#FFFFFF",
    },
    stakedBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
    },
    stakedText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.success,
    },
  });

  return (
    <View style={s.container}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <View style={s.header}>
          <TouchableOpacity style={s.headerLeft} onPress={() => setShowSwitcher(true)} activeOpacity={0.7}>
            <Icon name="menu" size={22} color={colors.foreground} />
            <TouchableOpacity
              onPress={handlePingRpc}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              {rpcPinging ? (
                <ActivityIndicator size={10} color={colors.primary} style={{ width: 10, height: 10 }} />
              ) : (
                <View style={[s.statusDot, {
                  backgroundColor:
                    rpcMs === null ? "#10B981" :
                    rpcMs < 0 ? "#EF4444" :
                    rpcMs < 300 ? "#10B981" :
                    rpcMs < 700 ? "#F59E0B" : "#EF4444",
                }]} />
              )}
            </TouchableOpacity>
            {showRpcBadge && rpcMs !== null && (
              <Animated.View style={[s.rpcBadge, { opacity: rpcBadgeOpacity }]} pointerEvents="none">
                <View style={[s.rpcBadgeDot, {
                  backgroundColor:
                    rpcMs < 0 ? "#EF4444" :
                    rpcMs < 300 ? "#10B981" :
                    rpcMs < 700 ? "#F59E0B" : "#EF4444",
                }]} />
                <Text style={s.rpcBadgeText}>
                  {rpcMs < 0 ? "error" : `${rpcMs} ms`}
                </Text>
              </Animated.View>
            )}
          </TouchableOpacity>
          <View style={s.headerRight}>
            <TouchableOpacity style={s.headerIconBtn} onPress={() => setShowNfcVault(true)}>
              <Icon name="wifi-outline" size={18} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity style={s.headerIconBtn} onPress={() => setShowWalletActions(true)}>
              <Icon name="wallet" size={18} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity style={s.headerIconBtn} onPress={() => setShowScanner(true)}>
              <Icon name="scan" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.balanceCard}>
          <View style={[s.balanceGrad, { backgroundColor: colors.accent }]}>
            <Text style={s.balanceLabel}>BALANCE</Text>
            {acctLoading ? (
              <BalanceSkeleton />
            ) : (
              <Text style={s.balanceAmount}>$ {totalUsdValue}</Text>
            )}

            <TouchableOpacity style={s.addressRow} onPress={copyAddress}>
              <Text style={s.addressText} numberOfLines={1}>
                {mxcAddress ? shortenAddress(mxcAddress, 8) : "—"}
              </Text>
              <Icon name="copy-outline" size={14} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>
          </View>
        </View>

        {vStatus === "banned" && (
          <View style={[s.pendingBanner, { borderColor: "#EF444440", backgroundColor: "#1A0000" }]}>
            <Icon name="alert-circle-outline" size={16} color="#EF4444" />
            <Text style={[s.pendingText, { color: "#F87171" }]}>Network access is restricted</Text>
          </View>
        )}


        <View style={s.quickActions}>
          <PressableScale style={s.actionBtn} onPress={() => router.push("/(tabs)/send")} hapticType="medium" scaleTo={0.94}>
            <View style={[s.actionGrad, { backgroundColor: colors.primary }]}>
              <Icon name="paper-plane-outline" size={16} color="#FFFFFF" />
              <Text style={s.actionText}>Send</Text>
            </View>
          </PressableScale>
          <PressableScale style={s.actionBtn} onPress={() => router.push("/(tabs)/receive")} hapticType="light" scaleTo={0.94}>
            <View style={[s.actionGrad, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}>
              <Icon name="download-outline" size={16} color={colors.primary} />
              <Text style={[s.actionText, { color: colors.primary }]}>Receive</Text>
            </View>
          </PressableScale>
        </View>

        <NfcWalletCard open={showNfcVault} onClose={() => setShowNfcVault(false)} hideCard />

        {/* ── Portfolio tabs ─────────────────────────────────── */}
        <View style={s.tabsContainer}>
          {/* Tab bar */}
          <View style={s.tabBar}>
            {(["assets", "nft", "approvals"] as const).map((tab) => (
              <TouchableOpacity
                key={tab}
                style={s.tabItem}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.7}
              >
                <Text style={[s.tabLabel, activeTab === tab && s.tabLabelActive]}>
                  {tab === "assets" ? "Assets" : tab === "nft" ? "NFT" : "Approvals"}
                </Text>
                {activeTab === tab && <View style={s.tabUnderline} />}
              </TouchableOpacity>
            ))}
          </View>

          {/* Assets */}
          {activeTab === "assets" && (
            <View style={s.tabPanel}>
              {/* Native GMI row */}
              <TouchableOpacity
                style={s.tokenRow}
                activeOpacity={0.8}
                onPress={() => setSelectedAsset({ kind: "native", balance, address: mxcAddress ?? "" })}
              >
                 <Image source={GMI_LOGO} style={s.tokenLogoImg} accessibilityLabel="GMI logo" />
                <View style={s.tokenInfo}>
                  <Text style={s.tokenName}>GMI Chain</Text>
                  <Text style={s.tokenSymbol}>{GMI_NATIVE_SYMBOL} · Native</Text>
                </View>
                <View style={s.tokenAmountCol}>
                  <Text style={s.tokenAmount}>{balance}</Text>
                  <Text style={s.tokenSub}>{GMI_NATIVE_SYMBOL}</Text>
                  {mcUsdValue > 0 && <Text style={s.tokenSub}>$ {mcUsdValue.toFixed(2)}</Text>}
                </View>
                <Icon name="chevron-forward" size={14} color={colors.border} style={{ marginLeft: 4 }} />
              </TouchableOpacity>

               {/* Default BSC/Solana assets plus any contract-backed registry assets.
                  GMI native is rendered above to keep its detail behavior intact. */}
               {DEFAULT_ASSETS.filter((asset) => asset.chain === "bsc" || asset.chain === "solana" || !!asset.contractAddress).map((asset) => (
                 <React.Fragment key={asset.id}>
                   <DefaultAssetRow
                     asset={asset}
                     walletAddress={asset.chain === "solana" ? solAddress : ethAddress}
                     price={prices[asset.priceKey] ?? 0}
                     onPress={(bal) =>
                       setSelectedAsset({
                         kind: "default",
                         asset,
                         balance: bal,
                         address: asset.chain === "solana" ? (solAddress ?? "") : (ethAddress ?? ""),
                       })
                     }
                     onBalanceChange={(bal) =>
                       setTokenBalancesMap(prev => ({ ...prev, [asset.id]: bal }))
                     }
                   />
                 </React.Fragment>
               ))}

              {/* Custom tokens */}
              {customTokens.map((token) => (
                <TokenBalanceRow
                  key={token.id}
                  token={token}
                  userEthAddress={ethAddress ?? null}
                  price={prices[token.symbol.toUpperCase()] ?? 0}
                  onRemove={async () => {
                    await removeCustomToken(token.contractAddress, activeWallet?.id ?? "", activeWallet?.nfcTemporary, activeWallet?.mxcAddress);
                    refetchTokens();
                  }}
                  onPress={() => setSelectedAsset({ kind: "token", token, balance: "—", address: ethAddress ?? "" })}
                  onBalanceChange={(bal) =>
                    setTokenBalancesMap(prev => ({ ...prev, [token.contractAddress]: bal }))
                  }
                />
              ))}

              {/* Add token button */}
              <TouchableOpacity
                style={s.addTokenRow}
                onPress={() => setShowAddToken(true)}
                activeOpacity={0.75}
              >
                <Icon name="plus-circle" size={15} color={colors.primary} />
                <Text style={s.addTokenLabel}>Add Token</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* NFT */}
          {activeTab === "nft" && (
            <View style={s.emptyPanel}>
              <Icon name="cube-outline" size={36} color={colors.border} />
              <Text style={s.emptyTitle}>No NFTs found</Text>
              <Text style={s.emptyDesc}>NFTs held by this wallet will appear here.</Text>
            </View>
          )}

          {/* Approvals */}
          {activeTab === "approvals" && (
            <View style={s.emptyPanel}>
              <Icon name="shield-outline" size={36} color={colors.border} />
              <Text style={s.emptyTitle}>No active approvals</Text>
              <Text style={s.emptyDesc}>
                Contract approvals grant a smart contract permission to spend your tokens.
                {"\n"}None have been detected for this wallet.
              </Text>
            </View>
          )}
        </View>

      </ScrollView>
      <Toast
        message={toastMessage}
        visible={!!toastMessage}
        onHide={() => setToastMessage("")}
      />
      <WalletSwitcherModal
        visible={showSwitcher}
        onClose={() => setShowSwitcher(false)}
        onAddWallet={() => setShowNewWallet(true)}
      />
      {/* Wallet action chooser */}
      <Modal
        visible={showWalletActions}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWalletActions(false)}
        statusBarTranslucent
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}
          activeOpacity={1}
          onPress={() => setShowWalletActions(false)}
        >
          <View style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderTopWidth: 1, borderColor: colors.border,
            paddingBottom: insets.bottom + 12, paddingTop: 8,
          }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 16 }} />
            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2, textAlign: "center", marginBottom: 12 }}>
              WALLET
            </Text>
            <TouchableOpacity
              onPress={() => { setShowWalletActions(false); setTimeout(() => setShowNewWallet(true), 200); }}
              activeOpacity={0.75}
              style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 24, paddingVertical: 16 }}
            >
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary + "22", borderWidth: 1, borderColor: colors.primary + "44", alignItems: "center", justifyContent: "center" }}>
                <Icon name="add-circle-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>Create New Wallet</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>Generate a fresh keypair</Text>
              </View>
              <Icon name="chevron-forward" size={16} color={colors.border} />
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 24 }} />
            <TouchableOpacity
              onPress={() => { setShowWalletActions(false); setTimeout(() => setShowImportWallet(true), 200); }}
              activeOpacity={0.75}
              style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 24, paddingVertical: 16 }}
            >
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: "#10B98122", borderWidth: 1, borderColor: "#10B98144", alignItems: "center", justifyContent: "center" }}>
                <Icon name="download-outline" size={20} color="#10B981" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>Import Wallet</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>Restore from seed phrase or private key</Text>
              </View>
              <Icon name="chevron-forward" size={16} color={colors.border} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <NewWalletModal
        visible={showNewWallet}
        onClose={() => setShowNewWallet(false)}
      />
      <ImportWalletModal
        visible={showImportWallet}
        onClose={() => setShowImportWallet(false)}
      />
      <AddTokenModal
        visible={showAddToken}
        onClose={() => setShowAddToken(false)}
        onAdded={() => { refetchTokens(); }}
      />
      <AssetDetailModal
        asset={selectedAsset}
        visible={!!selectedAsset}
        onClose={() => setSelectedAsset(null)}
      />
      <QRScannerModal
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(address) => {
          setShowScanner(false);
          router.push({ pathname: "/(tabs)/send", params: { address } });
        }}
      />
    </View>
  );
}
