import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";
import { hexToBytes } from "./crypto";

export const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
export const SOLANA_NATIVE_DECIMALS = 9;
const SOLANA_FALLBACK_RPC_URL = "https://solana-rpc.publicnode.com";

const connection = new Connection(SOLANA_RPC_URL, "confirmed");
const SOLANA_RPC_ENDPOINTS = [SOLANA_RPC_URL, SOLANA_FALLBACK_RPC_URL];

async function withRpcFallback<T>(operation: (rpcUrl: string) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const rpcUrl of SOLANA_RPC_ENDPOINTS) {
    try {
      return await operation(rpcUrl);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Solana RPC is temporarily unavailable");
}

async function solanaRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json() as { result?: T; error?: { message?: string; code?: number } };
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Solana RPC request failed (${response.status})`);
  }
  if (payload.result === undefined) throw new Error("Solana RPC returned no result");
  return payload.result;
}

export type SolanaConnection = Pick<
  Connection,
  | "getAccountInfo"
  | "getBalance"
  | "getFeeForMessage"
  | "getLatestBlockhash"
  | "getMinimumBalanceForRentExemption"
  | "getTokenAccountBalance"
  | "sendRawTransaction"
  | "confirmTransaction"
>;

export function solanaKeypairFromPrivateKey(privateKeyHex: string): Keypair {
  const cleanHex = privateKeyHex.trim().replace(/^0x/i, "");
  const seed = hexToBytes(cleanHex);
  if (seed.length !== 32) {
    throw new Error("Invalid wallet key for Solana");
  }
  return Keypair.fromSeed(seed);
}

export function deriveSolanaAddress(privateKeyHex: string): string {
  return solanaKeypairFromPrivateKey(privateKeyHex).publicKey.toBase58();
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    return new PublicKey(address).toBase58() === address;
  } catch {
    return false;
  }
}

export function parseSolanaAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a valid amount");
  }
  const [intPart, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`This asset supports up to ${decimals} decimal places`);
  }
  const raw = BigInt(intPart) * (10n ** BigInt(decimals))
    + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw <= 0n) {
    throw new Error("Amount must be at least one base unit");
  }
  return raw;
}

export function formatSolanaAmount(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export async function fetchSolanaBalanceRaw(address: string): Promise<bigint> {
  const owner = new PublicKey(address).toBase58();
  const result = await withRpcFallback((rpcUrl) => solanaRpc<{ value: number }>(
    rpcUrl,
    "getBalance",
    [owner, { commitment: "confirmed" }],
  ));
  return BigInt(result.value);
}

export async function fetchSolanaMintDecimals(
  mintAddress: string,
  rpc: SolanaConnection = connection,
): Promise<number> {
  return (await getMint(rpc as Connection, new PublicKey(mintAddress), "confirmed")).decimals;
}

export async function fetchSolanaBalance(address: string): Promise<string> {
  return formatSolanaAmount(await fetchSolanaBalanceRaw(address), SOLANA_NATIVE_DECIMALS);
}

export async function fetchSolanaTokenBalanceRaw(
  mintAddress: string,
  ownerAddress: string,
): Promise<bigint> {
  const owner = new PublicKey(ownerAddress);
  const mint = new PublicKey(mintAddress);
  const accounts = await withRpcFallback((rpcUrl) => solanaRpc<{
    value: Array<{ account: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }>
  }>(
    rpcUrl,
    "getTokenAccountsByOwner",
    [
      owner.toBase58(),
      { mint: mint.toBase58() },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ],
  ));
  return accounts.value.reduce((total, account) => {
    const amount = account.account.data?.parsed?.info?.tokenAmount?.amount;
    return amount === undefined ? total : total + BigInt(amount);
  }, 0n);
}

export async function fetchSolanaTokenBalance(
  mintAddress: string,
  ownerAddress: string,
): Promise<string> {
  const owner = new PublicKey(ownerAddress);
  const mint = new PublicKey(mintAddress);
  const tokenAccount = await getAssociatedTokenAddress(mint, owner);
  const accountInfo = await connection.getAccountInfo(tokenAccount, "confirmed");
  if (!accountInfo) return "0";
  const balance = await connection.getTokenAccountBalance(tokenAccount, "confirmed");
  return balance.value.uiAmountString ?? "0";
}

export interface SolanaHistoryEntry {
  signature: string;
  slot: number;
  blockTime: number | null;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  mintAddress?: string;
  status: "confirmed" | "failed";
}

type ParsedSolanaInstruction = {
  program?: string;
  parsed?: {
    type?: string;
    info?: {
      source?: string;
      destination?: string;
      authority?: string;
      owner?: string;
      mint?: string;
      lamports?: number;
      amount?: string;
      tokenAmount?: { amount?: string };
    };
  };
};

function parsedInstructions(transaction: any): ParsedSolanaInstruction[] {
  const topLevel = transaction?.transaction?.message?.instructions ?? [];
  const inner = (transaction?.meta?.innerInstructions ?? []).flatMap(
    (group: { instructions?: ParsedSolanaInstruction[] }) => group.instructions ?? [],
  );
  return [...topLevel, ...inner];
}

/**
 * Reads wallet-directed native SOL or SPL transfers from confirmed parsed
 * transactions. Solana RPC does not provide an address-indexed history API,
 * so signatures are fetched first and the transaction instructions are
 * filtered locally.
 */
export async function fetchSolanaTxHistory(
  ownerAddress: string,
  mintAddress?: string,
): Promise<SolanaHistoryEntry[]> {
  const owner = new PublicKey(ownerAddress).toBase58();
  const mint = mintAddress ? new PublicKey(mintAddress).toBase58() : undefined;
  const ownedTokenAccounts = new Set<string>();

  if (mint) {
    const accounts = await withRpcFallback((rpcUrl) => solanaRpc<{
      value: Array<{ pubkey: string }>
    }>(
      rpcUrl,
      "getTokenAccountsByOwner",
      [
        owner,
        { mint },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ],
    ));
    for (const account of accounts.value) ownedTokenAccounts.add(account.pubkey);
  }

  const signatures = await withRpcFallback((rpcUrl) => solanaRpc<Array<{
    signature: string;
    slot: number;
    blockTime: number | null;
    err: unknown;
  }>>(
    rpcUrl,
    "getSignaturesForAddress",
    [owner, { limit: 50, commitment: "confirmed" }],
  ));
  if (signatures.length === 0) return [];

  const transactions: Array<any | null> = [];
  for (let offset = 0; offset < signatures.length; offset += 8) {
    const batch = signatures.slice(offset, offset + 8);
    const parsedBatch = await Promise.all(
      batch.map((entry) =>
        withRpcFallback((rpcUrl) => solanaRpc<any | null>(
          rpcUrl,
          "getTransaction",
          [
            entry.signature,
            { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
          ],
        )),
      ),
    );
    transactions.push(...parsedBatch);
  }

  const results: SolanaHistoryEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < signatures.length; index += 1) {
    const signature = signatures[index];
    const transaction = transactions?.[index];
    if (!transaction) continue;
    const accountKeys = (transaction.transaction?.message?.accountKeys ?? []).map(
      (account: { pubkey?: string } | string) =>
        typeof account === "string" ? account : account.pubkey ?? "",
    );
    const tokenMintsByAccount = new Map<string, string>();
    for (const balance of [
      ...(transaction.meta?.preTokenBalances ?? []),
      ...(transaction.meta?.postTokenBalances ?? []),
    ]) {
      const account = accountKeys[balance.accountIndex];
      if (account && balance.mint) tokenMintsByAccount.set(account, balance.mint);
    }
    for (const instruction of parsedInstructions(transaction)) {
      const parsed = instruction.parsed;
      const info = parsed?.info;
      if (!parsed || !info) continue;

      if (!mint && instruction.program === "system" && parsed.type === "transfer") {
        const source = info.source ?? "";
        const destination = info.destination ?? "";
        if (source !== owner && destination !== owner) continue;
        const key = `${signature.signature}:sol:${source}:${destination}:${info.lamports ?? 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          signature: signature.signature,
          slot: signature.slot,
          blockTime: signature.blockTime,
          fromAddress: source,
          toAddress: destination,
          amountRaw: String(info.lamports ?? 0),
          status: signature.err ? "failed" : "confirmed",
        });
      }

      if (
        mint &&
        instruction.program === "spl-token" &&
        (parsed.type === "transfer" || parsed.type === "transferChecked")
      ) {
        const source = info.source ?? "";
        const destination = info.destination ?? "";
        const instructionMint =
          info.mint ??
          tokenMintsByAccount.get(source) ??
          tokenMintsByAccount.get(destination);
        if (instructionMint !== mint) continue;
        const isSender = source === owner || ownedTokenAccounts.has(source) || info.authority === owner;
        const isReceiver = destination === owner || ownedTokenAccounts.has(destination);
        if (!isSender && !isReceiver) continue;
        const amount = info.tokenAmount?.amount ?? info.amount ?? "0";
        const key = `${signature.signature}:token:${source}:${destination}:${amount}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          signature: signature.signature,
          slot: signature.slot,
          blockTime: signature.blockTime,
          fromAddress: isSender ? owner : source,
          toAddress: isReceiver ? owner : destination,
          amountRaw: amount,
          mintAddress: mint,
          status: signature.err ? "failed" : "confirmed",
        });
      }
    }
  }
  return results;
}

async function sendTransaction(
  transaction: Transaction,
  signer: Keypair,
  additionalLamportsRequired = 0n,
  rpc: SolanaConnection = connection,
): Promise<string> {
  const latest = await rpc.getLatestBlockhash("confirmed");
  transaction.feePayer = signer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  const fee = await rpc.getFeeForMessage(transaction.compileMessage(), "confirmed");
  if (fee.value === null) throw new Error("Could not estimate the Solana network fee");
  const availableLamports = BigInt(await rpc.getBalance(signer.publicKey, "confirmed"));
  if (availableLamports < BigInt(fee.value) + additionalLamportsRequired) {
    throw new Error("Insufficient SOL balance for amount and network fees");
  }
  transaction.sign(signer);
  const signature = await rpc.sendRawTransaction(transaction.serialize(), {
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
  const confirmation = await rpc.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(
      `Solana transaction failed to confirm: ${JSON.stringify(confirmation.value.err)}`,
    );
  }
  return signature;
}

export async function sendSol(
  privateKeyHex: string,
  recipientAddress: string,
  amount: string,
): Promise<string> {
  return sendSolWithConnection(connection, privateKeyHex, recipientAddress, amount);
}

export async function sendSolWithConnection(
  rpc: SolanaConnection,
  privateKeyHex: string,
  recipientAddress: string,
  amount: string,
): Promise<string> {
  const signer = solanaKeypairFromPrivateKey(privateKeyHex);
  const lamports = parseSolanaAmount(amount, SOLANA_NATIVE_DECIMALS);
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("SOL amount is too large");
  }
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: new PublicKey(recipientAddress),
      lamports: Number(lamports),
    }),
  );
  return sendTransaction(transaction, signer, lamports, rpc);
}

export async function sendSolanaToken(
  privateKeyHex: string,
  mintAddress: string,
  recipientAddress: string,
  amount: string,
  decimals: number,
): Promise<string> {
  return sendSolanaTokenWithConnection(
    connection,
    privateKeyHex,
    mintAddress,
    recipientAddress,
    amount,
    decimals,
  );
}

export async function sendSolanaTokenWithConnection(
  rpc: SolanaConnection,
  privateKeyHex: string,
  mintAddress: string,
  recipientAddress: string,
  amount: string,
  decimals: number,
): Promise<string> {
  const signer = solanaKeypairFromPrivateKey(privateKeyHex);
  const mint = new PublicKey(mintAddress);
  const recipient = new PublicKey(recipientAddress);
  const senderTokenAccount = await getAssociatedTokenAddress(mint, signer.publicKey);
  const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient);
  const transaction = new Transaction();
  const amountRaw = parseSolanaAmount(amount, decimals);
  const senderAccountInfo = await rpc.getAccountInfo(senderTokenAccount, "confirmed");
  if (!senderAccountInfo) throw new Error("Token account not found for this wallet");
  const senderBalance = await rpc.getTokenAccountBalance(senderTokenAccount, "confirmed");
  if (BigInt(senderBalance.value.amount) < amountRaw) {
    throw new Error("Insufficient token balance");
  }

  const recipientAccountInfo = await rpc.getAccountInfo(recipientTokenAccount, "confirmed");
  let rentRequired = 0n;
  if (!recipientAccountInfo) {
    rentRequired = BigInt(await rpc.getMinimumBalanceForRentExemption(165, "confirmed"));
    transaction.add(
      createAssociatedTokenAccountInstruction(
        signer.publicKey,
        recipientTokenAccount,
        recipient,
        mint,
      ),
    );
  }

  transaction.add(
    createTransferCheckedInstruction(
      senderTokenAccount,
      mint,
      recipientTokenAccount,
      signer.publicKey,
      amountRaw,
      decimals,
    ),
  );
  return sendTransaction(transaction, signer, rentRequired, rpc);
}