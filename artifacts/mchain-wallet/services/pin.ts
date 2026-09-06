import * as SecureStore from "./secureStore";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

const PIN_KEY = "mchain_pin_hash";
const SALT = "mchain_wallet_pin_v1:";

function hashPin(pin: string): string {
  const bytes = new TextEncoder().encode(SALT + pin);
  return bytesToHex(sha256(bytes));
}

export async function setPin(pin: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_KEY, hashPin(pin));
}

export async function hasPin(): Promise<boolean> {
  const h = await SecureStore.getItemAsync(PIN_KEY);
  return !!h;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(PIN_KEY);
  if (!stored) return true;
  return stored === hashPin(pin);
}

export async function clearPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY);
}
