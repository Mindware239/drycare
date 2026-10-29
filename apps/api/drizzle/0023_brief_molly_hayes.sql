CREATE TABLE "commercial_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"subscription_id" uuid,
	"plan_id" uuid,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"currency" text DEFAULT 'INR' NOT NULL,
	"gst_rate_bps" integer NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"cgst_paise" integer DEFAULT 0 NOT NULL,
	"sgst_paise" integer DEFAULT 0 NOT NULL,
	"igst_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer NOT NULL,
	"seller_json" jsonb NOT NULL,
	"buyer_json" jsonb NOT NULL,
	"lines_json" jsonb NOT NULL,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_payment_id_commercial_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."commercial_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_subscription_id_commercial_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."commercial_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_plan_id_commercial_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."commercial_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_invoices_number_uq" ON "commercial_invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_invoices_payment_uq" ON "commercial_invoices" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_org_idx" ON "commercial_invoices" USING btree ("organization_id");