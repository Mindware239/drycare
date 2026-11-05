CREATE TABLE "customer_membership_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" integer DEFAULT 0 NOT NULL,
	"duration_days" integer NOT NULL,
	"discount_bps" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_membership_plans_discount_check" CHECK ("customer_membership_plans"."discount_bps" between 1 and 10000),
	CONSTRAINT "customer_membership_plans_duration_check" CHECK ("customer_membership_plans"."duration_days" > 0),
	CONSTRAINT "customer_membership_plans_price_check" CHECK ("customer_membership_plans"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"branch_id" uuid,
	"plan_name" text NOT NULL,
	"discount_bps" integer NOT NULL,
	"price_paid" integer DEFAULT 0 NOT NULL,
	"payment_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_memberships_status_check" CHECK ("customer_memberships"."status" in ('active', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "feature_overrides_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_membership_plans" ADD CONSTRAINT "customer_membership_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_plan_id_customer_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."customer_membership_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_membership_plans_name_uq" ON "customer_membership_plans" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "customer_memberships_customer_idx" ON "customer_memberships" USING btree ("customer_id","ends_at");--> statement-breakpoint
CREATE INDEX "customer_memberships_org_idx" ON "customer_memberships" USING btree ("organization_id","ends_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_membership_id_customer_memberships_id_fk" FOREIGN KEY ("customer_membership_id") REFERENCES "public"."customer_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Memberships are shop data, so they upload from a shop PC to its cloud copy like customers and orders do.
INSERT INTO "sync_entities" ("table_name", "entity_class") VALUES
  ('customer_membership_plans','master'),('customer_memberships','financial')
ON CONFLICT ("table_name") DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON "customer_membership_plans" FOR EACH ROW EXECUTE FUNCTION drycare_sync_capture();
--> statement-breakpoint
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON "customer_memberships" FOR EACH ROW EXECUTE FUNCTION drycare_sync_capture();
--> statement-breakpoint
-- The published plans now say which optional features they include. Starter follows the public pricing page.
UPDATE "commercial_plans" SET "entitlements_json" = "entitlements_json" || '{"labelDesigner":false,"customerMemberships":false,"laundry":false,"marketing":false,"inventory":false,"onlineBooking":true}'::jsonb WHERE "code" = 'starter';
--> statement-breakpoint
UPDATE "commercial_plans" SET "entitlements_json" = "entitlements_json" || '{"labelDesigner":true,"customerMemberships":true,"inventory":true,"onlineBooking":true}'::jsonb WHERE "code" IN ('growth', 'growth-yearly', 'enterprise');
