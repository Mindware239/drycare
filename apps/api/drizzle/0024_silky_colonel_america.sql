CREATE TABLE "desktop_licenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"customer_name" text NOT NULL,
	"plan" text NOT NULL,
	"installation_ids_json" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"license_key" text NOT NULL,
	"note" text,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desktop_licenses" ADD CONSTRAINT "desktop_licenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desktop_licenses_org_idx" ON "desktop_licenses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "desktop_licenses_issued_idx" ON "desktop_licenses" USING btree ("issued_at");