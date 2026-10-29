CREATE TABLE "claim_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"amount" bigint,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"claim_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid,
	"garment_id" uuid,
	"exception_id" uuid,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"customer_ask" bigint,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"approved_amount" bigint DEFAULT 0 NOT NULL,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"settled_by" uuid,
	"settled_at" timestamp with time zone,
	"wallet_entry_id" uuid,
	"expense_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_status_check" CHECK ("claims"."status" in ('open', 'investigating', 'approved', 'rejected', 'settled'))
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"reorder_level_milli" bigint DEFAULT 0 NOT NULL,
	"last_unit_cost" bigint DEFAULT 0 NOT NULL,
	"preferred_supplier_id" uuid,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity_milli" bigint NOT NULL,
	"unit_cost" bigint,
	"purchase_order_id" uuid,
	"expense_id" uuid,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_kind_check" CHECK ("inventory_movements"."kind" in ('opening', 'purchase', 'use', 'wastage', 'count', 'return'))
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity_milli" bigint NOT NULL,
	"received_milli" bigint DEFAULT 0 NOT NULL,
	"unit_cost" bigint DEFAULT 0 NOT NULL,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "purchase_order_lines_qty_check" CHECK ("purchase_order_lines"."quantity_milli" > 0 and "purchase_order_lines"."received_milli" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"po_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"expected_on" text,
	"notes" text,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"tax_total" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"ordered_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_status_check" CHECK ("purchase_orders"."status" in ('draft', 'ordered', 'partial', 'received', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"phone" text,
	"email" text,
	"gstin" text,
	"address" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_garment_id_garments_id_fk" FOREIGN KEY ("garment_id") REFERENCES "public"."garments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_exception_id_garment_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."garment_exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_wallet_entry_id_customer_wallet_entries_id_fk" FOREIGN KEY ("wallet_entry_id") REFERENCES "public"."customer_wallet_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_preferred_supplier_id_suppliers_id_fk" FOREIGN KEY ("preferred_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_events_claim_idx" ON "claim_events" USING btree ("claim_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_org_number_uq" ON "claims" USING btree ("organization_id","claim_number");--> statement-breakpoint
CREATE INDEX "claims_org_status_idx" ON "claims" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "claims_customer_idx" ON "claims" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "claims_order_idx" ON "claims" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_org_code_uq" ON "inventory_items" USING btree ("organization_id","item_code");--> statement-breakpoint
CREATE INDEX "inventory_items_org_idx" ON "inventory_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_item_idx" ON "inventory_movements" USING btree ("organization_id","item_id","branch_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_org_time_idx" ON "inventory_movements" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_po_idx" ON "purchase_order_lines" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_org_number_uq" ON "purchase_orders" USING btree ("organization_id","po_number");--> statement-breakpoint
CREATE INDEX "purchase_orders_org_status_idx" ON "purchase_orders" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "suppliers_org_idx" ON "suppliers" USING btree ("organization_id");--> statement-breakpoint
-- Stock ledger and claim timeline are append-only, like the other ledgers.
CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION drycare_forbid_change();
--> statement-breakpoint
CREATE TRIGGER claim_events_append_only BEFORE UPDATE OR DELETE ON claim_events FOR EACH ROW EXECUTE FUNCTION drycare_forbid_change();
