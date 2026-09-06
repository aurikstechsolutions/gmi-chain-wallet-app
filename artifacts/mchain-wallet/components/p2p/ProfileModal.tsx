import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { useWallet } from "@/context/WalletContext";
import { useColors } from "@/hooks/useColors";
import { p2pApi, type P2pProfile } from "@/services/p2pApi";
import { formatDetailsSingleLine, PAYMENT_METHODS as PM_LIST } from "@/services/paymentMethods";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { PaymentDetailSheet } from "./PaymentDetailSheet";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  visible: boolean;
  onClose: () => void;
  profile: P2pProfile | null;
}

function StarRating({ rating }: { rating: number }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Icon key={i} name={i <= Math.round(rating) ? "star" : "star-outline"} size={14} color={i <= Math.round(rating) ? "#F59E0B" : colors.border} />
      ))}
    </View>
  );
}

const KYC_DOCS = [
  { id: "passport", label: "Passport" },
  { id: "national_id", label: "National ID" },
  { id: "drivers_license", label: "Driver's Licence" },
];

export function ProfileModal({ visible, onClose, profile }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { mxcAddress } = useWallet();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<"overview" | "kyc" | "payment">("overview");
  const [pmSheet, setPmSheet] = useState<{ method: string } | null>(null);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");

  // Re-sync fields every time the modal opens or the saved profile changes
  useEffect(() => {
    if (visible) {
      setDisplayName(profile?.displayName ?? "");
      setPhone(profile?.phone ?? "");
    }
  }, [visible, profile]);
  const [kycName, setKycName] = useState("");
  const [kycDoc, setKycDoc] = useState("passport");
  const [kycDocImage, setKycDocImage] = useState<string | null>(null);
  const [kycDocTooLarge, setKycDocTooLarge] = useState(false);
  const [loading, setLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [toast, setToast] = useState("");

  const { data: savedDetails = [], refetch: refetchPaymentDetails } = useQuery({
    queryKey: ["payment-details", mxcAddress],
    queryFn: () => p2pApi.getPaymentDetails(mxcAddress!),
    enabled: !!mxcAddress && tab === "payment",
  });
  const detailsByMethod = new Map(savedDetails.map(d => [d.paymentMethod, d]));

  const completionRate = profile
    ? profile.totalTrades > 0
      ? ((profile.completedTrades / profile.totalTrades) * 100).toFixed(1)
      : "100.0"
    : "—";

  async function handleDisconnect() {
    if (!mxcAddress) return;
    setDisconnecting(true);
    try {
      await p2pApi.disconnectProfile(mxcAddress);
      queryClient.invalidateQueries({ queryKey: ["p2p_profile"] });
      onClose();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  }

  async function handleSaveProfile() {
    if (!mxcAddress) return;
    if (!displayName.trim()) { setToast("Enter a display name"); return; }
    if (!phone.trim()) { setToast("Phone number is required"); return; }
    setLoading(true);
    try {
      await p2pApi.upsertProfile({ mxcAddress, displayName: displayName.trim(), phone: phone.trim() });
      queryClient.invalidateQueries({ queryKey: ["p2p_profile"] });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setToast("Profile saved");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  const KYC_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

  async function pickDocument() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setToast("Camera roll permission required"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      // Determine size: fileSize (raw bytes) if available, otherwise estimate from base64 length
      const rawBytes = asset.fileSize ?? (asset.base64 ? Math.round(asset.base64.length * 0.75) : 0);
      if (rawBytes > KYC_MAX_BYTES) {
        setKycDocImage(asset.uri); // show the preview so user sees what they picked
        setKycDocTooLarge(true);
        return;
      }
      setKycDocTooLarge(false);
      setKycDocImage(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri);
    }
  }

  async function handleSubmitKyc() {
    if (!mxcAddress) return;
    if (!displayName.trim() || !kycName.trim()) { setToast("Fill in all fields"); return; }
    setLoading(true);
    try {
      await p2pApi.submitKyc({
        mxcAddress,
        displayName: displayName.trim(),
        kycName: kycName.trim(),
        kycDocType: kycDoc,
        kycDocImage: kycDocImage ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["p2p_profile"] });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setToast("KYC submitted — pending review");
      setKycDocImage(null);
      setTab("overview");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setLoading(false);
    }
  }

  const kycColor = profile?.kycStatus === "verified" ? "#10B981" : profile?.kycStatus === "pending" ? "#F59E0B" : profile?.kycStatus === "rejected" ? "#EF4444" : colors.mutedForeground;
  const kycLabel = profile?.kycStatus === "verified" ? "Verified" : profile?.kycStatus === "pending" ? "Pending Review" : profile?.kycStatus === "rejected" ? "Rejected" : "Not Submitted";

  const s = StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.72)" },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 16, maxHeight: "92%" },
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    title: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground },
    closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
    tabBar: { flexDirection: "row", marginHorizontal: 20, marginTop: 14, marginBottom: 4, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 3 },
    tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
    tabBtnActive: { backgroundColor: colors.primary + "20", borderWidth: 1, borderColor: colors.primary + "50" },
    tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    tabTextActive: { fontFamily: "Inter_700Bold", color: colors.primary },
    scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
    avatarWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary + "20", alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 10, borderWidth: 2, borderColor: colors.primary + "40" },
    avatarText: { fontSize: 26, fontFamily: "Inter_700Bold", color: colors.primary },
    nameText: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center" },
    addrText: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginBottom: 8 },
    badgeRow: { flexDirection: "row", justifyContent: "center", gap: 6, flexWrap: "wrap", marginBottom: 14 },
    badgeKyc: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: "#10B98115", borderWidth: 1, borderColor: "#10B98140" },
    badgeKycText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#10B981" },
    badgeVerified: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: "#0EA5E915", borderWidth: 1, borderColor: "#0EA5E960" },
    badgeVerifiedText: { fontSize: 10, fontFamily: "Inter_700Bold", color: colors.primary },
    badgeMerchant: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: "#F59E0B15", borderWidth: 1, borderColor: "#F59E0B40" },
    badgeMerchantText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#F59E0B" },
    badgeVolume: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: "#FFFFFF08", borderWidth: 1, borderColor: "#FFFFFF20" },
    badgeVolumeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: colors.mutedForeground },
    statsRow: { flexDirection: "row", gap: 10, marginBottom: 18 },
    statBox: { flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, alignItems: "center" },
    statVal: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground },
    statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 },
    kycCard: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 18, flexDirection: "row", alignItems: "center", gap: 12 },
    kycLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    kycSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 },
    label: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2, marginBottom: 8 },
    input: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground, marginBottom: 14 },
    docGrid: { flexDirection: "row", gap: 8, marginBottom: 18 },
    docChip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card, alignItems: "center" },
    docChipActive: { borderColor: colors.primary, backgroundColor: colors.primary + "15" },
    docText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    docTextActive: { color: colors.primary, fontFamily: "Inter_600SemiBold" },
    uploadBtn: { borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, borderStyle: "dashed", overflow: "hidden", marginBottom: 18, minHeight: 120, justifyContent: "center" },
    uploadPlaceholder: { alignItems: "center", paddingVertical: 24, gap: 6 },
    uploadText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground },
    uploadHint: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    docPreview: { width: "100%", height: 160 },
    uploadOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.55)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 6 },
    uploadChangeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FFF" },
    phoneRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, marginBottom: 6 },
    disconnectSection: { marginTop: 28, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20 },
    disconnectBtn: { borderRadius: 12, borderWidth: 1.5, borderColor: "#EF444450", backgroundColor: "#EF444408", paddingVertical: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 7 },
    disconnectText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#EF4444" },
    confirmBox: { backgroundColor: "#EF444410", borderRadius: 12, borderWidth: 1, borderColor: "#EF444430", padding: 14, marginTop: 10 },
    confirmMsg: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, marginBottom: 12, lineHeight: 20 },
    confirmRow: { flexDirection: "row", gap: 8 },
    confirmCancel: { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
    confirmCancelText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    confirmDel: { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: "#EF4444", alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 5 },
    confirmDelText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFF" },
    btn: { borderRadius: 14, overflow: "hidden", marginTop: 4 },
    btnGrad: { paddingVertical: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
    btnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" },
    infoBox: { backgroundColor: "#0EA5E910", borderRadius: 10, borderWidth: 1, borderColor: "#0EA5E930", padding: 12, marginBottom: 18 },
    infoText: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 18, marginBottom: 16 },
    pmCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
    pmCardSaved: { borderColor: colors.primary + "50" },
    pmCardLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 3 },
    pmCardDetail: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.primary },
    pmCardAdd: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, fontStyle: "italic" },
  });

  const initial = (profile?.displayName ?? mxcAddress ?? "?").slice(0, 2).toUpperCase();

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: "flex-end" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={s.overlay} onPress={onClose} />
        <View style={s.sheet}>
              <View style={s.handle} />
              <View style={s.header}>
                <Text style={s.title}>P2P Profile</Text>
                <TouchableOpacity style={s.closeBtn} onPress={onClose}>
                  <Icon name="close" size={16} color={colors.foreground} />
                </TouchableOpacity>
              </View>

              {/* Tabs */}
              <View style={s.tabBar}>
                {(["overview", "payment", "kyc"] as const).map(t => (
                  <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]} onPress={() => setTab(t)}>
                    <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                      {t === "overview" ? "Overview" : t === "payment" ? "Payment" : "KYC"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
                {tab === "payment" ? (
                  <>
                    <Text style={s.infoText}>Save your payment details for each method. Buyers will see them when placing orders.</Text>
                    {PM_LIST.map(pm => {
                      const saved = detailsByMethod.get(pm.id);
                      return (
                        <TouchableOpacity key={pm.id} style={[s.pmCard, saved && s.pmCardSaved]} onPress={() => setPmSheet({ method: pm.id })} activeOpacity={0.75}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.pmCardLabel}>{pm.label}</Text>
                            {saved
                              ? <Text style={s.pmCardDetail} numberOfLines={1}>{formatDetailsSingleLine(pm.id, saved.details)}</Text>
                              : <Text style={s.pmCardAdd}>Tap to add details</Text>}
                          </View>
                          <Icon name={saved ? "create-outline" : "add-circle-outline"} size={18} color={saved ? colors.primary : colors.mutedForeground} />
                        </TouchableOpacity>
                      );
                    })}
                  </>
                ) : tab === "overview" ? (
                  <>
                    <View style={s.avatarWrap}>
                      <Text style={s.avatarText}>{initial}</Text>
                    </View>
                    <Text style={s.nameText}>{profile?.displayName ?? "New Trader"}</Text>
                    <Text style={s.addrText}>{mxcAddress ? `${mxcAddress.slice(0, 12)}…${mxcAddress.slice(-6)}` : "—"}</Text>

                    {/* Badges row */}
                    {(profile?.kycStatus === "verified" || profile?.isMerchant || (profile?.completedTrades ?? 0) >= 10) && (
                      <View style={s.badgeRow}>
                        {profile?.kycStatus === "verified" && (
                          <View style={s.badgeKyc}><Text style={s.badgeKycText}>✓ KYC Verified</Text></View>
                        )}
                        {profile?.isMerchant && profile?.kycStatus === "verified" && (
                          <View style={s.badgeVerified}><Text style={s.badgeVerifiedText}>✦ Trusted Merchant</Text></View>
                        )}
                        {profile?.isMerchant && profile?.kycStatus !== "verified" && (
                          <View style={s.badgeMerchant}><Text style={s.badgeMerchantText}>Merchant</Text></View>
                        )}
                        {(profile?.completedTrades ?? 0) >= 500 && (
                          <View style={s.badgeVolume}><Text style={s.badgeVolumeText}>Platinum</Text></View>
                        )}
                        {(profile?.completedTrades ?? 0) >= 100 && (profile?.completedTrades ?? 0) < 500 && (
                          <View style={s.badgeVolume}><Text style={s.badgeVolumeText}>Gold</Text></View>
                        )}
                        {(profile?.completedTrades ?? 0) >= 50 && (profile?.completedTrades ?? 0) < 100 && (
                          <View style={s.badgeVolume}><Text style={s.badgeVolumeText}>Silver</Text></View>
                        )}
                        {(profile?.completedTrades ?? 0) >= 10 && (profile?.completedTrades ?? 0) < 50 && (
                          <View style={s.badgeVolume}><Text style={s.badgeVolumeText}>Bronze</Text></View>
                        )}
                      </View>
                    )}

                    <View style={s.statsRow}>
                      <View style={s.statBox}>
                        <Text style={s.statVal}>{profile?.completedTrades ?? 0}</Text>
                        <Text style={s.statLabel}>Trades</Text>
                      </View>
                      <View style={s.statBox}>
                        <Text style={s.statVal}>{completionRate}%</Text>
                        <Text style={s.statLabel}>Completion</Text>
                      </View>
                      <View style={s.statBox}>
                        <StarRating rating={parseFloat(profile?.avgRating ?? "0")} />
                        <Text style={s.statLabel}>Rating</Text>
                      </View>
                    </View>

                    <View style={s.kycCard}>
                      <Icon name={profile?.kycStatus === "verified" ? "checkmark-circle" : "shield-outline"} size={24} color={kycColor} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.kycLabel, { color: kycColor }]}>KYC {kycLabel}</Text>
                        <Text style={s.kycSub}>
                          {profile?.kycStatus === "verified" ? "Identity verified — builds trust with traders" :
                           profile?.kycStatus === "pending" ? "Your documents are under review" :
                           "Verify your identity to become a trusted trader"}
                        </Text>
                      </View>
                      {(!profile?.kycStatus || profile.kycStatus === "none" || profile.kycStatus === "rejected") && (
                        <TouchableOpacity onPress={() => setTab("kyc")}>
                          <Icon name="chevron-forward" size={16} color={colors.mutedForeground} />
                        </TouchableOpacity>
                      )}
                    </View>

                    <Text style={s.label}>DISPLAY NAME</Text>
                    <View style={[s.input, { justifyContent: "center", opacity: 0.7 }]} pointerEvents="none">
                      <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground }} selectable={false}>{displayName || "—"}</Text>
                    </View>
                    <Text style={[s.kycSub, { marginBottom: 14, marginTop: -8 }]}>Display name cannot be changed after registration</Text>

                    <Text style={s.label}>PHONE NUMBER</Text>
                    <View style={[s.input, { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "flex-start", opacity: 0.7 }]} pointerEvents="none">
                      <Icon name="phone-portrait-outline" size={16} color={colors.mutedForeground} />
                      <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground }} selectable={false}>{phone || "—"}</Text>
                    </View>
                    <Text style={[s.kycSub, { marginBottom: 14, marginTop: -8 }]}>Visible only to your trade counterparty after order is confirmed</Text>

                    <View style={s.disconnectSection}>
                      <TouchableOpacity
                        style={s.disconnectBtn}
                        onPress={() => setConfirmDisconnect(v => !v)}
                        activeOpacity={0.8}
                      >
                        <Icon name="unlink-outline" size={16} color="#EF4444" />
                        <Text style={s.disconnectText}>Disconnect from P2P</Text>
                      </TouchableOpacity>

                      {confirmDisconnect && (
                        <View style={s.confirmBox}>
                          <Text style={s.confirmMsg}>
                            This will delete your P2P profile and remove your trading history. You can reconnect any time using the same wallet address.
                          </Text>
                          <View style={s.confirmRow}>
                            <TouchableOpacity style={s.confirmCancel} onPress={() => setConfirmDisconnect(false)}>
                              <Text style={s.confirmCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[s.confirmDel, disconnecting && { opacity: 0.6 }]}
                              onPress={handleDisconnect}
                              disabled={disconnecting}
                            >
                              {disconnecting
                                ? <ActivityIndicator color="#FFF" size="small" />
                                : <><Icon name="trash-outline" size={14} color="#FFF" /><Text style={s.confirmDelText}>Yes, Disconnect</Text></>
                              }
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  </>
                ) : (
                  <>
                    <View style={s.infoBox}>
                      <Text style={s.infoText}>KYC verification increases your trading limits and builds trust. Your data is stored securely and used only for identity verification purposes.</Text>
                    </View>

                    <Text style={s.label}>DISPLAY NAME</Text>
                    <TextInput style={s.input} value={displayName} onChangeText={setDisplayName} placeholder="Name shown to traders" placeholderTextColor={colors.mutedForeground} />

                    <Text style={s.label}>LEGAL FULL NAME (as on document)</Text>
                    <TextInput style={s.input} value={kycName} onChangeText={setKycName} placeholder="First and last name" placeholderTextColor={colors.mutedForeground} />

                    <Text style={s.label}>DOCUMENT TYPE</Text>
                    <View style={s.docGrid}>
                      {KYC_DOCS.map(d => (
                        <TouchableOpacity key={d.id} style={[s.docChip, kycDoc === d.id && s.docChipActive]} onPress={() => setKycDoc(d.id)}>
                          <Text style={[s.docText, kycDoc === d.id && s.docTextActive]}>{d.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Text style={s.label}>DOCUMENT PHOTO</Text>
                    <TouchableOpacity style={[s.uploadBtn, kycDocTooLarge && { borderColor: "#EF4444" }]} onPress={pickDocument} activeOpacity={0.8}>
                      {kycDocImage ? (
                        <Image source={{ uri: kycDocImage }} style={s.docPreview} contentFit="cover" />
                      ) : (
                        <View style={s.uploadPlaceholder}>
                          <Icon name="cloud-upload-outline" size={28} color={colors.primary} />
                          <Text style={s.uploadText}>Tap to upload photo of document</Text>
                          <Text style={s.uploadHint}>Clear front side, good lighting</Text>
                        </View>
                      )}
                      {kycDocImage && (
                        <View style={s.uploadOverlay}>
                          <Icon name="camera-outline" size={16} color="#FFF" />
                          <Text style={s.uploadChangeText}>Change</Text>
                        </View>
                      )}
                    </TouchableOpacity>

                    {kycDocTooLarge && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: -12, marginBottom: 14 }}>
                        <Icon name="alert-circle-outline" size={14} color="#EF4444" />
                        <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "#EF4444" }}>
                          File is too large — maximum allowed size is 10 MB. Please choose a smaller image.
                        </Text>
                      </View>
                    )}

                    <TouchableOpacity style={[s.btn, (loading || kycDocTooLarge) && { opacity: 0.4 }]} onPress={handleSubmitKyc} disabled={loading || kycDocTooLarge} activeOpacity={0.85}>
                      <View  style={s.btnGrad}>
                        {loading ? <ActivityIndicator color="#FFF" /> : <><Icon name="shield-checkmark-outline" size={16} color="#FFF" /><Text style={s.btnText}>Submit for Verification</Text></>}
                      </View>
                    </TouchableOpacity>
                  </>
                )}
              </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <Toast message={toast} visible={!!toast} onHide={() => setToast("")} />
      {pmSheet && (
        <PaymentDetailSheet
          visible={!!pmSheet}
          onClose={() => setPmSheet(null)}
          onSaved={() => { void refetchPaymentDetails(); setPmSheet(null); }}
          onDeleted={() => { void refetchPaymentDetails(); setPmSheet(null); }}
          ownerAddress={mxcAddress ?? ""}
          paymentMethod={pmSheet.method}
          existing={detailsByMethod.get(pmSheet.method)}
        />
      )}
    </Modal>
  );
}
