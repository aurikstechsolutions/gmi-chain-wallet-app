import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { isValidSolanaAddress } from "@/services/solana";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScan: (address: string) => void;
  network?: "gmi" | "solana";
};

export function QRScannerModal({ visible, onClose, onScan, network = "gmi" }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState("");

  // Corner bracket animation
  const cornerScale = useRef(new Animated.Value(0.92)).current;
  const cornerOpacity = useRef(new Animated.Value(0.7)).current;
  // Scan line sweep
  const scanY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) { setScanned(false); setScanError(""); return; }

    // Request permission when modal opens
    if (!permission?.granted) requestPermission();

    // Corner pulse
    const cornerAnim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(cornerScale, { toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(cornerOpacity, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(cornerScale, { toValue: 0.92, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(cornerOpacity, { toValue: 0.7, duration: 900, useNativeDriver: true }),
        ]),
      ])
    );
    cornerAnim.start();

    // Scan line sweep
    scanY.setValue(0);
    const lineAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanY, { toValue: 1, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(scanY, { toValue: 0, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ])
    );
    lineAnim.start();

    return () => { cornerAnim.stop(); lineAnim.stop(); };
  }, [visible, permission?.granted]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleBarcodeScan({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);

    let extracted = data.trim();
    if (network === "solana") {
      extracted = extracted.replace(/^solana:/i, "").split("?")[0];
      if (!isValidSolanaAddress(extracted)) {
        setScanError("QR code doesn't contain a valid Solana address");
        setTimeout(() => { setScanned(false); setScanError(""); }, 2000);
        return;
      }
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onScan(extracted);
      onClose();
      return;
    }

    // Extract gmi1 address — support plain address or URI like "gmi:gmi1..."
    const match = extracted.match(/gmi1[a-z0-9]+/i);
    if (match) extracted = match[0];

    if (!extracted.startsWith("gmi1") || extracted.length < 20) {
      setScanError("QR code doesn't contain a valid gmi1 address");
      setTimeout(() => { setScanned(false); setScanError(""); }, 2000);
      return;
    }

    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onScan(extracted);
    onClose();
  }

  const FRAME = 260;

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "#000000" },
    topBar: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      paddingTop: insets.top + (Platform.OS === "web" ? 24 : 12),
      paddingHorizontal: 20,
      paddingBottom: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    closeBtn: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: "rgba(0,0,0,0.55)",
      borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
      alignItems: "center", justifyContent: "center",
    },
    title: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF", flex: 1 },
    camera: { flex: 1 },
    dimTop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)" },
    frameWrap: {
      position: "absolute",
      top: "50%",
      left: "50%",
      marginTop: -(FRAME / 2) - 30,
      marginLeft: -(FRAME / 2),
      width: FRAME,
      height: FRAME,
      alignItems: "center",
      justifyContent: "center",
    },
    frameInner: { width: FRAME, height: FRAME, position: "relative" },
    // Corner brackets
    corner: { position: "absolute", width: 28, height: 28 },
    cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderColor: colors.primary, borderTopLeftRadius: 6 },
    cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderColor: colors.primary, borderTopRightRadius: 6 },
    cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: colors.primary, borderBottomLeftRadius: 6 },
    cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderColor: colors.primary, borderBottomRightRadius: 6 },
    scanLineWrap: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, overflow: "hidden" },
    scanLine: { height: 2, width: "100%", borderRadius: 1 },
    hint: { position: "absolute", bottom: -48, left: 0, right: 0, alignItems: "center" },
    hintText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", textAlign: "center" },
    errorWrap: {
      position: "absolute", bottom: -56,
      left: 0, right: 0, alignItems: "center",
    },
    errorText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#F87171", textAlign: "center" },
    permissionWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
    permissionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF", textAlign: "center", marginTop: 16, marginBottom: 10 },
    permissionDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", textAlign: "center", lineHeight: 22, marginBottom: 28 },
    permissionBtn: { borderRadius: 14, overflow: "hidden" },
    permissionGrad: { paddingVertical: 14, paddingHorizontal: 28, alignItems: "center" },
    permissionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
    webNote: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
    webNoteText: { fontSize: 15, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", textAlign: "center", lineHeight: 24, marginTop: 16 },
  });

  const scanLineTranslate = scanY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, FRAME - 4],
  });

  const body = () => {
    if (Platform.OS === "web") {
      return (
        <View style={s.webNote}>
          <Icon name="scan" size={48} color={colors.primary} />
          <Text style={s.webNoteText}>
            QR scanning is available on iOS and Android only.{"\n"}Please use the Paste button to enter the address on web.
          </Text>
        </View>
      );
    }
    if (!permission?.granted) {
      return (
        <View style={s.permissionWrap}>
          <Icon name="scan" size={52} color={colors.primary} />
          <Text style={s.permissionTitle}>Camera Access Required</Text>
          <Text style={s.permissionDesc}>
            Allow camera access so you can scan a recipient's QR code to auto-fill their {network === "solana" ? "Solana" : "GMI Chain"} address.
          </Text>
          <TouchableOpacity style={s.permissionBtn} onPress={requestPermission} activeOpacity={0.85}>
            <View  style={s.permissionGrad}>
              <Text style={s.permissionBtnText}>Allow Camera</Text>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={s.camera}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scanned ? undefined : handleBarcodeScan}
        />
        {/* Dark overlay */}
        <View style={s.dimTop} pointerEvents="none" />

        {/* Viewfinder frame */}
        <View style={s.frameWrap}>
          <Animated.View style={[s.frameInner, { transform: [{ scale: cornerScale }], opacity: cornerOpacity }]}>
            <View style={[s.corner, s.cornerTL]} />
            <View style={[s.corner, s.cornerTR]} />
            <View style={[s.corner, s.cornerBL]} />
            <View style={[s.corner, s.cornerBR]} />
          </Animated.View>

          {/* Scan line */}
          {!scanned && (
            <View style={s.scanLineWrap} pointerEvents="none">
              <Animated.View style={{ transform: [{ translateY: scanLineTranslate }] }}>
                <View


                  style={s.scanLine}
                />
              </Animated.View>
            </View>
          )}

          {/* Hint / error */}
          <View style={s.hint}>
            {scanError ? (
              <Text style={s.errorText}>{scanError}</Text>
            ) : scanned ? (
              <Text style={[s.hintText, { color: "#10B981" }]}>Address captured!</Text>
            ) : (
              <Text style={s.hintText}>Point at a {network === "solana" ? "Solana" : "GMI Chain"} address QR code</Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.overlay}>
        {/* Top bar */}
        <View style={s.topBar}>
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Icon name="close" size={16} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={s.title}>Scan QR Code</Text>
        </View>
        {body()}
      </View>
    </Modal>
  );
}
