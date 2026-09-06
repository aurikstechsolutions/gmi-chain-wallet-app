import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { useColors } from "@/hooks/useColors";
import { p2pApi, type PaymentDetail } from "@/services/p2pApi";
import { METHOD_FIELDS, METHOD_LABELS } from "@/services/paymentMethods";

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: (detail: PaymentDetail) => void;
  onDeleted?: () => void;
  ownerAddress: string;
  paymentMethod: string;
  existing?: PaymentDetail | null;
}

export function PaymentDetailSheet({ visible, onClose, onSaved, onDeleted, ownerAddress, paymentMethod, existing }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const fields = METHOD_FIELDS[paymentMethod] ?? METHOD_FIELDS["other"]!;
  const methodLabel = METHOD_LABELS[paymentMethod] ?? paymentMethod;

  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (visible) {
      setValues(existing?.details ?? {});
    }
  }, [visible, existing]);

  function setField(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    const filled = fields.filter(f => !f.multiline || values[f.key]);
    if (filled.length === 0) { setToast("Fill in at least one field"); return; }
    setLoading(true);
    try {
      const saved = await p2pApi.savePaymentDetail({
        ownerAddress,
        paymentMethod,
        details: values,
      });
      onSaved(saved);
      onClose();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    setDeleting(true);
    try {
      await p2pApi.deletePaymentDetail(existing.id, ownerAddress);
      onDeleted?.();
      onClose();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  const s = StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.72)" },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 16 },
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    title: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.foreground },
    closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
    scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
    label: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2, marginBottom: 8 },
    input: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground, marginBottom: 16 },
    inputMulti: { minHeight: 80, textAlignVertical: "top" },
    btnRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 4 },
    saveBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
    saveGrad: { paddingVertical: 15, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
    saveBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFF" },
    deleteBtn: { paddingHorizontal: 16, paddingVertical: 15, borderRadius: 14, backgroundColor: "#EF444415", borderWidth: 1, borderColor: "#EF444430", alignItems: "center", justifyContent: "center" },
  });

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: "flex-end" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={s.overlay} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>{methodLabel} Details</Text>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Icon name="close" size={16} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            {fields.map(field => (
              <View key={field.key}>
                <Text style={s.label}>{field.label.toUpperCase()}</Text>
                <TextInput
                  style={[s.input, field.multiline && s.inputMulti]}
                  value={values[field.key] ?? ""}
                  onChangeText={v => setField(field.key, v)}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType={field.keyboardType ?? "default"}
                  multiline={field.multiline}
                  autoCapitalize="none"
                />
              </View>
            ))}
          </ScrollView>

          <View style={s.btnRow}>
            {existing && (
              <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} disabled={deleting}>
                {deleting
                  ? <ActivityIndicator color="#EF4444" size="small" />
                  : <Icon name="trash-outline" size={18} color="#EF4444" />}
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={loading} activeOpacity={0.85}>
              <View  style={s.saveGrad}>
                {loading ? <ActivityIndicator color="#FFF" /> : <Text style={s.saveBtnText}>{existing ? "Update" : "Save"} Details</Text>}
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
      <Toast message={toast} visible={!!toast} onHide={() => setToast("")} />
    </Modal>
  );
}
