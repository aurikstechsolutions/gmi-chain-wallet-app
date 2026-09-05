import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = "100%", height = 16, borderRadius = 8, style }: SkeletonProps) {
  const colors = useColors();
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, backgroundColor: colors.border, opacity },
        style,
      ]}
    />
  );
}

/** A row of skeleton lines — pass an array of widths */
export function SkeletonRow({ widths, height = 14, gap = 8 }: { widths: (number | `${number}%`)[]; height?: number; gap?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap }}>
      {widths.map((w, i) => (
        <Skeleton key={i} width={w} height={height} />
      ))}
    </View>
  );
}

/** Balance card skeleton — mirrors the real balance card layout */
export function BalanceSkeleton() {
  return (
    <View style={s.balanceWrap}>
      <Skeleton width={60} height={11} borderRadius={4} style={{ marginBottom: 10 }} />
      <Skeleton width={140} height={36} borderRadius={8} style={{ marginBottom: 14 }} />
      <Skeleton width={180} height={14} borderRadius={6} />
    </View>
  );
}

/** Asset row skeleton */
export function AssetRowSkeleton() {
  return (
    <View style={s.assetRow}>
      <Skeleton width={44} height={44} borderRadius={22} />
      <View style={{ flex: 1, gap: 6 }}>
        <Skeleton width="50%" height={14} borderRadius={5} />
        <Skeleton width="35%" height={11} borderRadius={4} />
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <Skeleton width={60} height={14} borderRadius={5} />
        <Skeleton width={40} height={11} borderRadius={4} />
      </View>
    </View>
  );
}

/** P2P ad card skeleton */
export function AdCardSkeleton() {
  return (
    <View style={s.adCard}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
        <Skeleton width={80} height={13} borderRadius={4} />
        <Skeleton width={60} height={22} borderRadius={6} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
        <Skeleton width={100} height={22} borderRadius={5} />
        <Skeleton width={70} height={13} borderRadius={4} />
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <Skeleton width={90} height={13} borderRadius={4} />
        <Skeleton width={90} height={13} borderRadius={4} />
      </View>
      <Skeleton width="100%" height={40} borderRadius={10} />
    </View>
  );
}

/** Transaction row skeleton */
export function TxRowSkeleton() {
  return (
    <View style={s.txRow}>
      <Skeleton width={44} height={44} borderRadius={22} />
      <View style={{ flex: 1, gap: 7 }}>
        <Skeleton width="45%" height={13} borderRadius={4} />
        <Skeleton width="65%" height={11} borderRadius={4} />
      </View>
      <View style={{ alignItems: "flex-end", gap: 7 }}>
        <Skeleton width={55} height={13} borderRadius={4} />
        <Skeleton width={40} height={10} borderRadius={4} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  balanceWrap: { paddingVertical: 18, paddingHorizontal: 20 },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  adCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
});
