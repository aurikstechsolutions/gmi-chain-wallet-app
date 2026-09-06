import { pgTable, text, timestamp, integer, boolean, uuid } from "drizzle-orm/pg-core";

export const featuredDapps = pgTable("featured_dapps", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  url: text("url").notNull(),
  icon: text("icon").notNull().default("globe-outline"),
  color: text("color").notNull().default("#0EA5E9"),
  sortOrder: integer("sort_order").notNull().default(0),
  comingSoon: boolean("coming_soon").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
