import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";

export type TradeSelectorOption = {
  id: string;
  title: string;
  subtitle?: string;
  mark?: string;
  icon?: string;
  disabled?: boolean;
};

type Props = {
  visible: boolean;
  title: string;
  description?: string;
  options: TradeSelectorOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

export function TradeSelectorModal({
  visible,
  title,
  description,
  options,
  selectedId,
  onSelect,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close selector" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
              {description ? <Text style={[styles.description, { color: colors.mutedForeground }]}>{description}</Text> : null}
            </View>
            <Pressable
              style={[styles.closeButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close selector"
            >
              <Icon name="close" size={15} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {options.map((option) => {
              const selected = option.id === selectedId;
              const disabled = option.disabled === true;
              return (
                <Pressable
                  key={option.id}
                  style={[
                    styles.option,
                    {
                      backgroundColor: selected ? colors.primary + "0D" : colors.card,
                      borderColor: selected ? colors.primary + "66" : colors.border,
                      opacity: disabled ? 0.48 : 1,
                    },
                  ]}
                  disabled={disabled}
                  onPress={() => {
                    onSelect(option.id);
                    onClose();
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled }}
                  accessibilityLabel={`${option.title}${option.subtitle ? `, ${option.subtitle}` : ""}`}
                >
                  {option.mark ? (
                    <View style={[styles.mark, { backgroundColor: selected ? colors.primary : colors.secondary }]}>
                      <Text style={[styles.markText, { color: selected ? colors.primaryForeground : colors.primary }]}>{option.mark}</Text>
                    </View>
                  ) : option.icon ? (
                    <View style={[styles.mark, { backgroundColor: colors.secondary }]}>
                      <Icon name={option.icon} size={17} color={colors.primary} />
                    </View>
                  ) : null}
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionTitle, { color: colors.foreground }]}>{option.title}</Text>
                    {option.subtitle ? <Text style={[styles.optionSubtitle, { color: colors.mutedForeground }]}>{option.subtitle}</Text> : null}
                  </View>
                  {selected ? <Icon name="checkmark-circle" size={21} color={colors.primary} /> : <Icon name="chevron-right" size={17} color={colors.mutedForeground} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(3, 10, 24, 0.62)",
  },
  sheet: {
    maxHeight: "78%",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerCopy: { flex: 1 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  description: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 3 },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  list: { padding: 16, gap: 10 },
  option: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  mark: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  optionCopy: { flex: 1 },
  optionTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  optionSubtitle: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 3 },
});