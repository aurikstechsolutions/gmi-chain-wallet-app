/**
 * Cross-platform SecureStore shim.
 * • Native (iOS / Android): delegates to expo-secure-store (hardware-backed).
 * • Web (Simulate on Web / PWA): expo-secure-store's web polyfill in this SDK
 *   version is missing getValueWithKeyAsync, so we use localStorage instead.
 *   Web storage is NOT cryptographically secure; this is dev/preview only.
 *
 * Uses a STATIC import so Metro bundles it correctly on Hermes (native).
 * The native SecureStore functions are never called on web — we branch on
 * Platform.OS before any SecureStore call.
 */
import { Platform } from "react-native";
import * as NativeSecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

export async function getItemAsync(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  return NativeSecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
    return;
  }
  return NativeSecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return;
  }
  return NativeSecureStore.deleteItemAsync(key);
}

/**
 * Swap recovery records contain serialized Raydium transaction batches, which
 * can be larger than the platform keychain value limit. They are not private
 * keys, so keep them in the app's durable general-purpose storage instead of
 * SecureStore.
 */
export async function getPersistentItemAsync(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setPersistentItemAsync(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}

export async function deletePersistentItemAsync(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
