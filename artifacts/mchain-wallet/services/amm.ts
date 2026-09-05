import { keccak_256 } from "@noble/hashes/sha3";
import { api, type AmmPublicConfig, type AmmTokenConfig } from "./api";
import {
  buildAmmAddLiquidityData,
  buildAmmAddLiquidityNativeData,
  buildAmmRemoveLiquidityData,
  buildAmmRemoveLiquidityNativeData,
  buildAmmSwapExactNativeForTokensData,
  buildAmmSwapExactTokensForNativeData,
  buildAmmSwapExactTokensForTokensData,
  buildErc20ApproveData,
  hexToBytes,
  parseUnits,
} from "./crypto";

export interface AmmSnapshot {
  pairAddress: string;
  reserveToken: bigint;
  reserveNative: bigint;
  totalSupply: bigint;
  lpBalance: bigint;
  lpAllowance: bigint;
  tokenBalance: bigint;
  tokenAllowance: bigint;
  nativeBalance: bigint;
}

export interface AmmQuote {
  amountIn: bigint;
  amountOut: bigint;
  minimumOut: bigint;
  priceImpactBps: bigint;
}

export interface AmmLiquidityAmounts {
  tokenAmount: bigint;
  nativeAmount: bigint;
  tokenMinimum: bigint;
  nativeMinimum: bigint;
}

function selector(signature: string): string {
  return "0x" + Array.from(keccak_256(new TextEncoder().encode(signature)).slice(0, 4))
    .map((value) => value.toString(16).padStart(2, "0")).join("");
}

function word(value: string): string {
  const clean = value.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{40}$/.test(clean)) throw new Error("Invalid EVM address");
  return clean.toLowerCase().padStart(64, "0");
}

function callData(signature: string, ...args: string[]): string {
  return selector(signature) + args.join("");
}

function readUint(result: { result?: string }): bigint {
  return BigInt(result.result && result.result !== "0x" ? result.result : "0x0");
}

function readWord(result: { result?: string }, index: number): bigint {
  const raw = (result.result ?? "0x").replace(/^0x/i, "");
  const value = raw.slice(index * 64, (index + 1) * 64);
  return value ? BigInt("0x" + value) : 0n;
}

export function formatAmmUnits(value: bigint, decimals: number, maxDecimals = 6): string {
  if (value < 0n) return `-${formatAmmUnits(-value, decimals, maxDecimals)}`;
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n || maxDecimals === 0) return whole.toString();
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, maxDecimals).replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

export function parseAmmUnits(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) throw new Error("Enter a valid positive amount");
  const raw = parseUnits(value.trim(), decimals);
  if (raw <= 0n) throw new Error("Amount must be greater than zero");
  return raw;
}

export function getToken(config: AmmPublicConfig, id: string): AmmTokenConfig {
  const token = config.supportedTokens.find((candidate) => candidate.id === id);
  if (!token) throw new Error("Unsupported AMM token");
  return token;
}

export function getTokenAddress(config: AmmPublicConfig, id: string): string {
  const token = getToken(config, id);
  if (!token.address) {
    if (!config.wrappedNativeAddress) throw new Error("Wrapped GMI is not configured");
    return config.wrappedNativeAddress;
  }
  return token.address;
}

export async function getAmmSnapshot(
  config: AmmPublicConfig,
  walletAddress: string,
): Promise<AmmSnapshot> {
  if (!config.enabled || !config.pairs[0] || !config.routerAddress) {
    throw new Error("GMI AMM is not configured");
  }
  const pair = config.pairs[0];
  const token = getToken(config, "wusdt");
  const tokenAddress = getTokenAddress(config, token.id);
  const wrappedNative = config.wrappedNativeAddress;
  if (!wrappedNative) throw new Error("Wrapped GMI is not configured");

  const pairReserves = await api.rpcCall(pair.pairAddress, "0x0902f1ac");
  const [token0Result, totalSupplyResult, lpBalanceResult, lpAllowanceResult, tokenBalanceResult, allowanceResult, nativeBalance] =
    await Promise.all([
      api.rpcCall(pair.pairAddress, callData("token0()")),
      api.rpcCall(pair.pairAddress, "0x18160ddd"),
      api.rpcCall(pair.pairAddress, callData("balanceOf(address)", word(walletAddress))),
      api.rpcCall(pair.pairAddress, callData("allowance(address,address)", word(walletAddress), word(config.routerAddress))),
      api.rpcCall(tokenAddress, callData("balanceOf(address)", word(walletAddress))),
      api.rpcCall(tokenAddress, callData("allowance(address,address)", word(walletAddress), word(config.routerAddress))),
      api.getBalance(walletAddress),
    ]);
  const token0 = `0x${(token0Result.result ?? "").slice(-40)}`.toLowerCase();
  const tokenIsFirst = token0 === tokenAddress.toLowerCase();
  return {
    pairAddress: pair.pairAddress,
    reserveToken: tokenIsFirst ? readWord(pairReserves, 0) : readWord(pairReserves, 1),
    reserveNative: tokenIsFirst ? readWord(pairReserves, 1) : readWord(pairReserves, 0),
    totalSupply: readUint(totalSupplyResult),
    lpBalance: readUint(lpBalanceResult),
    lpAllowance: readUint(lpAllowanceResult),
    tokenBalance: readUint(tokenBalanceResult),
    tokenAllowance: readUint(allowanceResult),
    nativeBalance: BigInt(nativeBalance.balance),
  };
}

export function calculateAmmQuote(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
  slippageBps: number,
): AmmQuote {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    throw new Error("This pool does not have enough liquidity");
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) throw new Error("Invalid AMM fee");
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 2_000) {
    throw new Error("Slippage must be between 0% and 20%");
  }
  const amountInWithFee = amountIn * BigInt(10_000 - feeBps);
  const amountOut = amountInWithFee * reserveOut /
    (reserveIn * 10_000n + amountInWithFee);
  if (amountOut <= 0n || amountOut >= reserveOut) throw new Error("Amount exceeds available liquidity");
  const spotOut = amountIn * reserveOut / reserveIn;
  const priceImpactBps = spotOut > amountOut ? (spotOut - amountOut) * 10_000n / spotOut : 0n;
  const minimumOut = amountOut * BigInt(10_000 - slippageBps) / 10_000n;
  return { amountIn, amountOut, minimumOut, priceImpactBps };
}

export function calculateAmmLiquidityAmounts(
  tokenDesired: bigint,
  nativeDesired: bigint,
  reserveToken: bigint,
  reserveNative: bigint,
  slippageBps: number,
): AmmLiquidityAmounts {
  if (tokenDesired <= 0n || nativeDesired <= 0n) throw new Error("Enter both liquidity amounts");
  if (slippageBps < 0 || slippageBps > 2_000) throw new Error("Slippage must be between 0% and 20%");

  let tokenAmount = tokenDesired;
  let nativeAmount = nativeDesired;
  if (reserveToken > 0n && reserveNative > 0n) {
    const nativeOptimal = tokenDesired * reserveNative / reserveToken;
    if (nativeOptimal <= nativeDesired) {
      nativeAmount = nativeOptimal;
    } else {
      const tokenOptimal = nativeDesired * reserveToken / reserveNative;
      if (tokenOptimal <= 0n) throw new Error("Liquidity amount is too small for this pool");
      tokenAmount = tokenOptimal;
    }
  }
  if (tokenAmount <= 0n || nativeAmount <= 0n) throw new Error("Liquidity amount is too small for this pool");
  const multiplier = BigInt(10_000 - slippageBps);
  return {
    tokenAmount,
    nativeAmount,
    tokenMinimum: tokenAmount * multiplier / 10_000n,
    nativeMinimum: nativeAmount * multiplier / 10_000n,
  };
}

export function calculateAmmLiquidityCounterpart(
  inputAmount: bigint,
  inputSide: "token" | "native",
  reserveToken: bigint,
  reserveNative: bigint,
): bigint {
  if (inputAmount <= 0n || reserveToken <= 0n || reserveNative <= 0n) return 0n;
  return inputSide === "token"
    ? inputAmount * reserveNative / reserveToken
    : inputAmount * reserveToken / reserveNative;
}

export function buildAmmApproval(token: AmmTokenConfig, routerAddress: string, amount: bigint): string {
  if (!token.address) throw new Error("Native GMI does not require approval");
  return buildErc20ApproveData(routerAddress, amount);
}

export function buildAmmSwap(
  config: AmmPublicConfig,
  from: AmmTokenConfig,
  to: AmmTokenConfig,
  quote: AmmQuote,
  recipient: string,
  deadline: bigint,
): { data: string; valueWei: bigint } {
  const fromAddress = getTokenAddress(config, from.id);
  const toAddress = getTokenAddress(config, to.id);
  const path = [fromAddress, toAddress];
  if (from.isNative) {
    return {
      data: buildAmmSwapExactNativeForTokensData(quote.minimumOut, path, recipient, deadline),
      valueWei: quote.amountIn,
    };
  }
  if (to.isNative) {
    return {
      data: buildAmmSwapExactTokensForNativeData(quote.amountIn, quote.minimumOut, path, recipient, deadline),
      valueWei: 0n,
    };
  }
  return {
    data: buildAmmSwapExactTokensForTokensData(
      quote.amountIn,
      quote.minimumOut,
      path,
      recipient,
      deadline,
    ),
    valueWei: 0n,
  };
}

export function buildAmmAddLiquidity(
  config: AmmPublicConfig,
  tokenAmount: bigint,
  nativeAmount: bigint,
  tokenMin: bigint,
  nativeMin: bigint,
  recipient: string,
  deadline: bigint,
): { data: string; valueWei: bigint } {
  const tokenAddress = getTokenAddress(config, "wusdt");
  if (!config.routerAddress) throw new Error("AMM router is not configured");
  return {
    data: buildAmmAddLiquidityNativeData(
      tokenAddress,
      tokenAmount,
      tokenMin,
      nativeMin,
      recipient,
      deadline,
    ),
    valueWei: nativeAmount,
  };
}

export function buildAmmRemoveLiquidity(
  config: AmmPublicConfig,
  lpAmount: bigint,
  tokenMin: bigint,
  nativeMin: bigint,
  recipient: string,
  deadline: bigint,
): string {
  if (!config.wrappedNativeAddress) throw new Error("Wrapped GMI is not configured");
  return buildAmmRemoveLiquidityNativeData(
    getTokenAddress(config, "wusdt"),
    lpAmount,
    tokenMin,
    nativeMin,
    recipient,
    deadline,
  );
}

export function buildAmmPairApproval(
  config: AmmPublicConfig,
  lpAmount: bigint,
): string {
  if (!config.routerAddress) throw new Error("AMM router is not configured");
  const pair = config.pairs[0]?.pairAddress;
  if (!pair) throw new Error("AMM pair is not configured");
  return buildErc20ApproveData(config.routerAddress, lpAmount);
}

export function decodeAmmPairAddress(result: { result?: string }): string {
  const clean = (result.result ?? "").replace(/^0x/i, "");
  if (clean.length < 64) throw new Error("AMM factory returned an invalid pair address");
  return `0x${clean.slice(-40)}`;
}

export function readAmmUint(result: { result?: string }): bigint {
  return readUint(result);
}