import { Platform } from "react-native";
import { getNodeUrl, isDefaultNode } from "./node";
import { getWalletKey, initWalletKey } from "./walletKey";
import {
  GMI_CHAIN_ID,
  GMI_CHAIN_ID_HEX,
  GMI_RPC_URL,
} from "./chain";
import { mxcAddressToEthAddress } from "./crypto";

/** Hermes-safe timeout signal — timeoutSignal() is not available in React Native */
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** Returns the base URL for wallet backend endpoints (cards, p2p, tokens, prices).
 *  Explicit build configuration wins on every platform; web can use same-origin. */
export function getPublicApiBase(): string {
  const apiUrl =
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_API_URL : undefined;
  if (apiUrl) return `${apiUrl.replace(/\/$/, "")}/api`;

  if (Platform.OS === "web") {
    const domain = typeof process !== "undefined" ? process.env.EXPO_PUBLIC_DOMAIN : undefined;
    if (domain) return `https://${domain}/api`;
    return "/api";
  }
  // Native: always hit the wallet backend directly — never the chain node
  return "https://wallet.mymchain.com/api";
}

function getBaseUrl(): string {
  // EXPO_PUBLIC_API_URL (the wallet application API host) → add /api suffix
  const apiUrl = typeof process !== "undefined" ? process.env.EXPO_PUBLIC_API_URL : undefined;
  if (apiUrl) return `${apiUrl.replace(/\/$/, "")}/api`;
  if (Platform.OS === "web") {
    const domain =
      typeof process !== "undefined" ? process.env.EXPO_PUBLIC_DOMAIN : undefined;
    if (domain) return `https://${domain}/api/chain-proxy`;
    return "/api/chain-proxy";
  }
  // The chain RPC is not the wallet application API.
  return getPublicApiBase();
}

function getRpcUrl(): string {
  // Keep web calls same-origin to avoid RPC CORS differences. The proxy
  // itself is pinned to GMI Chain; native builds call the RPC directly.
  if (Platform.OS === "web") {
    const domain = typeof process !== "undefined" ? process.env.EXPO_PUBLIC_DOMAIN : undefined;
    if (domain) return `https://${domain}/api/rpc`;
    return "/api/rpc";
  }
  return isDefaultNode() ? GMI_RPC_URL : getNodeUrl();
}

async function rpcRequest<T>(method: string, params: unknown[]): Promise<T> {
  const url = getRpcUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (Platform.OS === "web" && !isDefaultNode()) {
    headers["X-GMI-Node"] = getNodeUrl();
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const data = await res.json() as { result?: T; error?: { message: string; code: number } };
  if (data.error) throw new Error(data.error.message ?? "RPC error");
  return data.result as T;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getBaseUrl();

  // On web with a custom node, pass the target URL as a header so the proxy
  // can forward to it instead of the hardcoded default.
  const extraHeaders: Record<string, string> =
    Platform.OS === "web" && !isDefaultNode()
       ? { "X-GMI-Node": getNodeUrl() }
      : {};

  // Ensure AsyncStorage has been read before we check the key
  await initWalletKey();

  // Attach Wallet API Key for write operations (required by server)
  const method = (options?.method ?? "GET").toUpperCase();
  const walletKey = getWalletKey();
  if (walletKey && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    extraHeaders["X-Wallet-Key"] = walletKey;
  }

  const response = await fetch(`${base}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Request failed");
    let message = text;
    let data: Record<string, unknown> | undefined;
    try {
      const json = JSON.parse(text);
      message = json.message ?? json.error ?? text;
      data = json as Record<string, unknown>;
    } catch {
      // use raw text
    }
    const err = new Error(message) as Error & {
      status: number;
      data?: Record<string, unknown>;
    };
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return response.json() as Promise<T>;
}

export interface AccountInfo {
  address: string;
  ethAddress: string;
  balance: string;
  balanceMc?: string;
  nonce: number;
  isContract?: boolean;
  exists?: boolean;
}

export interface RpcCallResult {
  jsonrpc: string;
  id: number;
  result?: string;
  error?: { code: number; message: string };
}

export type BridgeChain = "bsc" | "gmi";

export interface BridgePublicConfig {
  enabled: boolean;
  sourceChains: Array<{
    id: BridgeChain;
    label: string;
    chainId: number;
    tokenAddress: string | null;
    tokenDecimals: number;
    bridgeAddress: string | null;
    rpcUrl: string | null;
  }>;
  feeBps: number;
  minAmount: string;
  confirmations: number;
  relayerConfigured: boolean;
  missing: string[];
}

export interface BridgeTransferStatus {
  sourceChain: BridgeChain;
  txHash: string;
  state: "pending" | "relaying" | "confirmed" | "failed";
  sourceBlock?: string;
  eventId?: string;
  grossAmount?: string;
  netAmount?: string;
  destinationAddress?: string;
  relayTxHash?: string;
  error?: string;
  updatedAt: string;
}

export interface AmmTokenConfig {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  address: string | null;
  isNative?: boolean;
}

export interface AmmPublicConfig {
  enabled: boolean;
  chainId: number;
  rpcUrl: string;
  feeBps: number;
  factoryAddress: string | null;
  routerAddress: string | null;
  wrappedNativeAddress: string | null;
  supportedTokens: AmmTokenConfig[];
  pairs: Array<{
    id: string;
    tokenA: string;
    tokenB: string;
    pairAddress: string;
  }>;
  missing: string[];
}

async function bridgeRpcRequest<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: timeoutSignal(20_000),
  });
  const data = await response.json() as {
    result?: T;
    error?: { message?: string };
  };
  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? `RPC request failed (${response.status})`);
  }
  return data.result as T;
}

export interface Transaction {
  id: number;
  hash: string;
  fromAddress: string;
  toAddress: string;
  fromEth: string;
  toEth: string;
  fromMxc: string;
  toMxc: string;
  amount: string;
  nonce: number;
  createdAt: string;
  confirmedAt: string | null;
  blockHeight: number;
  status: string;
  txType: string;
  tokenContract?: string;
  tokenAmount?: string;
}

export interface TokenTransfer {
  hash: string;
  fromEth: string;
  toEth: string;
  blockNumber: number;
  value: string;
  logIndex: number;
}

export interface SubWallet {
  id: string;
  validatorAddress: string;
  subWalletAddress: string;
  subWalletEthAddress: string;
  packageTier: string | null;
  frozenBalance: string;
  availableBalance: string;
  label: string | null;
  createdAt: string;
}

export interface ValidatorInfo {
  id: string;
  address: string;
  ethAddress: string;
  publicKey: string;
  deviceId: string;
  moniker: string;
  status: "active" | "pending" | "paused" | "inactive" | "banned";
  totalActiveMinutes: number;
  lastSeenAt: string;
  commissionRate: string;
  joinedAt: string;
  sessionStartedAt?: string;
  createdAt: string;
  packageTier?: string | null;
  frozenBalance?: string;
  availableBalance?: string;
}

export interface ValidatorBalance {
  validatorAddress: string;
  packageTier: string | null;
  frozenBalanceWei: string;
  frozenBalanceMc: string;
  availableBalanceWei: string;
  availableBalanceMc: string;
}

export interface HeartbeatRecord {
  id: string;
  address: string;
  batteryLevel: number;
  isCharging: boolean;
  blockHeight: number;
  timestamp: string;
}

// ─── Epoch types ──────────────────────────────────────────────────────────────

/** Minimal epoch returned inside each heartbeat response */
export interface OpenEpoch {
  epochNumber: number;
  startsAt: string;
  endsAt: string;
  signerCount: number;
  // legacy fields — may still be present on older server versions
  blockHeight?: number;
  blockHash?: string;
  signingWindowClosesAt?: string;
}

export interface EpochSigner {
  address: string;
  moniker: string;
  signedAt: string;
  signature: string;
}

/** Rich epoch item returned by the epoch history endpoint */
export interface EpochHistoryItem {
  epochNumber: number;
  blockRange: {
    from: number;
    to: number;
    checkpointBlock: number;
    checkpointHash: string;
  };
  blockStats: {
    blockCount: number;
    txCount: number;
    gasUsed: string;
  };
  quorum: {
    reached: boolean;
    signatureCount: number;
    eligibleCount: number;
    pct: string;
  };
  myParticipation: {
    didSign: boolean;
    signedAt: string | null;
    signature: string | null;
  };
  signers: EpochSigner[];
  status: "open" | "expired" | "finalized";
  signingWindowClosesAt: string;
  finalizedAt: string | null;
  createdAt: string;
}

export interface EpochsSummary {
  totalEpochs: number;
  signed: number;
  missed: number;
  open: number;
  participationRate: string;
}

export interface EpochsPage {
  address: string;
  moniker: string;
  summary: EpochsSummary;
  epochs: EpochHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface HeartbeatResponse {
  ok: boolean;
  blockHeight?: number;
  timestamp?: string;
  isStaked?: boolean;
  sessionExpiresAt?: string | null;
  openEpoch?: OpenEpoch | null;
  epochResult?: { ok: boolean; nowFinalized?: boolean; reason?: string } | null;
}

export interface ValidatorRestartResponse {
  ok: boolean;
  status: string;
  sessionStartedAt: string;
  message: string;
}

export type SessionRestartResponse = ValidatorRestartResponse;

export interface Reward {
  id: string;
  validatorAddress: string;
  amount: string;
  date: string;
  poolShare: string;
  blockHeight: number;
  timestamp: string;
}

export interface ApiVerifiedToken {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
  coingeckoId: string;
  contractAddress: string;
  sortOrder: number;
  active: boolean;
}

export interface FeaturedDapp {
  id: string;
  name: string;
  description: string;
  url: string;
  icon: string;
  color: string;
  sortOrder: number;
  comingSoon: boolean;
}

export interface ChainInfo {
  chainId: number;
  blockHeight: number;
  totalSupply: string;
  gasPrice: string;
}

export interface ValidatorEarnings {
  address: string;
  moniker: string;
  totalActiveMinutes: number;
  currentBalanceMc: string;
  earnings: {
    treasuryTotalMc: string;
    gasTotalMc: string;
    combinedTotalMc: string;
  };
  stats: {
    totalRewardPeriods: number;
    lastRewardPeriod: string;
    totalBlocksProposed: number;
    totalTxsProcessed: number;
  };
}

export interface TreasuryReward {
  id: number;
  period: string;
  activeMinutes: number;
  totalNetworkMinutes: number;
  uptimePct: string;
  amountMc: string;
  status: string;
  distributedAt: string | null;
}

export interface TreasuryRewardsPage {
  rewards: TreasuryReward[];
  total: number;
  limit: number;
  offset: number;
}

export interface GasReward {
  id: number;
  blockHeight: number;
  txCount: number;
  totalFeeMc: string;
  validatorShareMc: string;
  adminShareMc: string;
  isStaked: boolean;
  splitPct: string;
  timestamp: string;
}

export interface GasRewardsPage {
  gasRewards: GasReward[];
  total: number;
  limit: number;
  offset: number;
}

export interface ValidatorBlock {
  height: number;
  hash: string;
  txCount: number;
  gasUsed: number;
  timestamp: string;
}

export interface ValidatorBlocksPage {
  blocks: ValidatorBlock[];
  total: number;
  totalTxsProcessed: number;
  totalGasUsed: string;
  limit: number;
  offset: number;
}

export const api = {
  getAccount: async (address: string): Promise<AccountInfo> => {
    const ethAddress = address.startsWith("0x")
      ? address
      : mxcAddressToEthAddress(address);
    const [balanceHex, nonceHex, code] = await Promise.all([
      rpcRequest<string>("eth_getBalance", [ethAddress, "latest"]),
      rpcRequest<string>("eth_getTransactionCount", [ethAddress, "latest"]),
      rpcRequest<string>("eth_getCode", [ethAddress, "latest"]),
    ]);
    return {
      address,
      ethAddress,
      balance: BigInt(balanceHex || "0x0").toString(),
      balanceMc: BigInt(balanceHex || "0x0").toString(),
      nonce: parseInt(nonceHex || "0x0", 16),
      isContract: code !== "0x",
      exists: balanceHex !== "0x0" || nonceHex !== "0x0" || code !== "0x",
    };
  },

  getBalance: async (address: string) => {
    const ethAddress = address.startsWith("0x")
      ? address
      : mxcAddressToEthAddress(address);
    const balance = await rpcRequest<string>("eth_getBalance", [ethAddress, "latest"]);
    return { balance: BigInt(balance || "0x0").toString() };
  },

  getTransactions: (address: string, limit = 20) =>
    request<{ transactions: Transaction[] }>(
      `/transactions?address=${encodeURIComponent(address)}&limit=${limit}`
    ),

  getEvmNonce: (ethAddress: string) =>
    rpcRequest<string>("eth_getTransactionCount", [ethAddress, "latest"])
      .then(hex => parseInt(hex as string, 16)),

  sendRawTransaction: (signedTx: string) =>
    rpcRequest<string>("eth_sendRawTransaction", [signedTx])
      .then(hash => ({ txHash: hash as string })),

  sendTransaction: async (params: {
    fromAddress: string;
    toAddress: string;
    amount: string;
    nonce: number;
    privateKey: string;
    data?: string;
    txType?: string;
  }): Promise<{ txHash: string }> => {
    const { privateKey, data, txType } = params;

    // ── Contract calls (ERC-20 transfers, etc.) ─────────────────────────────
    // The chain's REST API hardcodes gasLimit=21000, which is insufficient for
    // EVM contract execution (~30k+ gas needed). We bypass it by signing a
    // proper EIP-1559 transaction and sending via eth_sendRawTransaction.
    if (txType === "contract_call" && data) {
      const { signEvmTransaction, hexToBytes } = await import("./crypto");
      const dataBytes = hexToBytes(data.replace(/^0x/i, ""));
      const signedTx = signEvmTransaction(
        params.toAddress,
        0n,
        params.nonce,
        privateKey,
        { data: dataBytes, gasLimit: 300_000n },
      );
      return api.sendRawTransaction(signedTx);
    }

    // ── Native GMI transfers ─────────────────────────────────────────────────
    // Sign and broadcast directly through GMI's EVM JSON-RPC endpoint.
    const { signLegacyTransaction } = await import("./crypto");
    const signedTx = signLegacyTransaction(
      params.toAddress,
      BigInt(params.amount),
      params.nonce,
      privateKey,
      { gasPrice: 1_000_000_000n },
    );
    return api.sendRawTransaction(signedTx);
  },

  getTransactionReceipt: (txHash: string) =>
    rpcRequest<Record<string, unknown> | null>("eth_getTransactionReceipt", [txHash]),

  waitForReceipt: async (txHash: string, timeoutMs = 30_000): Promise<Record<string, unknown>> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const receipt = await rpcRequest<Record<string, unknown> | null>(
        "eth_getTransactionReceipt", [txHash]
      );
      if (receipt) return receipt;
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error("Transaction not confirmed within 30 seconds");
  },

  getBridgeConfig: () => request<BridgePublicConfig>("/bridge/config"),

  getBridgeQuote: (sourceChain: BridgeChain, amount: string) =>
    request<{
      sourceChain: BridgeChain;
      destinationChain: BridgeChain;
      grossAmount: string;
      feeAmount: string;
      netAmount: string;
      feeBps: number;
      estimatedSeconds: number;
    }>("/bridge/quote", {
      method: "POST",
      body: JSON.stringify({ sourceChain, amount }),
    }),

  getBridgeCheck: (sourceChain: BridgeChain, address: string) =>
    request<{
      sourceChain: BridgeChain;
      address: string;
      nativeBalanceWei: string;
      tokenBalanceRaw: string;
      tokenBalance: string;
      tokenAllowanceRaw: string;
      tokenAllowance: string;
      destinationLiquidityRaw: string;
      destinationLiquidity: string;
    }>("/bridge/check", {
      method: "POST",
      body: JSON.stringify({ sourceChain, address }),
    }),

  notifyBridgeTransfer: (sourceChain: BridgeChain, txHash: string) =>
    request<BridgeTransferStatus>("/bridge/notify", {
      method: "POST",
      body: JSON.stringify({ sourceChain, txHash }),
    }),

  getBridgeStatus: (sourceChain: BridgeChain, txHash: string) =>
    request<BridgeTransferStatus>(
      `/bridge/status/${encodeURIComponent(txHash)}?sourceChain=${sourceChain}`,
    ),

  sendBridgeContractTransaction: async (params: {
    rpcUrl: string;
    chainId: number;
    fromAddress: string;
    toAddress: string;
    data: string;
    privateKey: string;
    gasLimit?: bigint;
    valueWei?: bigint;
  }): Promise<{ txHash: string }> => {
    const { signLegacyTransaction, mxcAddressToEthAddress, hexToBytes } = await import("./crypto");
    const fromEth = params.fromAddress.startsWith("gmi1")
      ? mxcAddressToEthAddress(params.fromAddress)
      : params.fromAddress;
    const [nonceHex, gasPriceHex] = await Promise.all([
      bridgeRpcRequest<string>(params.rpcUrl, "eth_getTransactionCount", [fromEth, "pending"]),
      bridgeRpcRequest<string>(params.rpcUrl, "eth_gasPrice", []),
    ]);
    const signedTx = signLegacyTransaction(
      params.toAddress,
      params.valueWei ?? 0n,
      parseInt(nonceHex || "0x0", 16),
      params.privateKey,
      {
        chainId: params.chainId,
        gasPrice: gasPriceHex ? BigInt(gasPriceHex) : 1_000_000_000n,
        gasLimit: params.gasLimit ?? 300_000n,
        data: hexToBytes(params.data.replace(/^0x/i, "")),
      },
    );
    const txHash = await bridgeRpcRequest<string>(
      params.rpcUrl,
      "eth_sendRawTransaction",
      [signedTx],
    );
    return { txHash };
  },

  getAmmConfig: () => request<AmmPublicConfig>("/amm/config"),

  waitForBridgeReceipt: async (
    rpcUrl: string,
    txHash: string,
    timeoutMs = 180_000,
  ): Promise<{ status: string }> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const receipt = await bridgeRpcRequest<{ status?: string } | null>(
        rpcUrl,
        "eth_getTransactionReceipt",
        [txHash],
      );
      if (receipt) {
        if (receipt.status === "0x0") throw new Error("Transaction reverted on-chain");
        return { status: receipt.status ?? "0x1" };
      }
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
    throw new Error("Transaction confirmation timed out");
  },

  registerValidator: (data: {
    address: string;
    ethAddress: string;
    publicKey: string;
    deviceId: string;
    moniker: string;
    commissionRate: string;
  }) =>
    request<{ validator: ValidatorInfo }>("/validators/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  sendHeartbeat: (data: {
    address: string;
    batteryLevel: number;
    isCharging: boolean;
    deviceSignature?: string;
    epochSignature?: { epochNumber: number; signature: string };
  }) =>
    request<HeartbeatResponse>("/validators/heartbeat", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  pauseValidator: (address: string) =>
    request<{ ok: boolean; status: string; message: string }>("/validators/pause", {
      method: "POST",
      body: JSON.stringify({ address }),
    }),

  restartSession: (address: string) =>
    request<ValidatorRestartResponse>("/validators/restart", {
      method: "POST",
      body: JSON.stringify({ address }),
    }),

  getSubWallets: async (validatorAddress: string): Promise<{ subWallets: SubWallet[] }> => {
    const base = getPublicApiBase();
    const res = await fetch(`${base}/validators/${encodeURIComponent(validatorAddress)}/sub-wallets`, {
      signal: timeoutSignal(8_000),
    });
    if (!res.ok) return { subWallets: [] };
    return res.json();
  },

  getValidatorBalance: async (validatorAddress: string): Promise<ValidatorBalance> => {
    const base = getPublicApiBase();
    const res = await fetch(
      `${base}/validators/${encodeURIComponent(validatorAddress)}/balance`,
      { signal: timeoutSignal(8_000) }
    );
    if (!res.ok) {
      return {
        validatorAddress,
        packageTier: null,
        frozenBalanceWei: "0", frozenBalanceMc: "0.000000",
        availableBalanceWei: "0", availableBalanceMc: "0.000000",
      };
    }
    return res.json();
  },

  addSubWallet: async (validatorAddress: string, subWalletAddress: string, label?: string, adminKey?: string): Promise<{ subWallet: SubWallet }> => {
    const base = getPublicApiBase();
    const res = await fetch(`${base}/validators/${encodeURIComponent(validatorAddress)}/sub-wallets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(adminKey ? { "x-admin-key": adminKey } : {}),
      },
      body: JSON.stringify({ subWalletAddress, ...(label ? { label } : {}) }),
      signal: timeoutSignal(12_000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to add sub wallet");
    return data;
  },

  removeSubWallet: async (validatorAddress: string, subWalletAddress: string, adminKey?: string): Promise<{ ok: boolean }> => {
    const base = getPublicApiBase();
    const res = await fetch(
      `${base}/validators/${encodeURIComponent(validatorAddress)}/sub-wallets`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(adminKey ? { "x-admin-key": adminKey } : {}),
        },
        body: JSON.stringify({ subWalletAddress }),
        signal: timeoutSignal(8_000),
      }
    );
    if (!res.ok) throw new Error("Failed to remove sub wallet");
    return res.json();
  },

  getValidatorStatus: (address: string) =>
    request<{ validator: ValidatorInfo }>(
      `/validators/${encodeURIComponent(address)}`
    ),

  getRewards: (validatorAddress: string, limit = 30) =>
    request<{ rewards: Reward[] }>(
      `/rewards?validatorAddress=${encodeURIComponent(validatorAddress)}&limit=${limit}`
    ),

  getChainInfo: async (): Promise<ChainInfo> => {
    const [blockHex, chainIdHex, gasPriceHex] = await Promise.all([
      rpcRequest<string>("eth_blockNumber", []),
      rpcRequest<string>("eth_chainId", []),
      rpcRequest<string>("eth_gasPrice", []).catch(() => "0x0"),
    ]);
    const weiValue = parseInt(gasPriceHex, 16);
    const gweiValue = weiValue / 1e9;
    const gasPrice = gweiValue % 1 === 0
      ? `${gweiValue} Gwei`
      : `${gweiValue.toFixed(2)} Gwei`;
    return {
      chainId: parseInt(chainIdHex || GMI_CHAIN_ID_HEX, 16) || GMI_CHAIN_ID,
      blockHeight: parseInt(blockHex || "0x0", 16),
      totalSupply: "0",
      gasPrice,
    };
  },

  healthCheck: () => request<{ status: string }>("/healthz"),

  claimRewards: (address: string) =>
    request<{ ok: boolean; txHash?: string; claimed: string; claimedWei: string; autoReleased?: string; autoReleasedWei?: string; message?: string }>(
      `/validators/${encodeURIComponent(address)}/claim-rewards`,
      { method: "POST" }
    ),

  claimSubWalletRewards: (validatorAddress: string, subWalletAddress: string) =>
    request<{ ok: boolean; txHash?: string; claimed: string; claimedWei: string; autoReleased?: string; autoReleasedWei?: string; message?: string }>(
      `/validators/${encodeURIComponent(validatorAddress)}/sub-wallets/${encodeURIComponent(subWalletAddress)}/claim-rewards`,
      { method: "POST" }
    ),

  signEpoch: (epochNumber: number, validatorAddress: string, signature: string) =>
    request<{ ok: boolean; nowFinalized: boolean }>(
      `/epochs/${epochNumber}/sign`,
      {
        method: "POST",
        body: JSON.stringify({ validatorAddress, signature }),
      }
    ),

  getValidatorEarnings: (address: string) =>
    request<ValidatorEarnings>(`/validators/${encodeURIComponent(address)}/earnings`),

  getTreasuryRewards: (address: string, limit = 50, offset = 0) =>
    request<TreasuryRewardsPage>(
      `/validators/${encodeURIComponent(address)}/treasury-rewards?limit=${limit}&offset=${offset}`
    ),

  getGasRewards: (address: string, limit = 50, offset = 0) =>
    request<GasRewardsPage>(
      `/validators/${encodeURIComponent(address)}/gas-rewards?limit=${limit}&offset=${offset}`
    ),

  getValidatorBlocks: (address: string, limit = 50, offset = 0) =>
    request<ValidatorBlocksPage>(
      `/validators/${encodeURIComponent(address)}/blocks?limit=${limit}&offset=${offset}`
    ),

  getValidatorEpochs: (address: string, limit = 50, offset = 0) =>
    request<EpochsPage>(
      `/validators/${encodeURIComponent(address)}/epochs?limit=${limit}&offset=${offset}`
    ),

  ping: async () => {
    const t0 = Date.now();
    await rpcRequest<string>("eth_blockNumber", []);
    return Date.now() - t0;
  },

  getVerifiedTokens: async (): Promise<ApiVerifiedToken[]> => {
    const base = getPublicApiBase();
    const res = await fetch(`${base}/tokens`);
    if (!res.ok) return [];
    const data = (await res.json()) as { tokens: ApiVerifiedToken[] };
    return data.tokens ?? [];
  },

  getPrices: async (): Promise<Record<string, number>> => {
    const base = getPublicApiBase();
    try {
      const res = await fetch(`${base}/prices`);
      if (!res.ok) return {};
      const data = (await res.json()) as { prices: { symbol: string; priceUsd: number }[] };
      return Object.fromEntries((data.prices ?? []).map(p => [p.symbol, p.priceUsd]));
    } catch {
      return {};
    }
  },

  getFeaturedDapps: async (): Promise<FeaturedDapp[]> => {
    const base = getPublicApiBase();
    const res = await fetch(`${base}/dapps`);
    if (!res.ok) return [];
    const data = (await res.json()) as { dapps: FeaturedDapp[] };
    return data.dapps ?? [];
  },

  getTokenTransfers: async (contractAddr: string, userEthAddr: string): Promise<TokenTransfer[]> => {
    const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const normalizedUser = userEthAddr.toLowerCase();
    const padded = "0x" + normalizedUser.replace(/^0x/i, "").padStart(64, "0");

    type RawLog = {
      transactionHash: string;
      topics: string[];
      data: string;
      blockNumber: string;
      logIndex: string;
    };

    const [sentLogs, receivedLogs] = await Promise.all([
      rpcRequest<RawLog[]>("eth_getLogs", [{
        fromBlock: "earliest", toBlock: "latest",
        address: contractAddr,
        topics: [TRANSFER_TOPIC, padded],
      }]),
      rpcRequest<RawLog[]>("eth_getLogs", [{
        fromBlock: "earliest", toBlock: "latest",
        address: contractAddr,
        topics: [TRANSFER_TOPIC, null, padded],
      }]),
    ]);

    const seen = new Set<string>();
    return [...sentLogs, ...receivedLogs]
      .filter((log) => {
        const key = `${log.transactionHash}:${log.logIndex}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((log) => ({
        hash: log.transactionHash,
        fromEth: "0x" + (log.topics[1] ?? "").slice(-40),
        toEth: "0x" + (log.topics[2] ?? "").slice(-40),
        blockNumber: parseInt(log.blockNumber, 16),
        value: BigInt(log.data && log.data !== "0x" ? log.data : "0x0").toString(),
        logIndex: parseInt(log.logIndex, 16),
      }))
      .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  },

  rpcCall: async (to: string, data: string): Promise<RpcCallResult> => ({
    jsonrpc: "2.0",
    id: 1,
    result: await rpcRequest<string>("eth_call", [{ to, data }, "latest"]),
  }),
};

// ── Card API ─────────────────────────────────────────────────────────────────

export interface CardAccount {
  id: string;
  wallet_address: string;
  deposit_address: string;
  balance_usdt: string;
  frozen: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  stripe_card_id?: string | null;
  stripe_cardholder_id?: string | null;
  kripicard_card_id?: string | null;
  kripicard_last4?: string | null;
  kripicard_bin?: string | null;
  kripicard_status?: string | null;
}

export interface CardDeposit {
  id: string;
  wallet_address: string;
  tx_hash: string;
  amount_usdt: string;
  from_address: string;
  network: string;
  status: string;
  created_at: string;
}

export async function initCardAccount(ethAddress: string): Promise<{ account: CardAccount }> {
  const base = getPublicApiBase();
  const res = await fetch(`${base}/cards/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: ethAddress }),
    signal: timeoutSignal(10_000),
  });
  if (!res.ok) throw new Error("Failed to initialise card account");
  return res.json();
}

export async function getCardAccount(ethAddress: string): Promise<{ account: CardAccount | null }> {
  const base = getPublicApiBase();
  const res = await fetch(`${base}/cards/account/${encodeURIComponent(ethAddress)}`, {
    signal: timeoutSignal(8_000),
  });
  if (!res.ok) return { account: null };
  return res.json();
}

export async function getCardDeposits(ethAddress: string): Promise<{ deposits: CardDeposit[] }> {
  const base = getPublicApiBase();
  const res = await fetch(`${base}/cards/deposits/${encodeURIComponent(ethAddress)}`, {
    signal: timeoutSignal(8_000),
  });
  if (!res.ok) return { deposits: [] };
  return res.json();
}

export async function verifyCardDeposit(ethAddress: string): Promise<{
  credited: number;
  newDeposits: number;
  message: string;
}> {
  const base = getPublicApiBase();
  const res = await fetch(`${base}/cards/verify-deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: ethAddress }),
    signal: timeoutSignal(15_000),
  });
  if (!res.ok) throw new Error("Verification failed");
  return res.json();
}

// Token contracts must come from the verified GMI token registry or an
// explicitly configured deployment; never bake an unverified address into the app.
export const MUSDT_CONTRACT = "";

export async function sendMusdtForCard(params: {
  fromEthAddress: string;
  fromMxcAddress: string;
  toAddress: string;
  amountUsdt: number;
  privateKey: string;
}): Promise<{ txHash: string }> {
  const { buildErc20TransferDataHex } = await import("./crypto");
  const { fromEthAddress, toAddress, amountUsdt, privateKey } = params;
  if (!MUSDT_CONTRACT) {
    throw new Error("The GMI stablecoin contract is not configured yet.");
  }
  const amountRaw = BigInt(Math.round(amountUsdt * 1_000_000));
  const data = buildErc20TransferDataHex(toAddress, amountRaw);
  // Use the EVM nonce (eth_getTransactionCount), including contract calls.
  // which can differ when the user has made contract-call transactions.
  const evmNonce = await api.getEvmNonce(fromEthAddress);
  return api.sendTransaction({
    fromAddress: fromEthAddress,
    toAddress: MUSDT_CONTRACT,
    amount: "0",
    data,
    txType: "contract_call",
    nonce: evmNonce,
    privateKey,
  });
}

export async function toggleCardFreeze(ethAddress: string): Promise<{ frozen: boolean }> {
  const base = getPublicApiBase();
  const res = await fetch(`${base}/cards/freeze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: ethAddress }),
    signal: timeoutSignal(8_000),
  });
  if (!res.ok) throw new Error("Failed to toggle freeze");
  return res.json();
}

export interface StripeCardDetails {
  number: string | null;
  cvc: string | null;
  exp_month: number;
  exp_year: number;
  last4: string;
  brand: string;
  status: string;
}

export async function getStripeCardDetails(ethAddress: string): Promise<StripeCardDetails> {
  const base = getPublicApiBase();
  const res = await fetch(`${base}/cards/stripe-details/${encodeURIComponent(ethAddress)}`, {
    signal: timeoutSignal(10_000),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Failed to fetch card details");
  }
  return res.json();
}

// ── KripiCard API ─────────────────────────────────────────────────────────────

export interface KripicardDetails {
  cardId: string;
  last4: string | null;
  bin: string | null;
  status: string;
  cardNumber: string;
  expiry: string;
  cvv: string;
  balance: number;
}

export interface KripicardTransaction {
  date: string;
  type: string;
  merchant: string;
  amount: number;
  success: boolean;
}

export async function issueKripicardCard(
  walletAddress: string,
  params: { amount: number; bin: string; nameOnCard: string; email?: string; dateOfBirth?: string }
): Promise<{ cardId: string; last4: string; bin: string; amount: number; fee: number; totalCharged: number }> {
  const base = getPublicApiBase();
  const res = await fetch(`${base}/cards/kc/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, ...params }),
    signal: timeoutSignal(30_000),
  });
  const data = await res.json() as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to issue card");
  return data as never;
}

export async function fundKripicardCard(
  walletAddress: string,
  amount: number
): Promise<{ cardId: string; amount: number; fee: number; totalDebited: number }> {
  const base = getPublicApiBase();
  const res = await fetch(`${base}/cards/kc/fund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, amount }),
    signal: timeoutSignal(15_000),
  });
  const data = await res.json() as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to fund card");
  return data as never;
}

export async function getKripicardDetails(walletAddress: string): Promise<KripicardDetails> {
  const base = getPublicApiBase();
  const res = await fetch(`${base}/cards/kc/details`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
    signal: timeoutSignal(15_000),
  });
  const data = await res.json() as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to get card details");
  return data as never;
}

export async function freezeKripicardCard(
  walletAddress: string,
  action: "freeze" | "unfreeze"
): Promise<{ action: string; status: string }> {
  const base = getPublicApiBase();
  const res = await fetch(`${base}/cards/kc/freeze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, action }),
    signal: timeoutSignal(10_000),
  });
  const data = await res.json() as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to freeze/unfreeze card");
  return data as never;
}

export async function getKripicardTransactions(walletAddress: string): Promise<{
  cardId: string; balance: number; totalTransactions: number;
  transactions: KripicardTransaction[];
}> {
  const base = getPublicApiBase();
  const res = await fetch(`${base}/cards/kc/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
    signal: timeoutSignal(15_000),
  });
  const data = await res.json() as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to get transactions");
  return data as never;
}
