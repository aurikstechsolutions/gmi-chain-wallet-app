CREATE TYPE "public"."p2p_escrow_status" AS ENUM('none', 'locked', 'released', 'refunded');--> statement-breakpoint
ALTER TYPE "public"."p2p_payment_method" ADD VALUE 'upi' BEFORE 'paypal';--> statement-breakpoint
ALTER TYPE "public"."p2p_payment_method" ADD VALUE 'phonepe' BEFORE 'paypal';--> statement-breakpoint
ALTER TYPE "public"."p2p_payment_method" ADD VALUE 'google_pay' BEFORE 'paypal';--> statement-breakpoint
ALTER TYPE "public"."p2p_payment_method" ADD VALUE 'paytm' BEFORE 'paypal';--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "p2p_payment_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_address" text NOT NULL,
	"payment_method" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "featured_dapps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"url" text NOT NULL,
	"icon" text DEFAULT 'globe-outline' NOT NULL,
	"color" text DEFAULT '#0EA5E9' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"coming_soon" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verified_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"decimals" integer DEFAULT 18 NOT NULL,
	"logo_url" text DEFAULT '' NOT NULL,
	"coingecko_id" text DEFAULT '' NOT NULL,
	"contract_address" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "p2p_messages" ALTER COLUMN "content" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "p2p_messages" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "p2p_orders" ADD COLUMN "escrow_status" "p2p_escrow_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "p2p_orders" ADD COLUMN "escrow_locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "p2p_profiles" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "p2p_profiles" ADD COLUMN "kyc_doc_image" text;--> statement-breakpoint
ALTER TABLE "p2p_profiles" ADD COLUMN "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "p2p_pmt_details_owner_idx" ON "p2p_payment_details" USING btree ("owner_address");