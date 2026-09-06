import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { hasPin } from "@/services/pin";

interface PinRequest {
  title: string;
  subtitle?: string;
  onSuccess: () => void;
  onCancel?: () => void;
}

interface PinContextType {
  isReady: boolean;
  isAppLocked: boolean;
  lockApp: () => void;
  unlockApp: () => void;
  pinRequest: PinRequest | null;
  requestPin: (opts: PinRequest) => Promise<void>;
  dismissPin: () => void;
}

const PinContext = createContext<PinContextType | null>(null);

export function PinProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isAppLocked, setIsAppLocked] = useState(false);
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const backgroundedAt = useRef<number | null>(null);

  // On mount: lock app if PIN is configured, then signal ready
  useEffect(() => {
    hasPin().then((exists) => {
      if (exists) setIsAppLocked(true);
      setIsReady(true);
    });
  }, []);

  // Re-lock after 30 s in background
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (next) => {
      if (
        (appState.current === "active" || appState.current === "inactive") &&
        next === "background"
      ) {
        backgroundedAt.current = Date.now();
      }

      if (next === "active" && appState.current === "background") {
        const elapsed = backgroundedAt.current
          ? Date.now() - backgroundedAt.current
          : Infinity;
        if (elapsed > 30_000) {
          const exists = await hasPin();
          if (exists) setIsAppLocked(true);
        }
        backgroundedAt.current = null;
      }

      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  const lockApp = useCallback(() => setIsAppLocked(true), []);
  const unlockApp = useCallback(() => {
    setIsAppLocked(false);
    setPinRequest(null);
  }, []);

  const requestPin = useCallback(async (opts: PinRequest) => {
    const exists = await hasPin();
    if (!exists) {
      opts.onSuccess();
      return;
    }
    setPinRequest(opts);
  }, []);

  const dismissPin = useCallback(() => {
    setPinRequest(null);
  }, []);

  return (
    <PinContext.Provider
      value={{ isReady, isAppLocked, lockApp, unlockApp, pinRequest, requestPin, dismissPin }}
    >
      {children}
    </PinContext.Provider>
  );
}

export function usePinContext() {
  const ctx = useContext(PinContext);
  if (!ctx) throw new Error("usePinContext must be used inside PinProvider");
  return ctx;
}
