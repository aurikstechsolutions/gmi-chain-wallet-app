import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { UsdtLogo } from "@/components/UsdtLogo";
import { QRScannerModal } from "@/components/QRScannerModal";
import { useColors } from "@/hooks/useColors";
import { usePinContext } from "@/context/PinContext";
import { useWallet } from "@/context/WalletContext";
import { api } from "@/services/api";
import {
  buildErc20TransferDataHex,
  mcToWei,
  mxcAddressToEthAddress,
  parseUnits,
  shortenAddress,
  weiToMc,
} from "@/services/crypto";
import {
  fetchTokenBalanceRaw,
  getCustomTokens,
  type CustomToken,
  DEFAULT_ASSETS,
  defaultAssetToCustomToken,
} from "@/services/tokens";
import { GMI_CHAIN_ID, GMI_NATIVE_SYMBOL } from "@/services/chain";
import {
  fetchSolanaBalanceRaw,
  fetchSolanaTokenBalanceRaw,
  formatSolanaAmount,
  isValidSolanaAddress,
  parseSolanaAmount,
  sendSol,
  sendSolanaToken,
  SOLANA_NATIVE_DECIMALS,
} from "@/services/solana";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";

import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type SendStep = "input" | "confirm" | "success";
const RECENT_KEY = "mchain_recent_recipients";

type SelectedAsset =
  | { kind: "native"; chain: "gmi" | "solana" }
  | { kind: "token"; token: CustomToken };

const SOL_LOGO = require("../../assets/images/solana-coingecko.png");

// ── Asset Picker Sheet ────────────────────────────────────────────────────────

function AssetPickerSheet({
  visible,
  onClose,
  tokens,
  defaultTokens,
  selected,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  tokens: CustomToken[];
  defaultTokens: CustomToken[];
  selected: SelectedAsset;
  onSelect: (a: SelectedAsset) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      borderTopWidth: 1, borderColor: colors.border,
      paddingBottom: insets.bottom + 12,
    },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: 12, marginBottom: 4 },
    header: { paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    title: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.foreground },
    row: {
      flexDirection: "row", alignItems: "center", gap: 14,
      paddingHorizontal: 20, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    iconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary + "20", borderWidth: 1, borderColor: colors.primary + "40", alignItems: "center", justifyContent: "center" },
    iconText: { fontSize: 13, fontFamily: "Inter_700Bold", color: colors.primary },
    tokenImg: { width: 44, height: 44, borderRadius: 22 },
    info: { flex: 1 },
    name: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    sub: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 1 },
    checkWrap: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  });

  const isGmiSelected = selected.kind === "native" && selected.chain === "gmi";
  const isSolSelected = selected.kind === "native" && selected.chain === "solana";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>Select Asset to Send</Text>
          </View>
          <TouchableOpacity
            style={s.row}
            onPress={() => { onSelect({ kind: "native", chain: "gmi" }); onClose(); }}
            activeOpacity={0.75}
          >
            <View style={s.iconWrap}>
              <Text style={s.iconText}>{GMI_NATIVE_SYMBOL}</Text>
            </View>
            <View style={s.info}>
              <Text style={s.name}>GMI Chain</Text>
              <Text style={s.sub}>{GMI_NATIVE_SYMBOL} · Native Coin</Text>
            </View>
            {isGmiSelected && (
              <View style={s.checkWrap}>
                <Icon name="checkmark" size={14} color="#FFF" />
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.row}
            onPress={() => { onSelect({ kind: "native", chain: "solana" }); onClose(); }}
            activeOpacity={0.75}
          >
            <Image source={SOL_LOGO} style={s.tokenImg} />
            <View style={s.info}>
              <Text style={s.name}>Solana</Text>
              <Text style={s.sub}>SOL · Native Coin</Text>
            </View>
            {isSolSelected && (
              <View style={s.checkWrap}>
                <Icon name="checkmark" size={14} color="#FFF" />
              </View>
            )}
          </TouchableOpacity>
          {[...defaultTokens, ...tokens].map((token) => {
            const isSelected = selected.kind === "token" && selected.token.contractAddress === token.contractAddress;
            return (
              <TouchableOpacity
                key={token.id}
                style={s.row}
                onPress={() => { onSelect({ kind: "token", token }); onClose(); }}
                activeOpacity={0.75}
              >
                {token.symbol.toUpperCase().includes("USDT") ? (
                  <UsdtLogo />
                ) : token.logoUrl ? (
                  <Image source={{ uri: token.logoUrl }} style={s.tokenImg} />
                ) : (
                  <View style={s.iconWrap}>
                    <Text style={s.iconText}>{token.symbol.slice(0, 3)}</Text>
                  </View>
                )}
                <View style={s.info}>
                  <Text style={s.name}>{token.symbol}</Text>
                  <Text style={s.sub} numberOfLines={1}>{token.name}</Text>
                </View>
                {isSelected && (
                  <View style={s.checkWrap}>
                    <Icon name="checkmark" size={14} color="#FFF" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function SendScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { mxcAddress, solAddress, getPrivateKey, activeWallet } = useWallet();
  const { requestPin, dismissPin } = usePinContext();

  const { address: prefillAddress, tokenContract } = useLocalSearchParams<{
    address?: string;
    tokenContract?: string;
  }>();

  const [step, setStep] = useState<SendStep>("input");
  const [recipient, setRecipient] = useState(prefillAddress ?? "");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [recentAddresses, setRecentAddresses] = useState<string[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [recipientFocused, setRecipientFocused] = useState(false);
  const [amountFocused, setAmountFocused] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<SelectedAsset>({ kind: "native", chain: "gmi" });
  const [showAssetPicker, setShowAssetPicker] = useState(false);

  const submittingRef = useRef(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const checkRotate = useRef(new Animated.Value(0)).current;
  const hashOpacity = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);

  const { data: account, refetch: refetchAccount } = useQuery({
    queryKey: ["account", mxcAddress],
    queryFn: () => api.getAccount(mxcAddress!),
    enabled: !!mxcAddress,
    refetchInterval: 15_000,
  });

  const { data: customTokens = [] } = useQuery({
    queryKey: ["customTokens", activeWallet?.id],
    queryFn: () => getCustomTokens(activeWallet?.id ?? "", activeWallet?.nfcTemporary, activeWallet?.mxcAddress),
    enabled: !!activeWallet?.id,
    staleTime: 30_000,
  });

  // Contract-backed GMI and Solana assets can be selected as token transfers.
  const defaultTokens = DEFAULT_ASSETS
    .filter((a) => (a.chain === "gmi" || a.chain === "solana") && !!a.contractAddress)
    .map(defaultAssetToCustomToken);

  const isToken = selectedAsset.kind === "token";
  const selectedToken = isToken ? selectedAsset.token : null;
  const assetChain = isToken ? (selectedToken?.chain ?? "gmi") : selectedAsset.chain;
  const isSolana = assetChain === "solana";

  const { data: tokenBalRaw } = useQuery({
    queryKey: ["tokenBalRaw", selectedToken?.contractAddress, account?.ethAddress],
    queryFn: () => fetchTokenBalanceRaw(selectedToken!.contractAddress, account!.ethAddress!),
    enabled: !!selectedToken && !isSolana && !!account?.ethAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: solBalanceRawText = "0" } = useQuery({
    queryKey: ["solanaBalance", solAddress],
    queryFn: async () => (await fetchSolanaBalanceRaw(solAddress!)).toString(),
    enabled: !!solAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: solTokenBalanceRawText } = useQuery({
    queryKey: ["solanaTokenBalance", selectedToken?.contractAddress, solAddress],
    queryFn: async () => (
      await fetchSolanaTokenBalanceRaw(selectedToken!.contractAddress, solAddress!)
    ).toString(),
    enabled: !!selectedToken && isSolana && !!solAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const symbol = isToken ? selectedToken!.symbol : isSolana ? "SOL" : GMI_NATIVE_SYMBOL;
  const mcBalance = weiToMc(account?.balance ?? "0");
  const mcBalanceNum = parseFloat(mcBalance.replace(/,/g, ""));
  const solBalanceRaw = BigInt(solBalanceRawText);
  const solTokenBalanceRaw = solTokenBalanceRawText === undefined
    ? undefined
    : BigInt(solTokenBalanceRawText);
  const solBalance = formatSolanaAmount(solBalanceRaw, SOLANA_NATIVE_DECIMALS);
  const tokenBalanceNum = isSolana
    ? Number(solTokenBalanceRaw ?? 0n) / Math.pow(10, selectedToken?.decimals ?? 0)
    : tokenBalRaw !== undefined && selectedToken
      ? Number(tokenBalRaw) / Math.pow(10, selectedToken.decimals)
      : 0;
  const displayBalance = isToken
    ? tokenBalanceNum.toLocaleString("en-US", { maximumFractionDigits: 6 })
    : isSolana
      ? solBalance
      : mcBalance;

  const TX_FEE_MC = 0.0001;
  const TX_FEE_SOL = 0.00001;
  const SPL_TOKEN_FEE_SOL = 0.003;
  const TX_FEE_LAMPORTS = 10_000n;
  const SPL_TOKEN_FEE_LAMPORTS = 3_000_000n;

  // Pre-populate recipient from params
  useEffect(() => {
    if (prefillAddress) { setRecipient(prefillAddress); setStep("input"); }
  }, [prefillAddress]);

  // Pre-select token from params — check default assets first, then custom tokens
  useEffect(() => {
    if (!tokenContract) return;
    const defaultToken = defaultTokens.find(
      (t) => t.contractAddress.toLowerCase() === tokenContract.toLowerCase()
    );
    if (defaultToken) { setSelectedAsset({ kind: "token", token: defaultToken }); return; }
    if (customTokens.length === 0) return;
    const token = customTokens.find(t => t.contractAddress === tokenContract);
    if (token) setSelectedAsset({ kind: "token", token });
  }, [tokenContract, customTokens]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY).then((raw) => {
      if (raw) setRecentAddresses(JSON.parse(raw));
    });
  }, []);

  const saveRecent = useCallback(async (address: string) => {
    const updated = [address, ...recentAddresses.filter((a) => a !== address)].slice(0, 5);
    setRecentAddresses(updated);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  }, [recentAddresses]);

  function slideToStep(nextStep: SendStep) {
    Animated.timing(slideAnim, { toValue: -30, duration: 150, useNativeDriver: true, easing: Easing.in(Easing.ease) })
      .start(() => {
        setStep(nextStep);
        slideAnim.setValue(30);
        Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true, easing: Easing.out(Easing.ease) }).start();
      });
  }

  useEffect(() => {
    if (step === "success") {
      Animated.parallel([
        Animated.spring(successScale, { toValue: 1, useNativeDriver: true, bounciness: 14, speed: 8 }),
        Animated.timing(successOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(checkRotate, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.out(Easing.back(1.5)) }),
      ]).start(() => {
        Animated.timing(hashOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      });
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  function validateInput(): string | null {
    const trimmed = recipient.trim();
    if (!trimmed) return "Enter a recipient address";
    if (isSolana) {
      if (!isValidSolanaAddress(trimmed)) return "Enter a valid Solana address";
      if (trimmed === solAddress) return "Cannot send to your own address";
      let amountRaw: bigint;
      try {
        amountRaw = parseSolanaAmount(
          amount,
          isToken ? selectedToken!.decimals : SOLANA_NATIVE_DECIMALS,
        );
      } catch (error) {
        return error instanceof Error ? error.message : "Enter a valid amount";
      }
      if (isToken) {
        if (solTokenBalanceRaw === undefined) return "Loading token balance…";
        if (amountRaw > solTokenBalanceRaw) return `Insufficient ${symbol} balance`;
        if (solBalanceRaw < SPL_TOKEN_FEE_LAMPORTS) {
          return `Need at least ${SPL_TOKEN_FEE_SOL} SOL for network and token-account fees`;
        }
      } else {
        if (solBalanceRaw === 0n) return "Your wallet has no SOL balance";
        if (amountRaw + TX_FEE_LAMPORTS > solBalanceRaw) {
          return "Insufficient SOL balance for amount + fee";
        }
      }
      return null;
    }
    const isValidGmi = trimmed.startsWith("gmi1") && trimmed.length >= 20;
    const isValidEth = /^0x[0-9a-fA-F]{40}$/.test(trimmed);
    if (!isValidGmi && !isValidEth) return "Enter a valid gmi1... or 0x... address";
    const toEth  = isValidGmi ? mxcAddressToEthAddress(trimmed).toLowerCase() : trimmed.toLowerCase();
    const myEth  = mxcAddress?.startsWith("gmi1") ? mxcAddressToEthAddress(mxcAddress).toLowerCase() : (mxcAddress ?? "").toLowerCase();
    if (toEth === myEth) return "Cannot send to your own address";
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return "Enter a valid amount";
    if (isToken) {
      if (tokenBalRaw === undefined) return "Loading token balance…";
      if (amt > tokenBalanceNum) return `Insufficient ${symbol} balance`;
      if (mcBalanceNum < TX_FEE_MC) return `Need at least ${TX_FEE_MC} ${GMI_NATIVE_SYMBOL} in your wallet for the gas fee`;
    } else {
      if (mcBalanceNum === 0) return "Your wallet has no balance on this network";
      if (amt + TX_FEE_MC > mcBalanceNum) return `Insufficient balance — need ${(amt + TX_FEE_MC).toFixed(4)} ${GMI_NATIVE_SYMBOL} (amount + fee)`;
    }
    return null;
  }

  function handleContinue() {
    setShowRecent(false);
    const err = validateInput();
    if (err) {
      setError(err);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setError("");
    slideToStep("confirm");
  }

  async function handleSend() {
    if (!mxcAddress || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    dismissPin();
    try {
      const privateKey = await getPrivateKey();
      if (!privateKey) throw new Error("Could not retrieve private key — please unlock your wallet and retry");

      let result: { txHash: string };

      if (isSolana) {
        if (!solAddress) throw new Error("Solana account is not available for this wallet");
        const signature = isToken && selectedToken
          ? await sendSolanaToken(
              privateKey,
              selectedToken.contractAddress,
              recipient.trim(),
              amount,
              selectedToken.decimals,
            )
          : await sendSol(privateKey, recipient.trim(), amount);
        result = { txHash: signature };
      } else if (isToken && selectedToken) {
        if (!account?.ethAddress) throw new Error("Account not loaded — wait a moment and retry");
        const freshAccount = await api.getAccount(mxcAddress!);
        const nonce = freshAccount.nonce;
        const amountRaw = parseUnits(amount, selectedToken.decimals);
        const data = buildErc20TransferDataHex(recipient.trim(), amountRaw);
        result = await api.sendTransaction({
          fromAddress: account.ethAddress,
          toAddress: selectedToken.contractAddress,
          amount: "0",
          data,
          txType: "contract_call",
          nonce,
          privateKey,
        });
      } else {
        const freshAccount = await api.getAccount(mxcAddress!);
        const nonce = freshAccount.nonce;
        const weiAmount = mcToWei(amount);
        result = await api.sendTransaction({
          fromAddress: mxcAddress,
          toAddress: recipient.trim(),
          amount: weiAmount,
          nonce,
          privateKey,
        });
      }
      setTxHash(result.txHash);
      await saveRecent(recipient);
      qc.invalidateQueries({ queryKey: ["account", mxcAddress] });
      if (isToken && selectedToken) {
        if (isSolana) {
          qc.invalidateQueries({ queryKey: ["solanaTokenBalance", selectedToken.contractAddress, solAddress] });
        } else {
          qc.invalidateQueries({ queryKey: ["tokenBalRaw", selectedToken.contractAddress, account?.ethAddress] });
          qc.invalidateQueries({ queryKey: ["tokenBalance", selectedToken.contractAddress] });
        }
      }
      if (isSolana) {
        qc.invalidateQueries({ queryKey: ["solanaBalance", solAddress] });
      }
      slideToStep("success");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      const e = err as Error;
      let msg = e.message || "Transaction failed";
      if (/account not found|not found on this chain/i.test(msg)) {
        msg = "Insufficient balance — your wallet has no funds on this network.";
      } else if (/insufficient funds|insufficient balance/i.test(msg)) {
        msg = "Insufficient balance to cover amount + network fee.";
      }
      setToast(msg);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  async function handlePasteAddress() {
    const text = await Clipboard.getStringAsync();
    const trimmed = text?.trim() ?? "";
    if (
      (isSolana && isValidSolanaAddress(trimmed)) ||
      (!isSolana && (trimmed.startsWith("gmi1") || /^0x[0-9a-fA-F]{40}$/.test(trimmed)))
    ) {
      setRecipient(trimmed);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      setToast("Clipboard doesn't contain a valid address");
    }
  }

  function setAmountPct(pct: number) {
    if (isSolana) {
      const balanceRaw = isToken ? (solTokenBalanceRaw ?? 0n) : solBalanceRaw;
      const feeRaw = isToken ? 0n : TX_FEE_LAMPORTS;
      const availableRaw = balanceRaw > feeRaw ? balanceRaw - feeRaw : 0n;
      const amountRaw = availableRaw * BigInt(Math.round(pct * 100)) / 100n;
      setAmount(formatSolanaAmount(
        amountRaw,
        isToken ? selectedToken!.decimals : SOLANA_NATIVE_DECIMALS,
      ));
      return;
    }
    const bal = isToken ? tokenBalanceNum : mcBalanceNum;
    const deduction = isToken ? 0 : TX_FEE_MC;
    const val = Math.max(0, bal * pct - deduction * pct);
    const dp = isToken ? Math.min(selectedToken!.decimals, 6) : 6;
    setAmount(val.toFixed(dp).replace(/\.?0+$/, ""));
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function fullReset() {
    submittingRef.current = false;
    slideAnim.stopAnimation(); slideAnim.setValue(0);
    successScale.setValue(0); successOpacity.setValue(0);
    checkRotate.setValue(0); hashOpacity.setValue(0);
    setStep("input"); setRecipient(""); setAmount(""); setMemo(""); setTxHash("");
    setError(""); setShowRecent(false); setShowScanner(false);
    setRecipientFocused(false); setAmountFocused(false);
    setLoading(false); setSelectedAsset({ kind: "native", chain: "gmi" }); setShowAssetPicker(false);
    requestAnimationFrame(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); });
  }

  useFocusEffect(
    useCallback(() => {
      return () => { fullReset(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const spin = checkRotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingBottom: 120 },
    header: {
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16),
      paddingHorizontal: 20, paddingBottom: 20,
      flexDirection: "row", alignItems: "center", gap: 12,
    },
    backBtn: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      alignItems: "center", justifyContent: "center",
    },
    headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground },
    assetSelector: {
      marginHorizontal: 20, marginBottom: 16,
      backgroundColor: colors.card, borderRadius: colors.radius,
      borderWidth: 1, borderColor: colors.border,
      flexDirection: "row", alignItems: "center",
      paddingHorizontal: 16, paddingVertical: 14, gap: 12,
    },
    assetSelectorIconWrap: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: colors.primary + "20", borderWidth: 1, borderColor: colors.primary + "40",
      alignItems: "center", justifyContent: "center",
    },
    assetSelectorIconText: { fontSize: 11, fontFamily: "Inter_700Bold", color: colors.primary },
    assetSelectorImg: { width: 40, height: 40, borderRadius: 20 },
    assetSelectorInfo: { flex: 1 },
    assetSelectorLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1, marginBottom: 2 },
    assetSelectorName: { fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground },
    assetSelectorBal: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 1 },
    balanceCard: {
      marginHorizontal: 20, marginBottom: 16,
      backgroundColor: colors.card, borderRadius: colors.radius,
      borderWidth: 1, borderColor: colors.border,
      padding: 16, flexDirection: "row",
      alignItems: "center", justifyContent: "space-between",
    },
    balanceLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 2 },
    balanceValue: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.foreground },
    refreshBtn: {
      width: 34, height: 34, borderRadius: 17,
      backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
      alignItems: "center", justifyContent: "center",
    },
    fieldBlock: { marginHorizontal: 20, marginBottom: 16 },
    fieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 8 },
    inputRow: {
      flexDirection: "row", alignItems: "center",
      backgroundColor: colors.input, borderRadius: colors.radius,
      borderWidth: 1, borderColor: colors.border,
    },
    inputRowFocused: { borderColor: colors.primary },
    textInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, fontFamily: "Inter_400Regular", color: colors.foreground },
    inputAction: { paddingHorizontal: 12, paddingVertical: 10, gap: 4, flexDirection: "row", alignItems: "center" },
    inputActionText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.primary },
    amountSuffix: { paddingRight: 14, fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    pctRow: { flexDirection: "row", gap: 8, marginTop: 8 },
    pctBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
    pctBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    recentDropdown: {
      marginHorizontal: 20, marginTop: -8, marginBottom: 12,
      backgroundColor: colors.card, borderRadius: colors.radius,
      borderWidth: 1, borderColor: colors.border, overflow: "hidden",
    },
    recentHeader: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    recentHeaderText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1 },
    recentItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    recentAddress: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground },
    errorText: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.destructive, marginHorizontal: 20, marginBottom: 8 },
    primaryBtn: { marginHorizontal: 20, borderRadius: colors.radius, overflow: "hidden", marginTop: 4 },
    primaryGrad: { paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
    primaryBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
    confirmCard: {
      marginHorizontal: 20, backgroundColor: colors.card,
      borderRadius: colors.radius + 4, borderWidth: 1, borderColor: colors.border,
      overflow: "hidden", marginBottom: 16,
    },
    confirmRow: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      paddingHorizontal: 18, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    confirmLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    confirmValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, flex: 1, textAlign: "right", marginLeft: 16 },
    networkBadge: {
      flexDirection: "row", alignItems: "center", gap: 5,
      backgroundColor: colors.primary + "15", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
    },
    networkBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.primary },
    warningNote: {
      marginHorizontal: 20, backgroundColor: "#F59E0B10", borderRadius: colors.radius,
      borderWidth: 1, borderColor: "#F59E0B30",
      padding: 12, flexDirection: "row", gap: 10, marginBottom: 16, alignItems: "flex-start",
    },
    warningText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 18 },
    ghostBtn: { marginHorizontal: 20, paddingVertical: 14, alignItems: "center", marginTop: 4 },
    ghostBtnText: { fontSize: 15, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    successContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
    successCircle: {
      width: 96, height: 96, borderRadius: 48,
      backgroundColor: "#10B98115", borderWidth: 2, borderColor: "#10B98150",
      alignItems: "center", justifyContent: "center", marginBottom: 24,
    },
    successTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 6, textAlign: "center" },
    successSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginBottom: 28 },
    txHashBox: {
      width: "100%", backgroundColor: colors.card, borderRadius: colors.radius,
      borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 28,
    },
    txHashLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 6 },
    txHashText: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.primary, lineHeight: 18 },
    successBtnRow: { flexDirection: "row", gap: 12, width: "100%" },
    successBtn: { flex: 1, borderRadius: colors.radius, overflow: "hidden" },
    successBtnGrad: { paddingVertical: 14, alignItems: "center" },
    successBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
    secondaryBtn: {
      flex: 1, borderRadius: colors.radius, borderWidth: 1,
      borderColor: colors.border, paddingVertical: 14, alignItems: "center", backgroundColor: colors.card,
    },
    secondaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
  });

  // ── Success step ──────────────────────────────────────────────────────────
  if (step === "success") {
    return (
      <View style={[s.container, s.successContainer]}>
        <Animated.View style={{ transform: [{ scale: successScale }], opacity: successOpacity, alignItems: "center" }}>
          <View style={s.successCircle}>
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <Icon name="checkmark" size={42} color={colors.success} />
            </Animated.View>
          </View>
          <Text style={s.successTitle}>Sent Successfully</Text>
          <Text style={s.successSub}>
            {amount} {symbol} → {shortenAddress(recipient, 8)}
          </Text>
        </Animated.View>
        <Animated.View style={{ opacity: hashOpacity, width: "100%" }}>
          <TouchableOpacity
            style={s.txHashBox}
            activeOpacity={0.7}
            onPress={async () => { await Clipboard.setStringAsync(txHash); setToast("TX hash copied"); }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <Text style={s.txHashLabel}>TRANSACTION HASH</Text>
              <Icon name="copy-outline" size={13} color={colors.mutedForeground} />
            </View>
            <Text style={s.txHashText} numberOfLines={3}>{txHash}</Text>
          </TouchableOpacity>
          <View style={s.successBtnRow}>
            <TouchableOpacity style={s.secondaryBtn} onPress={fullReset}>
              <Text style={s.secondaryBtnText}>Send Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.successBtn} onPress={() => { fullReset(); router.replace("/(tabs)"); }}>
              <View  style={s.successBtnGrad}>
                <Text style={s.successBtnText}>Done</Text>
              </View>
            </TouchableOpacity>
          </View>
        </Animated.View>
        <Toast message={toast} visible={!!toast} onHide={() => setToast("")} />
      </View>
    );
  }

  // ── Confirm step ──────────────────────────────────────────────────────────
  if (step === "confirm") {
    return (
      <View style={s.container}>
        <Animated.View style={{ flex: 1, transform: [{ translateX: slideAnim }] }}>
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            <View style={s.header}>
              <TouchableOpacity style={s.backBtn} onPress={() => slideToStep("input")}>
                <Icon name="arrow-back" size={18} color={colors.foreground} />
              </TouchableOpacity>
              <Text style={s.headerTitle}>Review Transaction</Text>
            </View>

            <View style={s.confirmCard}>
              <View  style={{ padding: 18 }}>
                <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.5)", letterSpacing: 1, marginBottom: 8 }}>
                  SENDING
                </Text>
                <Text style={{ fontSize: 36, fontFamily: "Inter_700Bold", color: "#FFFFFF" }}>
                  {amount}{" "}
                  <Text style={{ fontSize: 20, color: "rgba(255,255,255,0.6)" }}>{symbol}</Text>
                </Text>
                {isToken && (
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                    via {selectedToken!.name} contract
                  </Text>
                )}
              </View>
              <View style={s.confirmRow}>
                <Text style={s.confirmLabel}>To</Text>
                <Text style={[s.confirmValue, { fontSize: 12 }]} numberOfLines={1}>{recipient}</Text>
              </View>
              <View style={s.confirmRow}>
                <Text style={s.confirmLabel}>Network</Text>
                <View style={s.networkBadge}>
                  <Icon name="flash-outline" size={10} color={colors.primary} />
                  <Text style={s.networkBadgeText}>
                    {isSolana ? "Solana · Mainnet" : `GMI Chain · ${GMI_CHAIN_ID}`}
                  </Text>
                </View>
              </View>
              <View style={s.confirmRow}>
                <Text style={s.confirmLabel}>Gas fee</Text>
                <Text style={s.confirmValue}>
                  {isSolana
                    ? isToken ? `up to ~${SPL_TOKEN_FEE_SOL} SOL` : `~${TX_FEE_SOL} SOL`
                    : `~${TX_FEE_MC} ${GMI_NATIVE_SYMBOL}`}
                </Text>
              </View>
              {!isSolana && (
                <View style={[s.confirmRow, { borderBottomWidth: 0 }]}>
                  <Text style={s.confirmLabel}>Nonce</Text>
                  <Text style={s.confirmValue}>#{account?.nonce ?? 0}</Text>
                </View>
              )}
            </View>

            <View style={s.warningNote}>
              <Icon name="warning-outline" size={14} color="#F59E0B" style={{ marginTop: 1 }} />
              <Text style={s.warningText}>
                This transaction will be signed with your private key and is irreversible. Double-check the recipient address.
              </Text>
            </View>

            <TouchableOpacity
              style={[s.primaryBtn, loading && { opacity: 0.7 }]}
              onPress={() => { void requestPin({ title: "Confirm Transaction", subtitle: "Enter your PIN to sign and broadcast.", onSuccess: handleSend, onCancel: () => {} }); }}
              disabled={loading}
              activeOpacity={0.85}
            >
              <View  style={s.primaryGrad}>
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Icon name="lock-closed-outline" size={16} color="#FFFFFF" />
                    <Text style={s.primaryBtnText}>Sign & Broadcast</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={s.ghostBtn} onPress={() => slideToStep("input")}>
              <Text style={s.ghostBtnText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>
        <Toast message={toast} visible={!!toast} onHide={() => setToast("")} />
      </View>
    );
  }

  // ── Input step ────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: slideAnim }] }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.header}>
            <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
              <Icon name="close" size={18} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Send</Text>
          </View>

          {/* Asset selector */}
          <TouchableOpacity style={s.assetSelector} onPress={() => setShowAssetPicker(true)} activeOpacity={0.8}>
            {!isToken && isSolana ? (
              <Image source={SOL_LOGO} style={s.assetSelectorImg} />
            ) : isToken && selectedToken?.symbol.toUpperCase().includes("USDT") ? (
              <UsdtLogo />
            ) : isToken && selectedToken?.logoUrl ? (
              <Image source={{ uri: selectedToken.logoUrl }} style={s.assetSelectorImg} />
            ) : (
              <View style={s.assetSelectorIconWrap}>
                <Text style={s.assetSelectorIconText}>{symbol.slice(0, 3)}</Text>
              </View>
            )}
            <View style={s.assetSelectorInfo}>
              <Text style={s.assetSelectorLabel}>SENDING ASSET</Text>
              <Text style={s.assetSelectorName}>
                {isToken ? selectedToken!.name : isSolana ? "Solana" : "GMI Chain"} ({symbol})
              </Text>
              <Text style={s.assetSelectorBal}>
                Balance: {displayBalance} {symbol}
                {isToken
                  ? isSolana
                    ? `  ·  Gas: ${solBalance} SOL`
                    : `  ·  Gas: ${mcBalance} ${GMI_NATIVE_SYMBOL}`
                  : ""}
              </Text>
            </View>
            <Icon name="chevron-down" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>

          {/* Recipient */}
          <View style={s.fieldBlock}>
            <Text style={s.fieldLabel}>RECIPIENT ADDRESS</Text>
            <View style={[s.inputRow, recipientFocused && s.inputRowFocused]}>
              <TextInput
                style={s.textInput}
                placeholder={isSolana ? "Solana address" : "gmi1... or 0x..."}
                placeholderTextColor={colors.mutedForeground}
                value={recipient}
                onChangeText={(t) => { setRecipient(t); setError(""); }}
                onFocus={() => { setRecipientFocused(true); setShowRecent(recentAddresses.length > 0); }}
                onBlur={() => setRecipientFocused(false)}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={s.inputAction} onPress={() => { setShowRecent(false); setShowScanner(true); }}>
                <Icon name="scan" size={16} color={colors.primary} />
              </TouchableOpacity>
              <View style={{ width: 1, height: 20, backgroundColor: colors.border }} />
              <TouchableOpacity style={s.inputAction} onPress={handlePasteAddress}>
                <Icon name="clipboard-outline" size={14} color={colors.primary} />
                <Text style={s.inputActionText}>Paste</Text>
              </TouchableOpacity>
            </View>
          </View>

          {showRecent && recentAddresses.length > 0 && (
            <View style={s.recentDropdown}>
              <View style={s.recentHeader}>
                <Text style={s.recentHeaderText}>RECENT</Text>
              </View>
              {recentAddresses.map((addr) => (
                <TouchableOpacity
                  key={addr}
                  style={s.recentItem}
                  onPress={() => { setRecipient(addr); setShowRecent(false); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                >
                  <Icon name="time-outline" size={13} color={colors.mutedForeground} />
                  <Text style={s.recentAddress} numberOfLines={1}>{shortenAddress(addr, 10)}</Text>
                  <Icon name="chevron-forward" size={13} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Amount */}
          <View style={s.fieldBlock}>
            <Text style={s.fieldLabel}>AMOUNT</Text>
            <View style={[s.inputRow, amountFocused && s.inputRowFocused]}>
              <TextInput
                style={[s.textInput, { fontSize: 20, fontFamily: "Inter_600SemiBold" }]}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                value={amount}
                onChangeText={(t) => { setAmount(t); setError(""); }}
                onFocus={() => setAmountFocused(true)}
                onBlur={() => setAmountFocused(false)}
                keyboardType="decimal-pad"
              />
              <Text style={s.amountSuffix}>{symbol}</Text>
            </View>
            <View style={s.pctRow}>
              {[0.25, 0.5, 0.75, 1].map((pct) => (
                <TouchableOpacity key={pct} style={s.pctBtn} onPress={() => setAmountPct(pct)}>
                  <Text style={s.pctBtnText}>{pct === 1 ? "MAX" : `${pct * 100}%`}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Memo (native only) */}
          {!isToken && !isSolana && (
            <View style={s.fieldBlock}>
              <Text style={s.fieldLabel}>MEMO (OPTIONAL)</Text>
              <View style={s.inputRow}>
                <TextInput
                  style={s.textInput}
                  placeholder="Add a note..."
                  placeholderTextColor={colors.mutedForeground}
                  value={memo}
                  onChangeText={setMemo}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>
          )}

          {!!error && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity style={s.primaryBtn} onPress={handleContinue} activeOpacity={0.85}>
            <View  style={s.primaryGrad}>
              <Icon name="arrow-forward-outline" size={16} color="#FFFFFF" />
              <Text style={s.primaryBtnText}>Continue</Text>
            </View>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>

      <AssetPickerSheet
        visible={showAssetPicker}
        onClose={() => setShowAssetPicker(false)}
        tokens={customTokens}
        defaultTokens={defaultTokens}
        selected={selectedAsset}
        onSelect={(a) => { setSelectedAsset(a); setAmount(""); setError(""); }}
      />
      <Toast message={toast} visible={!!toast} onHide={() => setToast("")} />
      <QRScannerModal
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(address) => { setRecipient(address); setError(""); }}
        network={isSolana ? "solana" : "gmi"}
      />
    </View>
  );
}
