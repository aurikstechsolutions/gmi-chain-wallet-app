import { Icon } from "@/components/Icon";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/context/WalletContext";
import {
  api,
  type EpochHistoryItem,
  type EpochsSummary,
  type GasReward,
  type SubWallet,
  type TreasuryReward,
  type ValidatorBalance,
  type ValidatorBlock,
} from "@/services/api";
import { usePinContext } from "@/context/PinContext";
import { formatUptime, shortenAddress, weiToMc } from "@/services/crypto";
import {
  registerHeartbeatTask,
  unregisterHeartbeatTask,
} from "@/services/backgroundTasks";
import { PulsingDot } from "@/components/PulsingDot";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { Toast } from "@/components/Toast";
import { useColors } from "@/hooks/useColors";
import { GMI_CHAIN_ID, GMI_NATIVE_SYMBOL } from "@/services/chain";

type SubTab = "treasury" | "gas" | "blocks" | "epochs";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parsePeriodLabel(period: string): string {
  const [datePart, hourPart] = period.split("T");
  if (!datePart) return period;
  const d = new Date(`${datePart}T${(hourPart ?? "00").padStart(2, "0")}:00:00Z`);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} – ${(hourPart ?? "00").padStart(2, "0")}:00`;
}
function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function uptimeColor(pct: number): string {
  if (pct >= 80) return "#10B981";
  if (pct >= 50) return "#F59E0B";
  return "#EF4444";
}

function SkeletonRow({ colors }: { colors: ReturnType<typeof useColors> }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
    ])).start();
  }, [opacity]);
  return (
    <Animated.View style={{ opacity, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ height: 12, width: "60%", backgroundColor: colors.muted, borderRadius: 6, marginBottom: 8 }} />
      <View style={{ height: 10, width: "40%", backgroundColor: colors.muted, borderRadius: 6 }} />
    </Animated.View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function ValidatorScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const {
    validatorWallet,
    deviceId,
    moniker,
    validatorStatus: ctxValidatorStatus,
    setValidatorStatus,
    sessionExpired,
    setSessionExpired,
  } = useWallet();

  const { openEpoch } = useHeartbeat();
  const { requestPin, dismissPin } = usePinContext();
  const flatListRef = useRef<FlatList>(null);

  useFocusEffect(
    useCallback(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, [])
  );

  const mxcAddress = validatorWallet?.mxcAddress ?? null;
  const ethAddress = validatorWallet?.ethAddress ?? null;
  const publicKey = validatorWallet?.publicKey ?? null;

  // ── Registration form state ─────────────────────────────────────────────────
  const [regMoniker, setRegMoniker] = useState(moniker || "");
  const [commissionRate] = useState("10");
  const [regError, setRegError] = useState("");
  const [monikerFocused, setMonikerFocused] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const [toast, setToast] = useState("");

  // ── Claim state ──────────────────────────────────────────────────────────────
  const [showClaimForm, setShowClaimForm]       = useState(false);
  const [claimToAddress, setClaimToAddress]     = useState("");
  const [claimToFocused, setClaimToFocused]     = useState(false);
  const [claimLoading, setClaimLoading]         = useState(false);
  const [claimTxHash, setClaimTxHash]           = useState<string | null>(null);
  const [claimError, setClaimError]             = useState("");

  // ── Sub-wallet state ────────────────────────────────────────────────────────
  const [showAddSubWallet, setShowAddSubWallet] = useState(false);
  const [newSubWallet, setNewSubWallet] = useState("");
  const [newSubWalletLabel, setNewSubWalletLabel] = useState("");
  const [subWalletFocused, setSubWalletFocused] = useState(false);
  const [subWalletLabelFocused, setSubWalletLabelFocused] = useState(false);
  const [subWalletError, setSubWalletError] = useState("");

  // ── Sub-tab state ───────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<SubTab>("treasury");

  // ── Paginated lists ─────────────────────────────────────────────────────────
  const [treasuryItems, setTreasuryItems] = useState<TreasuryReward[]>([]);
  const [treasuryTotal, setTreasuryTotal] = useState(0);
  const [treasuryPage, setTreasuryPage] = useState(0);
  const [treasuryInitLoading, setTreasuryInitLoading] = useState(false);
  const [treasuryError, setTreasuryError] = useState<string | null>(null);

  const [gasItems, setGasItems] = useState<GasReward[]>([]);
  const [gasTotal, setGasTotal] = useState(0);
  const [gasPage, setGasPage] = useState(0);
  const [gasInitLoading, setGasInitLoading] = useState(false);
  const [gasError, setGasError] = useState<string | null>(null);

  const [blocksItems, setBlocksItems] = useState<ValidatorBlock[]>([]);
  const [blocksTotal, setBlocksTotal] = useState(0);
  const [blocksPage, setBlocksPage] = useState(0);
  const [blocksInitLoading, setBlocksInitLoading] = useState(false);
  const [blocksError, setBlocksError] = useState<string | null>(null);

  const [epochsItems, setEpochsItems] = useState<EpochHistoryItem[]>([]);
  const [epochsTotal, setEpochsTotal] = useState(0);
  const [epochsPage, setEpochsPage] = useState(0);
  const [epochsInitLoading, setEpochsInitLoading] = useState(false);
  const [epochsError, setEpochsError] = useState<string | null>(null);
  const [epochsSummary, setEpochsSummary] = useState<EpochsSummary | null>(null);

  // ── Live epoch countdown tick ────────────────────────────────────────────────
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!openEpoch) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [openEpoch]);

  // ── Animation refs ──────────────────────────────────────────────────────────
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;
  const ring2Scale = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0.3)).current;
  const cardFade = useRef(new Animated.Value(0)).current;
  const expiredShake = useRef(new Animated.Value(0)).current;

  // ── Validator data ──────────────────────────────────────────────────────────
  const { data: validatorData, isLoading: validatorLoading, refetch: refetchValidator } = useQuery({
    queryKey: ["validatorDetail", mxcAddress],
    queryFn: () => api.getValidatorStatus(mxcAddress!),
    enabled: !!mxcAddress,
    refetchInterval: 30_000,
  });

  const { data: earningsData, refetch: refetchEarnings } = useQuery({
    queryKey: ["validatorEarnings", mxcAddress],
    queryFn: () => api.getValidatorEarnings(mxcAddress!),
    enabled: !!mxcAddress,
    refetchInterval: 60_000,
  });

  const validator = validatorData?.validator;
  const isRegistered = !!validator;
  const isPaused = validator?.status === "paused" || ctxValidatorStatus === "paused";
  const isInactive = validator?.status === "inactive";
  const isBanned = validator?.status === "banned";
  const earnings = earningsData?.earnings;
  const stats = earningsData?.stats;

  // ── Validator balance query (frozen / available) ─────────────────────────────
  const { data: validatorBalance, refetch: refetchValidatorBalance } = useQuery({
    queryKey: ["validatorBalance", mxcAddress],
    queryFn: () => api.getValidatorBalance(mxcAddress!),
    enabled: !!mxcAddress && isRegistered,
    staleTime: 60_000,
    refetchInterval: 2 * 60 * 1000,
  });

  // ── Sub-wallets query + mutations ────────────────────────────────────────────
  const { data: subWalletsData, refetch: refetchSubWallets } = useQuery({
    queryKey: ["validatorSubWallets", mxcAddress],
    queryFn: () => api.getSubWallets(mxcAddress!),
    enabled: !!mxcAddress && isRegistered,
    staleTime: 60_000,
    refetchInterval: 2 * 60 * 1000, // re-check every 2 min so pending badges auto-update
    refetchOnWindowFocus: true,
  });
  const subWallets: SubWallet[] = subWalletsData?.subWallets ?? [];

  // Refetch sub-wallets whenever a new epoch arrives (i.e. after each heartbeat)
  const prevEpochNumRef = useRef<number | null>(null);
  useEffect(() => {
    const num = openEpoch?.epochNumber ?? null;
    if (num !== null && num !== prevEpochNumRef.current && isRegistered) {
      prevEpochNumRef.current = num;
      void refetchSubWallets();
    }
  }, [openEpoch, isRegistered, refetchSubWallets]);

  const addSubWalletMutation = useMutation({
    mutationFn: async ({ addr, label }: { addr: string; label: string }) => {
      const adminKey = (await AsyncStorage.getItem("mchain_admin_key")) ?? undefined;
      return api.addSubWallet(mxcAddress!, addr, label || undefined, adminKey);
    },
    onSuccess: () => {
      setNewSubWallet("");
      setNewSubWalletLabel("");
      setShowAddSubWallet(false);
      setSubWalletError("");
      void refetchSubWallets();
      setToast("Sub wallet added");
    },
    onError: (err) => {
      setSubWalletError(err instanceof Error ? err.message : "Failed to add sub wallet");
    },
  });

  const removeSubWalletMutation = useMutation({
    mutationFn: async (addr: string) => {
      const adminKey = (await AsyncStorage.getItem("mchain_admin_key")) ?? undefined;
      return api.removeSubWallet(mxcAddress!, addr, adminKey);
    },
    onSuccess: () => {
      void refetchSubWallets();
      setToast("Sub wallet removed");
    },
    onError: (err) => {
      setToast(err instanceof Error ? err.message : "Failed to remove sub wallet");
    },
  });

  // ── Pulse animation ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRegistered || isPaused || isInactive || isBanned) return;
    Animated.loop(Animated.sequence([
      Animated.timing(pulseScale, { toValue: 1.25, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulseScale, { toValue: 1, duration: 1200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulseOpacity, { toValue: 0, duration: 1200, useNativeDriver: true }),
      Animated.timing(pulseOpacity, { toValue: 0.6, duration: 1200, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(ring2Scale, { toValue: 1.5, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(ring2Scale, { toValue: 1, duration: 2000, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(ring2Opacity, { toValue: 0, duration: 2000, useNativeDriver: true }),
      Animated.timing(ring2Opacity, { toValue: 0.3, duration: 2000, useNativeDriver: true }),
    ])).start();
  }, [isRegistered, isPaused, isInactive, isBanned, pulseScale, pulseOpacity, ring2Scale, ring2Opacity]);

  useEffect(() => {
    if (isPaused) {
      Animated.sequence([
        Animated.timing(expiredShake, { toValue: 8, duration: 80, useNativeDriver: true }),
        Animated.timing(expiredShake, { toValue: -8, duration: 80, useNativeDriver: true }),
        Animated.timing(expiredShake, { toValue: 6, duration: 80, useNativeDriver: true }),
        Animated.timing(expiredShake, { toValue: -6, duration: 80, useNativeDriver: true }),
        Animated.timing(expiredShake, { toValue: 0, duration: 80, useNativeDriver: true }),
      ]).start();
    }
  }, [isPaused, expiredShake]);

  useEffect(() => {
    if (validator) Animated.timing(cardFade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, [!!validator, cardFade]);

  // ── Registration mutation ───────────────────────────────────────────────────
  const registerMutation = useMutation({
    mutationFn: () => {
      if (!mxcAddress || !ethAddress || !publicKey) throw new Error("Wallet not initialized");
      const rate = parseFloat(commissionRate);
      if (isNaN(rate) || rate < 0 || rate > 100) throw new Error("Commission rate must be between 0 and 100");
      if (!regMoniker.trim()) throw new Error("Moniker cannot be empty");
      return api.registerValidator({ address: mxcAddress, ethAddress, publicKey, deviceId, moniker: regMoniker.trim(), commissionRate: rate.toFixed(2) });
    },
    onSuccess: (data) => {
      setValidatorStatus(data.validator.status ?? "pending");
      qc.invalidateQueries({ queryKey: ["validatorDetail", mxcAddress] });
      registerHeartbeatTask();
    },
    onError: (err) => {
      setRegError(err instanceof Error ? err.message : "Registration failed");
    },
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  // ── Claim handler (requires PIN) ─────────────────────────────────────────────
  async function handleClaim() {
    if (!mxcAddress) return;
    setClaimLoading(true);
    dismissPin();
    try {
      const available = validatorBalance?.availableBalanceWei ?? "0";
      if (available === "0" || available === "") {
        setClaimError("No available balance to claim");
        return;
      }

      // 1. Claim main validator rewards
      const result = await api.claimRewards(mxcAddress);
      let totalClaimed = parseFloat(result.claimed ?? "0");

      // 2. Fetch sub-wallets and claim any with available balance
      try {
        const { subWallets: sws } = await api.getSubWallets(mxcAddress);
        const claimable = sws.filter(sw => parseFloat(sw.availableBalance) > 0);
        const subResults = await Promise.allSettled(
          claimable.map(sw => api.claimSubWalletRewards(mxcAddress, sw.subWalletAddress))
        );
        for (const r of subResults) {
          if (r.status === "fulfilled") {
            totalClaimed += parseFloat(r.value.claimed ?? "0");
          }
        }
      } catch {
        // sub-wallet claims are best-effort; don't block the main claim success
      }

      setClaimTxHash(result.txHash ?? null);
      setShowClaimForm(false);
      setClaimToAddress("");
      setClaimError("");
      void refetchValidatorBalance();
      void refetchSubWallets();
      qc.invalidateQueries({ queryKey: ["account", mxcAddress] });
      const autoReleased = parseFloat(result.autoReleased ?? "0");
      const toastMsg = autoReleased > 0
        ? `Claimed ${totalClaimed.toFixed(4)} ${GMI_NATIVE_SYMBOL} · ${autoReleased.toFixed(4)} ${GMI_NATIVE_SYMBOL} auto-released from frozen`
        : `Claimed ${totalClaimed.toFixed(4)} ${GMI_NATIVE_SYMBOL} — check your balance`;
      setToast(toastMsg);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setClaimLoading(false);
    }
  }

  async function handleRestartSession() {
    if (!mxcAddress) return;
    setRestartLoading(true);
    try {
      await api.restartSession(mxcAddress);
      setValidatorStatus("active");
      setSessionExpired(false);
      await registerHeartbeatTask();
      qc.invalidateQueries({ queryKey: ["validatorDetail", mxcAddress] });
      setToast("Node restarted — earning rewards again");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Failed to restart node");
    } finally {
      setRestartLoading(false);
    }
  }

  async function handlePauseValidator() {
    if (!mxcAddress) return;
    setRestartLoading(true);
    try {
      await unregisterHeartbeatTask();
      await api.pauseValidator(mxcAddress);
      setValidatorStatus("paused");
      qc.invalidateQueries({ queryKey: ["validatorDetail", mxcAddress] });
      setToast("Node paused");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Failed to pause node");
    } finally {
      setRestartLoading(false);
    }
  }

  async function copyText(text: string, label: string) {
    await Clipboard.setStringAsync(text);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setToast(`${label} copied`);
  }

  function statusColor(status: string | undefined) {
    if (isPaused) return "#F59E0B";
    if (isInactive || isBanned) return "#EF4444";
    switch (status) {
      case "active": return "#10B981";
      case "pending": return "#F59E0B";
      default: return colors.mutedForeground;
    }
  }
  function statusLabel(status: string | undefined) {
    if (isPaused) return "Paused";
    if (isInactive) return "Inactive";
    if (isBanned) return "Banned";
    if (!status) return "Unknown";
    return status.charAt(0).toUpperCase() + status.slice(1);
  }
  function centerIcon() {
    if (isPaused) return "pause-circle-outline";
    if (isInactive || isBanned) return "close-circle-outline";
    if (validator?.status === "active") return "pulse-outline";
    if (validator?.status === "pending") return "time-outline";
    return "shield-half-outline";
  }

  // ── Pagination loaders ──────────────────────────────────────────────────────
  const LIMIT = 50;

  const loadTreasury = useCallback(async (page: number) => {
    if (!mxcAddress) return;
    setTreasuryInitLoading(true);
    setTreasuryError(null);
    try {
      const res = await api.getTreasuryRewards(mxcAddress, LIMIT, page * LIMIT);
      setTreasuryItems(res.rewards);
      setTreasuryTotal(res.total);
      setTreasuryPage(page);
    } catch (err) {
      setTreasuryError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setTreasuryInitLoading(false);
    }
  }, [mxcAddress]);

  const loadGas = useCallback(async (page: number) => {
    if (!mxcAddress) return;
    setGasInitLoading(true);
    setGasError(null);
    try {
      const res = await api.getGasRewards(mxcAddress, LIMIT, page * LIMIT);
      setGasItems(res.gasRewards);
      setGasTotal(res.total);
      setGasPage(page);
    } catch (err) {
      setGasError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setGasInitLoading(false);
    }
  }, [mxcAddress]);

  const loadBlocks = useCallback(async (page: number) => {
    if (!mxcAddress) return;
    setBlocksInitLoading(true);
    setBlocksError(null);
    try {
      const res = await api.getValidatorBlocks(mxcAddress, LIMIT, page * LIMIT);
      setBlocksItems(res.blocks);
      setBlocksTotal(res.total);
      setBlocksPage(page);
    } catch (err) {
      setBlocksError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setBlocksInitLoading(false);
    }
  }, [mxcAddress]);

  const loadEpochs = useCallback(async (page: number) => {
    if (!mxcAddress) return;
    setEpochsInitLoading(true);
    setEpochsError(null);
    try {
      const res = await api.getValidatorEpochs(mxcAddress, LIMIT, page * LIMIT);
      setEpochsItems(res.epochs);
      setEpochsTotal(res.total);
      setEpochsPage(page);
      setEpochsSummary(res.summary);
    } catch (err) {
      setEpochsError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setEpochsInitLoading(false);
    }
  }, [mxcAddress]);

  // Initial load when validator is registered
  useEffect(() => {
    if (mxcAddress && isRegistered) loadTreasury(0);
  }, [mxcAddress, isRegistered, loadTreasury]);
  useEffect(() => {
    if (mxcAddress && isRegistered && activeTab === "gas" && gasItems.length === 0) loadGas(0);
  }, [activeTab, mxcAddress, isRegistered, gasItems.length, loadGas]);
  useEffect(() => {
    if (mxcAddress && isRegistered && activeTab === "blocks" && blocksItems.length === 0) loadBlocks(0);
  }, [activeTab, mxcAddress, isRegistered, blocksItems.length, loadBlocks]);
  useEffect(() => {
    if (mxcAddress && isRegistered && activeTab === "epochs" && epochsItems.length === 0) loadEpochs(0);
  }, [activeTab, mxcAddress, isRegistered, epochsItems.length, loadEpochs]);

  // ── Active tab helpers ──────────────────────────────────────────────────────
  function activeError() {
    if (activeTab === "treasury") return treasuryError;
    if (activeTab === "gas") return gasError;
    if (activeTab === "epochs") return epochsError;
    return blocksError;
  }
  function activeInitLoading() {
    if (activeTab === "treasury") return treasuryInitLoading;
    if (activeTab === "gas") return gasInitLoading;
    if (activeTab === "epochs") return epochsInitLoading;
    return blocksInitLoading;
  }
  function activeItems(): (TreasuryReward | GasReward | ValidatorBlock | EpochHistoryItem)[] {
    if (activeTab === "treasury") return treasuryItems;
    if (activeTab === "gas") return gasItems;
    if (activeTab === "epochs") return epochsItems;
    return blocksItems;
  }
  function activeTotalPages() {
    if (activeTab === "treasury") return Math.ceil(treasuryTotal / LIMIT);
    if (activeTab === "gas") return Math.ceil(gasTotal / LIMIT);
    if (activeTab === "epochs") return Math.ceil(epochsTotal / LIMIT);
    return Math.ceil(blocksTotal / LIMIT);
  }
  function activePage() {
    if (activeTab === "treasury") return treasuryPage;
    if (activeTab === "gas") return gasPage;
    if (activeTab === "epochs") return epochsPage;
    return blocksPage;
  }
  function handlePrevPage() {
    const p = activePage();
    if (p === 0) return;
    if (activeTab === "treasury") loadTreasury(p - 1);
    else if (activeTab === "gas") loadGas(p - 1);
    else if (activeTab === "epochs") loadEpochs(p - 1);
    else loadBlocks(p - 1);
  }
  function handleNextPage() {
    const p = activePage();
    if (p >= activeTotalPages() - 1) return;
    if (activeTab === "treasury") loadTreasury(p + 1);
    else if (activeTab === "gas") loadGas(p + 1);
    else if (activeTab === "epochs") loadEpochs(p + 1);
    else loadBlocks(p + 1);
  }
  function handleRetry() {
    if (activeTab === "treasury") loadTreasury(0);
    else if (activeTab === "gas") loadGas(0);
    else if (activeTab === "epochs") loadEpochs(0);
    else loadBlocks(0);
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 18),
      paddingHorizontal: 20,
      paddingBottom: 14,
    },
    headerTitle: { fontSize: 26, fontFamily: "Inter_700Bold", color: colors.foreground },
    headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 3 },

    // Register card
    registerCard: {
      marginHorizontal: 20, marginBottom: 20, borderRadius: 24,
      overflow: "hidden", borderWidth: 1, borderColor: colors.border,
    },
    registerCardGrad: { padding: 24 },
    registerTopRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 20 },
    registerIcon: {
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: colors.primary + "18",
      alignItems: "center", justifyContent: "center",
      borderWidth: 1.5, borderColor: colors.primary + "40",
    },
    registerBadge: {
      flexDirection: "row", alignItems: "center", gap: 5,
      backgroundColor: "#10B98115", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
      borderWidth: 1, borderColor: "#10B98130", alignSelf: "flex-start", marginTop: 4,
    },
    registerBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#10B981" },
    registerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 6, letterSpacing: -0.3 },
    registerDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 20, marginBottom: 20 },
    featureGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
    featureChip: {
      flexDirection: "row", alignItems: "center", gap: 8,
      backgroundColor: colors.primary + "0D", borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 10, flex: 1, minWidth: "44%",
      borderWidth: 1, borderColor: colors.primary + "20",
    },
    featureChipLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginBottom: 2 },
    featureChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    fieldLabel: { fontSize: 10, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 8 },
    input: {
      backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border,
      borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
      fontSize: 15, fontFamily: "Inter_400Regular", color: colors.foreground, marginBottom: 16,
    },
    inputFocused: { borderColor: colors.primary + "80" },
    commissionRow: {
      flexDirection: "row", alignItems: "center", backgroundColor: colors.background,
      borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, marginBottom: 20,
    },
    commissionInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, fontFamily: "Inter_400Regular", color: colors.foreground },
    commissionUnit: { paddingRight: 16, fontSize: 15, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    registerBtn: { borderRadius: 16, overflow: "hidden", shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 },
    registerBtnGrad: { paddingVertical: 17, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
    registerBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF", letterSpacing: 0.2 },
    errorText: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.destructive, marginBottom: 12 },

    // Hero card
    heroWrap: { marginHorizontal: 20, borderRadius: 22, overflow: "hidden", marginBottom: 14 },
    heroGrad: { paddingTop: 24, paddingHorizontal: 20, paddingBottom: 20 },
    heroTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 },
    heroNameWrap: { flex: 1, marginRight: 12 },
    heroLabel: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 2, marginBottom: 5 },
    heroMoniker: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground, lineHeight: 26 },
    heroAddress: { fontSize: 10, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 4 },
    statusBadge: {
      flexDirection: "row", alignItems: "center", gap: 7,
      paddingHorizontal: 13, paddingVertical: 7,
      borderRadius: 20, backgroundColor: colors.card,
      borderWidth: 1, borderColor: colors.border,
    },
    statusBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
    pulseCenter: { alignItems: "center", marginBottom: 24 },
    pulseRing: {
      position: "absolute", width: 88, height: 88,
      borderRadius: 44, borderWidth: 1.5,
    },
    pulseRing2: {
      position: "absolute", width: 88, height: 88,
      borderRadius: 44, borderWidth: 1,
    },
    pulseInner: {
      width: 88, height: 88, borderRadius: 44,
       backgroundColor: colors.secondary,
      alignItems: "center", justifyContent: "center",
      borderWidth: 1.5,
    },
    statsGrid: { flexDirection: "row", gap: 8 },
     statBox: { flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 12 },
     statLabel: { fontSize: 8, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2, marginBottom: 6 },
     statValue: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground },
     statSub: { fontSize: 9, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 },

    // Session banners
    expiredBanner: {
       marginTop: 16, backgroundColor: colors.warning + "14",
       borderRadius: 14, borderWidth: 1, borderColor: colors.warning + "55",
      padding: 14,
    },
     expiredTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: colors.warning, marginBottom: 4 },
     expiredDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 18, marginBottom: 12 },
    restartBtn: { borderRadius: 10, overflow: "hidden" },
    restartGrad: { paddingVertical: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
    restartBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
    pauseBtn: {
      marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 6, paddingVertical: 9,
       borderRadius: 10, borderWidth: 1, borderColor: colors.border,
       backgroundColor: colors.card,
    },
     pauseBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },

    // Earnings overview card
    earningsCard: {
      marginHorizontal: 20, borderRadius: 18, overflow: "hidden",
      marginBottom: 14, borderWidth: 1, borderColor: "#10B98122",
    },
    earningsGrad: { padding: 18 },
    earningsTitle: { fontSize: 9, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 2, marginBottom: 14 },
    earningsRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
    earningBox: { flex: 1, backgroundColor: colors.secondary, borderRadius: 12, padding: 12 },
    earningBoxLabel: { fontSize: 8, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2, marginBottom: 5 },
    earningBoxValue: { fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground },
    earningBoxUnit: { fontSize: 9, fontFamily: "Inter_500Medium", color: colors.mutedForeground, marginTop: 2 },
    earningBoxHighlight: { color: "#10B981" },
    pillRow: { flexDirection: "row", gap: 8 },
    pill: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: colors.secondary,
      borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5,
      borderWidth: 1, borderColor: colors.border,
    },
    pillText: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground },

    // Sub-tabs
    tabsWrap: {
      marginHorizontal: 20, marginBottom: 4,
      backgroundColor: colors.card, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border,
      flexDirection: "row", padding: 4,
    },
    tabBtn: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 10 },
    tabBtnActive: { backgroundColor: colors.primary + "20", borderWidth: 1, borderColor: colors.primary + "45" },
    tabBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    tabBtnTextActive: { color: colors.primary },

    // Epochs summary bar
    epochsSummaryBar: {
      flexDirection: "row", marginHorizontal: 20, marginBottom: 4,
      backgroundColor: colors.card, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border,
      padding: 14,
    },
    epochsStatBox: { flex: 1, alignItems: "center" },
    epochsStatValue: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.foreground },
    epochsStatLabel: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1, marginTop: 3 },

    // Epoch checkpoint card (current open epoch from heartbeat)
    epochCard: {
      marginHorizontal: 20, borderRadius: 16, overflow: "hidden",
      marginBottom: 14, borderWidth: 1, borderColor: "#0EA5E922",
    },
    epochGrad: { padding: 16 },
    epochHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    epochTitle: { fontSize: 9, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.8 },
    epochBadge: {
      paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20,
       backgroundColor: colors.primary + "18", borderWidth: 1, borderColor: colors.primary + "45",
    },
    epochBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.primary },
    epochRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 },
    epochNumber: { fontSize: 26, fontFamily: "Inter_700Bold", color: colors.foreground, lineHeight: 30 },
    epochSub: { fontSize: 10, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 },
    epochWindow: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.primary, textAlign: "right" },

    // Table header (blocks)
    tableHeader: {
      flexDirection: "row", paddingHorizontal: 20, paddingVertical: 9,
      backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    thBlock: { width: 84, fontSize: 9, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1 },
    thTxs: { width: 36, fontSize: 9, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1 },
    thGas: { flex: 1, fontSize: 9, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1 },
    thTime: { width: 94, fontSize: 9, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1, textAlign: "right" },

    // Error banner
    errorBanner: {
      marginHorizontal: 20, marginVertical: 10,
       backgroundColor: colors.destructive + "12", borderRadius: 12,
       borderWidth: 1, borderColor: colors.destructive + "45",
      padding: 14, flexDirection: "row", alignItems: "center", gap: 10,
    },
    errorBannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.destructive },
    retryBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.destructive + "18" },
    retryText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.destructive },

    // Row items — treasury
    treasuryRow: { paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
    treasuryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 7 },
    treasuryPeriod: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground, flex: 1 },
    treasuryAmount: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#10B981" },
    uptimeBarBg: { height: 5, backgroundColor: colors.muted, borderRadius: 3, marginBottom: 6, overflow: "hidden" },
    uptimeBarFill: { height: "100%", borderRadius: 3 },
    treasuryBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    uptimePctText: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    statusChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    statusChipText: { fontSize: 9, fontFamily: "Inter_700Bold" },

    // Row items — gas
    gasRow: { paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
    gasTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
    gasBlock: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    gasShare: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#10B981" },
    gasMid: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    gasFee: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    splitChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    splitChipText: { fontSize: 9, fontFamily: "Inter_700Bold" },
    gasTime: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 3 },

    // Row items — blocks
    blockRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
    blockRowHighlight: { borderLeftWidth: 3, borderLeftColor: "#10B98155", paddingLeft: 17 },
    blockHeight: { width: 84, fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    blockTxs: { width: 36, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground },
    blockGas: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    blockTime: { width: 94, fontSize: 10, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "right" },

    // Row items — epoch history
    epochHistoryRow: {
      paddingHorizontal: 20, paddingVertical: 13,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    epochHistoryTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
    epochHistoryNum: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground },
    epochHistoryStatusBadge: {
      paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
      borderWidth: 1,
    },
    epochHistoryStatusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
    epochHistoryParticipation: {
      paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
      borderWidth: 1,
    },
    epochHistoryParticipationText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
    epochHistoryMid: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
    epochHistoryBlocks: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    epochHistoryQuorum: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    epochHistoryBottom: { flexDirection: "row", justifyContent: "space-between" },
    epochHistoryStats: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground + "AA" },
    epochHistoryTime: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground + "AA" },

    // Pagination
    paginationRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      marginHorizontal: 20, marginVertical: 16,
    },
    pageBtn: {
      paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10,
      borderWidth: 1, borderColor: colors.border,
    },
    pageBtnDisabled: { opacity: 0.3 },
    pageBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.primary },
    pageInfo: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground },

    emptyState: { paddingVertical: 48, alignItems: "center", gap: 10 },
    emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    emptySubText: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground + "99", textAlign: "center", paddingHorizontal: 32 },

    // ── Sub-wallets card ──────────────────────────────────────────────────────
    subWalletsCard: {
      marginHorizontal: 16, marginBottom: 14,
      borderRadius: 16, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.card, overflow: "hidden",
      padding: 16,
    },
    subWalletsHeader: {
      flexDirection: "row", alignItems: "flex-start",
      justifyContent: "space-between", marginBottom: 12,
    },
    subWalletsTitle: {
      fontSize: 12, fontFamily: "Inter_700Bold",
      color: colors.foreground, letterSpacing: 1.2, marginBottom: 2,
    },
    subWalletsSub: {
      fontSize: 11, fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    subWalletsEmpty: {
      fontSize: 12, fontFamily: "Inter_400Regular",
      color: colors.mutedForeground, textAlign: "center",
      paddingVertical: 10, paddingHorizontal: 8,
    },
    subWalletRow: {
      flexDirection: "row", alignItems: "center", gap: 8,
      paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border,
    },
    subWalletAddr: {
      flex: 1, fontSize: 13, fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    subWalletBadge: {
      flexDirection: "row", alignItems: "center", gap: 3,
      paddingHorizontal: 7, paddingVertical: 3,
      borderRadius: 20, borderWidth: 1,
      borderColor: "#10B98140", backgroundColor: "#10B98115",
    },
    subWalletBadgeText: {
      fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#10B981",
    },
    subWalletAddWrap: { marginTop: 12, gap: 8 },
    subWalletInput: {
      backgroundColor: colors.background, borderRadius: 10,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 14, paddingVertical: 11,
      fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground,
    },
    subWalletInputFocused: { borderColor: colors.primary },
    subWalletError: {
      fontSize: 12, fontFamily: "Inter_400Regular", color: "#EF4444",
    },
    // ── Balance card ──────────────────────────────────────────────────────────
    balanceCard: {
      marginHorizontal: 16, marginBottom: 12, borderRadius: 16,
      overflow: "hidden", borderWidth: 1, borderColor: colors.border,
    },
    balanceGrad: { padding: 16, gap: 12 },
    balanceHeader: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    },
    balanceTitle: {
      fontSize: 11, fontFamily: "Inter_700Bold",
      color: colors.mutedForeground, letterSpacing: 1.2,
    },
    claimToggleBtn: {
      flexDirection: "row", alignItems: "center", gap: 4,
      backgroundColor: colors.success + "18", borderRadius: 10,
      paddingHorizontal: 10, paddingVertical: 4,
      borderWidth: 1, borderColor: colors.success + "45",
    },
    claimToggleText: {
      fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.success,
    },
    balanceRow: { flexDirection: "row", gap: 10 },
    balanceBox: {
      flex: 1, backgroundColor: colors.secondary,
      borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: colors.border,
    },
    balanceBoxHighlighted: {
      borderColor: colors.success + "55",
      backgroundColor: colors.success + "12",
    },
    balanceBoxLabel: {
      fontSize: 9, fontFamily: "Inter_700Bold",
      color: colors.mutedForeground, letterSpacing: 1.2,
    },
    balanceBoxValue: {
      fontSize: 22, fontFamily: "Inter_700Bold",
      color: colors.foreground, lineHeight: 26,
    },
    balanceBoxUnit: {
      fontSize: 10, fontFamily: "Inter_400Regular",
      color: colors.mutedForeground, marginTop: 1,
    },
    balanceHint: {
      fontSize: 11, fontFamily: "Inter_400Regular",
      color: colors.mutedForeground, lineHeight: 15,
    },
    // ── Claim form ────────────────────────────────────────────────────────────
    claimForm: {
      borderTopWidth: 1, borderTopColor: colors.border,
      paddingTop: 14, gap: 10,
    },
    claimFormTitle: {
      fontSize: 13, fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    claimFormAmount: {
      fontSize: 20, fontFamily: "Inter_700Bold", color: "#10B981",
    },
    claimInput: {
      backgroundColor: colors.input,
      borderRadius: 10, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 14, paddingVertical: 11,
      fontSize: 13, fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    claimInputFocused: { borderColor: "#10B981" },
    claimError: {
      fontSize: 12, fontFamily: "Inter_400Regular", color: "#EF4444",
    },
    claimSuccessWrap: {
      flexDirection: "row", alignItems: "center", gap: 6,
    },
    claimSuccess: {
      flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#10B981",
    },
    claimBtn: { borderRadius: 10, overflow: "hidden" },
    claimBtnGrad: {
      paddingVertical: 13, flexDirection: "row",
      alignItems: "center", justifyContent: "center", gap: 8,
    },
    claimBtnText: {
      fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF",
    },

    subWalletPendingHint: {
      fontSize: 10, fontFamily: "Inter_400Regular",
      color: "#F59E0B", marginTop: 1,
    },
    subWalletHintWrap: {
      flexDirection: "row", alignItems: "flex-start", gap: 5,
    },
    subWalletHintText: {
      flex: 1, fontSize: 11, fontFamily: "Inter_400Regular",
      color: colors.mutedForeground, lineHeight: 15,
    },
    subWalletAddBtn: { borderRadius: 10, overflow: "hidden" },
    subWalletAddBtnGrad: {
      paddingVertical: 12, alignItems: "center", justifyContent: "center",
    },
    subWalletAddBtnText: {
      fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF",
    },
  });

  // ── Row renderers ────────────────────────────────────────────────────────────
  function TreasuryRowItem({ item }: { item: TreasuryReward }) {
    const pct = parseFloat(item.uptimePct);
    const barColor = uptimeColor(pct);
    const isDistributed = item.status === "distributed";
    return (
      <View style={s.treasuryRow}>
        <View style={s.treasuryTop}>
          <Text style={s.treasuryPeriod} numberOfLines={1}>{parsePeriodLabel(item.period)}</Text>
          <Text style={s.treasuryAmount}>+{parseFloat(item.amountMc).toFixed(4)} {GMI_NATIVE_SYMBOL}</Text>
        </View>
        <View style={s.uptimeBarBg}>
          <View style={[s.uptimeBarFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }]} />
        </View>
        <View style={s.treasuryBottom}>
          <Text style={s.uptimePctText}>{item.uptimePct}% uptime · {item.activeMinutes}/{item.totalNetworkMinutes} min</Text>
          <View style={[s.statusChip, { backgroundColor: isDistributed ? "#10B98118" : "#F59E0B18" }]}>
            <Text style={[s.statusChipText, { color: isDistributed ? "#10B981" : "#F59E0B" }]}>
              {isDistributed ? "distributed" : "pending"}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  function GasRowItem({ item }: { item: GasReward }) {
    const chipColor = item.isStaked ? "#10B981" : "#F59E0B";
    const chipBg = item.isStaked ? "#10B98118" : "#F59E0B18";
    return (
      <TouchableOpacity style={s.gasRow} onPress={() => copyText(String(item.blockHeight), `Block #${item.blockHeight}`)} activeOpacity={0.7}>
        <View style={s.gasTop}>
          <Text style={s.gasBlock}>Block #{item.blockHeight.toLocaleString()} · {item.txCount} tx{item.txCount !== 1 ? "s" : ""}</Text>
          <Text style={s.gasShare}>+{parseFloat(item.validatorShareMc).toFixed(6)} {GMI_NATIVE_SYMBOL}</Text>
        </View>
        <View style={s.gasMid}>
          <Text style={s.gasFee}>Total fee: {parseFloat(item.totalFeeMc).toFixed(6)} {GMI_NATIVE_SYMBOL}</Text>
          <View style={[s.splitChip, { backgroundColor: chipBg }]}>
            <Text style={[s.splitChipText, { color: chipColor }]}>{item.splitPct}</Text>
          </View>
        </View>
        <Text style={s.gasTime}>{formatTimestamp(item.timestamp)}</Text>
      </TouchableOpacity>
    );
  }

  function BlockRowItem({ item }: { item: ValidatorBlock }) {
    const hasActivity = item.txCount > 0;
    const d = new Date(item.timestamp);
    const timeLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return (
      <TouchableOpacity style={[s.blockRow, hasActivity && s.blockRowHighlight]} onPress={() => copyText(item.hash, "Block hash")} activeOpacity={0.7}>
        <Text style={s.blockHeight}>#{item.height.toLocaleString()}</Text>
        <Text style={[s.blockTxs, hasActivity && { color: "#10B981" }]}>{item.txCount}</Text>
        <Text style={s.blockGas}>{item.gasUsed.toLocaleString()}</Text>
        <Text style={s.blockTime}>{timeLabel}</Text>
      </TouchableOpacity>
    );
  }

  function EpochRowItem({ item }: { item: EpochHistoryItem }) {
    const statusC =
      item.status === "finalized" ? "#10B981" :
      item.status === "open" ? "#0EA5E9" : "#6B7280";
    const statusLbl =
      item.status === "finalized" ? "✓ Finalized" :
      item.status === "open" ? "⟳ Open" : "✗ Expired";

    const secsLeft = item.status === "open"
      ? Math.max(0, Math.floor((new Date(item.signingWindowClosesAt).getTime() - Date.now()) / 1000))
      : 0;
    const timeLabel = item.status === "open"
      ? `${Math.floor(secsLeft / 60)}m ${(secsLeft % 60).toString().padStart(2, "0")}s`
      : item.finalizedAt
      ? formatTimestamp(item.finalizedAt)
      : formatTimestamp(item.createdAt);

    return (
      <View style={s.epochHistoryRow}>
        <View style={s.epochHistoryTop}>
          <Text style={s.epochHistoryNum}>Epoch #{item.epochNumber}</Text>
          <View style={{ flexDirection: "row", gap: 5 }}>
            <View style={[s.epochHistoryStatusBadge, { backgroundColor: statusC + "15", borderColor: statusC + "40" }]}>
              <Text style={[s.epochHistoryStatusText, { color: statusC }]}>{statusLbl}</Text>
            </View>
            <View style={[s.epochHistoryParticipation, {
              backgroundColor: item.myParticipation.didSign ? "#10B98115" : "#6B728015",
              borderColor: item.myParticipation.didSign ? "#10B98140" : "#6B728035",
            }]}>
              <Text style={[s.epochHistoryParticipationText, {
                color: item.myParticipation.didSign ? "#10B981" : "#6B7280",
              }]}>
                {item.myParticipation.didSign ? "✓ Signed" : "— Missed"}
              </Text>
            </View>
          </View>
        </View>
        <View style={s.epochHistoryMid}>
          <Text style={s.epochHistoryBlocks}>
            Blocks {item.blockRange.from.toLocaleString()}–{item.blockRange.to.toLocaleString()}
          </Text>
          <Text style={s.epochHistoryQuorum}>
            {item.quorum.signatureCount}/{item.quorum.eligibleCount} sigs · {item.quorum.pct}%
          </Text>
        </View>
        <View style={s.epochHistoryBottom}>
          <Text style={s.epochHistoryStats}>
            {item.blockStats.txCount} txs · {item.blockStats.blockCount} blocks
          </Text>
          <Text style={s.epochHistoryTime}>{timeLabel}</Text>
        </View>
      </View>
    );
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (validatorLoading) {
    return (
      <View style={[s.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const activeColor = statusColor(validator?.status);

  // ── Hero card (registered) ───────────────────────────────────────────────────
  const HeroCard = validator ? (
    <Animated.View style={[s.heroWrap, { opacity: cardFade }, isPaused && { transform: [{ translateX: expiredShake }] }]}>
      <View


        style={s.heroGrad}
      >
        <View style={s.heroTopRow}>
          <View style={s.heroNameWrap}>
            <Text style={s.heroLabel}>NETWORK NODE</Text>
            <Text style={s.heroMoniker}>{validator.moniker}</Text>
            <TouchableOpacity onPress={() => copyText(mxcAddress ?? "", "Address")} activeOpacity={0.7}>
              <Text style={s.heroAddress} numberOfLines={1}>{mxcAddress?.substring(0, 22)}…</Text>
            </TouchableOpacity>
          </View>
          <View style={[s.statusBadge, (isPaused || isInactive || isBanned) && { borderColor: activeColor + "50" }]}>
            <PulsingDot status={isPaused ? "pending" : validator.status} size={7} />
            <Text style={[s.statusBadgeText, { color: activeColor }]}>{statusLabel(validator.status)}</Text>
          </View>
        </View>

        <View style={s.pulseCenter}>
          <Animated.View style={[s.pulseRing2, { borderColor: activeColor, transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />
          <Animated.View style={[s.pulseRing, { borderColor: activeColor, transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
          <View style={[s.pulseInner, { borderColor: activeColor + "50" }]}>
            <Icon name={centerIcon()} size={34} color={activeColor} />
          </View>
        </View>

        <View style={s.statsGrid}>
          <View style={s.statBox}>
            <Text style={s.statLabel}>UPTIME</Text>
            <Text style={s.statValue}>{formatUptime(validator.totalActiveMinutes)}</Text>
            <Text style={s.statSub}>total active</Text>
          </View>
          <View style={s.statBox}>
            <Text style={s.statLabel}>BLOCKS</Text>
            <Text style={s.statValue}>{stats?.totalBlocksProposed !== undefined ? stats.totalBlocksProposed.toLocaleString() : "—"}</Text>
            <Text style={s.statSub}>validated</Text>
          </View>
          <View style={s.statBox}>
            <Text style={s.statLabel}>EARNED</Text>
            <Text style={[s.statValue, { color: "#10B981", fontSize: 13 }]}>
              {earnings?.combinedTotalMc !== undefined ? parseFloat(earnings.combinedTotalMc).toFixed(3) : "—"}
            </Text>
            <Text style={s.statSub}>{GMI_NATIVE_SYMBOL} total</Text>
          </View>
          <View style={s.statBox}>
            <Text style={s.statLabel}>STATUS</Text>
            <Text style={[s.statValue, { color: activeColor, fontSize: 12 }]}>{statusLabel(validator.status)}</Text>
          </View>
        </View>

        {validator.status === "active" && !isPaused && (
          <TouchableOpacity style={s.pauseBtn} onPress={handlePauseValidator} disabled={restartLoading} activeOpacity={0.75}>
            {restartLoading ? (
              <ActivityIndicator color={colors.mutedForeground} size="small" />
            ) : (
              <>
                <Icon name="pause-circle-outline" size={14} color={colors.mutedForeground} />
                <Text style={s.pauseBtnText}>Pause Node</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {isPaused && (
          <View style={s.expiredBanner}>
            <Text style={s.expiredTitle}>Node Paused</Text>
            <Text style={s.expiredDesc}>
              No heartbeat received. Restart to resume earning rewards.
            </Text>
            <TouchableOpacity style={s.restartBtn} onPress={handleRestartSession} disabled={restartLoading} activeOpacity={0.85}>
              <View style={[s.restartGrad, { backgroundColor: colors.warning }]}>
                {restartLoading ? <ActivityIndicator color="#FFFFFF" size="small" /> : (
                  <>
                    <Icon name="refresh-outline" size={14} color="#FFFFFF" />
                    <Text style={s.restartBtnText}>Restart Node</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          </View>
        )}

        {(isInactive || isBanned) && (
          <View style={[s.expiredBanner, { borderColor: "rgba(239,68,68,0.35)", backgroundColor: "rgba(239,68,68,0.08)" }]}>
            <Text style={[s.expiredTitle, { color: "#EF4444" }]}>
              {isBanned ? "Node Restricted" : "Node Inactive"}
            </Text>
            <Text style={s.expiredDesc}>
              {isBanned
                ? "This node is restricted. Please contact support."
                : "This node is inactive. Please contact support to reactivate."}
            </Text>
          </View>
        )}
      </View>
    </Animated.View>
  ) : null;

  // ── Epoch checkpoint card (current open epoch from heartbeat) ────────────────
  const EpochCard = openEpoch ? (() => {
    // Support both new (endsAt) and legacy (signingWindowClosesAt) field names
    const closeTs = (openEpoch as any).signingWindowClosesAt ?? openEpoch.endsAt;
    const windowClose = new Date(closeTs);
    const now = new Date();
    const secsLeft = Math.max(0, Math.floor((windowClose.getTime() - now.getTime()) / 1000));
    const minsLeft = Math.floor(secsLeft / 60);
    const secsRem = secsLeft % 60;
    const windowOpen = secsLeft > 0;

    return (
      <View style={s.epochCard}>
        <View style={s.epochGrad}>
          <View style={s.epochHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Icon name="checkmark-circle-outline" size={13} color={colors.primary} />
              <Text style={s.epochTitle}>EPOCH CHECKPOINT</Text>
            </View>
            <View style={[s.epochBadge, !windowOpen && { backgroundColor: colors.warning + "18", borderColor: colors.warning + "45" }]}>
              <Text style={[s.epochBadgeText, !windowOpen && { color: colors.warning }]}>
                {windowOpen ? "Open" : "Window Closed"}
              </Text>
            </View>
          </View>

          <View style={s.epochRow}>
            <View>
              <Text style={s.epochNumber}>#{openEpoch.epochNumber}</Text>
              <Text style={s.epochSub}>
                {openEpoch.signerCount !== undefined
                  ? `${openEpoch.signerCount} signer${openEpoch.signerCount !== 1 ? "s" : ""}`
                  : (openEpoch as any).blockHeight !== undefined
                  ? `Block ${(openEpoch as any).blockHeight.toLocaleString()}`
                  : ""}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[s.epochWindow, !windowOpen && { color: "#F59E0B" }]}>
                {windowOpen
                  ? `${minsLeft}m ${secsRem.toString().padStart(2, "0")}s left`
                  : "Window closed"}
              </Text>
              <Text style={s.epochSub}>signing window</Text>
            </View>
          </View>
          <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>
            Submitting your participation for this checkpoint…
          </Text>
        </View>
      </View>
    );
  })() : null;

  // ── Earnings overview card ──────────────────────────────────────────────────
  const EarningsCard = earnings ? (
    <View style={s.earningsCard}>
      <View style={s.earningsGrad}>
        <Text style={s.earningsTitle}>EARNINGS OVERVIEW</Text>
        <View style={s.earningsRow}>
          <View style={s.earningBox}>
            <Text style={s.earningBoxLabel}>TREASURY</Text>
            <Text style={s.earningBoxValue}>{parseFloat(earnings.treasuryTotalMc).toFixed(4)}</Text>
            <Text style={s.earningBoxUnit}>{stats?.totalRewardPeriods ?? 0} periods</Text>
          </View>
          <View style={s.earningBox}>
            <Text style={s.earningBoxLabel}>GAS FEES</Text>
            <Text style={s.earningBoxValue}>{parseFloat(earnings.gasTotalMc).toFixed(4)}</Text>
            <Text style={s.earningBoxUnit}>{stats?.totalTxsProcessed ?? 0} txs</Text>
          </View>
          <View style={s.earningBox}>
            <Text style={s.earningBoxLabel}>COMBINED</Text>
            <Text style={[s.earningBoxValue, s.earningBoxHighlight]}>{parseFloat(earnings.combinedTotalMc).toFixed(4)}</Text>
            <Text style={s.earningBoxUnit}>all time · {GMI_NATIVE_SYMBOL}</Text>
          </View>
        </View>
        <View style={s.pillRow}>
          <View style={s.pill}>
            <Icon name="cube-outline" size={11} color={colors.mutedForeground} />
            <Text style={s.pillText}>Blocks: {stats?.totalBlocksProposed?.toLocaleString() ?? 0}</Text>
          </View>
          <View style={s.pill}>
            <Icon name="repeat-outline" size={11} color={colors.mutedForeground} />
            <Text style={s.pillText}>Txs: {stats?.totalTxsProcessed?.toLocaleString() ?? 0}</Text>
          </View>
        </View>
      </View>
    </View>
  ) : null;

  // ── Rewards balance card (frozen / available / claim) ────────────────────────
  const hasBalance = validatorBalance &&
    (parseFloat(validatorBalance.frozenBalanceWei) > 0 ||
     parseFloat(validatorBalance.availableBalanceWei) > 0);

  const canClaim = validatorBalance &&
    parseFloat(validatorBalance.availableBalanceWei) > 0;

  const BalanceCard = (hasBalance || showClaimForm) ? (
    <View style={s.balanceCard}>
      <View style={s.balanceGrad}>
        <View style={s.balanceHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Icon name="lock-closed-outline" size={13} color="#0EA5E9" />
            <Text style={s.balanceTitle}>REWARDS BALANCE</Text>
          </View>
          {canClaim && (
            <TouchableOpacity
              onPress={() => { setShowClaimForm(v => !v); setClaimError(""); setClaimTxHash(null); }}
              activeOpacity={0.7}
            >
              <View style={s.claimToggleBtn}>
                <Icon name={showClaimForm ? "close-outline" : "arrow-down-circle-outline"} size={13} color="#10B981" />
                <Text style={s.claimToggleText}>{showClaimForm ? "Cancel" : "Claim"}</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>

        <View style={s.balanceRow}>
          <View style={s.balanceBox}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 }}>
            <Icon name="lock-closed-outline" size={10} color={colors.mutedForeground} />
              <Text style={s.balanceBoxLabel}>FROZEN</Text>
            </View>
            <Text style={s.balanceBoxValue}>{parseFloat(validatorBalance?.frozenBalanceMc ?? "0").toFixed(4)}</Text>
            <Text style={s.balanceBoxUnit}>{GMI_NATIVE_SYMBOL} locked</Text>
          </View>
          <View style={[s.balanceBox, s.balanceBoxHighlighted]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 }}>
              <Icon name="checkmark-circle-outline" size={10} color="#10B981" />
              <Text style={[s.balanceBoxLabel, { color: "#10B981" }]}>AVAILABLE</Text>
            </View>
            <Text style={[s.balanceBoxValue, { color: "#10B981" }]}>{parseFloat(validatorBalance?.availableBalanceMc ?? "0").toFixed(4)}</Text>
            <Text style={s.balanceBoxUnit}>{GMI_NATIVE_SYMBOL} ready</Text>
          </View>
        </View>

        <Text style={s.balanceHint}>
          Frozen balance unlocks based on your referral count. Contact admin to release.
        </Text>

        {showClaimForm && (
          <View style={s.claimForm}>
            <Text style={s.claimFormTitle}>Claim Available Rewards</Text>
            <Text style={s.claimFormAmount}>
              {parseFloat(validatorBalance?.availableBalanceMc ?? "0").toFixed(6)} {GMI_NATIVE_SYMBOL}
            </Text>
            <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginBottom: 4 }}>
              Rewards will be sent to your wallet address.
            </Text>
            {claimError ? <Text style={s.claimError}>{claimError}</Text> : null}
            {claimTxHash ? (
              <View style={s.claimSuccessWrap}>
                <Icon name="checkmark-circle" size={14} color="#10B981" />
                <Text style={s.claimSuccess} numberOfLines={1}>
                  TX: {claimTxHash.substring(0, 20)}…
                </Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={[s.claimBtn, (!canClaim || claimLoading) && { opacity: 0.55 }]}
              disabled={!canClaim || claimLoading}
              activeOpacity={0.85}
              onPress={() => void requestPin({
                title: "Confirm Claim",
                subtitle: `Claim ${parseFloat(validatorBalance?.availableBalanceMc ?? "0").toFixed(4)} ${GMI_NATIVE_SYMBOL} rewards to your wallet. Enter your PIN to confirm.`,
                onSuccess: handleClaim,
                onCancel: () => {},
              })}
            >
              <View style={[s.claimBtnGrad, { backgroundColor: colors.success }]}>
                {claimLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : (
                    <>
                      <Icon name="gift-outline" size={14} color="#fff" />
                      <Text style={s.claimBtnText}>Claim Rewards</Text>
                    </>
                  )
                }
              </View>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  ) : null;

  // ── Register form ───────────────────────────────────────────────────────────
  const RegisterForm = (
    <View style={s.registerCard}>
      <View style={[s.registerCardGrad, { backgroundColor: colors.card }]}>
        {/* Top row: icon + title + badge */}
        <View style={s.registerTopRow}>
          <View style={s.registerIcon}>
            <Icon name="shield-outline" size={26} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.registerTitle}>Activate Network Node</Text>
            <View style={s.registerBadge}>
              <Icon name="checkmark-circle-outline" size={9} color={colors.success} />
              <Text style={s.registerBadgeText}>Chain ID {GMI_CHAIN_ID}</Text>
            </View>
          </View>
        </View>

        <Text style={s.registerDesc}>
          Register your device on GMI Chain. Keep it online to earn {GMI_NATIVE_SYMBOL} rewards through uptime-based treasury payouts and gas fee sharing.
        </Text>

        {/* Feature 2×2 grid */}
        <View style={s.featureGrid}>
          {[
            { icon: "time-outline", label: "REWARD TYPE", value: "Uptime Rewards" },
            { icon: "flash-outline", label: "FEE SOURCE", value: "Gas Fees" },
            { icon: "trending-up-outline", label: "TREASURY", value: "Daily Payouts" },
            { icon: "trophy-outline", label: "CURRENCY", value: `${GMI_NATIVE_SYMBOL} Tokens` },
          ].map((f) => (
            <View key={f.label} style={s.featureChip}>
              <Icon name={f.icon} size={18} color={colors.primary} />
              <View>
                <Text style={s.featureChipLabel}>{f.label}</Text>
                <Text style={s.featureChipText}>{f.value}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Moniker input */}
        <Text style={s.fieldLabel}>NODE MONIKER</Text>
        <TextInput
          style={[s.input, monikerFocused && s.inputFocused]}
          value={regMoniker}
          onChangeText={setRegMoniker}
          onFocus={() => setMonikerFocused(true)}
          onBlur={() => setMonikerFocused(false)}
          placeholder="e.g. my-mchain-node"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none" autoCorrect={false} maxLength={40}
          editable={!registerMutation.isPending}
        />

        {regError ? <Text style={s.errorText}>{regError}</Text> : null}

        <TouchableOpacity
          style={[s.registerBtn, registerMutation.isPending && { opacity: 0.65 }]}
          onPress={() => registerMutation.mutate()}
          disabled={registerMutation.isPending}
          activeOpacity={0.85}
        >
          <View style={[s.registerBtnGrad, { backgroundColor: colors.primary }]}>
            {registerMutation.isPending ? <ActivityIndicator color="#FFFFFF" size="small" /> : (
              <>
                <Icon name="shield-checkmark-outline" size={18} color="#FFFFFF" />
                <Text style={s.registerBtnText}>Activate Node</Text>
              </>
            )}
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── List header ──────────────────────────────────────────────────────────────
  const ListHeader = (
    <>
      <View style={s.header}>
        <Text style={s.headerTitle}>Network</Text>
        {!isRegistered && <Text style={s.headerSub}>Activate a node to start earning {GMI_NATIVE_SYMBOL} rewards</Text>}
      </View>

      {!isRegistered && RegisterForm}

      {isRegistered && (
        <>
          {HeroCard}
          {EpochCard}
          {EarningsCard}
          {BalanceCard}

          {/* Sub Wallets */}
          <View style={s.subWalletsCard}>
            <View style={s.subWalletsHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.subWalletsTitle}>SUB WALLETS</Text>
                <Text style={s.subWalletsSub}>Each verified sub wallet earns rewards in parallel</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setShowAddSubWallet(v => !v);
                  setSubWalletError("");
                  setNewSubWallet("");
                  setNewSubWalletLabel("");
                }}
                activeOpacity={0.7}
              >
                <Icon
                  name={showAddSubWallet ? "close-circle-outline" : "add-circle-outline"}
                  size={26} color={colors.primary}
                />
              </TouchableOpacity>
            </View>

            {subWallets.map((sw) => {
              const isPending = sw.packageTier === null;
              const badgeColor = isPending ? "#F59E0B" : "#10B981";
              const badgeBg = isPending ? "#F59E0B15" : "#10B98115";
              const badgeBorder = isPending ? "#F59E0B40" : "#10B98140";
              const badgeIcon = isPending ? "time-outline" : "checkmark-circle";
              const badgeLabel = isPending ? "Pending" : `$${sw.packageTier} pkg`;
              return (
                <View key={sw.id} style={s.subWalletRow}>
                  <Icon name="wallet-outline" size={15} color={colors.primary} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.subWalletAddr} numberOfLines={1}>
                      {sw.label ? `${sw.label} · ` : ""}{shortenAddress(sw.subWalletAddress, 8)}
                    </Text>
                    {isPending && (
                      <Text style={s.subWalletPendingHint}>
                        Buy a package on-chain to start earning
                      </Text>
                    )}
                  </View>
                  <View style={[s.subWalletBadge, { backgroundColor: badgeBg, borderColor: badgeBorder }]}>
                    <Icon name={badgeIcon} size={11} color={badgeColor} />
                    <Text style={[s.subWalletBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(
                        "Remove Sub Wallet",
                        `Remove ${shortenAddress(sw.subWalletAddress, 8)}?\nIt will stop earning rewards.`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Remove",
                            style: "destructive",
                            onPress: () => removeSubWalletMutation.mutate(sw.subWalletAddress),
                          },
                        ]
                      );
                    }}
                    activeOpacity={0.7}
                    disabled={removeSubWalletMutation.isPending}
                  >
                    <Icon name="trash-outline" size={16} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              );
            })}

            {subWallets.length === 0 && !showAddSubWallet && (
              <Text style={s.subWalletsEmpty}>
                No sub wallets yet. Add wallet addresses to earn rewards alongside this node.
              </Text>
            )}

            {showAddSubWallet && (
              <View style={s.subWalletAddWrap}>
                <TextInput
                  style={[s.subWalletInput, subWalletFocused && s.subWalletInputFocused]}
                  value={newSubWallet}
                  onChangeText={(t) => { setNewSubWallet(t); setSubWalletError(""); }}
                  onFocus={() => setSubWalletFocused(true)}
                  onBlur={() => setSubWalletFocused(false)}
                  placeholder="gmi1... or 0x... address"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!addSubWalletMutation.isPending}
                />
                <TextInput
                  style={[s.subWalletInput, subWalletLabelFocused && s.subWalletInputFocused]}
                  value={newSubWalletLabel}
                  onChangeText={setNewSubWalletLabel}
                  onFocus={() => setSubWalletLabelFocused(true)}
                  onBlur={() => setSubWalletLabelFocused(false)}
                  placeholder="Label (optional, e.g. Trading wallet)"
                  placeholderTextColor={colors.mutedForeground}
                  autoCorrect={false}
                  maxLength={40}
                  editable={!addSubWalletMutation.isPending}
                />
                {subWalletError ? (
                  <Text style={s.subWalletError}>{subWalletError}</Text>
                ) : null}
                <View style={s.subWalletHintWrap}>
                  <Icon name="information-circle-outline" size={12} color={colors.mutedForeground} />
                  <Text style={s.subWalletHintText}>
                    Can be added before buying a package — it will show as "Pending" until activated on-chain.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[s.subWalletAddBtn, addSubWalletMutation.isPending && { opacity: 0.65 }]}
                  onPress={() => {
                    const addr = newSubWallet.trim().toLowerCase();
                    const isValidGmi = addr.startsWith("gmi1") && addr.length >= 20;
                    const isValid0x = /^0x[0-9a-f]{40}$/.test(addr);
                    if (!isValidGmi && !isValid0x) {
                      setSubWalletError("Enter a valid gmi1... or 0x... address");
                      return;
                    }
                    addSubWalletMutation.mutate({ addr, label: newSubWalletLabel.trim() });
                  }}
                  disabled={addSubWalletMutation.isPending}
                  activeOpacity={0.85}
                >
                  <View style={[s.subWalletAddBtnGrad, { backgroundColor: colors.primary }]}>
                    {addSubWalletMutation.isPending
                      ? <ActivityIndicator color="#FFFFFF" size="small" />
                      : <Text style={s.subWalletAddBtnText}>Add Sub Wallet</Text>
                    }
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Sub-tabs */}
          <View style={s.tabsWrap}>
            {(["treasury", "gas", "blocks", "epochs"] as SubTab[]).map((tab) => {
              const label =
                tab === "treasury" ? "Treasury" :
                tab === "gas" ? "Gas" :
                tab === "blocks" ? "Blocks" : "Epochs";
              const isActive = activeTab === tab;
              return (
                <TouchableOpacity key={tab} style={[s.tabBtn, isActive && s.tabBtnActive]} onPress={() => setActiveTab(tab)}>
                  <Text style={[s.tabBtnText, isActive && s.tabBtnTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Epochs participation summary */}
          {activeTab === "epochs" && epochsSummary && (
            <View style={s.epochsSummaryBar}>
              {[
                { label: "SIGNED", value: String(epochsSummary.signed), color: "#10B981" },
                { label: "MISSED", value: String(epochsSummary.missed), color: "#EF4444" },
                { label: "RATE", value: `${epochsSummary.participationRate}%`, color: colors.primary },
                { label: "TOTAL", value: String(epochsSummary.totalEpochs), color: colors.foreground },
              ].map(({ label, value, color }) => (
                <View key={label} style={s.epochsStatBox}>
                  <Text style={[s.epochsStatValue, { color }]}>{value}</Text>
                  <Text style={s.epochsStatLabel}>{label}</Text>
                </View>
              ))}
            </View>
          )}

          {activeError() && (
            <View style={s.errorBanner}>
              <Icon name="alert-circle-outline" size={18} color="#F87171" />
              <Text style={s.errorBannerText}>{activeError()}</Text>
              <TouchableOpacity style={s.retryBtn} onPress={handleRetry}>
                <Text style={s.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {activeTab === "blocks" && blocksItems.length > 0 && (
            <View style={s.tableHeader}>
              <Text style={s.thBlock}>BLOCK</Text>
              <Text style={s.thTxs}>TXS</Text>
              <Text style={s.thGas}>GAS USED</Text>
              <Text style={s.thTime}>TIME</Text>
            </View>
          )}

          {activeInitLoading() && (
            <>{[0, 1, 2, 3].map((i) => <SkeletonRow key={i} colors={colors} />)}</>
          )}
        </>
      )}
    </>
  );

  const items = activeItems();

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={flatListRef}
        style={s.container}
        contentContainerStyle={{ paddingBottom: 110 }}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              refetchValidator();
              refetchEarnings();
              loadTreasury(treasuryPage);
              if (activeTab === "gas") loadGas(gasPage);
              if (activeTab === "blocks") loadBlocks(blocksPage);
              if (activeTab === "epochs") loadEpochs(epochsPage);
            }}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={ListHeader}
        data={(isRegistered && !activeInitLoading() ? items : []) as any[]}
        keyExtractor={(item, i) => {
          if (activeTab === "treasury") return String((item as TreasuryReward).id);
          if (activeTab === "gas") return String((item as GasReward).blockHeight) + String(i);
          if (activeTab === "epochs") return String((item as EpochHistoryItem).epochNumber);
          return String((item as ValidatorBlock).height) + String(i);
        }}
        renderItem={({ item }) => {
          if (activeTab === "treasury") return <TreasuryRowItem item={item as TreasuryReward} />;
          if (activeTab === "gas") return <GasRowItem item={item as GasReward} />;
          if (activeTab === "epochs") return <EpochRowItem item={item as EpochHistoryItem} />;
          return <BlockRowItem item={item as ValidatorBlock} />;
        }}
        ListEmptyComponent={
          isRegistered && !activeInitLoading() && !activeError() ? (
            <View style={s.emptyState}>
              <Icon name="bar-chart-outline" size={36} color={colors.border} />
              <Text style={s.emptyText}>No {activeTab} data yet</Text>
              <Text style={s.emptySubText}>Data will appear here once your node starts earning.</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          isRegistered && !activeInitLoading() && activeTotalPages() > 1 ? (
            <View style={s.paginationRow}>
              <TouchableOpacity
                style={[s.pageBtn, activePage() === 0 && s.pageBtnDisabled]}
                onPress={handlePrevPage}
                disabled={activePage() === 0}
                activeOpacity={0.75}
              >
                <Text style={[s.pageBtnText, activePage() === 0 && { color: colors.border }]}>← Prev</Text>
              </TouchableOpacity>
              <Text style={s.pageInfo}>Page {activePage() + 1} of {activeTotalPages()}</Text>
              <TouchableOpacity
                style={[s.pageBtn, activePage() >= activeTotalPages() - 1 && s.pageBtnDisabled]}
                onPress={handleNextPage}
                disabled={activePage() >= activeTotalPages() - 1}
                activeOpacity={0.75}
              >
                <Text style={[s.pageBtnText, activePage() >= activeTotalPages() - 1 && { color: colors.border }]}>Next →</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
      <Toast message={toast} visible={!!toast} onHide={() => setToast("")} />
    </View>
  );
}
