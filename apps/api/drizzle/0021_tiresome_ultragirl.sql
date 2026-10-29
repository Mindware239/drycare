CREATE TABLE "laundry_item_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "laundry_machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"machine_type" text NOT NULL,
	"capacity_grams" integer,
	"status" text DEFAULT 'available' NOT NULL,
	"control_mode" text DEFAULT 'manual' NOT NULL,
	"adapter_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laundry_machines_type_check" CHECK ("laundry_machines"."machine_type" in ('washer', 'dryer', 'iron_station')),
	CONSTRAINT "laundry_machines_status_check" CHECK ("laundry_machines"."status" in ('available', 'reserved', 'running', 'completed', 'out_of_service', 'maintenance'))
);
--> statement-breakpoint
CREATE TABLE "laundry_maintenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"notes" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"resolved_by" uuid
);
--> statement-breakpoint
CREATE TABLE "laundry_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "laundry_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"status_token" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"guest_name" text,
	"guest_phone" text,
	"service_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"pricing_method" text NOT NULL,
	"weight_grams" integer,
	"billable_grams" integer,
	"units" integer,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"discount_reason" text,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"tax_total" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"estimated_minutes" integer,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"paid_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laundry_orders_status_check" CHECK ("laundry_orders"."status" in ('pending_payment', 'paid', 'in_progress', 'ready', 'collected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "laundry_pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"branch_id" uuid,
	"method" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"min_weight_grams" integer DEFAULT 0 NOT NULL,
	"weight_increment_grams" integer DEFAULT 100 NOT NULL,
	"min_minutes" integer DEFAULT 0 NOT NULL,
	"minimum_charge" bigint DEFAULT 0 NOT NULL,
	"package_label" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laundry_pricing_rules_method_check" CHECK ("laundry_pricing_rules"."method" in ('weight', 'item', 'cycle', 'time', 'package'))
);
--> statement-breakpoint
CREATE TABLE "laundry_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "laundry_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"machine_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"tax_bps" integer DEFAULT 1800 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "laundry_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"program_id" uuid,
	"program_name" text,
	"duration_minutes" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"status_source" text DEFAULT 'staff' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"expected_end_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"started_by" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laundry_sessions_status_check" CHECK ("laundry_sessions"."status" in ('reserved', 'running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ALTER COLUMN "invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "laundry_order_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "laundry_order_id" uuid;--> statement-breakpoint
ALTER TABLE "laundry_item_rates" ADD CONSTRAINT "laundry_item_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_item_rates" ADD CONSTRAINT "laundry_item_rates_service_id_laundry_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."laundry_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_machines" ADD CONSTRAINT "laundry_machines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_machines" ADD CONSTRAINT "laundry_machines_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_maintenance" ADD CONSTRAINT "laundry_maintenance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_maintenance" ADD CONSTRAINT "laundry_maintenance_machine_id_laundry_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."laundry_machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_order_items" ADD CONSTRAINT "laundry_order_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_order_items" ADD CONSTRAINT "laundry_order_items_order_id_laundry_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."laundry_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_orders" ADD CONSTRAINT "laundry_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_orders" ADD CONSTRAINT "laundry_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_orders" ADD CONSTRAINT "laundry_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_orders" ADD CONSTRAINT "laundry_orders_service_id_laundry_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."laundry_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_pricing_rules" ADD CONSTRAINT "laundry_pricing_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_pricing_rules" ADD CONSTRAINT "laundry_pricing_rules_service_id_laundry_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."laundry_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_pricing_rules" ADD CONSTRAINT "laundry_pricing_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_programs" ADD CONSTRAINT "laundry_programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_programs" ADD CONSTRAINT "laundry_programs_machine_id_laundry_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."laundry_machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_services" ADD CONSTRAINT "laundry_services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_sessions" ADD CONSTRAINT "laundry_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_sessions" ADD CONSTRAINT "laundry_sessions_order_id_laundry_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."laundry_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_sessions" ADD CONSTRAINT "laundry_sessions_machine_id_laundry_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."laundry_machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_sessions" ADD CONSTRAINT "laundry_sessions_program_id_laundry_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."laundry_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_item_rates_uq" ON "laundry_item_rates" USING btree ("service_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_machines_branch_code_uq" ON "laundry_machines" USING btree ("branch_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_orders_org_number_uq" ON "laundry_orders" USING btree ("organization_id","order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_orders_token_uq" ON "laundry_orders" USING btree ("status_token");--> statement-breakpoint
CREATE INDEX "laundry_orders_branch_created_idx" ON "laundry_orders" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_pricing_rules_uq" ON "laundry_pricing_rules" USING btree ("service_id","method","branch_id") WHERE "laundry_pricing_rules"."branch_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_pricing_rules_default_uq" ON "laundry_pricing_rules" USING btree ("service_id","method") WHERE "laundry_pricing_rules"."branch_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_services_org_code_uq" ON "laundry_services" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_sessions_one_active_per_machine_uq" ON "laundry_sessions" USING btree ("machine_id") WHERE "laundry_sessions"."status" in ('reserved', 'running');--> statement-breakpoint
CREATE INDEX "laundry_sessions_order_idx" ON "laundry_sessions" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_laundry_order_id_laundry_orders_id_fk" FOREIGN KEY ("laundry_order_id") REFERENCES "public"."laundry_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_laundry_order_id_laundry_orders_id_fk" FOREIGN KEY ("laundry_order_id") REFERENCES "public"."laundry_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_laundry_order_idx" ON "payment_allocations" USING btree ("laundry_order_id");--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_target_check" CHECK (num_nonnulls("payment_allocations"."invoice_id", "payment_allocations"."laundry_order_id") = 1);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_target_check" CHECK (num_nonnulls("invoice_id", "laundry_order_id") = 1);--> statement-breakpoint
-- Self-service laundry permissions for existing built-in roles (new stores get them from SYSTEM_ROLES).
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['laundry.view','laundry.operate','laundry.manage','laundry.maintain']))
  WHERE "is_system" AND "key" IN ('owner', 'manager');--> statement-breakpoint
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['laundry.view','laundry.operate']))
  WHERE "is_system" AND "key" IN ('reception', 'cashier', 'operator');--> statement-breakpoint
INSERT INTO "roles" ("organization_id", "key", "name", "permissions", "is_system")
SELECT o."id", 'maintenance', 'Maintenance staff', ARRAY['laundry.view','laundry.maintain'], true FROM "organizations" o
WHERE o."settings_json"->>'platformInternal' IS DISTINCT FROM 'true'
  AND NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."organization_id" = o."id" AND r."key" = 'maintenance');
