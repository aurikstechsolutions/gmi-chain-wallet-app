import { bech32 } from "bech32";
import { getAddress, isAddress, type Address, type Hex } from "viem";

export type BridgeDirection = "bsc" | "gmi";

export function parseBridgeUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Amount must be a non-negative decimal number");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function formatBridgeUnits(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  if (remainder === 0n) return whole.toString();
  return `${whole}.${remainder.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export function scaleBridgeUnits(value: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return value;
  if (fromDecimals < toDecimals) {
    return value * 10n ** BigInt(toDecimals - fromDecimals);
  }
  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  if (value % divisor !== 0n) {
    throw new Error("Bridge token decimals would truncate the transfer amount");
  }
  return value / divisor;
}

export function toGmiEvmAddress(address: string): Address {
  const trimmed = address.trim();
  if (isAddress(trimmed)) return getAddress(trimmed);
  const decoded = bech32.decode(trimmed);
  if (decoded.prefix !== "gmi") throw new Error("Expected a GMI gmi1 address");
  const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
  if (bytes.length !== 20) throw new Error("Invalid GMI address payload");
  return getAddress(`0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`);
}

export function toPackedAddress(address: string): Hex {
  const evm = toGmiEvmAddress(address).slice(2).toLowerCase();
  return `0x${evm.padStart(64, "0")}` as Hex;
}

export function packedAddressToEvm(value: Hex): Address {
  const clean = value.slice(2);
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(clean)) {
    throw new Error("Bridge event contains an invalid destination address");
  }
  return getAddress(`0x${clean.slice(-40)}`);
}

export function calculateBridgeQuote(
  amount: string,
  sourceChain: BridgeDirection,
  config: {
    bscTokenDecimals: number;
    gmiTokenDecimals: number;
    feeBps: number;
    minAmount: string;
  },
): { grossAmount: string; feeAmount: string; netAmount: string; feeBps: number } {
  const decimals = sourceChain === "bsc" ? config.bscTokenDecimals : config.gmiTokenDecimals;
  const gross = parseBridgeUnits(amount, decimals);
  if (gross <= 0n) throw new Error("Amount must be greater than zero");
  const min = parseBridgeUnits(config.minAmount, decimals);
  if (gross < min) throw new Error(`Minimum bridge amount is ${config.minAmount}`);
  const fee = gross * BigInt(config.feeBps) / 10_000n;
  return {
    grossAmount: formatBridgeUnits(gross, decimals),
    feeAmount: formatBridgeUnits(fee, decimals),
    netAmount: formatBridgeUnits(gross - fee, decimals),
    feeBps: config.feeBps,
  };
}