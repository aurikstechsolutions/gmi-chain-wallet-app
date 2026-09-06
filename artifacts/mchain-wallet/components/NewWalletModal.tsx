import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { NfcWriteModal } from "@/components/NfcWriteModal";
import { useWallet } from "@/context/WalletContext";
import { generateKeyPair, type KeyPair } from "@/services/crypto";
import { useColors } from "@/hooks/useColors";
import { isNfcSupported } from "@/services/nfc";

type Step = "backup" | "label" | "nfc";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function NewWalletModal({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addWallet, switchWallet } = useWallet();

  const [step, setStep] = useState<Step>("backup");
  const [keyPair, setKeyPair] = useState<KeyPair | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  const [walletLabel, setWalletLabel] = useState("");
  const [addedWalletId, setAddedWalletId] = useState<string | null>(null);
  const [nfcAvailable, setNfcAvailable] = useState(false);
  const [showNfcWrite, setShowNfcWrite] = useState(false);

  const slideAnim = useRef(new Animated.Value(400)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    isNfcSupported().then(setNfcAvailable);
  }, []);

  useEffect(() => {
    if (visible) {
      setStep("backup");
      setKeyPair(null);
      setKeyVisible(false);
      setKeyCopied(false);
      setAddrCopied(false);
      setWalletLabel("");
      setAddedWalletId(null);
      generateNewPair();
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 320, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.timing(overlayOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 400, duration: 260, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
        Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generateNewPair() {
    setGenerating(true);
    try {
      const kp = await generateKeyPair();
      setKeyPair(kp);
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyKey() {
    if (!keyPair) return;
    await Clipboard.setStringAsync(keyPair.privateKey);
    setKeyCopied(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setKeyCopied(false), 2500);
  }

  async function handleCopyAddress() {
    if (!keyPair) return;
    await Clipboard.setStringAsync(keyPair.mxcAddress);
    setAddrCopied(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setAddrCopied(false), 2500);
  }

  async function handleSave(switchTo: boolean) {
    if (!keyPair) return;
    setSaving(true);
    try {
      const entry = await addWallet(keyPair, walletLabel || "My Wallet");
      setAddedWalletId(entry.id);
      if (switchTo) await switchWallet(entry.id);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const stepTitles: Record<Step, string> = {
    backup: "New Wallet",
    label: "Name Your Wallet",
    nfc: "Save to NFC Card",
  };

  const s = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.7)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderTopWidth: 1,
      borderColor: colors.border,
      paddingBottom: insets.bottom + 8,
      maxHeight: "90%",
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: "center",
      marginTop: 12,
      marginBottom: 4,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sheetTitle: {
      fontSize: 17,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    body: {
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 8,
    },
    infoBox: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 20,
      flexDirection: "row",
      gap: 12,
      alignItems: "flex-start",
    },
    infoIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary + "20",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    infoTextWrap: { flex: 1 },
    infoTitle: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 4,
    },
    infoDesc: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      lineHeight: 18,
    },
    sectionLabel: {
      fontSize: 10,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      letterSpacing: 1.5,
      marginBottom: 8,
    },
    addressBox: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 4,
    },
    addressText: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.primary,
      lineHeight: 20,
    },
    copyRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginBottom: 16,
    },
    copyChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    copyChipText: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
    },
    keyBox: {
      backgroundColor: "#080808",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#F59E0B30",
      padding: 14,
      marginBottom: 4,
    },
    keyText: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      lineHeight: 18,
      letterSpacing: 0.4,
    },
    revealRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 16,
    },
    revealBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    revealBtnText: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
    },
    keyNotice: {
      backgroundColor: "#F59E0B10",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: "#F59E0B30",
      padding: 12,
      flexDirection: "row",
      gap: 8,
      marginBottom: 20,
      alignItems: "flex-start",
    },
    keyNoticeText: {
      flex: 1,
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: "#D4A017",
      lineHeight: 18,
    },
    primaryBtn: {
      borderRadius: 14,
      overflow: "hidden",
      marginBottom: 12,
    },
    primaryGrad: {
      paddingVertical: 15,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    primaryBtnText: {
      fontSize: 15,
      fontFamily: "Inter_700Bold",
      color: "#FFFFFF",
    },
    ghostBtn: {
      paddingVertical: 13,
      alignItems: "center",
      marginBottom: 4,
    },
    ghostBtnText: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    labelInput: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      marginBottom: 20,
    },
    loadingCenter: {
      paddingVertical: 40,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    loadingText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Dim overlay — separate from layout so KAV can move the sheet freely */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.7)", opacity: overlayOpacity }]}
        pointerEvents="none"
      />
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: "flex-end" }}
        behavior={Platform.OS === "ios" ? "padding" : "padding"}
        keyboardVerticalOffset={0}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={s.handle} />
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{stepTitles[step]}</Text>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Icon name="close" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={s.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {step === "backup" && (
              <>
                {generating || !keyPair ? (
                  <View style={s.loadingCenter}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={s.loadingText}>Generating keypair…</Text>
                  </View>
                ) : (
                  <>
                    <View style={s.infoBox}>
                      <View style={s.infoIconWrap}>
                        <Icon name="wallet" size={15} color={colors.primary} />
                      </View>
                      <View style={s.infoTextWrap}>
                        <Text style={s.infoTitle}>New wallet generated</Text>
                        <Text style={s.infoDesc}>
                          This wallet is separate from your network wallet. Save the private key before adding it.
                        </Text>
                      </View>
                    </View>

                    <Text style={s.sectionLabel}>ADDRESS</Text>
                    <View style={s.addressBox}>
                      <Text style={s.addressText} selectable>{keyPair.mxcAddress}</Text>
                    </View>
                    <View style={s.copyRow}>
                      <TouchableOpacity style={s.copyChip} onPress={handleCopyAddress}>
                        <Icon
                          name={addrCopied ? "checkmark" : "copy-outline"}
                          size={11}
                          color={addrCopied ? colors.success : colors.primary}
                        />
                        <Text style={[s.copyChipText, addrCopied && { color: colors.success }]}>
                          {addrCopied ? "Copied!" : "Copy Address"}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={s.sectionLabel}>PRIVATE KEY</Text>
                    <View style={s.keyBox}>
                      <Text style={s.keyText} selectable>
                        {keyVisible ? keyPair.privateKey : "•".repeat(64)}
                      </Text>
                    </View>
                    <View style={s.revealRow}>
                      <TouchableOpacity style={s.revealBtn} onPress={() => setKeyVisible((v) => !v)}>
                        <Icon
                          name={keyVisible ? "eye-off-outline" : "eye-outline"}
                          size={12}
                          color={colors.mutedForeground}
                        />
                        <Text style={s.revealBtnText}>{keyVisible ? "Hide" : "Reveal"}</Text>
                      </TouchableOpacity>
                      {keyVisible && (
                        <TouchableOpacity
                          style={[s.copyChip, { borderColor: "#F59E0B50" }]}
                          onPress={handleCopyKey}
                        >
                          <Icon
                            name={keyCopied ? "checkmark" : "copy-outline"}
                            size={11}
                            color={keyCopied ? colors.success : "#F59E0B"}
                          />
                          <Text style={[s.copyChipText, { color: keyCopied ? colors.success : "#F59E0B" }]}>
                            {keyCopied ? "Copied!" : "Copy Key"}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={s.keyNotice}>
                      <Icon name="warning-outline" size={13} color="#F59E0B" style={{ marginTop: 1 }} />
                      <Text style={s.keyNoticeText}>
                        Store your private key safely before continuing. This is the only time it will be shown.
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={s.primaryBtn}
                      onPress={() => setStep("label")}
                      activeOpacity={0.85}
                    >
                      <View  style={s.primaryGrad}>
                        <Text style={s.primaryBtnText}>I've Saved My Key →</Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
                      <Text style={s.ghostBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}

            {step === "label" && (
              <>
                <Text style={s.sectionLabel}>WALLET NAME (OPTIONAL)</Text>
                <TextInput
                  style={s.labelInput}
                  value={walletLabel}
                  onChangeText={setWalletLabel}
                  placeholder="e.g. Trading Wallet"
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={32}
                  autoFocus
                  returnKeyType="done"
                />

                <TouchableOpacity
                  style={[s.primaryBtn, saving && { opacity: 0.7 }]}
                  onPress={() => handleSave(false)}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  <View  style={s.primaryGrad}>
                    {saving ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={s.primaryBtnText}>Add Wallet</Text>
                    )}
                  </View>
                </TouchableOpacity>

                {nfcAvailable && (
                  <TouchableOpacity
                    style={[s.primaryBtn, { marginBottom: 0 }]}
                    onPress={() => setStep("nfc")}
                    activeOpacity={0.85}
                  >
                    <View  style={s.primaryGrad}>
                      <Icon name="wifi-outline" size={16} color="#FFF" />
                      <Text style={s.primaryBtnText}>Save to NFC Card</Text>
                    </View>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[s.ghostBtn, saving && { opacity: 0.5 }]}
                  onPress={() => handleSave(true)}
                  disabled={saving}
                >
                  <Text style={s.ghostBtnText}>Add & Switch to This Wallet</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.ghostBtn} onPress={() => setStep("backup")}>
                  <Text style={s.ghostBtnText}>← Back</Text>
                </TouchableOpacity>
              </>
            )}

            {step === "nfc" && keyPair && (
              <>
                <View style={[s.infoBox, { borderColor: "#6366F130", backgroundColor: "#6366F108" }]}>
                  <View style={[s.infoIconWrap, { backgroundColor: "#6366F120" }]}>
                    <Icon name="wifi-outline" size={15} color="#6366F1" />
                  </View>
                  <View style={s.infoTextWrap}>
                    <Text style={s.infoTitle}>Encrypt & write to card</Text>
                    <Text style={s.infoDesc}>
                      Your private key will be AES-256 encrypted with a PIN you choose and written to your NFC card. The PIN is never stored — keep it safe.
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={s.primaryBtn}
                  onPress={() => setShowNfcWrite(true)}
                  activeOpacity={0.85}
                >
                  <View  style={s.primaryGrad}>
                    <Icon name="wifi-outline" size={16} color="#FFF" />
                    <Text style={s.primaryBtnText}>Write to NFC Card</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity style={s.ghostBtn} onPress={() => handleSave(false)}>
                  <Text style={s.ghostBtnText}>Skip NFC, just save locally</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.ghostBtn} onPress={() => setStep("label")}>
                  <Text style={s.ghostBtnText}>← Back</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

      {keyPair && (
        <NfcWriteModal
          visible={showNfcWrite}
          privateKey={keyPair.privateKey}
          mxcAddress={keyPair.mxcAddress}
          publicKey={keyPair.publicKey}
          label={walletLabel || "My Wallet"}
          onClose={() => setShowNfcWrite(false)}
          onSuccess={async () => {
            await handleSave(true);
          }}
        />
      )}
    </Modal>
  );
}
