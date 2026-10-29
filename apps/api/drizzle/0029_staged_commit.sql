CREATE TABLE "sync_staged_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"txid" bigint NOT NULL,
	"group_size" integer NOT NULL,
	"event_json" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_outbox" DROP CONSTRAINT "sync_outbox_status_check";--> statement-breakpoint
ALTER TABLE "sync_staged_events" ADD CONSTRAINT "sync_staged_events_device_id_sync_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."sync_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_staged_events" ADD CONSTRAINT "sync_staged_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_staged_events_group_idx" ON "sync_staged_events" USING btree ("device_id","txid");--> statement-breakpoint
ALTER TABLE "sync_outbox" ADD CONSTRAINT "sync_outbox_status_check" CHECK ("sync_outbox"."status" in ('pending', 'sending', 'staged', 'synced', 'failed', 'conflict', 'skipped'));