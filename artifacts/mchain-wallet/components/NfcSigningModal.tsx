import * as Haptics from "expo-haptics";

import { Platform } from "react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { useWallet } from "@/context/WalletContext";
import { useColors } from "@/hooks/useColors";
import { readWalletFromNfc, decryptPrivateKey, cancelNfc, type NfcWalletPayload } from "@/services/nfc";

const PIN_LENGTH = 6;

type Stage = "scanning" | "pinentry" | "decrypting" | "error";

// ── Animated radio-wave rings ─────────────────────────────────────────────────
function ScanRings() {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    function pulse(val: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 1400, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
    }
    const a1 = pulse(ring1, 0);
    const a2 = pulse(ring2, 400);
    const a3 = pulse(ring3, 800);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ringStyle = (val: Animated.Value) => ({
    position: "absolute" as const,
    width: 160, height: 160, borderRadius: 80,
    borderWidth: 2, borderColor: "#6366F1",
    opacity: val.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
  });

  return (
    <View style={{ width: 160, height: 160, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={ringStyle(ring1)} />
      <Animated.View style={ringStyle(ring2)} />
      <Animated.View style={ringStyle(ring3)} />
    </View>
  );
}

// ── Countdown badge ───────────────────────────────────────────────────────────
function CountdownBadge({ expiresAt }: { expiresAt: string | undefined }) {
  const [secsLeft, setSecsLeft] = useState<number>(() => {
    if (!expiresAt) return 0;
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => {
      setSecsLeft(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const mins = Math.floor(secsLeft / 60);
  const secs = secsLeft % 60;
  const urgent = secsLeft <= 60;

  return (
    <View style={{
      flexDirection: "row", alignItems: "center", gap: 5,
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
      backgroundColor: urgent ? "rgba(239,68,68,0.15)" : "rgba(99,102,241,0.12)",
    }}>
      <Icon name="time-outline" size={13} color={urgent ? "#EF4444" : "#818CF8"} />
      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: urgent ? "#EF4444" : "#818CF8" }}>
        {mins}:{String(secs).padStart(2, "0")} left
      </Text>
    </View>
  );
}

// ── PIN dot row ───────────────────────────────────────────────────────────────
function PinDots({ pin }: { pin: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, marginVertical: 20 }}>
      {Array.from({ length: PIN_LENGTH }).map((_, i) => (
        <View key={i} style={{
          width: 14, height: 14, borderRadius: 7,
          backgroundColor: i < pin.length ? "#6366F1" : "transparent",
          borderWidth: 2, borderColor: i < pin.length ? "#6366F1" : "rgba(99,102,241,0.4)",
        }} />
      ))}
    </View>
  );
}

// ── Numpad ────────────────────────────────────────────────────────────────────
function Numpad({ onKey, disabled }: { onKey: (k: string) => void; disabled: boolean }) {
  const keys = ["1","2","3","4","5","6","7","8","9","","0","DEL"];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", width: 260, gap: 10 }}>
      {keys.map((k, i) => (
        <TouchableOpacity
          key={i}
          disabled={disabled || k === ""}
          onPress={() => k && onKey(k)}
          style={{
            width: 76, height: 56, borderRadius: 14,
            backgroundColor: k === "" ? "transparent" : "rgba(255,255,255,0.06)",
            alignItems: "center", justifyContent: "center",
            opacity: disabled || k === "" ? 0.4 : 1,
          }}
        >
          {k === "DEL"
            ? <Icon name="backspace-outline" size={20} color="#94A3B8" />
            : <Text style={{ fontSize: 22, fontFamily: "Inter_500Medium", color: "#F1F5F9" }}>{k}</Text>
          }
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export function NfcSigningModal() {
  const { nfcSigningRequest, resolveNfcSigning, rejectNfcSigning, activeWallet } = useWallet();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const visible = !!nfcSigningRequest;

  const [stage, setStage] = useState<Stage>("scanning");
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [scannedPayload, setScannedPayload] = useState<NfcWalletPayload | null>(null);

  const contentOpacity = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(600)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  // Slide in when visible, slide out when hidden
  useEffect(() => {
    if (visible) {
      setStage("scanning");
      setPin("");
      setErrorMsg("");
      setScannedPayload(null);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 360, useNativeDriver: true, easing: Easing.out(Easing.back(1.05)) }),
        Animated.timing(overlayOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      ]).start(() => startScan());
    } else {
      cancelNfc().catch(() => {});
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 600, duration: 260, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
        Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function crossfadeTo(next: Stage) {
    Animated.timing(contentOpacity, { toValue: 0, duration: 130, useNativeDriver: true }).start(() => {
      setStage(next);
      Animated.timing(contentOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    });
  }

  function shakeError() {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }

  const startScan = useCallback(async () => {
    setPin(""); setErrorMsg("");
    crossfadeTo("scanning");
    try {
      const payload = await readWalletFromNfc();
      if (!payload) {
        crossfadeTo("error");
        setErrorMsg("No wallet found on this card.");
        return;
      }
      // Verify the card matches the active wallet's address
      if (payload.addr !== activeWallet?.mxcAddress) {
        crossfadeTo("error");
        setErrorMsg("This card belongs to a different wallet. Tap the correct card.");
        return;
      }
      setScannedPayload(payload);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      crossfadeTo("pinentry");
    } catch (e) {
      crossfadeTo("error");
      setErrorMsg(e instanceof Error ? e.message : "Scan failed. Try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWallet?.mxcAddress]);

  function handleKey(key: string) {
    if (key === "DEL") { setPin(p => p.slice(0, -1)); return; }
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + key;
    setPin(next);
    if (next.length === PIN_LENGTH) setTimeout(() => handleDecrypt(next), 180);
  }

  async function handleDecrypt(enteredPin: string) {
    if (!scannedPayload) return;
    crossfadeTo("decrypting");
    try {
      const privateKey = await decryptPrivateKey(scannedPayload.enc, scannedPayload.iv, enteredPin);
      if (!privateKey || privateKey.length < 60) throw new Error("Wrong PIN");

      const { hexToBytes } = await import("@/services/crypto");
      const { secp256k1 } = await import("@noble/curves/secp256k1");
      if (!secp256k1.utils.isValidPrivateKey(hexToBytes(privateKey))) throw new Error("Wrong PIN");

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Resolve the pending getPrivateKey() promise — transaction proceeds
      resolveNfcSigning(privateKey);
    } catch {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shakeError();
      setPin("");
      setErrorMsg("Wrong PIN. Try again.");
      crossfadeTo("pinentry");
    }
  }

  function handleCancel() {
    cancelNfc().catch(() => {});
    rejectNfcSigning();
  }

  const s = StyleSheet.create({
    overlay: { flex: 1, justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 32, borderTopRightRadius: 32,
      borderTopWidth: 1, borderColor: colors.border,
      paddingBottom: insets.bottom + 24,
      minHeight: 460,
    },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: 12, marginBottom: 4 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
    title: { fontSize: 17, fontFamily: "Inter_700Bold", color: colors.foreground },
    cancelBtn: { padding: 6 },
    cancelTxt: { fontSize: 15, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    body: { flex: 1, alignItems: "center", paddingHorizontal: 24, paddingTop: 8 },
    badge: {
      paddingHorizontal: 12, paddingVertical: 5,
      borderRadius: 20, marginBottom: 24,
      backgroundColor: "rgba(99,102,241,0.12)",
    },
    badgeTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#818CF8" },
    scanLabel: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center", marginTop: 16 },
    scanSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginTop: 6, lineHeight: 20 },
    errorBox: { backgroundColor: "rgba(239,68,68,0.1)", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginTop: 12 },
    errorTxt: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#EF4444", textAlign: "center" },
    retryBtn: { marginTop: 20, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 14, backgroundColor: "rgba(99,102,241,0.15)" },
    retryTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#818CF8" },
    pinLabel: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center" },
    pinSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginTop: 4 },
    decryptLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, textAlign: "center", marginTop: 24 },
  });

  function renderBody() {
    switch (stage) {
      case "scanning":
        return (
          <>
            <ScanRings />
            <Text style={s.scanLabel}>Tap Your NFC Card</Text>
            <Text style={s.scanSub}>Hold your GMI Wallet card against{"\n"}the back of your phone.</Text>
          </>
        );

      case "pinentry":
        return (
          <Animated.View style={{ alignItems: "center", transform: [{ translateX: shakeAnim }] }}>
            <Icon name="lock-closed-outline" size={44} color="#6366F1" />
            <Text style={[s.pinLabel, { marginTop: 12 }]}>Enter Card PIN</Text>
            <Text style={s.pinSub}>The PIN you set when writing this card.</Text>
            <PinDots pin={pin} />
            {errorMsg ? (
              <View style={s.errorBox}>
                <Text style={s.errorTxt}>{errorMsg}</Text>
              </View>
            ) : null}
            <View style={{ marginTop: 16 }}>
              <Numpad onKey={handleKey} disabled={false} />
            </View>
          </Animated.View>
        );

      case "decrypting":
        return (
          <>
            <Icon name="shield-checkmark-outline" size={56} color="#6366F1" />
            <Text style={s.decryptLabel}>Verifying PIN…</Text>
          </>
        );

      case "error":
        return (
          <>
            <Icon name="wifi-outline" size={52} color="#EF4444" />
            <Text style={[s.scanLabel, { color: "#EF4444", marginTop: 16 }]}>Scan Failed</Text>
            {errorMsg ? (
              <View style={s.errorBox}>
                <Text style={s.errorTxt}>{errorMsg}</Text>
              </View>
            ) : null}
            <TouchableOpacity style={s.retryBtn} onPress={() => startScan()}>
              <Text style={s.retryTxt}>Try Again</Text>
            </TouchableOpacity>
          </>
        );
    }
  }

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={handleCancel}>
      <Animated.View style={[s.overlay, { opacity: overlayOpacity, backgroundColor: "rgba(0,0,0,0.75)" }]}>
        <Animated.View style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View

            style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32 }}
          >
            <View style={s.handle} />
            <View style={s.header}>
              <Text style={s.title}>Sign Transaction</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {activeWallet?.nfcTemporary && activeWallet.nfcSessionExpiresAt
                  ? <CountdownBadge expiresAt={activeWallet.nfcSessionExpiresAt} />
                  : null}
                <TouchableOpacity style={s.cancelBtn} onPress={handleCancel}>
                  <Text style={s.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <Animated.View style={[s.body, { opacity: contentOpacity }]}>
            {renderBody()}
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
