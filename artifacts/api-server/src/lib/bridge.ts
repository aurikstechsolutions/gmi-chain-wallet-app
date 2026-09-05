import { bech32 } from "bech32";
import { randomUUID } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getRedis } from "./redis";
import { logger } from "./logger";
import { GMI_CHAIN_ID, GMI_RPC_URL } from "./chain";
import {
  calculateBridgeQuote,
  formatBridgeUnits,
  packedAddressToEvm,
  parseBridgeUnits,
  scaleBridgeUnits,
  toGmiEvmAddress,
} from "./bridge-utils";
export {
  calculateBridgeQuote,
  formatBridgeUnits,
  packedAddressToEvm,
  parseBridgeUnits,
  toGmiEvmAddress,
  toPackedAddress,
} from "./bridge-utils";

export type BridgeChain = "bsc" | "gmi";
export type BridgeTransferState = "pending" | "relaying" | "confirmed" | "failed";

const BSC_CHAIN_ID = 56;
const DEFAULT_CONFIRMATIONS = 12;
const POLL_INTERVAL_MS = 3_000;
const MAX_WAIT_MS = 180_000;
// Public BSC RPC endpoints commonly cap eth_getLogs ranges at 1,000 blocks.
// Keep a smaller chunk so the default endpoint remains usable.
const LOG_CHUNK = 500n;
const STATE_TTL_SECONDS = 60 * 60 * 24 * 30;

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const LOCKBOX_ABI = parseAbi([
  "function release(address recipient, uint256 amount, bytes32 withdrawalId)",
  "event Deposit(bytes32 indexed depositId, address indexed sender, uint256 amount, bytes32 destination, uint256 sourceChainId, uint256 destinationChainId, uint256 nonce)",
]);

const MINTER_ABI = parseAbi([
  "function mint(address recipient, uint256 amount, bytes32 depositId)",
  "event Withdrawal(bytes32 indexed withdrawalId, address indexed sender, uint256 amount, bytes32 destination, uint256 sourceChainId, uint256 destinationChainId, uint256 nonce)",
]);

const DEPOSIT_EVENT_ABI = parseAbi([
  "event Deposit(bytes32 indexed depositId, address indexed sender, uint256 amount, bytes32 destination, uint256 sourceChainId, uint256 destinationChainId, uint256 nonce)",
]);

const WITHDRAWAL_EVENT_ABI = parseAbi([
  "event Withdrawal(bytes32 indexed withdrawalId, address indexed sender, uint256 amount, bytes32 destination, uint256 sourceChainId, uint256 destinationChainId, uint256 nonce)",
]);

const bscChain: Chain = {
  id: BSC_CHAIN_ID,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [] } },
};

const gmiChain: Chain = {
  id: GMI_CHAIN_ID,
  name: "GMI Chain",
  nativeCurrency: { name: "GMI", symbol: "GMI", decimals: 18 },
  rpcUrls: { default: { http: [GMI_RPC_URL] } },
};

export interface BridgeRuntimeConfig {
  enabled: boolean;
  bscRpcUrl: string | null;
  gmiRpcUrl: string;
  bscBridgeAddress: Address | null;
  bscTokenAddress: Address | null;
  gmiBridgeAddress: Address | null;
  gmiTokenAddress: Address | null;
  bscTokenDecimals: number;
  gmiTokenDecimals: number;
  feeBps: number;
  minAmount: string;
  confirmations: number;
  relayerConfigured: boolean;
  missing: string[];
}

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

export interface BridgeTransferRecord {
  sourceChain: BridgeChain;
  txHash: Hex;
  state: BridgeTransferState;
  sourceBlock?: string;
  eventId?: Hex;
  grossAmount?: string;
  netAmount?: string;
  destinationAddress?: string;
  relayTxHash?: Hex;
  error?: string;
  updatedAt: string;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function readAddress(name: string): Address | null {
  const value = process.env[name]?.trim();
  if (!value || !isAddress(value)) return null;
  return getAddress(value);
}

function requireRpcUrl(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return value.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getBridgeRuntimeConfig(): BridgeRuntimeConfig {
  const bscRpcUrl = requireRpcUrl("GMI_BRIDGE_BSC_RPC_URL");
  const gmiRpcUrl = requireRpcUrl("GMI_BRIDGE_GMI_RPC_URL") ?? GMI_RPC_URL;
  const bscBridgeAddress = readAddress("GMI_BRIDGE_BSC_LOCKBOX_ADDRESS");
  const bscTokenAddress = readAddress("GMI_BRIDGE_BSC_TOKEN_ADDRESS");
  const gmiBridgeAddress = readAddress("GMI_BRIDGE_GMI_MINTER_ADDRESS");
  const gmiTokenAddress = readAddress("GMI_BRIDGE_GMI_TOKEN_ADDRESS");
  const bscTokenDecimals = readPositiveInteger("GMI_BRIDGE_BSC_TOKEN_DECIMALS", 18);
  const gmiTokenDecimals = readPositiveInteger("GMI_BRIDGE_GMI_TOKEN_DECIMALS", 18);
  const feeBps = readPositiveInteger("GMI_BRIDGE_FEE_BPS", 0);
  const minAmount = process.env["GMI_BRIDGE_MIN_AMOUNT"]?.trim() || "0";
  const confirmations = readPositiveInteger(
    "GMI_BRIDGE_CONFIRMATIONS",
    DEFAULT_CONFIRMATIONS,
  );

  const missing: string[] = [];
  if (!bscRpcUrl) missing.push("GMI_BRIDGE_BSC_RPC_URL");
  if (!bscBridgeAddress) missing.push("GMI_BRIDGE_BSC_LOCKBOX_ADDRESS");
  if (!bscTokenAddress) missing.push("GMI_BRIDGE_BSC_TOKEN_ADDRESS");
  if (!gmiBridgeAddress) missing.push("GMI_BRIDGE_GMI_MINTER_ADDRESS");
  if (!gmiTokenAddress) missing.push("GMI_BRIDGE_GMI_TOKEN_ADDRESS");
  if (!process.env["GMI_BRIDGE_RELAYER_PRIVATE_KEY"]) {
    missing.push("GMI_BRIDGE_RELAYER_PRIVATE_KEY");
  }
  if (!/^\d+(\.\d+)?$/.test(minAmount)) missing.push("GMI_BRIDGE_MIN_AMOUNT");
  if (feeBps > 1_000) missing.push("GMI_BRIDGE_FEE_BPS<=1000");

  return {
    enabled: missing.length === 0,
    bscRpcUrl,
    gmiRpcUrl,
    bscBridgeAddress,
    bscTokenAddress,
    gmiBridgeAddress,
    gmiTokenAddress,
    bscTokenDecimals,
    gmiTokenDecimals,
    feeBps,
    minAmount,
    confirmations,
    relayerConfigured: Boolean(process.env["GMI_BRIDGE_RELAYER_PRIVATE_KEY"]),
    missing,
  };
}

export function getBridgePublicConfig(): BridgePublicConfig {
  const cfg = getBridgeRuntimeConfig();
  return {
    enabled: cfg.enabled,
    sourceChains: [
      {
        id: "bsc",
        label: "BNB Smart Chain",
        chainId: BSC_CHAIN_ID,
        tokenAddress: cfg.bscTokenAddress,
        tokenDecimals: cfg.bscTokenDecimals,
        bridgeAddress: cfg.bscBridgeAddress,
        rpcUrl: cfg.bscRpcUrl,
      },
      {
        id: "gmi",
        label: "GMI Chain",
        chainId: GMI_CHAIN_ID,
        tokenAddress: cfg.gmiTokenAddress,
        tokenDecimals: cfg.gmiTokenDecimals,
        bridgeAddress: cfg.gmiBridgeAddress,
        rpcUrl: cfg.gmiRpcUrl,
      },
    ],
    feeBps: cfg.feeBps,
    minAmount: cfg.minAmount,
    confirmations: cfg.confirmations,
    relayerConfigured: cfg.relayerConfigured,
    missing: cfg.missing,
  };
}

function chainFor(sourceChain: BridgeChain): Chain {
  return sourceChain === "bsc" ? bscChain : gmiChain;
}

function rpcFor(sourceChain: BridgeChain, cfg: BridgeRuntimeConfig): string {
  const rpcUrl = sourceChain === "bsc" ? cfg.bscRpcUrl : cfg.gmiRpcUrl;
  if (!rpcUrl) throw new Error("BSC bridge RPC is not configured");
  return rpcUrl;
}

function publicClient(sourceChain: BridgeChain, cfg: BridgeRuntimeConfig) {
  return createPublicClient({
    chain: chainFor(sourceChain),
    transport: http(rpcFor(sourceChain, cfg)),
  });
}

function tokenFor(sourceChain: BridgeChain, cfg: BridgeRuntimeConfig): Address {
  const token = sourceChain === "bsc" ? cfg.bscTokenAddress : cfg.gmiTokenAddress;
  if (!token) throw new Error("Bridge token is not configured");
  return token;
}

function bridgeFor(sourceChain: BridgeChain, cfg: BridgeRuntimeConfig): Address {
  const bridge = sourceChain === "bsc" ? cfg.bscBridgeAddress : cfg.gmiBridgeAddress;
  if (!bridge) throw new Error("Bridge contract is not configured");
  return bridge;
}

export async function getBridgeCheck(sourceChain: BridgeChain, address: string) {
  const cfg = getBridgeRuntimeConfig();
  const userAddress = toGmiEvmAddress(address);
  const client = publicClient(sourceChain, cfg);
  const destinationChain: BridgeChain = sourceChain === "bsc" ? "gmi" : "bsc";
  const destinationClient = publicClient(destinationChain, cfg);
  const bridgeAddress = bridgeFor(sourceChain, cfg);
  const [nativeBalance, tokenBalance, tokenAllowance, liquidityBalance] = await Promise.all([
    client.getBalance({ address: userAddress }),
    client.readContract({
      address: tokenFor(sourceChain, cfg),
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [userAddress],
    }),
    client.readContract({
      address: tokenFor(sourceChain, cfg),
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [userAddress, bridgeAddress],
    }).catch(() => 0n),
    destinationClient.readContract({
      address: tokenFor(destinationChain, cfg),
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [bridgeFor(destinationChain, cfg)],
    }).catch(() => 0n),
  ]);
  const decimals = sourceChain === "bsc" ? cfg.bscTokenDecimals : cfg.gmiTokenDecimals;
  return {
    sourceChain,
    address: userAddress,
    nativeBalanceWei: nativeBalance.toString(),
    tokenBalanceRaw: tokenBalance.toString(),
    tokenBalance: formatBridgeUnits(tokenBalance, decimals),
    tokenAllowanceRaw: tokenAllowance.toString(),
    tokenAllowance: formatBridgeUnits(tokenAllowance, decimals),
    destinationLiquidityRaw: liquidityBalance.toString(),
    destinationLiquidity: formatBridgeUnits(
      liquidityBalance,
      sourceChain === "bsc" ? cfg.gmiTokenDecimals : cfg.bscTokenDecimals,
    ),
  };
}

function stateKey(sourceChain: BridgeChain, txHash: string): string {
  return `gmi:bridge:transfer:${sourceChain}:${txHash.toLowerCase()}`;
}

async function readState(sourceChain: BridgeChain, txHash: Hex): Promise<BridgeTransferRecord | null> {
  const raw = await getRedis().get(stateKey(sourceChain, txHash));
  return raw ? JSON.parse(raw) as BridgeTransferRecord : null;
}

async function writeState(record: BridgeTransferRecord): Promise<void> {
  await getRedis().set(
    stateKey(record.sourceChain, record.txHash),
    JSON.stringify(record),
    "EX",
    STATE_TTL_SECONDS,
  );
}

async function acquire(key: string, ttlSeconds: number): Promise<string | null> {
  const token = randomUUID();
  return (await getRedis().set(key, token, "EX", ttlSeconds, "NX")) === "OK"
    ? token
    : null;
}

async function release(key: string, token: string): Promise<void> {
  // Only the owner of a lock may remove it. A plain DEL could delete a lock
  // acquired by another relayer after this lock's TTL elapsed.
  try {
    await getRedis().eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
  } catch (err) {
    // Lock expiry is the fallback. Never let cleanup failure change a
    // confirmed relay into a failed one.
    logger.warn({ err, key }, "Bridge lock release failed");
  }
}

function relayWallet(sourceChain: BridgeChain, cfg: BridgeRuntimeConfig) {
  const key = process.env["GMI_BRIDGE_RELAYER_PRIVATE_KEY"]?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Bridge relayer key is missing or invalid");
  }
  const account = privateKeyToAccount(key as Hex);
  const destinationChain: BridgeChain = sourceChain === "bsc" ? "gmi" : "bsc";
  return {
    account,
    client: createWalletClient({
      account,
      chain: chainFor(destinationChain),
      transport: http(rpcFor(destinationChain, cfg)),
    }),
  };
}

async function waitForReceipt(sourceChain: BridgeChain, txHash: Hex, cfg: BridgeRuntimeConfig) {
  const client = publicClient(sourceChain, cfg);
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);
    if (receipt) {
      const latest = await client.getBlockNumber();
      if (latest - receipt.blockNumber + 1n >= BigInt(cfg.confirmations)) {
        return receipt;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for bridge transaction confirmations");
}

async function processConfirmedTransfer(
  sourceChain: BridgeChain,
  txHash: Hex,
): Promise<BridgeTransferRecord> {
  const cfg = getBridgeRuntimeConfig();
  if (!cfg.enabled) throw new Error(`Bridge is not configured: ${cfg.missing.join(", ")}`);

  const existing = await readState(sourceChain, txHash);
  if (existing?.state === "confirmed") return existing;

  const receipt = await waitForReceipt(sourceChain, txHash, cfg);
  if (receipt.status !== "success") {
    const failed: BridgeTransferRecord = {
      ...(existing ?? { sourceChain, txHash }),
      state: "failed",
      error: "Source transaction reverted",
      updatedAt: new Date().toISOString(),
    };
    await writeState(failed);
    return failed;
  }

  const expectedBridge = bridgeFor(sourceChain, cfg).toLowerCase();
  const matchingLog = receipt.logs.find((log) => {
    if (log.address.toLowerCase() !== expectedBridge) return false;
    try {
      const decoded = decodeEventLog({
        abi: sourceChain === "bsc" ? DEPOSIT_EVENT_ABI : WITHDRAWAL_EVENT_ABI,
        data: log.data,
        topics: log.topics,
      });
      return sourceChain === "bsc"
        ? decoded.eventName === "Deposit"
        : decoded.eventName === "Withdrawal";
    } catch {
      return false;
    }
  });
  if (!matchingLog) throw new Error("Confirmed transaction does not contain a bridge event");

  const decoded = decodeEventLog({
    abi: sourceChain === "bsc" ? DEPOSIT_EVENT_ABI : WITHDRAWAL_EVENT_ABI,
    data: matchingLog.data,
    topics: matchingLog.topics,
  }) as { eventName: string; args: Record<string, unknown> };
  const args = decoded.args;
  const eventId = (sourceChain === "bsc" ? args.depositId : args.withdrawalId) as Hex;
  const amountRaw = args.amount as bigint;
  const destination = packedAddressToEvm(args.destination as Hex);
  const decimals = sourceChain === "bsc" ? cfg.bscTokenDecimals : cfg.gmiTokenDecimals;
  const gross = formatBridgeUnits(amountRaw, decimals);
  const netSourceRaw = amountRaw - amountRaw * BigInt(cfg.feeBps) / 10_000n;
  const destinationDecimals = sourceChain === "bsc"
    ? cfg.gmiTokenDecimals
    : cfg.bscTokenDecimals;
  const netDestinationRaw = scaleBridgeUnits(
    netSourceRaw,
    decimals,
    destinationDecimals,
  );

  const eventLock = `gmi:bridge:event:${sourceChain}:${eventId.toLowerCase()}`;
  const eventLockToken = await acquire(eventLock, 900);
  if (!eventLockToken) {
    const already = await readState(sourceChain, txHash);
    if (already) return already;
    throw new Error("Bridge event is already being processed");
  }

  let record: BridgeTransferRecord = {
    ...(existing ?? { sourceChain, txHash }),
    sourceChain,
    txHash,
    state: "relaying",
    sourceBlock: receipt.blockNumber.toString(),
    eventId,
    grossAmount: gross,
    netAmount: formatBridgeUnits(netDestinationRaw, destinationDecimals),
    destinationAddress: destination,
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeState(record);
    const { account, client } = relayWallet(sourceChain, cfg);
    const destinationChain: BridgeChain = sourceChain === "bsc" ? "gmi" : "bsc";
    const destinationClient = publicClient(destinationChain, cfg);
    let relayHash = record.relayTxHash;
    if (relayHash) {
      const previousRelayReceipt = await destinationClient
        .getTransactionReceipt({ hash: relayHash })
        .catch(() => null);
      // A mined revert did not mutate the destination contract, so it is safe
      // for operator recovery to submit the replay-protected call again.
      // Keep pending hashes so a late original transaction cannot race a retry.
      if (previousRelayReceipt?.status === "reverted") {
        relayHash = undefined;
      }
    }
    if (!relayHash) {
      relayHash = sourceChain === "bsc"
        ? await client.writeContract({
            account,
            address: cfg.gmiBridgeAddress!,
            abi: MINTER_ABI,
            functionName: "mint",
            args: [destination, netDestinationRaw, eventId],
          })
        : await client.writeContract({
            account,
            address: cfg.bscBridgeAddress!,
            abi: LOCKBOX_ABI,
            functionName: "release",
            args: [destination, netDestinationRaw, eventId],
          });
      record = { ...record, relayTxHash: relayHash, updatedAt: new Date().toISOString() };
      await writeState(record);
    }

    const relayReceipt = await destinationClient.waitForTransactionReceipt({
      hash: relayHash,
      confirmations: cfg.confirmations,
    });
    if (relayReceipt.status !== "success") throw new Error("Relay transaction reverted");

    record = {
      ...record,
      state: "confirmed",
      relayTxHash: relayHash,
      error: undefined,
      updatedAt: new Date().toISOString(),
    };
    await writeState(record);
    logger.info({ sourceChain, txHash, eventId, relayHash }, "Bridge relay confirmed");
    return record;
  } catch (err) {
    record = {
      ...record,
      state: "failed",
      error: err instanceof Error ? err.message : "Relay failed",
      updatedAt: new Date().toISOString(),
    };
    await writeState(record);
    logger.error({ err, sourceChain, txHash, eventId }, "Bridge relay failed");
    return record;
  } finally {
    await release(eventLock, eventLockToken);
  }
}

export async function notifyBridgeTransfer(sourceChain: BridgeChain, txHash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("Invalid transaction hash");
  const hash = txHash as Hex;
  const existing = await readState(sourceChain, hash);
  if (existing?.state === "confirmed") return existing;
  if (existing?.state === "failed" || existing?.state === "pending") {
    void processConfirmedTransfer(sourceChain, hash).catch(async (err) => {
      const current = await readState(sourceChain, hash);
      await writeState({
        ...(current ?? existing),
        state: "failed",
        error: err instanceof Error ? err.message : "Bridge processing failed",
        updatedAt: new Date().toISOString(),
      });
    });
    return existing;
  }
  if (existing) return existing;

  const pending: BridgeTransferRecord = {
    sourceChain,
    txHash: hash,
    state: "pending",
    updatedAt: new Date().toISOString(),
  };
  await writeState(pending);
  void processConfirmedTransfer(sourceChain, hash).catch(async (err) => {
    const failed: BridgeTransferRecord = {
      ...pending,
      state: "failed",
      error: err instanceof Error ? err.message : "Bridge processing failed",
      updatedAt: new Date().toISOString(),
    };
    await writeState(failed);
  });
  return pending;
}

export async function getBridgeTransferStatus(sourceChain: BridgeChain, txHash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("Invalid transaction hash");
  return readState(sourceChain, txHash as Hex);
}

export async function recoverBridgeTransfer(sourceChain: BridgeChain, txHash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("Invalid transaction hash");
  const hash = txHash as Hex;
  const existing = await readState(sourceChain, hash);
  if (existing?.state === "confirmed") return existing;
  return processConfirmedTransfer(sourceChain, hash);
}

async function watchSourceOnce(sourceChain: BridgeChain): Promise<void> {
  const cfg = getBridgeRuntimeConfig();
  if (!cfg.enabled) return;
  const bridge = bridgeFor(sourceChain, cfg);
  const client = publicClient(sourceChain, cfg);
  const latest = await client.getBlockNumber();
  const safeHead = latest > BigInt(cfg.confirmations) ? latest - BigInt(cfg.confirmations) : 0n;
  const cursorKey = `gmi:bridge:cursor:${sourceChain}`;
  const cursorRaw = await getRedis().get(cursorKey);
  let fromBlock = cursorRaw ? BigInt(cursorRaw) + 1n : (safeHead > LOG_CHUNK ? safeHead - LOG_CHUNK + 1n : 0n);
  if (fromBlock > safeHead) return;

  while (fromBlock <= safeHead) {
    const toBlock = fromBlock + LOG_CHUNK - 1n < safeHead
      ? fromBlock + LOG_CHUNK - 1n
      : safeHead;
    const logs = sourceChain === "bsc"
      ? await client.getLogs({
          address: bridge,
          event: DEPOSIT_EVENT_ABI[0],
          fromBlock,
          toBlock,
        })
      : await client.getLogs({
          address: bridge,
          event: WITHDRAWAL_EVENT_ABI[0],
          fromBlock,
          toBlock,
        });
    for (const log of logs) {
      if (log.transactionHash) {
        await notifyBridgeTransfer(sourceChain, log.transactionHash);
      }
    }
    await getRedis().set(cursorKey, toBlock.toString(), "EX", STATE_TTL_SECONDS);
    fromBlock = toBlock + 1n;
  }
}

export function startBridgeRelayer(): void {
  if (!getBridgeRuntimeConfig().enabled) {
    logger.warn("Bridge relayer disabled — deployment and relayer configuration are incomplete");
    return;
  }
  logger.info("GMI bridge relayer started");
  for (const sourceChain of ["bsc", "gmi"] as const) {
    const poll = async () => {
      const lockKey = `gmi:bridge:watch-lock:${sourceChain}`;
      let lockToken: string | null = null;
      try {
        lockToken = await acquire(lockKey, 60);
        if (!lockToken) return;
        await watchSourceOnce(sourceChain);
      } catch (err) {
        logger.error({ err, sourceChain }, "Bridge relayer poll failed");
      } finally {
        if (lockToken) {
          await release(lockKey, lockToken);
        }
      }
    };
    // Redis is started by the API workflow; give the daemon a moment to accept
    // connections before the first distributed-lock attempt.
    setTimeout(() => void poll(), 5_000);
    setInterval(() => void poll(), 15_000);
  }
}

export const bridgeTestExports = {
  BSC_CHAIN_ID,
  LOG_CHUNK,
};