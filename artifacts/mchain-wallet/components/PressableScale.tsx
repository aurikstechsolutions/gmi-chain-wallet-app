import React, { useRef } from "react";
import { Animated, Pressable, type PressableProps, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";

interface PressableScaleProps extends PressableProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  scaleTo?: number;
  haptic?: boolean;
  hapticType?: "light" | "medium" | "heavy" | "success" | "none";
}

export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  haptic = true,
  hapticType = "light",
  onPress,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  function pressIn() {
    Animated.spring(scale, {
      toValue: scaleTo,
      useNativeDriver: true,
      speed: 50,
      bounciness: 2,
    }).start();
  }

  function pressOut() {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();
  }

  function handlePress(e: Parameters<NonNullable<PressableProps["onPress"]>>[0]) {
    if (haptic && hapticType !== "none") {
      if (hapticType === "success") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (hapticType === "medium") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else if (hapticType === "heavy") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
    onPress?.(e);
  }

  const styleArray = Array.isArray(style) ? style : style ? [style] : [];

  return (
    <Pressable
      onPressIn={pressIn}
      onPressOut={pressOut}
      onPress={handlePress}
      style={styleArray}
      {...rest}
    >
      <Animated.View style={[{ flex: 1 }, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
