import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWallet } from "@/context/WalletContext";
import { generateMnemonic, mnemonicToKeyPair } from "@/services/crypto";
import { setPin } from "@/services/pin";
import { useColors } from "@/hooks/useColors";
import { Icon } from "@/components/Icon";
import { GmiLogo } from "@/components/GmiLogo";
import type { KeyPair } from "@/services/crypto";
import type { ValidatorInfo } from "@/services/api";

type Mode = "create" | "import";
type Step =
  | "welcome"
  | "backup"
  | "verify"
  | "moniker"
  | "set_pin"
  | "import_enter"
  | "done_restored";

// Pick n unique random indices from 0..max-1
function pickRandomIndices(max: number, n: number): number[] {
  const pool = Array.from({ length: max }, (_, i) => i);
  const result: number[] = [];
  while (result.length < n) {
    const i = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(i, 1)[0]);
  }
  return result.sort((a, b) => a - b);
}

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { completeOnboarding, resolveImportMnemonic } = useWallet();

  const [step, setStep] = useState<Step>("welcome");
  const [mode, setMode] = useState<Mode>("create");
  const [creating, setCreating] = useState(false);

  // Wallet state
  const [mnemonic, setMnemonic] = useState("");
  const [keyPair, setKeyPair] = useState<KeyPair | null>(null);
  const [backedUp, setBackedUp] = useState(false);

  // Verify step — tap-to-fill chip puzzle
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifySlots, setVerifySlots] = useState<(string | null)[]>([null, null, null]);
  const [verifyPool, setVerifyPool] = useState<string[]>([]);
  const [verifyError, setVerifyError] = useState("");
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Import state
  const [importInput, setImportInput] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [restoredValidator, setRestoredValidator] = useState<ValidatorInfo | null>(null);

  // Shared
  const [moniker, setMoniker] = useState("");
  const [finishing, setFinishing] = useState(false);

  // PIN setup step
  const PIN_LEN = 6;
  const [pinDigits, setPinDigits] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinPhase, setPinPhase] = useState<"enter" | "confirm">("enter");
  const [pinError, setPinError] = useState("");
  const pinShake = useRef(new Animated.Value(0)).current;

  function doPinShake() {
    pinShake.setValue(0);
    Animated.sequence([
      Animated.timing(pinShake, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(pinShake, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(pinShake, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(pinShake, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(pinShake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }

  function enterPinToSetPin(key: string) {
    setPinError("");
    const active = pinPhase === "enter" ? pinDigits : pinConfirm;
    if (active.length >= PIN_LEN) return;
    const next = active + key;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (pinPhase === "enter") {
      setPinDigits(next);
      if (next.length === PIN_LEN) {
        // Advance to confirm phase
        setTimeout(() => setPinPhase("confirm"), 180);
      }
    } else {
      setPinConfirm(next);
      if (next.length === PIN_LEN) {
        // Auto-verify
        setTimeout(() => confirmPin(pinDigits, next), 180);
      }
    }
  }

  function deletePinDigit() {
    setPinError("");
    if (pinPhase === "enter") {
      setPinDigits(d => d.slice(0, -1));
    } else {
      setPinConfirm(d => d.slice(0, -1));
    }
  }

  async function confirmPin(entered: string, confirmed: string) {
    if (entered !== confirmed) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      doPinShake();
      setPinError("PINs don't match — try again");
      setPinConfirm("");
      setPinPhase("enter");
      setPinDigits("");
      return;
    }
    await setPin(entered);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await handleFinish();
  }

  function goToSetPin() {
    setPinDigits("");
    setPinConfirm("");
    setPinPhase("enter");
    setPinError("");
    setStep("set_pin");
  }

  // Pulsing glow animation for the welcome logo
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 2200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  function handleCreateWallet() {
    setCreating(true);
    setTimeout(() => {
      try {
        const words = generateMnemonic();
        const kp = mnemonicToKeyPair(words);
        setMnemonic(words);
        setKeyPair(kp);
        setMode("create");
        setBackedUp(false);
        setStep("backup");
      } finally {
        setCreating(false);
      }
    }, 50);
  }

  function handleImportWallet() {
    setMode("import");
    setImportInput("");
    setStep("import_enter");
  }

  async function handleImportSubmit() {
    const trimmed = importInput.trim().toLowerCase().replace(/\s+/g, " ");
    const wordCount = trimmed.split(" ").filter(Boolean).length;
    if (wordCount !== 12) {
      Alert.alert("Invalid Phrase", "Please enter exactly 12 words.");
      return;
    }
    setImportLoading(true);
    try {
      const result = await resolveImportMnemonic(trimmed);
      setKeyPair(result.keypair);
      setMnemonic(trimmed);

      if (result.isExistingValidator && result.validatorInfo) {
        const info = result.validatorInfo;
        await completeOnboarding(
          result.keypair.mxcAddress,
          result.keypair.ethAddress,
          result.keypair.publicKey,
          result.keypair.privateKey,
          info.moniker,
          info.status
        );
        setRestoredValidator(info);
        setMoniker(info.moniker);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStep("done_restored");
      } else {
        setStep("moniker");
      }
    } catch (err: unknown) {
      Alert.alert(
        "Invalid Seed Phrase",
        err instanceof Error ? err.message : "Please check your 12 words and try again."
      );
    } finally {
      setImportLoading(false);
    }
  }

  async function handleCopyMnemonic() {
    if (!mnemonic) return;
    const numbered = mnemonic
      .split(" ")
      .map((word, i) => `${i + 1}. ${word}`)
      .join("\n");
    await Clipboard.setStringAsync(numbered);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Copied", "Seed phrase copied. Store it somewhere safe and never share it.");
  }

  function handleProceedToVerify() {
    const indices = pickRandomIndices(12, 3);
    const words = mnemonic.split(" ");
    // Build a pool: the 3 correct words + 9 random distractors, all shuffled
    const correctWords = indices.map(i => words[i]);
    const others = words.filter((_, i) => !indices.includes(i));
    // Pick 9 distractors from remaining 9 words
    const distractors = others.sort(() => Math.random() - 0.5).slice(0, 9);
    const pool = [...correctWords, ...distractors].sort(() => Math.random() - 0.5);
    setVerifyIndices(indices);
    setVerifySlots([null, null, null]);
    setVerifyPool(pool);
    setVerifyError("");
    setStep("verify");
  }

  function handleVerify() {
    const words = mnemonic.split(" ");
    const allCorrect = verifyIndices.every(
      (idx, i) => verifySlots[i]?.toLowerCase() === words[idx].toLowerCase()
    );
    if (!allCorrect) {
      setVerifyError("Some words are wrong. Tap a filled slot to remove it and try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Shake animation
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -6, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start();
      return;
    }
    setVerifyError("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep("moniker");
  }

  function tapPoolChip(word: string) {
    // Place into next empty slot
    const nextEmpty = verifySlots.findIndex(s => s === null);
    if (nextEmpty === -1) return;
    const newSlots = [...verifySlots];
    newSlots[nextEmpty] = word;
    setVerifySlots(newSlots);
    setVerifyPool(verifyPool.filter(w => w !== word));
    setVerifyError("");
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function tapFilledSlot(slotIdx: number) {
    const word = verifySlots[slotIdx];
    if (!word) return;
    const newSlots = [...verifySlots];
    newSlots[slotIdx] = null;
    setVerifySlots(newSlots);
    setVerifyPool([...verifyPool, word]);
    setVerifyError("");
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleFinish() {
    if (!keyPair || !moniker.trim()) return;
    setFinishing(true);
    try {
      await completeOnboarding(
        keyPair.mxcAddress,
        keyPair.ethAddress,
        keyPair.publicKey,
        keyPair.privateKey,
        moniker.trim()
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    } finally {
      setFinishing(false);
    }
  }

  const mnemonicWords = mnemonic ? mnemonic.split(" ") : [];

  const createSteps: Step[] = ["backup", "verify", "moniker", "set_pin"];
  const importSteps: Step[] = ["import_enter", "moniker", "set_pin"];

  function renderStepIndicator() {
    if (step === "welcome" || step === "done_restored") return null;
    const steps = mode === "create" ? createSteps : importSteps;
    const idx = steps.indexOf(step);
    if (idx < 0) return null;
    return (
      <View style={s.stepIndicator}>
        {steps.map((_, i) => (
          <View key={i} style={[s.stepDot, { backgroundColor: i <= idx ? colors.primary : colors.border }]} />
        ))}
      </View>
    );
  }

  const wordCount = importInput.trim() ? importInput.trim().split(/\s+/).filter(Boolean).length : 0;
  const wordCountColor = wordCount === 12 ? colors.success : wordCount > 12 ? "#ef4444" : colors.mutedForeground;

  const s = StyleSheet.create({
    outer: { flex: 1, backgroundColor: colors.background },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20),
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
    },
    logo: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.primary, letterSpacing: 3, marginBottom: 8 },
    title: { fontSize: 28, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 8 },
    subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginBottom: 32, lineHeight: 22 },
    card: { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border, padding: 20, marginBottom: 20 },
    cardTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 12 },
    stepIndicator: { flexDirection: "row", gap: 6, marginBottom: 24 },
    stepDot: { height: 3, borderRadius: 2, flex: 1 },
    primaryBtn: { borderRadius: colors.radius, overflow: "hidden", marginBottom: 16 },
    primaryBtnInner: { paddingVertical: 16, alignItems: "center", justifyContent: "center" },
    primaryBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
    secondaryBtn: { paddingVertical: 14, alignItems: "center" },
    secondaryBtnText: { fontSize: 15, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    input: {
      backgroundColor: colors.input, borderRadius: colors.radius - 4, borderWidth: 1,
      borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 14,
      fontSize: 16, fontFamily: "Inter_400Regular", color: colors.foreground, marginBottom: 20,
    },
    warningCard: { backgroundColor: "#1A1000", borderRadius: colors.radius, borderWidth: 1, borderColor: "#F59E0B40", padding: 16, marginBottom: 20 },
    warningTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: colors.warning, marginBottom: 8 },
    warningText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#D4A017", lineHeight: 20 },
    successIcon: { alignItems: "center", marginBottom: 24, marginTop: 8 },
    successCircle: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: colors.success, alignItems: "center", justifyContent: "center" },
    successCheck: { fontSize: 36 },
    successTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center", marginBottom: 12 },
    successText: { fontSize: 15, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", lineHeight: 22, marginBottom: 8 },
    welcomeHero: { alignItems: "center", paddingTop: 16, paddingBottom: 36 },
    welcomeRingOuter: {
      width: 160, height: 160, borderRadius: 80,
      borderWidth: 1, borderColor: "#0EA5E918",
      alignItems: "center", justifyContent: "center", marginBottom: 32,
    },
    welcomeRingMid: {
      width: 128, height: 128, borderRadius: 64,
      borderWidth: 1, borderColor: "#0EA5E930",
      alignItems: "center", justifyContent: "center",
    },
    welcomeRingInner: {
      width: 100, height: 100, borderRadius: 50,
      borderWidth: 1.5, borderColor: "#0EA5E950",
      backgroundColor: "#0EA5E910",
      alignItems: "center", justifyContent: "center",
    },
    welcomeIconGrad: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
    welcomeEmoji: { fontSize: 32 },
    welcomeBrand: { alignItems: "center", marginBottom: 14 },
    welcomeChain: {
      fontSize: 11, fontFamily: "Inter_700Bold",
      color: colors.primary, letterSpacing: 5, marginBottom: 10,
    },
    welcomeTitle: {
      fontSize: 28, fontFamily: "Inter_700Bold",
      color: colors.foreground, textAlign: "center",
      lineHeight: 34, marginBottom: 12,
    },
    welcomeSubtitle: {
      fontSize: 14, fontFamily: "Inter_400Regular",
      color: colors.mutedForeground, textAlign: "center",
      lineHeight: 22, paddingHorizontal: 4,
    },
    trustRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 24 },
    trustChip: {
      flexDirection: "row", alignItems: "center", gap: 5,
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
      backgroundColor: "#0EA5E90C", borderWidth: 1, borderColor: "#0EA5E922",
    },
    trustText: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    divider: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
    dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
    dividerText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    mnemonicGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
    wordChip: { flexDirection: "row", alignItems: "center", backgroundColor: colors.secondary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, minWidth: "30%", flex: 1, gap: 6 },
    wordIndex: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, minWidth: 16 },
    wordText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    checkRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24, padding: 16, backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border },
    checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.primary, alignItems: "center", justifyContent: "center" },
    checkboxChecked: { backgroundColor: colors.primary },
    checkboxLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground, lineHeight: 20 },
    importTextArea: { backgroundColor: colors.input, borderRadius: colors.radius - 4, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontFamily: "Inter_400Regular", color: colors.foreground, marginBottom: 12, minHeight: 120, textAlignVertical: "top" },
    wordCountBadge: { alignSelf: "flex-end", marginBottom: 20, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    wordCountText: { fontSize: 12, fontFamily: "Inter_500Medium" },
    restoredBadge: { alignSelf: "center", backgroundColor: "#16a34a20", borderRadius: 20, borderWidth: 1, borderColor: "#16a34a60", paddingHorizontal: 16, paddingVertical: 6, marginBottom: 24 },
    restoredBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.success },
    infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
    infoLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    // Verify step — chip puzzle
    slotsContainer: { gap: 10, marginBottom: 4 },
    slot: {
      flexDirection: "row", alignItems: "center",
      backgroundColor: colors.card, borderRadius: 12,
      borderWidth: 1.5, borderColor: colors.border,
      borderStyle: "dashed" as const,
      paddingHorizontal: 14, paddingVertical: 14, gap: 8,
    },
    slotFilled: {
      borderStyle: "solid" as const,
      borderColor: colors.primary + "60",
      backgroundColor: colors.primary + "0C",
    },
    slotError: { borderColor: "#EF444460", backgroundColor: "#EF44440C" },
    slotIndex: { fontSize: 11, fontFamily: "Inter_700Bold", color: colors.primary, minWidth: 26 },
    slotWord: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    slotPlaceholder: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground + "80" },
    slotX: { fontSize: 18, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 20 },
    chipPool: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    poolChip: {
      paddingHorizontal: 14, paddingVertical: 10,
      borderRadius: 20, borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    poolChipText: { fontSize: 14, fontFamily: "Inter_500Medium", color: colors.foreground },
    verifyErrorBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#EF444410", borderRadius: 10, borderWidth: 1, borderColor: "#EF444430", padding: 12 },
    verifyErrorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#EF4444", lineHeight: 18 },

    // PIN setup step
    pinSection: {
      alignItems: "center",
      width: "100%",
    },
    pinIconWrap: {
      width: 76, height: 76, borderRadius: 24,
      alignItems: "center", justifyContent: "center",
      marginBottom: 20, overflow: "hidden",
    },
    pinIconGrad: {
      width: 76, height: 76, borderRadius: 24,
      alignItems: "center", justifyContent: "center",
    },
    pinPhaseLabel: {
      fontSize: 11, fontFamily: "Inter_700Bold",
      color: colors.primary, letterSpacing: 2,
      marginBottom: 6, textAlign: "center",
    },
    pinTitle: {
      fontSize: 28, fontFamily: "Inter_700Bold",
      color: colors.foreground, textAlign: "center",
      letterSpacing: -0.3,
    },
    pinSubtitle: {
      fontSize: 14, fontFamily: "Inter_400Regular",
      color: colors.mutedForeground, textAlign: "center",
      marginTop: 8, lineHeight: 21, paddingHorizontal: 8,
    },
    pinDotsRow: {
      flexDirection: "row", gap: 16,
      marginTop: 36, marginBottom: 0,
      justifyContent: "center", alignSelf: "center",
    },
    pinDot: {
      width: 16, height: 16, borderRadius: 8,
      borderWidth: 1.5,
    },
    pinDotFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
    pinDotEmpty: { backgroundColor: "transparent", borderColor: colors.border },
    pinDotError: { borderColor: "#EF4444" },
    pinErrorText: {
      fontSize: 13, fontFamily: "Inter_500Medium",
      color: "#EF4444", textAlign: "center", marginTop: 14,
    },
    keypad: { width: "100%", gap: 10, marginTop: 32 },
    keyRow: { flexDirection: "row", justifyContent: "center", gap: 14 },
    key: {
      width: 82, height: 82, borderRadius: 41,
      alignItems: "center", justifyContent: "center",
      backgroundColor: colors.secondary,
    },
    keyText: { fontSize: 26, fontFamily: "Inter_400Regular", color: colors.foreground, lineHeight: 30 },
    keySubText: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2, marginTop: 1 },
    keyEmpty: { backgroundColor: "transparent" },
  });

  return (
    <View style={s.outer}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {step !== "welcome" && <Text style={s.logo}>GMI</Text>}
          {renderStepIndicator()}

          {/* ── WELCOME ──────────────────────────────────────────────── */}
          {step === "welcome" && (
            <>
              {/* Hero */}
              <View style={s.welcomeHero}>
                <Animated.View style={{ transform: [{ scale: pulseAnim }], marginBottom: 32 }}>
                  <GmiLogo size={140} />
                </Animated.View>

                {/* Brand text */}
                <View style={s.welcomeBrand}>
                  <Text style={s.welcomeTitle}>GMI Wallet</Text>
                  <Text style={s.welcomeSubtitle}>
                    Secure your network identity with a{"\n"}12-word seed phrase. You're always in control.
                  </Text>
                </View>

                {/* Trust pills */}
                <View style={s.trustRow}>
                    {[
                    { icon: "lock-closed-outline", label: "Non-custodial" },
                    { icon: "shield-checkmark-outline", label: "256-bit" },
                    { icon: "zap", label: "On-chain" },
                  ].map(({ icon, label }) => (
                    <View key={label} style={s.trustChip}>
                      <Icon name={icon} size={12} color={colors.primary} />
                      <Text style={s.trustText}>{label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Primary CTA */}
              <TouchableOpacity
                style={[s.primaryBtn, creating && { opacity: 0.85 }]}
                onPress={handleCreateWallet}
                disabled={creating}
                activeOpacity={0.88}
              >
                <View style={[s.primaryBtnInner, { backgroundColor: colors.primary }]}>
                  {creating ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <ActivityIndicator color={colors.primaryForeground} size="small" />
                      <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>Generating…</Text>
                    </View>
                  ) : (
                    <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>Create New Wallet</Text>
                  )}
                </View>
              </TouchableOpacity>

              {/* Divider */}
              <View style={s.divider}>
                <View style={s.dividerLine} />
                <Text style={s.dividerText}>or</Text>
                <View style={s.dividerLine} />
              </View>

              {/* Secondary CTA */}
              <TouchableOpacity
                style={[
                  s.primaryBtn,
                  { borderWidth: 1, borderColor: colors.border, borderRadius: colors.radius, overflow: "hidden" },
                ]}
                onPress={handleImportWallet}
                activeOpacity={0.88}
              >
                <View style={[s.primaryBtnInner, { backgroundColor: colors.card }]}>
                  <Text style={[s.primaryBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                    Import Existing Wallet
                  </Text>
                </View>
              </TouchableOpacity>

            </>
          )}

          {/* ── BACKUP SEED PHRASE ────────────────────────────────────── */}
          {step === "backup" && (
            <>
              <Text style={s.title}>Save Your Seed Phrase</Text>
              <Text style={s.subtitle}>
                These 12 words are the only way to recover your wallet. Write them down in order and keep them somewhere safe.
              </Text>

              <View style={s.warningCard}>
                <Text style={s.warningTitle}>NEVER SHARE THESE WORDS</Text>
                <Text style={s.warningText}>
                  Anyone with your seed phrase has full access to your wallet. GMI support will never ask for them.
                </Text>
              </View>

              <View style={s.card}>
                <Text style={s.cardTitle}>YOUR SEED PHRASE</Text>
                <View style={s.mnemonicGrid}>
                  {mnemonicWords.map((word, i) => (
                    <View key={i} style={s.wordChip}>
                      <Text style={s.wordIndex}>{i + 1}.</Text>
                      <Text style={s.wordText}>{word}</Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: colors.radius - 4, borderWidth: 1, borderColor: colors.border, gap: 6 }}
                  onPress={handleCopyMnemonic}
                >
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.primary }}>Copy to Clipboard</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={s.checkRow} onPress={() => setBackedUp(v => !v)} activeOpacity={0.7}>
                <View style={[s.checkbox, backedUp && s.checkboxChecked]}>
                  {backedUp && <Text style={{ color: "#fff", fontSize: 14 }}>✓</Text>}
                </View>
                <Text style={s.checkboxLabel}>I have written down my seed phrase and stored it safely</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[s.primaryBtn, !backedUp && { opacity: 0.4 }]} onPress={() => backedUp && handleProceedToVerify()} disabled={!backedUp}>
                <View style={[s.primaryBtnInner, { backgroundColor: colors.primary }]}>
                  <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>I've Saved My Phrase</Text>
                </View>
              </TouchableOpacity>
            </>
          )}

          {/* ── VERIFY SEED PHRASE ────────────────────────────────────── */}
          {step === "verify" && (
            <>
              <Text style={s.title}>Confirm Your Backup</Text>
              <Text style={s.subtitle}>
                Tap the words below to fill slots {verifyIndices.map(i => `#${i + 1}`).join(", ")} of your seed phrase in order.
              </Text>

              {/* Slots */}
              <Animated.View style={[s.slotsContainer, { transform: [{ translateX: shakeAnim }] }]}>
                {verifyIndices.map((wordIdx, i) => {
                  const filled = !!verifySlots[i];
                  const wrong = verifyError && filled;
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[
                        s.slot,
                        filled && s.slotFilled,
                        wrong ? s.slotError : null,
                      ]}
                      onPress={() => tapFilledSlot(i)}
                      disabled={!filled}
                      activeOpacity={0.75}
                    >
                      <Text style={s.slotIndex}>#{wordIdx + 1}</Text>
                      {filled ? (
                        <Text style={s.slotWord}>{verifySlots[i]}</Text>
                      ) : (
                        <Text style={s.slotPlaceholder}>tap a word below</Text>
                      )}
                      {filled && (
                        <Text style={s.slotX}>×</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </Animated.View>

              {/* Divider */}
              <View style={[s.divider, { marginVertical: 20 }]}>
                <View style={s.dividerLine} />
                <Text style={s.dividerText}>word pool</Text>
                <View style={s.dividerLine} />
              </View>

              {/* Word chip pool */}
              <View style={s.chipPool}>
                {verifyPool.map((word) => (
                  <TouchableOpacity
                    key={word}
                    style={s.poolChip}
                    onPress={() => tapPoolChip(word)}
                    activeOpacity={0.75}
                  >
                    <Text style={s.poolChipText}>{word}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {!!verifyError && (
                <View style={[s.verifyErrorBox, { marginTop: 16 }]}>
                  <Icon name="alert-triangle" size={15} color={colors.destructive} />
                  <Text style={s.verifyErrorText}>{verifyError}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[s.primaryBtn, { marginTop: 20 }, verifySlots.some(v => !v) && { opacity: 0.4 }]}
                onPress={handleVerify}
                disabled={verifySlots.some(v => !v)}
                activeOpacity={0.88}
              >
                <View


                  style={[s.primaryBtnInner, { backgroundColor: colors.primary }]}
                >
                  <Text style={s.primaryBtnText}>Verify & Continue</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={s.secondaryBtn} onPress={() => setStep("backup")}>
                <Text style={s.secondaryBtnText}>Back to Seed Phrase</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── IMPORT: ENTER SEED PHRASE ────────────────────────────── */}
          {step === "import_enter" && (
            <>
              <Text style={s.title}>Import Your Wallet</Text>
              <Text style={s.subtitle}>
                Enter your 12-word seed phrase, separated by spaces. Your keys never leave this device.
              </Text>

              <TextInput
                style={s.importTextArea}
                placeholder="word1 word2 word3 ..."
                placeholderTextColor={colors.mutedForeground}
                value={importInput}
                onChangeText={setImportInput}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                numberOfLines={4}
              />

              <View style={[s.wordCountBadge, { backgroundColor: wordCountColor + "20" }]}>
                <Text style={[s.wordCountText, { color: wordCountColor }]}>{wordCount} / 12 words</Text>
              </View>

              <TouchableOpacity
                style={[s.primaryBtn, (wordCount !== 12 || importLoading) && { opacity: 0.4 }]}
                onPress={handleImportSubmit}
                disabled={wordCount !== 12 || importLoading}
              >
                <View  style={[s.primaryBtnInner, { backgroundColor: colors.primary }]}>
                  {importLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.primaryBtnText}>Import Wallet</Text>}
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={s.secondaryBtn} onPress={() => setStep("welcome")}>
                <Text style={s.secondaryBtnText}>Back</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── MONIKER ──────────────────────────────────────────────── */}
          {step === "moniker" && (
            <>
              <Text style={s.title}>Name Your Wallet</Text>
              <Text style={s.subtitle}>
                Choose a name for your wallet (max 32 characters). Use something that helps you recognize it at a glance.
              </Text>

              <TextInput
                style={s.input}
                placeholder="e.g. Main Wallet"
                placeholderTextColor={colors.mutedForeground}
                value={moniker}
                onChangeText={t => setMoniker(t.slice(0, 32))}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={32}
                returnKeyType="done"
                onSubmitEditing={() => moniker.trim() && handleFinish()}
              />

              <TouchableOpacity
                style={[s.primaryBtn, !moniker.trim() && { opacity: 0.4 }]}
                onPress={goToSetPin}
                disabled={!moniker.trim()}
              >
                <View  style={[s.primaryBtnInner, { backgroundColor: colors.primary }]}>
                  <Text style={s.primaryBtnText}>Continue</Text>
                </View>
              </TouchableOpacity>
            </>
          )}

          {/* ── SET PIN ──────────────────────────────────────────────── */}
          {step === "set_pin" && (
            <View style={s.pinSection}>
              {/* Icon */}
              <View style={s.pinIconWrap}>
                <View

                  style={s.pinIconGrad}
                >
                  <Icon name="shield-checkmark" size={34} color={colors.primary} strokeWidth={1.5} />
                </View>
              </View>

              {/* Phase label */}
              <Text style={s.pinPhaseLabel}>
                {pinPhase === "enter" ? "STEP 1 OF 2" : "STEP 2 OF 2"}
              </Text>

              {/* Title */}
              <Text style={s.pinTitle}>
                {pinPhase === "enter" ? "Set a PIN" : "Confirm PIN"}
              </Text>

              {/* Subtitle */}
              <Text style={s.pinSubtitle}>
                {pinPhase === "enter"
                  ? "Add a 6-digit PIN to protect your wallet every time you open the app."
                  : "Re-enter your PIN to confirm it matches."}
              </Text>

              {/* Dots */}
              <Animated.View style={[s.pinDotsRow, { transform: [{ translateX: pinShake }] }]}>
                {Array.from({ length: PIN_LEN }).map((_, i) => {
                  const active = pinPhase === "enter" ? pinDigits : pinConfirm;
                  const filled = i < active.length;
                  return (
                    <View
                      key={i}
                      style={[
                        s.pinDot,
                        filled ? s.pinDotFilled : s.pinDotEmpty,
                        pinError ? s.pinDotError : null,
                      ]}
                    />
                  );
                })}
              </Animated.View>

              {!!pinError
                ? <Text style={s.pinErrorText}>{pinError}</Text>
                : <View style={{ height: 27 }} />
              }

              {/* Keypad */}
              <View style={s.keypad}>
                {([["1","2","3"],["4","5","6"],["7","8","9"]] as string[][]).map((row, ri) => (
                  <View key={ri} style={s.keyRow}>
                    {row.map(k => (
                      <TouchableOpacity key={k} style={s.key} onPress={() => enterPinToSetPin(k)} activeOpacity={0.6}>
                        <Text style={s.keyText}>{k}</Text>
                        {({"2":"ABC","3":"DEF","4":"GHI","5":"JKL","6":"MNO","7":"PQRS","8":"TUV","9":"WXYZ"} as Record<string,string>)[k]
                          ? <Text style={s.keySubText}>{({"2":"ABC","3":"DEF","4":"GHI","5":"JKL","6":"MNO","7":"PQRS","8":"TUV","9":"WXYZ"} as Record<string,string>)[k]}</Text>
                          : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
                <View style={s.keyRow}>
                  <View style={[s.key, s.keyEmpty]} />
                  <TouchableOpacity style={s.key} onPress={() => enterPinToSetPin("0")} activeOpacity={0.6}>
                    <Text style={s.keyText}>0</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.key, s.keyEmpty]} onPress={deletePinDigit} activeOpacity={0.6}>
                    <Icon name="backspace-outline" size={24} color={colors.mutedForeground} strokeWidth={1.5} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Skip */}
              <TouchableOpacity
                style={[s.secondaryBtn, { marginTop: 8 }]}
                onPress={async () => { await handleFinish(); }}
                disabled={finishing}
              >
                <Text style={s.secondaryBtnText}>
                  {finishing ? "Setting up…" : "Skip for now"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── DONE RESTORED (existing node re-imported) ──────────────── */}
          {step === "done_restored" && restoredValidator && (
            <>
              <View style={s.successIcon}>
                <View style={[s.successCircle, { borderColor: colors.success }]}>
                  <Text style={s.successCheck}>✓</Text>
                </View>
              </View>
              <Text style={s.successTitle}>Network Access Restored</Text>
              <View style={s.restoredBadge}>
                <Text style={s.restoredBadgeText}>{restoredValidator.status.toUpperCase()}</Text>
              </View>
              <Text style={s.successText}>
                Your network wallet has been recovered. Your history, earnings, and status are intact.
              </Text>

              <View style={[s.card, { marginTop: 8 }]}>
                <Text style={s.cardTitle}>RESTORED NODE</Text>
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>Moniker</Text>
                  <Text style={s.infoValue}>{restoredValidator.moniker}</Text>
                </View>
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>Commission</Text>
                  <Text style={s.infoValue}>{restoredValidator.commissionRate}%</Text>
                </View>
                <View style={[s.infoRow, { borderBottomWidth: 0 }]}>
                  <Text style={s.infoLabel}>Active Minutes</Text>
                  <Text style={s.infoValue}>{restoredValidator.totalActiveMinutes.toLocaleString()}</Text>
                </View>
              </View>

              <TouchableOpacity style={s.primaryBtn} onPress={() => router.replace("/(tabs)")}>
                <View  style={[s.primaryBtnInner, { backgroundColor: colors.primary }]}>
                  <Text style={s.primaryBtnText}>Enter Wallet</Text>
                </View>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
