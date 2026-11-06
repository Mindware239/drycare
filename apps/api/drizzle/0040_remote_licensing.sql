CREATE TABLE "desktop_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"mandatory" boolean DEFAULT false NOT NULL,
	"min_supported_version" text,
	"rollout_percent" integer DEFAULT 100 NOT NULL,
	"file_name" text,
	"sha512" text,
	"size_bytes" bigint,
	"published_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_update_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"from_version" text,
	"to_version" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_usage_daily" (
	"organization_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "feature_usage_daily_organization_id_feature_day_pk" PRIMARY KEY("organization_id","feature","day")
);
--> statement-breakpoint
CREATE TABLE "license_installations" (
	"installation_id" uuid PRIMARY KEY NOT NULL,
	"license_id" uuid NOT NULL,
	"organization_id" uuid,
	"customer_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"app_version" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "license_sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"license_id" uuid NOT NULL,
	"result" text NOT NULL,
	"app_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desktop_licenses" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_licenses" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "desktop_licenses" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "desktop_licenses" ADD COLUMN "entitlement_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_licenses" ADD COLUMN "bought_features_json" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "desktop_releases_version_uq" ON "desktop_releases" USING btree ("version");--> statement-breakpoint
CREATE INDEX "desktop_update_reports_version_idx" ON "desktop_update_reports" USING btree ("to_version","created_at");--> statement-breakpoint
CREATE INDEX "desktop_update_reports_device_idx" ON "desktop_update_reports" USING btree ("installation_id","created_at");--> statement-breakpoint
CREATE INDEX "feature_usage_daily_day_idx" ON "feature_usage_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "license_installations_license_idx" ON "license_installations" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "license_installations_org_idx" ON "license_installations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "license_sync_events_license_idx" ON "license_sync_events" USING btree ("license_id","created_at");--> statement-breakpoint
CREATE INDEX "license_sync_events_device_idx" ON "license_sync_events" USING btree ("installation_id","created_at");