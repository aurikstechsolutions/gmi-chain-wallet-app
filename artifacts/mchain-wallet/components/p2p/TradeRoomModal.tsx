import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { RatingModal } from "@/components/p2p/RatingModal";
import { useWallet } from "@/context/WalletContext";
import { usePinContext } from "@/context/PinContext";
import { useColors } from "@/hooks/useColors";
import { p2pApi, type P2pDispute, type P2pMessage, type P2pOrder, type EscrowInfo } from "@/services/p2pApi";
import { api } from "@/services/api";
import { mcToWei } from "@/services/crypto";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B", paid: "#0EA5E9", released: "#10B981",
  cancelled: "#6B7280", disputed: "#EF4444", resolved: "#8B5CF6",
};

const DISPUTE_REASONS = [
  { id: "payment_not_received", label: "Payment not received" },
  { id: "payment_received_but_not_released", label: "Paid but crypto not released" },
  { id: "wrong_amount", label: "Wrong amount received" },
  { id: "other", label: "Other" },
];

function Countdown({ deadline }: { deadline: string }) {
  const colors = useColors();
  const [secs, setSecs] = useState(() => Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const id = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const mins = Math.floor(secs / 60);
  const s2 = secs % 60;
  const isUrgent = secs < 120;
  return (
    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: isUrgent ? "#EF4444" : colors.mutedForeground }}>
      {secs === 0 ? "Expired" : `${mins}:${s2.toString().padStart(2, "0")} remaining`}
    </Text>
  );
}

interface Props {
  visible: boolean;
  orderId: string;
  onClose: () => void;
}

export function TradeRoomModal({ visible, orderId, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { mxcAddress, getPrivateKey } = useWallet();
  const { requestPin } = usePinContext();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);

  const [msgText, setMsgText] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState("payment_not_received");
  const [disputeDesc, setDisputeDesc] = useState("");
  const [toast, setToast] = useState("");
  const [usdtTxHash, setUsdtTxHash] = useState("");
  const [showUsdtEscrow, setShowUsdtEscrow] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [ratingDone, setRatingDone] = useState(false);

  const { data: order, isLoading: orderLoading } = useQuery({
    queryKey: ["p2p_order", orderId],
    queryFn: () => p2pApi.getOrder(orderId),
    enabled: visible,
    refetchInterval: 5_000,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["p2p_messages", orderId],
    queryFn: () => p2pApi.getMessages(orderId),
    enabled: visible,
    refetchInterval: 4_000,
  });

  const { data: dispute } = useQuery({
    queryKey: ["p2p_dispute", orderId],
    queryFn: () => p2pApi.getDispute(orderId),
    enabled: visible && order?.status === "disputed",
    retry: false,
  });

  const { data: escrowInfo } = useQuery({
    queryKey: ["p2p_escrow_info"],
    queryFn: () => p2pApi.getEscrowInfo(),
    enabled: visible,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (messages.length > 0) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  const isBuyer = order?.buyerAddress === mxcAddress;
  const isSeller = order?.sellerAddress === mxcAddress;
  const escrowStatus = order?.escrowStatus ?? "none";
  const escrowLocked = escrowStatus === "locked";

  const canSend = !!(msgText.trim() || pendingImage);

  const sendMsg = useMutation({
    mutationFn: () => p2pApi.sendMessage(orderId, {
      senderAddress: mxcAddress!,
      ...(msgText.trim() ? { content: msgText.trim() } : {}),
      ...(pendingImage ? { imageUrl: pendingImage } : {}),
    }),
    onSuccess: () => {
      setMsgText("");
      setPendingImage(null);
      queryClient.invalidateQueries({ queryKey: ["p2p_messages", orderId] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Failed to send"),
  });

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setToast("Photo library permission is required to send images");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
      allowsEditing: true,
      exif: false,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      if (asset.base64) {
        // Guard: reject if base64 > 1.5 MB (≈ 2 MB encoded)
        const MAX_BASE64_BYTES = 1.5 * 1024 * 1024;
        if (asset.base64.length > MAX_BASE64_BYTES) {
          setToast("Image is too large. Please choose a smaller photo (max ~1.5 MB).");
          return;
        }
        const mime = asset.mimeType ?? "image/jpeg";
        setPendingImage(`data:${mime};base64,${asset.base64}`);
      }
    }
  }

  const markPaid = useMutation({
    mutationFn: () => p2pApi.markPaid(orderId, mxcAddress!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["p2p_order", orderId] }); if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
    onError: (e) => setToast(e instanceof Error ? e.message : "Failed"),
  });

  const release = useMutation({
    mutationFn: () => p2pApi.confirmRelease(orderId, mxcAddress!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["p2p_order", orderId] }); queryClient.invalidateQueries({ queryKey: ["p2p_my_orders"] }); if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
    onError: (e) => setToast(e instanceof Error ? e.message : "Failed"),
  });

  const cancelOrder = useMutation({
    mutationFn: () => p2pApi.cancelOrder(orderId, mxcAddress!, "Cancelled by user"),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["p2p_order", orderId] }); queryClient.invalidateQueries({ queryKey: ["p2p_my_orders"] }); },
    onError: (e) => setToast(e instanceof Error ? e.message : "Failed"),
  });

  const openDispute = useMutation({
    mutationFn: () => p2pApi.openDispute(orderId, { openedBy: mxcAddress!, reason: disputeReason, description: disputeDesc }),
    onSuccess: () => { setShowDispute(false); queryClient.invalidateQueries({ queryKey: ["p2p_order", orderId] }); if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); },
    onError: (e) => setToast(e instanceof Error ? e.message : "Failed to open dispute"),
  });

  const lockEscrowMc = useMutation({
    mutationFn: async () => {
      if (!mxcAddress || !order) throw new Error("No wallet or order");
      if (!escrowInfo?.escrowAddress) throw new Error("Escrow not configured — contact admin");

      const { nonce } = await api.getAccount(mxcAddress);
      const amountWei = mcToWei(order.cryptoAmount);
      const privateKey = await getPrivateKey();
      if (!privateKey) throw new Error("Could not retrieve private key — please unlock your wallet and retry");
      const result = await api.sendTransaction({
        fromAddress: mxcAddress,
        toAddress: escrowInfo.escrowAddress,
        amount: amountWei,
        nonce,
        privateKey,
      });
      await api.waitForReceipt(result.txHash);
      await p2pApi.lockEscrow(orderId, mxcAddress, result.txHash);
      return result.txHash;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["p2p_order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["p2p_messages", orderId] });
      setToast("Funds locked in escrow ✓");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e) => {
      let msg = e instanceof Error ? e.message : "Failed to lock escrow";
      if (/account not found|not found on this chain/i.test(msg))
        msg = "Insufficient balance — wallet has no funds on this network. Top up before locking escrow.";
      else if (/insufficient/i.test(msg))
        msg = "Insufficient balance to cover amount + network fee.";
      setToast(msg);
    },
  });

  const lockEscrowUsdt = useMutation({
    mutationFn: async () => {
      if (!mxcAddress || !usdtTxHash.trim()) throw new Error("Enter your transaction hash");
      await p2pApi.lockEscrow(orderId, mxcAddress, usdtTxHash.trim());
    },
    onSuccess: () => {
      setShowUsdtEscrow(false);
      setUsdtTxHash("");
      queryClient.invalidateQueries({ queryKey: ["p2p_order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["p2p_messages", orderId] });
      setToast("Escrow lock recorded ✓");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Failed"),
  });

  function handleRelease() {
    const onChain = order?.token === "MC" && escrowLocked && escrowInfo?.configured;
    const msg = onChain
      ? `The platform will automatically broadcast a transfer of ${order?.cryptoAmount} GMI from escrow to the buyer's wallet.`
      : order?.token === "USDT" && escrowLocked
      ? `USDT release will be processed by the platform admin within 24 hours after you confirm.`
      : `Confirm you have received payment and want to release ${order?.cryptoAmount} ${order?.token} to the buyer.`;

    void requestPin({
      title: "Confirm Release",
      subtitle: "Enter your PIN to release crypto to the buyer.",
      onSuccess: () => {
        Alert.alert("Release Crypto", msg,
          [{ text: "Cancel", style: "cancel" }, { text: "Release", style: "destructive", onPress: () => release.mutate() }]
        );
      },
      onCancel: () => {},
    });
  }

  function handleCancel() {
    Alert.alert("Cancel Order", "Are you sure you want to cancel this order?",
      [{ text: "No" }, { text: "Cancel Order", style: "destructive", onPress: () => cancelOrder.mutate() }]
    );
  }

  function handleLockEscrow() {
    if (!order) return;
    if (order.token === "MC") {
      Alert.alert(
        "Lock Funds in Escrow",
        `This will send ${order.cryptoAmount} GMI from your wallet to the platform escrow address. The funds will be released to the buyer once you confirm receipt of payment.`,
        [{ text: "Cancel", style: "cancel" }, { text: "Lock Now", onPress: () => lockEscrowMc.mutate() }]
      );
    } else {
      setShowUsdtEscrow(true);
    }
  }

  const isTerminal = ["released", "cancelled", "resolved"].includes(order?.status ?? "");

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: "96%" },
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    headerLeft: { flex: 1 },
    title: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.foreground },
    subtitle: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 1 },
    closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, marginRight: 10 },
    statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
    orderCard: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, margin: 14, padding: 12 },
    orderRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
    orderLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    orderVal: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    orderAmount: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.primary, marginBottom: 4 },
    escrowBadge: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
    escrowBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
    chat: { flex: 1, paddingHorizontal: 14 },
    msgWrap: { marginBottom: 8, maxWidth: "80%" },
    msgBubble: { borderRadius: 14, padding: 10 },
    myBubble: { backgroundColor: colors.primary + "20", borderBottomRightRadius: 4 },
    theirBubble: { backgroundColor: colors.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
    systemBubble: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, marginVertical: 6 },
    msgText: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, lineHeight: 18 },
    systemText: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center" },
    msgTime: { fontSize: 9, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 3 },
    msgImage: { width: 200, height: 200, borderRadius: 10, marginBottom: 4 },
    pendingImageWrap: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 2 },
    pendingImageRow: { position: "relative", alignSelf: "flex-start" },
    pendingImg: { width: 80, height: 80, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
    pendingRemove: { position: "absolute", top: -8, right: -8, width: 22, height: 22, borderRadius: 11, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center" },
    inputRow: { flexDirection: "row", alignItems: "center", padding: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 8, paddingBottom: insets.bottom + 10 },
    imgBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
    msgInput: { flex: 1, backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground, maxHeight: 100 },
    sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
    actionBar: { paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
    actionRow: { flexDirection: "row", gap: 8 },
    actionBtn: { flex: 1, borderRadius: 12, overflow: "hidden" },
    actionGrad: { paddingVertical: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
    actionText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFF" },
    ghostBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
    ghostText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    lockBtn: { borderRadius: 12, overflow: "hidden", marginBottom: 6 },
    lockGrad: { paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
    lockText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFF" },
    escrowBanner: { marginHorizontal: 14, marginBottom: 0, borderRadius: 10, borderWidth: 1, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 },
    escrowBannerText: { fontSize: 12, fontFamily: "Inter_600SemiBold", flex: 1, lineHeight: 17 },
    disputeSheet: { backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 16 },
    disputeTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#EF4444", marginBottom: 14 },
    disputeLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2, marginBottom: 8 },
    reasonChip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card, marginBottom: 8 },
    reasonChipActive: { borderColor: "#EF4444", backgroundColor: "#EF444415" },
    reasonText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    reasonTextActive: { color: "#EF4444", fontFamily: "Inter_600SemiBold" },
    disputeInput: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, minHeight: 80, textAlignVertical: "top", marginBottom: 14 },
    disputeBtn: { borderRadius: 12, overflow: "hidden" },
    disputeGrad: { paddingVertical: 14, alignItems: "center" },
    disputeBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFF" },
    usdtSheet: { backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 16 },
    usdtTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 6 },
    usdtDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 20, marginBottom: 16 },
    usdtAddrBox: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 14 },
    usdtAddrLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1, marginBottom: 4 },
    usdtAddr: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.foreground },
    usdtInput: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, marginBottom: 14 },
    lightboxOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", alignItems: "center", justifyContent: "center" },
    lightboxImg: { width: "95%", height: "80%", resizeMode: "contain" },
    lightboxClose: { position: "absolute", top: 50, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  });

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.handle} />

            {/* Header */}
            <View style={s.header}>
              <View style={s.headerLeft}>
                {order ? (
                  <>
                    <Text style={s.title}>{isBuyer ? "Buying" : "Selling"} {order.cryptoAmount} {order.token}</Text>
                    <Text style={s.subtitle}>≈ {parseFloat(order.fiatAmount).toFixed(2)} USDT via {order.paymentMethod.replace(/_/g, " ")}</Text>
                  </>
                ) : <Text style={s.title}>Loading…</Text>}
              </View>
              {order && (
                <View style={[s.statusBadge, { backgroundColor: (STATUS_COLORS[order.status] ?? "#888") + "15", borderColor: (STATUS_COLORS[order.status] ?? "#888") + "40" }]}>
                  <Text style={[s.statusText, { color: STATUS_COLORS[order.status] ?? "#888" }]}>{order.status.toUpperCase()}</Text>
                </View>
              )}
              <TouchableOpacity style={s.closeBtn} onPress={onClose}>
                <Icon name="close" size={16} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            {/* Order info strip */}
            {order && (
              <View style={s.orderCard}>
                <Text style={s.orderAmount}>{parseFloat(order.cryptoAmount).toFixed(4)} {order.token}</Text>
                <View style={s.orderRow}>
                  <Text style={s.orderLabel}>Price</Text>
                  <Text style={s.orderVal}>{parseFloat(order.price).toFixed(4)} USDT</Text>
                </View>
                <View style={s.orderRow}>
                  <Text style={s.orderLabel}>Counterparty</Text>
                  <Text style={s.orderVal}>{(isBuyer ? order.sellerAddress : order.buyerAddress).slice(0, 10)}…</Text>
                </View>
                {order.status === "pending" && isBuyer && (
                  <View style={s.orderRow}>
                    <Text style={s.orderLabel}>Time remaining</Text>
                    <Countdown deadline={order.paymentDeadline} />
                  </View>
                )}

                {/* Escrow status */}
                {escrowStatus === "none" && isSeller && !isTerminal && (
                  <View style={[s.escrowBadge, { backgroundColor: "#F59E0B10", borderColor: "#F59E0B30" }]}>
                    <Icon name="alert-triangle" size={13} color="#F59E0B" />
                    <Text style={[s.escrowBadgeText, { color: "#F59E0B" }]}>Escrow not locked — buyer funds not protected yet</Text>
                  </View>
                )}
                {escrowStatus === "locked" && (
                  <View style={[s.escrowBadge, { backgroundColor: "#10B98115", borderColor: "#10B98140" }]}>
                    <Icon name="shield-checkmark-outline" size={13} color="#10B981" />
                    <Text style={[s.escrowBadgeText, { color: "#10B981" }]}>
                      {order.cryptoAmount} {order.token} locked in escrow ✓ {isBuyer ? "— Safe to pay!" : ""}
                    </Text>
                  </View>
                )}
                {escrowStatus === "released" && (
                  <View style={[s.escrowBadge, { backgroundColor: "#0EA5E915", borderColor: "#0EA5E940" }]}>
                    <Icon name="checkmark-circle-outline" size={13} color="#0EA5E9" />
                    <Text style={[s.escrowBadgeText, { color: "#0EA5E9" }]}>Escrow released to buyer on-chain</Text>
                  </View>
                )}
              </View>
            )}

            {/* Escrow banner for buyer (when not locked) */}
            {order && isBuyer && escrowStatus === "none" && !isTerminal && (
              <View style={[s.escrowBanner, { backgroundColor: "#F59E0B08", borderColor: "#F59E0B25", marginBottom: 0 }]}>
                <Icon name="alert-triangle" size={14} color="#F59E0B" />
                <Text style={[s.escrowBannerText, { color: "#F59E0B" }]}>
                  Waiting for seller to lock funds in escrow before you pay
                </Text>
              </View>
            )}

            {/* Chat */}
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={100}>
              <ScrollView ref={scrollRef} style={s.chat} contentContainerStyle={{ paddingTop: 10, paddingBottom: 10 }}>
                {messages.map((msg) => {
                  const isMe = msg.senderAddress === mxcAddress;
                  if (msg.isSystem) return (
                    <View key={msg.id} style={s.systemBubble}>
                      <Text style={s.systemText}>{msg.content}</Text>
                    </View>
                  );
                  return (
                    <View key={msg.id} style={[s.msgWrap, { alignSelf: isMe ? "flex-end" : "flex-start" }]}>
                      <View style={[s.msgBubble, isMe ? s.myBubble : s.theirBubble]}>
                        {msg.imageUrl ? (
                          <TouchableOpacity onPress={() => setLightboxImage(msg.imageUrl!)}>
                            <Image source={{ uri: msg.imageUrl }} style={s.msgImage} resizeMode="cover" />
                          </TouchableOpacity>
                        ) : null}
                        {msg.content ? <Text style={s.msgText}>{msg.content}</Text> : null}
                      </View>
                      <Text style={[s.msgTime, { textAlign: isMe ? "right" : "left" }]}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>

              {/* Action bar */}
              {!isTerminal && order && (
                <View style={s.actionBar}>
                  {/* Seller: Lock escrow first */}
                  {isSeller && order.status === "pending" && escrowStatus === "none" && (
                    <>
                      <TouchableOpacity style={[s.lockBtn, (lockEscrowMc.isPending) && { opacity: 0.6 }]} onPress={handleLockEscrow} activeOpacity={0.85} disabled={lockEscrowMc.isPending}>
                        <View  style={s.lockGrad}>
                          {lockEscrowMc.isPending
                            ? <ActivityIndicator color="#FFF" size="small" />
                            : <><Icon name="lock-closed-outline" size={15} color="#FFF" /><Text style={s.lockText}>Lock {order.cryptoAmount} {order.token} in Escrow</Text></>}
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.ghostBtn} onPress={handleCancel}>
                        <Text style={s.ghostText}>Cancel Order</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {/* Seller: Escrow locked, waiting for buyer */}
                  {isSeller && order.status === "pending" && escrowStatus === "locked" && (
                    <View style={[s.escrowBanner, { borderColor: "#10B98130", backgroundColor: "#10B98108", marginHorizontal: 0 }]}>
                      <Icon name="shield-checkmark-outline" size={14} color="#10B981" />
                      <Text style={[s.escrowBannerText, { color: "#10B981" }]}>Funds locked — waiting for buyer to send payment</Text>
                    </View>
                  )}

                  {/* Buyer: Mark paid */}
                  {isBuyer && order.status === "pending" && (
                    <View style={s.actionRow}>
                      <TouchableOpacity style={s.actionBtn} onPress={() => markPaid.mutate()} activeOpacity={0.85} disabled={markPaid.isPending}>
                        <View  style={s.actionGrad}>
                          {markPaid.isPending
                            ? <ActivityIndicator color="#FFF" size="small" />
                            : <><Icon name="checkmark-circle-outline" size={15} color="#FFF" /><Text style={s.actionText}>I've Sent Payment</Text></>}
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.ghostBtn} onPress={handleCancel} disabled={cancelOrder.isPending}>
                        <Text style={s.ghostText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Seller: Release */}
                  {isSeller && order.status === "paid" && (
                    <View style={s.actionRow}>
                      <TouchableOpacity style={s.actionBtn} onPress={handleRelease} activeOpacity={0.85} disabled={release.isPending}>
                        <View  style={s.actionGrad}>
                          {release.isPending
                            ? <ActivityIndicator color="#FFF" size="small" />
                            : <><Icon name="arrow-up-circle-outline" size={15} color="#FFF" /><Text style={s.actionText}>Release Crypto</Text></>}
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.ghostBtn, { borderColor: "#EF444440" }]} onPress={() => setShowDispute(true)}>
                        <Text style={[s.ghostText, { color: "#EF4444" }]}>Dispute</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Buyer: In paid state */}
                  {isBuyer && order.status === "paid" && (
                    <View style={[s.escrowBanner, { borderColor: "#0EA5E930", backgroundColor: "#0EA5E908", marginHorizontal: 0 }]}>
                      <Icon name="time-outline" size={14} color="#0EA5E9" />
                      <Text style={[s.escrowBannerText, { color: "#0EA5E9" }]}>Payment marked — waiting for seller to release crypto</Text>
                    </View>
                  )}

                  {/* Dispute button for buyer in paid state */}
                  {isBuyer && order.status === "paid" && (
                    <TouchableOpacity style={[s.ghostBtn, { borderColor: "#EF444440", width: "100%" }]} onPress={() => setShowDispute(true)}>
                      <Text style={[s.ghostText, { color: "#EF4444" }]}>Open Dispute</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Pending image preview */}
              {pendingImage && (
                <View style={s.pendingImageWrap}>
                  <View style={s.pendingImageRow}>
                    <Image source={{ uri: pendingImage }} style={s.pendingImg} />
                    <TouchableOpacity style={s.pendingRemove} onPress={() => setPendingImage(null)}>
                      <Icon name="close" size={12} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Dispute outcome banner — shown when resolved */}
              {isTerminal && order?.status === "resolved" && order.disputeResolvedFor && (() => {
                const won = (isBuyer && order.disputeResolvedFor === "buyer") ||
                            (isSeller && order.disputeResolvedFor === "seller");
                const colour = won ? "#10B981" : "#EF4444";
                const icon   = won ? "checkmark-circle-outline" : "close-circle-outline";
                const msg    = won
                  ? "Dispute resolved in your favour"
                  : "Dispute was not resolved in your favour";
                return (
                  <View style={[s.actionBar, { borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <View style={{
                      flexDirection: "row", alignItems: "center", gap: 10,
                      backgroundColor: colour + "12", borderRadius: 12,
                      borderWidth: 1, borderColor: colour + "30",
                      paddingHorizontal: 14, paddingVertical: 12, width: "100%",
                    }}>
                      <Icon name={icon} size={20} color={colour} />
                      <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colour, flex: 1 }}>
                        {msg}
                      </Text>
                    </View>
                  </View>
                );
              })()}

              {/* Rate Trade — shown on completed orders */}
              {isTerminal && order?.status === "released" && !ratingDone && (
                <View style={[s.actionBar, { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => setShowRating(true)}
                    activeOpacity={0.85}
                  >
                    <View  style={s.actionGrad}>
                      <Icon name="star-outline" size={15} color="#FFF" />
                      <Text style={s.actionText}>Rate this Trade</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              )}

              {/* Message input */}
              {!isTerminal && (
                <View style={s.inputRow}>
                  <TouchableOpacity style={s.imgBtn} onPress={pickImage} activeOpacity={0.75}>
                    <Icon name="image-outline" size={20} color={colors.mutedForeground} />
                  </TouchableOpacity>
                  <TextInput
                    style={s.msgInput}
                    placeholder="Message…"
                    placeholderTextColor={colors.mutedForeground}
                    value={msgText}
                    onChangeText={setMsgText}
                    multiline
                    returnKeyType="send"
                    onSubmitEditing={() => canSend && sendMsg.mutate()}
                  />
                  <TouchableOpacity
                    style={[s.sendBtn, (!canSend || sendMsg.isPending) && { opacity: 0.5 }]}
                    onPress={() => canSend && sendMsg.mutate()}
                    disabled={!canSend || sendMsg.isPending}
                    activeOpacity={0.8}
                  >
                    {sendMsg.isPending
                      ? <ActivityIndicator color="#FFF" size="small" />
                      : <Icon name="send" size={16} color="#FFF" />}
                  </TouchableOpacity>
                </View>
              )}
            </KeyboardAvoidingView>
          </View>
        </View>
      </Modal>

      {/* Fullscreen image lightbox */}
      <Modal visible={!!lightboxImage} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setLightboxImage(null)}>
        <Pressable style={s.lightboxOverlay} onPress={() => setLightboxImage(null)}>
          {lightboxImage && (
            <Image source={{ uri: lightboxImage }} style={s.lightboxImg} />
          )}
          <TouchableOpacity style={s.lightboxClose} onPress={() => setLightboxImage(null)}>
            <Icon name="close" size={20} color="#FFF" />
          </TouchableOpacity>
        </Pressable>
      </Modal>

      {/* Dispute sheet */}
      <Modal visible={showDispute} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setShowDispute(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={() => setShowDispute(false)} />
        <View style={s.disputeSheet}>
          <Text style={s.disputeTitle}>Open Dispute</Text>
          <Text style={s.disputeLabel}>REASON</Text>
          {DISPUTE_REASONS.map(r => (
            <TouchableOpacity key={r.id} style={[s.reasonChip, disputeReason === r.id && s.reasonChipActive]} onPress={() => setDisputeReason(r.id)}>
              <Text style={[s.reasonText, disputeReason === r.id && s.reasonTextActive]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
          <Text style={[s.disputeLabel, { marginTop: 12 }]}>DESCRIPTION</Text>
          <TextInput
            style={s.disputeInput}
            placeholder="Describe the issue in detail…"
            placeholderTextColor={colors.mutedForeground}
            value={disputeDesc}
            onChangeText={setDisputeDesc}
            multiline
          />
          <TouchableOpacity style={[s.disputeBtn, openDispute.isPending && { opacity: 0.6 }]} onPress={() => disputeDesc.trim().length >= 10 && openDispute.mutate()} disabled={openDispute.isPending || disputeDesc.trim().length < 10} activeOpacity={0.85}>
            <View  style={s.disputeGrad}>
              {openDispute.isPending ? <ActivityIndicator color="#FFF" /> : <Text style={s.disputeBtnText}>Submit Dispute</Text>}
            </View>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* USDT escrow sheet */}
      <Modal visible={showUsdtEscrow} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setShowUsdtEscrow(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={() => setShowUsdtEscrow(false)} />
        <View style={s.usdtSheet}>
          <Text style={s.usdtTitle}>Lock USDT in Escrow</Text>
          <Text style={s.usdtDesc}>
            Send exactly <Text style={{ fontFamily: "Inter_700Bold", color: colors.foreground }}>{order?.cryptoAmount} USDT</Text> to the escrow address below, then paste your transaction hash to confirm the lock.
          </Text>
          {escrowInfo?.escrowAddress && (
            <View style={s.usdtAddrBox}>
              <Text style={s.usdtAddrLabel}>ESCROW ADDRESS</Text>
              <Text style={s.usdtAddr} selectable>{escrowInfo.escrowAddress}</Text>
            </View>
          )}
          <TextInput
            style={s.usdtInput}
            placeholder="Paste your tx hash here…"
            placeholderTextColor={colors.mutedForeground}
            value={usdtTxHash}
            onChangeText={setUsdtTxHash}
            autoCapitalize="none"
          />
          <TouchableOpacity style={[s.disputeBtn, lockEscrowUsdt.isPending && { opacity: 0.6 }]} onPress={() => lockEscrowUsdt.mutate()} disabled={lockEscrowUsdt.isPending || !usdtTxHash.trim()} activeOpacity={0.85}>
            <View  style={s.disputeGrad}>
              {lockEscrowUsdt.isPending ? <ActivityIndicator color="#FFF" /> : <Text style={s.disputeBtnText}>Confirm Escrow Lock</Text>}
            </View>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Rating modal */}
      {order && (
        <RatingModal
          visible={showRating}
          orderId={orderId}
          raterAddress={mxcAddress!}
          ratedAddress={isBuyer ? order.sellerAddress : order.buyerAddress}
          counterpartyName={(isBuyer ? order.sellerAddress : order.buyerAddress).slice(0, 10) + "…"}
          onClose={() => setShowRating(false)}
          onDone={() => { setShowRating(false); setRatingDone(true); setToast("Rating submitted — thank you!"); }}
        />
      )}

      <Toast visible={!!toast} message={toast} onHide={() => setToast("")} />
    </>
  );
}
