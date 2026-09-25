export type SwapHistoryNetwork = "gmi" | "solana";

export interface SwapHistoryEntry {
  id: string;
  network: SwapHistoryNetwork;
  walletAddress: string;
  fromSymbol: string;
  toSymbol: string;
  amountIn: string;
  amountOut: string;
  txHash: string;
  completedAt: string;
}

export type SwapHistoryStorage = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

export const SWAP_HISTORY_PREFIX = "mchain_swap_history_v1_";
export const SWAP_HISTORY_LIMIT = 20;

export function swapHistoryKey(walletId: string): string {
  return `${SWAP_HISTORY_PREFIX}${walletId}`;
}

function isSwapHistoryEntry(value: unknown): value is SwapHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SwapHistoryEntry>;
  return typeof entry.id === "string"
    && (entry.network === "gmi" || entry.network === "solana")
    && typeof entry.walletAddress === "string"
    && typeof entry.fromSymbol === "string"
    && typeof entry.toSymbol === "string"
    && typeof entry.amountIn === "string"
    && typeof entry.amountOut === "string"
    && typeof entry.txHash === "string"
    && typeof entry.completedAt === "string"
    && Number.isFinite(Date.parse(entry.completedAt));
}

function parseSwapHistory(raw: string): SwapHistoryEntry[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(isSwapHistoryEntry);
  } catch {
    return null;
  }
}

export function createSwapHistoryStore(storage: SwapHistoryStorage) {
  let writeQueue: Promise<void> = Promise.resolve();

  async function load(walletId: string): Promise<SwapHistoryEntry[]> {
    const key = swapHistoryKey(walletId);
    const raw = await storage.get(key);
    if (!raw) return [];

    const entries = parseSwapHistory(raw);
    if (!entries) {
      await storage.delete(key);
      return [];
    }

    return entries
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
      .slice(0, SWAP_HISTORY_LIMIT);
  }

  async function add(walletId: string, entry: SwapHistoryEntry): Promise<SwapHistoryEntry[]> {
    if (!isSwapHistoryEntry(entry)) throw new Error("Invalid swap history entry");
    const operation = writeQueue.catch(() => undefined).then(async () => {
      const entries = await load(walletId);
      const next = [
        entry,
        ...entries.filter((stored) => stored.id !== entry.id),
      ]
        .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
        .slice(0, SWAP_HISTORY_LIMIT);
      await storage.set(swapHistoryKey(walletId), JSON.stringify(next));
      return next;
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return { load, add };
}