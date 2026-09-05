import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NfcSigningModal } from "@/components/NfcSigningModal";
import { PinModal } from "@/components/PinModal";
import { ScreenProtection } from "@/components/ScreenProtection";
import { SplashLoader } from "@/components/SplashLoader";
import { PinProvider, usePinContext } from "@/context/PinContext";
import { WalletProvider, useWallet } from "@/context/WalletContext";
import colors from "@/constants/colors";
import "@/services/backgroundTasks";
import "@/services/node";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 5_000 },
  },
});

// Persist the React Query cache to AsyncStorage so cold app restarts
// show cached data immediately instead of loading from network every time.
const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "mchain_rq_cache",
  throttleTime: 2_000, // write to storage at most every 2s
});

/**
 * Reads readiness from inside providers and signals the parent via onReady().
 * Children render as soon as ready — they sit behind the SplashLoader so
 * when it fades out the app is already painted underneath (no blank frame).
 */
function AppReadyGate({
  fontsLoaded,
  fontError,
  onReady,
  children,
}: {
  fontsLoaded: boolean;
  fontError: Error | null;
  onReady: () => void;
  children: React.ReactNode;
}) {
  const { isReady } = usePinContext();
  const { isLoading: walletLoading } = useWallet();
  const ready = (fontsLoaded || !!fontError) && isReady && !walletLoading;

  useEffect(() => {
    if (ready) onReady();
  }, [ready]);

  // Block children until ready — SplashLoader covers the screen anyway
  if (!ready) return null;
  return <>{children}</>;
}

function PinGate({ children }: { children: React.ReactNode }) {
  const { isAppLocked, unlockApp, pinRequest, dismissPin } = usePinContext();
  const showModal = isAppLocked || !!pinRequest;
  const modalTitle = isAppLocked ? "Unlock Wallet" : (pinRequest?.title ?? "");
  const modalSubtitle = isAppLocked
    ? "Enter your PIN to access your wallet."
    : pinRequest?.subtitle;
  const modalOnSuccess = isAppLocked
    ? unlockApp
    : () => { dismissPin(); pinRequest?.onSuccess(); };
  const modalOnCancel = isAppLocked
    ? undefined
    : (pinRequest?.onCancel ?? dismissPin);

  return (
    <>
      {children}
      <PinModal
        visible={showModal}
        title={modalTitle}
        subtitle={modalSubtitle}
        onSuccess={modalOnSuccess}
        onCancel={modalOnCancel}
        animationType={isAppLocked ? "none" : "fade"}
      />
      <NfcSigningModal />
    </>
  );
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="onboarding"
        options={{ headerShown: false, gestureEnabled: false }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Signalled from AppReadyGate once fonts + providers are ready
  const [appReady, setAppReady] = useState(false);

  // Drop the native OS splash immediately — SplashLoader covers the screen
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
      <SafeAreaProvider style={{ backgroundColor: colors.light.background }}>
      <ErrorBoundary>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: asyncStoragePersister, maxAge: 24 * 60 * 60_000 }}
        >
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.light.background }}>
            <ScreenProtection>

            <WalletProvider>
              <PinProvider>
                {/* Children render when ready — they paint behind the loader */}
                <AppReadyGate
                  fontsLoaded={fontsLoaded}
                  fontError={fontError}
                  onReady={() => setAppReady(true)}
                >
                  <PinGate>
                    <RootLayoutNav />
                  </PinGate>
                </AppReadyGate>
              </PinProvider>
            </WalletProvider>

            {/*
             * SplashLoader is outside all providers — renders on the very
             * first frame regardless of provider init state. Uses absolute
             * positioning + elevation so it always sits on top.
             * When appReady fires it waits for MIN_MS then fades out,
             * by which point the app content is already rendered behind it.
             */}
            <SplashLoader ready={appReady} onDone={() => {}} />

            </ScreenProtection>
          </GestureHandlerRootView>
        </PersistQueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
