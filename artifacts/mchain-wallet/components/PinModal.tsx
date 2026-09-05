import { Icon } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import * as Haptics from "expo-haptics";

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { verifyPin } from "@/services/pin";

const PIN_LENGTH = 6;

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  onSuccess: () => void;
  onCancel?: () => void;
  animationType?: "none" | "slide" | "fade";
}

const KEYPAD_LETTERS: Record<string, string> = {
  "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL",
  "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ",
};

export function PinModal({ visible, title, subtitle, onSuccess, onCancel, animationType = "fade" }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [digits, setDigits] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const dotScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      setDigits("");
      setError("");
      setChecking(false);
      setSubmitted(false);
    }
  }, [visible]);

  useEffect(() => {
    if (digits.length === PIN_LENGTH && !checking) {
      void submit(digits);
    }
  }, [digits]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const ok = await verifyPin(pin);
    if (ok) {
      // Lock the modal immediately — keeps keypad disabled while caller does async work
      setSubmitted(true);
      setDigits("");
      setError("");
      onSuccess();
    } else {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake();
      setError("Incorrect PIN. Please try again.");
      setDigits("");
      setChecking(false);
    }
  }

  function pressKey(key: string) {
    if (checking || submitted) return;
    setError("");
    if (digits.length < PIN_LENGTH) {
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDigits((d) => d + key);
    }
  }

  function pressDelete() {
    if (checking || submitted) return;
    setError("");
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDigits((d) => d.slice(0, -1));
  }

  const hasError = !!error;
  const PRIMARY = colors.primary;

  const BG = colors.background;
  const SURFACE = colors.card;
  const SURFACE2 = colors.secondary;

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
    headerPlaceholder: { width: 40 },
    headerTitle: {
      fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground,
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
      marginTop: 18, minHeight: 20, letterSpacing: 0.1,
    },
    keypad: { width: "100%", gap: 10 },
    keyRow: { flexDirection: "row", justifyContent: "center", gap: 16 },
    key: {
      width: 88, height: 88, borderRadius: 44,
      alignItems: "center", justifyContent: "center",
      backgroundColor: SURFACE,
    },
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
    <Modal visible={visible} animationType={animationType} statusBarTranslucent>
      <View style={s.overlay}>
        {/* ── Header ───────────────────────────────────────────── */}
        <View style={s.header}>
          {onCancel ? (
            <TouchableOpacity style={s.headerBtn} onPress={onCancel} activeOpacity={0.7}>
              <Icon name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          ) : (
            <View style={s.headerPlaceholder} />
          )}
          <Text style={s.headerTitle}>{title}</Text>
          <View style={s.headerPlaceholder} />
        </View>

        <View style={s.inner}>
          {/* ── Top ──────────────────────────────────────────────── */}
          <View style={s.topSection}>
            <View style={s.iconWrap}>
              <View

                style={s.iconGrad}
              >
                <Icon
                  name="lock-closed"
                  size={34}
                  color={PRIMARY}
                  strokeWidth={1.5}
                />
              </View>
            </View>

            <Text style={s.title}>{title}</Text>
            {subtitle ? (
              <Text style={s.subtitle}>{subtitle}</Text>
            ) : null}

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

            {submitted ? (
              <ActivityIndicator color={PRIMARY} style={{ marginTop: 20 }} />
            ) : (
              <Text style={s.error}>{error}</Text>
            )}
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
