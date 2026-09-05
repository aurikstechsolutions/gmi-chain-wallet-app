import { Platform } from "react-native";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { cbc } from "@noble/ciphers/aes.js";

// ── NFC payload format written to card ────────────────────────────────────────
// JSON: { v:1, enc:"<hex>", iv:"<hex>", addr:"<gmiAddress>", label:"<label>" }
// enc  = AES-256-CBC(privateKey, key=PBKDF2-SHA256(pin, 50k iters, 32 bytes), iv=random 16 bytes)
// iv   = 16-byte random IV, hex-encoded
// addr = gmiAddress (plaintext, for display without decryption)
// pub  = removed in v1.1 to reduce payload size (was redundant — derivable after decryption)
//
// NOTE: Uses @noble/ciphers + @noble/hashes instead of Web Crypto API
// because crypto.subtle is not available in React Native's Hermes engine.

export interface NfcWalletPayload {
  v: 1;
  enc: string;
  iv: string;
  addr: string;
  /** @deprecated pub was removed from written payload to save card space; may still be present on older cards */
  pub?: string;
  label: string;
}

type NdefHandlerWithLegacyFormat = typeof import("react-native-nfc-manager") extends infer NfcModule
  ? NfcModule extends { default: infer NfcManager }
    ? NfcManager extends { ndefHandler: infer NdefHandler }
      ? NdefHandler & { format(bytes: number[]): Promise<void> }
      : never
    : never
  : never;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a Uint8Array to lowercase hex string */
function uint8ToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Convert a hex string to Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

/** Cryptographically secure random bytes — uses getRandomValues (available in Hermes) */
function secureRandomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  // crypto.getRandomValues is available in React Native Hermes; crypto.subtle is not
  (globalThis as unknown as { crypto: { getRandomValues: (b: Uint8Array) => void } })
    .crypto.getRandomValues(buf);
  return buf;
}

/** Derive a 32-byte AES key from a PIN using PBKDF2-SHA256 (pure JS, no Web Crypto) */
function pinToKey(pin: string): Uint8Array {
  const pinBytes = new TextEncoder().encode(pin);
  const salt = new TextEncoder().encode("mchain_nfc_v1");
  // 50k iterations — still strong for a 6-digit PIN, halves the JS-thread freeze on mobile
  return pbkdf2(sha256, pinBytes, salt, { c: 50_000, dkLen: 32 });
}

// ── Encrypt / Decrypt ─────────────────────────────────────────────────────────

/** Encrypt a private key with a PIN. Returns hex-encoded ciphertext and IV. */
export async function encryptPrivateKey(
  privateKey: string,
  pin: string
): Promise<{ enc: string; iv: string }> {
  const key = pinToKey(pin);
  const iv = secureRandomBytes(16);
  const data = new TextEncoder().encode(privateKey);
  const encrypted = cbc(key, iv).encrypt(data);
  return { enc: uint8ToHex(encrypted), iv: uint8ToHex(iv) };
}

/** Decrypt a private key from a card payload using a PIN.
 *  Throws if the PIN is wrong (AES-CBC padding error). */
export async function decryptPrivateKey(
  enc: string,
  iv: string,
  pin: string
): Promise<string> {
  const key = pinToKey(pin);
  const ivBytes = hexToBytes(iv);
  const encBytes = hexToBytes(enc);
  const decrypted = cbc(key, ivBytes).decrypt(encBytes);
  return new TextDecoder().decode(decrypted);
}

// ── NFC manager (lazy-loaded so web/simulator doesn't crash) ─────────────────

async function getNfc() {
  if (Platform.OS === "web") throw new Error("NFC not supported on web");
  const mod = await import("react-native-nfc-manager");
  return mod.default;
}

export async function isNfcSupported(): Promise<boolean> {
  try {
    if (Platform.OS === "web") return false;
    const NfcManager = await getNfc();
    return await NfcManager.isSupported();
  } catch {
    return false;
  }
}

export async function isNfcEnabled(): Promise<boolean> {
  try {
    if (Platform.OS === "web") return false;
    const NfcManager = await getNfc();
    return await NfcManager.isEnabled();
  } catch {
    return false;
  }
}

// ── Write payload to NFC card ─────────────────────────────────────────────────

/**
 * Start listening for an NFC card tap. Returns once the card enters the field.
 * Call this as early as possible (before/during heavy computation) so the app
 * captures the tap even if the user taps while the phone is busy.
 */
export async function waitForNfcCard(): Promise<void> {
  const mod = await import("react-native-nfc-manager");
  const NfcManager = mod.default;
  await NfcManager.start();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("No card detected after 30 seconds. Hold your NFC card flat against the back of the phone near the camera."));
    }, 30_000);
    NfcManager.requestTechnology("Ndef" as never)
      .then(() => { clearTimeout(timer); resolve(); })
      .catch((err: unknown) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Write a wallet payload to the card currently in field.
 * Must be called immediately after waitForNfcCard() resolves.
 */
export async function writePayloadToNfc(payload: NfcWalletPayload): Promise<void> {
  const mod = await import("react-native-nfc-manager");
  const { Ndef } = mod;
  const NfcManager = mod.default;
  try {
    // Strip pub before encoding — it's redundant and wastes ~130 bytes on the card
    const { pub: _pub, ...writablePayload } = payload;
    const json = JSON.stringify(writablePayload);
    const bytes = Ndef.encodeMessage([Ndef.textRecord(json)]);
    if (!bytes || bytes.length === 0) {
      throw new Error("Failed to encode payload — card may be incompatible.");
    }

    // ── Capacity check ────────────────────────────────────────────────────────
    // Read the tag now (NFC session is already open from waitForNfcCard) to get
    // its maxSize. Fail fast with a clear message instead of hanging for 12s.
    // NTAG213 = 144 bytes, NTAG215 = 504 bytes, NTAG216 = 888 bytes.
    // Our payload is ~210 bytes (post-pub removal), so NTAG213 won't work.
    try {
      const tag = await NfcManager.getTag();
      const maxSize: number | undefined = (tag as Record<string, unknown>)?.maxSize as number | undefined
        ?? (tag as Record<string, unknown>)?.ndefMessage as unknown as undefined;
      if (typeof maxSize === "number" && maxSize > 0 && bytes.length > maxSize) {
        throw new Error(
          `Card too small (${maxSize} bytes available, ${bytes.length} bytes needed). ` +
          `Use an NTAG215 or NTAG216 card.`
        );
      }
    } catch (tagErr) {
      // If it's our own capacity error, re-throw it
      if (tagErr instanceof Error && tagErr.message.includes("Card too small")) throw tagErr;
      // Otherwise getTag() just failed (some phones don't expose maxSize) — continue anyway
    }

    // Helper to classify a raw NFC write error into a user-friendly message
    function classifyWriteError(err: unknown): Error {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.toLowerCase();
      if (m.includes("readonly") || m.includes("read only"))
        return new Error("This card is read-only and cannot be written to.");
      if (m.includes("size") || m.includes("capacity") || m.includes("overflow") || m.includes("too large"))
        return new Error("Card is too small. Use an NTAG215 or NTAG216 card (504+ bytes).");
      if (m.includes("ioexception") || m.includes("tag was lost") || m.includes("lost"))
        return new Error("Card lost during write — keep it pressed firmly against the back of your phone and don't move it.");
      return new Error(`Write failed: ${msg}`);
    }

    const ndefHandler = NfcManager.ndefHandler as NdefHandlerWithLegacyFormat;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // 8s timeout — if we hit this, the card is almost certainly too small (silent overflow)
        reject(new Error(
          "Write timed out. Your card may be too small for this wallet — use an NTAG215 or NTAG216 card. " +
          "If your card is NTAG215/216, press it firmly and hold it still while writing."
        ));
      }, 8_000);

      // First attempt: standard NDEF write
      ndefHandler.writeNdefMessage(bytes)
        .then(() => { clearTimeout(timer); resolve(); })
        .catch(() => {
          // Second attempt: format + write in one step.
          // Some blank cards are NDEF-detectable but not yet NDEF-formatted.
          ndefHandler.format(bytes)
            .then(() => { clearTimeout(timer); resolve(); })
            .catch((formatErr: unknown) => {
              clearTimeout(timer);
              reject(classifyWriteError(formatErr));
            });
        });
    });
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

/** @deprecated Use waitForNfcCard() + writePayloadToNfc() instead */
export async function writeWalletToNfc(
  payload: NfcWalletPayload,
  onCardDetected?: () => void,
): Promise<void> {
  await waitForNfcCard();
  onCardDetected?.();
  await writePayloadToNfc(payload);
}

// ── Read payload from NFC card ────────────────────────────────────────────────

export async function readWalletFromNfc(): Promise<NfcWalletPayload | null> {
  const mod = await import("react-native-nfc-manager");
  const { Ndef } = mod;
  const NfcManager = mod.default;

  await NfcManager.start();
  try {
    await NfcManager.requestTechnology("Ndef" as never);
    const tag = await NfcManager.getTag();
    const records = tag?.ndefMessage ?? [];

    for (const record of records) {
      try {
        const text = Ndef.text.decodePayload(record.payload as unknown as Uint8Array);
        const parsed = JSON.parse(text) as NfcWalletPayload;
        if (
          parsed.v === 1 &&
          typeof parsed.enc === "string" && parsed.enc.length > 0 &&
          typeof parsed.iv === "string" && parsed.iv.length === 32 &&
          typeof parsed.addr === "string" && parsed.addr.length > 0
        ) {
          return parsed;
        }
      } catch {
        // Skip non-wallet / non-JSON records silently
      }
    }
    return null;
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

// ── Erase NFC card (overwrite with empty marker) ─────────────────────────────

/**
 * Erase an NFC card by overwriting it with a non-wallet NDEF record.
 * Replaces the wallet payload so it can no longer be used to load a wallet.
 */
export async function eraseNfcCard(): Promise<void> {
  const mod = await import("react-native-nfc-manager");
  const { Ndef } = mod;
  const NfcManager = mod.default;
  await NfcManager.start();
  try {
    await NfcManager.requestTechnology("Ndef" as never);
    const bytes = Ndef.encodeMessage([Ndef.textRecord('{"v":0,"erased":true}')]);
    if (!bytes || bytes.length === 0) {
      throw new Error("Failed to encode erase marker — card may be incompatible.");
    }
    const ndefHandler = NfcManager.ndefHandler as NdefHandlerWithLegacyFormat;
    await new Promise<void>((resolve, reject) => {
      ndefHandler.writeNdefMessage(bytes)
        .then(() => resolve())
        .catch(() =>
          ndefHandler.format(bytes)
            .then(() => resolve())
            .catch((err: unknown) => reject(err))
        );
    });
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

// ── Cancel any pending NFC operation ─────────────────────────────────────────

export async function cancelNfc(): Promise<void> {
  try {
    const NfcManager = await getNfc();
    await NfcManager.cancelTechnologyRequest();
  } catch {
    // Ignore — may already be cancelled or never started
  }
}
