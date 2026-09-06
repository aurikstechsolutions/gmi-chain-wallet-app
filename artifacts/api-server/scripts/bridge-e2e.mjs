import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/*
 * This is intentionally an opt-in test. It signs real transactions and must
 * never run as part of the normal unit-test or build commands.
 *
 * Required when enabled:
 *   GMI_BRIDGE_E2E=1
 *   GMI_BRIDGE_E2E_PRIVATE_KEY=<funded test wallet secret>
 *
 * Optional:
 *   GMI_BRIDGE_E2E_API_URL=http://127.0.0.1:8080/api
 *   GMI_BRIDGE_E2E_AMOUNT=0.1
 *   GMI_BRIDGE_E2E_WALLET_API_KEY=<if the API enables wallet write auth>
 *   GMI_BRIDGE_E2E_RECOVERY_SOURCE_CHAIN=bsc|gmi
 *   GMI_BRIDGE_E2E_RECOVERY_TX_HASH=<failed source transaction>
 *   GMI_BRIDGE_E2E_OPERATOR_KEY=<operator recovery secret>
 */

if (process.env.GMI_BRIDGE_E2E !== "1") {
  console.log(
    "Bridge E2E skipped. Set GMI_BRIDGE_E2E=1 only with a funded disposable test wallet.",
  );
  process.exit(0);
}

const privateKey = process.env.GMI_BRIDGE_E2E_PRIVATE_KEY?.trim();
if (!privateKey) {
  throw new Error("GMI_BRIDGE_E2E_PRIVATE_KEY is required when GMI_BRIDGE_E2E=1");
}

const apiBase = (
  process.env.GMI_BRIDGE_E2E_API_URL ?? "http://127.0.0.1:8080/api"
).replace(/\/$/, "");
const walletApiKey = process.env.GMI_BRIDGE_E2E_WALLET_API_KEY;
const account = privateKeyToAccount(privateKey);

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];
const lockboxAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destination", type: "bytes32" },
    ],
    outputs: [{ name: "depositId", type: "bytes32" }],
  },
];
const minterAbi = [
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destination", type: "bytes32" },
    ],
    outputs: [{ name: "withdrawalId", type: "bytes32" }],
  },
];

function chainFor(id, name, rpcUrl, symbol) {
  return {
    id,
    name,
    nativeCurrency: { name: symbol, symbol, decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

function packedAddress(address) {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function scaleUnits(value, fromDecimals, toDecimals) {
  if (fromDecimals === toDecimals) return value;
  if (fromDecimals < toDecimals) {
    return value * 10n ** BigInt(toDecimals - fromDecimals);
  }
  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  assert.equal(
    value % divisor,
    0n,
    "E2E amount cannot be represented exactly on the destination token",
  );
  return value / divisor;
}

function netUnits(value, feeBps) {
  return value - (value * BigInt(feeBps)) / 10_000n;
}

async function apiRequest(path, options = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(walletApiKey ? { "x-wallet-key": walletApiKey } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed (${response.status}): ${
        body.error ?? body.message ?? "request failed"
      }`,
    );
  }
  return body;
}

async function notifyAndWait(sourceChain, txHash) {
  const queued = await apiRequest("/bridge/notify", {
    method: "POST",
    body: JSON.stringify({ sourceChain, txHash }),
  });
  assert.equal(queued.sourceChain, sourceChain);
  assert.equal(queued.txHash.toLowerCase(), txHash.toLowerCase());

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await apiRequest(
      `/bridge/status/${encodeURIComponent(txHash)}?sourceChain=${sourceChain}`,
    );
    if (status.state === "confirmed") return status;
    if (status.state === "failed") {
      throw new Error(
        `Bridge relay failed for ${sourceChain} ${txHash}: ${
          status.error ?? "unknown relay error"
        }`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`Timed out waiting for ${sourceChain} bridge status`);
}

async function assertDuplicateNotification(sourceChain, txHash, expectedRelayHash, client, token, beforeBalance) {
  const first = await apiRequest("/bridge/notify", {
    method: "POST",
    body: JSON.stringify({ sourceChain, txHash }),
  });
  const second = await apiRequest("/bridge/notify", {
    method: "POST",
    body: JSON.stringify({ sourceChain, txHash }),
  });
  assert.equal(first.state, "confirmed");
  assert.equal(second.state, "confirmed");
  assert.equal(first.relayTxHash, expectedRelayHash);
  assert.equal(second.relayTxHash, expectedRelayHash);
  const afterBalance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  assert.equal(
    afterBalance,
    beforeBalance,
    `duplicate ${sourceChain} notification changed the destination balance`,
  );
}

async function runRecoveryCheck(config, clients) {
  const recoveryHash = process.env.GMI_BRIDGE_E2E_RECOVERY_TX_HASH?.trim();
  const recoverySource = process.env.GMI_BRIDGE_E2E_RECOVERY_SOURCE_CHAIN;
  if (!recoveryHash && !recoverySource) {
    console.log("Recovery check skipped (no failed source transaction supplied).");
    return;
  }
  if (!recoveryHash || (recoverySource !== "bsc" && recoverySource !== "gmi")) {
    throw new Error(
      "Recovery requires GMI_BRIDGE_E2E_RECOVERY_SOURCE_CHAIN and GMI_BRIDGE_E2E_RECOVERY_TX_HASH",
    );
  }
  const operatorKey = process.env.GMI_BRIDGE_E2E_OPERATOR_KEY;
  if (!operatorKey) {
    throw new Error("GMI_BRIDGE_E2E_OPERATOR_KEY is required for recovery");
  }

  const before = await apiRequest(
    `/bridge/status/${encodeURIComponent(recoveryHash)}?sourceChain=${recoverySource}`,
  );
  assert.equal(before.state, "failed", "recovery input must be in failed state");
  assert.ok(before.netAmount, "failed transfer is missing its net amount");

  const destination = recoverySource === "bsc" ? "gmi" : "bsc";
  const destinationClient = clients[destination].public;
  const destinationToken = config.sourceChains.find((chain) => chain.id === destination).tokenAddress;
  const destinationDecimals = config.sourceChains.find((chain) => chain.id === destination).tokenDecimals;
  assert.match(
    before.destinationAddress ?? "",
    /^0x[0-9a-fA-F]{40}$/,
    "failed transfer has no EVM destination address",
  );
  const beforeBalance = await destinationClient.readContract({
    address: destinationToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [before.destinationAddress],
  });

  const recovered = await apiRequest("/bridge/recover", {
    method: "POST",
    headers: { "x-bridge-operator-key": operatorKey },
    body: JSON.stringify({ sourceChain: recoverySource, txHash: recoveryHash }),
  });
  assert.equal(recovered.state, "confirmed");

  const afterBalance = await destinationClient.readContract({
    address: destinationToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [before.destinationAddress],
  });
  const delta = afterBalance - beforeBalance;
  const expected = parseUnits(before.netAmount, destinationDecimals);
  const relayAlreadySucceeded = Boolean(before.relayTxHash) &&
    (await destinationClient.getTransactionReceipt({ hash: before.relayTxHash }).catch(() => null))?.status === "success";
  assert.equal(
    delta,
    relayAlreadySucceeded ? 0n : expected,
    "recovery changed the destination balance by an unexpected amount",
  );

  const duplicateRecovery = await apiRequest("/bridge/recover", {
    method: "POST",
    headers: { "x-bridge-operator-key": operatorKey },
    body: JSON.stringify({ sourceChain: recoverySource, txHash: recoveryHash }),
  });
  assert.equal(duplicateRecovery.state, "confirmed");
  assert.equal(duplicateRecovery.relayTxHash, recovered.relayTxHash);
  console.log(
    `Recovery retry confirmed for ${recoverySource} ${recoveryHash}; duplicate recovery was idempotent.`,
  );
}

const config = await apiRequest("/bridge/config");
assert.equal(config.enabled, true, `Bridge is not ready: ${(config.missing ?? []).join(", ")}`);
assert.equal(config.relayerConfigured, true, "Bridge relayer is not configured");
const bscConfig = config.sourceChains.find((chain) => chain.id === "bsc");
const gmiConfig = config.sourceChains.find((chain) => chain.id === "gmi");
assert.ok(bscConfig?.rpcUrl && bscConfig.bridgeAddress && bscConfig.tokenAddress);
assert.ok(gmiConfig?.rpcUrl && gmiConfig.bridgeAddress && gmiConfig.tokenAddress);

const bscChain = chainFor(56, "BNB Smart Chain", bscConfig.rpcUrl, "BNB");
const gmiChain = chainFor(
  gmiConfig.chainId,
  "GMI Chain",
  gmiConfig.rpcUrl,
  "GMI",
);
const clients = {
  bsc: {
    public: createPublicClient({ chain: bscChain, transport: http(bscConfig.rpcUrl) }),
    wallet: createWalletClient({ account, chain: bscChain, transport: http(bscConfig.rpcUrl) }),
  },
  gmi: {
    public: createPublicClient({ chain: gmiChain, transport: http(gmiConfig.rpcUrl) }),
    wallet: createWalletClient({ account, chain: gmiChain, transport: http(gmiConfig.rpcUrl) }),
  },
};

const amount = process.env.GMI_BRIDGE_E2E_AMOUNT?.trim() ||
  (Number(config.minAmount) > 0 ? config.minAmount : "0.1");
const bscAmountRaw = parseUnits(amount, bscConfig.tokenDecimals);
const bscNetRaw = netUnits(bscAmountRaw, config.feeBps);
const gmiMintRaw = scaleUnits(
  bscNetRaw,
  bscConfig.tokenDecimals,
  gmiConfig.tokenDecimals,
);
const gmiWithdrawDisplay = formatUnits(gmiMintRaw, gmiConfig.tokenDecimals);
const gmiReleaseRaw = netUnits(gmiMintRaw, config.feeBps);
const bscReleaseRaw = scaleUnits(
  gmiReleaseRaw,
  gmiConfig.tokenDecimals,
  bscConfig.tokenDecimals,
);

const bscNativeBalance = await clients.bsc.public.getBalance({ address: account.address });
const gmiNativeBalance = await clients.gmi.public.getBalance({ address: account.address });
assert.ok(bscNativeBalance > 0n, "test wallet needs BNB for the deposit");
assert.ok(gmiNativeBalance > 0n, "test wallet needs GMI for the withdrawal");
console.log(`Running funded bridge E2E from ${account.address}`);
console.log(`Amount: ${amount} canonical units; expected wrapped mint: ${formatUnits(gmiMintRaw, gmiConfig.tokenDecimals)}`);

const gmiBeforeDeposit = await clients.gmi.public.readContract({
  address: gmiConfig.tokenAddress,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});
const approvalHash = await clients.bsc.wallet.writeContract({
  address: bscConfig.tokenAddress,
  abi: erc20Abi,
  functionName: "approve",
  args: [bscConfig.bridgeAddress, bscAmountRaw],
});
await clients.bsc.public.waitForTransactionReceipt({ hash: approvalHash, confirmations: config.confirmations });
const depositHash = await clients.bsc.wallet.writeContract({
  address: bscConfig.bridgeAddress,
  abi: lockboxAbi,
  functionName: "deposit",
  args: [bscAmountRaw, packedAddress(account.address)],
});
await clients.bsc.public.waitForTransactionReceipt({ hash: depositHash, confirmations: config.confirmations });
const depositStatus = await notifyAndWait("bsc", depositHash);
const gmiAfterDeposit = await clients.gmi.public.readContract({
  address: gmiConfig.tokenAddress,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});
assert.equal(gmiAfterDeposit - gmiBeforeDeposit, gmiMintRaw, "deposit mint delta did not match the quote");
console.log(`Deposit confirmed: ${depositHash} → ${depositStatus.relayTxHash}`);
await assertDuplicateNotification(
  "bsc",
  depositHash,
  depositStatus.relayTxHash,
  clients.gmi.public,
  gmiConfig.tokenAddress,
  gmiAfterDeposit,
);

const bscBeforeWithdrawal = await clients.bsc.public.readContract({
  address: bscConfig.tokenAddress,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});
const withdrawalHash = await clients.gmi.wallet.writeContract({
  address: gmiConfig.bridgeAddress,
  abi: minterAbi,
  functionName: "withdraw",
  args: [gmiMintRaw, packedAddress(account.address)],
});
await clients.gmi.public.waitForTransactionReceipt({ hash: withdrawalHash, confirmations: config.confirmations });
const withdrawalStatus = await notifyAndWait("gmi", withdrawalHash);
const bscAfterWithdrawal = await clients.bsc.public.readContract({
  address: bscConfig.tokenAddress,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});
assert.equal(
  bscAfterWithdrawal - bscBeforeWithdrawal,
  bscReleaseRaw,
  "withdrawal release delta did not match the quote",
);
console.log(`Withdrawal confirmed: ${withdrawalHash} → ${withdrawalStatus.relayTxHash}`);
await assertDuplicateNotification(
  "gmi",
  withdrawalHash,
  withdrawalStatus.relayTxHash,
  clients.bsc.public,
  bscConfig.tokenAddress,
  bscAfterWithdrawal,
);

await runRecoveryCheck(config, clients);
console.log("Bridge E2E passed: deposit/mint, withdrawal/release, duplicate notifications, and recovery checks.");