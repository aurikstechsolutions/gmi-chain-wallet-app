import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";

interface SessionTimerProps {
  expiresAt: string;
  onExpired?: () => void;
  compact?: boolean;
  style?: object;
}

function getRemaining(expiresAt: string) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return null;
  const totalSecs = Math.floor(diff / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return { h, m, s, totalSecs };
}

export function SessionTimer({ expiresAt, onExpired, compact = false, style }: SessionTimerProps) {
  const [remaining, setRemaining] = useState(() => getRemaining(expiresAt));
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    setRemaining(getRemaining(expiresAt));

    const id = setInterval(() => {
      const r = getRemaining(expiresAt);
      setRemaining(r);
      if (!r && !firedRef.current) {
        firedRef.current = true;
        onExpired?.();
        clearInterval(id);
      }
    }, 1000);

    return () => clearInterval(id);
  }, [expiresAt, onExpired]);

  if (!remaining) {
    return <Text style={[styles.expired, style]}>EXPIRED</Text>;
  }

  const { h, m, s, totalSecs } = remaining;
  const isWarning = totalSecs < 30 * 60;

  if (compact) {
    const label = h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
    return (
      <Text style={[styles.base, isWarning ? styles.warning : styles.normal, style]}>
        {label}
      </Text>
    );
  }

  const label = h > 0
    ? `${h}h ${m}m ${s}s remaining`
    : `${m}m ${s}s remaining`;

  return (
    <Text style={[styles.base, isWarning ? styles.warning : styles.normal, style]}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  normal: {
    color: "#10B981",
  },
  warning: {
    color: "#F59E0B",
  },
  expired: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#EF4444",
  },
});
