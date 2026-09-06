import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as SecureStore from "@/services/secureStore";
import NetInfo from "@react-native-community/netinfo";
import { useWallet } from "@/context/WalletContext";
import { api, type OpenEpoch } from "@/services/api";
import { signEpochBlockHash } from "@/services/crypto";

type ApiError = Error & { status?: number; data?: Record<string, unknown> };

// Heartbeat interval: 8 minutes as per spec
const HEARTBEAT_INTERVAL_MS = 8 * 60 * 1000;

// Minimum gap before an app-resume or network-reconnect can trigger a heartbeat.
// Prevents double-firing when the interval already sent one recently.
const MIN_GAP_MS = 5 * 60 * 1000; // 5 minutes

export function useHeartbeat() {
  const {
    validatorWallet,
    validatorStatus,
    setValidatorStatus,
    setPendingHeartbeat,
  } = useWallet();

  const validatorAddress = validatorWallet?.mxcAddress ?? null;
  const walletId = validatorWallet?.id ?? null;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const validatorAddressRef = useRef(validatorAddress);
  const walletIdRef = useRef(walletId);
  const stoppedRef = useRef(false);
  // Always points to the latest sendHeartbeat — lets us call it from inside
  // itself (for the immediate epoch-signing follow-up) without a circular
  // useCallback dependency.
  const sendHeartbeatRef = useRef<() => Promise<void>>(async () => {});

  // 429 backoff — epoch time (ms) after which we may retry
  const retryAfterRef = useRef<number>(0);

  // Track when the last heartbeat was successfully sent so resume/reconnect
  // triggers don't fire redundantly straight after a regular interval beat.
  const lastSentAtRef = useRef<number>(0);

  // Tracks the previous network connectivity state so we only fire on the
  // false → true transition, not on every NetInfo update.
  const wasConnectedRef = useRef<boolean | null>(null);

  // Tracks AppState so we only fire on background → active transition.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Epoch state — tracked in refs to avoid re-render churn in the hot path,
  // but also exposed as React state for the UI.
  const openEpochRef = useRef<OpenEpoch | null>(null);
  const signedEpochsRef = useRef<Set<number>>(new Set());
  const [openEpoch, setOpenEpoch] = useState<OpenEpoch | null>(null);

  useEffect(() => {
    validatorAddressRef.current = validatorAddress;
    walletIdRef.current = walletId;
  }, [validatorAddress, walletId]);

  const stopInterval = useCallback(() => {
    stoppedRef.current = true;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startInterval = useCallback((beat: () => void) => {
    stoppedRef.current = false;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  }, []);

  // Build an epoch signature if an open epoch exists, hasn't been signed yet,
  // and the signing window hasn't expired.
  const buildEpochSignature = useCallback(async (): Promise<
    { epochNumber: number; signature: string } | undefined
  > => {
    const epoch = openEpochRef.current;
    if (!epoch) return undefined;
    if (signedEpochsRef.current.has(epoch.epochNumber)) return undefined;
    const signingWindowClosesAt = epoch.signingWindowClosesAt;
    const blockHash = epoch.blockHash;
    if (!signingWindowClosesAt || !blockHash) return undefined;
    if (new Date(signingWindowClosesAt) <= new Date()) return undefined;

    const wId = walletIdRef.current;
    if (!wId) return undefined;

    try {
      const pk = await SecureStore.getItemAsync(`mchain_pk_${wId}`);
      if (!pk) return undefined;
      const signature = signEpochBlockHash(blockHash, pk);
      signedEpochsRef.current.add(epoch.epochNumber);
      return { epochNumber: epoch.epochNumber, signature };
    } catch {
      return undefined;
    }
  }, []);

  const sendHeartbeat = useCallback(async () => {
    const address = validatorAddressRef.current;
    if (!address || stoppedRef.current) return;

    // 429 backoff — skip if we're still in the retry window
    if (Date.now() < retryAfterRef.current) return;

    let batteryLevel = 85;
    let isCharging = false;

    if (Platform.OS !== "web") {
      try {
        const Battery = await import("expo-battery");
        const level = await Battery.getBatteryLevelAsync();
        batteryLevel = Math.round(level * 100);
        const state = await Battery.getBatteryStateAsync();
        isCharging =
          state === Battery.BatteryState.CHARGING ||
          state === Battery.BatteryState.FULL;
      } catch {
        // Battery info unavailable
      }
    }

    const epochSignature = await buildEpochSignature();

    try {
      const resp = await api.sendHeartbeat({
        address,
        batteryLevel,
        isCharging,
        ...(epochSignature ? { epochSignature } : {}),
      });

      lastSentAtRef.current = Date.now();
      setPendingHeartbeat(false);
      setValidatorStatus("active");

      // Store the open epoch from the response for the next signing cycle
      const nextEpoch = resp.openEpoch ?? null;
      const prevEpochNumber = openEpochRef.current?.epochNumber ?? null;
      openEpochRef.current = nextEpoch;
      setOpenEpoch(nextEpoch);

      // If we just received a fresh epoch that hasn't been signed yet and its
      // window is still open, send an immediate signing heartbeat rather than
      // waiting up to 8 minutes for the next regular interval — the signing
      // window is often shorter than the heartbeat interval.
      if (
        nextEpoch &&
        nextEpoch.epochNumber !== prevEpochNumber &&
        !signedEpochsRef.current.has(nextEpoch.epochNumber) &&
        nextEpoch.signingWindowClosesAt &&
        new Date(nextEpoch.signingWindowClosesAt) > new Date()
      ) {
        setTimeout(() => sendHeartbeatRef.current(), 1500);
      }
    } catch (err: unknown) {
      const apiErr = err as ApiError;

      if (apiErr?.status === 429) {
        const retryAfterSeconds = (apiErr.data?.retryAfterSeconds as number) ?? 60;
        retryAfterRef.current = Date.now() + retryAfterSeconds * 1000;
        return;
      }

      if (apiErr?.status === 403) {
        const errorMsg: string =
          (apiErr.data?.error as string) ??
          (apiErr.data?.message as string) ??
          "";

        if (
          errorMsg === "validator_paused" ||
          errorMsg.includes("paused") ||
          (apiErr.data?.restartRequired as boolean)
        ) {
          stopInterval();
          setValidatorStatus("paused");
        } else if (errorMsg.includes("pending") || errorMsg.includes("approval")) {
          setPendingHeartbeat(true);
          setValidatorStatus("pending");
        } else if (errorMsg.includes("inactive")) {
          stopInterval();
          setValidatorStatus("inactive");
        } else if (errorMsg.includes("banned")) {
          stopInterval();
          setValidatorStatus("banned");
        } else {
          setPendingHeartbeat(true);
          setValidatorStatus("pending");
        }
      }
    }
  }, [setValidatorStatus, setPendingHeartbeat, stopInterval, buildEpochSignature]);

  // Keep ref in sync so the epoch-signing setTimeout always calls the latest version
  sendHeartbeatRef.current = sendHeartbeat;

  // ── Auto-trigger: app returns to foreground ──────────────────────────────────
  // When the phone screen turns on or the user switches back to the app,
  // fire a heartbeat immediately if enough time has passed since the last one.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;

      if (
        next === "active" &&
        (prev === "background" || prev === "inactive") &&
        !stoppedRef.current &&
        validatorAddressRef.current &&
        Date.now() - lastSentAtRef.current > MIN_GAP_MS
      ) {
        void sendHeartbeatRef.current();
      }
    });
    return () => sub.remove();
  }, []);

  // ── Auto-trigger: network reconnects ────────────────────────────────────────
  // When the device goes from offline → online, fire a heartbeat immediately
  // so epoch signing doesn't wait up to 8 minutes after a connectivity gap.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const unsub = NetInfo.addEventListener((state) => {
      const isConnected = state.isConnected ?? false;
      const wasConnected = wasConnectedRef.current;

      wasConnectedRef.current = isConnected;

      // Only fire on false → true transition (reconnect), not on first call
      if (wasConnected === false && isConnected && !stoppedRef.current && validatorAddressRef.current) {
        void sendHeartbeatRef.current();
      }
    });
    return () => unsub();
  }, []);

  // Restart the foreground interval when the validator is re-activated
  const prevStatusRef = useRef(validatorStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = validatorStatus;
    if (prev !== "active" && validatorStatus === "active" && validatorAddress) {
      stoppedRef.current = false;
      sendHeartbeat();
      startInterval(sendHeartbeat);
    }
  }, [validatorStatus, validatorAddress, sendHeartbeat, startInterval]);

  // Start interval when validator address first becomes available
  useEffect(() => {
    if (!validatorAddress) return;
    stoppedRef.current = false;
    sendHeartbeat();
    startInterval(sendHeartbeat);
    return () => stopInterval();
  }, [validatorAddress, sendHeartbeat, startInterval, stopInterval]);

  const restartSession = useCallback(async () => {
    const address = validatorAddressRef.current;
    if (!address) throw new Error("No validator wallet address");

    const result = await api.restartSession(address);
    setValidatorStatus("active");
    retryAfterRef.current = 0;
    sendHeartbeat();
    startInterval(sendHeartbeat);
    return result;
  }, [setValidatorStatus, sendHeartbeat, startInterval]);

  return { sendHeartbeat, restartSession, openEpoch };
}
