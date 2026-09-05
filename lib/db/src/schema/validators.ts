import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const validatorSubWallets = pgTable("validator_sub_wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  validatorAddress: text("validator_address").notNull(),
  subWalletAddress: text("sub_wallet_address").notNull().unique(),
  subWalletEthAddress: text("sub_wallet_eth_address").notNull().default(""),
  packageTier: text("package_tier"),
  frozenBalance: text("frozen_balance").notNull().default("0"),
  availableBalance: text("available_balance").notNull().default("0"),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ValidatorSubWallet = typeof validatorSubWallets.$inferSelect;
