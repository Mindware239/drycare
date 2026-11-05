CREATE TABLE "organization_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"addon" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"price_paise" integer DEFAULT 0 NOT NULL,
	"payment_id" uuid,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfid_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"epc" text NOT NULL,
	"action" text NOT NULL,
	"garment_id" uuid,
	"notes" text,
	"actor_user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfid_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"epc" text NOT NULL,
	"status" text DEFAULT 'free' NOT NULL,
	"garment_id" uuid,
	"linked_at" timestamp with time zone,
	"retire_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfid_tags_status_check" CHECK ("rfid_tags"."status" in ('free', 'linked', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "shop_printers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"serial_number" text NOT NULL,
	"bill_number" text NOT NULL,
	"model" text NOT NULL,
	"printer_name" text,
	"connected_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sold_printers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial_number" text NOT NULL,
	"bill_number" text NOT NULL,
	"model" text NOT NULL,
	"organization_id" uuid,
	"customer_name" text,
	"sold_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"connected_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_addons" ADD CONSTRAINT "organization_addons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_addons" ADD CONSTRAINT "organization_addons_payment_id_commercial_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."commercial_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfid_events" ADD CONSTRAINT "rfid_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfid_tags" ADD CONSTRAINT "rfid_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfid_tags" ADD CONSTRAINT "rfid_tags_garment_id_garments_id_fk" FOREIGN KEY ("garment_id") REFERENCES "public"."garments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_printers" ADD CONSTRAINT "shop_printers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sold_printers" ADD CONSTRAINT "sold_printers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_addons_org_idx" ON "organization_addons" USING btree ("organization_id","addon");--> statement-breakpoint
CREATE INDEX "rfid_events_garment_idx" ON "rfid_events" USING btree ("garment_id");--> statement-breakpoint
CREATE INDEX "rfid_events_org_idx" ON "rfid_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rfid_tags_org_epc_uq" ON "rfid_tags" USING btree ("organization_id","epc");--> statement-breakpoint
CREATE UNIQUE INDEX "rfid_tags_garment_uq" ON "rfid_tags" USING btree ("garment_id") WHERE "rfid_tags"."garment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_printers_serial_uq" ON "shop_printers" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "shop_printers_org_idx" ON "shop_printers" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sold_printers_serial_uq" ON "sold_printers" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "sold_printers_org_idx" ON "sold_printers" USING btree ("organization_id");--> statement-breakpoint
-- RFID tags and connected printers are shop data, so they upload from a shop PC to its cloud copy like everything else.
INSERT INTO "sync_entities" ("table_name", "entity_class") VALUES
  ('rfid_tags','operational'),('rfid_events','ledger'),('shop_printers','master')
ON CONFLICT ("table_name") DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON "rfid_tags" FOR EACH ROW EXECUTE FUNCTION drycare_sync_capture();
--> statement-breakpoint
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON "rfid_events" FOR EACH ROW EXECUTE FUNCTION drycare_sync_capture();
--> statement-breakpoint
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON "shop_printers" FOR EACH ROW EXECUTE FUNCTION drycare_sync_capture();
