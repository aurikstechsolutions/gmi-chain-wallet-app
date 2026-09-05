import { Icon } from "@/components/Icon";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PinSetupModal } from "@/components/PinSetupModal";
import { hasPin } from "@/services/pin";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/context/WalletContext";
import { api } from "@/services/api";
import { shortenAddress } from "@/services/crypto";
import { useColors } from "@/hooks/useColors";

type LegalType = "terms" | "privacy" | null;

async function fetchLegalContent(): Promise<{ terms: string; privacy: string }> {
  try {
    const { getPublicApiBase } = await import("@/services/api");
    const res = await fetch(`${getPublicApiBase()}/legal/content`);
    if (!res.ok) return { terms: "", privacy: "" };
    return res.json();
  } catch {
    return { terms: "", privacy: "" };
  }
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { mxcAddress, ethAddress, publicKey, moniker, updateMoniker, getPrivateKey } = useWallet();
  const scrollRef = useRef<ScrollView>(null);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinSetupMode, setPinSetupMode] = useState<"setup" | "change" | "remove">("setup");

  useEffect(() => {
    hasPin().then(setPinEnabled);
  }, []);

  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, [])
  );

  const [editingMoniker, setEditingMoniker] = useState(false);
  const [monikerInput, setMonikerInput] = useState(moniker);
  const [keyVisible, setKeyVisible] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState(false);
  const [legalModal, setLegalModal] = useState<LegalType>(null);

  const { data: chainInfo } = useQuery({
    queryKey: ["chainInfo"],
    queryFn: () => api.getChainInfo(),
    refetchInterval: 30_000,
  });

  const { data: legalContent } = useQuery({
    queryKey: ["legalContent"],
    queryFn: fetchLegalContent,
    staleTime: 60_000,
  });

  async function handleSaveMoniker() {
    await updateMoniker(monikerInput.trim() || moniker);
    setEditingMoniker(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleRevealKey() {
    if (keyVisible) { setKeyVisible(false); setPrivateKey(null); return; }
    Alert.alert("Reveal Private Key", "Your private key gives full access to your wallet. Never share it with anyone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reveal", style: "destructive",
        onPress: async () => {
          setLoadingKey(true);
          try { const key = await getPrivateKey(); setPrivateKey(key); setKeyVisible(true); }
          finally { setLoadingKey(false); }
        },
      },
    ]);
  }

  async function handleExportKey() {
    Alert.alert("Export Private Key", "This will copy your private key to the clipboard. Make sure no one can see your screen.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Copy Key", style: "destructive",
        onPress: async () => {
          const key = await getPrivateKey();
          if (key) {
            await Clipboard.setStringAsync(key);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            Alert.alert("Copied", "Private key copied to clipboard");
          }
        },
      },
    ]);
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 32 },

    // ── Profile header ──────────────────────────────────────────────────────────
    header: {
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 18),
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    headerEyebrow: { fontSize: 10, fontFamily: "Inter_700Bold", color: colors.primary, letterSpacing: 1.8, marginBottom: 6 },
    headerLabel: { fontSize: 30, fontFamily: "Inter_700Bold", color: colors.foreground, letterSpacing: -0.6 },
    headerHint: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 6, marginBottom: 18 },
    profileCard: {
      backgroundColor: colors.card, borderRadius: 22, borderWidth: 1, borderColor: colors.primary + "28",
      padding: 18, gap: 16, shadowColor: colors.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 18, elevation: 2,
    },
    profileTopRow: { flexDirection: "row", alignItems: "center", gap: 14 },
    avatarRing: {
      width: 60, height: 60, borderRadius: 30,
      borderWidth: 2, borderColor: colors.primary + "60",
      alignItems: "center", justifyContent: "center",
      backgroundColor: colors.primary + "18",
    },
    avatarText: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.primary },
    profileInfo: { flex: 1 },
    profileRole: { fontSize: 10, fontFamily: "Inter_700Bold", color: colors.primary, letterSpacing: 1.2, marginBottom: 4 },
    profileName: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 3 },
    profileAddr: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    profileBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#10B98112", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: "#10B98130" },
    profileBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#10B981" },
    profileBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#10B981" },
    profileAddressBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 },
    profileAddressLabel: { fontSize: 10, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 0.8 },
    profileAddressValue: { flex: 1, fontSize: 11, fontFamily: "Inter_500Medium", color: colors.foreground },

    // ── Sections ────────────────────────────────────────────────────────────────
    section: { marginHorizontal: 20, marginBottom: 22 },
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
    sectionIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" },
    sectionLabel: { fontSize: 12, fontFamily: "Inter_700Bold", color: colors.foreground, letterSpacing: 0.8 },
    sectionSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 },

    // ── Card / Row ───────────────────────────────────────────────────────────────
    card: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 16, gap: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    rowLast: { borderBottomWidth: 0 },
    rowIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primary + "12", alignItems: "center", justifyContent: "center" },
    rowBody: { flex: 1 },
    rowLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: colors.foreground },
    rowSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 },
    rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
    rowValue: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    rowChevron: { opacity: 0.45 },

    // ── Chain stats grid ─────────────────────────────────────────────────────────
    chainGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    chainStat: { flex: 1, minWidth: "44%", backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
    chainStatTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    chainStatLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2 },
    chainStatValue: { fontSize: 17, fontFamily: "Inter_700Bold", color: colors.foreground },
    chainStatSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 },

    // ── Moniker ──────────────────────────────────────────────────────────────────
    monikerInput: {
      flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: colors.foreground,
      backgroundColor: colors.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
      borderWidth: 1.5, borderColor: colors.primary + "70", marginRight: 8,
    },

    // ── Danger zone ──────────────────────────────────────────────────────────────
    dangerCard: { backgroundColor: "#0A0000", borderRadius: 16, borderWidth: 1, borderColor: "#EF444430", overflow: "hidden" },
    dangerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 15, gap: 14, borderBottomWidth: 1, borderBottomColor: "#EF444418" },
    dangerRowLast: { borderBottomWidth: 0 },
    dangerIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#EF444415", alignItems: "center", justifyContent: "center" },
    dangerText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#F87171" },
    keyBox: { backgroundColor: "#0D0000", marginHorizontal: 16, marginBottom: 12, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#EF444420" },
    keyText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#F87171", lineHeight: 20, letterSpacing: 0.5 },

    // ── Version / footer ─────────────────────────────────────────────────────────
    footer: { alignItems: "center", paddingVertical: 8, gap: 6 },
    version: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    versionBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: colors.border },
    versionBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },

    // ── Legal modal ──────────────────────────────────────────────────────────────
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
    modalSheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%", overflow: "hidden" },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: colors.foreground },
    modalBody: { padding: 20 },
    legalText: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, lineHeight: 22 },
    legalEmpty: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", paddingVertical: 40 },
  });

  const initials = (moniker || "W").slice(0, 2).toUpperCase();

  return (
    <View style={s.container}>
      <ScrollView ref={scrollRef} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ──────────────────────────────────────────── */}
        <View style={s.header}>
          <Text style={s.headerEyebrow}>GMI WALLET</Text>
          <Text style={s.headerLabel}>Settings</Text>
          <Text style={s.headerHint}>Manage your wallet, network, and security.</Text>
          <View style={s.profileCard}>
            <View style={s.profileTopRow}>
              <View style={s.avatarRing}>
                <Text style={s.avatarText}>{initials}</Text>
              </View>
              <View style={s.profileInfo}>
                <Text style={s.profileRole}>ACTIVE WALLET</Text>
                <Text style={s.profileName}>{moniker || "My Wallet"}</Text>
                <Text style={s.profileAddr}>{mxcAddress ? shortenAddress(mxcAddress, 16) : "No wallet"}</Text>
              </View>
              <View style={s.profileBadge}>
                <View style={s.profileBadgeDot} />
                <Text style={s.profileBadgeText}>Active</Text>
              </View>
            </View>
            <TouchableOpacity
              style={s.profileAddressBtn}
              onPress={() => {
                if (mxcAddress) {
                  Clipboard.setStringAsync(mxcAddress);
                  if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
              }}
              activeOpacity={0.75}
            >
              <Text style={s.profileAddressLabel}>GMI</Text>
              <Text style={s.profileAddressValue} numberOfLines={1}>
                {mxcAddress ? shortenAddress(mxcAddress, 22) : "Address unavailable"}
              </Text>
              <Icon name="copy-outline" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Wallet identity ──────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.sectionIcon}><Icon name="person-circle-outline" size={15} color={colors.primary} /></View>
            <View>
              <Text style={s.sectionLabel}>Wallet identity</Text>
              <Text style={s.sectionSub}>Give your wallet a name you recognize.</Text>
            </View>
          </View>
          <View style={s.card}>
            <View style={[s.row, s.rowLast]}>
              <View style={s.rowIcon}><Icon name="at-circle-outline" size={16} color={colors.mutedForeground} /></View>
              <View style={s.rowBody}>
                <Text style={s.rowLabel}>Moniker</Text>
              </View>
              {editingMoniker ? (
                <>
                  <TextInput
                    style={s.monikerInput}
                    value={monikerInput}
                    onChangeText={(t) => setMonikerInput(t.slice(0, 32))}
                    autoFocus maxLength={32} autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={handleSaveMoniker}>
                    <Icon name="checkmark-circle" size={22} color={colors.success} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setEditingMoniker(false); setMonikerInput(moniker); }} style={{ marginLeft: 8 }}>
                    <Icon name="close-circle" size={22} color={colors.destructive} />
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={s.rowRight} onPress={() => { setMonikerInput(moniker); setEditingMoniker(true); }}>
                  <Text style={s.rowValue}>{moniker || "—"}</Text>
                  <Icon name="pencil-outline" size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* ── Security ─────────────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.sectionIcon}><Icon name="shield-checkmark-outline" size={13} color={colors.primary} /></View>
            <View>
              <Text style={s.sectionLabel}>Wallet lock</Text>
              <Text style={s.sectionSub}>Protect access to your wallet and transfers.</Text>
            </View>
          </View>
          <View style={s.card}>
            <TouchableOpacity
              style={[s.row, s.rowLast]}
              onPress={() => {
                setPinSetupMode(pinEnabled ? "change" : "setup");
                setShowPinSetup(true);
              }}
              activeOpacity={0.75}
            >
              <View style={s.rowIcon}><Icon name="lock-closed-outline" size={16} color={colors.mutedForeground} /></View>
              <View style={s.rowBody}>
                <Text style={s.rowLabel}>Wallet PIN</Text>
                <Text style={s.rowSub}>{pinEnabled ? "Required to open wallet & send" : "Not set — tap to enable"}</Text>
              </View>
              <View style={s.rowRight}>
                <Text style={[s.rowValue, { color: pinEnabled ? "#10B981" : colors.mutedForeground }]}>
                  {pinEnabled ? "ON" : "OFF"}
                </Text>
                {pinEnabled && (
                  <TouchableOpacity
                    onPress={() => { setPinSetupMode("remove"); setShowPinSetup(true); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ marginLeft: 8 }}
                  >
                    <Icon name="trash-outline" size={14} color={colors.destructive} />
                  </TouchableOpacity>
                )}
                <Icon name="chevron-forward" size={14} color={colors.mutedForeground} style={s.rowChevron} />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Wallet ───────────────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.sectionIcon}><Icon name="wallet-outline" size={13} color={colors.primary} /></View>
            <View>
              <Text style={s.sectionLabel}>Addresses</Text>
              <Text style={s.sectionSub}>Your public wallet identifiers.</Text>
            </View>
          </View>
          <View style={s.card}>
            <TouchableOpacity style={s.row} onPress={() => {
              if (mxcAddress) { Clipboard.setStringAsync(mxcAddress); if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
            }}>
              <View style={s.rowIcon}><Icon name="location-outline" size={16} color={colors.mutedForeground} /></View>
              <View style={s.rowBody}>
                <Text style={s.rowLabel}>GMI Address</Text>
                <Text style={s.rowSub}>{mxcAddress ? shortenAddress(mxcAddress, 14) : "—"}</Text>
              </View>
              <Icon name="copy-outline" size={14} color={colors.mutedForeground} style={s.rowChevron} />
            </TouchableOpacity>
            <TouchableOpacity style={s.row} onPress={() => {
              if (ethAddress) { Clipboard.setStringAsync(ethAddress); if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
            }}>
              <View style={s.rowIcon}><Icon name="diamond-outline" size={16} color={colors.mutedForeground} /></View>
              <View style={s.rowBody}>
                <Text style={s.rowLabel}>EVM Address (0x)</Text>
                <Text style={s.rowSub}>{ethAddress ? shortenAddress(ethAddress, 14) : "—"}</Text>
              </View>
              <Icon name="copy-outline" size={14} color={colors.mutedForeground} style={s.rowChevron} />
            </TouchableOpacity>
            <View style={[s.row, s.rowLast]}>
              <View style={s.rowIcon}><Icon name="key-outline" size={16} color={colors.mutedForeground} /></View>
              <View style={s.rowBody}>
                <Text style={s.rowLabel}>Public Key</Text>
                <Text style={s.rowSub}>{publicKey ? shortenAddress(publicKey, 14) : "—"}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Chain ────────────────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.sectionIcon}><Icon name="git-branch-outline" size={13} color={colors.primary} /></View>
            <View>
              <Text style={s.sectionLabel}>Network status</Text>
              <Text style={s.sectionSub}>Live information from GMI Chain.</Text>
            </View>
          </View>
          <View style={s.chainGrid}>
            {[
              { label: "NETWORK", value: "GMI Chain", sub: "Mainnet", icon: "globe-outline" },
              { label: "CHAIN ID", value: String(chainInfo?.chainId ?? "33698741"), sub: "EVM Compatible", icon: "finger-print-outline" },
              { label: "BLOCK HEIGHT", value: chainInfo?.blockHeight?.toLocaleString() ?? "—", sub: "Latest", icon: "cube-outline" },
              { label: "GAS PRICE", value: String(chainInfo?.gasPrice ?? "—"), sub: "Gwei", icon: "flash-outline" },
            ].map((item) => (
              <View key={item.label} style={s.chainStat}>
                <View style={s.chainStatTop}>
                  <Text style={s.chainStatLabel}>{item.label}</Text>
                  <Icon name={item.icon} size={14} color={colors.primary} />
                </View>
                <Text style={s.chainStatValue}>{item.value}</Text>
                <Text style={s.chainStatSub}>{item.sub}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Security ─────────────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={[s.sectionIcon, { backgroundColor: "#EF444415" }]}><Icon name="shield-outline" size={13} color="#F87171" /></View>
            <View>
              <Text style={[s.sectionLabel, { color: "#F87171" }]}>Backup &amp; export</Text>
              <Text style={s.sectionSub}>Keep these actions private and offline.</Text>
            </View>
          </View>
          <View style={s.dangerCard}>
            <TouchableOpacity style={s.dangerRow} onPress={handleRevealKey}>
              <View style={s.dangerIcon}>
                {loadingKey ? <ActivityIndicator color="#F87171" size="small" /> : <Icon name={keyVisible ? "eye-off-outline" : "eye-outline"} size={16} color="#F87171" />}
              </View>
              <Text style={[s.dangerText, { flex: 1 }]}>{keyVisible ? "Hide" : "Show"} Private Key</Text>
              <Icon name="chevron-forward" size={14} color="#F8717160" />
            </TouchableOpacity>
            {keyVisible && privateKey && (
              <View style={s.keyBox}>
                <Text style={s.keyText} selectable>{privateKey}</Text>
              </View>
            )}
            <TouchableOpacity style={[s.dangerRow, s.dangerRowLast]} onPress={handleExportKey}>
              <View style={s.dangerIcon}><Icon name="copy-outline" size={16} color="#F87171" /></View>
              <Text style={[s.dangerText, { flex: 1 }]}>Export Private Key</Text>
              <Icon name="chevron-forward" size={14} color="#F8717160" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Legal ────────────────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.sectionIcon}><Icon name="document-text-outline" size={13} color={colors.primary} /></View>
            <View>
              <Text style={s.sectionLabel}>Legal</Text>
              <Text style={s.sectionSub}>Review the wallet policies.</Text>
            </View>
          </View>
          <View style={s.card}>
            <TouchableOpacity style={s.row} onPress={() => setLegalModal("terms")}>
              <View style={s.rowIcon}><Icon name="document-outline" size={16} color={colors.mutedForeground} /></View>
              <View style={s.rowBody}><Text style={s.rowLabel}>Terms &amp; Conditions</Text></View>
              <Icon name="chevron-forward" size={14} color={colors.mutedForeground} style={s.rowChevron} />
            </TouchableOpacity>
            <TouchableOpacity style={[s.row, s.rowLast]} onPress={() => setLegalModal("privacy")}>
              <View style={s.rowIcon}><Icon name="shield-checkmark-outline" size={16} color={colors.mutedForeground} /></View>
              <View style={s.rowBody}><Text style={s.rowLabel}>Privacy Policy</Text></View>
              <Icon name="chevron-forward" size={14} color={colors.mutedForeground} style={s.rowChevron} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Version ──────────────────────────────────────────── */}
        <View style={[s.section, s.footer]}>
          <View style={s.versionBadge}>
            <Icon name="cube-outline" size={11} color={colors.mutedForeground} />
            <Text style={s.versionBadgeText}>v1.0.0</Text>
          </View>
              <Text style={s.version}>GMI Wallet</Text>
        </View>

      </ScrollView>

      {/* ── Legal Modal ──────────────────────────────────────── */}
      <Modal visible={!!legalModal} transparent animationType="slide" onRequestClose={() => setLegalModal(null)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>
                {legalModal === "terms" ? "Terms & Conditions" : "Privacy Policy"}
              </Text>
              <TouchableOpacity onPress={() => setLegalModal(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="close" size={22} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.modalBody}>
              {legalModal === "terms" && (
                legalContent?.terms
                  ? <Text style={s.legalText}>{legalContent.terms}</Text>
                  : <Text style={s.legalEmpty}>No terms have been published yet.</Text>
              )}
              {legalModal === "privacy" && (
                legalContent?.privacy
                  ? <Text style={s.legalText}>{legalContent.privacy}</Text>
                  : <Text style={s.legalEmpty}>No privacy policy has been published yet.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <PinSetupModal
        visible={showPinSetup}
        mode={pinSetupMode}
        onDone={() => {
          setShowPinSetup(false);
          hasPin().then(setPinEnabled);
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
        onCancel={() => setShowPinSetup(false)}
      />
    </View>
  );
}
