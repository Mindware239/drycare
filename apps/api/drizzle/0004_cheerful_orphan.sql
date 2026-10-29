CREATE TABLE "staff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"phone" text,
	"address_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"job_title" text,
	"joining_date" date,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"monthly_salary" bigint,
	"duty_schedule_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"photo_data" "bytea",
	"photo_mime_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_membership_id_organization_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_membership_uq" ON "staff_profiles" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "staff_profiles_org_idx" ON "staff_profiles" USING btree ("organization_id");