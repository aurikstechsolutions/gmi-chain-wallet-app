import { pgTable, text, timestamp, integer, numeric, boolean, pgEnum, uuid, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const p2pTokenEnum = pgEnum("p2p_token", ["MC", "USDT"]);
export const p2pSideEnum = pgEnum("p2p_side", ["buy", "sell"]);
export const p2pAdStatusEnum = pgEnum("p2p_ad_status", ["active", "paused", "completed", "cancelled"]);
export const p2pEscrowStatusEnum = pgEnum("p2p_escrow_status", ["none", "locked", "released", "refunded"]);
export const p2pOrderStatusEnum = pgEnum("p2p_order_status", [
  "pending",       // order created, waiting for buyer to pay
  "paid",          // buyer marked as paid
  "released",      // seller confirmed receipt, crypto released
  "cancelled",     // cancelled before payment
  "disputed",      // dispute opened
  "resolved",      // dispute resolved
]);
export const p2pDisputeReasonEnum = pgEnum("p2p_dispute_reason", [
  "payment_not_received",
  "payment_received_but_not_released",
  "wrong_amount",
  "other",
]);
export const p2pDisputeStatusEnum = pgEnum("p2p_dispute_status", ["open", "resolved_buyer", "resolved_seller"]);
export const p2pKycStatusEnum = pgEnum("p2p_kyc_status", ["none", "pending", "verified", "rejected"]);
export const p2pPaymentMethodEnum = pgEnum("p2p_payment_method", [
  "bank_transfer", "upi", "phonepe", "google_pay", "paytm",
  "paypal", "revolut", "wise", "cash", "crypto_transfer", "other"
]);

// ─── Tables ───────────────────────────────────────────────────────────────────

export const p2pProfiles = pgTable("p2p_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  mxcAddress: text("mxc_address").notNull().unique(),
  displayName: text("display_name").notNull(),
  totalTrades: integer("total_trades").notNull().default(0),
  completedTrades: integer("completed_trades").notNull().default(0),
  disputesLost: integer("disputes_lost").notNull().default(0),
  avgRating: numeric("avg_rating", { precision: 3, scale: 2 }).notNull().default("0"),
  kycStatus: p2pKycStatusEnum("kyc_status").notNull().default("none"),
  kycName: text("kyc_name"),
  kycDocType: text("kyc_doc_type"),
  phone: text("phone"),
  kycDocImage: text("kyc_doc_image"),
  kycSubmittedAt: timestamp("kyc_submitted_at"),
  kycVerifiedAt: timestamp("kyc_verified_at"),
  isMerchant: boolean("is_merchant").notNull().default(false),
  isPinned: boolean("is_pinned").notNull().default(false),
  onlineSince: timestamp("online_since"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("p2p_profiles_mxc_idx").on(t.mxcAddress),
]);

export const p2pAds = pgTable("p2p_ads", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerAddress: text("owner_address").notNull(),
  token: p2pTokenEnum("token").notNull(),
  side: p2pSideEnum("side").notNull(),
  price: numeric("price", { precision: 18, scale: 6 }).notNull(),
  priceType: text("price_type").notNull().default("fixed"),
  minAmount: numeric("min_amount", { precision: 18, scale: 6 }).notNull(),
  maxAmount: numeric("max_amount", { precision: 18, scale: 6 }).notNull(),
  availableAmount: numeric("available_amount", { precision: 18, scale: 6 }).notNull(),
  paymentMethods: text("payment_methods").array().notNull(),
  paymentWindow: integer("payment_window").notNull().default(15),
  terms: text("terms"),
  status: p2pAdStatusEnum("status").notNull().default("active"),
  completedOrders: integer("completed_orders").notNull().default(0),
  // Ad-level escrow: funds locked at ad creation time (sell ads only)
  escrowTxHash: text("escrow_tx_hash"),
  escrowStatus: p2pEscrowStatusEnum("escrow_status").notNull().default("none"),
  escrowLockedAt: timestamp("escrow_locked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("p2p_ads_token_side_idx").on(t.token, t.side, t.status),
  index("p2p_ads_owner_idx").on(t.ownerAddress),
]);

export const p2pOrders = pgTable("p2p_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  adId: uuid("ad_id").notNull().references(() => p2pAds.id),
  buyerAddress: text("buyer_address").notNull(),
  sellerAddress: text("seller_address").notNull(),
  token: p2pTokenEnum("token").notNull(),
  side: p2pSideEnum("side").notNull(),
  cryptoAmount: numeric("crypto_amount", { precision: 18, scale: 6 }).notNull(),
  fiatAmount: numeric("fiat_amount", { precision: 18, scale: 6 }).notNull(),
  price: numeric("price", { precision: 18, scale: 6 }).notNull(),
  paymentMethod: text("payment_method").notNull(),
  paymentDetails: text("payment_details"),
  status: p2pOrderStatusEnum("status").notNull().default("pending"),
  escrowTxHash: text("escrow_tx_hash"),
  releaseTxHash: text("release_tx_hash"),
  escrowStatus: p2pEscrowStatusEnum("escrow_status").notNull().default("none"),
  escrowLockedAt: timestamp("escrow_locked_at"),
  paymentDeadline: timestamp("payment_deadline").notNull(),
  paidAt: timestamp("paid_at"),
  releasedAt: timestamp("released_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelReason: text("cancel_reason"),
  disputeResolvedFor: text("dispute_resolved_for"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("p2p_orders_buyer_idx").on(t.buyerAddress),
  index("p2p_orders_seller_idx").on(t.sellerAddress),
  index("p2p_orders_ad_idx").on(t.adId),
  index("p2p_orders_status_idx").on(t.status),
]);

export const p2pMessages = pgTable("p2p_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => p2pOrders.id),
  senderAddress: text("sender_address").notNull(),
  content: text("content").notNull().default(""),
  imageUrl: text("image_url"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("p2p_messages_order_idx").on(t.orderId, t.createdAt),
]);

export const p2pDisputes = pgTable("p2p_disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => p2pOrders.id).unique(),
  openedBy: text("opened_by").notNull(),
  reason: p2pDisputeReasonEnum("reason").notNull(),
  description: text("description").notNull(),
  evidence: text("evidence"),
  status: p2pDisputeStatusEnum("status").notNull().default("open"),
  resolvedBy: text("resolved_by"),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const p2pRatings = pgTable("p2p_ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => p2pOrders.id),
  raterAddress: text("rater_address").notNull(),
  ratedAddress: text("rated_address").notNull(),
  score: integer("score").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("p2p_ratings_rated_idx").on(t.ratedAddress),
]);

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const insertP2pProfileSchema = createInsertSchema(p2pProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertP2pAdSchema = createInsertSchema(p2pAds).omit({ id: true, createdAt: true, updatedAt: true, completedOrders: true });
export const insertP2pOrderSchema = createInsertSchema(p2pOrders).omit({ id: true, createdAt: true, updatedAt: true });
export const insertP2pMessageSchema = createInsertSchema(p2pMessages).omit({ id: true, createdAt: true });
export const insertP2pDisputeSchema = createInsertSchema(p2pDisputes).omit({ id: true, createdAt: true, updatedAt: true, status: true, resolvedBy: true, resolution: true, resolvedAt: true });
export const insertP2pRatingSchema = createInsertSchema(p2pRatings).omit({ id: true, createdAt: true });

export type P2pProfile = typeof p2pProfiles.$inferSelect;
export type P2pAd = typeof p2pAds.$inferSelect;
export type P2pOrder = typeof p2pOrders.$inferSelect;
export type P2pMessage = typeof p2pMessages.$inferSelect;
export type P2pDispute = typeof p2pDisputes.$inferSelect;
export type P2pRating = typeof p2pRatings.$inferSelect;

export const createAdRequestSchema = z.object({
  token: z.enum(["MC", "USDT"]),
  side: z.enum(["buy", "sell"]),
  price: z.string().regex(/^\d+(\.\d+)?$/),
  minAmount: z.string().regex(/^\d+(\.\d+)?$/),
  maxAmount: z.string().regex(/^\d+(\.\d+)?$/),
  availableAmount: z.string().regex(/^\d+(\.\d+)?$/),
  paymentMethods: z.array(z.string()).min(1),
  paymentWindow: z.number().int().min(5).max(60).default(15),
  terms: z.string().max(500).optional(),
  escrowTxHash: z.string().optional(),
});

export const createOrderRequestSchema = z.object({
  adId: z.string().uuid(),
  cryptoAmount: z.string().regex(/^\d+(\.\d+)?$/),
  paymentMethod: z.string(),
  paymentDetails: z.string().optional(),
});

export const createDisputeRequestSchema = z.object({
  reason: z.enum(["payment_not_received", "payment_received_but_not_released", "wrong_amount", "other"]),
  description: z.string().min(10).max(1000),
  evidence: z.string().optional(),
});

export const sendMessageRequestSchema = z.object({
  content: z.string().max(2000).optional(),
  imageUrl: z.string().optional(),
  senderAddress: z.string().optional(),
}).refine(d => (d.content?.trim() ?? "").length > 0 || !!d.imageUrl, {
  message: "Must provide content or an image",
});

export const rateOrderRequestSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export const kycSubmitRequestSchema = z.object({
  mxcAddress: z.string().min(1),
  displayName: z.string().min(2).max(100),
  kycName: z.string().min(2).max(100),
  kycDocType: z.enum(["passport", "national_id", "drivers_license"]),
  kycDocImage: z.string().optional(),
});

// ─── Payment Details ──────────────────────────────────────────────────────────

export const p2pPaymentDetails = pgTable("p2p_payment_details", {
  id:            uuid("id").primaryKey().defaultRandom(),
  ownerAddress:  text("owner_address").notNull(),
  paymentMethod: text("payment_method").notNull(),
  label:         text("label").notNull().default(""),
  details:       jsonb("details").$type<Record<string, string>>().notNull().default({}),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("p2p_pmt_details_owner_idx").on(table.ownerAddress),
]);

// ─── App Settings ─────────────────────────────────────────────────────────────

export const appSettings = pgTable("app_settings", {
  key:       text("key").primaryKey(),
  value:     text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const DEFAULT_VOLUME_TIERS = {
  bronze:   10,
  silver:   50,
  gold:     100,
  platinum: 500,
};

export type VolumeTiers = typeof DEFAULT_VOLUME_TIERS;
