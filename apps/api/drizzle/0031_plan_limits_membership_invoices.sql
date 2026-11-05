ALTER TABLE "customer_membership_plans" ADD COLUMN "tax_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD COLUMN "tax_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD COLUMN "tax_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "branch_limit_override" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_memberships_invoice_uq" ON "customer_memberships" USING btree ("organization_id","invoice_number");
--> statement-breakpoint
-- Starter follows the public pricing page: no wallet, basic reports only, no SMS / WhatsApp updates.
UPDATE "commercial_plans" SET "entitlements_json" = "entitlements_json" || '{"wallet":false,"advancedReports":false,"whatsapp":false}'::jsonb WHERE "code" = 'starter';
--> statement-breakpoint
UPDATE "commercial_plans" SET "entitlements_json" = "entitlements_json" || '{"wallet":true,"advancedReports":true,"whatsapp":true}'::jsonb WHERE "code" IN ('growth', 'growth-yearly', 'enterprise');
