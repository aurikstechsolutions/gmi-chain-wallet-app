import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const contractRoot = path.join(workspaceRoot, "contracts");
const bscToken = "0x55d398326f99059fF775485246999027B3197955";
const deployerKey = process.env.GMI_BRIDGE_DEPLOYER_PRIVATE_KEY?.trim();

if (!deployerKey || !/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) {
  throw new Error("GMI_BRIDGE_DEPLOYER_PRIVATE_KEY is missing or invalid");
}

const bsc = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-dataseed.binance.org"] } },
});

const gmi = defineChain({
  id: 33698741,
  name: "GMI Chain",
  nativeCurrency: { name: "GMI", symbol: "GMI", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.gmichain.in"] } },
});

const account = privateKeyToAccount(deployerKey);
const gmiPublic = createPublicClient({ chain: gmi, transport: http() });
const gmiWallet = createWalletClient({ account, chain: gmi, transport: http() });
const bscPublic = createPublicClient({ chain: bsc, transport: http() });
const bscWallet = createWalletClient({ account, chain: bsc, transport: http() });

function readSource(file) {
  return fs.readFileSync(path.join(contractRoot, file), "utf8");
}

function findImports(importPath) {
  const candidates = [
    path.join(workspaceRoot, "node_modules", importPath),
    path.join(contractRoot, importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { contents: fs.readFileSync(candidate, "utf8") };
  }
  return { error: `Unable to resolve ${importPath}` };
}

const input = {
  language: "Solidity",
  sources: {
    "GmiBridgeLockbox.sol": { content: readSource("GmiBridgeLockbox.sol") },
    "GmiBridgeMinter.sol": { content: readSource("GmiBridgeMinter.sol") },
    "GmiWrappedAsset.sol": { content: readSource("GmiWrappedAsset.sol") },
  },
  settings: {
    evmVersion: "paris",
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const compiled = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (compiled.errors ?? []).filter((error) => error.severity === "error");
if (errors.length > 0) {
  throw new Error(errors.map((error) => error.formattedMessage).join("\n"));
}

function artifact(name) {
  const contract = compiled.contracts[`${name}.sol`]?.[name];
  if (!contract?.evm?.bytecode?.object) throw new Error(`Missing compiled artifact for ${name}`);
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

async function deploy(name, chain, wallet, publicClient, args) {
  const { abi, bytecode } = artifact(name);
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (!receipt.contractAddress) throw new Error(`${name} deployment did not return a contract address`);
  console.log(JSON.stringify({ action: "deployed", name, chain: chain.name, address: receipt.contractAddress, txHash: hash }));
  return { address: receipt.contractAddress, abi };
}

async function write(chain, wallet, publicClient, request) {
  const hash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  console.log(JSON.stringify({ action: "confirmed", chain: chain.name, txHash: hash }));
}

console.log(JSON.stringify({ action: "deployer", address: account.address }));

const wrapped = await deploy(
  "GmiWrappedAsset",
  gmi,
  gmiWallet,
  gmiPublic,
  ["GMI Wrapped USDT", "wUSDT", 18, account.address, account.address],
);

const minter = await deploy(
  "GmiBridgeMinter",
  gmi,
  gmiWallet,
  gmiPublic,
  [wrapped.address, 33698741, 56, account.address, account.address, account.address],
);

const lockbox = await deploy(
  "GmiBridgeLockbox",
  bsc,
  bscWallet,
  bscPublic,
  [bscToken, 56, 33698741, account.address, account.address, account.address, account.address],
);

const wrappedRoleAbi = [
  { type: "function", name: "grantRole", stateMutability: "nonpayable", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [] },
];
const minterRole = keccak256(toBytes("MINTER_ROLE"));
const burnerRole = keccak256(toBytes("BURNER_ROLE"));

await write(gmi, gmiWallet, gmiPublic, {
  address: wrapped.address,
  abi: wrappedRoleAbi,
  functionName: "grantRole",
  args: [minterRole, minter.address],
});

await write(gmi, gmiWallet, gmiPublic, {
  address: wrapped.address,
  abi: wrappedRoleAbi,
  functionName: "grantRole",
  args: [burnerRole, minter.address],
});

const remoteAbi = [
  { type: "function", name: "setRemoteBridge", stateMutability: "nonpayable", inputs: [{ name: "bridge", type: "address" }], outputs: [] },
];

await write(gmi, gmiWallet, gmiPublic, {
  address: minter.address,
  abi: remoteAbi,
  functionName: "setRemoteBridge",
  args: [lockbox.address],
});

await write(bsc, bscWallet, bscPublic, {
  address: lockbox.address,
  abi: remoteAbi,
  functionName: "setRemoteBridge",
  args: [minter.address],
});

console.log(JSON.stringify({
  action: "complete",
  wrappedAsset: wrapped.address,
  gmiMinter: minter.address,
  bscLockbox: lockbox.address,
  bscToken,
  bscChainId: 56,
  gmiChainId: 33698741,
}));