CREATE TYPE "public"."p2p_ad_status" AS ENUM('active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."p2p_dispute_reason" AS ENUM('payment_not_received', 'payment_received_but_not_released', 'wrong_amount', 'other');--> statement-breakpoint
CREATE TYPE "public"."p2p_dispute_status" AS ENUM('open', 'resolved_buyer', 'resolved_seller');--> statement-breakpoint
CREATE TYPE "public"."p2p_kyc_status" AS ENUM('none', 'pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."p2p_order_status" AS ENUM('pending', 'paid', 'released', 'cancelled', 'disputed', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."p2p_payment_method" AS ENUM('bank_transfer', 'paypal', 'revolut', 'wise', 'cash', 'crypto_transfer', 'other');--> statement-breakpoint
CREATE TYPE "public"."p2p_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."p2p_token" AS ENUM('MC', 'USDT');--> statement-breakpoint
CREATE TABLE "p2p_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_address" text NOT NULL,
	"token" "p2p_token" NOT NULL,
	"side" "p2p_side" NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"price_type" text DEFAULT 'fixed' NOT NULL,
	"min_amount" numeric(18, 6) NOT NULL,
	"max_amount" numeric(18, 6) NOT NULL,
	"available_amount" numeric(18, 6) NOT NULL,
	"payment_methods" text[] NOT NULL,
	"payment_window" integer DEFAULT 15 NOT NULL,
	"terms" text,
	"status" "p2p_ad_status" DEFAULT 'active' NOT NULL,
	"completed_orders" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "p2p_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"opened_by" text NOT NULL,
	"reason" "p2p_dispute_reason" NOT NULL,
	"description" text NOT NULL,
	"evidence" text,
	"status" "p2p_dispute_status" DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolution" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "p2p_disputes_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "p2p_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sender_address" text NOT NULL,
	"content" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "p2p_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_id" uuid NOT NULL,
	"buyer_address" text NOT NULL,
	"seller_address" text NOT NULL,
	"token" "p2p_token" NOT NULL,
	"side" "p2p_side" NOT NULL,
	"crypto_amount" numeric(18, 6) NOT NULL,
	"fiat_amount" numeric(18, 6) NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"payment_method" text NOT NULL,
	"payment_details" text,
	"status" "p2p_order_status" DEFAULT 'pending' NOT NULL,
	"escrow_tx_hash" text,
	"release_tx_hash" text,
	"payment_deadline" timestamp NOT NULL,
	"paid_at" timestamp,
	"released_at" timestamp,
	"cancelled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "p2p_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mxc_address" text NOT NULL,
	"display_name" text NOT NULL,
	"total_trades" integer DEFAULT 0 NOT NULL,
	"completed_trades" integer DEFAULT 0 NOT NULL,
	"disputes_lost" integer DEFAULT 0 NOT NULL,
	"avg_rating" numeric(3, 2) DEFAULT '0' NOT NULL,
	"kyc_status" "p2p_kyc_status" DEFAULT 'none' NOT NULL,
	"kyc_name" text,
	"kyc_doc_type" text,
	"kyc_submitted_at" timestamp,
	"kyc_verified_at" timestamp,
	"is_merchant" boolean DEFAULT false NOT NULL,
	"online_since" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "p2p_profiles_mxc_address_unique" UNIQUE("mxc_address")
);
--> statement-breakpoint
CREATE TABLE "p2p_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"rater_address" text NOT NULL,
	"rated_address" text NOT NULL,
	"score" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "p2p_disputes" ADD CONSTRAINT "p2p_disputes_order_id_p2p_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."p2p_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "p2p_messages" ADD CONSTRAINT "p2p_messages_order_id_p2p_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."p2p_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "p2p_orders" ADD CONSTRAINT "p2p_orders_ad_id_p2p_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."p2p_ads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "p2p_ratings" ADD CONSTRAINT "p2p_ratings_order_id_p2p_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."p2p_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "p2p_ads_token_side_idx" ON "p2p_ads" USING btree ("token","side","status");--> statement-breakpoint
CREATE INDEX "p2p_ads_owner_idx" ON "p2p_ads" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "p2p_messages_order_idx" ON "p2p_messages" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "p2p_orders_buyer_idx" ON "p2p_orders" USING btree ("buyer_address");--> statement-breakpoint
CREATE INDEX "p2p_orders_seller_idx" ON "p2p_orders" USING btree ("seller_address");--> statement-breakpoint
CREATE INDEX "p2p_orders_ad_idx" ON "p2p_orders" USING btree ("ad_id");--> statement-breakpoint
CREATE INDEX "p2p_orders_status_idx" ON "p2p_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "p2p_profiles_mxc_idx" ON "p2p_profiles" USING btree ("mxc_address");--> statement-breakpoint
CREATE INDEX "p2p_ratings_rated_idx" ON "p2p_ratings" USING btree ("rated_address");