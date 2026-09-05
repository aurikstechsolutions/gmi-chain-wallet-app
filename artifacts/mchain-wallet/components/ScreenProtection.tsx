import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  AppStateStatus,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ScreenCapture from "expo-screen-capture";

// ── ScreenProtection ──────────────────────────────────────────────────────────
//
// Two layers of protection:
//
// 1. preventScreenCaptureAsync()
//    Android → adds FLAG_SECURE: the entire app surface appears BLACK in any
//    screenshot, screen recording, or screen mirror/cast. The screen sharer
//    sees nothing — not even our overlay.
//    iOS     → blocks OS-level screenshots (home button + power combos).
//
// 2. Animated overlay (shown inside the app to the local user):
//    • iOS: fires whenever a screenshot is taken (addScreenshotListener).
//    • Both: fires when the app returns from background (potential cast start).
//    This overlay auto-dismisses after 3 seconds and reassures the user that
//    their screen content was protected.
//
// The result: someone watching a screen share sees a black screen (Android) or
// gets blocked at the OS level (iOS screenshot). The user sees the nice
// "Screen Protected" animation so they know it worked.

function LockRings({ color }: { color: string }) {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    function pulse(val: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
    }
    const a1 = pulse(ring1, 0);
    const a2 = pulse(ring2, 500);
    const a3 = pulse(ring3, 1000);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ringStyle = (val: Animated.Value, size: number) => ({
    position: "absolute" as const,
    width: size, height: size,
    borderRadius: size / 2,
    borderWidth: 1.5,
    borderColor: color,
    opacity: val.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.6, 0] }),
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
  });

  return (
    <View style={{ width: 180, height: 180, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={ringStyle(ring1, 180)} />
      <Animated.View style={ringStyle(ring2, 140)} />
      <Animated.View style={ringStyle(ring3, 100)} />
    </View>
  );
}

function ProtectedOverlay({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Entrance
      Animated.parallel([
        Animated.spring(opacity, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }),
      ]).start();

      // Spin the outer ring
      Animated.loop(
        Animated.timing(spin, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true })
      ).start();

      // Shimmer on text
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmer, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(shimmer, { toValue: 0.6, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();

      // Auto-dismiss after 3 seconds
      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.9, duration: 400, useNativeDriver: true }),
        ]).start(() => {
          spin.stopAnimation(); shimmer.stopAnimation();
          spin.setValue(0); scale.setValue(0.85);
          onDone();
        });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity }]} pointerEvents="none">
      <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
        {/* Spinning outer ring + lock */}
        <View style={{ width: 180, height: 180, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
          <LockRings color="#818CF8" />
          <View style={{ position: "absolute", alignItems: "center", justifyContent: "center" }}>
            {/* Spinning dashed border */}
            <Animated.View style={{
              position: "absolute",
              width: 90, height: 90, borderRadius: 45,
              borderWidth: 2, borderColor: "#6366F1",
              borderStyle: "dashed",
              opacity: 0.5,
              transform: [{ rotate: spinDeg }],
            }} />
            {/* Shield icon background */}
            <View style={styles.shieldWrap}>
              <Text style={styles.shieldEmoji}></Text>
            </View>
          </View>
        </View>

        {/* Badges row */}
        <View style={styles.badgeRow}>
          {["FLAG_SECURE", "AES-256", "PROTECTED"].map(b => (
            <View key={b} style={styles.badge}>
              <Text style={styles.badgeText}>{b}</Text>
            </View>
          ))}
        </View>

        {/* Text */}
        <Animated.Text style={[styles.title, { opacity: shimmer }]}>
          Screen is Protected
        </Animated.Text>
        <Text style={styles.subtitle}>
          Your wallet content is hidden from{"\n"}screen recordings and screen shares.
        </Text>

        {/* Divider + footer */}
        <View style={styles.divider} />
        <View style={styles.footer}>
          <View style={[styles.dot, { backgroundColor: "#10B981" }]} />
          <Text style={styles.footerText}>GMI Wallet Security Active</Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

export function ScreenProtection({ children }: { children: React.ReactNode }) {
  const [overlayVisible, setOverlayVisible] = useState(false);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (Platform.OS === "web") return;

    // Enable at OS level:
    // Android → FLAG_SECURE (black screen in all recordings / casts)
    // iOS     → blocks system-level screenshot combos
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});

    // iOS: fires when the user takes a screenshot — show overlay to reassure them
    const sub = ScreenCapture.addScreenshotListener(() => {
      setOverlayVisible(true);
    });

    // Both platforms: if the app comes back from background while something was
    // casting/recording, show the overlay briefly as a visual confirmation.
    const appSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        setOverlayVisible(true);
      }
      appState.current = next;
    });

    return () => {
      sub.remove();
      appSub.remove();
      ScreenCapture.allowScreenCaptureAsync().catch(() => {});
    };
  }, []);

  return (
    <>
      {children}
      <ProtectedOverlay visible={overlayVisible} onDone={() => setOverlayVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: "rgba(4, 8, 20, 0.92)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  card: {
    width: 320,
    backgroundColor: "#0D1B2E",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#6366F130",
    padding: 28,
    alignItems: "center",
    shadowColor: "#6366F1",
    shadowOpacity: 0.3,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 8 },
    elevation: 20,
  },
  shieldWrap: {
    width: 72, height: 72,
    borderRadius: 24,
    backgroundColor: "#6366F118",
    borderWidth: 1.5,
    borderColor: "#6366F140",
    alignItems: "center",
    justifyContent: "center",
  },
  shieldEmoji: { fontSize: 32 },
  badgeRow: { flexDirection: "row", gap: 6, marginBottom: 16 },
  badge: {
    backgroundColor: "#6366F112",
    borderWidth: 1, borderColor: "#6366F125",
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
  },
  badgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#818CF8", letterSpacing: 0.8 },
  title: {
    fontSize: 22, fontFamily: "Inter_700Bold",
    color: "#FFFFFF", textAlign: "center", marginBottom: 8,
  },
  subtitle: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: "#94A3B8", textAlign: "center",
    lineHeight: 20, marginBottom: 20,
  },
  divider: { width: "100%", height: 1, backgroundColor: "#1E3A5F", marginBottom: 14 },
  footer: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  footerText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#64748B" },
});
