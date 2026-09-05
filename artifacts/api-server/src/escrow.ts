import { bech32 } from "bech32";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  createWalletClient, http, parseUnits,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GMI_RPC_URL, gmiChain } from "./lib/chain";

// ── Hex helpers ───────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) bytes[i / 2] = parseInt(h.substring(i, i + 2), 16);
  return bytes;
}

// ── Address conversion ────────────────────────────────────────────────────────

export function mxcAddressToEthAddress(mxcAddress: string): `0x${string}` {
  const decoded = bech32.decode(mxcAddress);
  if (decoded.prefix !== "gmi") {
    throw new Error("Invalid GMI address prefix");
  }
  const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
  return `0x${bytesToHex(bytes)}`;
}

/** Accepts either gmi1… Bech32 or 0x… hex — always returns lowercase 0x hex. */
export function normalizeAddress(addr: string): `0x${string}` {
  if (addr.startsWith("0x") || addr.startsWith("0X"))
    return addr.toLowerCase() as `0x${string}`;
  if (addr.startsWith("gmi1"))
    return mxcAddressToEthAddress(addr);
  throw new Error(`Unrecognized address format: ${addr}`);
}

export function privateKeyToEthAddress(privateKeyHex: string): `0x${string}` {
  const privBytes = hexToBytes(privateKeyHex);
  const pubKeyUncompressed = secp256k1.getPublicKey(privBytes, false); // 65 bytes
  const pubKeyHash = keccak_256(pubKeyUncompressed.slice(1)); // skip 0x04 prefix
  return `0x${bytesToHex(pubKeyHash.slice(-20))}`;
}

// ── Chain config ──────────────────────────────────────────────────────────────

// ── USDT config ───────────────────────────────────────────────────────────────

function getUsdtContract(): `0x${string}` {
  const addr = process.env["USDT_CONTRACT_ADDRESS"];
  if (!addr) throw new Error("USDT_CONTRACT_ADDRESS is not configured");
  return addr as `0x${string}`;
}

const USDT_DECIMALS = 6;

const USDT_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

// ── Amount conversion ─────────────────────────────────────────────────────────

export function mcToWei(mc: string): string {
  const [intPart, decPart = ""] = mc.trim().split(".");
  const paddedDec = decPart.padEnd(18, "0").slice(0, 18);
  return BigInt((intPart || "0") + paddedDec).toString();
}

// ── Broadcast MC (native token via eth_sendRawTransaction) ───────────────────

export async function broadcastMcTransaction(
  _from: string,
  to: string,
  amountWei: string,
  privateKeyHex: string,
): Promise<string> {
  const toEthAddr = normalizeAddress(to);
  const privKey = `0x${privateKeyHex}` as `0x${string}`;
  const account = privateKeyToAccount(privKey);

  const client: WalletClient = createWalletClient({
    account,
    chain: gmiChain,
    transport: http(GMI_RPC_URL),
  });

  const txHash = await client.sendTransaction({
    account,
    chain: gmiChain,
    to: toEthAddr,
    value: BigInt(amountWei),
  });

  return txHash;
}

// ── Broadcast USDT (ERC-20 via eth_sendRawTransaction) ───────────────────────

export async function broadcastUsdtTransaction(
  escrowPrivateKeyHex: string,
  buyerMxcAddress: string,
  usdtAmount: string,   // human-readable, e.g. "10.500000"
): Promise<string> {
  const privKey = `0x${escrowPrivateKeyHex}` as `0x${string}`;
  const account = privateKeyToAccount(privKey);
  const buyerEthAddress = normalizeAddress(buyerMxcAddress);
  const amountUnits = parseUnits(usdtAmount, USDT_DECIMALS);

  const client: WalletClient = createWalletClient({
    account,
    chain: gmiChain,
    transport: http(GMI_RPC_URL),
  });

  const txHash = await client.writeContract({
    account,
    chain: gmiChain,
    address: getUsdtContract(),
    abi: USDT_ABI,
    functionName: "transfer",
    args: [buyerEthAddress, amountUnits],
  });

  return txHash;
}

// ── Escrow wallet config (file-based override > env vars) ─────────────────────

interface EscrowFileConfig {
  address: string;
  privateKey: string;
}

// Path: one level above the compiled bundle directory
// Dev:  <project>/artifacts/api-server/escrow-config.json
// VPS:  /opt/mchain-api/escrow-config.json
function configFilePath(): string {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "escrow-config.json");
  } catch {
    return path.resolve(process.cwd(), "escrow-config.json");
  }
}

// In-memory cache — undefined = not yet attempted, null = file absent/invalid
let _fileConfig: EscrowFileConfig | null | undefined = undefined;

function loadFileConfig(): EscrowFileConfig | null {
  if (_fileConfig !== undefined) return _fileConfig;
  try {
    const raw = fs.readFileSync(configFilePath(), "utf8");
    _fileConfig = JSON.parse(raw) as EscrowFileConfig;
  } catch {
    _fileConfig = null;
  }
  return _fileConfig;
}

/** Persist a new escrow wallet config to disk and refresh the in-memory cache. */
export function saveEscrowConfig(address: string, privateKey: string): void {
  fs.writeFileSync(configFilePath(), JSON.stringify({ address, privateKey }, null, 2), "utf8");
  _fileConfig = { address, privateKey };
}

export function getEscrowAddress(): string {
  const addr = loadFileConfig()?.address ?? process.env["P2P_ESCROW_ADDRESS"];
  if (!addr) throw new Error("P2P_ESCROW_ADDRESS is not configured");
  return addr;
}

export function getEscrowPrivateKey(): string {
  const key = loadFileConfig()?.privateKey ?? process.env["P2P_ESCROW_PRIVATE_KEY"];
  if (!key) throw new Error("P2P_ESCROW_PRIVATE_KEY is not configured");
  return key;
}

export function isEscrowConfigured(): boolean {
  const cfg = loadFileConfig();
  return !!(
    (cfg?.address || process.env["P2P_ESCROW_ADDRESS"]) &&
    (cfg?.privateKey || process.env["P2P_ESCROW_PRIVATE_KEY"])
  );
}
