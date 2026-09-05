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
import { useWallet } from "@/context/WalletContext";
import { mnemonicToKeyPair, privateKeyToKeyPair, validateMnemonicWords } from "@/services/crypto";
import { useColors } from "@/hooks/useColors";

type Tab = "seed" | "privatekey";

type Props = {
  visible: boolean;
  onClose: () => void;
};

const WORD_COUNT = 12;

export function ImportWalletModal({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addWallet, switchWallet } = useWallet();

  const [tab, setTab] = useState<Tab>("seed");
  const [words, setWords] = useState<string[]>(Array(WORD_COUNT).fill(""));
  const [privateKey, setPrivateKey] = useState("");
  const [pkVisible, setPkVisible] = useState(false);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const slideAnim = useRef(new Animated.Value(500)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const wordRefs = useRef<(TextInput | null)[]>(Array(WORD_COUNT).fill(null));

  useEffect(() => {
    if (visible) {
      setTab("seed");
      setWords(Array(WORD_COUNT).fill(""));
      setPrivateKey("");
      setPkVisible(false);
      setLabel("");
      setError("");
      setLoading(false);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 320, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.timing(overlayOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 500, duration: 260, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
        Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleWordChange(index: number, value: string) {
    setError("");
    // Handle paste of full phrase into first field
    if (index === 0) {
      const trimmed = value.trim();
      const parts = trimmed.split(/\s+/);
      if (parts.length >= WORD_COUNT) {
        const filled = parts.slice(0, WORD_COUNT).map(w => w.toLowerCase().trim());
        setWords(filled);
        return;
      }
    }
    const updated = [...words];
    updated[index] = value.toLowerCase().trim();
    setWords(updated);
  }

  function handleWordSubmit(index: number) {
    if (index < WORD_COUNT - 1) {
      wordRefs.current[index + 1]?.focus();
    }
  }

  async function handleImport(switchTo: boolean) {
    setError("");
    setLoading(true);
    try {
      let keypair;
      if (tab === "seed") {
        const mnemonic = words.map(w => w.trim()).join(" ");
        if (!validateMnemonicWords(mnemonic)) {
          setError("Invalid seed phrase. Check all 12 words and try again.");
          return;
        }
        keypair = mnemonicToKeyPair(mnemonic);
      } else {
        keypair = privateKeyToKeyPair(privateKey);
      }
      const entry = await addWallet(keypair, label.trim() || "Imported Wallet");
      if (switchTo) await switchWallet(entry.id);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed. Please check your input.");
    } finally {
      setLoading(false);
    }
  }

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderTopWidth: 1,
      borderColor: colors.border,
      paddingBottom: insets.bottom + 8,
      maxHeight: "92%",
    },
    handle: {
      width: 36, height: 4, borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: "center", marginTop: 12, marginBottom: 4,
    },
    sheetHeader: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 20, paddingVertical: 16,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: colors.foreground },
    closeBtn: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      alignItems: "center", justifyContent: "center",
    },
    body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
    tabRow: {
      flexDirection: "row", backgroundColor: colors.card,
      borderRadius: 12, borderWidth: 1, borderColor: colors.border,
      padding: 4, marginBottom: 20, gap: 4,
    },
    tabBtn: {
      flex: 1, paddingVertical: 9, alignItems: "center",
      borderRadius: 9, flexDirection: "row", justifyContent: "center", gap: 6,
    },
    tabBtnActive: { backgroundColor: colors.primary + "22", borderWidth: 1, borderColor: colors.primary + "55" },
    tabBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    tabBtnTextActive: { fontFamily: "Inter_700Bold", color: colors.primary },
    warningBox: {
      backgroundColor: "#F59E0B10", borderRadius: 12,
      borderWidth: 1, borderColor: "#F59E0B30",
      padding: 14, flexDirection: "row", gap: 10,
      marginBottom: 18, alignItems: "flex-start",
    },
    warningText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#D4A017", lineHeight: 18 },
    sectionLabel: {
      fontSize: 10, fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 10,
    },
    wordsGrid: {
      flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18,
    },
    wordCell: {
      width: "30%", flexDirection: "row", alignItems: "center",
      backgroundColor: colors.card, borderRadius: 10,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 8, paddingVertical: 8, gap: 5,
    },
    wordNum: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, minWidth: 14 },
    wordInput: {
      flex: 1, fontSize: 13, fontFamily: "Inter_400Regular",
      color: colors.foreground, padding: 0,
    },
    pkInputWrap: {
      backgroundColor: "#080808", borderRadius: 12,
      borderWidth: 1, borderColor: "#F59E0B30",
      padding: 14, marginBottom: 8, flexDirection: "row", alignItems: "flex-start",
    },
    pkInput: {
      flex: 1, fontSize: 12, fontFamily: "Inter_400Regular",
      color: colors.foreground, lineHeight: 18,
      minHeight: 56, textAlignVertical: "top",
    },
    eyeBtn: { paddingLeft: 8, paddingTop: 2 },
    labelInput: {
      backgroundColor: colors.card, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 16, paddingVertical: 14,
      fontSize: 15, fontFamily: "Inter_400Regular",
      color: colors.foreground, marginBottom: 20,
    },
    errorBox: {
      backgroundColor: "#EF444415", borderRadius: 10,
      borderWidth: 1, borderColor: "#EF444430",
      padding: 12, flexDirection: "row", gap: 8,
      marginBottom: 14, alignItems: "center",
    },
    errorText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#F87171" },
    primaryBtn: { borderRadius: 14, overflow: "hidden", marginBottom: 12 },
    primaryGrad: {
      paddingVertical: 15, flexDirection: "row",
      alignItems: "center", justifyContent: "center", gap: 8,
    },
    primaryBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
    ghostBtn: { paddingVertical: 13, alignItems: "center", marginBottom: 4 },
    ghostBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
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
            <Text style={s.sheetTitle}>Import Wallet</Text>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Icon name="close" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={s.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Tab switcher */}
            <View style={s.tabRow}>
              <TouchableOpacity
                style={[s.tabBtn, tab === "seed" && s.tabBtnActive]}
                onPress={() => { setTab("seed"); setError(""); }}
                activeOpacity={0.7}
              >
                <Icon name="list-outline" size={13} color={tab === "seed" ? colors.primary : colors.mutedForeground} />
                <Text style={[s.tabBtnText, tab === "seed" && s.tabBtnTextActive]}>Seed Phrase</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.tabBtn, tab === "privatekey" && s.tabBtnActive]}
                onPress={() => { setTab("privatekey"); setError(""); }}
                activeOpacity={0.7}
              >
                <Icon name="key-outline" size={13} color={tab === "privatekey" ? colors.primary : colors.mutedForeground} />
                <Text style={[s.tabBtnText, tab === "privatekey" && s.tabBtnTextActive]}>Private Key</Text>
              </TouchableOpacity>
            </View>

            {/* Warning */}
            <View style={s.warningBox}>
              <Icon name="warning-outline" size={14} color="#F59E0B" style={{ marginTop: 1 }} />
              <Text style={s.warningText}>
                Never share your seed phrase or private key. Only import on a trusted device.
              </Text>
            </View>

            {/* Seed phrase input */}
            {tab === "seed" && (
              <>
                <Text style={s.sectionLabel}>ENTER YOUR 12-WORD SEED PHRASE</Text>
                <View style={s.wordsGrid}>
                  {Array(WORD_COUNT).fill(null).map((_, i) => (
                    <View key={i} style={s.wordCell}>
                      <Text style={s.wordNum}>{i + 1}.</Text>
                      <TextInput
                        ref={el => { wordRefs.current[i] = el; }}
                        style={s.wordInput}
                        value={words[i]}
                        onChangeText={v => handleWordChange(i, v)}
                        onSubmitEditing={() => handleWordSubmit(i)}
                        autoCapitalize="none"
                        autoCorrect={false}
                        spellCheck={false}
                        returnKeyType={i < WORD_COUNT - 1 ? "next" : "done"}
                        placeholder={`word ${i + 1}`}
                        placeholderTextColor={colors.mutedForeground + "80"}
                        blurOnSubmit={i === WORD_COUNT - 1}
                      />
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Private key input */}
            {tab === "privatekey" && (
              <>
                <Text style={s.sectionLabel}>ENTER YOUR PRIVATE KEY</Text>
                <View style={s.pkInputWrap}>
                  <TextInput
                    style={s.pkInput}
                    value={pkVisible ? privateKey : privateKey ? "•".repeat(Math.min(privateKey.length, 64)) : ""}
                    onChangeText={v => { setPrivateKey(v.trim()); setError(""); }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    secureTextEntry={false}
                    placeholder="Paste your 64-character hex private key"
                    placeholderTextColor={colors.mutedForeground + "80"}
                    multiline={pkVisible}
                    numberOfLines={pkVisible ? 3 : 1}
                    onFocus={() => setPkVisible(true)}
                  />
                  <TouchableOpacity style={s.eyeBtn} onPress={() => setPkVisible(v => !v)}>
                    <Icon name={pkVisible ? "eye-off-outline" : "eye-outline"} size={16} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Wallet label */}
            <Text style={[s.sectionLabel, { marginTop: 4 }]}>WALLET NAME (OPTIONAL)</Text>
            <TextInput
              style={s.labelInput}
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. My Imported Wallet"
              placeholderTextColor={colors.mutedForeground}
              maxLength={32}
              returnKeyType="done"
            />

            {/* Error */}
            {!!error && (
              <View style={s.errorBox}>
                <Icon name="alert-circle-outline" size={14} color="#EF4444" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            {/* Import button */}
            <TouchableOpacity
              style={[s.primaryBtn, loading && { opacity: 0.7 }]}
              onPress={() => handleImport(false)}
              disabled={loading}
              activeOpacity={0.85}
            >
              <View  style={s.primaryGrad}>
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Icon name="download-outline" size={16} color="#FFF" />
                    <Text style={s.primaryBtnText}>Import Wallet</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.ghostBtn, loading && { opacity: 0.5 }]}
              onPress={() => handleImport(true)}
              disabled={loading}
            >
              <Text style={s.ghostBtnText}>Import & Switch to This Wallet</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
              <Text style={s.ghostBtnText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
