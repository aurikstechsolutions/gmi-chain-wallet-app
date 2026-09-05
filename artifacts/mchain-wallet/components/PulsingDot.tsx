import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

type Status = "active" | "pending" | "paused" | "inactive" | "offline" | "banned" | null;

function statusColor(status: Status): string {
  switch (status) {
    case "active":
      return "#10B981";
    case "pending":
    case "paused":
      return "#F59E0B";
    case "banned":
    case "inactive":
      return "#EF4444";
    default:
      return "#4B5563";
  }
}

export function PulsingDot({ status, size = 10 }: { status: Status; size?: number }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (status === "active") {
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.25, { duration: 900 }),
          withTiming(1, { duration: 900 })
        ),
        -1,
        false
      );
    } else {
      opacity.value = withTiming(1, { duration: 200 });
    }
  }, [status, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const color = statusColor(status);

  return (
    <View style={[styles.container, { width: size * 2.4, height: size * 2.4 }]}>
      <Animated.View
        style={[
          styles.glow,
          {
            backgroundColor: color,
            width: size * 2.4,
            height: size * 2.4,
            borderRadius: size * 1.2,
            opacity: 0.2,
          },
        ]}
      />
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: color,
            width: size,
            height: size,
            borderRadius: size / 2,
          },
          animStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  glow: {
    position: "absolute",
  },
  dot: {
    position: "absolute",
  },
});
