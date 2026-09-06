export const GMI_RPC_URL = "https://rpc.gmichain.in";
export const GMI_CHAIN_ID = 33_698_741;
export const GMI_CHAIN_ID_HEX = "0x20233b5";
export const GMI_CHAIN_NAME = "GMI Chain";
export const GMI_NATIVE_NAME = "GMI";
export const GMI_NATIVE_SYMBOL = "GMI";
export const GMI_NATIVE_DECIMALS = 18;
export const GMI_GAS_PRICE_WEI = 1_000_000_000n;

export const GMI_CHAIN = {
  id: GMI_CHAIN_ID,
  name: GMI_CHAIN_NAME,
  nativeCurrency: {
    name: GMI_NATIVE_NAME,
    symbol: GMI_NATIVE_SYMBOL,
    decimals: GMI_NATIVE_DECIMALS,
  },
  rpcUrls: { default: { http: [GMI_RPC_URL] } },
} as const;