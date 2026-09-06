import * as Haptics from "expo-haptics";

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Keyboard,
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
import { Icon } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { useWallet } from "@/context/WalletContext";
import {
  addCustomToken,
  fetchTokenMetadata,
  type TokenMetadata,
} from "@/services/tokens";

import { api, type ApiVerifiedToken } from "@/services/api";
import { useQuery } from "@tanstack/react-query";
import { GMI_CHAIN_ID, GMI_CHAIN_NAME } from "@/services/chain";

type Panel = "popular" | "custom";

type Props = {
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
};

export function AddTokenModal({ visible, onClose, onAdded }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { ethAddress, activeWallet } = useWallet();

  const [panel, setPanel] = useState<Panel>("popular");
  const [search, setSearch] = useState("");
  const [selectedVerified, setSelectedVerified] = useState<ApiVerifiedToken | null>(null);

  const { data: verifiedTokensData = [] } = useQuery({
    queryKey: ["verifiedTokens"],
    queryFn: () => api.getVerifiedTokens(),
    staleTime: 5 * 60_000,
  });

  // Popular → contract entry step
  const [contractInput, setContractInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Custom form
  const [cAddress, setCAddress] = useState("");
  const [cSymbol, setCSymbol] = useState("");
  const [cName, setCName] = useState("");
  const [cDecimals, setCDecimals] = useState("18");

  // Auto-fetch state for custom panel
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchedMeta, setFetchedMeta] = useState<TokenMetadata | null>(null);
  const [fetchError, setFetchError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slideAnim = useRef(new Animated.Value(500)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const keyboardOffset = useRef(new Animated.Value(0)).current;

  // Lift sheet when keyboard appears so inputs are never hidden
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => {
        Animated.timing(keyboardOffset, {
          toValue: e.endCoordinates.height,
          duration: Platform.OS === "ios" ? e.duration : 180,
          useNativeDriver: true,
        }).start();
      }
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      (e) => {
        Animated.timing(keyboardOffset, {
          toValue: 0,
          duration: Platform.OS === "ios" ? e.duration : 180,
          useNativeDriver: true,
        }).start();
      }
    );
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Auto-fetch metadata when a valid contract address is typed in custom panel
  useEffect(() => {
    setFetchedMeta(null);
    setFetchError("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!/^0x[0-9a-fA-F]{40}$/.test(cAddress.trim())) return;

    debounceRef.current = setTimeout(async () => {
      setFetchLoading(true);
      try {
        const meta = await fetchTokenMetadata(cAddress.trim(), ethAddress ?? undefined);
        setFetchedMeta(meta);
        setCSymbol(meta.symbol);
        setCName(meta.name);
        setCDecimals(String(meta.decimals));
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Could not fetch token details");
      } finally {
        setFetchLoading(false);
      }
    }, 600);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [cAddress, ethAddress]);

  useEffect(() => {
    if (visible) {
      setPanel("popular");
      setSearch("");
      setSelectedVerified(null);
      setContractInput("");
      setError("");
      setCAddress(""); setCSymbol(""); setCName(""); setCDecimals("18");
      setFetchedMeta(null); setFetchError(""); setFetchLoading(false);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 320, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.timing(overlayOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 500, duration: 260, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
        Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredVerified = verifiedTokensData.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.symbol.toLowerCase().includes(search.toLowerCase())
  );

  function isValidAddress(addr: string) {
    return /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
  }

  async function handleAddVerified() {
    if (!selectedVerified) return;
    const addr = contractInput.trim();
    if (!isValidAddress(addr)) {
      setError("Enter a valid contract address (0x…)");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await addCustomToken({
        contractAddress: addr,
        symbol: selectedVerified.symbol,
        name: selectedVerified.name,
        decimals: selectedVerified.decimals,
        logoUrl: selectedVerified.logoUrl,
        verified: true,
      }, activeWallet?.id ?? "", activeWallet?.nfcTemporary, activeWallet?.mxcAddress);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onAdded();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCustom() {
    const addr = cAddress.trim();
    if (!isValidAddress(addr)) { setError("Enter a valid contract address (0x…)"); return; }
    if (!cSymbol.trim()) { setError("Symbol is required"); return; }
    if (!cName.trim()) { setError("Name is required"); return; }
    const dec = parseInt(cDecimals, 10);
    if (isNaN(dec) || dec < 0 || dec > 18) { setError("Decimals must be 0–18"); return; }
    setSaving(true);
    setError("");
    try {
      await addCustomToken({
        contractAddress: addr,
        symbol: cSymbol.trim().toUpperCase(),
        name: cName.trim(),
        decimals: dec,
        verified: false,
      }, activeWallet?.id ?? "", activeWallet?.nfcTemporary, activeWallet?.mxcAddress);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onAdded();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderTopWidth: 1,
      borderColor: colors.border,
      paddingBottom: insets.bottom + 8,
      maxHeight: "92%",
    },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: 12, marginBottom: 4 },
    sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: colors.foreground },
    closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
    panelRow: { flexDirection: "row", marginHorizontal: 20, marginTop: 14, marginBottom: 4, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 4 },
    panelBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
    panelBtnActive: { backgroundColor: colors.primary + "20", borderWidth: 1, borderColor: colors.primary + "50" },
    panelBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    panelBtnTextActive: { fontFamily: "Inter_700Bold", color: colors.primary },
    searchWrap: { marginHorizontal: 20, marginTop: 12, marginBottom: 4, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10 },
    searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground },
    sectionLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.5, marginTop: 14, marginBottom: 8, marginHorizontal: 20 },
    tokenItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border + "60" },
    tokenLogo: { width: 36, height: 36, borderRadius: 18 },
    tokenLogoFallback: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
    tokenLogoText: { fontSize: 10, fontFamily: "Inter_700Bold", color: colors.primary },
    tokenItemInfo: { flex: 1 },
    tokenItemName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    tokenItemSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 1 },
    verifiedBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: "#10B98115", borderWidth: 1, borderColor: "#10B98140" },
    verifiedText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#10B981", letterSpacing: 0.6 },
    contractStep: { paddingHorizontal: 20, paddingTop: 4 },
    backRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14, marginTop: 8 },
    backText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    selectedTokenCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 16 },
    fieldLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2, marginBottom: 6 },
    fieldInput: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, marginBottom: 14 },
    fieldHint: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginBottom: 16, marginTop: -10 },
    errorText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#EF4444", marginBottom: 12 },
    primaryBtn: { borderRadius: 14, overflow: "hidden", marginBottom: 8, marginTop: 4 },
    primaryGrad: { paddingVertical: 15, alignItems: "center", justifyContent: "center" },
    primaryBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
    row2: { flexDirection: "row", gap: 10 },
    halfInput: { flex: 1 },
    addrInputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 4,
      marginBottom: 14,
      gap: 8,
    },
    addrInputRowValid: { borderColor: colors.primary + "60" },
    previewCard: {
      borderRadius: 14,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.primary + "30",
      marginBottom: 16,
    },
    previewGrad: { padding: 14 },
    previewTopRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
    tokenIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary + "20",
      borderWidth: 1,
      borderColor: colors.primary + "40",
      alignItems: "center",
      justifyContent: "center",
    },
    tokenIconText: { fontSize: 12, fontFamily: "Inter_700Bold", color: colors.primary },
    previewTokenName: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
    previewTokenSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)", marginTop: 2 },
    statsRow: { flexDirection: "row", gap: 8 },
    statBox: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 10, padding: 10 },
    statLabel: { fontSize: 8, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.4)", letterSpacing: 1.2, marginBottom: 4 },
    statValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
    fetchErrorBox: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      backgroundColor: "#1A0000",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: "#EF444440",
      padding: 12,
      marginBottom: 14,
    },
    fetchErrorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#F87171", lineHeight: 18 },
  });

  const body = (
    <>
      {/* Panel switcher */}
      <View style={s.panelRow}>
        {(["popular", "custom"] as Panel[]).map((p) => (
          <TouchableOpacity
            key={p}
            style={[s.panelBtn, panel === p && s.panelBtnActive]}
            onPress={() => { setPanel(p); setSelectedVerified(null); setError(""); }}
            activeOpacity={0.8}
          >
            <Text style={[s.panelBtnText, panel === p && s.panelBtnTextActive]}>
              {p === "popular" ? "Popular" : "Custom"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Popular panel */}
      {panel === "popular" && !selectedVerified && (
        <>
          <View style={s.searchWrap}>
            <Icon name="search" size={15} color={colors.mutedForeground} />
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search tokens…"
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Icon name="close" size={13} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
          <Text style={s.sectionLabel}>VERIFIED TOKENS</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {filteredVerified.map((token) => (
              <TouchableOpacity
                key={token.id}
                style={s.tokenItem}
                onPress={async () => {
                  if (token.contractAddress) {
                    setSaving(true);
                    setError("");
                    try {
                      await addCustomToken({
                        contractAddress: token.contractAddress,
                        symbol: token.symbol,
                        name: token.name,
                        decimals: token.decimals,
                        logoUrl: token.logoUrl,
                        verified: true,
                      }, activeWallet?.id ?? "", activeWallet?.nfcTemporary, activeWallet?.mxcAddress);
                      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      onAdded();
                      onClose();
                    } finally {
                      setSaving(false);
                    }
                  } else {
                    setSelectedVerified(token);
                    setContractInput("");
                    setError("");
                  }
                }}
                activeOpacity={0.75}
              >
                <Image
                  source={{ uri: token.logoUrl }}
                  style={s.tokenLogo}
                  defaultSource={undefined}
                  onError={() => {}}
                />
                <View style={s.tokenItemInfo}>
                  <Text style={s.tokenItemName}>{token.symbol}</Text>
                  <Text style={s.tokenItemSub}>{token.name}</Text>
                </View>
                <View style={s.verifiedBadge}>
                  <Text style={s.verifiedText}>VERIFIED</Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
            {filteredVerified.length === 0 && (
              <View style={{ paddingVertical: 40, alignItems: "center" }}>
                <Text style={[s.tokenItemSub, { textAlign: "center" }]}>No tokens match "{search}"</Text>
              </View>
            )}
          </ScrollView>
        </>
      )}

      {/* Popular → contract address step */}
      {panel === "popular" && selectedVerified && (
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={s.contractStep}>
            <TouchableOpacity style={s.backRow} onPress={() => setSelectedVerified(null)}>
              <Icon name="arrow-back" size={15} color={colors.mutedForeground} />
              <Text style={s.backText}>Back to popular tokens</Text>
            </TouchableOpacity>

            <View style={s.selectedTokenCard}>
              <Image source={{ uri: selectedVerified.logoUrl }} style={s.tokenLogo} />
              <View style={{ flex: 1 }}>
                <Text style={s.tokenItemName}>{selectedVerified.symbol}</Text>
                <Text style={s.tokenItemSub}>{selectedVerified.name} · {selectedVerified.decimals} decimals</Text>
              </View>
              <View style={s.verifiedBadge}>
                <Text style={s.verifiedText}>VERIFIED</Text>
              </View>
            </View>

            <Text style={s.fieldLabel}>CONTRACT ADDRESS ON {GMI_CHAIN_NAME.toUpperCase()}</Text>
            <TextInput
              style={s.fieldInput}
              value={contractInput}
              onChangeText={(v) => { setContractInput(v); setError(""); }}
              placeholder="0x…"
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
            />
            <Text style={s.fieldHint}>Paste the {selectedVerified.symbol} contract address deployed on {GMI_CHAIN_NAME} (Chain ID {GMI_CHAIN_ID}).</Text>

            {error ? <Text style={s.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[s.primaryBtn, saving && { opacity: 0.65 }]}
              onPress={handleAddVerified}
              disabled={saving}
              activeOpacity={0.85}
            >
              <View  style={s.primaryGrad}>
                <Text style={s.primaryBtnText}>Add {selectedVerified.symbol}</Text>
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Custom panel */}
      {panel === "custom" && (
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={s.contractStep}>
            <View style={{ height: 10 }} />
            <Text style={s.fieldLabel}>CONTRACT ADDRESS</Text>
            <View style={[s.addrInputRow, cAddress.length > 0 && /^0x[0-9a-fA-F]{40}$/.test(cAddress) && s.addrInputRowValid]}>
              <Icon name="cube-outline" size={15} color={colors.mutedForeground} style={{ marginRight: 2 }} />
              <TextInput
                style={[s.fieldInput, { flex: 1, marginBottom: 0, borderWidth: 0, paddingHorizontal: 0, backgroundColor: "transparent" }]}
                value={cAddress}
                onChangeText={(v) => { setCAddress(v.trim()); setError(""); }}
                placeholder="0x…"
                placeholderTextColor={colors.mutedForeground}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {fetchLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : cAddress.length > 0 ? (
                <TouchableOpacity onPress={() => { setCAddress(""); setFetchedMeta(null); setFetchError(""); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close-circle" size={15} color={colors.mutedForeground} />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Auto-fetch preview */}
            {fetchedMeta && !fetchError && (
              <View style={s.previewCard}>
                <View  style={s.previewGrad}>
                  <View style={s.previewTopRow}>
                    <View style={s.tokenIconWrap}>
                      <Text style={s.tokenIconText}>{fetchedMeta.symbol.slice(0, 3)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.previewTokenName}>{fetchedMeta.name}</Text>
                      <Text style={s.previewTokenSub}>{fetchedMeta.symbol} · {fetchedMeta.decimals} decimals</Text>
                    </View>
                  </View>
                  <View style={s.statsRow}>
                    <View style={s.statBox}>
                      <Text style={s.statLabel}>TOTAL SUPPLY</Text>
                      <Text style={s.statValue}>{fetchedMeta.totalSupply}</Text>
                    </View>
                    <View style={s.statBox}>
                      <Text style={s.statLabel}>YOUR BALANCE</Text>
                      <Text style={[s.statValue, fetchedMeta.userBalance && fetchedMeta.userBalance !== "0" ? { color: "#10B981" } : {}]}>
                        {fetchedMeta.userBalance ?? "—"} {fetchedMeta.symbol}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            )}

            {fetchError && (
              <View style={s.fetchErrorBox}>
                <Icon name="alert-circle-outline" size={15} color="#EF4444" />
                <Text style={s.fetchErrorText}>{fetchError}</Text>
              </View>
            )}

            {/* Manual overrides — shown collapsed when auto-fetched, expanded otherwise */}
            {!fetchedMeta && !fetchLoading && (
              <>
                <View style={s.row2}>
                  <View style={s.halfInput}>
                    <Text style={s.fieldLabel}>SYMBOL</Text>
                    <TextInput style={s.fieldInput} value={cSymbol} onChangeText={(v) => { setCSymbol(v); setError(""); }} placeholder="e.g. USDT" placeholderTextColor={colors.mutedForeground} autoCapitalize="characters" />
                  </View>
                  <View style={s.halfInput}>
                    <Text style={s.fieldLabel}>DECIMALS</Text>
                    <TextInput style={s.fieldInput} value={cDecimals} onChangeText={(v) => { setCDecimals(v); setError(""); }} placeholder="18" placeholderTextColor={colors.mutedForeground} keyboardType="numeric" />
                  </View>
                </View>
                <Text style={s.fieldLabel}>TOKEN NAME</Text>
                <TextInput style={s.fieldInput} value={cName} onChangeText={(v) => { setCName(v); setError(""); }} placeholder="e.g. Tether USD" placeholderTextColor={colors.mutedForeground} />
              </>
            )}

            {error ? <Text style={s.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[s.primaryBtn, (saving || fetchLoading || (!fetchedMeta && !cSymbol)) && { opacity: 0.55 }]}
              onPress={handleAddCustom}
              disabled={saving || fetchLoading || (!fetchedMeta && !cSymbol.trim())}
              activeOpacity={0.85}
            >
              <View  style={s.primaryGrad}>
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={s.primaryBtnText}>
                    {fetchedMeta ? `Add ${fetchedMeta.symbol} to Wallet` : "Add Custom Token"}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[s.overlay, { opacity: overlayOpacity }]}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => { Keyboard.dismiss(); onClose(); }} />
        <Animated.View
          style={[
            s.sheet,
            {
              transform: [
                { translateY: slideAnim },
                { translateY: Animated.multiply(keyboardOffset, -1) },
              ],
            },
          ]}
        >
          <View style={s.handle} />
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>Add Token</Text>
            <TouchableOpacity style={s.closeBtn} onPress={() => { Keyboard.dismiss(); onClose(); }}>
              <Icon name="close" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          {body}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
