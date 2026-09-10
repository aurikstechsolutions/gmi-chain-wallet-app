import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  solanaKeypairFromPrivateKey,
  SOLANA_RPC_URL,
} from "./solana";
import { SOLANA_GMI_CONTRACT_ADDRESS } from "./solanaAssets";

export const RAYDIUM_SWAP_API = "https://transaction-v1.raydium.io";
export const SOLANA_WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const RAYDIUM_SOL_GMI_POOL = "Hp9zfZu7n9w1kVzHMGssvZJgbcWszTtXmvBoRebbTiVd";

type RaydiumApiResponse<T> = {
  success: boolean;
  msg?: string;
  data: T;
};

export interface RaydiumSwapQuote {
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;
  outputAmount: bigint;
  minimumOutputAmount: bigint;
  priceImpactPct: number;
  routePlan: Array<{
    poolId: string;
    inputMint: string;
    outputMint: string;
    feeAmount: string;
    feeRate: number;
  }>;
  raw: unknown;
}

export type RaydiumSolToGmiQuote = RaydiumSwapQuote;

type RaydiumComputeData = {
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: number;
  routePlan?: Array<{
    poolId: string;
    inputMint: string;
    outputMint: string;
    feeAmount: string;
    feeRate: number;
  }>;
};

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Raydium request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function fetchRaydiumQuote(
  inputMint: string,
  outputMint: string,
  inputAmount: bigint,
  slippageBps: number,
  errorLabel = "swap",
): Promise<RaydiumSwapQuote> {
  if (inputAmount === undefined || inputAmount === null || inputAmount <= 0n) {
    throw new Error(`Enter an amount greater than zero to swap ${errorLabel}`);
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 2_000) {
    throw new Error("Slippage must be between 0% and 20%");
  }

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: inputAmount.toString(),
    slippageBps: String(slippageBps),
    txVersion: "V0",
  });
  const response = await fetch(`${RAYDIUM_SWAP_API}/compute/swap-base-in?${params.toString()}`);
  const payload = await readJson<RaydiumApiResponse<RaydiumComputeData>>(response);
  if (!payload.success || !payload.data) {
    throw new Error(payload.msg || `Raydium could not find a ${errorLabel} route`);
  }

  return {
    inputMint: payload.data.inputMint,
    outputMint: payload.data.outputMint,
    inputAmount: BigInt(payload.data.inputAmount),
    outputAmount: BigInt(payload.data.outputAmount),
    minimumOutputAmount: BigInt(payload.data.otherAmountThreshold),
    priceImpactPct: Number(payload.data.priceImpactPct),
    routePlan: payload.data.routePlan ?? [],
    // The transaction endpoint expects the complete compute response, not only
    // its data member.
    raw: payload,
  };
}

export function fetchRaydiumSolToGmiQuote(
  inputLamports: bigint,
  slippageBps: number,
): Promise<RaydiumSolToGmiQuote> {
  return fetchRaydiumQuote(
    SOLANA_WRAPPED_SOL_MINT,
    SOLANA_GMI_CONTRACT_ADDRESS,
    inputLamports,
    slippageBps,
    "SOL/GMI",
  );
}

export function fetchRaydiumGmiToSolQuote(
  inputGmi: bigint,
  slippageBps: number,
): Promise<RaydiumSwapQuote> {
  return fetchRaydiumQuote(
    SOLANA_GMI_CONTRACT_ADDRESS,
    SOLANA_WRAPPED_SOL_MINT,
    inputGmi,
    slippageBps,
    "GMI/SOL",
  );
}

type RaydiumTransactionResponse = {
  data: Array<{ transaction: string }>;
};

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function signRaydiumTransaction(raw: Uint8Array, keypair: ReturnType<typeof solanaKeypairFromPrivateKey>): Uint8Array {
  try {
    const transaction = VersionedTransaction.deserialize(raw);
    transaction.sign([keypair]);
    return transaction.serialize();
  } catch {
    const transaction = Transaction.from(raw);
    transaction.partialSign(keypair);
    return Uint8Array.from(transaction.serialize());
  }
}

export async function executeRaydiumSwap(
  privateKeyHex: string,
  walletAddress: string,
  quote: RaydiumSwapQuote,
): Promise<{ signatures: string[]; poolId: string }> {
  const owner = new PublicKey(walletAddress);
  const isInputSol = quote.inputMint === SOLANA_WRAPPED_SOL_MINT;
  const isOutputSol = quote.outputMint === SOLANA_WRAPPED_SOL_MINT;
  const inputAccount = isInputSol
    ? undefined
    : await getAssociatedTokenAddress(new PublicKey(quote.inputMint), owner);
  const outputAccount = isOutputSol
    ? undefined
    : await getAssociatedTokenAddress(new PublicKey(quote.outputMint), owner);
  const response = await fetch(`${RAYDIUM_SWAP_API}/transaction/swap-base-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      computeUnitPriceMicroLamports: "1000",
      swapResponse: quote.raw,
      txVersion: "V0",
      wallet: owner.toBase58(),
      wrapSol: isInputSol,
      unwrapSol: isOutputSol,
      inputAccount: inputAccount?.toBase58(),
      outputAccount: outputAccount?.toBase58(),
    }),
  });
  const payload = await readJson<RaydiumApiResponse<RaydiumTransactionResponse>>(response);
  if (!payload.success || !payload.data?.data?.length) {
    throw new Error(payload.msg || "Raydium did not return a swap transaction");
  }

  const signer = solanaKeypairFromPrivateKey(privateKeyHex);
  if (signer.publicKey.toBase58() !== owner.toBase58()) {
    throw new Error("Wallet address does not match the signing key");
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const signatures: string[] = [];
  for (const transaction of payload.data.data) {
    const signed = signRaydiumTransaction(decodeBase64(transaction.transaction), signer);
    const signature = await connection.sendRawTransaction(signed, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    const confirmation = await connection.confirmTransaction(signature, "confirmed");
    if (confirmation.value.err) {
      throw new Error(`Raydium swap failed to confirm: ${JSON.stringify(confirmation.value.err)}`);
    }
    signatures.push(signature);
  }

  if (signatures.length === 0) throw new Error("Raydium returned no broadcast transaction");
  return {
    signatures,
    poolId: quote.routePlan[0]?.poolId ?? RAYDIUM_SOL_GMI_POOL,
  };
}

export function executeRaydiumSolToGmiSwap(
  privateKeyHex: string,
  walletAddress: string,
  quote: RaydiumSolToGmiQuote,
): Promise<{ signatures: string[]; poolId: string }> {
  return executeRaydiumSwap(privateKeyHex, walletAddress, quote);
}