import { pgTable, text, timestamp, integer, boolean, uuid } from "drizzle-orm/pg-core";

export const verifiedTokens = pgTable("verified_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  decimals: integer("decimals").notNull().default(18),
  logoUrl: text("logo_url").notNull().default(""),
  coingeckoId: text("coingecko_id").notNull().default(""),
  contractAddress: text("contract_address").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
