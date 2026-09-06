import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import * as Haptics from "expo-haptics";
import { Icon } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  encryptPrivateKey,
  waitForNfcCard,
  writePayloadToNfc,
  isNfcSupported,
  isNfcEnabled,
  cancelNfc,
  type NfcWalletPayload,
} from "@/services/nfc";

type Status = "pin" | "encrypting" | "waiting" | "writing" | "success" | "error" | "unsupported";

interface Props {
  visible: boolean;
  privateKey: string;
  mxcAddress: string;
  publicKey: string;
  label: string;
  onClose: () => void;
  onSuccess: () => void;
}

const PIN_LENGTH = 6;

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "DEL"],
];
const SUB: Record<string, string> = {
  "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL",
  "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ",
};

function NfcRings({ color }: { color: string }) {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    function animateRing(val: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
    }
    const a1 = animateRing(ring1, 0);
    const a2 = animateRing(ring2, 550);
    const a3 = animateRing(ring3, 1100);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ringStyle = (val: Animated.Value) => ({
    position: "absolute" as const,
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: color,
    opacity: val.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }],
  });

  return (
    <View style={{ width: 200, height: 200, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={ringStyle(ring1)} />
      <Animated.View style={ringStyle(ring2)} />
      <Animated.View style={ringStyle(ring3)} />
    </View>
  );
}

function CardIllustration({ colors }: { colors: ReturnType<typeof useColors> }) {
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -7, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 7, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
    return () => floatAnim.stopAnimation();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={{ transform: [{ translateY: floatAnim }], marginBottom: 4 }}>
      <View


        style={{
          width: 130, height: 82, borderRadius: 12,
          padding: 12, justifyContent: "space-between",
          shadowColor: "#6366F1", shadowOpacity: 0.5,
          shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
          elevation: 12,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Icon name="wifi-outline" size={20} color="rgba(255,255,255,0.7)" />
        </View>
        <View>
          <View style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)", marginBottom: 4 }} />
          <View style={{ width: 48, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)" }} />
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * Shown while PBKDF2 is running. All animations use useNativeDriver:true so
 * they keep running on the native thread even while JS is frozen by PBKDF2.
 */
function EncryptingView({ colors }: { colors: ReturnType<typeof useColors> }) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    // Spinning outer ring — native driver, immune to JS freeze
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true })
    ).start();

    // Gentle pulse on the shield icon
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    // Staggered dots — native driver
    function animDot(val: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0.3, duration: 400, useNativeDriver: true }),
          Animated.delay(800 - delay),
        ])
      );
    }
    const a1 = animDot(dot1, 0);
    const a2 = animDot(dot2, 200);
    const a3 = animDot(dot3, 400);
    a1.start(); a2.start(); a3.start();

    return () => {
      spin.stopAnimation(); pulse.stopAnimation();
      dot1.stopAnimation(); dot2.stopAnimation(); dot3.stopAnimation();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={{ alignItems: "center", paddingTop: 16, paddingBottom: 8 }}>
      {/* Spinning ring + pulsing shield */}
      <View style={{ width: 120, height: 120, alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        {/* Outer spinning dashed ring */}
        <Animated.View style={{
          position: "absolute",
          width: 110, height: 110, borderRadius: 55,
          borderWidth: 2,
          borderColor: "#6366F1",
          borderStyle: "dashed",
          opacity: 0.5,
          transform: [{ rotate: spinDeg }],
        }} />
        {/* Static inner ring */}
        <View style={{
          position: "absolute",
          width: 88, height: 88, borderRadius: 44,
          borderWidth: 1, borderColor: "#6366F130",
          backgroundColor: "#6366F108",
        }} />
        {/* Pulsing shield icon */}
        <Animated.View style={{
          transform: [{ scale: pulse }],
          alignItems: "center", justifyContent: "center",
          width: 72, height: 72, borderRadius: 24,
          backgroundColor: "#6366F118",
          borderWidth: 1.5, borderColor: "#6366F140",
        }}>
          <Icon name="shield-checkmark" size={34} color="#818CF8" />
        </Animated.View>
      </View>

      {/* Text */}
      <Text style={{
        fontSize: 11, fontFamily: "Inter_700Bold",
        color: "#818CF8", letterSpacing: 1.8, marginBottom: 6,
      }}>
        SECURING
      </Text>
      <Text style={{
        fontSize: 22, fontFamily: "Inter_700Bold",
        color: colors.foreground, marginBottom: 8, textAlign: "center",
      }}>
        Encrypting your wallet
      </Text>
      <Text style={{
        fontSize: 13, fontFamily: "Inter_400Regular",
        color: colors.mutedForeground, textAlign: "center",
        lineHeight: 20, paddingHorizontal: 20, marginBottom: 24,
      }}>
        Generating encryption keys from your PIN.{"\n"}This takes a few seconds.
      </Text>

      {/* Animated dots */}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 8 }}>
        {[dot1, dot2, dot3].map((d, i) => (
          <Animated.View key={i} style={{
            width: 8, height: 8, borderRadius: 4,
            backgroundColor: "#6366F1",
            opacity: d,
          }} />
        ))}
      </View>

      {/* Security badges */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        {["AES-256", "PBKDF2", "PIN-LOCKED"].map(badge => (
          <View key={badge} style={{
            flexDirection: "row", alignItems: "center", gap: 4,
            backgroundColor: "#6366F110", borderWidth: 1, borderColor: "#6366F125",
            borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
          }}>
            <Icon name="lock-closed" size={9} color="#818CF8" />
            <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#818CF8", letterSpacing: 0.5 }}>
              {badge}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function NfcWriteModal({ visible, privateKey, mxcAddress, publicKey, label, onClose, onSuccess }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [status, setStatus] = useState<Status>("pin");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinStep, setPinStep] = useState<"enter" | "confirm">("enter");
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const slideAnim = useRef(new Animated.Value(600)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const lockScale = useRef(new Animated.Value(1)).current;
  const lockGlow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setStatus("pin");
      setPin(""); setConfirmPin(""); setPinStep("enter"); setErrorMsg("");
      successScale.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.back(1.1)) }),
        Animated.timing(overlayOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
      checkNfcSupport();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 600, duration: 280, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
        Animated.timing(overlayOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status === "pin") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(lockGlow, { toValue: 1, duration: 1200, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(lockGlow, { toValue: 0, duration: 1200, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      ).start();
    } else {
      lockGlow.stopAnimation();
    }
    if (status === "success") {
      Animated.spring(successScale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 6 }).start();
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkNfcSupport() {
    const supported = await isNfcSupported();
    if (!supported) { setStatus("unsupported"); return; }
    const enabled = await isNfcEnabled();
    if (!enabled) { setStatus("unsupported"); setErrorMsg("NFC is disabled. Enable it in your phone settings."); }
  }

  function shakeError() {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 4, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }

  function crossfadeTo(nextStatus: Status) {
    Animated.timing(contentOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setStatus(nextStatus);
      Animated.timing(contentOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  }

  function handleKeyPress(key: string) {
    if (pinStep === "enter") {
      if (key === "DEL") { setPin(p => p.slice(0, -1)); return; }
      if (pin.length >= PIN_LENGTH) return;
      const next = pin + key;
      setPin(next);
      if (next.length === PIN_LENGTH) setTimeout(() => setPinStep("confirm"), 180);
    } else {
      if (key === "DEL") { setConfirmPin(p => p.slice(0, -1)); return; }
      if (confirmPin.length >= PIN_LENGTH) return;
      const next = confirmPin + key;
      setConfirmPin(next);
      if (next.length === PIN_LENGTH) setTimeout(() => handlePinConfirmed(pin, next), 180);
    }
  }

  async function handlePinConfirmed(enteredPin: string, confirmed: string) {
    if (enteredPin !== confirmed) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shakeError();
      setErrorMsg("PINs don't match. Try again.");
      setPin(""); setConfirmPin(""); setPinStep("enter");
      return;
    }
    setErrorMsg("");

    // Step 1: Show encrypting screen immediately.
    // All its animations use useNativeDriver:true so they keep running on the
    // native thread even while PBKDF2 completely freezes the JS thread.
    crossfadeTo("encrypting");

    // Step 2: Yield 350ms — enough for the crossfade + encrypting screen to
    // fully render and start its native-driver animations before JS freezes.
    await new Promise(r => setTimeout(r, 350));

    try {
      // Step 3: Run NFC card detection AND PBKDF2 encryption in parallel.
      // The user can tap their card during the encryption phase — the app is
      // already listening. Both must complete before writing begins.
      const [{ enc, iv }] = await Promise.all([
        encryptPrivateKey(privateKey, enteredPin),
        waitForNfcCard(),
      ]);

      // Step 4: Both ready — switch to "writing" and write immediately
      crossfadeTo("writing");
      const payload: NfcWalletPayload = { v: 1, enc, iv, addr: mxcAddress, label };
      await writePayloadToNfc(payload);

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      crossfadeTo("success");
    } catch (e) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorMsg(e instanceof Error ? e.message : "Write failed. Try again.");
      crossfadeTo("error");
    }
  }

  function handleClose() {
    cancelNfc().catch(() => {});
    onClose();
  }

  const currentPin = pinStep === "enter" ? pin : confirmPin;

  const s = StyleSheet.create({
    overlay: { flex: 1, justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 32, borderTopRightRadius: 32,
      borderTopWidth: 1, borderColor: colors.border,
      paddingBottom: insets.bottom + 12,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: 14, marginBottom: 4 },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 24, paddingVertical: 18,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    title: { fontSize: 17, fontFamily: "Inter_700Bold", color: colors.foreground },
    closeBtn: {
      width: 34, height: 34, borderRadius: 17, backgroundColor: colors.card,
      borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
    },
    body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 8, alignItems: "center" },

    securityBadge: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: "#6366F110", borderWidth: 1, borderColor: "#6366F125",
      borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 20, marginTop: 8,
    },
    securityBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#818CF8", letterSpacing: 0.4 },

    pinLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 4, textAlign: "center" },
    pinTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 6, textAlign: "center" },
    pinSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginBottom: 20, lineHeight: 19 },
    dots: { flexDirection: "row", gap: 12, marginBottom: 28 },
    dot: { width: 14, height: 14, borderRadius: 7 },
    dotFilled: { backgroundColor: "#6366F1" },
    dotEmpty: { backgroundColor: colors.border },
    dotError: { backgroundColor: "#EF4444" },

    keypad: { width: "100%", gap: 8 },
    keyRow: { flexDirection: "row", justifyContent: "center", gap: 8 },
    key: {
      width: 92, height: 68, borderRadius: 20,
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      alignItems: "center", justifyContent: "center",
    },
    keyNum: { fontSize: 24, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    keySub: { fontSize: 8, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 2 },
    keyDel: { backgroundColor: "transparent", borderColor: "transparent" },
    errorText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#EF4444", textAlign: "center", marginBottom: 8 },
    cancelText: { fontSize: 14, fontFamily: "Inter_500Medium", color: colors.mutedForeground, paddingVertical: 12 },

    nfcLabel: { fontSize: 11, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 6 },
    nfcTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center", marginBottom: 6 },
    nfcSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", lineHeight: 20, marginBottom: 20, paddingHorizontal: 16 },

    successWrap: { alignItems: "center", paddingVertical: 20 },
    successCircle: {
      width: 88, height: 88, borderRadius: 44,
      backgroundColor: "#10B98115", borderWidth: 1.5, borderColor: "#10B98140",
      alignItems: "center", justifyContent: "center", marginBottom: 20,
    },
    successTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center", marginBottom: 8 },
    successSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", lineHeight: 20, marginBottom: 28, paddingHorizontal: 8 },
    successPill: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: "#10B98110", borderWidth: 1, borderColor: "#10B98130",
      borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 28,
    },
    successPillText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#10B981" },

    primaryBtn: { width: "100%", borderRadius: 16, overflow: "hidden", marginBottom: 10 },
    primaryGrad: { paddingVertical: 16, alignItems: "center", justifyContent: "center" },
    primaryBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" },
    ghostBtn: { paddingVertical: 10 },
    ghostBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: colors.mutedForeground, textAlign: "center" },

    errorWrap: { alignItems: "center", paddingVertical: 12 },
    errorCircle: {
      width: 88, height: 88, borderRadius: 44,
      backgroundColor: "#EF444415", borderWidth: 1.5, borderColor: "#EF444435",
      alignItems: "center", justifyContent: "center", marginBottom: 20,
    },
    retryBtn: {
      width: "100%", borderRadius: 16, borderWidth: 1.5,
      borderColor: colors.border, paddingVertical: 15, alignItems: "center", marginBottom: 10,
    },
    retryText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
  });

  function renderContent() {
    if (status === "unsupported") {
      return (
        <View style={s.body}>
          <View style={[s.errorCircle, { marginTop: 16 }]}>
            <Icon name="wifi-outline" size={40} color="#EF4444" />
          </View>
          <Text style={s.nfcTitle}>NFC Not Available</Text>
          <Text style={s.nfcSubtitle}>{errorMsg || "This device doesn't support NFC or it's not enabled."}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={handleClose}>
            <Text style={s.retryText}>Close</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (status === "pin") {
      const isError = !!errorMsg;
      return (
        <View style={s.body}>
          <View style={s.securityBadge}>
            <Icon name="shield-checkmark-outline" size={12} color="#818CF8" />
            <Text style={s.securityBadgeText}>AES-256 ENCRYPTION</Text>
          </View>
          <Animated.View style={{
            opacity: lockGlow.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
            transform: [{ scale: lockGlow.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.03] }) }],
            marginBottom: 16,
          }}>
            <View  style={{
              width: 72, height: 72, borderRadius: 24, alignItems: "center", justifyContent: "center",
              borderWidth: 1, borderColor: "#6366F130",
            }}>
              <Icon name={pinStep === "confirm" ? "lock-closed" : "lock-open-outline"} size={32} color="#6366F1" />
            </View>
          </Animated.View>
          <Text style={s.pinLabel}>{pinStep === "enter" ? "STEP 1 OF 2" : "STEP 2 OF 2"}</Text>
          <Text style={s.pinTitle}>{pinStep === "enter" ? "Set Card PIN" : "Confirm PIN"}</Text>
          <Text style={s.pinSubtitle}>
            {pinStep === "enter"
              ? "Choose a 6-digit PIN to encrypt your wallet on the card."
              : "Re-enter your PIN to confirm. This cannot be recovered."}
          </Text>
          {!!errorMsg && <Text style={s.errorText}>{errorMsg}</Text>}
          <Animated.View style={[s.dots, { transform: [{ translateX: shakeAnim }] }]}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View key={i} style={[
                s.dot,
                i < currentPin.length ? (isError ? s.dotError : s.dotFilled) : s.dotEmpty,
              ]} />
            ))}
          </Animated.View>
          <View style={s.keypad}>
            {KEYS.map((row, ri) => (
              <View key={ri} style={s.keyRow}>
                {row.map((k, ki) => {
                  if (!k) return <View key={ki} style={s.key} />;
                  return (
                    <TouchableOpacity key={ki} style={[s.key, k === "DEL" && s.keyDel]} onPress={() => handleKeyPress(k)} activeOpacity={0.6}>
                      {k === "DEL" ? (
                        <Icon name="backspace-outline" size={22} color={colors.foreground} />
                      ) : (
                        <>
                          <Text style={s.keyNum}>{k}</Text>
                          {SUB[k] && <Text style={s.keySub}>{SUB[k]}</Text>}
                        </>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
          <TouchableOpacity onPress={handleClose} style={s.ghostBtn}>
            <Text style={s.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (status === "encrypting") {
      return (
        <View style={s.body}>
          <EncryptingView colors={colors} />
        </View>
      );
    }

    if (status === "waiting" || status === "writing") {
      return (
        <View style={s.body}>
          <View style={{ alignItems: "center", justifyContent: "center", marginTop: 8, marginBottom: 0 }}>
            <NfcRings color="#6366F1" />
            <View style={{ position: "absolute", alignItems: "center", justifyContent: "center" }}>
              <CardIllustration colors={colors} />
            </View>
          </View>
          <Text style={s.nfcLabel}>{status === "writing" ? "WRITING…" : "READY TO WRITE"}</Text>
          <Text style={s.nfcTitle}>{status === "writing" ? "Writing to card…" : "Hold card to phone"}</Text>
          <Text style={s.nfcSubtitle}>
            {status === "writing"
              ? "Keep the card flat against the back of your phone. Don't move."
              : "Place your NFC card flat against the back of your phone near the camera."}
          </Text>
          {status === "writing" && (
            <ActivityIndicator color="#6366F1" size="small" style={{ marginBottom: 16 }} />
          )}
          {status === "waiting" && (
            <TouchableOpacity onPress={handleClose} style={s.ghostBtn}>
              <Text style={s.ghostBtnText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    if (status === "success") {
      return (
        <View style={[s.body, s.successWrap]}>
          <Animated.View style={[s.successCircle, { transform: [{ scale: successScale }] }]}>
            <Icon name="checkmark-circle" size={48} color="#10B981" />
          </Animated.View>
          <Text style={s.successTitle}>Wallet Saved to Card!</Text>
          <Text style={s.successSub}>
            Your encrypted wallet is stored on the NFC card. Tap it on the home screen anytime to load it.
          </Text>
          <View style={s.successPill}>
            <Icon name="shield-checkmark" size={14} color="#10B981" />
            <Text style={s.successPillText}>PIN-protected · AES-256 encrypted</Text>
          </View>
          <TouchableOpacity
            style={[s.primaryBtn, saving && { opacity: 0.7 }]}
            disabled={saving}
            onPress={async () => {
              setSaving(true);
              try { await onSuccess(); } finally { setSaving(false); }
              onClose();
            }}
            activeOpacity={0.85}
          >
            <View  style={s.primaryGrad}>
              {saving
                ? <ActivityIndicator color="#FFF" />
                : <Text style={s.primaryBtnText}>Done</Text>}
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    if (status === "error") {
      return (
        <View style={[s.body, s.errorWrap]}>
          <Animated.View style={[s.errorCircle, { transform: [{ translateX: shakeAnim }] }]}>
            <Icon name="close-circle" size={48} color="#EF4444" />
          </Animated.View>
          <Text style={s.nfcTitle}>Write Failed</Text>
          <Text style={s.nfcSubtitle}>{errorMsg}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => {
            setPin(""); setConfirmPin(""); setPinStep("enter"); setErrorMsg("");
            crossfadeTo("pin");
          }}>
            <Text style={s.retryText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClose} style={s.ghostBtn}>
            <Text style={s.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.8)", opacity: overlayOpacity }]} pointerEvents="none" />
      <View style={s.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={handleClose} />
        <Animated.View style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>Save to NFC Card</Text>
            <TouchableOpacity style={s.closeBtn} onPress={handleClose}>
              <Icon name="close" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <Animated.View style={{ opacity: contentOpacity }}>
            {renderContent()}
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}
