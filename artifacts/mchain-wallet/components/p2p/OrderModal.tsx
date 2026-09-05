import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { useWallet } from "@/context/WalletContext";
import { usePinContext } from "@/context/PinContext";
import { useColors } from "@/hooks/useColors";
import { p2pApi, type P2pAd } from "@/services/p2pApi";
import { METHOD_FIELDS, METHOD_LABELS } from "@/services/paymentMethods";
import { api } from "@/services/api";
import {
  mcToWei, buildErc20TransferDataHex, mxcAddressToEthAddress,
} from "@/services/crypto";
import * as Haptics from "expo-haptics";

import React, { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  visible: boolean;
  ad: P2pAd;
  onClose: () => void;
  onOrderPlaced: () => void;
}

type Step = "idle" | "signing" | "broadcasting" | "confirming" | "placing";

const STEP_LABELS: Record<Step, string> = {
  idle:        "",
  signing:     "Signing transaction…",
  broadcasting:"Broadcasting to chain…",
  confirming:  "Waiting for 2 confirmations…",
  placing:     "Placing order…",
};

export function OrderModal({ visible, ad, onClose, onOrderPlaced }: Props) {
  const colors    = useColors();
  const insets    = useSafeAreaInsets();
  const { mxcAddress, ethAddress, getPrivateKey } = useWallet();
  const { requestPin } = usePinContext();

  const [amount,         setAmount]         = useState("");
  const [selectedPm,     setSelectedPm]     = useState(ad.paymentMethods[0] ?? "");
  const [paymentDetails, setPaymentDetails] = useState("");
  const [step,           setStep]           = useState<Step>("idle");
  const [toast,          setToast]          = useState("");
  const submittingRef = useRef(false);

  const loading = step !== "idle";

  const price      = parseFloat(ad.price);
  const cryptoAmt  = parseFloat(amount) || 0;
  const fiatAmt    = (cryptoAmt * price).toFixed(2);
  const min        = parseFloat(ad.minAmount);
  const max        = parseFloat(ad.maxAmount);
  const available  = parseFloat(ad.availableAmount);

  // isBuyOrder: the user is BUYING (responding to a SELL ad, ad.side === "sell")
  // isSellOrder: the user is SELLING (responding to a BUY ad, ad.side === "buy")
  const isBuyOrder  = ad.side === "sell";
  const isSellOrder = ad.side === "buy";

  // Seller's payment details (shown when user is buying)
  const { data: sellerDetailRows } = useQuery({
    queryKey: ["seller-payment-detail", ad.ownerAddress, selectedPm],
    queryFn: () => p2pApi.getPaymentDetailForMethod(ad.ownerAddress, selectedPm),
    enabled: !!selectedPm && !!ad.ownerAddress && isBuyOrder,
    staleTime: 30000,
  });
  const sellerDetail = sellerDetailRows?.[0];

  // User's own wallet balance (shown when selling)
  const { data: walletBalance } = useQuery({
    queryKey: ["wallet-balance", ethAddress],
    queryFn: () => p2pApi.getWalletBalance(ethAddress!),
    enabled: !!ethAddress && visible && isSellOrder,
    staleTime: 15000,
  });
  const myBalance = isSellOrder
    ? (ad.token === "USDT"
        ? parseFloat(walletBalance?.usdt ?? "0")
        : parseFloat(walletBalance?.mc  ?? "0"))
    : 0;

  // ── Validation ────────────────────────────────────────────────────────────
  function validateInput(): string | null {
    if (!amount || cryptoAmt <= 0) return "Enter an amount";
    if (cryptoAmt < min)           return `Minimum is ${min} ${ad.token}`;
    if (cryptoAmt > max)           return `Maximum is ${max} ${ad.token}`;
    if (cryptoAmt > available)     return `Only ${available} ${ad.token} available`;
    if (!selectedPm)               return "Select a payment method";
    if (isSellOrder && walletBalance && cryptoAmt > myBalance)
      return `Insufficient balance. You have ${myBalance.toFixed(4)} ${ad.token}`;
    return null;
  }

  // ── Escrow lock + place order (SELL side — responding to a BUY ad) ────────
  async function doEscrowAndPlace() {
    if (!mxcAddress || submittingRef.current) return;
    submittingRef.current = true;
    try {
      const escrowInfo = await p2pApi.getEscrowInfo();
      if (!escrowInfo.configured || !escrowInfo.escrowAddress) {
        setToast("Escrow wallet not configured — contact admin"); setStep("idle"); return;
      }

      setStep("signing");
      const privateKey = await getPrivateKey();
      if (!privateKey) {
        setToast("Could not retrieve private key — please unlock your wallet and retry");
        setStep("idle"); return;
      }
      const { nonce } = await api.getAccount(mxcAddress);

      let result: { txHash: string };
      if (ad.token === "MC") {
        const amountWei = mcToWei(amount);
        setStep("broadcasting");
        result = await api.sendTransaction({
          fromAddress: mxcAddress,
          toAddress: escrowInfo.escrowAddress,
          amount: amountWei,
          nonce,
          privateKey,
        });
      } else {
        if (!escrowInfo.usdtContractAddress) {
          setToast("USDT contract not configured — contact admin"); setStep("idle"); return;
        }
        const raw = BigInt(Math.round(parseFloat(amount) * 1_000_000));
        const data = buildErc20TransferDataHex(escrowInfo.escrowAddress, raw);
        const contractAddr = escrowInfo.usdtContractAddress.toLowerCase().startsWith("0x")
          ? escrowInfo.usdtContractAddress
          : mxcAddressToEthAddress(escrowInfo.usdtContractAddress);
        setStep("broadcasting");
        result = await api.sendTransaction({
          fromAddress: ethAddress!,
          toAddress: contractAddr,
          amount: "0",
          data,
          txType: "contract_call",
          nonce,
          privateKey,
        });
      }
      const escrowTxHash = result.txHash;

      setStep("confirming");
      await api.waitForReceipt(escrowTxHash);

      // Place the order with the escrow lock
      setStep("placing");
      await p2pApi.createOrder({
        adId: ad.id,
        buyerAddress: mxcAddress,
        cryptoAmount: amount,
        paymentMethod: selectedPm,
        paymentDetails: paymentDetails || undefined,
        escrowTxHash,
      });

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onOrderPlaced();
    } catch (e) {
      let msg = e instanceof Error ? e.message : "Failed to place order";
      if (/insufficient/i.test(msg))  msg = "Insufficient balance to cover amount + network fee";
      if (/account not found/i.test(msg)) msg = "Wallet has no on-chain funds. Top up before selling.";
      setToast(msg);
      setStep("idle");
    } finally {
      submittingRef.current = false;
    }
  }

  // ── Place order (BUY side — no escrow needed from buyer) ─────────────────
  async function doPlaceOrder() {
    if (!mxcAddress) return;
    setStep("placing");
    try {
      await p2pApi.createOrder({
        adId: ad.id,
        buyerAddress: mxcAddress,
        cryptoAmount: amount,
        paymentMethod: selectedPm,
        paymentDetails: paymentDetails || undefined,
      });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onOrderPlaced();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to place order");
      setStep("idle");
    }
  }

  // ── Main handler ──────────────────────────────────────────────────────────
  async function handlePlace() {
    const err = validateInput();
    if (err) { setToast(err); return; }

    if (isSellOrder) {
      void requestPin({
        title: "Confirm Escrow Lock",
        subtitle: `${amount} ${ad.token} will be locked in escrow until the buyer pays. You get it back if the order expires.`,
        onSuccess: doEscrowAndPlace,
        onCancel:  () => setStep("idle"),
      });
    } else {
      await doPlaceOrder();
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const s = StyleSheet.create({
    overlay:   { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.72)" },
    sheet:     { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 16, maxHeight: "92%" },
    handle:    { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4 },
    header:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    title:     { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground },
    closeBtn:  { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
    scroll:    { paddingHorizontal: 20, paddingTop: 16 },
    infoCard:  { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 18 },
    infoRow:   { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
    infoLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    infoVal:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    priceVal:  { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.primary },
    label:     { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2, marginBottom: 8 },
    labelRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    balanceText: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    balanceVal:  { fontFamily: "Inter_700Bold", color: colors.primary },
    inputRow:  { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, paddingHorizontal: 14, marginBottom: 6 },
    input:     { flex: 1, paddingVertical: 13, fontSize: 18, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    unit:      { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    maxBtn:    { paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.primary + "18", borderRadius: 7, borderWidth: 1, borderColor: colors.primary + "40" },
    maxBtnText:{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.primary },
    limitHint: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginBottom: 14, marginTop: 2 },
    fiatRow:   { backgroundColor: colors.primary + "10", borderRadius: 10, padding: 12, marginBottom: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    fiatLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    fiatVal:   { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.primary },
    pmGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
    pmChip:    { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
    pmChipAct: { borderColor: colors.primary, backgroundColor: colors.primary + "15" },
    pmText:    { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    pmTextAct: { color: colors.primary, fontFamily: "Inter_600SemiBold" },
    detailInput: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, marginBottom: 18 },
    sellerCard: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1.5, borderColor: colors.primary + "40", padding: 14, marginBottom: 18 },
    sellerTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.primary, letterSpacing: 1.1, marginBottom: 10 },
    sellerRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 12 },
    sellerLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, flex: 1 },
    sellerValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, flex: 2, textAlign: "right" as const },
    sellerEmpty: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, fontStyle: "italic" as const, lineHeight: 18 },
    escrowBox:   { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#0EA5E910", borderRadius: 12, borderWidth: 1, borderColor: "#0EA5E930", padding: 12, marginBottom: 16 },
    escrowText:  { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#0EA5E9", lineHeight: 18 },
    termsBox:    { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 20 },
    termsText:   { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 18 },
    btn:         { borderRadius: 14, overflow: "hidden", marginHorizontal: 20, marginTop: 4 },
    btnGrad:     { paddingVertical: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
    btnText:     { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" },
    insuffBox:   { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "#EF444410", borderRadius: 9, borderWidth: 1, borderColor: "#EF444430", padding: 9, marginBottom: 10 },
    insuffText:  { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#EF4444" },
  });

  const insufficientBalance = isSellOrder && !!walletBalance && cryptoAmt > 0 && cryptoAmt > myBalance;

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: "flex-end" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={s.overlay} onPress={!loading ? onClose : undefined} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>{isBuyOrder ? "Buy" : "Sell"} {ad.token}</Text>
            <TouchableOpacity style={s.closeBtn} onPress={onClose} disabled={loading}>
              <Icon name="close" size={16} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            {/* Ad summary */}
            <View style={s.infoCard}>
              <Text style={s.priceVal}>{parseFloat(ad.price).toLocaleString("en-US", { maximumFractionDigits: 4 })} USDT</Text>
              <Text style={[s.infoLabel, { marginBottom: 10 }]}>per {ad.token}</Text>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Available</Text>
                <Text style={s.infoVal}>{parseFloat(ad.availableAmount).toFixed(2)} {ad.token}</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Limit</Text>
                <Text style={s.infoVal}>{min} – {max} {ad.token}</Text>
              </View>
              <View style={[s.infoRow, { marginBottom: 0 }]}>
                <Text style={s.infoLabel}>Payment window</Text>
                <Text style={s.infoVal}>{ad.paymentWindow} min</Text>
              </View>
            </View>

            {/* Escrow notice for sell orders */}
            {isSellOrder && (
              <View style={s.escrowBox}>
                <Icon name="lock-closed-outline" size={14} color="#0EA5E9" />
                <Text style={s.escrowText}>
                  Your <Text style={{ fontFamily: "Inter_700Bold" }}>{amount || "0"} {ad.token}</Text> will be locked in escrow when you place this order. If the buyer doesn't pay within {ad.paymentWindow} minutes, your funds are automatically returned.
                </Text>
              </View>
            )}

            {/* Amount */}
            <View style={s.labelRow}>
              <Text style={[s.label, { marginBottom: 0 }]}>AMOUNT ({ad.token})</Text>
              {isSellOrder && walletBalance && (
                <Text style={s.balanceText}>
                  Balance: <Text style={s.balanceVal}>
                    {myBalance.toFixed(2)} {ad.token}
                  </Text>
                </Text>
              )}
            </View>
            <View style={[s.inputRow, insufficientBalance && { borderColor: "#EF4444" }]}>
              <TextInput
                style={s.input}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                editable={!loading}
              />
              {isSellOrder && myBalance > 0 && (
                <TouchableOpacity
                  style={s.maxBtn}
                  onPress={() => setAmount(String(Math.min(myBalance, max).toFixed(6).replace(/\.?0+$/, "")))}
                  disabled={loading}
                >
                  <Text style={s.maxBtnText}>MAX</Text>
                </TouchableOpacity>
              )}
              <Text style={[s.unit, { marginLeft: 8 }]}>{ad.token}</Text>
            </View>
            {insufficientBalance && (
              <View style={s.insuffBox}>
                <Icon name="alert-circle-outline" size={13} color="#EF4444" />
                <Text style={s.insuffText}>Insufficient balance: {myBalance.toFixed(4)} {ad.token} available</Text>
              </View>
            )}
            <Text style={s.limitHint}>Min {min} · Max {max} {ad.token}</Text>

            {/* Fiat equivalent */}
            <View style={s.fiatRow}>
              <Text style={s.fiatLabel}>You {isBuyOrder ? "pay" : "receive"}</Text>
              <Text style={s.fiatVal}>{fiatAmt} USDT</Text>
            </View>

            {/* Payment method */}
            <Text style={s.label}>PAYMENT METHOD</Text>
            <View style={s.pmGrid}>
              {ad.paymentMethods.map(pm => (
                <TouchableOpacity
                  key={pm}
                  style={[s.pmChip, selectedPm === pm && s.pmChipAct]}
                  onPress={() => setSelectedPm(pm)}
                  disabled={loading}
                >
                  <Text style={[s.pmText, selectedPm === pm && s.pmTextAct]}>
                    {METHOD_LABELS[pm] ?? pm.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Seller's payment details (shown when buying) */}
            {isBuyOrder && (
              <>
                <Text style={s.label}>WHERE TO SEND PAYMENT</Text>
                <View style={s.sellerCard}>
                  {sellerDetail && (METHOD_FIELDS[selectedPm] ?? []).some(f => sellerDetail.details[f.key]) ? (
                    (METHOD_FIELDS[selectedPm] ?? []).map(f =>
                      sellerDetail.details[f.key] ? (
                        <View key={f.key} style={s.sellerRow}>
                          <Text style={s.sellerLabel}>{f.label}</Text>
                          <Text style={s.sellerValue}>{sellerDetail.details[f.key]}</Text>
                        </View>
                      ) : null
                    )
                  ) : (
                    <Text style={s.sellerEmpty}>
                      The seller hasn't added payment details for this method yet. Message them once the order is placed.
                    </Text>
                  )}
                </View>
              </>
            )}

            {/* Buyer's payment note (shown when selling) */}
            {isSellOrder && (
              <>
                <Text style={s.label}>PAYMENT NOTE (OPTIONAL)</Text>
                <TextInput
                  style={s.detailInput}
                  value={paymentDetails}
                  onChangeText={setPaymentDetails}
                  placeholder="Any notes for the buyer about your payment method…"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  editable={!loading}
                />
              </>
            )}

            {/* Terms */}
            {ad.terms && (
              <>
                <Text style={s.label}>{isBuyOrder ? "SELLER'S" : "BUYER'S"} TERMS</Text>
                <View style={s.termsBox}>
                  <Text style={s.termsText}>{ad.terms}</Text>
                </View>
              </>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[s.btn, (loading || insufficientBalance) && { opacity: 0.65 }]}
            onPress={handlePlace}
            disabled={loading || insufficientBalance}
            activeOpacity={0.85}
          >
            <View

              style={s.btnGrad}
            >
              {loading ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ActivityIndicator color="#FFF" size="small" />
                  <Text style={s.btnText}>{STEP_LABELS[step]}</Text>
                </View>
              ) : (
                <>
                  {isSellOrder && <Icon name="lock-closed-outline" size={15} color="#FFF" />}
                  <Text style={s.btnText}>
                    {isBuyOrder ? `Buy ${ad.token}` : `Lock & Sell ${ad.token}`}
                  </Text>
                </>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      <Toast message={toast} visible={!!toast} onHide={() => setToast("")} />
    </Modal>
  );
}
