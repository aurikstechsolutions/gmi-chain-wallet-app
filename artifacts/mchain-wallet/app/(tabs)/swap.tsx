import { Icon } from "@/components/Icon";
import { TradeSelectorModal, type TradeSelectorOption } from "@/components/TradeSelectorModal";
import { useWallet } from "@/context/WalletContext";
import { useColors } from "@/hooks/useColors";
import { api, type AmmPublicConfig, type AmmTokenConfig, type BridgeChain, type BridgePublicConfig, type BridgeTransferStatus } from "@/services/api";
import {
  buildAmmAddLiquidity,
  buildAmmApproval,
  buildAmmRemoveLiquidity,
  buildAmmSwap,
  calculateAmmLiquidityCounterpart,
  calculateAmmQuote,
  calculateAmmLiquidityAmounts,
  formatAmmUnits,
  getAmmSnapshot,
  parseAmmUnits,
  type AmmQuote,
  type AmmSnapshot,
} from "@/services/amm";
import {
  buildBridgeDepositData,
  buildBridgeWithdrawData,
  buildErc20ApproveData,
  ethAddressToMxc,
  mxcAddressToEthAddress,
  parseUnits,
} from "@/services/crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";

type TradeMode = "swap" | "bridge";
type LiquidityMode = "add" | "remove";
type AmmAction = "idle" | "approving" | "signing" | "pending" | "success" | "error";
type BridgePhase = "idle" | "quoting" | "approving" | "signing" | "confirming" | "relaying" | "success" | "failed";
type AssetOption = {
  id: string;
  symbol: string;
  name: string;
  networkLabel: string;
};
type SelectorKind = "swap-from" | "swap-to" | "bridge-route" | null;

function isValidBridgeDestination(sourceChain: BridgeChain, value: string): boolean {
  const address = value.trim();
  if (sourceChain === "gmi") return /^0x[0-9a-fA-F]{40}$/.test(address);
  return /^gmi1[ac-hj-np-z02-9]{20,90}$/.test(address) || /^0x[0-9a-fA-F]{40}$/.test(address);
}

function packBridgeDestination(sourceChain: BridgeChain, value: string): string {
  const raw = value.trim();
  const evm = sourceChain === "bsc" && raw.startsWith("gmi1") ? mxcAddressToEthAddress(raw) : raw;
  const clean = evm.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{40}$/.test(clean)) throw new Error("Invalid destination address");
  return `0x${clean.toLowerCase().padStart(64, "0")}`;
}

function formatBps(value: bigint | number): string {
  const bps = typeof value === "bigint" ? Number(value) : value;
  return `${(bps / 100).toFixed(2)}%`;
}

function shortenHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function TokenPill({
  asset,
  onPress,
  colors,
}: {
  asset: AssetOption;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const content = (
    <>
      <View style={[styles.tokenMark, { backgroundColor: asset.symbol === "wUSDT" || asset.symbol === "USDT" ? colors.accent : colors.primary }]}>
        <Text style={styles.tokenMarkText}>{asset.symbol === "wUSDT" || asset.symbol === "USDT" ? "$" : "G"}</Text>
      </View>
      <Text style={[styles.tokenSymbol, { color: colors.foreground }]}>{asset.symbol}</Text>
      {onPress ? <Icon name="chevron-down" size={14} color={colors.mutedForeground} /> : null}
    </>
  );
  if (!onPress) return <View style={[styles.tokenPill, { backgroundColor: colors.background, borderColor: colors.border }]}>{content}</View>;
  return (
    <TouchableOpacity style={[styles.tokenPill, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={onPress} activeOpacity={0.78} accessibilityRole="button">
      {content}
    </TouchableOpacity>
  );
}

function AmountField({
  label,
  amount,
  placeholder,
  asset,
  available,
  onChange,
  onMax,
  onAssetPress,
  colors,
}: {
  label: string;
  amount: string;
  placeholder: string;
  asset: AssetOption;
  available?: string;
  onChange?: (value: string) => void;
  onMax?: () => void;
  onAssetPress?: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.amountBox, { backgroundColor: colors.input, borderColor: colors.border }]}>
      <View style={styles.amountHeader}>
        <Text style={[styles.fieldEyebrow, { color: colors.mutedForeground }]}>{label}</Text>
        {available !== undefined ? (
          <Text style={[styles.available, { color: colors.mutedForeground }]}>Available {available} {asset.symbol}</Text>
        ) : null}
      </View>
      <View style={styles.amountRow}>
        {onChange ? (
          <TextInput
            value={amount}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={colors.mutedForeground}
            keyboardType="decimal-pad"
            style={[styles.amountInput, { color: colors.foreground }]}
            accessibilityLabel={`${label} amount`}
          />
        ) : (
          <Text style={[styles.amountInput, { color: amount ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
            {amount || placeholder}
          </Text>
        )}
        {onMax ? (
          <TouchableOpacity onPress={onMax} style={styles.maxButton} activeOpacity={0.7} accessibilityRole="button">
            <Text style={[styles.maxText, { color: colors.primary }]}>MAX</Text>
          </TouchableOpacity>
        ) : null}
        <TokenPill asset={asset} onPress={onAssetPress} colors={colors} />
      </View>
    </View>
  );
}

function Notice({
  icon,
  children,
  tone = "muted",
  colors,
}: {
  icon: string;
  children: React.ReactNode;
  tone?: "muted" | "warning" | "error" | "success";
  colors: ReturnType<typeof useColors>;
}) {
  const toneColor = tone === "error" ? colors.destructive : tone === "warning" ? colors.warning : tone === "success" ? colors.success : colors.mutedForeground;
  return (
    <View style={[styles.notice, { backgroundColor: toneColor + "12", borderColor: toneColor + "30" }]}>
      <Icon name={icon} size={16} color={toneColor} />
      <Text style={[styles.noticeText, { color: toneColor }]}>{children}</Text>
    </View>
  );
}

function stylesFor(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingHorizontal: 20, paddingBottom: 120 },
    header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
    headerIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary + "18", borderWidth: 1, borderColor: colors.primary + "38" },
    headerCopy: { flex: 1 },
    eyebrow: { fontSize: 10, fontFamily: "Inter_700Bold", color: colors.primary, letterSpacing: 1.8, marginBottom: 2 },
    title: { fontSize: 24, fontFamily: "Inter_700Bold", color: colors.foreground },
    subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 3 },
    modeTabs: { flexDirection: "row", padding: 4, marginBottom: 14, backgroundColor: colors.secondary, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
    modeTab: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 10 },
    modeTabSelected: { backgroundColor: colors.card, shadowColor: colors.foreground, shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
    modeTabText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    modeTabTextSelected: { color: colors.foreground },
    formCard: { padding: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: colors.radius + 2 },
    amountBox: { borderRadius: colors.radius - 2, borderWidth: 1, padding: 14 },
    amountHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    fieldEyebrow: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1, textTransform: "uppercase" },
    available: { fontSize: 11, fontFamily: "Inter_400Regular" },
    amountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    amountInput: { flex: 1, minWidth: 0, paddingVertical: 4, fontSize: 24, fontFamily: "Inter_700Bold" },
    maxButton: { paddingHorizontal: 6, paddingVertical: 6 },
    maxText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
    tokenPill: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    tokenMark: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    tokenMarkText: { color: colors.primaryForeground, fontSize: 13, fontFamily: "Inter_700Bold" },
    tokenSymbol: { fontSize: 14, fontFamily: "Inter_700Bold" },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: -1 },
    divider: { flex: 1, height: 1, backgroundColor: colors.border },
    switchButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary + "55" },
    detailCard: { marginTop: 14, paddingHorizontal: 12, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    priceNote: { fontSize: 11, lineHeight: 16, marginTop: -3, marginBottom: 10, color: "#A86D13", fontFamily: "Inter_500Medium" },
    detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
    detailRowLast: { borderBottomWidth: 0 },
    detailLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    detailValue: { flexShrink: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground, textAlign: "right" },
    primaryButton: { alignItems: "center", justifyContent: "center", minHeight: 49, marginTop: 16, borderRadius: 13, backgroundColor: colors.muted },
    primaryButtonReady: { backgroundColor: colors.primary },
    primaryButtonText: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.mutedForeground },
    primaryButtonTextReady: { color: colors.primaryForeground },
    helperText: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginTop: 9 },
    notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 11, marginTop: 12, borderRadius: 11, borderWidth: 1 },
    noticeText: { flex: 1, fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium" },
    quoteHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 8 },
    sectionTitle: { fontSize: 12, fontFamily: "Inter_700Bold", color: colors.foreground, letterSpacing: 0.2 },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success, marginRight: 5 },
    liveLabel: { flexDirection: "row", alignItems: "center" },
    liveText: { fontSize: 10, fontFamily: "Inter_700Bold", color: colors.success, letterSpacing: 0.9 },
    liquidityTabs: { flexDirection: "row", gap: 7, marginTop: 2, marginBottom: 14 },
    liquidityTab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
    liquidityTabSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    liquidityTabText: { fontSize: 12, fontFamily: "Inter_700Bold", color: colors.mutedForeground },
    liquidityTabTextSelected: { color: colors.accentForeground },
    intro: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 14, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    introIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary + "16" },
    introCopy: { flex: 1 },
    introTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: colors.foreground },
    introText: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 },
    poolCard: { marginTop: 14, padding: 13, borderRadius: 12, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    poolLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#B7C8D7", letterSpacing: 1, textTransform: "uppercase" },
    poolValue: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.accentForeground, marginTop: 3 },
    poolMeta: { alignItems: "flex-end" },
    poolMetaLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#B7C8D7" },
    poolMetaValue: { fontSize: 13, fontFamily: "Inter_700Bold", color: colors.accentForeground, marginTop: 3 },
    bridgeRoute: { gap: 10, padding: 12, marginTop: 14, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    routePoint: { flexDirection: "row", alignItems: "center", gap: 10 },
    routePointCopy: { flex: 1 },
    routeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.primary + "45" },
    routeDotMuted: { backgroundColor: colors.mutedForeground, borderColor: colors.mutedForeground + "45" },
    routeLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.7 },
    routeValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginTop: 2 },
    destinationField: { marginTop: 14 },
    destinationInput: { minHeight: 46, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.input, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground },
    fieldHelper: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 6 },
    securityNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 4, marginTop: 16 },
    securityNoteText: { flex: 1, fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    bridgeIntro: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 14, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    bridgeIntroIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary + "15" },
    bridgeIntroCopy: { flex: 1 },
    bridgeIntroTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: colors.foreground },
    bridgeIntroText: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 },
  });
}

export default function SwapScreen() {
  const colors = useColors();
  const s = stylesFor(colors);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { activeWallet, getPrivateKey } = useWallet();
  const { mode: requestedMode } = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<TradeMode>("swap");
  const [liquidityMode, setLiquidityMode] = useState<LiquidityMode>("add");
  const [swapAmount, setSwapAmount] = useState("");
  const [bridgeAmount, setBridgeAmount] = useState("");
  const [slippage, setSlippage] = useState("0.50");
  const [swapDirection, setSwapDirection] = useState<"gmi-to-wusdt" | "wusdt-to-gmi">("gmi-to-wusdt");
  const [lpGmiAmount, setLpGmiAmount] = useState("");
  const [lpTokenAmount, setLpTokenAmount] = useState("");
  const [removeAmount, setRemoveAmount] = useState("");
  const [ammAction, setAmmAction] = useState<AmmAction>("idle");
  const [ammError, setAmmError] = useState<string | null>(null);
  const [ammTxHash, setAmmTxHash] = useState<string | null>(null);
  const [bridgeSource, setBridgeSource] = useState<BridgeChain>("gmi");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [bridgeStatus, setBridgeStatus] = useState<BridgeTransferStatus | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [bridgeSubmitting, setBridgeSubmitting] = useState(false);
  const [bridgePhase, setBridgePhase] = useState<BridgePhase>("idle");
  const [selector, setSelector] = useState<SelectorKind>(null);

  React.useEffect(() => {
    if (requestedMode === "bridge") {
      setMode("bridge");
    }
  }, [requestedMode]);

  const { data: bridgeConfig, isLoading: bridgeConfigLoading, isError: bridgeConfigError, refetch: refetchBridgeConfig } = useQuery<BridgePublicConfig>({
    queryKey: ["bridgeConfig"],
    queryFn: api.getBridgeConfig,
    enabled: mode === "bridge",
    staleTime: 30_000,
  });
  const sourceChainConfig = bridgeConfig?.sourceChains.find((chain) => chain.id === bridgeSource);
  const destinationChain = bridgeSource === "gmi" ? "bsc" : "gmi";
  const destinationChainConfig = bridgeConfig?.sourceChains.find((chain) => chain.id === destinationChain);
  const bridgeSourceAsset: AssetOption = {
    id: `${bridgeSource}-bridge-token`,
    symbol: bridgeSource === "gmi" ? "wUSDT" : "USDT",
    name: bridgeSource === "gmi" ? "GMI wrapped USDT" : "Tether USD",
    networkLabel: sourceChainConfig?.label ?? (bridgeSource === "gmi" ? "GMI Chain" : "BNB Smart Chain"),
  };
  const { data: bridgeBalance, isLoading: bridgeBalanceLoading, isError: bridgeBalanceError, refetch: refetchBridgeBalance } = useQuery({
    queryKey: ["bridgeBalance", bridgeSource, activeWallet?.id],
    queryFn: () => api.getBridgeCheck(bridgeSource, bridgeSource === "gmi" ? activeWallet!.mxcAddress : activeWallet!.ethAddress),
    enabled: mode === "bridge" && !!activeWallet && !!bridgeConfig?.enabled,
    staleTime: 15_000,
  });

  const { data: ammConfig, isLoading: ammLoading, isError: ammIsError } = useQuery<AmmPublicConfig>({
    queryKey: ["ammConfig"],
    queryFn: api.getAmmConfig,
    enabled: mode === "swap",
    staleTime: 30_000,
  });
  const { data: snapshot, dataUpdatedAt: snapshotUpdatedAt, isLoading: snapshotLoading, isError: snapshotIsError, refetch: refetchSnapshot } = useQuery<AmmSnapshot>({
    queryKey: ["ammSnapshot", activeWallet?.id, ammConfig?.pairs[0]?.pairAddress],
    queryFn: () => getAmmSnapshot(ammConfig!, activeWallet!.ethAddress),
    enabled: mode === "swap" && !!activeWallet && !!ammConfig?.enabled && !!ammConfig.pairs[0],
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  React.useEffect(() => {
    if (!activeWallet) {
      setDestinationAddress("");
      return;
    }
    setDestinationAddress(bridgeSource === "gmi" ? activeWallet.ethAddress : ethAddressToMxc(activeWallet.ethAddress));
    setBridgeStatus(null);
    setBridgeError(null);
    setBridgePhase("idle");
  }, [activeWallet?.id, bridgeSource]);

  const nativeToken = useMemo<AmmTokenConfig | undefined>(
    () => ammConfig?.supportedTokens.find((token) => token.id === "gmi" || token.isNative || (token.symbol.toUpperCase() === "GMI" && !token.address)),
    [ammConfig],
  );
  const wusdtToken = useMemo<AmmTokenConfig | undefined>(
    () => ammConfig?.supportedTokens.find((token) => token.id === "wusdt"),
    [ammConfig],
  );
  const fromToken = swapDirection === "gmi-to-wusdt" ? nativeToken : wusdtToken;
  const toToken = swapDirection === "gmi-to-wusdt" ? wusdtToken : nativeToken;
  const fromAsset: AssetOption = { id: swapDirection === "gmi-to-wusdt" ? "gmi" : "wusdt", symbol: fromToken?.symbol ?? (swapDirection === "gmi-to-wusdt" ? "GMI" : "wUSDT"), name: fromToken?.name ?? "GMI", networkLabel: "GMI Chain" };
  const toAsset: AssetOption = { id: swapDirection === "gmi-to-wusdt" ? "wusdt" : "gmi", symbol: toToken?.symbol ?? (swapDirection === "gmi-to-wusdt" ? "wUSDT" : "GMI"), name: toToken?.name ?? "wUSDT", networkLabel: "GMI Chain" };
  const nativeDecimals = nativeToken?.decimals ?? 18;
  const tokenDecimals = wusdtToken?.decimals ?? 6;
  const slippageBps = Math.round(Number(slippage) * 100);
  const quoteState = useMemo<{ quote?: AmmQuote; error?: string }>(() => {
    if (!snapshot || !fromToken || !toToken || !swapAmount.trim()) return {};
    try {
      const amountIn = parseAmmUnits(swapAmount, fromToken.decimals);
      const quote = calculateAmmQuote(
        amountIn,
        fromToken.isNative ? snapshot.reserveNative : snapshot.reserveToken,
        toToken.isNative ? snapshot.reserveNative : snapshot.reserveToken,
        ammConfig?.feeBps ?? 30,
        Number.isFinite(slippageBps) ? slippageBps : 50,
      );
      return { quote };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to calculate quote" };
    }
  }, [ammConfig?.feeBps, swapAmount, fromToken, snapshot, slippageBps, toToken]);
  const quote = quoteState.quote;
  const quoteStale = snapshotUpdatedAt > 0 && Date.now() - snapshotUpdatedAt > 60_000;
  const fromBalanceRaw = snapshot ? (fromToken?.isNative ? snapshot.nativeBalance : snapshot.tokenBalance) : 0n;
  const fromBalance = formatAmmUnits(fromBalanceRaw, fromToken?.decimals ?? 18);
  const lpBalance = formatAmmUnits(snapshot?.lpBalance ?? 0n, 18);
  const poolShare = snapshot && snapshot.totalSupply > 0n ? Number(snapshot.lpBalance * 10_000n / snapshot.totalSupply) / 100 : 0;
  const currentPair = snapshot ? `${formatAmmUnits(snapshot.reserveNative, nativeDecimals)} GMI / ${formatAmmUnits(snapshot.reserveToken, tokenDecimals)} wUSDT` : "—";

  function resetAmmStatus() {
    setAmmAction("idle");
    setAmmError(null);
    setAmmTxHash(null);
  }

  function updateLiquidityAmount(side: "gmi" | "wusdt", value: string) {
    if (side === "gmi") {
      setLpGmiAmount(value);
    } else {
      setLpTokenAmount(value);
    }
    if (ammAction !== "idle") resetAmmStatus();

    const otherSide = side === "gmi" ? "wusdt" : "gmi";
    const clearOtherAmount = () => {
      if (otherSide === "gmi") setLpGmiAmount("");
      else setLpTokenAmount("");
    };
    if (!value.trim() || !snapshot || snapshot.reserveToken <= 0n || snapshot.reserveNative <= 0n) {
      clearOtherAmount();
      return;
    }

    try {
      const inputAmount = parseAmmUnits(value, side === "gmi" ? nativeDecimals : tokenDecimals);
      const counterpart = calculateAmmLiquidityCounterpart(
        inputAmount,
        side === "gmi" ? "native" : "token",
        snapshot.reserveToken,
        snapshot.reserveNative,
      );
      if (counterpart <= 0n) {
        clearOtherAmount();
        return;
      }
      const counterpartText = formatAmmUnits(
        counterpart,
        side === "gmi" ? tokenDecimals : nativeDecimals,
      );
      if (otherSide === "gmi") setLpGmiAmount(counterpartText);
      else setLpTokenAmount(counterpartText);
    } catch {
      clearOtherAmount();
    }
  }

  async function sendAmmTransaction(toAddress: string, data: string, valueWei = 0n, gasLimit = 300_000n): Promise<string> {
    if (!activeWallet || !ammConfig) throw new Error("Connect a wallet to continue");
    const privateKey = await getPrivateKey(activeWallet.id);
    if (!privateKey) throw new Error("This wallet needs to be unlocked before signing.");
    setAmmAction("signing");
    const result = await api.sendBridgeContractTransaction({
      rpcUrl: ammConfig.rpcUrl,
      chainId: ammConfig.chainId,
      fromAddress: activeWallet.ethAddress,
      toAddress,
      data,
      privateKey,
      valueWei,
      gasLimit,
    });
    setAmmAction("pending");
    await api.waitForBridgeReceipt(ammConfig.rpcUrl, result.txHash);
    return result.txHash;
  }

  async function approveIfNeeded(token: AmmTokenConfig, amount: bigint, allowance: bigint, spender: string) {
    if (!token.address || allowance >= amount) return;
    setAmmAction("approving");
    const approval = await sendAmmTransaction(token.address, buildAmmApproval(token, spender, amount), 0n, 100_000n);
    setAmmTxHash(approval);
  }

  async function submitSwap() {
    if (!activeWallet || !ammConfig || !fromToken || !toToken || !quote || !snapshot) return;
    if (quoteStale) { setAmmAction("error"); setAmmError("This quote is stale. Refresh the pool before signing."); return; }
    try {
      setAmmError(null);
      setAmmTxHash(null);
      const amountIn = parseAmmUnits(swapAmount, fromToken.decimals);
      if (amountIn > fromBalanceRaw) throw new Error(`Insufficient ${fromToken.symbol} balance`);
      if (slippageBps < 0 || slippageBps > 2_000 || !Number.isFinite(slippageBps)) throw new Error("Slippage must be between 0% and 20%");
      await approveIfNeeded(fromToken, amountIn, snapshot.tokenAllowance, ammConfig.routerAddress!);
      const tx = buildAmmSwap(ammConfig, fromToken, toToken, quote, activeWallet.ethAddress, BigInt(Math.floor(Date.now() / 1000) + 1_200));
      const hash = await sendAmmTransaction(ammConfig.routerAddress!, tx.data, tx.valueWei);
      setAmmTxHash(hash);
      setAmmAction("success");
      await queryClient.invalidateQueries({ queryKey: ["ammSnapshot"] });
    } catch (error) {
      setAmmAction("error");
      setAmmError(error instanceof Error ? error.message : "Swap failed. Try again.");
    }
  }

  async function submitAddLiquidity() {
    if (!activeWallet || !ammConfig || !snapshot || !wusdtToken) return;
    try {
      setAmmError(null);
      setAmmTxHash(null);
      const tokenAmount = parseAmmUnits(lpTokenAmount, tokenDecimals);
      const nativeAmount = parseAmmUnits(lpGmiAmount, nativeDecimals);
      if (tokenAmount > snapshot.tokenBalance) throw new Error("Insufficient wUSDT balance");
      if (nativeAmount > snapshot.nativeBalance) throw new Error("Insufficient GMI balance");
      const liquidityAmounts = calculateAmmLiquidityAmounts(
        tokenAmount,
        nativeAmount,
        snapshot.reserveToken,
        snapshot.reserveNative,
        slippageBps,
      );
      await approveIfNeeded(wusdtToken, tokenAmount, snapshot.tokenAllowance, ammConfig.routerAddress!);
      const tx = buildAmmAddLiquidity(
        ammConfig,
        liquidityAmounts.tokenAmount,
        liquidityAmounts.nativeAmount,
        liquidityAmounts.tokenMinimum,
        liquidityAmounts.nativeMinimum,
        activeWallet.ethAddress,
        BigInt(Math.floor(Date.now() / 1000) + 1_200),
      );
      const hash = await sendAmmTransaction(ammConfig.routerAddress!, tx.data, tx.valueWei);
      setAmmTxHash(hash);
      setAmmAction("success");
      await queryClient.invalidateQueries({ queryKey: ["ammSnapshot"] });
    } catch (error) {
      setAmmAction("error");
      setAmmError(error instanceof Error ? error.message : "Liquidity deposit failed. Try again.");
    }
  }

  async function submitRemoveLiquidity() {
    if (!activeWallet || !ammConfig || !snapshot || snapshot.totalSupply <= 0n) return;
    try {
      setAmmError(null);
      setAmmTxHash(null);
      const lpAmount = parseAmmUnits(removeAmount, 18);
      if (lpAmount > snapshot.lpBalance) throw new Error("Insufficient LP balance");
      const tokenMin = snapshot.reserveToken * lpAmount / snapshot.totalSupply * BigInt(10_000 - slippageBps) / 10_000n;
      const nativeMin = snapshot.reserveNative * lpAmount / snapshot.totalSupply * BigInt(10_000 - slippageBps) / 10_000n;
      const pairAddress = snapshot.pairAddress;
      await approveIfNeeded({ id: "lp", symbol: "GMI/wUSDT LP", name: "Liquidity token", decimals: 18, address: pairAddress }, lpAmount, snapshot.lpAllowance, ammConfig.routerAddress!);
      const data = buildAmmRemoveLiquidity(ammConfig, lpAmount, tokenMin, nativeMin, activeWallet.ethAddress, BigInt(Math.floor(Date.now() / 1000) + 1_200));
      const hash = await sendAmmTransaction(ammConfig.routerAddress!, data);
      setAmmTxHash(hash);
      setAmmAction("success");
      await queryClient.invalidateQueries({ queryKey: ["ammSnapshot"] });
    } catch (error) {
      setAmmAction("error");
      setAmmError(error instanceof Error ? error.message : "Liquidity withdrawal failed. Try again.");
    }
  }

  async function pollBridgeStatus(source: BridgeChain, txHash: string) {
    let lastReadError: string | null = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      let status: BridgeTransferStatus;
      try {
        status = await api.getBridgeStatus(source, txHash);
      } catch (error) {
        lastReadError = error instanceof Error ? error.message : "Unable to read bridge status";
        setBridgeError(`Relay status is temporarily unavailable. Retrying… (${lastReadError})`);
        if (attempt >= 59) throw new Error(lastReadError);
        continue;
      }
      lastReadError = null;
      setBridgeError(null);
      setBridgeStatus(status);
      if (status.state === "confirmed") return;
      if (status.state === "failed") throw new Error(status.error ?? "Bridge relay failed");
    }
    throw new Error(lastReadError ?? "Bridge relay is taking longer than expected. Check status again later.");
  }

  const destinationIsValid = isValidBridgeDestination(bridgeSource, destinationAddress);
  const bridgeAmountState = useMemo<{ raw?: bigint; error?: string }>(() => {
    const value = bridgeAmount.trim();
    const decimals = sourceChainConfig?.tokenDecimals ?? 18;
    if (!value) return { error: "Enter an amount" };
    if (!/^(?:\d+|\d*\.\d+)$/.test(value)) return { error: "Use a valid decimal amount" };
    const fraction = value.split(".")[1] ?? "";
    if (fraction.length > decimals) return { error: `This asset supports up to ${decimals} decimal places` };
    try {
      const raw = parseUnits(value, decimals);
      if (raw <= 0n) return { error: "Amount must be greater than zero" };
      if (bridgeBalance && raw > BigInt(bridgeBalance.tokenBalanceRaw)) return { error: `Insufficient ${bridgeSourceAsset.symbol} balance` };
      if (bridgeConfig && raw < parseUnits(bridgeConfig.minAmount, decimals)) return { error: `Minimum bridge amount is ${bridgeConfig.minAmount} ${bridgeSourceAsset.symbol}` };
      return { raw };
    } catch {
      return { error: "Use a valid decimal amount" };
    }
  }, [bridgeAmount, bridgeBalance, bridgeConfig, bridgeSourceAsset.symbol, sourceChainConfig?.tokenDecimals]);
  const amountIsValid = !!bridgeAmountState.raw;
  const gasBalanceReady = !!bridgeBalance && BigInt(bridgeBalance.nativeBalanceWei) >= 1_000_000_000_000_000n;
  const bridgeReady = !!activeWallet && !!bridgeConfig?.enabled && !!sourceChainConfig?.rpcUrl && !bridgeConfigLoading && !bridgeBalanceLoading && !bridgeBalanceError && gasBalanceReady && destinationIsValid && amountIsValid && !bridgeSubmitting;
  const swapSelectorOptions: TradeSelectorOption[] = [
    { id: "gmi", title: nativeToken?.name ?? "GMI", subtitle: "Native asset · GMI Chain", mark: "G" },
    { id: "wusdt", title: wusdtToken?.name ?? "Wrapped USDT", subtitle: "Pool token · GMI Chain", mark: "$" },
  ];
  const bridgeRouteOptions: TradeSelectorOption[] = [
    { id: "gmi", title: "GMI Chain → BNB Smart Chain", subtitle: "wUSDT to native USDT", mark: "G" },
    { id: "bsc", title: "BNB Smart Chain → GMI Chain", subtitle: "USDT to GMI wUSDT", mark: "B" },
  ];
  function selectSwapAsset(side: "from" | "to", id: string) {
    const nextDirection = side === "from"
      ? id === "gmi" ? "gmi-to-wusdt" : "wusdt-to-gmi"
      : id === "gmi" ? "wusdt-to-gmi" : "gmi-to-wusdt";
    if (nextDirection !== swapDirection) resetAmmStatus();
    setSwapDirection(nextDirection);
    setSelector(null);
  }
  const selectedSelectorId = selector === "swap-from" ? fromAsset.id : selector === "swap-to" ? toAsset.id : bridgeSource;
  const selectorOptions = selector === "bridge-route" ? bridgeRouteOptions : swapSelectorOptions;
  const selectorTitle = selector === "bridge-route" ? "Choose bridge route" : selector === "swap-from" ? "Choose send asset" : "Choose receive asset";
  async function submitBridge() {
    if (!activeWallet || !sourceChainConfig?.rpcUrl || !sourceChainConfig.bridgeAddress || !sourceChainConfig.tokenAddress || !bridgeAmountState.raw || !amountIsValid || !destinationIsValid) return;
    setBridgeSubmitting(true); setBridgePhase("quoting"); setBridgeError(null); setBridgeStatus(null);
    try {
      const quoteResult = await api.getBridgeQuote(bridgeSource, bridgeAmount);
      const amountRaw = bridgeAmountState.raw;
      const packedDestination = packBridgeDestination(bridgeSource, destinationAddress);
      const privateKey = await getPrivateKey(activeWallet.id);
      if (!privateKey) throw new Error("This wallet needs to be unlocked before signing.");
      let txHash: string;
      if (bridgeSource === "bsc") {
        const allowance = bridgeBalance ? BigInt(bridgeBalance.tokenAllowanceRaw) : 0n;
        if (allowance < amountRaw) {
          setBridgePhase("approving");
          setBridgeStatus({ sourceChain: bridgeSource, txHash: "", state: "pending", grossAmount: quoteResult.grossAmount, netAmount: quoteResult.netAmount, updatedAt: new Date().toISOString() });
          const approval = await api.sendBridgeContractTransaction({ rpcUrl: sourceChainConfig.rpcUrl, chainId: sourceChainConfig.chainId, fromAddress: activeWallet.ethAddress, toAddress: sourceChainConfig.tokenAddress, data: buildErc20ApproveData(sourceChainConfig.bridgeAddress, amountRaw), privateKey, gasLimit: 80_000n });
          setBridgePhase("confirming");
          await api.waitForBridgeReceipt(sourceChainConfig.rpcUrl, approval.txHash);
        }
        setBridgePhase("signing");
        const deposit = await api.sendBridgeContractTransaction({ rpcUrl: sourceChainConfig.rpcUrl, chainId: sourceChainConfig.chainId, fromAddress: activeWallet.ethAddress, toAddress: sourceChainConfig.bridgeAddress, data: buildBridgeDepositData(amountRaw, packedDestination), privateKey });
        txHash = deposit.txHash;
      } else {
        setBridgePhase("signing");
        const withdrawal = await api.sendBridgeContractTransaction({ rpcUrl: sourceChainConfig.rpcUrl, chainId: sourceChainConfig.chainId, fromAddress: activeWallet.ethAddress, toAddress: sourceChainConfig.bridgeAddress, data: buildBridgeWithdrawData(amountRaw, packedDestination), privateKey });
        txHash = withdrawal.txHash;
      }
      setBridgePhase("confirming");
      setBridgeStatus({ sourceChain: bridgeSource, txHash, state: "pending", grossAmount: quoteResult.grossAmount, netAmount: quoteResult.netAmount, updatedAt: new Date().toISOString() });
      await api.waitForBridgeReceipt(sourceChainConfig.rpcUrl, txHash);
      setBridgePhase("relaying");
      setBridgeStatus(await api.notifyBridgeTransfer(bridgeSource, txHash));
      await pollBridgeStatus(bridgeSource, txHash);
      setBridgePhase("success");
      setBridgeError(null);
      await queryClient.invalidateQueries({ queryKey: ["bridgeBalance", bridgeSource, activeWallet.id] });
    } catch (error) {
      setBridgePhase("failed");
      setBridgeError(error instanceof Error ? error.message : "Unable to submit bridge transaction");
    } finally { setBridgeSubmitting(false); }
  }

  function selectMode(nextMode: TradeMode) {
    setMode(nextMode);
    if (nextMode === "swap") resetAmmStatus();
  }

  function renderAmmState() {
    if (!activeWallet) return <Notice icon="wallet-outline" tone="warning" colors={colors}>Connect or create a wallet to swap and manage liquidity. Your keys never leave this device.</Notice>;
    if (ammLoading) return <View style={[styles.loadingBlock, { backgroundColor: colors.input }]}><View style={[styles.loadingLine, { backgroundColor: colors.muted }]} /><View style={[styles.loadingLine, styles.loadingLineShort, { backgroundColor: colors.muted }]} /></View>;
    if (ammIsError || !ammConfig) return <Notice icon="wifi-outline" tone="error" colors={colors}>Could not load the AMM configuration. Check your network connection and try again.</Notice>;
    if (!ammConfig.enabled) return <Notice icon="pause-circle-outline" tone="warning" colors={colors}>GMI AMM is currently paused. No transactions can be submitted until it is enabled.</Notice>;
    if (ammConfig.missing.length > 0) return <Notice icon="settings-outline" tone="warning" colors={colors}>The configured AMM is incomplete. Trading is paused while the pool is being prepared.</Notice>;
    if (snapshotLoading && !snapshot) return <View style={[styles.loadingBlock, { backgroundColor: colors.input }]}><View style={[styles.loadingLine, { backgroundColor: colors.muted }]} /><View style={[styles.loadingLine, styles.loadingLineShort, { backgroundColor: colors.muted }]} /></View>;
    if (snapshotIsError && !snapshot) return <Notice icon="refresh-outline" tone="error" colors={colors}>Pool data is unavailable right now. Refresh to try the GMI network again.</Notice>;
    if (!snapshot) return <Notice icon="refresh-outline" tone="error" colors={colors}>Pool data is unavailable right now. Refresh to try the GMI network again.</Notice>;
    return null;
  }

  const ammState = renderAmmState();
  const actionBusy = ["approving", "signing", "pending"].includes(ammAction);
  const swapReady = !!activeWallet && !!ammConfig?.enabled && !!snapshot && !!quote && !quoteStale && !quoteState.error && !actionBusy;
  const liquidityReady = !!activeWallet && !!ammConfig?.enabled && !!snapshot && !actionBusy;
  const validSlippage = Number.isFinite(slippageBps) && slippageBps >= 0 && slippageBps <= 2_000;
  const addLiquidityReady = liquidityReady && validSlippage && !!lpGmiAmount && !!lpTokenAmount;
  const removeLiquidityReady = liquidityReady && validSlippage && !!removeAmount && !!snapshot && snapshot.totalSupply > 0n;

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 12) }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View style={s.headerIcon}><Icon name="swap-horizontal" size={22} color={colors.primary} /></View>
          <View style={s.headerCopy}><Text style={s.eyebrow}>GMI WALLET</Text><Text style={s.title}>Swap & Bridge</Text><Text style={s.subtitle}>A calm route for your GMI assets.</Text></View>
        </View>
        <View style={s.modeTabs} accessibilityRole="tablist">
          {(["swap", "bridge"] as const).map((tab) => {
            const selected = mode === tab;
            return <TouchableOpacity key={tab} style={[s.modeTab, selected && s.modeTabSelected]} onPress={() => selectMode(tab)} activeOpacity={0.8} accessibilityRole="tab" accessibilityState={{ selected }}>
              <Icon name={tab === "swap" ? "swap-horizontal-outline" : "git-compare-outline"} size={16} color={selected ? colors.primary : colors.mutedForeground} />
              <Text style={[s.modeTabText, selected && s.modeTabTextSelected]}>{tab === "swap" ? "Swap" : "Bridge"}</Text>
            </TouchableOpacity>;
          })}
        </View>

        {mode === "swap" ? (
          <>
            {ammState ? <View style={s.formCard}>{ammState}</View> : (
              <View style={s.formCard}>
                <View style={s.intro}>
                  <View style={s.introIcon}><Icon name="repeat-outline" size={19} color={colors.primary} /></View>
                  <View style={s.introCopy}><Text style={s.introTitle}>GMI native ↔ wUSDT</Text><Text style={s.introText}>Direct from your wallet, through the configured GMI pool.</Text></View>
                  <TouchableOpacity onPress={() => void refetchSnapshot()} accessibilityRole="button" accessibilityLabel="Refresh AMM pool"><Icon name="refresh-outline" size={18} color={colors.mutedForeground} /></TouchableOpacity>
                </View>
                 {snapshotIsError ? <Notice icon="refresh-outline" tone="warning" colors={colors}>Pool refresh is temporarily unavailable. Showing the last known pool data and retrying automatically.</Notice> : null}
                <View style={s.liquidityTabs}>
                  <TouchableOpacity style={[s.liquidityTab, liquidityMode === "add" && s.liquidityTabSelected]} onPress={() => { setLiquidityMode("add"); resetAmmStatus(); }} activeOpacity={0.8}><Text style={[s.liquidityTabText, liquidityMode === "add" && s.liquidityTabTextSelected]}>Swap</Text></TouchableOpacity>
                  <TouchableOpacity style={[s.liquidityTab, liquidityMode === "remove" && s.liquidityTabSelected]} onPress={() => { setLiquidityMode("remove"); resetAmmStatus(); }} activeOpacity={0.8}><Text style={[s.liquidityTabText, liquidityMode === "remove" && s.liquidityTabTextSelected]}>Liquidity</Text></TouchableOpacity>
                </View>
                {liquidityMode === "add" ? (
                  <>
                    <AmountField label="You send" asset={fromAsset} amount={swapAmount} placeholder="0.00" available={fromBalance} onChange={(value) => { setSwapAmount(value); if (ammAction !== "idle") resetAmmStatus(); }} onMax={() => setSwapAmount(formatAmmUnits(fromBalanceRaw, fromToken?.decimals ?? 18))} onAssetPress={() => setSelector("swap-from")} colors={colors} />
                    <View style={s.switchRow}><View style={s.divider} /><TouchableOpacity style={s.switchButton} onPress={() => { setSwapDirection((value) => value === "gmi-to-wusdt" ? "wusdt-to-gmi" : "gmi-to-wusdt"); setSwapAmount(""); resetAmmStatus(); }} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel="Switch swap assets"><Icon name="swap-horizontal" size={17} color={colors.primary} /></TouchableOpacity><View style={s.divider} /></View>
                    <AmountField label="You receive" asset={toAsset} amount={quote ? formatAmmUnits(quote.amountOut, toToken?.decimals ?? 18) : ""} placeholder="—" onAssetPress={() => setSelector("swap-to")} colors={colors} />
                    {quoteState.error ? <Notice icon="alert-triangle" tone="warning" colors={colors}>{quoteState.error}</Notice> : null}
                    {snapshot!.reserveNative === 0n || snapshot!.reserveToken === 0n ? <Notice icon="information-circle-outline" tone="warning" colors={colors}>This pool is empty. Liquidity must be added before swaps can be quoted.</Notice> : null}
                    <View style={s.detailCard}>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Rate</Text><Text style={s.detailValue}>{quote ? `1 ${fromAsset.symbol} ≈ ${formatAmmUnits(quote.amountOut * 10n ** BigInt(fromToken?.decimals ?? 18) / parseAmmUnits(swapAmount, fromToken?.decimals ?? 18), toToken?.decimals ?? 18)} ${toAsset.symbol}` : "—"}</Text></View>
                      <Text style={s.priceNote}>Pool-derived rate only. wUSDT is not automatically pegged by this AMM.</Text>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Minimum received</Text><Text style={s.detailValue}>{quote ? `${formatAmmUnits(quote.minimumOut, toToken?.decimals ?? 18)} ${toAsset.symbol}` : "—"}</Text></View>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Price impact</Text><Text style={s.detailValue}>{quote ? formatBps(quote.priceImpactBps) : "—"}</Text></View>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Pool fee</Text><Text style={s.detailValue}>{ammConfig ? formatBps(ammConfig.feeBps) : "—"}</Text></View>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Slippage tolerance</Text><View style={{ flexDirection: "row", alignItems: "center" }}><TextInput value={slippage} onChangeText={setSlippage} keyboardType="decimal-pad" style={[styles.slippageInput, { color: colors.foreground, borderColor: colors.border }]} /><Text style={s.detailValue}>%</Text></View></View>
                    </View>
                    {quoteStale ? <Notice icon="clock" tone="warning" colors={colors}>Quote expired after one minute. Refresh the pool before signing.</Notice> : null}
                    {ammError ? <Notice icon="alert-circle" tone="error" colors={colors}>{ammError}</Notice> : null}
                    {ammAction === "success" ? <Notice icon="checkmark-circle" tone="success" colors={colors}>Transaction confirmed{ammTxHash ? ` · ${shortenHash(ammTxHash)}` : ""}. Balances will refresh shortly.</Notice> : null}
                    <TouchableOpacity style={[s.primaryButton, swapReady && s.primaryButtonReady]} disabled={!swapReady} onPress={() => void submitSwap()} activeOpacity={0.82}><Text style={[s.primaryButtonText, swapReady && s.primaryButtonTextReady]}>{!activeWallet ? "Connect a wallet" : actionBusy ? ammAction === "approving" ? "Approve wUSDT…" : ammAction === "pending" ? "Confirming on GMI…" : "Preparing transaction…" : !swapAmount ? "Enter an amount" : quoteState.error ? "Quote unavailable" : quoteStale ? "Refresh quote" : "Review & swap"}</Text></TouchableOpacity>
                    <Text style={s.helperText}>Your wallet signs locally. The AMM never takes custody of your funds.</Text>
                  </>
                ) : (
                  <>
                    <View style={s.poolCard}><View><Text style={s.poolLabel}>Your LP position</Text><Text style={s.poolValue}>{lpBalance} LP</Text></View><View style={s.poolMeta}><Text style={s.poolMetaLabel}>Pool share</Text><Text style={s.poolMetaValue}>{poolShare.toFixed(2)}%</Text></View></View>
                    <Text style={[s.sectionTitle, { marginTop: 18, marginBottom: 9 }]}>Add liquidity</Text>
                    <AmountField label="GMI deposit" asset={{ id: "gmi", symbol: "GMI", name: "GMI", networkLabel: "GMI Chain" }} amount={lpGmiAmount} placeholder="0.00" available={formatAmmUnits(snapshot!.nativeBalance, nativeDecimals)} onChange={(value) => updateLiquidityAmount("gmi", value)} onMax={() => updateLiquidityAmount("gmi", formatAmmUnits(snapshot!.nativeBalance, nativeDecimals))} colors={colors} />
                    <View style={{ height: 8 }} />
                    <AmountField label="wUSDT deposit" asset={{ id: "wusdt", symbol: "wUSDT", name: "Wrapped USDT", networkLabel: "GMI Chain" }} amount={lpTokenAmount} placeholder="0.00" available={formatAmmUnits(snapshot!.tokenBalance, tokenDecimals)} onChange={(value) => updateLiquidityAmount("wusdt", value)} onMax={() => updateLiquidityAmount("wusdt", formatAmmUnits(snapshot!.tokenBalance, tokenDecimals))} colors={colors} />
                    <View style={s.detailCard}><View style={s.detailRow}><Text style={s.detailLabel}>Current pool</Text><Text style={s.detailValue}>{currentPair}</Text></View><View style={[s.detailRow, s.detailRowLast]}><Text style={s.detailLabel}>Slippage tolerance</Text><View style={{ flexDirection: "row", alignItems: "center" }}><TextInput value={slippage} onChangeText={setSlippage} keyboardType="decimal-pad" style={[styles.slippageInput, { color: colors.foreground, borderColor: colors.border }]} /><Text style={s.detailValue}>%</Text></View></View></View>
                    <Text style={[s.sectionTitle, { marginTop: 18, marginBottom: 9 }]}>Remove liquidity</Text>
                    <AmountField label="LP amount" asset={{ id: "lp", symbol: "LP", name: "GMI / wUSDT", networkLabel: "GMI Chain" }} amount={removeAmount} placeholder="0.00" available={lpBalance} onChange={setRemoveAmount} onMax={() => setRemoveAmount(lpBalance)} colors={colors} />
                    {snapshot!.totalSupply === 0n ? <Notice icon="information-circle-outline" tone="warning" colors={colors}>There are no LP tokens in this pool yet. Add the first liquidity position to open the market.</Notice> : null}
                    {ammError ? <Notice icon="alert-circle" tone="error" colors={colors}>{ammError}</Notice> : null}
                    {ammAction === "success" ? <Notice icon="checkmark-circle" tone="success" colors={colors}>Liquidity transaction confirmed{ammTxHash ? ` · ${shortenHash(ammTxHash)}` : ""}.</Notice> : null}
                    <TouchableOpacity style={[s.primaryButton, (removeAmount ? removeLiquidityReady : addLiquidityReady) && s.primaryButtonReady]} disabled={removeAmount ? !removeLiquidityReady : !addLiquidityReady} onPress={() => void (removeAmount ? submitRemoveLiquidity() : submitAddLiquidity())} activeOpacity={0.82}><Text style={[s.primaryButtonText, (removeAmount ? removeLiquidityReady : addLiquidityReady) && s.primaryButtonTextReady]}>{actionBusy ? ammAction === "approving" ? "Approve LP tokens…" : ammAction === "pending" ? "Confirming on GMI…" : "Preparing transaction…" : removeAmount ? snapshot!.totalSupply === 0n ? "No liquidity to remove" : "Remove liquidity" : !lpGmiAmount || !lpTokenAmount ? "Enter both assets" : "Add liquidity"}</Text></TouchableOpacity>
                    <Text style={s.helperText}>Liquidity is held in the configured GMI native / wUSDT pool. Deposits require both assets.</Text>
                  </>
                )}
              </View>
            )}
          </>
        ) : (
          <View style={s.formCard}>
            <View style={s.bridgeIntro}><View style={s.bridgeIntroIcon}><Icon name="git-compare-outline" size={19} color={colors.primary} /></View><View style={s.bridgeIntroCopy}><Text style={s.bridgeIntroTitle}>Move assets across networks</Text><Text style={s.bridgeIntroText}>Choose a destination when bridge routes are available.</Text></View><TouchableOpacity onPress={() => { void refetchBridgeConfig(); void refetchBridgeBalance(); }} accessibilityRole="button" accessibilityLabel="Refresh bridge data"><Icon name="refresh-outline" size={18} color={colors.mutedForeground} /></TouchableOpacity></View>
            {bridgeConfigLoading ? <View style={[styles.loadingBlock, { backgroundColor: colors.input }]}><View style={[styles.loadingLine, { backgroundColor: colors.muted }]} /><View style={[styles.loadingLine, styles.loadingLineShort, { backgroundColor: colors.muted }]} /></View> : null}
            {bridgeConfigError ? <Notice icon="wifi-outline" tone="error" colors={colors}>Bridge configuration is unavailable. Try refreshing before signing.</Notice> : null}
            <AmountField label="Asset to bridge" asset={bridgeSourceAsset} amount={bridgeAmount} placeholder="0.00" available={bridgeBalanceLoading ? "Loading…" : bridgeBalance?.tokenBalance} onChange={(value) => { setBridgeAmount(value); setBridgeError(null); }} onMax={() => setBridgeAmount(bridgeBalance?.tokenBalance ?? "")} onAssetPress={() => setSelector("bridge-route")} colors={colors} />
            {bridgeAmountState.error && bridgeAmount.length > 0 ? <Text style={[s.fieldHelper, { color: colors.destructive }]}>{bridgeAmountState.error}</Text> : null}
            <View style={s.bridgeRoute}><TouchableOpacity style={s.routePoint} onPress={() => setSelector("bridge-route")} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel="Choose bridge source"><View style={s.routeDot} /><View style={s.routePointCopy}><Text style={s.routeLabel}>From</Text><Text style={s.routeValue}>{sourceChainConfig?.label ?? bridgeSourceAsset.networkLabel}</Text></View><Icon name="chevron-down" size={17} color={colors.mutedForeground} /></TouchableOpacity><Icon name="arrow-down" size={17} color={colors.mutedForeground} /><TouchableOpacity style={s.routePoint} onPress={() => setSelector("bridge-route")} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel="Choose bridge destination"><View style={[s.routeDot, s.routeDotMuted]} /><View style={s.routePointCopy}><Text style={s.routeLabel}>To</Text><Text style={s.routeValue}>{destinationChainConfig?.label ?? (destinationChain === "gmi" ? "GMI Chain" : "BNB Smart Chain")}</Text></View><Icon name="chevron-down" size={17} color={colors.mutedForeground} /></TouchableOpacity></View>
            <View style={s.destinationField}><Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Recipient address</Text><TextInput value={destinationAddress} placeholder="Enter destination address" placeholderTextColor={colors.mutedForeground} onChangeText={setDestinationAddress} style={s.destinationInput} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Bridge recipient address" /><Text style={[s.fieldHelper, !destinationIsValid && destinationAddress.length > 0 && { color: colors.destructive }]}>{bridgeSource === "gmi" ? "BSC recipient must be a 0x address." : "GMI recipient can be a gmi1 or EVM address."}</Text></View>
            {!destinationIsValid && destinationAddress.length > 0 ? <Text style={[s.fieldHelper, { color: colors.destructive }]}>Enter a valid {bridgeSource === "gmi" ? "BSC 0x" : "GMI gmi1 or EVM"} recipient address.</Text> : null}
            <View style={s.detailCard}><View style={s.detailRow}><Text style={s.detailLabel}>Bridge route</Text><Text style={s.detailValue}>{bridgeSource === "gmi" ? "wUSDT → USDT" : "USDT → wUSDT"}</Text></View><View style={s.detailRow}><Text style={s.detailLabel}>Estimated time</Text><Text style={s.detailValue}>~3 minutes</Text></View><View style={s.detailRow}><Text style={s.detailLabel}>Bridge fee</Text><Text style={s.detailValue}>{bridgeConfig ? `${bridgeConfig.feeBps / 100}%` : "—"}</Text></View><View style={[s.detailRow, s.detailRowLast]}><Text style={s.detailLabel}>Destination liquidity</Text><Text style={s.detailValue}>{bridgeBalance?.destinationLiquidity ?? "—"} {bridgeSource === "gmi" ? "USDT" : "wUSDT"}</Text></View></View>
            {bridgeBalanceError ? <Notice icon="refresh-outline" tone="error" colors={colors}>Could not read your {bridgeSourceAsset.symbol} balance or allowance. Refresh and try again.</Notice> : null}
            {!gasBalanceReady && bridgeBalance && !bridgeBalanceError ? <Notice icon="warning-outline" tone="warning" colors={colors}>Add native {bridgeSource === "gmi" ? "GMI" : "BNB"} for source-chain gas before bridging.</Notice> : null}
            {bridgeStatus || bridgePhase !== "idle" ? <View style={s.detailCard}><View style={s.detailRow}><Text style={s.detailLabel}>Status</Text><Text style={s.detailValue}>{bridgePhase === "quoting" ? "Preparing quote" : bridgePhase === "approving" ? "Approval required" : bridgePhase === "signing" ? "Awaiting local signature" : bridgePhase === "confirming" ? "Awaiting source confirmation" : bridgePhase === "relaying" ? "Relay in progress" : bridgePhase === "success" ? "Confirmed" : bridgePhase === "failed" ? "Failed — retry available" : bridgeStatus?.state ?? "Ready"}</Text></View><View style={[s.detailRow, s.detailRowLast]}><Text style={s.detailLabel}>Source transaction</Text><Text style={s.detailValue} numberOfLines={1}>{bridgeStatus?.txHash ? shortenHash(bridgeStatus.txHash) : bridgePhase === "approving" ? "Approval in progress…" : "Not submitted yet"}</Text></View></View> : null}
            {bridgeError ? <Text style={[s.fieldHelper, { color: colors.destructive, marginTop: 12 }]}>{bridgeError}</Text> : null}
            <TouchableOpacity style={[s.primaryButton, bridgeReady && s.primaryButtonReady]} disabled={!bridgeReady} onPress={() => void submitBridge()} activeOpacity={0.8}><Text style={[s.primaryButtonText, bridgeReady && s.primaryButtonTextReady]}>{!activeWallet ? "Connect a wallet" : bridgeSubmitting ? bridgePhase === "quoting" ? "Preparing quote…" : bridgePhase === "approving" ? "Approve on BNB Smart Chain…" : bridgePhase === "signing" ? "Sign source transaction…" : bridgePhase === "confirming" ? "Confirming source transaction…" : "Starting relay…" : bridgeConfigLoading || bridgeBalanceLoading ? "Checking source chain…" : bridgeConfigError || bridgeBalanceError ? "Refresh bridge data" : !bridgeConfig?.enabled ? "Bridge awaiting configuration" : !bridgeAmount ? "Enter amount" : bridgeAmountState.error ? bridgeAmountState.error : !destinationIsValid ? "Enter recipient address" : !gasBalanceReady ? `Add ${bridgeSource === "gmi" ? "GMI" : "BNB"} for gas` : bridgePhase === "failed" ? "Retry bridge" : `Bridge ${bridgeAmount} ${bridgeSourceAsset.symbol}`}</Text></TouchableOpacity>
            <Text style={s.helperText}>Transactions are signed by your active wallet. The relay completes after source-chain confirmations.</Text>
          </View>
        )}
        <View style={s.securityNote}><Icon name="shield-checkmark-outline" size={16} color={colors.primary} /><Text style={s.securityNoteText}>Private keys stay on this device. Review every amount before signing on GMI Chain.</Text></View>
      </ScrollView>
      <TradeSelectorModal
        visible={selector !== null}
        title={selectorTitle}
        description={selector === "bridge-route" ? "Select which network holds the asset you want to bridge." : "Select an asset from the configured GMI liquidity pool."}
        options={selectorOptions}
        selectedId={selectedSelectorId}
        onSelect={(id) => {
          if (selector === "bridge-route") {
            setBridgeSource(id as BridgeChain);
            setSelector(null);
            setBridgeStatus(null);
            setBridgeError(null);
          } else if (selector) {
            selectSwapAsset(selector === "swap-from" ? "from" : "to", id);
          }
        }}
        onClose={() => setSelector(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  tokenPill: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 12 },
  tokenMark: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tokenMarkText: { color: "#FFFFFF", fontSize: 13, fontFamily: "Inter_700Bold" },
  tokenSymbol: { fontSize: 14, fontFamily: "Inter_700Bold" },
  amountBox: { borderRadius: 14, borderWidth: 1, padding: 14 },
  amountHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  fieldEyebrow: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1, textTransform: "uppercase" },
  available: { fontSize: 11, fontFamily: "Inter_400Regular" },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  amountInput: { flex: 1, minWidth: 0, paddingVertical: 4, fontSize: 24, fontFamily: "Inter_700Bold" },
  maxButton: { paddingHorizontal: 6, paddingVertical: 6 },
  maxText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 11, marginTop: 12, borderRadius: 11, borderWidth: 1 },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium" },
  loadingBlock: { padding: 16, borderRadius: 12, gap: 10 },
  loadingLine: { height: 18, borderRadius: 9, opacity: 0.65 },
  loadingLineShort: { width: "62%" },
  slippageInput: { width: 54, height: 30, marginRight: 4, paddingHorizontal: 7, borderWidth: 1, borderRadius: 7, textAlign: "right", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 7 },
});