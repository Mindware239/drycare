CREATE TABLE "bags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"bag_code" text NOT NULL,
	"expected_count" integer NOT NULL,
	"location" text DEFAULT 'shop_counter' NOT NULL,
	"label_print_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"credit_note_number" text NOT NULL,
	"kind" text DEFAULT 'collection_discount' NOT NULL,
	"discount_type" text NOT NULL,
	"discount_value" integer NOT NULL,
	"taxable_amount" bigint DEFAULT 0 NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_type_check" CHECK ("credit_notes"."discount_type" in ('percent', 'fixed'))
);
--> statement-breakpoint
CREATE TABLE "garment_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"garment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"batch_id" uuid,
	"kind" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_by" uuid NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "garment_exceptions_kind_check" CHECK ("garment_exceptions"."kind" in ('missing', 'damaged', 'wrong_tag', 'delayed'))
);
--> statement-breakpoint
CREATE TABLE "label_print_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"label_count" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"requested_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_print_jobs_status_check" CHECK ("label_print_jobs"."status" in ('pending', 'printed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid,
	"step" text NOT NULL,
	"scanned_code" text NOT NULL,
	"bag_id" uuid,
	"garment_id" uuid,
	"result" text NOT NULL,
	"scanned_by" uuid NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_batch_bags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"bag_id" uuid NOT NULL,
	"expected_count" integer NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_number" text NOT NULL,
	"direction" text NOT NULL,
	"facility_name" text NOT NULL,
	"transport_reference" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"dispatched_by" uuid,
	"dispatched_at" timestamp with time zone,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_batches_direction_check" CHECK ("transfer_batches"."direction" in ('to_facility', 'to_shop')),
	CONSTRAINT "transfer_batches_status_check" CHECK ("transfer_batches"."status" in ('draft', 'dispatched', 'received', 'received_with_exceptions'))
);
--> statement-breakpoint
ALTER TABLE "garments" ADD COLUMN "bag_id" uuid;--> statement-breakpoint
ALTER TABLE "garments" ADD COLUMN "location" text DEFAULT 'shop_counter' NOT NULL;--> statement-breakpoint
ALTER TABLE "bags" ADD CONSTRAINT "bags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bags" ADD CONSTRAINT "bags_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bags" ADD CONSTRAINT "bags_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garment_exceptions" ADD CONSTRAINT "garment_exceptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garment_exceptions" ADD CONSTRAINT "garment_exceptions_garment_id_garments_id_fk" FOREIGN KEY ("garment_id") REFERENCES "public"."garments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garment_exceptions" ADD CONSTRAINT "garment_exceptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garment_exceptions" ADD CONSTRAINT "garment_exceptions_batch_id_transfer_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."transfer_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_print_jobs" ADD CONSTRAINT "label_print_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_print_jobs" ADD CONSTRAINT "label_print_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_batch_id_transfer_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."transfer_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_batch_bags" ADD CONSTRAINT "transfer_batch_bags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_batch_bags" ADD CONSTRAINT "transfer_batch_bags_batch_id_transfer_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."transfer_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_batch_bags" ADD CONSTRAINT "transfer_batch_bags_bag_id_bags_id_fk" FOREIGN KEY ("bag_id") REFERENCES "public"."bags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_batches" ADD CONSTRAINT "transfer_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_batches" ADD CONSTRAINT "transfer_batches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bags_org_code_uq" ON "bags" USING btree ("organization_id","bag_code");--> statement-breakpoint
CREATE INDEX "bags_order_idx" ON "bags" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_org_number_uq" ON "credit_notes" USING btree ("organization_id","credit_note_number");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_one_discount_uq" ON "credit_notes" USING btree ("invoice_id") WHERE "credit_notes"."kind" = 'collection_discount' and "credit_notes"."status" = 'issued';--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "garment_exceptions_org_status_idx" ON "garment_exceptions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "garment_exceptions_order_idx" ON "garment_exceptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "label_print_jobs_order_idx" ON "label_print_jobs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "scan_events_batch_idx" ON "scan_events" USING btree ("batch_id","step");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_events_verified_uq" ON "scan_events" USING btree ("batch_id","step","garment_id") WHERE "scan_events"."result" = 'verified';--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_batch_bags_uq" ON "transfer_batch_bags" USING btree ("batch_id","bag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_batches_org_number_uq" ON "transfer_batches" USING btree ("organization_id","batch_number");--> statement-breakpoint
CREATE INDEX "transfer_batches_org_status_idx" ON "transfer_batches" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "garments" ADD CONSTRAINT "garments_bag_id_bags_id_fk" FOREIGN KEY ("bag_id") REFERENCES "public"."bags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "garments_bag_idx" ON "garments" USING btree ("bag_id");--> statement-breakpoint
-- Backfill: every existing order gets one bag holding all of its garments (additive; nothing is removed).
INSERT INTO "bags" ("organization_id", "branch_id", "order_id", "bag_code", "expected_count", "created_by")
SELECT o."organization_id", o."branch_id", o."id", o."order_number" || '-B1',
  (SELECT count(*) FROM "garments" g WHERE g."order_id" = o."id" AND g."current_status" <> 'cancelled'), o."created_by"
FROM "orders" o WHERE NOT EXISTS (SELECT 1 FROM "bags" b WHERE b."order_id" = o."id");--> statement-breakpoint
UPDATE "garments" g SET "bag_id" = b."id" FROM "bags" b WHERE b."order_id" = g."order_id" AND g."bag_id" IS NULL;--> statement-breakpoint
UPDATE "garments" SET "location" = 'collected' WHERE "current_status" = 'delivered';--> statement-breakpoint
UPDATE "garments" SET "location" = 'shop_storage' WHERE "current_status" IN ('ready', 'packing') AND "location" = 'shop_counter';
