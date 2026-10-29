CREATE TABLE "sync_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"capture_enabled" boolean DEFAULT false NOT NULL,
	"device_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"schema_version" text DEFAULT 'unknown' NOT NULL,
	"cloud_linked" boolean DEFAULT false NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_config_singleton" CHECK ("sync_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"outbox_id" uuid NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_class" text NOT NULL,
	"reason" text NOT NULL,
	"local_data" jsonb,
	"remote_data" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_entities" (
	"table_name" text PRIMARY KEY NOT NULL,
	"entity_class" text NOT NULL,
	CONSTRAINT "sync_entities_class_check" CHECK ("sync_entities"."entity_class" in ('ledger', 'financial', 'operational', 'master'))
);
--> statement-breakpoint
CREATE TABLE "sync_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"organization_id" uuid,
	"branch_id" uuid,
	"entity_table" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_class" text NOT NULL,
	"op" text NOT NULL,
	"row_data" jsonb,
	"schema_version" text NOT NULL,
	"device_id" uuid NOT NULL,
	"txid" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_outbox_op_check" CHECK ("sync_outbox"."op" in ('insert', 'update', 'delete')),
	CONSTRAINT "sync_outbox_status_check" CHECK ("sync_outbox"."status" in ('pending', 'sending', 'synced', 'failed', 'conflict'))
);
--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_outbox_id_sync_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."sync_outbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_conflicts_status_idx" ON "sync_conflicts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_conflicts_entity_idx" ON "sync_conflicts" USING btree ("entity_table","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_outbox_seq_uq" ON "sync_outbox" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_outbox_idem_uq" ON "sync_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sync_outbox_due_idx" ON "sync_outbox" USING btree ("status","next_attempt_at","seq");--> statement-breakpoint
CREATE INDEX "sync_outbox_entity_idx" ON "sync_outbox" USING btree ("entity_table","entity_id");--> statement-breakpoint
INSERT INTO "sync_config" ("id") VALUES (1) ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Every business table is classified. Tables not listed here are local-only (sessions, login tokens,
-- idempotency keys, number counters, notification queues, print jobs, platform billing, audit log).
INSERT INTO "sync_entities" ("table_name", "entity_class") VALUES
  ('payments','ledger'),('payment_allocations','ledger'),('refunds','ledger'),('credit_notes','ledger'),('invoice_items','ledger'),
  ('customer_wallet_entries','ledger'),('inventory_movements','ledger'),('garment_status_history','ledger'),('quality_inspections','ledger'),
  ('scan_events','ledger'),('delivery_events','ledger'),('claim_events','ledger'),('marketing_coupon_redemptions','ledger'),
  ('invoices','financial'),('expenses','financial'),('cashier_shifts','financial'),('orders','financial'),('order_items','financial'),
  ('laundry_orders','financial'),('purchase_orders','financial'),('purchase_order_lines','financial'),('claims','financial'),
  ('garments','operational'),('bags','operational'),('transfer_batches','operational'),('transfer_batch_bags','operational'),
  ('garment_exceptions','operational'),('pickup_deliveries','operational'),('delivery_items','operational'),('rework_records','operational'),
  ('customer_approvals','operational'),('storage_locations','operational'),('laundry_sessions','operational'),('laundry_order_items','operational'),
  ('laundry_machines','operational'),('laundry_maintenance','operational'),('staff_attendance','operational'),('staff_leaves','operational'),
  ('organizations','master'),('branches','master'),('users','master'),('roles','master'),('organization_memberships','master'),
  ('staff_profiles','master'),('customers','master'),('customer_addresses','master'),('services','master'),('garment_types','master'),
  ('price_lists','master'),('service_prices','master'),('laundry_services','master'),('laundry_pricing_rules','master'),
  ('laundry_item_rates','master'),('laundry_programs','master'),('inventory_items','master'),('suppliers','master'),
  ('marketing_campaigns','master'),('marketing_coupons','master')
ON CONFLICT ("table_name") DO NOTHING;
--> statement-breakpoint
-- Records each row change in sync_outbox inside the business transaction: if the business change rolls back,
-- so does the event; if the event cannot be written, the business change fails. Secrets and images are
-- removed from the payload. Identical re-writes (no actual change) produce no event.
CREATE OR REPLACE FUNCTION drycare_sync_capture() RETURNS trigger AS $$
DECLARE
  cfg sync_config%ROWTYPE;
  r jsonb;
  ent text;
  eid text;
BEGIN
  SELECT * INTO cfg FROM sync_config WHERE id = 1;
  IF NOT FOUND OR NOT cfg.capture_enabled THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
  r := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  r := r - ARRAY['password_hash', 'token_hash', 'otp_hash', 'status_token', 'photo_data', 'logo_data'];
  eid := r->>'id';
  SELECT entity_class INTO ent FROM sync_entities WHERE table_name = TG_TABLE_NAME;
  INSERT INTO sync_outbox (organization_id, branch_id, entity_table, entity_id, entity_class, op, row_data, schema_version, device_id, txid, idempotency_key)
  VALUES (
    CASE WHEN TG_TABLE_NAME = 'organizations' THEN (r->>'id')::uuid ELSE (r->>'organization_id')::uuid END,
    (r->>'branch_id')::uuid,
    TG_TABLE_NAME, eid, coalesce(ent, 'master'), lower(TG_OP), r, cfg.schema_version, cfg.device_id, txid_current(),
    md5(TG_TABLE_NAME || ':' || eid || ':' || TG_OP || ':' || txid_current()::text || ':' || r::text)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM sync_entities LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sync_capture ON %I', t);
    EXECUTE format('CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION drycare_sync_capture()', t);
  END LOOP;
END $$;
