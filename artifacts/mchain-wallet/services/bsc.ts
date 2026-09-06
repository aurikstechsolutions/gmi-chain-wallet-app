import {
  buildErc20TransferDataHex,
  hexToBytes,
  signLegacyTransaction,
} from "./crypto";

export const BSC_CHAIN_ID = 56;
export const BSC_NATIVE_DECIMALS = 18;
export const BSC_RPC_URL = "https://bsc-dataseed.binance.org/";

async function bscRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(BSC_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`BNB Smart Chain RPC failed (${response.status})`);
  const body = await response.json() as {
    result?: T;
    error?: { code: number; message: string };
  };
  if (body.error) throw new Error(body.error.message || "BNB Smart Chain RPC error");
  if (body.result === undefined) throw new Error("BNB Smart Chain RPC returned no result");
  return body.result;
}

export function isValidBscAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address.trim());
}

export function parseBscAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) throw new Error("Enter a valid amount");
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`This asset supports up to ${decimals} decimal places`);
  }
  const raw = BigInt(whole) * (10n ** BigInt(decimals))
    + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw <= 0n) throw new Error("Amount must be at least one base unit");
  return raw;
}

export function formatBscAmount(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export async function fetchBscBalanceRaw(address: string): Promise<bigint> {
  return BigInt(await bscRpc<string>("eth_getBalance", [address, "latest"]));
}

export async function fetchBscTokenBalanceRaw(
  contractAddress: string,
  ownerAddress: string,
): Promise<bigint> {
  const owner = ownerAddress.replace(/^0x/i, "").padStart(64, "0");
  const result = await bscRpc<string>("eth_call", [
    { to: contractAddress, data: `0x70a08231${owner}` },
    "latest",
  ]);
  return BigInt(result);
}

async function getTransactionParams(fromAddress: string) {
  const [nonceHex, gasPriceHex] = await Promise.all([
    bscRpc<string>("eth_getTransactionCount", [fromAddress, "pending"]),
    bscRpc<string>("eth_gasPrice", []),
  ]);
  return { nonce: Number(BigInt(nonceHex)), gasPrice: BigInt(gasPriceHex) };
}

async function broadcast(rawTransaction: string): Promise<string> {
  return bscRpc<string>("eth_sendRawTransaction", [rawTransaction]);
}

async function assertBscNetwork(): Promise<void> {
  const chainId = BigInt(await bscRpc<string>("eth_chainId", []));
  if (chainId !== BigInt(BSC_CHAIN_ID)) {
    throw new Error("RPC network mismatch: expected BNB Smart Chain");
  }
}

export type BscTransferQuote = {
  kind: "native" | "token";
  fromAddress: string;
  recipientAddress: string;
  contractAddress?: string;
  amountRaw: string;
  valueWei: string;
  dataHex: string;
  nonce: number;
  gasPriceWei: string;
  gasLimit: string;
  feeWei: string;
  quotedAt: number;
};

export async function quoteBscTransfer(params: {
  kind: "native" | "token";
  fromAddress: string,
  recipientAddress: string,
  amount: string,
  contractAddress?: string,
  decimals?: number,
}): Promise<BscTransferQuote> {
  const { kind, fromAddress, recipientAddress, amount, contractAddress, decimals } = params;
  if (!isValidBscAddress(fromAddress) || !isValidBscAddress(recipientAddress)) {
    throw new Error("Enter a valid BNB Smart Chain address");
  }
  await assertBscNetwork();
  const amountRaw = parseBscAmount(
    amount,
    kind === "native" ? BSC_NATIVE_DECIMALS : (decimals ?? 18),
  );
  if (kind === "token") {
    if (!contractAddress || !isValidBscAddress(contractAddress)) {
      throw new Error("Invalid BNB Smart Chain token contract");
    }
    const tokenBalance = await fetchBscTokenBalanceRaw(contractAddress, fromAddress);
    if (tokenBalance < amountRaw) throw new Error("Insufficient token balance");
  }
  const dataHex = kind === "token"
    ? buildErc20TransferDataHex(recipientAddress, amountRaw)
    : "0x";
  const toAddress = kind === "token" ? contractAddress! : recipientAddress;
  const valueWei = kind === "native" ? amountRaw : 0n;
  const [{ nonce, gasPrice }, gasEstimateHex] = await Promise.all([
    getTransactionParams(fromAddress),
    bscRpc<string>("eth_estimateGas", [{
      from: fromAddress,
      to: toAddress,
      value: `0x${valueWei.toString(16)}`,
      data: dataHex,
    }]),
  ]);
  const estimatedGas = BigInt(gasEstimateHex);
  const gasLimit = (estimatedGas * 12n + 9n) / 10n;
  const feeWei = gasPrice * gasLimit;
  const bnbBalance = await fetchBscBalanceRaw(fromAddress);
  if (bnbBalance < valueWei + feeWei) {
    throw new Error(kind === "native"
      ? "Insufficient BNB balance for amount and network fee"
      : "Insufficient BNB balance for the token transfer fee");
  }
  return {
    kind,
    fromAddress,
    recipientAddress,
    contractAddress,
    amountRaw: amountRaw.toString(),
    valueWei: valueWei.toString(),
    dataHex,
    nonce,
    gasPriceWei: gasPrice.toString(),
    gasLimit: gasLimit.toString(),
    feeWei: feeWei.toString(),
    quotedAt: Date.now(),
  };
}

export async function sendQuotedBscTransaction(
  privateKeyHex: string,
  quote: BscTransferQuote,
): Promise<string> {
  if (Date.now() - quote.quotedAt > 60_000) {
    throw new Error("BNB Smart Chain fee quote expired. Please review the transaction again.");
  }
  await assertBscNetwork();
  const pendingNonce = Number(BigInt(
    await bscRpc<string>("eth_getTransactionCount", [quote.fromAddress, "pending"]),
  ));
  if (pendingNonce !== quote.nonce) {
    throw new Error("Wallet nonce changed. Please review the transaction again.");
  }
  const valueWei = BigInt(quote.valueWei);
  const gasPrice = BigInt(quote.gasPriceWei);
  const gasLimit = BigInt(quote.gasLimit);
  const bnbBalance = await fetchBscBalanceRaw(quote.fromAddress);
  if (bnbBalance < valueWei + gasPrice * gasLimit) {
    throw new Error("Insufficient BNB balance for amount and reviewed network fee");
  }
  if (quote.kind === "token") {
    const tokenBalance = await fetchBscTokenBalanceRaw(
      quote.contractAddress!,
      quote.fromAddress,
    );
    if (tokenBalance < BigInt(quote.amountRaw)) throw new Error("Insufficient token balance");
  }
  const signed = signLegacyTransaction(
    quote.kind === "token" ? quote.contractAddress! : quote.recipientAddress,
    valueWei,
    quote.nonce,
    privateKeyHex,
    {
      chainId: BSC_CHAIN_ID,
      gasPrice,
      gasLimit,
      data: hexToBytes(quote.dataHex.replace(/^0x/i, "")),
    },
  );
  return broadcast(signed);
}