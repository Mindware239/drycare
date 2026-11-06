CREATE TABLE "desktop_rollbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_version" text NOT NULL,
	"to_version" text NOT NULL,
	"scope_json" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "product_name" text DEFAULT 'Drycare for Windows' NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "build_number" text;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "channel" text DEFAULT 'stable' NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "release_date" date;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "package_type" text DEFAULT 'exe' NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "architecture" text DEFAULT 'x64' NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "signature_status" text;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "signature_publisher" text;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "unsigned_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "restart_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "update_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "maintenance_start" integer;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "maintenance_end" integer;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "rollback_available" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "notification_message" text;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "target_json" jsonb DEFAULT '{"type":"all"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "stages_json" jsonb DEFAULT '[10,25,50,100]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "current_stage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "failure_threshold_pct" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "failure_min_count" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "recommended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "published_by" uuid;--> statement-breakpoint
ALTER TABLE "license_installations" ADD COLUMN "pc_name" text;--> statement-breakpoint
ALTER TABLE "license_installations" ADD COLUMN "os_version" text;--> statement-breakpoint
ALTER TABLE "license_installations" ADD COLUMN "arch" text;--> statement-breakpoint
ALTER TABLE "license_installations" ADD COLUMN "license_type" text;--> statement-breakpoint
ALTER TABLE "license_installations" ADD COLUMN "channel" text DEFAULT 'stable' NOT NULL;--> statement-breakpoint
ALTER TABLE "license_installations" ADD COLUMN "beta_group" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "license_installations" ADD COLUMN "update_status" text;--> statement-breakpoint
ALTER TABLE "license_installations" ADD COLUMN "update_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "license_installations" ADD COLUMN "last_success_version" text;--> statement-breakpoint
ALTER TABLE "license_installations" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "license_installations" ADD COLUMN "last_error" text;--> statement-breakpoint
-- The old words for a release's state.
UPDATE "desktop_releases" SET "status" = 'published' WHERE "status" = 'live';
--> statement-breakpoint
UPDATE "desktop_releases" SET "status" = 'paused' WHERE "status" = 'suspended';
