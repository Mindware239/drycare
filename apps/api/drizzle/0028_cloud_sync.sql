CREATE TABLE "sync_applied_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"batch_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_count" integer NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"stale" integer DEFAULT 0 NOT NULL,
	"conflicts" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"retryable" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"credential_hash" text NOT NULL,
	"credential_expires_at" timestamp with time zone NOT NULL,
	"previous_credential_hash" text,
	"previous_valid_until" timestamp with time zone,
	"linked_by" uuid NOT NULL,
	"app_version" text,
	"schema_version" text,
	"last_seen_at" timestamp with time zone,
	"last_push_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_devices_status_check" CHECK ("sync_devices"."status" in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "sync_entity_state" (
	"organization_id" uuid NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" text NOT NULL,
	"last_seq" bigint NOT NULL,
	"row_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_entity_state_organization_id_entity_table_entity_id_pk" PRIMARY KEY("organization_id","entity_table","entity_id")
);
--> statement-breakpoint
CREATE TABLE "sync_link_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_code" text NOT NULL,
	"poll_token_hash" text NOT NULL,
	"device_id" uuid NOT NULL,
	"device_name" text NOT NULL,
	"shop_json" jsonb NOT NULL,
	"app_version" text,
	"schema_version" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_link_requests_status_check" CHECK ("sync_link_requests"."status" in ('pending', 'approved', 'denied', 'consumed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "sync_remote_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" text NOT NULL,
	"code" text NOT NULL,
	"reason" text NOT NULL,
	"incoming_hash" text NOT NULL,
	"existing_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_shadow_users" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_outbox" DROP CONSTRAINT "sync_outbox_op_check";--> statement-breakpoint
ALTER TABLE "sync_outbox" DROP CONSTRAINT "sync_outbox_status_check";--> statement-breakpoint
ALTER TABLE "sync_config" ADD COLUMN "cloud_state" text DEFAULT 'not_linked' NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_config" ADD COLUMN "cloud_url" text;--> statement-breakpoint
ALTER TABLE "sync_config" ADD COLUMN "linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_applied_events" ADD CONSTRAINT "sync_applied_events_device_id_sync_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."sync_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_applied_events" ADD CONSTRAINT "sync_applied_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_device_id_sync_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."sync_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_entity_state" ADD CONSTRAINT "sync_entity_state_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_remote_conflicts" ADD CONSTRAINT "sync_remote_conflicts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_shadow_users" ADD CONSTRAINT "sync_shadow_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_shadow_users" ADD CONSTRAINT "sync_shadow_users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_applied_events_device_idx" ON "sync_applied_events" USING btree ("device_id","seq");--> statement-breakpoint
CREATE INDEX "sync_batches_device_idx" ON "sync_batches" USING btree ("device_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_devices_one_active_per_org" ON "sync_devices" USING btree ("organization_id") WHERE "sync_devices"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "sync_link_requests_code_uq" ON "sync_link_requests" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "sync_remote_conflicts_org_idx" ON "sync_remote_conflicts" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "sync_outbox" ADD CONSTRAINT "sync_outbox_op_check" CHECK ("sync_outbox"."op" in ('insert', 'update', 'delete', 'snapshot'));--> statement-breakpoint
ALTER TABLE "sync_outbox" ADD CONSTRAINT "sync_outbox_status_check" CHECK ("sync_outbox"."status" in ('pending', 'sending', 'synced', 'failed', 'conflict', 'skipped'));--> statement-breakpoint
-- Change capture now starts when a PC is linked to the cloud, with a full snapshot of existing data at that moment.
-- On installs that are not linked, the earlier always-on queue is redundant: clear it and switch capture off.
-- (Queue entries only; no business record is touched.)
DELETE FROM "sync_outbox" WHERE (SELECT NOT "cloud_linked" FROM "sync_config" WHERE "id" = 1) AND "status" <> 'synced'
  AND NOT EXISTS (SELECT 1 FROM "sync_conflicts" c WHERE c."outbox_id" = "sync_outbox"."id");
--> statement-breakpoint
UPDATE "sync_config" SET "capture_enabled" = false WHERE "id" = 1 AND NOT "cloud_linked";
