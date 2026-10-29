CREATE TABLE "staff_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"status" text NOT NULL,
	"check_in" text,
	"check_out" text,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_attendance_status_check" CHECK ("staff_attendance"."status" in ('present', 'absent')),
	CONSTRAINT "staff_attendance_times_check" CHECK ("staff_attendance"."status" = 'present' or ("staff_attendance"."check_in" is null and "staff_attendance"."check_out" is null))
);
--> statement-breakpoint
CREATE TABLE "staff_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_leaves_dates_check" CHECK ("staff_leaves"."start_date" <= "staff_leaves"."end_date")
);
--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_membership_id_organization_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_membership_id_organization_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_attendance_day_uq" ON "staff_attendance" USING btree ("organization_id","membership_id","branch_id","work_date");--> statement-breakpoint
CREATE INDEX "staff_attendance_branch_date_idx" ON "staff_attendance" USING btree ("organization_id","branch_id","work_date");--> statement-breakpoint
CREATE INDEX "staff_leaves_org_dates_idx" ON "staff_leaves" USING btree ("organization_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "staff_leaves_membership_branch_idx" ON "staff_leaves" USING btree ("membership_id","branch_id");