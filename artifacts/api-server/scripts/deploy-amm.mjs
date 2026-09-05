import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const contractRoot = path.join(workspaceRoot, "contracts");
const deployerKey = process.env.GMI_BRIDGE_DEPLOYER_PRIVATE_KEY?.trim();
if (process.env.GMI_AMM_DEPLOY !== "1") {
  throw new Error("Set GMI_AMM_DEPLOY=1 to authorize an on-chain AMM deployment");
}
if (!deployerKey || !/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) {
  throw new Error("GMI_BRIDGE_DEPLOYER_PRIVATE_KEY is missing or invalid");
}

const gmi = defineChain({
  id: 33_698_741,
  name: "GMI Chain",
  nativeCurrency: { name: "GMI", symbol: "GMI", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.gmichain.in"] } },
});
const account = privateKeyToAccount(deployerKey);
const publicClient = createPublicClient({ chain: gmi, transport: http() });
const walletClient = createWalletClient({ account, chain: gmi, transport: http() });
const wUsdt = getAddress(
  process.env.GMI_AMM_WUSDT_ADDRESS ?? "0x7b2ed1be97fa240dbd0328dd307e35e588bcb917",
);
const feeBps = Number.parseInt(process.env.GMI_AMM_FEE_BPS ?? "30", 10);
if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 100) {
  throw new Error("GMI_AMM_FEE_BPS must be an integer from 0 to 100");
}

function readSource(file) {
  return fs.readFileSync(path.join(contractRoot, file), "utf8");
}

function findImports(importPath) {
  for (const candidate of [
    path.join(workspaceRoot, "node_modules", importPath),
    path.join(contractRoot, importPath),
  ]) {
    if (fs.existsSync(candidate)) return { contents: fs.readFileSync(candidate, "utf8") };
  }
  return { error: `Unable to resolve ${importPath}` };
}

const input = {
  language: "Solidity",
  sources: {
    "GmiWrappedNative.sol": { content: readSource("GmiWrappedNative.sol") },
    "GmiAmmPair.sol": { content: readSource("GmiAmmPair.sol") },
    "GmiAmmFactory.sol": { content: readSource("GmiAmmFactory.sol") },
    "GmiAmmRouter.sol": { content: readSource("GmiAmmRouter.sol") },
  },
  settings: {
    evmVersion: "paris",
    viaIR: true,
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const compiled = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (compiled.errors ?? []).filter((error) => error.severity === "error");
if (errors.length > 0) throw new Error(errors.map((error) => error.formattedMessage).join("\n"));

function artifact(name) {
  const contract = compiled.contracts[`${name}.sol`]?.[name];
  if (!contract?.evm?.bytecode?.object) throw new Error(`Missing compiled artifact for ${name}`);
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

async function deploy(name, args) {
  const { abi, bytecode } = artifact(name);
  const hash = await walletClient.deployContract({ abi, bytecode, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (!receipt.contractAddress) throw new Error(`${name} deployment did not return an address`);
  const address = getAddress(receipt.contractAddress);
  console.log(JSON.stringify({ action: "deployed", name, address, txHash: hash }));
  return { address, abi };
}

async function write(address, abi, functionName, args, value) {
  const hash = await walletClient.writeContract({ address, abi, functionName, args, value });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  console.log(JSON.stringify({ action: "confirmed", functionName, txHash: hash }));
  return hash;
}

console.log(JSON.stringify({ action: "deployer", address: account.address, wUsdt, feeBps }));
const wrappedNative = await deploy("GmiWrappedNative", []);
const factory = await deploy("GmiAmmFactory", [feeBps, account.address]);
const router = await deploy("GmiAmmRouter", [factory.address, wrappedNative.address]);

const factoryAbi = [
  {
    type: "function",
    name: "createPair",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }],
    outputs: [{ name: "pair", type: "address" }],
  },
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }],
    outputs: [{ name: "pair", type: "address" }],
  },
];
await write(factory.address, factoryAbi, "createPair", [wUsdt, wrappedNative.address]);
const pairAddress = await publicClient.readContract({
  address: factory.address,
  abi: factoryAbi,
  functionName: "getPair",
  args: [wUsdt, wrappedNative.address],
});
console.log(JSON.stringify({ action: "pair-created", pairAddress }));

const initialWusdt = process.env.GMI_AMM_INITIAL_WUSDT;
const initialGmi = process.env.GMI_AMM_INITIAL_GMI;
if ((initialWusdt && !initialGmi) || (!initialWusdt && initialGmi)) {
  throw new Error("Set both GMI_AMM_INITIAL_WUSDT and GMI_AMM_INITIAL_GMI, or neither");
}
if (initialWusdt && initialGmi) {
  const tokenAbi = [{
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  }];
  const routerAbi = [{
    type: "function",
    name: "addLiquidityNative",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountTokenDesired", type: "uint256" },
      { name: "amountTokenMin", type: "uint256" },
      { name: "amountNativeMin", type: "uint256" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [
      { name: "amountToken", type: "uint256" },
      { name: "amountNative", type: "uint256" },
      { name: "liquidity", type: "uint256" },
    ],
  }];
  const tokenAmount = parseUnits(initialWusdt, 18);
  const nativeAmount = parseUnits(initialGmi, 18);
  await write(wUsdt, tokenAbi, "approve", [router.address, tokenAmount]);
  await write(
    router.address,
    routerAbi,
    "addLiquidityNative",
    [wUsdt, tokenAmount, tokenAmount, nativeAmount, account.address, BigInt(Math.floor(Date.now() / 1000) + 1800)],
    nativeAmount,
  );
  console.log(JSON.stringify({ action: "initial-liquidity-added", wUsdt: initialWusdt, gmi: initialGmi }));
}

console.log(JSON.stringify({
  action: "complete",
  chainId: gmi.id,
  factory: factory.address,
  router: router.address,
  wrappedNative: wrappedNative.address,
  wUsdt,
  pair: pairAddress,
  feeBps,
}));