
import React, { useRef, useEffect } from "react";
import {
  Animated,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { useWallet, type WalletEntry } from "@/context/WalletContext";
import { useColors } from "@/hooks/useColors";

type Props = {
  visible: boolean;
  onClose: () => void;
  onAddWallet: () => void;
};

function shortenAddr(addr: string, chars = 8): string {
  if (!addr) return "";
  return addr.slice(0, chars) + "…" + addr.slice(-6);
}

export function WalletSwitcherModal({ visible, onClose, onAddWallet }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { wallets, activeWallet, validatorWallet, switchWallet, removeWallet } = useWallet();
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  const slideAnim = useRef(new Animated.Value(400)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (visible) {
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

  async function handleSwitch(wallet: WalletEntry) {
    if (wallet.id === activeWallet?.id) return;
    setConfirmDeleteId(null);
    await switchWallet(wallet.id);
    onClose();
  }

  async function handleRemove(id: string) {
    await removeWallet(id);
    setConfirmDeleteId(null);
  }

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
      maxHeight: "85%",
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
    list: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 4,
      gap: 8,
    },
    walletRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderRadius: 14,
      borderWidth: 1,
      padding: 14,
    },
    walletRowActive: {
      borderColor: colors.primary + "60",
      backgroundColor: colors.primary + "08",
    },
    walletRowInactive: {
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    walletInfo: { flex: 1 },
    walletLabel: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 2,
    },
    walletAddr: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    badgeRow: {
      flexDirection: "row",
      gap: 6,
      marginTop: 5,
    },
    badge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
      borderWidth: 1,
    },
    badgeText: {
      fontSize: 9,
      fontFamily: "Inter_700Bold",
      letterSpacing: 0.8,
    },
    checkWrap: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    removeBtn: {
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: "#EF444415",
      borderWidth: 1,
      borderColor: "#EF444430",
      alignItems: "center",
      justifyContent: "center",
    },
    confirmRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    confirmLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: "#EF4444",
    },
    confirmYes: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 8,
      backgroundColor: "#EF4444",
    },
    confirmYesText: {
      fontSize: 11,
      fontFamily: "Inter_700Bold",
      color: "#FFF",
    },
    confirmNo: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 8,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    confirmNoText: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
    },
    addBtn: {
      marginHorizontal: 16,
      marginTop: 4,
      marginBottom: 8,
      borderRadius: 14,
      overflow: "hidden",
    },
    addGrad: {
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    addBtnText: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginHorizontal: 16,
      marginVertical: 8,
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
      <Animated.View style={[s.overlay, { opacity: overlayOpacity }]}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={s.handle} />
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>My Wallets</Text>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Icon name="close" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={s.list}>
              {wallets.map((wallet) => {
                const isActive = wallet.id === activeWallet?.id;
                const isValidator = wallet.id === validatorWallet?.id;
                const canRemove = !isValidator && wallets.length > 1;

                return (
                  <TouchableOpacity
                    key={wallet.id}
                    style={[s.walletRow, isActive ? s.walletRowActive : s.walletRowInactive]}
                    onPress={() => handleSwitch(wallet)}
                    activeOpacity={0.8}
                  >
                    <View style={[s.iconWrap, { backgroundColor: isActive ? colors.primary + "20" : colors.background }]}>
                      <Icon
                        name="wallet"
                        size={18}
                        color={isActive ? colors.primary : colors.mutedForeground}
                      />
                    </View>

                    <View style={s.walletInfo}>
                      <Text style={s.walletLabel}>{wallet.label}</Text>
                      <Text style={s.walletAddr}>{shortenAddr(wallet.mxcAddress)}</Text>
                      {isValidator && (
                        <View style={s.badgeRow}>
                          <View style={[s.badge, { borderColor: "#0EA5E940", backgroundColor: "#0EA5E915" }]}>
                            <Text style={[s.badgeText, { color: colors.primary }]}>NODE</Text>
                          </View>
                        </View>
                      )}
                    </View>

                    {isActive && (
                      <View style={[s.checkWrap, { backgroundColor: colors.primary + "20" }]}>
                        <Icon name="checkmark" size={14} color={colors.primary} />
                      </View>
                    )}

                    {canRemove && !isActive && confirmDeleteId !== wallet.id && (
                      <TouchableOpacity
                        style={s.removeBtn}
                        onPress={() => setConfirmDeleteId(wallet.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Icon name="trash-outline" size={13} color="#EF4444" />
                      </TouchableOpacity>
                    )}

                    {canRemove && !isActive && confirmDeleteId === wallet.id && (
                      <View style={s.confirmRow}>
                        <Text style={s.confirmLabel}>Delete?</Text>
                        <TouchableOpacity style={s.confirmNo} onPress={() => setConfirmDeleteId(null)}>
                          <Text style={s.confirmNoText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.confirmYes} onPress={() => handleRemove(wallet.id)}>
                          <Text style={s.confirmYesText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.divider} />

            <TouchableOpacity
              style={s.addBtn}
              onPress={() => {
                onClose();
                setTimeout(onAddWallet, 300);
              }}
              activeOpacity={0.85}
            >
              <View

                style={[s.addGrad, { borderWidth: 1, borderColor: colors.border, borderRadius: 14 }]}
              >
                <Icon name="plus-circle" size={16} color={colors.primary} />
                <Text style={s.addBtnText}>Add New Wallet</Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
