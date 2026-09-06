import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "@/services/secureStore";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { deriveAddressFromPublicKey, mxcAddressToEthAddress, normalizeGmiAddress, generateKeyPair, mnemonicToKeyPair, validateMnemonicWords, type KeyPair } from "@/services/crypto";
import { deriveSolanaAddress } from "@/services/solana";
import { api } from "@/services/api";
import type { ValidatorInfo } from "@/services/api";

// ─── Wallet entry (no private key; that lives in SecureStore) ───────────────
export interface WalletEntry {
  id: string;
  mxcAddress: string;
  ethAddress: string;
  solAddress?: string;
  publicKey: string;
  label: string;
  createdAt: string;
  /** NFC secure mode: private key is never stored — card tap + PIN required per transaction */
  nfcTemporary?: boolean;
  /** ISO timestamp: 5 minutes after import, wallet is auto-removed */
  nfcSessionExpiresAt?: string;
}

// ─── Storage keys ────────────────────────────────────────────────────────────
const KEYS = {
  WALLETS: "mchain_wallets_v2",
  ACTIVE_WALLET_ID: "mchain_active_wallet_id",
  VALIDATOR_WALLET_ID: "mchain_validator_wallet_id",
  VALIDATOR_ADDRESS: "mchain_validator_address",
  VALIDATOR_STATUS: "validatorStatus",
  MONIKER: "mchain_moniker",
  DEVICE_ID: "mchain_device_id",
  SESSION_EXPIRES_AT: "mchain_session_expires_at",
  LEGACY_ONBOARDED: "mchain_is_onboarded",
  LEGACY_MXC_ADDRESS: "mchain_mxc_address",
  LEGACY_ETH_ADDRESS: "mchain_eth_address",
  LEGACY_PUBLIC_KEY: "mchain_public_key",
  LEGACY_PRIVATE_KEY: "mchain_private_key",
  PK_PREFIX: "mchain_pk_",
};

export type ValidatorStatus = "active" | "paused" | "pending" | "inactive" | "banned";

export interface ImportResult {
  keypair: KeyPair;
  isExistingValidator: boolean;
  validatorInfo?: ValidatorInfo;
}

/** Passed to the NfcSigningModal so it knows which wallet needs signing */
export interface NfcSigningRequest {
  walletId: string;
  walletLabel: string;
}

// ─── Context interface ────────────────────────────────────────────────────────
interface WalletContextType {
  isLoading: boolean;
  isOnboarded: boolean;

  wallets: WalletEntry[];
  activeWallet: WalletEntry | null;
  validatorWallet: WalletEntry | null;

  mxcAddress: string | null;
  ethAddress: string | null;
  solAddress: string | null;
  publicKey: string | null;

  moniker: string;
  deviceId: string;
  validatorStatus: ValidatorStatus | null;
  setValidatorStatus: (status: ValidatorStatus | null) => void;
  pendingHeartbeat: boolean;
  setPendingHeartbeat: (pending: boolean) => void;
  sessionExpired: boolean;
  setSessionExpired: (expired: boolean) => void;
  sessionExpiresAt: string | null;
  setSessionExpiresAt: (value: string | null) => Promise<void>;
  isStaked: boolean;
  setIsStaked: (staked: boolean) => void;

  addWallet: (keypair: KeyPair, label: string) => Promise<WalletEntry>;
  /** Add an NFC wallet without storing the private key — card+PIN required per transaction */
  /** sessionMins: 0 = never auto-remove, undefined/omitted = use default 5 min */
  addNfcTemporaryWallet: (keypair: KeyPair, label: string, sessionMins?: number) => Promise<WalletEntry>;
  switchWallet: (id: string) => Promise<void>;
  removeWallet: (id: string) => Promise<{ error?: string }>;
  setValidatorWallet: (id: string) => Promise<void>;

  generateAndStoreKeyPair: () => Promise<KeyPair>;
  resolveImportMnemonic: (mnemonic: string) => Promise<ImportResult>;
  completeOnboarding: (
    mxcAddress: string,
    ethAddress: string,
    publicKey: string,
    privateKey: string,
    moniker: string,
    restoredValidatorStatus?: ValidatorStatus
  ) => Promise<void>;
  getPrivateKey: (walletId?: string) => Promise<string | null>;
  updateMoniker: (moniker: string) => Promise<void>;

  /** Set by getPrivateKey() when an nfcTemporary wallet needs signing */
  nfcSigningRequest: NfcSigningRequest | null;
  /** Call from NfcSigningModal on successful card-tap + PIN decrypt */
  resolveNfcSigning: (privateKey: string) => void;
  /** Call from NfcSigningModal when user cancels */
  rejectNfcSigning: () => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isOnboarded, setIsOnboarded] = useState(false);

  const [wallets, setWallets] = useState<WalletEntry[]>([]);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [validatorWalletId, setValidatorWalletId] = useState<string | null>(null);

  const [moniker, setMoniker] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [validatorStatus, setValidatorStatusState] = useState<ValidatorStatus | null>(null);
  const [pendingHeartbeat, setPendingHeartbeat] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAtState] = useState<string | null>(null);
  const [isStaked, setIsStaked] = useState(false);

  // ── NFC signing state ────────────────────────────────────────────────────
  const [nfcSigningRequest, setNfcSigningRequest] = useState<NfcSigningRequest | null>(null);
  const nfcSigningResolverRef = useRef<((key: string | null) => void) | null>(null);

  const activeWallet = wallets.find((w) => w.id === activeWalletId) ?? null;
  const validatorWallet = wallets.find((w) => w.id === validatorWalletId) ?? null;

  const mxcAddress = activeWallet?.mxcAddress ?? null;
  const ethAddress = activeWallet?.ethAddress ?? null;
  const solAddress = activeWallet?.solAddress ?? null;
  const publicKey = activeWallet?.publicKey ?? null;

  useEffect(() => {
    loadStoredData();
  }, []);

  // ── Auto-remove nfcTemporary wallets after their session expires ──────────
  useEffect(() => {
    const nfcWallets = wallets.filter(w => w.nfcTemporary && w.nfcSessionExpiresAt);
    if (nfcWallets.length === 0) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const w of nfcWallets) {
      const msLeft = new Date(w.nfcSessionExpiresAt!).getTime() - Date.now();
      if (msLeft <= 0) {
        // Already expired — schedule immediate removal
        timers.push(setTimeout(() => removeWalletById(w.id), 0));
      } else {
        timers.push(setTimeout(() => removeWalletById(w.id), msLeft));
      }
    }

    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets.map(w => w.id + (w.nfcTemporary ? w.nfcSessionExpiresAt : "")).join("|")]);

  /** Internal remove that also rejects any pending NFC signing for that wallet */
  async function removeWalletById(id: string) {
    setWallets(prev => {
      const updated = prev.filter(w => w.id !== id);
      AsyncStorage.setItem(KEYS.WALLETS, JSON.stringify(updated)).catch(() => {});
      return updated;
    });

    // If the removed wallet has a pending signing request, reject it
    setNfcSigningRequest(req => {
      if (req?.walletId === id) {
        if (nfcSigningResolverRef.current) {
          nfcSigningResolverRef.current(null);
          nfcSigningResolverRef.current = null;
        }
        return null;
      }
      return req;
    });

    // Switch away if this was the active wallet
    setActiveWalletId(prev => {
      if (prev !== id) return prev;
      const remaining = wallets.filter(w => w.id !== id);
      const fallback = validatorWalletId ?? remaining[0]?.id ?? null;
      if (fallback) AsyncStorage.setItem(KEYS.ACTIVE_WALLET_ID, fallback).catch(() => {});
      return fallback;
    });

    SecureStore.deleteItemAsync(KEYS.PK_PREFIX + id).catch(() => {});
  }

  async function loadStoredData() {
    try {
      const walletsJson = await AsyncStorage.getItem(KEYS.WALLETS);
      const legacyOnboarded = await AsyncStorage.getItem(KEYS.LEGACY_ONBOARDED);

      let loadedWallets: WalletEntry[] = [];
      let loadedActiveId: string | null = null;
      let loadedValidatorId: string | null = null;

      if (!walletsJson && legacyOnboarded === "true") {
        const [addr, eth, pubKey, mon, devId] = await Promise.all([
          AsyncStorage.getItem(KEYS.LEGACY_MXC_ADDRESS),
          AsyncStorage.getItem(KEYS.LEGACY_ETH_ADDRESS),
          AsyncStorage.getItem(KEYS.LEGACY_PUBLIC_KEY),
          AsyncStorage.getItem(KEYS.MONIKER),
          AsyncStorage.getItem(KEYS.DEVICE_ID),
        ]);

        let correctedAddr = addr;
        let correctedEth = eth;
        if (pubKey) {
          try {
            correctedAddr = deriveAddressFromPublicKey(pubKey);
            correctedEth = mxcAddressToEthAddress(correctedAddr);
            await AsyncStorage.setItem(KEYS.LEGACY_MXC_ADDRESS, correctedAddr);
            if (correctedEth) await AsyncStorage.setItem(KEYS.LEGACY_ETH_ADDRESS, correctedEth);
          } catch {
            correctedAddr = addr ?? "";
            correctedEth = eth;
          }
        } else if (addr) {
          try {
            correctedAddr = normalizeGmiAddress(addr);
            await AsyncStorage.setItem(KEYS.LEGACY_MXC_ADDRESS, correctedAddr);
          } catch {
            correctedAddr = addr;
          }
        }

        if (correctedAddr && correctedEth && pubKey) {
          const id = "w_migrated";
          const entry: WalletEntry = {
            id,
            mxcAddress: correctedAddr,
            ethAddress: correctedEth,
            publicKey: pubKey,
            label: "Validator Wallet",
            createdAt: new Date().toISOString(),
          };

          const legacyPrivKey = await SecureStore.getItemAsync(KEYS.LEGACY_PRIVATE_KEY);
          if (legacyPrivKey) {
            entry.solAddress = deriveSolanaAddress(legacyPrivKey);
            await SecureStore.setItemAsync(KEYS.PK_PREFIX + id, legacyPrivKey);
          }

          await Promise.all([
            AsyncStorage.setItem(KEYS.WALLETS, JSON.stringify([entry])),
            AsyncStorage.setItem(KEYS.ACTIVE_WALLET_ID, id),
            AsyncStorage.setItem(KEYS.VALIDATOR_WALLET_ID, id),
            AsyncStorage.setItem(KEYS.VALIDATOR_ADDRESS, correctedAddr),
          ]);

          loadedWallets = [entry];
          loadedActiveId = id;
          loadedValidatorId = id;
          setIsOnboarded(true);
          setMoniker(mon ?? "");

          if (devId) {
            setDeviceId(devId);
          } else {
            const newId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
            await AsyncStorage.setItem(KEYS.DEVICE_ID, newId);
            setDeviceId(newId);
          }
        }
      } else if (walletsJson) {
        const [activeId, validatorId, mon, devId] = await Promise.all([
          AsyncStorage.getItem(KEYS.ACTIVE_WALLET_ID),
          AsyncStorage.getItem(KEYS.VALIDATOR_WALLET_ID),
          AsyncStorage.getItem(KEYS.MONIKER),
          AsyncStorage.getItem(KEYS.DEVICE_ID),
        ]);

        const parsed: WalletEntry[] = JSON.parse(walletsJson);

        // Filter out any nfcTemporary wallets that already expired (app was closed and reopened)
        const now = Date.now();
        const filtered = parsed.filter(w => {
          if (!w.nfcTemporary || !w.nfcSessionExpiresAt) return true;
          return new Date(w.nfcSessionExpiresAt).getTime() > now;
        });
        if (filtered.length !== parsed.length) {
          await AsyncStorage.setItem(KEYS.WALLETS, JSON.stringify(filtered));
        }

        let needsAddressSave = false;
        loadedWallets = filtered.map(w => {
          if (!w.publicKey && !w.mxcAddress) return w;
          try {
            const correctedMxc = w.publicKey
              ? deriveAddressFromPublicKey(w.publicKey)
              : normalizeGmiAddress(w.mxcAddress);
            const correctedEth = mxcAddressToEthAddress(correctedMxc);
            if (w.mxcAddress !== correctedMxc || w.ethAddress !== correctedEth) {
              needsAddressSave = true;
              return { ...w, mxcAddress: correctedMxc, ethAddress: correctedEth };
            }
          } catch { /* keep as-is */ }
          return w;
        });

        for (const wallet of loadedWallets) {
          if (wallet.solAddress || wallet.nfcTemporary) continue;
          try {
            const privateKey = await SecureStore.getItemAsync(KEYS.PK_PREFIX + wallet.id);
            if (privateKey) {
              wallet.solAddress = deriveSolanaAddress(privateKey);
              needsAddressSave = true;
            }
          } catch {
            // Keep older wallet usable on GMI even if Solana migration fails.
          }
        }
        if (needsAddressSave) {
          await AsyncStorage.setItem(KEYS.WALLETS, JSON.stringify(loadedWallets));
        }

        // If active wallet was an expired NFC one, fall back to validator
        loadedActiveId = loadedWallets.find(w => w.id === activeId) ? activeId : (validatorId ?? loadedWallets[0]?.id ?? null);
        loadedValidatorId = validatorId;

        setIsOnboarded(true);
        setMoniker(mon ?? "");

        if (devId) {
          setDeviceId(devId);
        } else {
          const newId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
          await AsyncStorage.setItem(KEYS.DEVICE_ID, newId);
          setDeviceId(newId);
        }
      }

      setWallets(loadedWallets);
      setActiveWalletId(loadedActiveId);
      setValidatorWalletId(loadedValidatorId);

      try {
        const storedStatus = await AsyncStorage.getItem(KEYS.VALIDATOR_STATUS);
        if (storedStatus) {
          setValidatorStatusState(storedStatus as ValidatorStatus);
          if (storedStatus === "paused") setSessionExpired(true);
        }
      } catch { /* ignore */ }

      try {
        const storedExpiry = await SecureStore.getItemAsync(KEYS.SESSION_EXPIRES_AT);
        if (storedExpiry) {
          setSessionExpiresAtState(storedExpiry);
          if (new Date(storedExpiry) < new Date()) {
            setSessionExpired(true);
          }
        }
      } catch { /* ignore */ }
    } catch {
      // Continue with defaults
    } finally {
      setIsLoading(false);
    }
  }

  const setValidatorStatus = useCallback(
    (status: ValidatorStatus | null) => {
      setValidatorStatusState(status);
      setSessionExpired(status === "paused");
      if (status) {
        AsyncStorage.setItem(KEYS.VALIDATOR_STATUS, status).catch(() => {});
      } else {
        AsyncStorage.removeItem(KEYS.VALIDATOR_STATUS).catch(() => {});
      }
    },
    []
  );

  const setSessionExpiresAt = useCallback(async (value: string | null) => {
    setSessionExpiresAtState(value);
    try {
      if (value) {
        await SecureStore.setItemAsync(KEYS.SESSION_EXPIRES_AT, value);
      } else {
        await SecureStore.deleteItemAsync(KEYS.SESSION_EXPIRES_AT);
      }
    } catch { /* ignore */ }
  }, []);

  const generateAndStoreKeyPair = useCallback(async (): Promise<KeyPair> => {
    return generateKeyPair();
  }, []);

  const resolveImportMnemonic = useCallback(async (mnemonic: string): Promise<ImportResult> => {
    if (!validateMnemonicWords(mnemonic)) {
      throw new Error("Invalid seed phrase. Please check all 12 words and try again.");
    }
    const keypair = mnemonicToKeyPair(mnemonic);
    try {
      const { validator } = await api.getValidatorStatus(keypair.mxcAddress);
      return { keypair, isExistingValidator: true, validatorInfo: validator };
    } catch {
      return { keypair, isExistingValidator: false };
    }
  }, []);

  const addWallet = useCallback(
    async (keypair: KeyPair, label: string): Promise<WalletEntry> => {
      const id = "w_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const entry: WalletEntry = {
        id,
        mxcAddress: keypair.mxcAddress,
        ethAddress: keypair.ethAddress,
        solAddress: deriveSolanaAddress(keypair.privateKey),
        publicKey: keypair.publicKey,
        label: label.trim() || "Wallet",
        createdAt: new Date().toISOString(),
      };

      const updated = [...wallets, entry];
      await AsyncStorage.setItem(KEYS.WALLETS, JSON.stringify(updated));
      await SecureStore.setItemAsync(KEYS.PK_PREFIX + id, keypair.privateKey);
      setWallets(updated);
      return entry;
    },
    [wallets]
  );

  const addNfcTemporaryWallet = useCallback(
    async (keypair: KeyPair, label: string, sessionMins?: number): Promise<WalletEntry> => {
      const id = "w_nfc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const mins = sessionMins === undefined ? 5 : sessionMins;
      // 0 means "never auto-remove"
      const sessionExpiresAt = mins > 0
        ? new Date(Date.now() + mins * 60 * 1000).toISOString()
        : undefined;
      const entry: WalletEntry = {
        id,
        mxcAddress: keypair.mxcAddress,
        ethAddress: keypair.ethAddress,
        solAddress: deriveSolanaAddress(keypair.privateKey),
        publicKey: keypair.publicKey,
        label: label.trim() || "NFC Wallet",
        createdAt: new Date().toISOString(),
        nfcTemporary: true,
        ...(sessionExpiresAt ? { nfcSessionExpiresAt: sessionExpiresAt } : {}),
      };

      const updated = [...wallets, entry];
      await AsyncStorage.setItem(KEYS.WALLETS, JSON.stringify(updated));
      // Private key intentionally NOT stored in SecureStore
      setWallets(updated);
      return entry;
    },
    [wallets]
  );

  const switchWallet = useCallback(
    async (id: string) => {
      const found = wallets.find((w) => w.id === id);
      if (!found) return;
      await AsyncStorage.setItem(KEYS.ACTIVE_WALLET_ID, id);
      setActiveWalletId(id);
    },
    [wallets]
  );

  const removeWallet = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      if (id === validatorWalletId) {
        return { error: "Cannot remove the validator wallet." };
      }
      if (wallets.length <= 1) {
        return { error: "Cannot remove the only wallet." };
      }

      const updated = wallets.filter((w) => w.id !== id);
      await AsyncStorage.setItem(KEYS.WALLETS, JSON.stringify(updated));

      try {
        await SecureStore.deleteItemAsync(KEYS.PK_PREFIX + id);
      } catch { /* ignore */ }

      // Reject any pending NFC signing for this wallet
      if (nfcSigningRequest?.walletId === id) {
        if (nfcSigningResolverRef.current) {
          nfcSigningResolverRef.current(null);
          nfcSigningResolverRef.current = null;
        }
        setNfcSigningRequest(null);
      }

      let newActiveId = activeWalletId;
      if (activeWalletId === id) {
        newActiveId = validatorWalletId ?? updated[0].id;
        await AsyncStorage.setItem(KEYS.ACTIVE_WALLET_ID, newActiveId);
        setActiveWalletId(newActiveId);
      }

      setWallets(updated);
      return {};
    },
    [wallets, activeWalletId, validatorWalletId, nfcSigningRequest]
  );

  const setValidatorWallet = useCallback(
    async (id: string) => {
      const found = wallets.find((w) => w.id === id);
      if (!found) return;
      await Promise.all([
        AsyncStorage.setItem(KEYS.VALIDATOR_WALLET_ID, id),
        AsyncStorage.setItem(KEYS.VALIDATOR_ADDRESS, found.mxcAddress),
      ]);
      setValidatorWalletId(id);
    },
    [wallets]
  );

  const completeOnboarding = useCallback(
    async (
      addr: string,
      eth: string,
      pubKey: string,
      privKey: string,
      mon: string,
      restoredValidatorStatus?: ValidatorStatus
    ) => {
      const id = "w_validator_" + Date.now();
      const entry: WalletEntry = {
        id,
        mxcAddress: addr,
        ethAddress: eth,
        solAddress: deriveSolanaAddress(privKey),
        publicKey: pubKey,
        label: "Validator Wallet",
        createdAt: new Date().toISOString(),
      };

      const updated = [entry];
      const ops: Promise<unknown>[] = [
        AsyncStorage.setItem(KEYS.LEGACY_ONBOARDED, "true"),
        AsyncStorage.setItem(KEYS.WALLETS, JSON.stringify(updated)),
        AsyncStorage.setItem(KEYS.ACTIVE_WALLET_ID, id),
        AsyncStorage.setItem(KEYS.VALIDATOR_WALLET_ID, id),
        AsyncStorage.setItem(KEYS.VALIDATOR_ADDRESS, addr),
        AsyncStorage.setItem(KEYS.MONIKER, mon),
        SecureStore.setItemAsync(KEYS.PK_PREFIX + id, privKey),
      ];

      if (restoredValidatorStatus) {
        ops.push(AsyncStorage.setItem(KEYS.VALIDATOR_STATUS, restoredValidatorStatus));
      }

      await Promise.all(ops);

      setIsOnboarded(true);
      setWallets(updated);
      setActiveWalletId(id);
      setValidatorWalletId(id);
      setMoniker(mon);

      if (restoredValidatorStatus) {
        setValidatorStatusState(restoredValidatorStatus);
        if (restoredValidatorStatus === "paused") setSessionExpired(true);
      }
    },
    []
  );

  const getPrivateKey = useCallback(
    async (walletId?: string): Promise<string | null> => {
      const id = walletId ?? activeWalletId;
      if (!id) return null;

      const wallet = wallets.find(w => w.id === id);

      // NFC secure mode: key never stored — require card tap + PIN via modal
      if (wallet?.nfcTemporary) {
        return new Promise<string | null>((resolve) => {
          nfcSigningResolverRef.current = resolve;
          setNfcSigningRequest({ walletId: id, walletLabel: wallet.label });
        });
      }

      const key = await SecureStore.getItemAsync(KEYS.PK_PREFIX + id);
      if (key) return key;
      return SecureStore.getItemAsync(KEYS.LEGACY_PRIVATE_KEY);
    },
    [activeWalletId, wallets]
  );

  const resolveNfcSigning = useCallback((privateKey: string) => {
    if (nfcSigningResolverRef.current) {
      nfcSigningResolverRef.current(privateKey);
      nfcSigningResolverRef.current = null;
    }
    setNfcSigningRequest(null);
  }, []);

  const rejectNfcSigning = useCallback(() => {
    if (nfcSigningResolverRef.current) {
      nfcSigningResolverRef.current(null);
      nfcSigningResolverRef.current = null;
    }
    setNfcSigningRequest(null);
  }, []);

  const updateMoniker = useCallback(async (mon: string) => {
    await AsyncStorage.setItem(KEYS.MONIKER, mon);
    setMoniker(mon);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        isLoading,
        isOnboarded,
        wallets,
        activeWallet,
        validatorWallet,
        mxcAddress,
        ethAddress,
        solAddress,
        publicKey,
        moniker,
        deviceId,
        validatorStatus,
        setValidatorStatus,
        pendingHeartbeat,
        setPendingHeartbeat,
        sessionExpired,
        setSessionExpired,
        sessionExpiresAt,
        setSessionExpiresAt,
        isStaked,
        setIsStaked,
        addWallet,
        addNfcTemporaryWallet,
        switchWallet,
        removeWallet,
        setValidatorWallet,
        generateAndStoreKeyPair,
        resolveImportMnemonic,
        completeOnboarding,
        getPrivateKey,
        updateMoniker,
        nfcSigningRequest,
        resolveNfcSigning,
        rejectNfcSigning,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
