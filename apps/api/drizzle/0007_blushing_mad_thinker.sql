CREATE TABLE "marketing_coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"code" text NOT NULL,
	"discount_bps" integer NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_redemptions" integer,
	"minimum_order_value" bigint DEFAULT 0 NOT NULL,
	"first_order_only" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN "coupon_code" text;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN "discount_bps" integer;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN "coupon_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN "coupon_max_redemptions" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_coupon_redemptions" ADD CONSTRAINT "marketing_coupon_redemptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_coupon_redemptions" ADD CONSTRAINT "marketing_coupon_redemptions_coupon_id_marketing_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."marketing_coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_coupon_redemptions" ADD CONSTRAINT "marketing_coupon_redemptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_coupon_redemptions" ADD CONSTRAINT "marketing_coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_coupons" ADD CONSTRAINT "marketing_coupons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_coupons" ADD CONSTRAINT "marketing_coupons_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_coupon_redemptions_customer_uq" ON "marketing_coupon_redemptions" USING btree ("coupon_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_coupon_redemptions_order_uq" ON "marketing_coupon_redemptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "marketing_coupon_redemptions_org_coupon_idx" ON "marketing_coupon_redemptions" USING btree ("organization_id","coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_coupons_org_code_uq" ON "marketing_coupons" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_coupons_campaign_uq" ON "marketing_coupons" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "marketing_coupons_org_status_idx" ON "marketing_coupons" USING btree ("organization_id","status","expires_at");