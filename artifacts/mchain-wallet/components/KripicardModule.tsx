import { Icon } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import {
  CardAccount,
  KripicardDetails,
  KripicardTransaction,
  freezeKripicardCard,
  fundKripicardCard,
  getKripicardDetails,
  getKripicardTransactions,
  issueKripicardCard,
  sendMusdtForCard,
  verifyCardDeposit,
  api,
  MUSDT_CONTRACT,
} from "@/services/api";
import { weiToMc } from "@/services/crypto";

import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const BINS = [
  { bin: "441357", label: "Global Standard", flag: "GLOBAL", needsDob: false },
  { bin: "49387520", label: "Global Premium", flag: "INTL", needsDob: false },
];

const FEATURES = [
  { icon: "card-outline", text: "Spend USDT at any Mastercard merchant" },
  { icon: "flash-outline", text: "Instant top-ups from your USDT balance" },
  { icon: "globe-outline", text: "Works globally — online & in-store" },
  { icon: "lock-closed-outline", text: "Freeze & unfreeze anytime" },
];

function binLabel(bin: string | null): string {
  return BINS.find((b) => b.bin === bin)?.label ?? bin ?? "";
}

// ABI-encodes a balanceOf(address) eth_call payload for an ERC-20 contract
function buildBalanceOfCalldata(address: string | null | undefined): string {
  const addr = (address ?? "").replace(/^0x/i, "").toLowerCase().padStart(64, "0");
  return "0x70a08231" + addr;
}

function formatCardNumber(num: string | null | undefined, last4: string | null): string {
  if (num && num.length >= 12) return num.replace(/(\d{4})/g, "$1 ").trim();
  if (last4) return `•••• •••• •••• ${last4}`;
  return "•••• •••• •••• ••••";
}

function TxnRow({ txn, colors }: { txn: KripicardTransaction; colors: ReturnType<typeof useColors> }) {
  const date = new Date(txn.date);
  const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12,
      paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ width: 38, height: 38, borderRadius: 19,
        backgroundColor: txn.success ? "#7C3AED18" : "#EF444418",
        alignItems: "center", justifyContent: "center" }}>
        <Icon name={txn.type === "purchase" ? "cart-outline" : "swap-horizontal-outline"}
          size={17} color={txn.success ? "#7C3AED" : "#EF4444"} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>
          {txn.merchant || txn.type}
        </Text>
        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular",
          color: colors.mutedForeground, marginTop: 2 }}>
          {dateStr} · {timeStr}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold",
          color: txn.success ? "#EF4444" : colors.mutedForeground }}>
          -{txn.amount.toFixed(2)} USDT
        </Text>
        {!txn.success && (
          <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: "#EF4444", marginTop: 2 }}>
            FAILED
          </Text>
        )}
      </View>
    </View>
  );
}

interface Props {
  ethAddress: string;
  mxcAddress: string;
  account: CardAccount;
  onAccountUpdated: () => void;
  showMsg: (type: "success" | "error" | "info", text: string) => void;
  getPrivateKey: () => Promise<string | null>;
}

export default function KripicardModule({ ethAddress, mxcAddress, account, onAccountUpdated, showMsg, getPrivateKey }: Props) {
  const colors = useColors();

  const hasCard = !!account.kripicard_card_id;
  const kcStatus = account.kripicard_status ?? "none";

  // ── Onboarding state ───────────────────────────────────────────────────────
  const [showIssueForm, setShowIssueForm] = useState(false);
  const formAnim = useRef(new Animated.Value(0)).current;

  const openForm = () => {
    setShowIssueForm(true);
    Animated.spring(formAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 10 }).start();
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // ── Issue form state ───────────────────────────────────────────────────────
  const [issueName, setIssueName] = useState("");
  const [issueEmail, setIssueEmail] = useState("");
  const [issueBin, setIssueBin] = useState("441357");
  const [issueDob, setIssueDob] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issueStep, setIssueStep] = useState("");
  const selectedBinObj = BINS.find((b) => b.bin === issueBin) ?? BINS[0]!;

  // ── Card management state ──────────────────────────────────────────────────
  const [details, setDetails] = useState<KripicardDetails | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [txns, setTxns] = useState<KripicardTransaction[]>([]);
  const [txnBalance, setTxnBalance] = useState<number | null>(null);
  const [showTxns, setShowTxns] = useState(false);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [showFund, setShowFund] = useState(false);
  const [fundAmt, setFundAmt] = useState("20");
  const [funding, setFunding] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyField = async (val: string, field: string) => {
    await Clipboard.setStringAsync(val);
    setCopiedField(field);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleIssue = async () => {
    if (!issueName.trim() || issueName.trim().length < 2) {
      showMsg("error", "Please enter your name on card (at least 2 characters).");
      return;
    }
    if (!issueEmail.trim() || !issueEmail.includes("@")) {
      showMsg("error", "Please enter a valid email address.");
      return;
    }
    if (!issueDob.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(issueDob.trim())) {
      showMsg("error", "Please enter your date of birth (YYYY-MM-DD).");
      return;
    }

    // ── Pre-flight balance checks ────────────────────────────────────────────
    try {
      if (!MUSDT_CONTRACT) {
        showMsg("error", "The GMI stablecoin contract is not configured yet.");
        return;
      }
      setIssuing(true);
      setIssueStep("Checking balances…");

      const [mcAccount, musdtHex] = await Promise.all([
        // GMI balance (for gas)
        api.getAccount(mxcAddress!),
        // MUSDT balance via eth_call balanceOf(userAddress)
        api.rpcCall(MUSDT_CONTRACT, buildBalanceOfCalldata(ethAddress)).catch(() => null),
      ]);

      const mcBalance = parseFloat(weiToMc(mcAccount.balance ?? "0").replace(/,/g, ""));
      if (mcBalance < 0.001) {
        showMsg("error", `Insufficient GMI for gas. You have ${mcBalance.toFixed(4)} GMI — top up at least 0.001 GMI to pay the network fee.`);
        setIssuing(false); setIssueStep("");
        return;
      }

      const musdtRaw = musdtHex?.result ? BigInt(musdtHex.result) : 0n;
      const musdtBalance = Number(musdtRaw) / 1_000_000;
      if (musdtBalance < 20) {
        showMsg("error", `Insufficient MUSDT. You have ${musdtBalance.toFixed(2)} MUSDT — need 20 MUSDT to activate.`);
        setIssuing(false); setIssueStep("");
        return;
      }

      setIssuing(false); setIssueStep("");
    } catch {
      setIssuing(false); setIssueStep("");
      // Non-fatal — proceed even if balance checks fail (chain may be slow)
    }

    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Require explicit user confirmation before broadcasting
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Confirm Payment",
        `20 MUSDT will be sent from your wallet to activate this card.\n\nFrom: ${mxcAddress}\nAmount: 20 MUSDT\n\nThis cannot be undone.`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Confirm & Pay", style: "destructive", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    });
    if (!confirmed) return;

    setIssuing(true);
    try {
      const privateKey = await getPrivateKey();
      if (!privateKey) throw new Error("Could not retrieve private key — please unlock your wallet.");

      // Step 1 — send 20 MUSDT from user's wallet to admin wallet
      setIssueStep("Sending 20 MUSDT…");
      const { txHash } = await sendMusdtForCard({
        fromEthAddress: ethAddress,
        fromMxcAddress: mxcAddress,
        toAddress: account.deposit_address,
        amountUsdt: 20,
        privateKey,
      });

      // Step 2 — wait for the transaction to be mined
      setIssueStep("Confirming on-chain…");
      await api.waitForReceipt(txHash, 40_000);

      // Step 3 — credit balance immediately (don't wait for 60s watcher)
      setIssueStep("Verifying payment…");
      await verifyCardDeposit(ethAddress);

      // Step 4 — issue the card (deducts $20 from balance)
      setIssueStep("Activating your card…");
      const result = await issueKripicardCard(ethAddress, {
        amount: 20, bin: issueBin, nameOnCard: issueName.trim(),
        email: issueEmail.trim(),
        dateOfBirth: issueDob.trim(),
      });

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showMsg("success", `Card issued! Last 4: ${result.last4}`);
      onAccountUpdated();
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to issue card");
    } finally {
      setIssuing(false);
      setIssueStep("");
    }
  };

  const handleToggleDetails = async () => {
    if (showDetails) { setShowDetails(false); return; }
    if (details) { setShowDetails(true); return; }
    setLoadingDetails(true);
    try {
      const d = await getKripicardDetails(ethAddress);
      setDetails(d);
      setShowDetails(true);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to load card details");
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleToggleTxns = async () => {
    if (showTxns) { setShowTxns(false); return; }
    setLoadingTxns(true);
    try {
      const data = await getKripicardTransactions(ethAddress);
      setTxns(data.transactions);
      setTxnBalance(data.balance);
      setShowTxns(true);
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setLoadingTxns(false);
    }
  };

  const handleFreeze = async () => {
    if (freezing) return;
    const action = kcStatus === "frozen" ? "unfreeze" : "freeze";
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setFreezing(true);
    try {
      await freezeKripicardCard(ethAddress, action);
      showMsg("info", action === "freeze" ? "KripiCard frozen." : "KripiCard unfrozen.");
      onAccountUpdated();
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to freeze/unfreeze");
    } finally {
      setFreezing(false);
    }
  };

  const [fundStep, setFundStep] = useState("");

  const handleFund = async () => {
    const amt = parseFloat(fundAmt);
    if (isNaN(amt) || amt < 10) {
      showMsg("error", "Minimum top-up is $10.");
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Confirm Top-Up",
        `$${amt} MUSDT will be sent from your wallet to top up your card.\n\nFrom: ${mxcAddress}\nAmount: ${amt} MUSDT\n\nThis cannot be undone.`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Confirm & Pay", style: "destructive", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    });
    if (!confirmed) return;

    setFunding(true);
    try {
      const privateKey = await getPrivateKey();
      if (!privateKey) throw new Error("Could not retrieve private key — please unlock your wallet.");

      setFundStep(`Sending $${amt} MUSDT…`);
      const { txHash } = await sendMusdtForCard({
        fromEthAddress: ethAddress,
        fromMxcAddress: mxcAddress,
        toAddress: account.deposit_address,
        amountUsdt: amt,
        privateKey,
      });

      setFundStep("Confirming on-chain…");
      await api.waitForReceipt(txHash, 40_000);

      setFundStep("Verifying payment…");
      await verifyCardDeposit(ethAddress);

      setFundStep("Topping up card…");
      const result = await fundKripicardCard(ethAddress, amt);
      setShowFund(false);
      showMsg("success", `+$${result.amount.toFixed(2)} added to your card.`);
      setDetails(null);
      onAccountUpdated();
    } catch (err) {
      showMsg("error", err instanceof Error ? err.message : "Failed to fund card");
    } finally {
      setFunding(false);
      setFundStep("");
    }
  };

  const s = StyleSheet.create({
    sectionLabel: {
      fontSize: 11, fontFamily: "Inter_700Bold",
      color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 16,
    },
    card: {
      borderRadius: 18, overflow: "hidden", aspectRatio: 1.586,
      shadowColor: "#7C3AED", shadowOpacity: 0.25,
      shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
      elevation: 12, marginBottom: 16,
    },
    cardGrad: { flex: 1, padding: 22 },
    row: { flexDirection: "row", gap: 10, marginBottom: 16 },
    btn: {
      flex: 1, borderRadius: 14, borderWidth: 1,
      borderColor: colors.border, backgroundColor: colors.card,
      paddingVertical: 14, alignItems: "center", gap: 5,
    },
    btnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    panel: {
      backgroundColor: colors.card, borderRadius: 18,
      borderWidth: 1, borderColor: colors.border, padding: 20,
    },
    label: {
      fontSize: 11, fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground, letterSpacing: 1, marginBottom: 8,
    },
    input: {
      backgroundColor: colors.background, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 15, fontFamily: "Inter_400Regular",
      color: colors.foreground, marginBottom: 14,
    },
    detailRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border + "60",
    },
    detailLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 0.8 },
    detailVal: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground, letterSpacing: 1.5 },
  });

  const isFrozen = kcStatus === "frozen";

  // ── No card — onboarding CTA ───────────────────────────────────────────────
  if (!hasCard) {
    return (
      <View style={{ marginTop: 28, marginBottom: 8 }}>
        <Text style={s.sectionLabel}>KRIPICARD · USDT SPENDING</Text>

        {/* Promo card */}
        <View style={[s.card, showIssueForm && { opacity: 0.6 }]}>
          <View


            style={s.cardGrad}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View>
                <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFF", letterSpacing: 1.5 }}>GMI Chain</Text>
                <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)", letterSpacing: 2, marginTop: 2 }}>DIRECT USDT CARD</Text>
              </View>
              <View style={{ backgroundColor: "#ffffff18", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "rgba(255,255,255,0.7)", letterSpacing: 1 }}>KRIPICARD</Text>
              </View>
            </View>
            <View style={{ flex: 1, justifyContent: "center" }}>
              <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFF", letterSpacing: 3 }}>•••• •••• •••• ••••</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
              <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.45)", letterSpacing: 1 }}>DIRECT SPENDING · USDT</Text>
              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "rgba(255,255,255,0.45)", letterSpacing: 1 }}>MASTERCARD</Text>
            </View>
          </View>
        </View>

        {/* If form not open — show CTA panel */}
        {!showIssueForm && (
          <View style={s.panel}>
            <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 6 }}>
              Get Your USDT Card
            </Text>
            <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 20, marginBottom: 20 }}>
              A real Mastercard funded directly from your USDT. No bank account needed.
            </Text>

            {/* Feature list */}
            {FEATURES.map((f, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10,
                  backgroundColor: "#7C3AED15", borderWidth: 1, borderColor: "#7C3AED30",
                  alignItems: "center", justifyContent: "center" }}>
                  <Icon name={f.icon} size={18} color="#7C3AED" />
                </View>
                <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, lineHeight: 19 }}>
                  {f.text}
                </Text>
              </View>
            ))}

            {/* Fees note */}
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start",
              backgroundColor: "#F59E0B10", borderRadius: 12, borderWidth: 1,
              borderColor: "#F59E0B30", padding: 12, marginBottom: 20 }}>
              <Icon name="information-circle-outline" size={16} color="#F59E0B" />
              <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#F59E0B", lineHeight: 18 }}>
                One-time issuance fee + $1 per top-up (4% load fee) charged by KripiCard.
              </Text>
            </View>

            <TouchableOpacity
              style={{ borderRadius: 14, overflow: "hidden" }}
              activeOpacity={0.85}
              onPress={openForm}
            >
              <View

                style={{ paddingVertical: 16, alignItems: "center",
                  flexDirection: "row", justifyContent: "center", gap: 8 }}
              >
                <Icon name="card-outline" size={20} color="#FFF" />
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" }}>
                  Get Your KripiCard
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Issue form — shown after tapping CTA */}
        {showIssueForm && (
          <Animated.View style={[s.panel, {
            opacity: formAnim,
            transform: [{ translateY: formAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
          }]}>
            {/* Header row with back button */}
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 10 }}>
              <TouchableOpacity
                onPress={() => setShowIssueForm(false)}
                style={{ width: 32, height: 32, borderRadius: 16,
                  backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
                  alignItems: "center", justifyContent: "center" }}
                activeOpacity={0.7}
              >
                <Icon name="arrow-back" size={16} color={colors.foreground} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground }}>
                  Issue Your KripiCard
                </Text>
                <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 1 }}>
                  Minimum initial load: $10
                </Text>
              </View>
            </View>

            <Text style={s.label}>CARD TYPE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {BINS.map((b) => (
                  <TouchableOpacity
                    key={b.bin}
                    onPress={() => setIssueBin(b.bin)}
                    activeOpacity={0.75}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 10,
                      borderRadius: 12, borderWidth: 1.5,
                      borderColor: issueBin === b.bin ? "#7C3AED" : colors.border,
                      backgroundColor: issueBin === b.bin ? "#7C3AED18" : colors.background,
                      alignItems: "center", gap: 4, minWidth: 90,
                    }}
                  >
                    <Text style={{ fontSize: 18 }}>{b.flag}</Text>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold",
                      color: issueBin === b.bin ? "#7C3AED" : colors.mutedForeground,
                      textAlign: "center" }}>
                      {b.label}
                    </Text>
                    {b.needsDob && (
                      <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: "#F59E0B" }}>+DOB req.</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* One-time $20 fee notice */}
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start",
              backgroundColor: "#7C3AED10", borderRadius: 12, borderWidth: 1,
              borderColor: "#7C3AED30", padding: 12, marginBottom: 10 }}>
              <Icon name="wallet-outline" size={15} color="#7C3AED" />
              <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#7C3AED", lineHeight: 18 }}>
                $20 MUSDT will be sent automatically from your wallet to activate the card.
              </Text>
            </View>

            {/* MUSDT contract info */}
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start",
              backgroundColor: "#0EA5E908", borderRadius: 12, borderWidth: 1,
              borderColor: "#0EA5E920", padding: 12, marginBottom: 14 }}>
              <Icon name="information-circle-outline" size={15} color="#0EA5E9" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "#0EA5E9", lineHeight: 16 }}>
                  Stablecoin contract (GMI Chain)
                </Text>
                <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular",
                  color: "rgba(14,165,233,0.7)", letterSpacing: 0.3, marginTop: 2 }}>
                  0x7b2ed1be97fa240dbd0328dd307e35e588bcb917
                </Text>
              </View>
            </View>

            <Text style={s.label}>NAME ON CARD</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. John Smith"
              placeholderTextColor={colors.mutedForeground}
              value={issueName}
              onChangeText={setIssueName}
              autoCapitalize="words"
            />

            <Text style={s.label}>EMAIL</Text>
            <TextInput
              style={s.input}
              placeholder="your@email.com"
              placeholderTextColor={colors.mutedForeground}
              value={issueEmail}
              onChangeText={setIssueEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={s.label}>DATE OF BIRTH (YYYY-MM-DD)</Text>
            <TextInput
              style={s.input}
              placeholder="1990-01-15"
              placeholderTextColor={colors.mutedForeground}
              value={issueDob}
              onChangeText={setIssueDob}
              keyboardType="numbers-and-punctuation"
            />

            <TouchableOpacity
              style={{ borderRadius: 14, overflow: "hidden", opacity: issuing ? 0.7 : 1 }}
              activeOpacity={0.85}
              onPress={handleIssue}
              disabled={issuing}
            >
              <View

                style={{ paddingVertical: 16, alignItems: "center",
                  flexDirection: "row", justifyContent: "center", gap: 8 }}
              >
                {issuing
                  ? <ActivityIndicator color="#FFF" size="small" />
                  : <Icon name="card-outline" size={20} color="#FFF" />
                }
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" }}>
                  {issuing ? (issueStep || "Processing…") : "Pay $20 & Get Card"}
                </Text>
              </View>
            </TouchableOpacity>

            {!!issueStep && (
              <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium",
                color: "#7C3AED", textAlign: "center", marginTop: 10 }}>
                {issueStep}
              </Text>
            )}
          </Animated.View>
        )}
      </View>
    );
  }

  // ── Card active — management UI ───────────────────────────────────────────
  const displayNum = showDetails ? details?.cardNumber : null;
  const displayLast4 = account.kripicard_last4;

  return (
    <View style={{ marginTop: 28 }}>
      <Text style={s.sectionLabel}>KRIPICARD · USDT SPENDING</Text>

      {/* Card visual */}
      <View style={[s.card, isFrozen && { opacity: 0.65 }]}>
        <View


          style={s.cardGrad}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View>
              <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFF", letterSpacing: 1.5 }}>GMI Chain</Text>
              <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)", letterSpacing: 2, marginTop: 2 }}>DIRECT USDT CARD</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              {isFrozen && (
                <View style={{ backgroundColor: "#EF444430", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "#EF444450" }}>
                  <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#EF4444", letterSpacing: 1 }}>FROZEN</Text>
                </View>
              )}
              <View style={{ backgroundColor: "#ffffff18", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "rgba(255,255,255,0.7)", letterSpacing: 1 }}>KRIPICARD</Text>
              </View>
            </View>
          </View>

          <View style={{ flex: 1, justifyContent: "center", gap: 4 }}>
            {showDetails && details && (
              <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)", letterSpacing: 1 }}>
                Balance: ${details.balance.toFixed(2)} USDT
              </Text>
            )}
            <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFF", letterSpacing: 3 }}>
              {formatCardNumber(displayNum ?? null, displayLast4 ?? null)}
            </Text>
            {showDetails && details && (
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)", letterSpacing: 1 }}>
                VALID THRU {details.expiry}  CVV {details.cvv}
              </Text>
            )}
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.45)", letterSpacing: 1 }}>
              {binLabel(account.kripicard_bin ?? null)} · USDT
            </Text>
            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "rgba(255,255,255,0.45)", letterSpacing: 1 }}>MASTERCARD</Text>
          </View>
        </View>
      </View>

      {/* Action buttons */}
      <View style={s.row}>
        <TouchableOpacity
          style={[s.btn, showDetails && { borderColor: "#7C3AED60", backgroundColor: "#7C3AED10" }]}
          activeOpacity={0.7}
          onPress={handleToggleDetails}
          disabled={loadingDetails}
        >
          {loadingDetails
            ? <ActivityIndicator size="small" color="#7C3AED" />
            : <Icon name={showDetails ? "eye-off-outline" : "eye-outline"} size={20}
                color={showDetails ? "#7C3AED" : colors.foreground} />
          }
          <Text style={[s.btnText, showDetails && { color: "#7C3AED" }]}>
            {showDetails ? "Hide" : "Details"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.btn, showFund && { borderColor: "#22C55E60", backgroundColor: "#22C55E10" }]}
          activeOpacity={0.7}
          onPress={() => setShowFund((v) => !v)}
        >
          <Icon name="add-circle-outline" size={20} color={showFund ? "#22C55E" : colors.foreground} />
          <Text style={[s.btnText, showFund && { color: "#22C55E" }]}>Top Up</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.btn, isFrozen && { borderColor: "#EF444440", backgroundColor: "#EF444408" }]}
          activeOpacity={0.7}
          onPress={handleFreeze}
          disabled={freezing}
        >
          {freezing
            ? <ActivityIndicator size="small" color={isFrozen ? "#EF4444" : colors.foreground} />
            : <Icon name={isFrozen ? "lock-open-outline" : "lock-closed-outline"} size={20}
                color={isFrozen ? "#EF4444" : colors.foreground} />
          }
          <Text style={[s.btnText, isFrozen && { color: "#EF4444" }]}>
            {isFrozen ? "Unfreeze" : "Freeze"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.btn, showTxns && { borderColor: "#F59E0B60", backgroundColor: "#F59E0B10" }]}
          activeOpacity={0.7}
          onPress={handleToggleTxns}
          disabled={loadingTxns}
        >
          {loadingTxns
            ? <ActivityIndicator size="small" color="#F59E0B" />
            : <Icon name="receipt-outline" size={20} color={showTxns ? "#F59E0B" : colors.foreground} />
          }
          <Text style={[s.btnText, showTxns && { color: "#F59E0B" }]}>Spending</Text>
        </TouchableOpacity>
      </View>

      {/* Fund panel */}
      {showFund && (
        <View style={[s.panel, { marginBottom: 16 }]}>
          <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 4 }}>
            Top Up KripiCard
          </Text>
          <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginBottom: 14 }}>
            Fee: $1 + 4% of amount
          </Text>
          <Text style={s.label}>AMOUNT (USD, min $10)</Text>
          <TextInput
            style={s.input}
            placeholder="20"
            placeholderTextColor={colors.mutedForeground}
            value={fundAmt}
            onChangeText={setFundAmt}
            keyboardType="decimal-pad"
          />
          <TouchableOpacity
            style={{ borderRadius: 12, overflow: "hidden", opacity: funding ? 0.7 : 1 }}
            activeOpacity={0.85}
            onPress={handleFund}
            disabled={funding}
          >
            <View

              style={{ paddingVertical: 14, alignItems: "center",
                flexDirection: "row", justifyContent: "center", gap: 8 }}
            >
              {funding
                ? <ActivityIndicator color="#FFF" size="small" />
                : <Icon name="add-circle-outline" size={18} color="#FFF" />
              }
              <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFF" }}>
                {funding ? (fundStep || "Processing…") : "Pay & Top Up"}
              </Text>
            </View>
          </TouchableOpacity>
          {!!fundStep && (
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium",
              color: "#22C55E", textAlign: "center", marginTop: 10 }}>
              {fundStep}
            </Text>
          )}
        </View>
      )}

      {/* Card details panel */}
      {showDetails && details && (
        <View style={[s.panel, { marginBottom: 16 }]}>
          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.2, marginBottom: 12 }}>
            CARD DETAILS
          </Text>
          {[
            { label: "CARD NUMBER", val: details.cardNumber ?? `•••• •••• •••• ${displayLast4}` },
            { label: "EXPIRY", val: details.expiry },
            { label: "CVV", val: details.cvv },
            { label: "BALANCE", val: `$${details.balance.toFixed(2)} USDT` },
          ].map(({ label, val }) => (
            <TouchableOpacity
              key={label}
              style={s.detailRow}
              activeOpacity={val ? 0.6 : 1}
              onPress={() => val && copyField(val, label)}
            >
              <Text style={s.detailLabel}>{label}</Text>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Text style={s.detailVal}>{val ?? "—"}</Text>
                {val && (
                  <Icon name={copiedField === label ? "checkmark-outline" : "copy-outline"}
                    size={14} color={copiedField === label ? "#22C55E" : colors.mutedForeground} />
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Transactions panel */}
      {showTxns && (
        <View style={[s.panel, { marginBottom: 16 }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.2 }}>
              SPENDING HISTORY
            </Text>
            {txnBalance !== null && (
              <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#7C3AED" }}>
                ${txnBalance.toFixed(2)} bal
              </Text>
            )}
          </View>
          {txns.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 28, gap: 8 }}>
              <Icon name="receipt-outline" size={28} color={colors.mutedForeground} />
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>
                No transactions yet
              </Text>
            </View>
          ) : (
            txns.map((t, i) => <TxnRow key={i} txn={t} colors={colors} />)
          )}
        </View>
      )}
    </View>
  );
}
