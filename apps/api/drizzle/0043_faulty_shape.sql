CREATE TABLE "garment_exception_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"exception_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "garment_exception_events_kind_check" CHECK ("garment_exception_events"."kind" in ('event', 'internal', 'customer'))
);
--> statement-breakpoint
ALTER TABLE "garment_exceptions" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "garment_exceptions" ADD COLUMN "details_json" jsonb;--> statement-breakpoint
ALTER TABLE "garment_exceptions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "garment_exceptions" ADD COLUMN "reopened_by" uuid;--> statement-breakpoint
ALTER TABLE "garment_exceptions" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "garment_exceptions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "garment_exception_events" ADD CONSTRAINT "garment_exception_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garment_exception_events" ADD CONSTRAINT "garment_exception_events_exception_id_garment_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."garment_exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "garment_exception_events_idx" ON "garment_exception_events" USING btree ("exception_id");
--> statement-breakpoint
INSERT INTO "sync_entities" ("table_name", "entity_class") VALUES ('garment_exception_events', 'operational') ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON "garment_exception_events" FOR EACH ROW EXECUTE FUNCTION drycare_sync_capture();
