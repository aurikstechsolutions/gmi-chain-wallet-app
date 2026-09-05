import { Icon } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { clearPin, setPin, verifyPin } from "@/services/pin";
import * as Haptics from "expo-haptics";

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PIN_LENGTH = 6;

type Mode = "setup" | "change" | "remove";
type Phase = "current" | "new1" | "new2";

interface Props {
  visible: boolean;
  mode: Mode;
  onDone: () => void;
  onCancel: () => void;
}

const KEYPAD_LETTERS: Record<string, string> = {
  "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL",
  "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ",
};

export function PinSetupModal({ visible, mode, onDone, onCancel }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>(mode === "setup" ? "new1" : "current");
  const [digits, setDigits] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const dotScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      setPhase(mode === "setup" ? "new1" : "current");
      setDigits("");
      setFirstPin("");
      setError("");
      setChecking(false);
    }
  }, [visible, mode]);

  useEffect(() => {
    if (digits.length === PIN_LENGTH && !checking) {
      void submit(digits);
    }
  }, [digits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate dot fill
  useEffect(() => {
    if (digits.length > 0 && digits.length < PIN_LENGTH) {
      Animated.sequence([
        Animated.timing(dotScale, { toValue: 1.2, duration: 60, useNativeDriver: true }),
        Animated.timing(dotScale, { toValue: 1, duration: 60, useNativeDriver: true }),
      ]).start();
    }
  }, [digits.length, dotScale]);

  function shake() {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 9, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -9, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 5, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }

  async function submit(pin: string) {
    setChecking(true);

    if (phase === "current") {
      const ok = await verifyPin(pin);
      if (!ok) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        shake();
        setError("Incorrect PIN. Please try again.");
        setDigits("");
        setChecking(false);
        return;
      }
      if (mode === "remove") {
        await clearPin();
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onDone();
        return;
      }
      setPhase("new1");
      setDigits("");
      setError("");
      setChecking(false);
      return;
    }

    if (phase === "new1") {
      setFirstPin(pin);
      setPhase("new2");
      setDigits("");
      setError("");
      setChecking(false);
      return;
    }

    if (phase === "new2") {
      if (pin !== firstPin) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        shake();
        setError("PINs don't match. Please try again.");
        setFirstPin("");
        setPhase("new1");
        setDigits("");
        setChecking(false);
        return;
      }
      await setPin(pin);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
      return;
    }
  }

  function pressKey(key: string) {
    if (checking) return;
    setError("");
    if (digits.length < PIN_LENGTH) {
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDigits((d) => d + key);
    }
  }

  function pressDelete() {
    if (checking) return;
    setError("");
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDigits((d) => d.slice(0, -1));
  }

  function handleBack() {
    if (phase === "new2") {
      setPhase("new1");
      setDigits("");
      setFirstPin("");
      setError("");
    } else {
      onCancel();
    }
  }

  function getTitle() {
    if (phase === "current") return mode === "remove" ? "Confirm Removal" : "Verify Current PIN";
    if (phase === "new1") return mode === "change" ? "Set New PIN" : "Set PIN";
    return "Confirm PIN";
  }

  function getSubtitle() {
    if (phase === "current") return mode === "remove" ? "Enter your current PIN to remove it." : "Enter your current PIN to continue.";
    if (phase === "new1") return "Choose a 6-digit PIN to secure your wallet.";
    return "Re-enter your PIN to confirm.";
  }

  function getStep(): { current: number; total: number } | null {
    if (mode === "setup") return { current: phase === "new1" ? 1 : 2, total: 2 };
    if (mode === "change") return { current: phase === "current" ? 1 : phase === "new1" ? 2 : 3, total: 3 };
    return null;
  }

  const step = getStep();
  const hasError = !!error;
  const showBack = phase === "new2" || (mode === "change" && phase === "new1");

  const BG = colors.background;
  const SURFACE = colors.card;
  const SURFACE2 = colors.secondary;
  const PRIMARY = colors.primary;

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: BG },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: insets.top + 12,
      paddingBottom: 12,
    },
    headerBtn: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: SURFACE,
      alignItems: "center", justifyContent: "center",
    },
    headerTitle: {
      fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground,
    },
    headerStep: {
      flexDirection: "row", alignItems: "center", gap: 4,
    },
    stepDot: {
      width: 6, height: 6, borderRadius: 3,
    },
    inner: {
      flex: 1,
      alignItems: "center",
      justifyContent: "space-between",
      paddingBottom: insets.bottom + 20,
      paddingHorizontal: 28,
    },
    topSection: { alignItems: "center", width: "100%", paddingTop: 24, gap: 0 },
    iconWrap: {
      width: 80, height: 80, borderRadius: 24, marginBottom: 24,
      alignItems: "center", justifyContent: "center",
    },
    iconGrad: {
      width: 80, height: 80, borderRadius: 24,
      alignItems: "center", justifyContent: "center",
    },
    title: {
      fontSize: 26, fontFamily: "Inter_700Bold",
      color: colors.foreground, textAlign: "center", letterSpacing: -0.3,
    },
    subtitle: {
      fontSize: 14, fontFamily: "Inter_400Regular",
      color: colors.mutedForeground, textAlign: "center",
      marginTop: 8, lineHeight: 20,
    },
    dotsRow: {
      flexDirection: "row", gap: 16, marginTop: 40,
    },
    dotOuter: {
      width: 18, height: 18, borderRadius: 9,
      alignItems: "center", justifyContent: "center",
      borderWidth: 1.5,
    },
    dotInner: {
      width: 10, height: 10, borderRadius: 5,
    },
    error: {
      fontSize: 13, fontFamily: "Inter_500Medium",
      color: "#F6465D", textAlign: "center",
      marginTop: 18, minHeight: 20,
      letterSpacing: 0.1,
    },

    // ── Keypad ──────────────────────────────────────────────────────────────────
    keypad: { width: "100%", gap: 10 },
    keyRow: { flexDirection: "row", justifyContent: "center", gap: 16 },
    key: {
      width: 88, height: 88, borderRadius: 44,
      alignItems: "center", justifyContent: "center",
      backgroundColor: SURFACE,
    },
    keyPressed: { backgroundColor: SURFACE2 },
    keyEmpty: { backgroundColor: "transparent" },
    keyNum: {
      fontSize: 26, fontFamily: "Inter_400Regular", color: colors.foreground,
      lineHeight: 30,
    },
    keyLetters: {
      fontSize: 9, fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground, letterSpacing: 1.2, marginTop: 1,
    },
    deleteKey: {
      width: 88, height: 88, borderRadius: 44,
      alignItems: "center", justifyContent: "center",
      backgroundColor: "transparent",
    },
  });

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={s.overlay}>
        {/* ── Header ───────────────────────────────────────────── */}
        <View style={s.header}>
          <TouchableOpacity style={s.headerBtn} onPress={handleBack} activeOpacity={0.7}>
                <Icon name={showBack ? "arrow-back" : "x"} size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{getTitle()}</Text>
          {step ? (
            <View style={s.headerStep}>
              {Array.from({ length: step.total }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    s.stepDot,
                    { backgroundColor: i < step.current ? PRIMARY : SURFACE2 },
                  ]}
                />
              ))}
            </View>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        <View style={s.inner}>
          {/* ── Top ──────────────────────────────────────────────── */}
          <View style={s.topSection}>
            <View style={s.iconWrap}>
              <View

                style={s.iconGrad}
              >
                <Icon
                  name={mode === "remove" ? "lock-open-outline" : "shield-checkmark-outline"}
                  size={34}
                  color={PRIMARY}
                  strokeWidth={1.5}
                />
              </View>
            </View>

            <Text style={s.title}>{getTitle()}</Text>
            <Text style={s.subtitle}>{getSubtitle()}</Text>

            <Animated.View style={[s.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
              {Array.from({ length: PIN_LENGTH }).map((_, i) => {
                const filled = i < digits.length;
                return (
                  <Animated.View
                    key={i}
                    style={[
                      s.dotOuter,
                      {
                        borderColor: hasError
                          ? "#F6465D"
                          : filled
                          ? PRIMARY
                          : "rgba(255,255,255,0.15)",
                        transform: [{ scale: filled && i === digits.length - 1 ? dotScale : 1 }],
                      },
                    ]}
                  >
                    {filled && (
                      <View
                        style={[
                          s.dotInner,
                          { backgroundColor: hasError ? "#F6465D" : PRIMARY },
                        ]}
                      />
                    )}
                  </Animated.View>
                );
              })}
            </Animated.View>

            <Text style={s.error}>{error}</Text>
          </View>

          {/* ── Keypad ───────────────────────────────────────────── */}
          <View style={s.keypad}>
            {(["123", "456", "789"] as string[]).map((row, ri) => (
              <View key={ri} style={s.keyRow}>
                {row.split("").map((k) => (
                  <TouchableOpacity
                    key={k}
                    style={s.key}
                    onPress={() => pressKey(k)}
                    activeOpacity={0.6}
                  >
                    <Text style={s.keyNum}>{k}</Text>
                    {KEYPAD_LETTERS[k] ? (
                      <Text style={s.keyLetters}>{KEYPAD_LETTERS[k]}</Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
            ))}
            <View style={s.keyRow}>
              <View style={[s.key, s.keyEmpty]} />
              <TouchableOpacity style={s.key} onPress={() => pressKey("0")} activeOpacity={0.6}>
                <Text style={s.keyNum}>0</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.deleteKey} onPress={pressDelete} activeOpacity={0.6}>
                <Icon name="backspace-outline" size={24} color={colors.mutedForeground} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
