import React, { useState } from "react";
import {
  ActivityIndicator, Modal, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { Icon } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { p2pApi } from "@/services/p2pApi";

interface Props {
  visible: boolean;
  orderId: string;
  raterAddress: string;
  ratedAddress: string;
  counterpartyName?: string;
  onClose: () => void;
  onDone: () => void;
}

export function RatingModal({ visible, orderId, raterAddress, ratedAddress, counterpartyName, onClose, onDone }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [score, setScore] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");

  const submit = useMutation({
    mutationFn: () => p2pApi.rateOrder(orderId, { raterAddress, ratedAddress, score, comment: comment.trim() || undefined }),
    onSuccess: () => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["p2p_order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["p2p_my_orders"] });
      onDone();
    },
  });

  const display = hovered || score;

  const LABELS: Record<number, string> = {
    1: "Poor",
    2: "Fair",
    3: "Good",
    4: "Very Good",
    5: "Excellent",
  };

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 24,
      paddingTop: 14,
      paddingBottom: insets.bottom + 24,
    },
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 },
    badge: {
      width: 64, height: 64, borderRadius: 32,
      backgroundColor: "#0EA5E920", borderWidth: 2, borderColor: "#0EA5E940",
      alignItems: "center", justifyContent: "center",
      alignSelf: "center", marginBottom: 14,
    },
    title: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center", marginBottom: 4 },
    sub: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginBottom: 24 },
    starsRow: { flexDirection: "row", justifyContent: "center", gap: 12, marginBottom: 8 },
    ratingLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.primary, textAlign: "center", height: 18, marginBottom: 20 },
    inputLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1.2, marginBottom: 8 },
    input: {
      backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground,
      minHeight: 80, textAlignVertical: "top", marginBottom: 20,
    },
    submitBtn: { borderRadius: 14, overflow: "hidden", marginBottom: 10 },
    submitGrad: { paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
    submitText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" },
    skipBtn: { alignItems: "center", paddingVertical: 10 },
    skipText: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
  });

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />

          <View style={s.badge}>
            <Icon name="star" size={28} color="#F59E0B" />
          </View>

          <Text style={s.title}>Rate your trade</Text>
          <Text style={s.sub}>
            How was your experience with{"\n"}
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
              {counterpartyName ?? ratedAddress.slice(0, 10) + "…"}
            </Text>
            ?
          </Text>

          {/* Star picker */}
          <View style={s.starsRow}>
            {[1, 2, 3, 4, 5].map((i) => (
              <TouchableOpacity
                key={i}
                onPress={() => {
                  setScore(i);
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                onPressIn={() => setHovered(i)}
                onPressOut={() => setHovered(0)}
                activeOpacity={0.8}
              >
                <Icon
                  name={i <= display ? "star" : "star-outline"}
                  size={40}
                  color={i <= display ? "#F59E0B" : colors.border}
                />
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.ratingLabel}>{display ? LABELS[display] : " "}</Text>

          <Text style={s.inputLabel}>COMMENT (OPTIONAL)</Text>
          <TextInput
            style={s.input}
            placeholder="Share details about your experience…"
            placeholderTextColor={colors.mutedForeground}
            value={comment}
            onChangeText={setComment}
            multiline
            maxLength={300}
          />

          <TouchableOpacity
            style={[s.submitBtn, (score === 0 || submit.isPending) && { opacity: 0.4 }]}
            onPress={() => submit.mutate()}
            disabled={score === 0 || submit.isPending}
            activeOpacity={0.85}
          >
            <View  style={s.submitGrad}>
              {submit.isPending
                ? <ActivityIndicator color="#FFF" />
                : <><Icon name="checkmark-circle-outline" size={18} color="#FFF" /><Text style={s.submitText}>Submit Rating</Text></>}
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={s.skipBtn} onPress={onClose}>
            <Text style={s.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
