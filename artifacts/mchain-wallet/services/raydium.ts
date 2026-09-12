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

type RaydiumTransaction = { transaction: string };
type RaydiumTransactionResponse = RaydiumTransaction[] | { data: RaydiumTransaction[] };

export type RaydiumSwapTransactionProgress = {
  transaction: string;
  signature?: string;
  status: "pending" | "confirmed";
};

export type RaydiumSwapProgress = {
  poolId: string;
  transactions: RaydiumSwapTransactionProgress[];
};

export type RaydiumSwapQuoteSnapshot = {
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  minimumOutputAmount: string;
  priceImpactPct: number;
  routePlan: RaydiumSwapQuote["routePlan"];
};

export type RaydiumSwapRecovery = {
  walletAddress: string;
  direction: "sol-to-gmi" | "gmi-to-sol";
  amount: string;
  quote: RaydiumSwapQuoteSnapshot;
  progress: RaydiumSwapProgress;
  savedAt: string;
};

export type RaydiumSwapExecutionOptions = {
  resume?: RaydiumSwapProgress;
  onProgress?: (progress: RaydiumSwapProgress) => void;
};

export class RaydiumSwapError extends Error {
  constructor(
    message: string,
    public readonly progress: RaydiumSwapProgress,
  ) {
    super(message);
    this.name = "RaydiumSwapError";
  }
}

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

function copyRaydiumSwapProgress(progress: RaydiumSwapProgress): RaydiumSwapProgress {
  return {
    poolId: progress.poolId,
    transactions: progress.transactions.map((transaction) => ({ ...transaction })),
  };
}

async function describeRaydiumError(error: unknown, connection: Connection): Promise<string> {
  const candidate = error as {
    message?: string;
    getLogs?: (connection: Connection) => Promise<string[] | null>;
  };
  const baseMessage = candidate?.message || "Raydium swap transaction failed";
  let logs: string[] | null = null;
  if (typeof candidate?.getLogs === "function") {
    try {
      logs = await candidate.getLogs(connection);
    } catch {
      logs = null;
    }
  }
  if (logs && logs.length > 0) {
    return `${baseMessage.replace(/\s*Logs:\s*\[\]\s*$/, "")} Logs:\n${logs.join("\n")}`;
  }
  if (/blockhash|expired|simulation/i.test(baseMessage)) {
    return `${baseMessage.replace(/\s*Logs:\s*\[\]\s*$/, "")} The Raydium transaction may have expired or become stale; request a fresh quote before retrying.`;
  }
  return baseMessage;
}

export function snapshotRaydiumQuote(quote: RaydiumSwapQuote): RaydiumSwapQuoteSnapshot {
  return {
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    inputAmount: quote.inputAmount.toString(),
    outputAmount: quote.outputAmount.toString(),
    minimumOutputAmount: quote.minimumOutputAmount.toString(),
    priceImpactPct: quote.priceImpactPct,
    routePlan: quote.routePlan.map((route) => ({ ...route })),
  };
}

export function restoreRaydiumQuote(snapshot: RaydiumSwapQuoteSnapshot): RaydiumSwapQuote {
  return {
    inputMint: snapshot.inputMint,
    outputMint: snapshot.outputMint,
    inputAmount: BigInt(snapshot.inputAmount),
    outputAmount: BigInt(snapshot.outputAmount),
    minimumOutputAmount: BigInt(snapshot.minimumOutputAmount),
    priceImpactPct: snapshot.priceImpactPct,
    routePlan: snapshot.routePlan.map((route) => ({ ...route })),
    // A recovery never requests a new batch, so the original raw response is
    // not needed. Keep the field present for the execution type contract.
    raw: null,
  };
}

export function parseRaydiumSwapRecovery(value: string): RaydiumSwapRecovery | null {
  try {
    const parsed = JSON.parse(value) as Partial<RaydiumSwapRecovery>;
    if (
      typeof parsed.walletAddress !== "string" ||
      (parsed.direction !== "sol-to-gmi" && parsed.direction !== "gmi-to-sol") ||
      typeof parsed.amount !== "string" ||
      typeof parsed.savedAt !== "string" ||
      !parsed.quote ||
      !parsed.progress ||
      !Array.isArray(parsed.progress.transactions) ||
      typeof parsed.progress.poolId !== "string" ||
      parsed.progress.transactions.length === 0
    ) {
      return null;
    }

    const quote = restoreRaydiumQuote(parsed.quote);
    const transactions = parsed.progress.transactions.map((transaction) => {
      if (
        !transaction ||
        typeof transaction.transaction !== "string" ||
        (transaction.status !== "pending" && transaction.status !== "confirmed") ||
        (transaction.signature !== undefined && typeof transaction.signature !== "string")
      ) {
        throw new Error("Invalid Raydium recovery transaction");
      }
      return {
        transaction: transaction.transaction,
        ...(transaction.signature ? { signature: transaction.signature } : {}),
        status: transaction.status,
      };
    });

    return {
      walletAddress: parsed.walletAddress,
      direction: parsed.direction,
      amount: parsed.amount,
      quote: snapshotRaydiumQuote(quote),
      progress: {
        poolId: parsed.progress.poolId,
        transactions,
      },
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export async function executeRaydiumSwap(
  privateKeyHex: string,
  walletAddress: string,
  quote: RaydiumSwapQuote,
  options: RaydiumSwapExecutionOptions = {},
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

  const signer = solanaKeypairFromPrivateKey(privateKeyHex);
  if (signer.publicKey.toBase58() !== owner.toBase58()) {
    throw new Error("Wallet address does not match the signing key");
  }

  let progress: RaydiumSwapProgress;
  if (options.resume) {
    if (!options.resume.transactions.length) {
      throw new Error("Raydium swap cannot resume without transaction progress");
    }
    progress = copyRaydiumSwapProgress(options.resume);
  } else {
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
    const transactions = Array.isArray(payload.data) ? payload.data : payload.data?.data;
    if (!payload.success || !transactions?.length) {
      throw new Error(payload.msg || "Raydium did not return a swap transaction");
    }
    progress = {
      poolId: quote.routePlan[0]?.poolId ?? RAYDIUM_SOL_GMI_POOL,
      transactions: transactions.map((transaction) => ({
        transaction: transaction.transaction,
        status: "pending",
      })),
    };
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const signatures: string[] = [];
  options.onProgress?.(copyRaydiumSwapProgress(progress));
  for (const transaction of progress.transactions) {
    try {
      if (transaction.status === "confirmed") {
        if (!transaction.signature) {
          throw new Error("Raydium swap progress is missing a confirmed transaction signature");
        }
        signatures.push(transaction.signature);
        continue;
      }

      let signature = transaction.signature;
      if (!signature) {
        const signed = signRaydiumTransaction(decodeBase64(transaction.transaction), signer);
        signature = await connection.sendRawTransaction(signed, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
        transaction.signature = signature;
        options.onProgress?.(copyRaydiumSwapProgress(progress));
      }

      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      if (confirmation.value.err) {
        throw new Error(`Raydium swap failed to confirm: ${JSON.stringify(confirmation.value.err)}`);
      }
      transaction.status = "confirmed";
      options.onProgress?.(copyRaydiumSwapProgress(progress));
      signatures.push(signature);
    } catch (error) {
      const message = await describeRaydiumError(error, connection);
      throw new RaydiumSwapError(message, copyRaydiumSwapProgress(progress));
    }
  }

  if (signatures.length === 0) throw new Error("Raydium returned no broadcast transaction");
  return {
    signatures,
    poolId: progress.poolId,
  };
}

export function executeRaydiumSolToGmiSwap(
  privateKeyHex: string,
  walletAddress: string,
  quote: RaydiumSolToGmiQuote,
  options?: RaydiumSwapExecutionOptions,
): Promise<{ signatures: string[]; poolId: string }> {
  return executeRaydiumSwap(privateKeyHex, walletAddress, quote, options);
}