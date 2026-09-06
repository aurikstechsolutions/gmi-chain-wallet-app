import { getAddress, isAddress } from "viem";

const GMI_CHAIN_ID = 33_698_741;
const GMI_RPC_URL = "https://rpc.gmichain.in";
const DEFAULT_WUSDT = "0x7b2ed1be97fa240dbd0328dd307e35e588bcb917";

function publicAddress(value: string | undefined): string | null {
  if (!value || !isAddress(value)) return null;
  return getAddress(value);
}

export interface AmmPublicConfig {
  enabled: boolean;
  chainId: number;
  rpcUrl: string;
  feeBps: number;
  factoryAddress: string | null;
  routerAddress: string | null;
  wrappedNativeAddress: string | null;
  supportedTokens: Array<{
    id: string;
    symbol: string;
    name: string;
    decimals: number;
    address: string | null;
    isNative?: boolean;
  }>;
  pairs: Array<{
    id: string;
    tokenA: string;
    tokenB: string;
    pairAddress: string;
  }>;
  missing: string[];
}

export function getAmmPublicConfig(): AmmPublicConfig {
  const factoryAddress = publicAddress(process.env["GMI_AMM_FACTORY_ADDRESS"]);
  const routerAddress = publicAddress(process.env["GMI_AMM_ROUTER_ADDRESS"]);
  const wrappedNativeAddress = publicAddress(process.env["GMI_AMM_WRAPPED_NATIVE_ADDRESS"]);
  const wUsdtAddress = publicAddress(process.env["GMI_AMM_WUSDT_ADDRESS"] ?? DEFAULT_WUSDT);
  const pairAddress = publicAddress(process.env["GMI_AMM_WUSDT_WGMI_PAIR_ADDRESS"]);
  const feeBps = Number.parseInt(process.env["GMI_AMM_FEE_BPS"] ?? "30", 10);
  const missing: string[] = [];

  if (!factoryAddress) missing.push("GMI_AMM_FACTORY_ADDRESS");
  if (!routerAddress) missing.push("GMI_AMM_ROUTER_ADDRESS");
  if (!wrappedNativeAddress) missing.push("GMI_AMM_WRAPPED_NATIVE_ADDRESS");
  if (!wUsdtAddress) missing.push("GMI_AMM_WUSDT_ADDRESS");
  if (!pairAddress) missing.push("GMI_AMM_WUSDT_WGMI_PAIR_ADDRESS");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 100) missing.push("GMI_AMM_FEE_BPS");

  const supportedTokens = [
    {
      id: "gmi-native",
      symbol: "GMI",
      name: "GMI",
      decimals: 18,
      address: null,
      isNative: true,
    },
    {
      id: "wusdt",
      symbol: process.env["GMI_AMM_WUSDT_SYMBOL"] ?? "wUSDT",
      name: "GMI Wrapped USDT",
      decimals: Number.parseInt(process.env["GMI_AMM_WUSDT_DECIMALS"] ?? "18", 10),
      address: wUsdtAddress,
    },
  ];

  return {
    enabled: missing.length === 0,
    chainId: GMI_CHAIN_ID,
    rpcUrl: GMI_RPC_URL,
    feeBps: Number.isInteger(feeBps) && feeBps >= 0 && feeBps <= 100 ? feeBps : 30,
    factoryAddress,
    routerAddress,
    wrappedNativeAddress,
    supportedTokens,
    pairs: pairAddress && wrappedNativeAddress && wUsdtAddress
      ? [{ id: "gmi-wusdt", tokenA: wUsdtAddress, tokenB: wrappedNativeAddress, pairAddress }]
      : [],
    missing,
  };
}