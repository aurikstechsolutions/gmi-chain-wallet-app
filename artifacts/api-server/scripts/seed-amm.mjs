import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

if (process.env.GMI_AMM_SEED !== "1") {
  throw new Error("Set GMI_AMM_SEED=1 to authorize AMM liquidity seeding");
}
const privateKey = process.env.GMI_BRIDGE_DEPLOYER_PRIVATE_KEY?.trim();
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("GMI_BRIDGE_DEPLOYER_PRIVATE_KEY is missing or invalid");
}
const routerAddress = getAddress(process.env.GMI_AMM_ROUTER_ADDRESS ?? "");
const tokenAddress = getAddress(process.env.GMI_AMM_WUSDT_ADDRESS ?? "");
const tokenAmountText = process.env.GMI_AMM_SEED_WUSDT;
const nativeAmountText = process.env.GMI_AMM_SEED_GMI;
if (!tokenAmountText || !nativeAmountText) {
  throw new Error("Set GMI_AMM_SEED_WUSDT and GMI_AMM_SEED_GMI explicitly");
}

const chain = defineChain({
  id: 33_698_741,
  name: "GMI Chain",
  nativeCurrency: { name: "GMI", symbol: "GMI", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.gmichain.in"] } },
});
const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ account, chain, transport: http() });
const tokenAmount = parseUnits(tokenAmountText, 18);
const nativeAmount = parseUnits(nativeAmountText, 18);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

const approveAbi = [{
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

async function confirm(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}

console.log(JSON.stringify({
  action: "seed-start",
  provider: account.address,
  tokenAmount: tokenAmountText,
  nativeAmount: nativeAmountText,
}));
const approvalHash = await walletClient.writeContract({
  address: tokenAddress,
  abi: approveAbi,
  functionName: "approve",
  args: [routerAddress, tokenAmount],
});
await confirm(approvalHash);
console.log(JSON.stringify({ action: "approval-confirmed", txHash: approvalHash }));
const addHash = await walletClient.writeContract({
  address: routerAddress,
  abi: routerAbi,
  functionName: "addLiquidityNative",
  args: [tokenAddress, tokenAmount, tokenAmount, nativeAmount, account.address, deadline],
  value: nativeAmount,
});
await confirm(addHash);
console.log(JSON.stringify({ action: "liquidity-confirmed", txHash: addHash }));