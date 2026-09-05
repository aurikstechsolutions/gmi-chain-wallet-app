import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { GmiLogo } from "@/components/GmiLogo";

const MIN_MS = 1800; // minimum time splash stays visible

export function SplashLoader({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const mountTime = useRef(Date.now());

  // entrance
  const logoScale   = useRef(new Animated.Value(0.78)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  // exit
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const [hidden, setHidden] = useState(false);

  // ── entrance sequence ─────────────────────────────────────────
  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1, tension: 80, friction: 7, useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1, duration: 400, delay: 100, useNativeDriver: true,
      }),
      Animated.timing(textOpacity, {
        toValue: 1, duration: 380, delay: 320, useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // ── exit when app ready (respect minimum display time) ───────
  useEffect(() => {
    if (!ready) return;
    const elapsed = Date.now() - mountTime.current;
    const delay = Math.max(0, MIN_MS - elapsed);
    const t = setTimeout(() => {
      Animated.timing(exitOpacity, {
        toValue: 0, duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setHidden(true);
        onDone();
      });
    }, delay);
    return () => clearTimeout(t);
  }, [ready]);

  if (hidden) return null;

  const s = createStyles(colors);

  return (
    <Animated.View style={[s.root, { width, height, opacity: exitOpacity }]}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", marginTop: -60 }}>
        <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }], marginBottom: 40 }}>
          <GmiLogo size={120} />
        </Animated.View>
        <Animated.View style={[s.brand, { opacity: textOpacity }]}>
          <Text style={s.wordmark}>GMI WALLET</Text>
          <Text style={s.tagline}>Self-Custodial & Secure</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: {
      position: "absolute",
      top: 0,
      left: 0,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
      elevation: 9999,
    },
    brand: { alignItems: "center" },
    wordmark: {
      fontFamily: "Inter_700Bold",
      fontSize: 28,
      letterSpacing: 0,
      marginBottom: 8,
      color: colors.foreground,
    },
    tagline: {
      fontFamily: "Inter_500Medium",
      fontSize: 14,
      color: colors.mutedForeground,
      letterSpacing: 0.2,
    },
  });
}
