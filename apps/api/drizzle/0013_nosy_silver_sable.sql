CREATE TABLE "commercial_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subscription_id" uuid,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text NOT NULL,
	"provider_payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_paise" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"gst_inclusive" boolean DEFAULT false NOT NULL,
	"trial_eligible" boolean DEFAULT true NOT NULL,
	"device_limit" integer DEFAULT 1 NOT NULL,
	"branch_limit" integer DEFAULT 1 NOT NULL,
	"entitlements_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_reference" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"cancel_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD CONSTRAINT "commercial_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD CONSTRAINT "commercial_payments_subscription_id_commercial_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."commercial_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_subscriptions" ADD CONSTRAINT "commercial_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_subscriptions" ADD CONSTRAINT "commercial_subscriptions_plan_id_commercial_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."commercial_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_payments_provider_ref_uq" ON "commercial_payments" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "commercial_payments_org_idx" ON "commercial_payments" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_plans_code_uq" ON "commercial_plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "commercial_subscriptions_org_idx" ON "commercial_subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "commercial_subscriptions_status_idx" ON "commercial_subscriptions" USING btree ("status");