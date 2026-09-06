export interface BundledSolanaAsset {
  id: "solana-gmi" | "solana-usdt";
  mintAddress: string;
  decimals: number;
}

export const SOLANA_GMI_CONTRACT_ADDRESS =
  "CxsAtkrrZapVaQYH6vSeTreyY6yBp8jdsBnDBMVSb1MZ";

export const SOLANA_USDT_CONTRACT_ADDRESS =
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const BUNDLED_SOLANA_ASSETS: readonly BundledSolanaAsset[] = [
  {
    id: "solana-gmi",
    mintAddress: SOLANA_GMI_CONTRACT_ADDRESS,
    decimals: 6,
  },
  {
    id: "solana-usdt",
    mintAddress: SOLANA_USDT_CONTRACT_ADDRESS,
    decimals: 6,
  },
];