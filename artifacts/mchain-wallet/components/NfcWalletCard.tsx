import React, { useRef, useState, useEffect } from "react";
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
import { useWallet } from "@/context/WalletContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  readWalletFromNfc,
  decryptPrivateKey,
  isNfcSupported,
  cancelNfc,
  eraseNfcCard,
  type NfcWalletPayload,
} from "@/services/nfc";

type ScanStatus =
  | "idle"
  | "manage"
  | "timeout"
  | "scanning"
  | "pinentry"
  | "decrypting"
  | "success"
  | "erasing"
  | "erased"
  | "erase_error"
  | "error"
  | "unsupported";

const NFC_TIMEOUT_KEY = "nfc_auto_timeout_mins";
const TIMEOUT_OPTIONS: { label: string; value: number }[] = [
  { label: "5 minutes", value: 5 },
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "Never", value: 0 },
];

const PIN_LENGTH = 6;
const KEYS = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "DEL"]];
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
            toValue: 1, duration: 1800,
            easing: Easing.out(Easing.ease), useNativeDriver: true,
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
    width: 200, height: 200, borderRadius: 100,
    borderWidth: 1.5, borderColor: color,
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

function CardIllustration() {
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
    <Animated.View style={{ transform: [{ translateY: floatAnim }] }}>
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

interface NfcWalletCardProps {
  /** When true the Card Vault modal opens immediately (controlled from outside) */
  open?: boolean;
  onClose?: () => void;
  /** When true the visible card is not rendered — only the modal is kept (for header-icon-only access) */
  hideCard?: boolean;
}

export function NfcWalletCard({ open, onClose, hideCard }: NfcWalletCardProps = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { wallets, addNfcTemporaryWallet, switchWallet } = useWallet();

  const [nfcSupported, setNfcSupported] = useState<boolean | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [scannedPayload, setScannedPayload] = useState<NfcWalletPayload | null>(null);
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [eraseErrorMsg, setEraseErrorMsg] = useState("");
  const [timeoutMins, setTimeoutMins] = useState(5);

  // Load stored timeout preference
  useEffect(() => {
    AsyncStorage.getItem(NFC_TIMEOUT_KEY).then(val => {
      if (val !== null) setTimeoutMins(Number(val));
    });
  }, []);

  const slideAnim = useRef(new Animated.Value(600)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const cardGlow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    isNfcSupported().then(setNfcSupported);
  }, []);

  // Open modal when parent sets open=true (header button)
  useEffect(() => {
    if (open) openModal();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (nfcSupported) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(cardGlow, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(cardGlow, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    }
  }, [nfcSupported]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scanStatus === "success") {
      Animated.spring(successScale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 6 }).start();
    }
  }, [scanStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  function crossfadeTo(next: ScanStatus) {
    Animated.timing(contentOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setScanStatus(next);
      Animated.timing(contentOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
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

  function openModal() {
    successScale.setValue(0);
    setModalVisible(true);
    setScanStatus("manage");
    setScannedPayload(null);
    setPin(""); setErrorMsg(""); setEraseErrorMsg("");
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.back(1.1)) }),
      Animated.timing(overlayOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
  }

  function closeModal() {
    cancelNfc().catch(() => {});
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 600, duration: 280, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
      Animated.timing(overlayOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      setModalVisible(false);
      onClose?.();
    });
  }

  async function startScan() {
    setPin(""); setErrorMsg("");
    crossfadeTo("scanning");
    try {
      const payload = await readWalletFromNfc();
      if (!payload) {
        crossfadeTo("error");
         setErrorMsg("No wallet found on this card. Make sure it's a GMI Wallet NFC card.");
        return;
      }
      setScannedPayload(payload);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      crossfadeTo("pinentry");
    } catch (e) {
      crossfadeTo("error");
      setErrorMsg(e instanceof Error ? e.message : "Scan failed. Try again.");
    }
  }

  function handleKeyPress(key: string) {
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
      const keyBytes = hexToBytes(privateKey);
      const { secp256k1 } = await import("@noble/curves/secp256k1");
      if (!secp256k1.utils.isValidPrivateKey(keyBytes)) throw new Error("Wrong PIN");

      const { keccak_256 } = await import("@noble/hashes/sha3");
      const { bech32 } = await import("bech32");
      const pubKeyCompressed = secp256k1.getPublicKey(keyBytes, true);
      const pubKeyUncompressed = secp256k1.getPublicKey(keyBytes, false);
      const pubKeyHash = keccak_256(pubKeyUncompressed.slice(1));
      const addressBytes = pubKeyHash.slice(-20);
      const ethAddress = "0x" + Array.from(addressBytes).map(b => b.toString(16).padStart(2, "0")).join("");
      const words = bech32.toWords(addressBytes);
      const mxcAddress = bech32.encode("gmi", words);

      const keypair = {
        privateKey,
        publicKey: Array.from(pubKeyCompressed).map(b => b.toString(16).padStart(2, "0")).join(""),
        ethAddress, mxcAddress,
      };

      // If this wallet is already saved in the app, switch to it instead of creating a duplicate session
      const existing = wallets.find(w => w.mxcAddress === mxcAddress && !w.nfcTemporary);
      if (existing) {
        await switchWallet(existing.id);
      } else {
        const entry = await addNfcTemporaryWallet(keypair, scannedPayload.label || "NFC Wallet", timeoutMins);
        await switchWallet(entry.id);
      }
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      crossfadeTo("success");
    } catch {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shakeError();
      setErrorMsg("Wrong PIN. The card could not be decrypted.");
      setPin("");
      crossfadeTo("pinentry");
    }
  }

  async function startErase() {
    setEraseErrorMsg("");
    crossfadeTo("erasing");
    try {
      await eraseNfcCard();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      crossfadeTo("erased");
    } catch (e) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setEraseErrorMsg(e instanceof Error ? e.message : "Erase failed. Try again.");
      crossfadeTo("erase_error");
    }
  }

  async function saveTimeout(mins: number) {
    setTimeoutMins(mins);
    await AsyncStorage.setItem(NFC_TIMEOUT_KEY, String(mins));
    crossfadeTo("manage");
  }

  const s = StyleSheet.create({
    card: { marginHorizontal: 16, marginBottom: 16, borderRadius: 20, overflow: "hidden" },
    cardBorder: { borderRadius: 20, borderWidth: 1, borderColor: colors.border },
    cardInner: { flexDirection: "row", alignItems: "center", padding: 16, gap: 14 },
    iconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    textWrap: { flex: 1 },
    cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 2 },
    cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 17 },
    arrowWrap: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },

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

    nfcLabel: { fontSize: 11, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 6 },
    nfcTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center", marginBottom: 6 },
    nfcSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", lineHeight: 20, marginBottom: 20, paddingHorizontal: 8 },

    pinLabel: { fontSize: 11, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 4 },
    pinTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center", marginBottom: 4 },
    pinSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginBottom: 16 },
    dots: { flexDirection: "row", gap: 12, marginBottom: 26 },
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

    successCircle: {
      width: 88, height: 88, borderRadius: 44,
      backgroundColor: "#10B98115", borderWidth: 1.5, borderColor: "#10B98140",
      alignItems: "center", justifyContent: "center", marginBottom: 20, marginTop: 8,
    },
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

    errorCircle: {
      width: 88, height: 88, borderRadius: 44,
      backgroundColor: "#EF444415", borderWidth: 1.5, borderColor: "#EF444435",
      alignItems: "center", justifyContent: "center", marginBottom: 20, marginTop: 8,
    },
    retryBtn: {
      width: "100%", borderRadius: 16, borderWidth: 1.5,
      borderColor: colors.border, paddingVertical: 15, alignItems: "center", marginBottom: 10,
    },
    retryText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },

    // ── Manage view ────────────────────────────────────────────────────────
    manageList: { width: "100%", gap: 10, paddingTop: 8, paddingBottom: 16 },
    manageOption: {
      flexDirection: "row", alignItems: "center", gap: 14,
      backgroundColor: colors.card, borderRadius: 16,
      borderWidth: 1, borderColor: colors.border,
      padding: 16,
    },
    manageOptionDanger: { borderColor: "#EF444430", backgroundColor: "#EF444408" },
    manageIconWrap: {
      width: 44, height: 44, borderRadius: 14,
      alignItems: "center", justifyContent: "center",
    },
    manageOptionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    manageOptionSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 1 },
    manageOptionArrow: { marginLeft: "auto" as unknown as number },

    // ── Timeout view ───────────────────────────────────────────────────────
    timeoutList: { width: "100%", gap: 8, paddingTop: 8, paddingBottom: 16 },
    timeoutOption: {
      flexDirection: "row", alignItems: "center",
      backgroundColor: colors.card, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border,
      paddingVertical: 14, paddingHorizontal: 16,
    },
    timeoutOptionActive: { borderColor: colors.primary + "60", backgroundColor: colors.primary + "10" },
    timeoutOptionLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: colors.foreground },
    timeoutOptionLabelActive: { fontFamily: "Inter_700Bold", color: colors.primary },
    timeoutCheck: {
      width: 22, height: 22, borderRadius: 11,
      backgroundColor: colors.primary + "20",
      alignItems: "center", justifyContent: "center",
    },

    // ── Erase erased view ─────────────────────────────────────────────────
    warningCircle: {
      width: 88, height: 88, borderRadius: 44,
      backgroundColor: "#F59E0B15", borderWidth: 1.5, borderColor: "#F59E0B40",
      alignItems: "center", justifyContent: "center", marginBottom: 20, marginTop: 8,
    },
    dangerBtn: {
      width: "100%", borderRadius: 16, overflow: "hidden", marginBottom: 10,
    },
    dangerGrad: { paddingVertical: 16, alignItems: "center", justifyContent: "center" },
    dangerBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" },
  });

  if (nfcSupported === false) return null;

  function renderSheetContent() {
    // ── Manage menu ─────────────────────────────────────────────────────────
    if (scanStatus === "manage") {
      const currentLabel = TIMEOUT_OPTIONS.find(o => o.value === timeoutMins)?.label ?? "5 minutes";
      return (
        <View style={[s.body, { alignItems: "stretch" }]}>
          <View style={s.manageList}>
            <TouchableOpacity style={s.manageOption} onPress={() => { setPin(""); setErrorMsg(""); startScan(); }} activeOpacity={0.75}>
              <View  style={s.manageIconWrap}>
                <Icon name="wifi-outline" size={22} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.manageOptionTitle}>Load from Card</Text>
                <Text style={s.manageOptionSub}>Scan an NFC wallet card to load it into the app</Text>
              </View>
              <Icon name="chevron-forward" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>

            <TouchableOpacity style={s.manageOption} onPress={() => crossfadeTo("timeout")} activeOpacity={0.75}>
              <View  style={s.manageIconWrap}>
                <Icon name="time-outline" size={22} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.manageOptionTitle}>Auto Timeout</Text>
                <Text style={s.manageOptionSub}>Session expires after: {currentLabel}</Text>
              </View>
              <Icon name="chevron-forward" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>

            <TouchableOpacity style={[s.manageOption, s.manageOptionDanger]} onPress={startErase} activeOpacity={0.75}>
              <View style={[s.manageIconWrap, { backgroundColor: "#EF444420" }]}>
                <Icon name="trash-outline" size={22} color="#EF4444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.manageOptionTitle, { color: "#EF4444" }]}>Erase Card</Text>
                <Text style={s.manageOptionSub}>Remove wallet data from an NFC card</Text>
              </View>
              <Icon name="chevron-forward" size={16} color="#EF444470" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={closeModal} style={s.ghostBtn}>
            <Text style={s.ghostBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // ── Auto Timeout picker ─────────────────────────────────────────────────
    if (scanStatus === "timeout") {
      return (
        <View style={[s.body, { alignItems: "stretch" }]}>
          <Text style={[s.nfcLabel, { marginTop: 8 }]}>AUTO TIMEOUT</Text>
          <Text style={[s.nfcTitle, { fontSize: 18, textAlign: "left", marginBottom: 4 }]}>Session Duration</Text>
          <Text style={[s.nfcSubtitle, { textAlign: "left", marginBottom: 12 }]}>
            NFC wallet sessions are automatically removed after this time. Set to Never to keep the session until you manually remove it.
          </Text>
          <View style={s.timeoutList}>
            {TIMEOUT_OPTIONS.map(opt => {
              const active = opt.value === timeoutMins;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.timeoutOption, active && s.timeoutOptionActive]}
                  onPress={() => saveTimeout(opt.value)}
                  activeOpacity={0.75}
                >
                  <Text style={[s.timeoutOptionLabel, active && s.timeoutOptionLabelActive]}>{opt.label}</Text>
                  {active && (
                    <View style={s.timeoutCheck}>
                      <Icon name="checkmark" size={13} color={colors.primary} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity onPress={() => crossfadeTo("manage")} style={s.ghostBtn}>
            <Text style={s.ghostBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // ── Erase — hold card screen ────────────────────────────────────────────
    if (scanStatus === "erasing") {
      return (
        <View style={s.body}>
          <View style={{ alignItems: "center", justifyContent: "center", marginTop: 8 }}>
            <NfcRings color="#EF4444" />
            <View style={{ position: "absolute" }}>
              <CardIllustration />
            </View>
          </View>
          <Text style={[s.nfcLabel, { color: "#EF4444" }]}>ERASING</Text>
          <Text style={s.nfcTitle}>Hold card to phone</Text>
          <Text style={s.nfcSubtitle}>Place the NFC card against the back of your phone. The wallet data will be overwritten.</Text>
          <TouchableOpacity onPress={() => { cancelNfc().catch(() => {}); crossfadeTo("manage"); }} style={s.ghostBtn}>
            <Text style={s.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // ── Erase — success ─────────────────────────────────────────────────────
    if (scanStatus === "erased") {
      return (
        <View style={s.body}>
          <View style={s.successCircle}>
            <Icon name="checkmark-circle" size={48} color="#10B981" />
          </View>
          <Text style={s.nfcTitle}>Card Erased</Text>
          <Text style={s.nfcSubtitle}>The wallet data has been removed from the card. It is now blank and can be rewritten.</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={closeModal} activeOpacity={0.85}>
            <View  style={s.primaryGrad}>
              <Text style={s.primaryBtnText}>Done</Text>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    // ── Erase — error ───────────────────────────────────────────────────────
    if (scanStatus === "erase_error") {
      return (
        <View style={s.body}>
          <View style={s.errorCircle}>
            <Icon name="close-circle" size={48} color="#EF4444" />
          </View>
          <Text style={s.nfcTitle}>Erase Failed</Text>
          <Text style={s.nfcSubtitle}>{eraseErrorMsg || "Could not erase the card. Try again."}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => { setEraseErrorMsg(""); startErase(); }}>
            <Text style={s.retryText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => crossfadeTo("manage")} style={s.ghostBtn}>
            <Text style={s.ghostBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (scanStatus === "scanning") {
      return (
        <View style={s.body}>
          <View style={{ alignItems: "center", justifyContent: "center", marginTop: 8 }}>
            <NfcRings color="#6366F1" />
            <View style={{ position: "absolute" }}>
              <CardIllustration />
            </View>
          </View>
          <Text style={s.nfcLabel}>SCANNING</Text>
          <Text style={s.nfcTitle}>Hold card to phone</Text>
          <Text style={s.nfcSubtitle}>Place your NFC wallet card flat against the back of your phone near the camera area.</Text>
          <TouchableOpacity onPress={closeModal} style={s.ghostBtn}>
            <Text style={s.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (scanStatus === "pinentry") {
      const hasError = !!errorMsg;
      return (
        <View style={s.body}>
          <View  style={{
            width: 72, height: 72, borderRadius: 24, alignItems: "center", justifyContent: "center",
            borderWidth: 1, borderColor: "#6366F130", marginTop: 8, marginBottom: 16,
          }}>
            <Icon name="lock-closed" size={32} color="#6366F1" />
          </View>
          <Text style={s.pinLabel}>ENTER CARD PIN</Text>
          <Text style={s.pinTitle}>{scannedPayload?.label || "NFC Wallet"}</Text>
          <Text style={s.pinSub}>Enter the 6-digit PIN you set when writing this card.</Text>
          {!!errorMsg && <Text style={s.errorText}>{errorMsg}</Text>}
          <Animated.View style={[s.dots, { transform: [{ translateX: shakeAnim }] }]}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View key={i} style={[s.dot, i < pin.length ? (hasError ? s.dotError : s.dotFilled) : s.dotEmpty]} />
            ))}
          </Animated.View>
          <View style={s.keypad}>
            {KEYS.map((row, ri) => (
              <View key={ri} style={s.keyRow}>
                {row.map((k, ki) => {
                  if (!k) return <View key={ki} style={s.key} />;
                  return (
                    <TouchableOpacity key={ki} style={[s.key, k === "DEL" && s.keyDel]} onPress={() => handleKeyPress(k)} activeOpacity={0.6}>
                      {k === "DEL"
                        ? <Icon name="backspace-outline" size={22} color={colors.foreground} />
                        : (<>
                          <Text style={s.keyNum}>{k}</Text>
                          {SUB[k] && <Text style={s.keySub}>{SUB[k]}</Text>}
                        </>)}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
          <TouchableOpacity onPress={closeModal} style={[s.ghostBtn, { marginTop: 6 }]}>
            <Text style={s.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (scanStatus === "decrypting") {
      return (
        <View style={s.body}>
          <View  style={[s.successCircle, { backgroundColor: undefined, borderColor: "transparent" }]}>
            <ActivityIndicator color="#FFF" size="large" />
          </View>
          <Text style={s.nfcTitle}>Decrypting…</Text>
          <Text style={s.nfcSubtitle}>Verifying your PIN and loading the wallet securely.</Text>
        </View>
      );
    }

    if (scanStatus === "success") {
      return (
        <View style={s.body}>
          <Animated.View style={[s.successCircle, { transform: [{ scale: successScale }] }]}>
            <Icon name="checkmark-circle" size={48} color="#10B981" />
          </Animated.View>
          <Text style={s.nfcTitle}>Wallet Loaded!</Text>
          <Text style={s.nfcSubtitle}>
            {scannedPayload?.label || "NFC Wallet"} has been added and set as your active wallet.
          </Text>
          <View style={s.successPill}>
            <Icon name="shield-checkmark" size={14} color="#10B981" />
            <Text style={s.successPillText}>Decrypted on-device · Key secured</Text>
          </View>
          <TouchableOpacity style={s.primaryBtn} onPress={closeModal} activeOpacity={0.85}>
            <View  style={s.primaryGrad}>
              <Text style={s.primaryBtnText}>Open Wallet</Text>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    if (scanStatus === "error") {
      return (
        <View style={s.body}>
          <View style={s.errorCircle}>
            <Icon name="close-circle" size={48} color="#EF4444" />
          </View>
          <Text style={s.nfcTitle}>Scan Failed</Text>
          <Text style={s.nfcSubtitle}>{errorMsg}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => { setPin(""); setErrorMsg(""); startScan(); }}>
            <Text style={s.retryText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={closeModal} style={s.ghostBtn}>
            <Text style={s.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return null;
  }

  return (
    <>
      {!hideCard && <TouchableOpacity onPress={openModal} activeOpacity={0.78} style={s.card}>
        <View style={s.cardBorder}>
          <Animated.View style={{
            ...StyleSheet.absoluteFillObject,
            borderRadius: 20,
            opacity: cardGlow.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.12] }),
            backgroundColor: "#6366F1",
          }} />
          <View  style={s.cardInner}>
            <View  style={s.iconWrap}>
              <Icon name="wifi-outline" size={26} color="#FFF" />
            </View>
            <View style={s.textWrap}>
              <Text style={s.cardTitle}>Card Vault</Text>
              <Text style={s.cardSub}>Tap to load a wallet from your NFC card</Text>
            </View>
            <View  style={s.arrowWrap}>
              <Icon name="chevron-forward" size={16} color="#FFF" />
            </View>
          </View>
        </View>
      </TouchableOpacity>}

      <Modal visible={modalVisible} transparent animationType="none" onRequestClose={closeModal} statusBarTranslucent>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.8)", opacity: overlayOpacity }]} pointerEvents="none" />
        <View style={s.overlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeModal} />
          <Animated.View style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}>
            <View style={s.handle} />
            <View style={s.header}>
              <Text style={s.title}>Card Vault</Text>
              <TouchableOpacity style={s.closeBtn} onPress={closeModal}>
                <Icon name="close" size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Animated.View style={{ opacity: contentOpacity }}>
              {renderSheetContent()}
            </Animated.View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}
