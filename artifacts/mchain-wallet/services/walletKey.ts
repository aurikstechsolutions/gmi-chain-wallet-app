import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "mchain_wallet_key_v1";

let _cached: string | null = null;
let _initPromise: Promise<void> | null = null;

async function _init(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      _cached = stored;
    } else {
      const envKey = typeof process !== "undefined" ? process.env.EXPO_PUBLIC_WALLET_KEY : undefined;
      if (envKey) _cached = envKey;
    }
  } catch {
    const envKey = typeof process !== "undefined" ? process.env.EXPO_PUBLIC_WALLET_KEY : undefined;
    if (envKey) _cached = envKey;
  }
}

/** Idempotent — safe to await multiple times; resolves immediately after first run. */
export function initWalletKey(): Promise<void> {
  if (!_initPromise) _initPromise = _init();
  return _initPromise;
}

export function getWalletKey(): string | null {
  return _cached;
}

export async function setWalletKey(key: string): Promise<void> {
  await initWalletKey();
  const cleaned = key.trim();
  _cached = cleaned || null;
  if (cleaned) {
    await AsyncStorage.setItem(STORAGE_KEY, cleaned);
  } else {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }
}

export async function clearWalletKey(): Promise<void> {
  _cached = null;
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// Kick off init at module load — request() will await it before reading
void initWalletKey();
