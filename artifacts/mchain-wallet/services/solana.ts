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
} from "@solana/spl-token";
import { hexToBytes } from "./crypto";

export const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
export const SOLANA_NATIVE_DECIMALS = 9;

const connection = new Connection(SOLANA_RPC_URL, "confirmed");

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
  return BigInt(await connection.getBalance(new PublicKey(address), "confirmed"));
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
  const tokenAccount = await getAssociatedTokenAddress(mint, owner);
  const accountInfo = await connection.getAccountInfo(tokenAccount, "confirmed");
  if (!accountInfo) return 0n;
  const balance = await connection.getTokenAccountBalance(tokenAccount, "confirmed");
  return BigInt(balance.value.amount);
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

async function sendTransaction(
  transaction: Transaction,
  signer: Keypair,
  additionalLamportsRequired = 0n,
): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = signer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  const fee = await connection.getFeeForMessage(transaction.compileMessage(), "confirmed");
  if (fee.value === null) throw new Error("Could not estimate the Solana network fee");
  const availableLamports = BigInt(await connection.getBalance(signer.publicKey, "confirmed"));
  if (availableLamports < BigInt(fee.value) + additionalLamportsRequired) {
    throw new Error("Insufficient SOL balance for amount and network fees");
  }
  transaction.sign(signer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
  return signature;
}

export async function sendSol(
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
  return sendTransaction(transaction, signer, lamports);
}

export async function sendSolanaToken(
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
  const senderAccountInfo = await connection.getAccountInfo(senderTokenAccount, "confirmed");
  if (!senderAccountInfo) throw new Error("Token account not found for this wallet");
  const senderBalance = await connection.getTokenAccountBalance(senderTokenAccount, "confirmed");
  if (BigInt(senderBalance.value.amount) < amountRaw) {
    throw new Error("Insufficient token balance");
  }

  const recipientAccountInfo = await connection.getAccountInfo(recipientTokenAccount, "confirmed");
  let rentRequired = 0n;
  if (!recipientAccountInfo) {
    rentRequired = BigInt(await connection.getMinimumBalanceForRentExemption(165, "confirmed"));
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
  return sendTransaction(transaction, signer, rentRequired);
}