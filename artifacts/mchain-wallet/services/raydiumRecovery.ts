import {
  parseRaydiumSwapRecovery,
  type RaydiumSwapRecovery,
} from "./raydium";

export const RAYDIUM_SWAP_RECOVERY_PREFIX = "mchain_raydium_swap_recovery_v1_";

export type PersistentRecoveryStorage = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

export function raydiumSwapRecoveryKey(walletId: string): string {
  return `${RAYDIUM_SWAP_RECOVERY_PREFIX}${walletId}`;
}

/**
 * Keeps the wallet-screen recovery lifecycle separate from React state so it
 * can be exercised across screen remounts and active-wallet changes.
 */
export function createRaydiumSwapRecoveryStore(storage: PersistentRecoveryStorage) {
  return {
    async load(walletId: string, walletAddress: string): Promise<RaydiumSwapRecovery | null> {
      const key = raydiumSwapRecoveryKey(walletId);
      const stored = await storage.get(key);
      if (!stored) return null;

      const recovery = parseRaydiumSwapRecovery(stored);
      if (!recovery) {
        await storage.delete(key);
        return null;
      }

      return recovery.walletAddress === walletAddress ? recovery : null;
    },

    async save(walletId: string, recovery: RaydiumSwapRecovery): Promise<void> {
      await storage.set(raydiumSwapRecoveryKey(walletId), JSON.stringify(recovery));
    },

    async clear(walletId: string): Promise<void> {
      await storage.delete(raydiumSwapRecoveryKey(walletId));
    },
  };
}