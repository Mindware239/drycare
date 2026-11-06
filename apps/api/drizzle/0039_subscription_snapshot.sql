ALTER TABLE "commercial_subscriptions" ADD COLUMN "entitlements_snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "commercial_subscriptions" ADD COLUMN "branch_limit_snapshot" integer;--> statement-breakpoint
-- Customers who already have a plan keep what it includes today, whatever the plan becomes.
UPDATE "commercial_subscriptions" s SET "entitlements_snapshot_json" = p."entitlements_json", "branch_limit_snapshot" = p."branch_limit" FROM "commercial_plans" p WHERE p."id" = s."plan_id";
