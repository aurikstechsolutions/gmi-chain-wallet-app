import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import { GMI_NATIVE_DECIMALS, GMI_NATIVE_NAME, GMI_NATIVE_SYMBOL } from "./chain";
import { fetchSolanaBalance, fetchSolanaTokenBalance, isValidSolanaAddress } from "./solana";
import {
  SOLANA_GMI_CONTRACT_ADDRESS,
  SOLANA_USDT_CONTRACT_ADDRESS,
} from "./solanaAssets";
export { SOLANA_GMI_CONTRACT_ADDRESS } from "./solanaAssets";

// ─── Storage key strategy ─────────────────────────────────────────────────────
// Regular wallet:  mchain_tokens_v2_{walletId}
// NFC wallet:      mchain_tokens_nfc_{mxcAddress}
//   → NFC wallets use the card's address so the same token list reappears
//     every time that card is reconnected, regardless of the wallet session ID.
//
// Legacy global key "mchain_custom_tokens_v1" is migrated on first read.

const LEGACY_KEY = "mchain_custom_tokens_v1";

function storageKey(walletId: string, nfcTemporary?: boolean, mxcAddress?: string): string {
  if (nfcTemporary && mxcAddress) return `mchain_tokens_nfc_${mxcAddress}`;
  return `mchain_tokens_v2_${walletId}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CustomToken {
  id: string;
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
  chain?: "gmi" | "bsc" | "solana";
  verified: boolean;
  addedAt: string;
}

export interface VerifiedToken {
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
  coingeckoId: string;
  contractAddress?: string;
}

// Token contracts are deliberately not hardcoded here. The API's verified
// registry is the source of truth once authoritative GMI metadata is entered.
export const VERIFIED_TOKENS: VerifiedToken[] = [];

// ─── Default assets (always shown, non-removable) ─────────────────────────────
export interface DefaultAsset {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
  logoSource?: number;
  networkLabel: string;
  chain: "gmi" | "bsc" | "solana";
  contractAddress?: string;
  priceKey: string;
}

const USDT_LOGO_URL =
  "https://coin-images.coingecko.com/coins/images/325/large/Tether.png";

export const DEFAULT_ASSETS: DefaultAsset[] = [
  {
    id: "gmi-native",
    symbol: GMI_NATIVE_SYMBOL,
    name: GMI_NATIVE_NAME,
    decimals: GMI_NATIVE_DECIMALS,
    logoUrl: "",
    logoSource: require("../assets/images/gmi-icon.png"),
    networkLabel: "GMI Chain",
    chain: "gmi",
    priceKey: GMI_NATIVE_SYMBOL,
  },
  {
    id: "gmi-usdt",
    symbol: "wUSDT",
    name: "GMI Wrapped USDT",
    decimals: 18,
    logoUrl: USDT_LOGO_URL,
    networkLabel: "GMI Chain",
    chain: "gmi",
    contractAddress: "0x7b2ed1be97fa240dbd0328dd307e35e588bcb917",
    priceKey: "USDT",
  },
  {
    id: "solana-native",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    logoUrl: "https://coin-images.coingecko.com/coins/images/4128/large/solana.png",
    logoSource: require("../assets/images/solana-coingecko.png"),
    networkLabel: "Solana",
    chain: "solana",
    priceKey: "SOL",
  },
  {
    id: "solana-gmi",
    symbol: GMI_NATIVE_SYMBOL,
    name: "GMI Token (Solana)",
    decimals: 6,
    logoUrl: "",
    logoSource: require("../assets/images/gmi-icon.png"),
    networkLabel: "Solana",
    chain: "solana",
    contractAddress: SOLANA_GMI_CONTRACT_ADDRESS,
    priceKey: GMI_NATIVE_SYMBOL,
  },
  {
    id: "solana-usdt",
    symbol: "USDT",
    name: "Tether USD (Solana)",
    decimals: 6,
    logoUrl: USDT_LOGO_URL,
    networkLabel: "Solana",
    chain: "solana",
    contractAddress: SOLANA_USDT_CONTRACT_ADDRESS,
    priceKey: "USDT",
  },
  {
    id: "bsc-bnb",
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
    logoUrl: "https://coin-images.coingecko.com/coins/images/825/large/bnb-icon2_2x.png",
    logoSource: require("../assets/images/bnb-coingecko.png"),
    networkLabel: "BNB Smart Chain",
    chain: "bsc",
    priceKey: "BNB",
  },
  {
    id: "bsc-usdt",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 18,
    logoUrl: USDT_LOGO_URL,
    networkLabel: "BEP-20",
    chain: "bsc",
    contractAddress: "0x55d398326f99059fF775485246999027B3197955",
    priceKey: "USDT",
  },
];

for (const asset of DEFAULT_ASSETS) {
  if (asset.chain === "solana" && asset.contractAddress && !isValidSolanaAddress(asset.contractAddress)) {
    throw new Error(`Invalid bundled Solana mint for ${asset.id}`);
  }
}

// ─── BSCScan API (tx history) ─────────────────────────────────────────────────
const BSCSCAN_API = "https://api.bscscan.com/api";
const BSC_HISTORY_RPC = "https://bsc.publicnode.com";
const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a9df523b3ef";

export interface BscApiTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  isError: string;
  blockNumber: string;
}

type BscRpcLog = {
  transactionHash: string;
  blockNumber: string;
  topics: string[];
  data: string;
};

async function bscHistoryRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(BSC_HISTORY_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`BNB history RPC failed (${response.status})`);
  const body = await response.json() as { result?: T; error?: { message?: string } };
  if (body.error || body.result === undefined) {
    throw new Error(body.error?.message || "BNB history RPC returned no result");
  }
  return body.result;
}

function addressTopic(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function decodeTopicAddress(topic: string | undefined): string {
  return topic ? `0x${topic.slice(-40)}` : "";
}

function decodeHexUint(value: string): string {
  try {
    return BigInt(value || "0x0").toString();
  } catch {
    return "0";
  }
}

async function fetchBscTokenHistoryFromRpc(
  ethAddress: string,
  contractAddress: string,
): Promise<BscApiTx[]> {
  const latestHex = await bscHistoryRpc<string>("eth_blockNumber", []);
  const latest = Number(BigInt(latestHex));
  // Public BSC RPCs do not expose an address-indexed history endpoint. Filter
  // Transfer logs server-side over a recent window instead of returning the
  // empty result from the deprecated BscScan v1 endpoint.
  const fromBlock = Math.max(0, latest - 100_000);
  const address = addressTopic(ethAddress);
  const [sent, received] = await Promise.all([
    bscHistoryRpc<BscRpcLog[]>("eth_getLogs", [{
      address: contractAddress,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: latestHex,
      topics: [ERC20_TRANSFER_TOPIC, address],
    }]),
    bscHistoryRpc<BscRpcLog[]>("eth_getLogs", [{
      address: contractAddress,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: latestHex,
      topics: [ERC20_TRANSFER_TOPIC, null, address],
    }]),
  ]);
  const seen = new Set<string>();
  return [...sent, ...received]
    .filter((log) => {
      if (!log.transactionHash || seen.has(log.transactionHash)) return false;
      seen.add(log.transactionHash);
      return true;
    })
    .sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)))
    .map((log) => ({
      hash: log.transactionHash,
      from: decodeTopicAddress(log.topics[1]),
      to: decodeTopicAddress(log.topics[2]),
      value: decodeHexUint(log.data),
      timeStamp: "0",
      isError: "0",
      blockNumber: String(Number(BigInt(log.blockNumber))),
    }));
}

async function fetchBscNativeHistoryFromRpc(ethAddress: string): Promise<BscApiTx[]> {
  const latestHex = await bscHistoryRpc<string>("eth_blockNumber", []);
  const latest = Number(BigInt(latestHex));
  const address = ethAddress.toLowerCase();
  const blockNumbers = Array.from({ length: 120 }, (_, index) => latest - index);
  const blocks = await Promise.all(
    blockNumbers.map((blockNumber) =>
      bscHistoryRpc<{
        number: string;
        timestamp: string;
        transactions: Array<{ hash: string; from: string; to: string | null; value: string }>;
      } | null>("eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, true]),
    ),
  );
  return blocks
    .flatMap((block) => {
      if (!block) return [];
      return block.transactions
        .filter((transaction) => {
          const from = transaction.from?.toLowerCase();
          const to = transaction.to?.toLowerCase();
          return from === address || to === address;
        })
        .map((transaction) => ({
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to ?? "",
          value: decodeHexUint(transaction.value),
          timeStamp: String(Number(BigInt(block.timestamp))),
          isError: "0",
          blockNumber: String(Number(BigInt(block.number))),
        }));
    })
    .sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));
}

/**
 * Fetch up to 50 most-recent transactions for an address on BSC.
 * For BNB: pass no contractAddress.
 * For BEP-20 tokens: pass the token contract address.
 * Works without an API key (rate-limited to ~5 req/s).
 */
export async function fetchBscTxHistory(
  ethAddress: string,
  contractAddress?: string,
): Promise<BscApiTx[]> {
  const params = new URLSearchParams({
    module: "account",
    action: contractAddress ? "tokentx" : "txlist",
    address: ethAddress,
    sort: "desc",
    page: "1",
    offset: "50",
  });
  if (contractAddress) params.set("contractaddress", contractAddress);
  try {
    const res = await fetch(`${BSCSCAN_API}?${params}`);
    const json = (await res.json()) as { status: string; result: BscApiTx[] | string };
    if (json.status === "1" && Array.isArray(json.result)) return json.result;
  } catch {
    // Fall through to the RPC indexer below.
  }
  try {
    return contractAddress
      ? await fetchBscTokenHistoryFromRpc(ethAddress, contractAddress)
      : await fetchBscNativeHistoryFromRpc(ethAddress);
  } catch {
    return [];
  }
}

// ─── BSC RPC helpers ──────────────────────────────────────────────────────────
const BSC_RPC = "https://bsc-dataseed.binance.org/";

async function bscRpcCall(method: string, params: unknown[]): Promise<string> {
  const res = await fetch(BSC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = (await res.json()) as { result: string };
  return json.result ?? "0x0";
}

export async function fetchBscNativeBalance(ethAddress: string): Promise<string> {
  const result = await bscRpcCall("eth_getBalance", [ethAddress, "latest"]);
  const raw = BigInt(result);
  if (raw === 0n) return "0";
  return (Number(raw) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export async function fetchBscTokenBalance(
  contractAddress: string,
  ethAddress: string,
  decimals: number
): Promise<string> {
  const result = await bscRpcCall("eth_call", [
    { to: contractAddress, data: encodeBalanceOfCall(ethAddress) },
    "latest",
  ]);
  const raw = decodeAbiUint256(result);
  if (raw === 0n) return "0";
  const divisor = decimals > 0 ? 10 ** decimals : 1;
  return (Number(raw) / divisor).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export async function fetchDefaultAssetBalance(
  asset: DefaultAsset,
  walletAddress: string
): Promise<string> {
  if (asset.chain === "solana") {
    return asset.contractAddress
      ? fetchSolanaTokenBalance(asset.contractAddress, walletAddress)
      : fetchSolanaBalance(walletAddress);
  }
  if (asset.chain === "bsc") {
    if (asset.contractAddress) {
      return fetchBscTokenBalance(asset.contractAddress, walletAddress, asset.decimals);
    }
    return fetchBscNativeBalance(walletAddress);
  }
  if (!asset.contractAddress) {
    const account = await api.getAccount(walletAddress);
    const raw = BigInt(account.balance || "0");
    if (raw === 0n) return "0";
    return (Number(raw) / 10 ** GMI_NATIVE_DECIMALS).toLocaleString("en-US", {
      maximumFractionDigits: 6,
    });
  }
  if (asset.contractAddress) {
    return fetchTokenBalance(asset.contractAddress, walletAddress, asset.decimals);
  }
  return "0";
}

export function defaultAssetToCustomToken(asset: DefaultAsset): CustomToken {
  return {
    id: asset.id,
    contractAddress: asset.contractAddress ?? "",
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    logoUrl: asset.logoUrl,
    chain: asset.chain,
    verified: true,
    addedAt: new Date(0).toISOString(),
  };
}

// ─── ABI decode helpers ───────────────────────────────────────────────────────

function decodeAbiString(hex: string): string {
  try {
    const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (raw.length < 128) return "";
    const len = parseInt(raw.slice(64, 128), 16);
    if (len === 0 || len > 256) return "";
    const bytes = raw.slice(128, 128 + len * 2);
    let str = "";
    for (let i = 0; i < bytes.length; i += 2) {
      str += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16));
    }
    return str.replace(/\0/g, "").trim();
  } catch {
    return "";
  }
}

function decodeAbiUint256(hex: string): bigint {
  try {
    return BigInt(hex.startsWith("0x") ? hex : "0x" + hex);
  } catch {
    return 0n;
  }
}

function decodeAbiUint8(hex: string): number {
  try {
    const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
    return parseInt(raw.slice(-2), 16);
  } catch {
    return 18;
  }
}

function encodeBalanceOfCall(ethAddress: string): string {
  const addr = ethAddress.toLowerCase().replace(/^0x/, "").padStart(40, "0");
  return `0x70a08231${"0".repeat(24)}${addr}`;
}

// ─── Metadata fetch ───────────────────────────────────────────────────────────

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  userBalance?: string;
}

export async function fetchTokenMetadata(
  contractAddress: string,
  userEthAddress?: string
): Promise<TokenMetadata> {
  const [nameRes, symbolRes, decimalsRes, supplyRes] = await Promise.all([
    api.rpcCall(contractAddress, "0x06fdde03").catch(() => ({ result: "0x" })),
    api.rpcCall(contractAddress, "0x95d89b41").catch(() => ({ result: "0x" })),
    api.rpcCall(contractAddress, "0x313ce567").catch(() => ({ result: "0x" })),
    api.rpcCall(contractAddress, "0x18160ddd").catch(() => ({ result: "0x" })),
  ]);

  const name = decodeAbiString(nameRes.result ?? "0x");
  const symbol = decodeAbiString(symbolRes.result ?? "0x");
  const decimals = decodeAbiUint8(decimalsRes.result ?? "0x");
  const supplyRaw = decodeAbiUint256(supplyRes.result ?? "0x");

  if (!name && !symbol) {
    throw new Error("Address is not a valid ERC-20 token contract");
  }

  const divisor = decimals > 0 ? 10 ** decimals : 1;
  const totalSupply = (Number(supplyRaw) / divisor).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });

  let userBalance: string | undefined;
  if (userEthAddress) {
    try {
      const balRes = await api.rpcCall(contractAddress, encodeBalanceOfCall(userEthAddress));
      const rawBal = decodeAbiUint256(balRes.result ?? "0x");
      userBalance = (Number(rawBal) / divisor).toLocaleString("en-US", {
        maximumFractionDigits: 6,
      });
    } catch {
      userBalance = undefined;
    }
  }

  return { name, symbol, decimals, totalSupply, userBalance };
}

export async function fetchTokenBalance(
  contractAddress: string,
  userEthAddress: string,
  decimals: number
): Promise<string> {
  const result = await api.rpcCall(contractAddress, encodeBalanceOfCall(userEthAddress));
  const raw = decodeAbiUint256(result.result ?? "0x");
  if (raw === 0n) return "0";
  const divisor = decimals > 0 ? 10 ** decimals : 1;
  return (Number(raw) / divisor).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** Returns the raw token balance as a bigint (wei-equivalent smallest unit). */
export async function fetchTokenBalanceRaw(
  contractAddress: string,
  userEthAddress: string
): Promise<bigint> {
  const result = await api.rpcCall(contractAddress, encodeBalanceOfCall(userEthAddress));
  return decodeAbiUint256(result.result ?? "0x");
}

// ─── Per-wallet storage helpers ───────────────────────────────────────────────

/**
 * Get tokens for a specific wallet.
 * On first call for a regular wallet, migrates any tokens from the old global key.
 */
export async function getCustomTokens(
  walletId: string,
  nfcTemporary?: boolean,
  mxcAddress?: string
): Promise<CustomToken[]> {
  if (!walletId) return [];
  try {
    const key = storageKey(walletId, nfcTemporary, mxcAddress);
    const json = await AsyncStorage.getItem(key);

    if (json) return JSON.parse(json) as CustomToken[];

    // First time for this regular (non-NFC) wallet — migrate legacy global tokens once
    if (!nfcTemporary) {
      const legacy = await AsyncStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const tokens = JSON.parse(legacy) as CustomToken[];
        if (tokens.length > 0) {
          await AsyncStorage.setItem(key, legacy);
          // Clear legacy key so it only migrates to the first wallet that reads it
          await AsyncStorage.removeItem(LEGACY_KEY);
          return tokens;
        }
      }
    }

    return [];
  } catch {
    return [];
  }
}

export async function addCustomToken(
  token: Omit<CustomToken, "id" | "addedAt">,
  walletId: string,
  nfcTemporary?: boolean,
  mxcAddress?: string
): Promise<CustomToken> {
  const key = storageKey(walletId, nfcTemporary, mxcAddress);
  const tokens = await getCustomTokens(walletId, nfcTemporary, mxcAddress);
  const entry: CustomToken = {
    ...token,
    id: token.contractAddress.toLowerCase(),
    addedAt: new Date().toISOString(),
  };
  const updated = [...tokens.filter((t) => t.id !== entry.id), entry];
  await AsyncStorage.setItem(key, JSON.stringify(updated));
  return entry;
}

export async function removeCustomToken(
  contractAddress: string,
  walletId: string,
  nfcTemporary?: boolean,
  mxcAddress?: string
): Promise<void> {
  const key = storageKey(walletId, nfcTemporary, mxcAddress);
  const tokens = await getCustomTokens(walletId, nfcTemporary, mxcAddress);
  const updated = tokens.filter((t) => t.id !== contractAddress.toLowerCase());
  await AsyncStorage.setItem(key, JSON.stringify(updated));
}
