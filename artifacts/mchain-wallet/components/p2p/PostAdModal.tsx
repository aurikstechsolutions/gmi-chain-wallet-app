import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { useWallet } from "@/context/WalletContext";
import { usePinContext } from "@/context/PinContext";
import { useColors } from "@/hooks/useColors";
import { p2pApi, type PaymentDetail } from "@/services/p2pApi";
import { PAYMENT_METHODS } from "@/services/paymentMethods";
import { PaymentDetailSheet } from "@/components/p2p/PaymentDetailSheet";
import { api } from "@/services/api";
import {
  mcToWei, buildErc20TransferDataHex, mxcAddressToEthAddress,
} from "@/services/crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GMI_NATIVE_SYMBOL } from "@/services/chain";
import * as Haptics from "expo-haptics";

import React, { useState, useCallback } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  visible: boolean;
  onClose: () => void;
  onPosted: () => void;
}

type Step = "idle" | "locking" | "broadcasting" | "confirming" | "creating" | "done";

const STEP_LABELS: Record<Step, string> = {
  idle:        "Post Ad",
  locking:     "Signing transaction…",
  broadcasting:"Broadcasting to chain…",
  confirming:  "Waiting for 2 confirmations…",
  creating:    "Publishing ad…",
  done:        "Done!",
};

export function PostAdModal({ visible, onClose, onPosted }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { mxcAddress, ethAddress, getPrivateKey } = useWallet();
  const { requestPin } = usePinContext();
  const qc = useQueryClient();

  const [token, setToken] = useState<"MC" | "USDT">("MC");
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [price, setPrice] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [availableAmount, setAvailableAmount] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<string[]>(["bank_transfer"]);
  const [paymentWindow, setPaymentWindow] = useState("15");
  const [terms, setTerms] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [toast, setToast] = useState("");
  const [addPaymentMethod, setAddPaymentMethod] = useState<string | null>(null);

  const loading = step !== "idle" && step !== "done";

  // ── Saved payment details ─────────────────────────────────────────────────
  const { data: savedPaymentDetails = [] } = useQuery({
    queryKey: ["payment-details", mxcAddress],
    queryFn: () => p2pApi.getPaymentDetails(mxcAddress!),
    enabled: !!mxcAddress,
    staleTime: 30000,
  });
  const savedMethodIds = new Set(savedPaymentDetails.map((d: PaymentDetail) => d.paymentMethod));

  // ── Wallet balance ────────────────────────────────────────────────────────
  const { data: walletBalance } = useQuery({
    queryKey: ["wallet-balance", ethAddress],
    queryFn: () => p2pApi.getWalletBalance(ethAddress!),
    enabled: !!ethAddress && visible,
    staleTime: 15000,
  });

  const availableBalance = token === "USDT"
    ? parseFloat(walletBalance?.usdt ?? "0")
    : parseFloat(walletBalance?.mc ?? "0");

  // ── Market price hints ────────────────────────────────────────────────────
  const { data: marketPrice } = useQuery({
    queryKey: ["market-price", token, side],
    queryFn: () => p2pApi.getMarketPrice(token, side),
    enabled: visible,
    staleTime: 20000,
  });

  const marketHint = (() => {
    if (!marketPrice || marketPrice.count === 0) return null;
    if (side === "sell" && marketPrice.lowestPrice != null)
      return { label: "Lowest sell", value: marketPrice.lowestPrice };
    if (side === "buy" && marketPrice.highestPrice != null)
      return { label: "Highest buy", value: marketPrice.highestPrice };
    return null;
  })();

  // ── Helpers ───────────────────────────────────────────────────────────────
  function togglePm(id: string) {
    setPaymentMethods(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }

  const handleSetMax = () => {
    if (availableBalance > 0) {
      setAvailableAmount(availableBalance.toFixed(6).replace(/\.?0+$/, ""));
    }
  };

  const handlePaymentMethodSaved = useCallback((detail: PaymentDetail) => {
    qc.invalidateQueries({ queryKey: ["payment-details", mxcAddress] });
    setPaymentMethods(prev =>
      prev.includes(detail.paymentMethod) ? prev : [...prev, detail.paymentMethod]
    );
    setAddPaymentMethod(null);
  }, [mxcAddress, qc]);

  // ── Validate form ─────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!price || !minAmount || !maxAmount || !availableAmount)
      return "Fill in all required fields";
    if (isNaN(parseFloat(price)) || parseFloat(price) <= 0)
      return "Enter a valid price";
    if (parseFloat(minAmount) > parseFloat(maxAmount))
      return "Min must be ≤ Max";
    if (side === "sell" && parseFloat(maxAmount) > parseFloat(availableAmount))
      return "Max cannot exceed available amount";
    if (paymentMethods.length === 0)
      return "Select at least one payment method";
    if (side === "sell" && walletBalance) {
      if (parseFloat(availableAmount) > availableBalance)
        return `Insufficient balance. You have ${availableBalance.toFixed(4)} ${token}`;
    }
    const hasAnyDetail = paymentMethods.some(m => savedMethodIds.has(m));
    if (!hasAnyDetail)
      return "Add payment details for at least one selected method";
    return null;
  }

  // ── Escrow lock + post (SELL only) ────────────────────────────────────────
  async function doEscrowAndPost() {
    if (!mxcAddress || !ethAddress) return;
    try {
      let escrowTxHash: string | undefined;

      if (side === "sell") {
        // Fetch escrow config
        const escrowInfo = await p2pApi.getEscrowInfo();
        if (!escrowInfo.configured || !escrowInfo.escrowAddress) {
          setToast("Escrow wallet not configured — contact admin"); setStep("idle"); return;
        }

        setStep("locking");
        const privateKey = await getPrivateKey();
        if (!privateKey) {
          setToast("Could not retrieve private key — please unlock your wallet and retry");
          setStep("idle"); return;
        }
        const { nonce } = await api.getAccount(mxcAddress);

        let result: { txHash: string };
        if (token === "MC") {
          const amountWei = mcToWei(availableAmount);
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
          const amount = BigInt(Math.round(parseFloat(availableAmount) * 1_000_000));
          const data = buildErc20TransferDataHex(escrowInfo.escrowAddress, amount);
          const contractAddr = escrowInfo.usdtContractAddress.toLowerCase().startsWith("0x")
            ? escrowInfo.usdtContractAddress
            : mxcAddressToEthAddress(escrowInfo.usdtContractAddress);
          setStep("broadcasting");
          result = await api.sendTransaction({
            fromAddress: ethAddress,
            toAddress: contractAddr,
            amount: "0",
            data,
            txType: "contract_call",
            nonce,
            privateKey,
          });
        }
        escrowTxHash = result.txHash;

        setStep("confirming");
        await api.waitForReceipt(escrowTxHash);
      }

      // Create the ad
      setStep("creating");
      await p2pApi.postAd({
        ownerAddress: mxcAddress,
        token, side, price, minAmount, maxAmount, availableAmount,
        paymentMethods,
        paymentWindow: parseInt(paymentWindow) || 15,
        terms: terms || undefined,
        escrowTxHash,
      });

      setStep("done");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onPosted();
      onClose();
      resetForm();
    } catch (e) {
      let msg = e instanceof Error ? e.message : "Failed to post ad";
      if (/insufficient/i.test(msg)) msg = "Insufficient balance to cover amount + network fee";
      if (/account not found/i.test(msg)) msg = "Wallet has no funds on-chain. Top up before posting a sell ad.";
      setToast(msg);
      setStep("idle");
    }
  }

  // ── Handle post button ────────────────────────────────────────────────────
  async function handlePost() {
    if (!mxcAddress) return;
    const err = validate();
    if (err) { setToast(err); return; }

    if (side === "sell") {
      // Require PIN before broadcasting escrow TX
      void requestPin({
        title: "Confirm Escrow Lock",
        subtitle: `${availableAmount} ${token} will be sent to escrow. You'll get it back when the trade completes or if you cancel the ad.`,
        onSuccess: doEscrowAndPost,
        onCancel: () => setStep("idle"),
      });
    } else {
      // Buy ads need no escrow — post directly
      setStep("creating");
      try {
        await p2pApi.postAd({
          ownerAddress: mxcAddress,
          token, side, price, minAmount, maxAmount, availableAmount,
          paymentMethods,
          paymentWindow: parseInt(paymentWindow) || 15,
          terms: terms || undefined,
        });
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onPosted();
        onClose();
        resetForm();
      } catch (e) {
        setToast(e instanceof Error ? e.message : "Failed to post ad");
      } finally {
        setStep("idle");
      }
    }
  }

  function resetForm() {
    setPrice(""); setMinAmount(""); setMaxAmount(""); setAvailableAmount("");
    setPaymentMethods(["bank_transfer"]); setPaymentWindow("15"); setTerms("");
    setStep("idle");
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const isSell = side === "sell";
  const enteredAmount = parseFloat(availableAmount || "0");
  const insufficientBalance = isSell && !!walletBalance && enteredAmount > 0 && enteredAmount > availableBalance;
  const unsavedSelected = paymentMethods.filter(m => !savedMethodIds.has(m));
  const noPaymentDetails = savedMethodIds.size === 0;

  const s = StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.72)" },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 16, maxHeight: "94%" },
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    title: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground },
    closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
    scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
    label: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2, marginBottom: 8 },
    labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    labelBalance: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    labelBalanceVal: { fontFamily: "Inter_700Bold", color: colors.primary },
    segRow: { flexDirection: "row", backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3, marginBottom: 18 },
    segBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
    segBtnActive: { backgroundColor: colors.primary + "25", borderWidth: 1, borderColor: colors.primary + "50" },
    segText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    segTextActive: { color: colors.primary },
    inputWrap: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginBottom: 6 },
    input: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground },
    inputPlain: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground, marginBottom: 14 },
    maxBtn: { paddingHorizontal: 10, paddingVertical: 6, marginRight: 8, backgroundColor: colors.primary + "18", borderRadius: 8, borderWidth: 1, borderColor: colors.primary + "40" },
    maxBtnText: { fontSize: 11, fontFamily: "Inter_700Bold", color: colors.primary },
    hintBox: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
    hintChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#0EA5E910", borderWidth: 1, borderColor: "#0EA5E930" },
    hintChipText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#0EA5E9" },
    hintChipVal: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#0EA5E9" },
    row2: { flexDirection: "row", gap: 10, marginBottom: 0 },
    half: { flex: 1 },
    pmGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
    pmChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
    pmChipActive: { borderColor: colors.primary, backgroundColor: colors.primary + "15" },
    pmText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    pmTextActive: { color: colors.primary, fontFamily: "Inter_600SemiBold" },
    pmAddBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: "#F59E0B40", backgroundColor: "#F59E0B0C" },
    pmAddBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#F59E0B" },
    warningBox: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#F59E0B10", borderRadius: 10, borderWidth: 1, borderColor: "#F59E0B30", padding: 12, marginBottom: 14 },
    warningText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#F59E0B", lineHeight: 18 },
    insufficientBox: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "#EF444410", borderRadius: 10, borderWidth: 1, borderColor: "#EF444430", padding: 10, marginBottom: 10 },
    insufficientText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#EF4444" },
    escrowInfoBox: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#0EA5E910", borderRadius: 12, borderWidth: 1, borderColor: "#0EA5E930", padding: 12, marginBottom: 16 },
    escrowInfoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#0EA5E9", lineHeight: 18 },
    textarea: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, minHeight: 80, textAlignVertical: "top", marginBottom: 18 },
    saveBtn: { borderRadius: 14, overflow: "hidden", marginHorizontal: 20, marginTop: 8 },
    saveGrad: { paddingVertical: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
    saveBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" },
    sideSell: { borderColor: "#0EA5E9", backgroundColor: "#0EA5E915" },
    sideSellText: { color: "#0EA5E9" },
    sideBuy: { borderColor: "#10B981", backgroundColor: "#10B98115" },
    sideBuyText: { color: "#10B981" },
    stepRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFF" },
  });

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: "flex-end" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.overlay} onPress={onClose} />
          <View style={s.sheet}>
            <View style={s.handle} />
            <View style={s.header}>
              <Text style={s.title}>Post Ad</Text>
              <TouchableOpacity style={s.closeBtn} onPress={onClose} disabled={loading}>
                <Icon name="close" size={16} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

              {/* Token */}
              <Text style={s.label}>TOKEN</Text>
              <View style={s.segRow}>
                {(["MC", "USDT"] as const).map(t => (
                  <TouchableOpacity key={t} style={[s.segBtn, token === t && s.segBtnActive]} onPress={() => setToken(t)}>
                    <Text style={[s.segText, token === t && s.segTextActive]}>{t === "MC" ? GMI_NATIVE_SYMBOL : t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Side */}
              <Text style={s.label}>I WANT TO</Text>
              <View style={s.segRow}>
                <TouchableOpacity style={[s.segBtn, side === "sell" && s.sideSell]} onPress={() => setSide("sell")}>
                    <Text style={[s.segText, side === "sell" && s.sideSellText]}>Sell {token === "MC" ? GMI_NATIVE_SYMBOL : token}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.segBtn, side === "buy" && s.sideBuy]} onPress={() => setSide("buy")}>
                    <Text style={[s.segText, side === "buy" && s.sideBuyText]}>Buy {token === "MC" ? GMI_NATIVE_SYMBOL : token}</Text>
                </TouchableOpacity>
              </View>

              {/* Escrow notice for sell ads */}
              {isSell && (
                <View style={s.escrowInfoBox}>
                  <Icon name="lock-closed-outline" size={14} color="#0EA5E9" />
                  <Text style={s.escrowInfoText}>
                    When you post a sell ad, your <Text style={{ fontFamily: "Inter_700Bold" }}>{availableAmount || "0"} {token === "MC" ? GMI_NATIVE_SYMBOL : token}</Text> will be locked in escrow automatically. You'll be prompted for your PIN to confirm. Funds are returned if you cancel and no orders are in progress.
                  </Text>
                </View>
              )}

              {/* Price */}
              <Text style={s.label}>PRICE (USDT per {token})</Text>
              <View style={[s.inputWrap, { marginBottom: marketHint ? 8 : 14 }]}>
                <TextInput
                  style={s.input}
                  value={price}
                  onChangeText={setPrice}
                  placeholder="0.00"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                  editable={!loading}
                />
              </View>
              {marketHint && (
                <View style={s.hintBox}>
                  <View style={s.hintChip}>
                    <Icon name="trending-up-outline" size={11} color="#0EA5E9" />
                    <Text style={s.hintChipText}>{marketHint.label}: </Text>
                    <Text style={s.hintChipVal}>{marketHint.value.toFixed(4)} USDT</Text>
                  </View>
                  {marketPrice && marketPrice.count > 0 && (
                    <View style={s.hintChip}>
                      <Icon name="bar-chart-outline" size={11} color="#0EA5E9" />
                      <Text style={s.hintChipText}>Range: </Text>
                      <Text style={s.hintChipVal}>
                        {marketPrice.lowestPrice?.toFixed(2)} – {marketPrice.highestPrice?.toFixed(2)}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Available amount */}
              <View style={s.labelRow}>
                <Text style={[s.label, { marginBottom: 0 }]}>
                  {isSell ? `AVAILABLE AMOUNT (${token})` : `TOTAL AMOUNT TO BUY (${token})`}
                </Text>
                {isSell && walletBalance && (
                  <Text style={s.labelBalance}>
                    Balance: <Text style={s.labelBalanceVal}>
                      {token === "USDT"
                        ? parseFloat(walletBalance.usdt).toFixed(2)
                        : parseFloat(walletBalance.mc).toFixed(2)
                      } {token}
                    </Text>
                  </Text>
                )}
              </View>
              <View style={[s.inputWrap, insufficientBalance && { borderColor: "#EF4444" }]}>
                <TextInput
                  style={s.input}
                  value={availableAmount}
                  onChangeText={setAvailableAmount}
                  placeholder="Total amount to offer"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                  editable={!loading}
                />
                {isSell && availableBalance > 0 && (
                  <TouchableOpacity style={s.maxBtn} onPress={handleSetMax} activeOpacity={0.7} disabled={loading}>
                    <Text style={s.maxBtnText}>MAX</Text>
                  </TouchableOpacity>
                )}
              </View>
              {insufficientBalance && (
                <View style={s.insufficientBox}>
                  <Icon name="alert-circle-outline" size={14} color="#EF4444" />
                  <Text style={s.insufficientText}>
                    Insufficient balance. Available: {availableBalance.toFixed(4)} {token}
                  </Text>
                </View>
              )}
              <View style={{ height: 8 }} />

              {/* Min / Max */}
              <Text style={s.label}>ORDER LIMITS ({token})</Text>
              <View style={s.row2}>
                <View style={s.half}>
                  <TextInput style={s.inputPlain} value={minAmount} onChangeText={setMinAmount} placeholder="Min" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" editable={!loading} />
                </View>
                <View style={s.half}>
                  <TextInput style={s.inputPlain} value={maxAmount} onChangeText={setMaxAmount} placeholder="Max" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" editable={!loading} />
                </View>
              </View>

              {/* Payment window */}
              <Text style={s.label}>PAYMENT WINDOW (MINUTES)</Text>
              <View style={s.segRow}>
                {["15", "30", "60"].map(w => (
                  <TouchableOpacity key={w} style={[s.segBtn, paymentWindow === w && s.segBtnActive]} onPress={() => setPaymentWindow(w)} disabled={loading}>
                    <Text style={[s.segText, paymentWindow === w && s.segTextActive]}>{w} min</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Payment methods */}
              <Text style={[s.label, { marginTop: 4 }]}>PAYMENT METHODS</Text>

              {noPaymentDetails ? (
                <View style={s.warningBox}>
                  <Icon name="alert-circle-outline" size={16} color="#F59E0B" />
                  <View style={{ flex: 1, gap: 8 }}>
                    <Text style={s.warningText}>
                      Add payment details before posting — buyers need to know how to pay you.
                    </Text>
                    {PAYMENT_METHODS.map(pm => (
                      <TouchableOpacity key={pm.id} style={s.pmAddBtn} onPress={() => setAddPaymentMethod(pm.id)} activeOpacity={0.8}>
                        <Icon name="add-circle-outline" size={14} color="#F59E0B" />
                        <Text style={s.pmAddBtnText}>Add {pm.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : (
                <>
                  <View style={s.pmGrid}>
                    {PAYMENT_METHODS.map(pm => {
                      const isActive = paymentMethods.includes(pm.id);
                      const hasSaved = savedMethodIds.has(pm.id);
                      return (
                        <TouchableOpacity
                          key={pm.id}
                          style={[s.pmChip, isActive && s.pmChipActive]}
                          onPress={() => togglePm(pm.id)}
                          disabled={loading}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Text style={[s.pmText, isActive && s.pmTextActive]}>{pm.label}</Text>
                            {isActive && (hasSaved
                              ? <Icon name="checkmark-circle" size={11} color={colors.primary} />
                              : <Icon name="alert-circle-outline" size={11} color="#F59E0B" />)}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {unsavedSelected.length > 0 && (
                    <View style={[s.warningBox, { marginBottom: 10 }]}>
                      <Icon name="alert-circle-outline" size={14} color="#F59E0B" />
                      <View style={{ flex: 1, gap: 6 }}>
                        <Text style={s.warningText}>
                          Add payment details for: {unsavedSelected.map(m =>
                            PAYMENT_METHODS.find(p => p.id === m)?.label ?? m
                          ).join(", ")}
                        </Text>
                        {unsavedSelected.map(methodId => (
                          <TouchableOpacity key={methodId} style={s.pmAddBtn} onPress={() => setAddPaymentMethod(methodId)} activeOpacity={0.8}>
                            <Icon name="add-circle-outline" size={13} color="#F59E0B" />
                            <Text style={s.pmAddBtnText}>
                              Add {PAYMENT_METHODS.find(p => p.id === methodId)?.label ?? methodId}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </>
              )}

              {/* Terms */}
              <Text style={[s.label, { marginTop: 4 }]}>TERMS (OPTIONAL)</Text>
              <TextInput
                style={s.textarea}
                value={terms}
                onChangeText={setTerms}
                placeholder="Any conditions or notes for traders…"
                placeholderTextColor={colors.mutedForeground}
                multiline
                maxLength={500}
                editable={!loading}
              />

            </ScrollView>

            <TouchableOpacity
              style={[s.saveBtn, (loading || insufficientBalance) && { opacity: 0.7 }]}
              onPress={handlePost}
              disabled={loading || insufficientBalance}
              activeOpacity={0.85}
            >
              <View

                style={s.saveGrad}
              >
                {loading ? (
                  <View style={s.stepRow}>
                    <ActivityIndicator color="#FFF" size="small" />
                    <Text style={s.saveBtnText}>{STEP_LABELS[step]}</Text>
                  </View>
                ) : (
                  <>
                    {isSell
                      ? <Icon name="lock-closed-outline" size={16} color="#FFF" />
                      : <Icon name="add-circle-outline" size={16} color="#FFF" />
                    }
                    <Text style={s.saveBtnText}>
                      {isSell ? `Lock & Post Sell Ad` : `Post Buy Ad`}
                    </Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
        <Toast message={toast} visible={!!toast} onHide={() => setToast("")} />
      </Modal>

      {addPaymentMethod && (
        <PaymentDetailSheet
          visible={!!addPaymentMethod}
          onClose={() => setAddPaymentMethod(null)}
          onSaved={handlePaymentMethodSaved}
          ownerAddress={mxcAddress!}
          paymentMethod={addPaymentMethod}
          existing={null}
        />
      )}
    </>
  );
}
