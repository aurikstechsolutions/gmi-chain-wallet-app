require("./register-typescript.cjs");

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemInstruction,
  Transaction,
  SystemProgram,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
const {
  deriveSolanaAddress,
  fetchSolanaMintDecimals,
  parseSolanaAmount,
  sendSolWithConnection,
  sendSolanaTokenWithConnection,
} = require("../services/solana.ts");
const {
  BUNDLED_SOLANA_ASSETS,
  SOLANA_GMI_CONTRACT_ADDRESS,
  SOLANA_USDT_CONTRACT_ADDRESS,
} = require("../services/solanaAssets.ts");
const {
  executeRaydiumSwap,
  parseRaydiumSwapRecovery,
  RaydiumSwapError,
  restoreRaydiumQuote,
  snapshotRaydiumQuote,
  SOLANA_WRAPPED_SOL_MINT,
} = require("../services/raydium.ts");
const {
  createRaydiumSwapRecoveryStore,
  raydiumSwapRecoveryKey,
} = require("../services/raydiumRecovery.ts");

const PRIVATE_KEY_HEX = "01".repeat(32);
const RECIPIENT = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const MINT = new PublicKey(SOLANA_GMI_CONTRACT_ADDRESS);
const BLOCKHASH = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey.toBase58();
const SOLANA_WALLET_ADDRESS = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey.toBase58();

function accountInfo() {
  return {
    data: Buffer.alloc(165),
    executable: false,
    lamports: 1,
    owner: TOKEN_PROGRAM_ID,
    rentEpoch: 0,
  };
}

function rpc(overrides = {}) {
  const sent = [];
  const calls = { rent: 0, send: 0 };
  const value = {
    calls,
    sent,
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 10 }),
    getFeeForMessage: async () => ({ context: { slot: 1 }, value: 5_000 }),
    getBalance: async () => 10_000_000,
    getAccountInfo: async () => accountInfo(),
    getTokenAccountBalance: async () => ({
      context: { slot: 1 },
      value: { amount: "10000000", decimals: 6, uiAmount: 10, uiAmountString: "10" },
    }),
    getMinimumBalanceForRentExemption: async () => {
      calls.rent += 1;
      return 2_039_280;
    },
    sendRawTransaction: async (raw) => {
      calls.send += 1;
      sent.push(raw);
      return "test-signature";
    },
    confirmTransaction: async () => ({ context: { slot: 1 }, value: { err: null } }),
    ...overrides,
  };
  return value;
}

function raydiumQuote() {
  return {
    inputMint: SOLANA_WRAPPED_SOL_MINT,
    outputMint: SOLANA_GMI_CONTRACT_ADDRESS,
    inputAmount: 1n,
    outputAmount: 1n,
    minimumOutputAmount: 1n,
    priceImpactPct: 0,
    routePlan: [{
      poolId: "test-pool",
      inputMint: SOLANA_WRAPPED_SOL_MINT,
      outputMint: SOLANA_GMI_CONTRACT_ADDRESS,
      feeAmount: "0",
      feeRate: 0,
    }],
    raw: {
      success: true,
      version: "V1",
      data: { inputMint: SOLANA_WRAPPED_SOL_MINT },
    },
  };
}

function raydiumTransaction() {
  const owner = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: BLOCKHASH,
  }).add(SystemProgram.transfer({
    fromPubkey: owner,
    toPubkey: owner,
    lamports: 1,
  }));
  return {
    transaction: Buffer.from(
      transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ).toString("base64"),
  };
}

async function executeMockedRaydiumSwap(data) {
  const originalFetch = global.fetch;
  const originalSendRawTransaction = Connection.prototype.sendRawTransaction;
  const originalConfirmTransaction = Connection.prototype.confirmTransaction;
  const sent = [];
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, data }),
  });
  Connection.prototype.sendRawTransaction = async (_raw) => {
    sent.push(_raw);
    return "test-signature";
  };
  Connection.prototype.confirmTransaction = async () => ({
    context: { slot: 1 },
    value: { err: null },
  });

  try {
    const result = await executeRaydiumSwap(
      PRIVATE_KEY_HEX,
      SOLANA_WALLET_ADDRESS,
      raydiumQuote(),
    );
    return { result, sent };
  } finally {
    global.fetch = originalFetch;
    Connection.prototype.sendRawTransaction = originalSendRawTransaction;
    Connection.prototype.confirmTransaction = originalConfirmTransaction;
  }
}

async function withMockedRaydiumSwap(data, callback) {
  const originalFetch = global.fetch;
  const originalSendRawTransaction = Connection.prototype.sendRawTransaction;
  const originalConfirmTransaction = Connection.prototype.confirmTransaction;
  const sent = [];
  let sendCount = 0;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, data }),
  });
  Connection.prototype.sendRawTransaction = async (raw) => {
    sent.push(raw);
    sendCount += 1;
    if (sendCount === 2) throw new Error("RPC disconnected after the first broadcast");
    return `test-signature-${sendCount}`;
  };
  Connection.prototype.confirmTransaction = async () => ({
    context: { slot: 1 },
    value: { err: null },
  });

  try {
    return await callback({ sent, get sendCount() { return sendCount; } });
  } finally {
    global.fetch = originalFetch;
    Connection.prototype.sendRawTransaction = originalSendRawTransaction;
    Connection.prototype.confirmTransaction = originalConfirmTransaction;
  }
}

test("derives a stable public Solana address from a fixed seed", () => {
  assert.equal(
    deriveSolanaAddress(PRIVATE_KEY_HEX),
    "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9",
  );
});

test("rejects zero, sub-base-unit, and excess-precision amounts", () => {
  for (const value of ["0", "0.0000000001"]) {
    assert.throws(() => parseSolanaAmount(value, 9));
  }
  assert.throws(() => parseSolanaAmount("1.0000000001", 9), /9 decimal places/);
  assert.throws(() => parseSolanaAmount("0.0000001", 6), /6 decimal places/);
  assert.equal(parseSolanaAmount("0.000000001", 9), 1n);
  assert.equal(parseSolanaAmount("0.000001", 6), 1n);
});

test("requires native SOL amount plus the estimated network fee", async () => {
  const insufficient = rpc({ getBalance: async () => 1_004_999 });
  await assert.rejects(
    sendSolWithConnection(insufficient, PRIVATE_KEY_HEX, RECIPIENT.toBase58(), "0.001"),
    /Insufficient SOL balance/,
  );
  assert.equal(insufficient.calls.send, 0);

  const enough = rpc({ getBalance: async () => 1_005_000 });
  await sendSolWithConnection(enough, PRIVATE_KEY_HEX, RECIPIENT.toBase58(), "0.001");
  const transaction = require("@solana/web3.js").Transaction.from(enough.sent[0]);
  assert.equal(SystemInstruction.decodeTransfer(transaction.instructions[0]).lamports, 1_000_000n);
});

test("rejects a broadcast transaction when confirmation reports an error", async () => {
  const failed = rpc({
    confirmTransaction: async () => ({
      context: { slot: 1 },
      value: { err: { InstructionError: [0, "InsufficientFunds"] } },
    }),
  });
  await assert.rejects(
    sendSolWithConnection(failed, PRIVATE_KEY_HEX, RECIPIENT.toBase58(), "0.001"),
    /failed to confirm.*InstructionError/,
  );
  assert.equal(failed.calls.send, 1);
});

test("requires SPL balance and recipient-ATA rent before broadcasting", async () => {
  const lowToken = rpc({
    getTokenAccountBalance: async () => ({
      context: { slot: 1 },
      value: { amount: "999999", decimals: 6, uiAmount: 0.999999, uiAmountString: "0.999999" },
    }),
  });
  await assert.rejects(
    sendSolanaTokenWithConnection(
      lowToken, PRIVATE_KEY_HEX, MINT.toBase58(), RECIPIENT.toBase58(), "1", 6,
    ),
    /Insufficient token balance/,
  );
  assert.equal(lowToken.calls.send, 0);

  const sender = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
  const senderAta = await getAssociatedTokenAddress(MINT, sender);
  const recipientAta = await getAssociatedTokenAddress(MINT, RECIPIENT);
  const lowSol = rpc({
    getAccountInfo: async (address) => address.equals(senderAta) ? accountInfo() : null,
    getBalance: async () => 2_044_279,
  });
  await assert.rejects(
    sendSolanaTokenWithConnection(
      lowSol, PRIVATE_KEY_HEX, MINT.toBase58(), RECIPIENT.toBase58(), "1", 6,
    ),
    /Insufficient SOL balance/,
  );
  assert.equal(lowSol.calls.rent, 1);
  assert.equal(lowSol.calls.send, 0);
  assert.notEqual(senderAta.toBase58(), recipientAta.toBase58());
});

test("creates a missing recipient ATA and skips creation for an existing ATA", async () => {
  const sender = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
  const senderAta = await getAssociatedTokenAddress(MINT, sender);

  const missing = rpc({
    getAccountInfo: async (address) => address.equals(senderAta) ? accountInfo() : null,
  });
  await sendSolanaTokenWithConnection(
    missing, PRIVATE_KEY_HEX, MINT.toBase58(), RECIPIENT.toBase58(), "1.25", 6,
  );
  assert.equal(missing.calls.rent, 1);
  assert.equal(require("@solana/web3.js").Transaction.from(missing.sent[0]).instructions.length, 2);

  const existing = rpc();
  await sendSolanaTokenWithConnection(
    existing, PRIVATE_KEY_HEX, MINT.toBase58(), RECIPIENT.toBase58(), "1.25", 6,
  );
  assert.equal(existing.calls.rent, 0);
  assert.equal(require("@solana/web3.js").Transaction.from(existing.sent[0]).instructions.length, 1);
});

test("bundled mint addresses and decimals match canonical on-chain metadata", async () => {
  assert.deepEqual(BUNDLED_SOLANA_ASSETS, [
    { id: "solana-gmi", mintAddress: SOLANA_GMI_CONTRACT_ADDRESS, decimals: 6 },
    { id: "solana-usdt", mintAddress: SOLANA_USDT_CONTRACT_ADDRESS, decimals: 6 },
  ]);
  for (const asset of BUNDLED_SOLANA_ASSETS) {
    assert.equal(new PublicKey(asset.mintAddress).toBase58(), asset.mintAddress);
  }

  const mintRpc = {
    getAccountInfo: async () => ({
      ...accountInfo(),
      data: Buffer.from([
        0, 0, 0, 0, ...Buffer.alloc(32),
        ...Buffer.alloc(8),
        6,
        1,
        0, 0, 0, 0, ...Buffer.alloc(32),
      ]),
      owner: TOKEN_PROGRAM_ID,
    }),
  };
  for (const asset of BUNDLED_SOLANA_ASSETS) {
    assert.equal(await fetchSolanaMintDecimals(asset.mintAddress, mintRpc), asset.decimals);
  }
});

test("accepts Raydium transactions returned directly in the data array", async () => {
  const { result, sent } = await executeMockedRaydiumSwap([raydiumTransaction()]);

  assert.deepEqual(result, {
    signatures: ["test-signature"],
    poolId: "test-pool",
  });
  assert.equal(sent.length, 1);
});

test("keeps accepting the legacy nested Raydium transaction response", async () => {
  const { result, sent } = await executeMockedRaydiumSwap({
    data: [raydiumTransaction()],
  });

  assert.deepEqual(result, {
    signatures: ["test-signature"],
    poolId: "test-pool",
  });
  assert.equal(sent.length, 1);
});

test("executes every transaction in a multi-transaction Raydium swap", async () => {
  const { result, sent } = await executeMockedRaydiumSwap([
    raydiumTransaction(),
    raydiumTransaction(),
  ]);

  assert.deepEqual(result, {
    signatures: ["test-signature", "test-signature"],
    poolId: "test-pool",
  });
  assert.equal(sent.length, 2);
});

test("resumes a partially broadcast swap without resending confirmed transactions", async () => {
  await withMockedRaydiumSwap(
    [raydiumTransaction(), raydiumTransaction()],
    async ({ sent }) => {
      let progress;
      await assert.rejects(
        executeRaydiumSwap(
          PRIVATE_KEY_HEX,
          SOLANA_WALLET_ADDRESS,
          raydiumQuote(),
          { onProgress: (nextProgress) => { progress = nextProgress; } },
        ),
        (error) => {
          assert.ok(error instanceof RaydiumSwapError);
          assert.equal(error.progress.transactions[0].status, "confirmed");
          assert.equal(error.progress.transactions[0].signature, "test-signature-1");
          assert.equal(error.progress.transactions[1].status, "pending");
          assert.equal(error.progress.transactions[1].signature, undefined);
          progress = error.progress;
          return true;
        },
      );
      assert.equal(sent.length, 2);

      const result = await executeRaydiumSwap(
        PRIVATE_KEY_HEX,
        SOLANA_WALLET_ADDRESS,
        raydiumQuote(),
        { resume: progress },
      );
      assert.deepEqual(result, {
        signatures: ["test-signature-1", "test-signature-3"],
        poolId: "test-pool",
      });
      assert.equal(sent.length, 3);
    },
  );
});

test("round-trips a wallet-scoped Raydium recovery record without serializing bigint values", () => {
  const quote = raydiumQuote();
  const recovery = {
    walletAddress: SOLANA_WALLET_ADDRESS,
    direction: "sol-to-gmi",
    amount: "0.25",
    quote: snapshotRaydiumQuote(quote),
    progress: {
      poolId: "test-pool",
      transactions: [{
        transaction: "unsigned-transaction",
        signature: "confirmed-signature",
        status: "confirmed",
      }, {
        transaction: "next-transaction",
        status: "pending",
      }],
    },
    savedAt: "2026-09-11T00:00:00.000Z",
  };

  const parsed = parseRaydiumSwapRecovery(JSON.stringify(recovery));
  assert.deepEqual(parsed, recovery);
  assert.deepEqual(restoreRaydiumQuote(parsed.quote), {
    ...quote,
    raw: null,
  });
  assert.equal(parseRaydiumSwapRecovery("{not-json"), null);
});

test("restores recovery across remounts and isolates it when switching wallets", async () => {
  const values = new Map();
  const storage = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
  };
  const walletA = {
    id: "wallet-a",
    address: SOLANA_WALLET_ADDRESS,
    recovery: {
      walletAddress: SOLANA_WALLET_ADDRESS,
      direction: "sol-to-gmi",
      amount: "0.25",
      quote: snapshotRaydiumQuote(raydiumQuote()),
      progress: {
        poolId: "test-pool",
        transactions: [{ transaction: "wallet-a-transaction", status: "pending" }],
      },
      savedAt: "2026-09-11T00:00:00.000Z",
    },
  };
  const walletB = {
    id: "wallet-b",
    address: Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey.toBase58(),
    recovery: {
      ...walletA.recovery,
      walletAddress: Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey.toBase58(),
      amount: "0.5",
      progress: {
        ...walletA.recovery.progress,
        transactions: [{ transaction: "wallet-b-transaction", status: "confirmed" }],
      },
    },
  };

  const firstScreen = createRaydiumSwapRecoveryStore(storage);
  await firstScreen.save(walletA.id, walletA.recovery);
  await firstScreen.save(walletB.id, walletB.recovery);

  // A new store instance represents the swap screen after a remount or reload.
  const remountedScreen = createRaydiumSwapRecoveryStore(storage);
  assert.deepEqual(
    await remountedScreen.load(walletA.id, walletA.address),
    walletA.recovery,
  );

  // The active wallet only reads its own key; switching to B does not expose A.
  assert.equal(await remountedScreen.load(walletB.id, walletA.address), null);
  assert.deepEqual(
    await remountedScreen.load(walletB.id, walletB.address),
    walletB.recovery,
  );
  assert.equal(await storage.get(raydiumSwapRecoveryKey(walletA.id)) !== null, true);

  // Successful completion clears only the active wallet's saved batch.
  await remountedScreen.clear(walletB.id);
  assert.equal(await storage.get(raydiumSwapRecoveryKey(walletB.id)), null);
  // Explicit dismissal clears the other wallet's saved batch as well.
  await remountedScreen.clear(walletA.id);
  assert.equal(await storage.get(raydiumSwapRecoveryKey(walletA.id)), null);
});

test("reports a clear error when Raydium returns no transactions", async () => {
  await assert.rejects(
    executeMockedRaydiumSwap([]),
    /Raydium did not return a swap transaction/,
  );
});
