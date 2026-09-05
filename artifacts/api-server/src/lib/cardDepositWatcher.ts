/**
 * Background watcher: auto-detects MUSDT deposits to the admin/merchant wallet
 * and credits the sender's card balance if they have a registered card account.
 * Runs every 60 seconds. No user action required.
 */
import { pool } from "@workspace/db";
import { createPublicClient, http, parseAbiItem, type Hex } from "viem";
import { logger } from "./logger";
import { GMI_RPC_URL, gmiChain } from "./chain";

const USDT_DECIMALS = 6;
const POLL_INTERVAL_MS = 60_000;
const BLOCK_CHUNK = 9_000n;

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

function getPublicClient() {
  return createPublicClient({ chain: gmiChain, transport: http(GMI_RPC_URL) });
}

function getUsdtContract(): `0x${string}` | null {
  const addr = process.env["USDT_CONTRACT_ADDRESS"];
  return addr ? (addr.toLowerCase() as `0x${string}`) : null;
}

function getMerchantAddress(): `0x${string}` | null {
  const addr = process.env["CARD_MERCHANT_ADDRESS"] ?? process.env["P2P_ESCROW_ADDRESS"];
  return addr ? (addr.toLowerCase() as `0x${string}`) : null;
}

let lastScannedBlock: bigint | null = null;

async function watchOnce() {
  const usdtContract = getUsdtContract();
  const merchantAddr = getMerchantAddress();
  if (!usdtContract || !merchantAddr) return;

  const client = getPublicClient();
  const latestBlock = await client.getBlockNumber();

  const fromBlock = lastScannedBlock !== null
    ? lastScannedBlock + 1n
    : (latestBlock > BLOCK_CHUNK ? latestBlock - BLOCK_CHUNK : 0n);

  if (fromBlock > latestBlock) return;

  const toBlock = latestBlock;

  const logs = await client.getLogs({
    address: usdtContract,
    event: TRANSFER_EVENT,
    args: { to: merchantAddr },
    fromBlock,
    toBlock,
  });

  lastScannedBlock = latestBlock;

  if (logs.length === 0) return;

  logger.info({ count: logs.length, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() }, "Card deposit watcher: found Transfer events");

  const hashes = logs.map((l) => l.transactionHash).filter(Boolean) as string[];

  const existingRes = await pool.query(
    "SELECT tx_hash FROM card_deposits WHERE tx_hash = ANY($1)",
    [hashes]
  );
  const existingHashes = new Set(existingRes.rows.map((r: { tx_hash: string }) => r.tx_hash));

  const newLogs = logs.filter((l) => l.transactionHash && !existingHashes.has(l.transactionHash));
  if (newLogs.length === 0) return;

  // Load all registered card account addresses for matching
  const accountsRes = await pool.query(
    "SELECT wallet_address, stripe_card_id FROM card_accounts"
  );
  const accountMap = new Map<string, { stripe_card_id: string | null }>();
  for (const row of accountsRes.rows as { wallet_address: string; stripe_card_id: string | null }[]) {
    accountMap.set(row.wallet_address.toLowerCase(), { stripe_card_id: row.stripe_card_id });
  }

  for (const log of newLogs) {
    if (!log.args?.value || !log.transactionHash || !log.args?.from) continue;

    const sender = (log.args.from as string).toLowerCase();
    const amountUsdt = Number(log.args.value) / Math.pow(10, USDT_DECIMALS);
    if (amountUsdt <= 0) continue;

    const account = accountMap.get(sender);
    if (!account) {
      logger.info({ sender, amountUsdt, txHash: log.transactionHash }, "Card deposit watcher: sender has no card account — skipping");
      continue;
    }

    try {
      await pool.query(
        `INSERT INTO card_deposits (wallet_address, tx_hash, amount_usdt, from_address, network)
         VALUES ($1, $2, $3, $4, 'gmi')
         ON CONFLICT (tx_hash) DO NOTHING`,
        [sender, log.transactionHash, amountUsdt.toFixed(6), sender]
      );

      await pool.query(
        `UPDATE card_accounts SET balance_usdt = balance_usdt + $1, updated_at = NOW()
         WHERE wallet_address = $2`,
        [amountUsdt.toFixed(6), sender]
      );

      logger.info({ sender, amountUsdt, txHash: log.transactionHash }, "Card deposit watcher: credited balance");
    } catch (err) {
      logger.error({ err, sender, txHash: log.transactionHash }, "Card deposit watcher: failed to credit");
    }
  }
}

export function startCardDepositWatcher() {
  const usdtContract = getUsdtContract();
  const merchantAddr = getMerchantAddress();

  if (!usdtContract || !merchantAddr) {
    logger.warn("Card deposit watcher disabled — USDT_CONTRACT_ADDRESS or CARD_MERCHANT_ADDRESS not set");
    return;
  }

  logger.info({ intervalMs: POLL_INTERVAL_MS, merchantAddr, usdtContract }, "Card deposit watcher started");

  watchOnce().catch((err) =>
    logger.error({ err }, "Card deposit watcher: initial run failed")
  );

  setInterval(() => {
    watchOnce().catch((err) =>
      logger.error({ err }, "Card deposit watcher: poll failed")
    );
  }, POLL_INTERVAL_MS);
}
