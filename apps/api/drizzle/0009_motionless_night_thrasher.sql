CREATE TABLE "customer_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"approval_trigger" text NOT NULL,
	"reason" text NOT NULL,
	"additional_charge" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"method" text,
	"customer_name" text,
	"witnessed_by" uuid,
	"notes" text,
	"otp_hash" text,
	"otp_expires_at" timestamp with time zone,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_approvals_trigger_check" CHECK ("customer_approvals"."approval_trigger" in ('additional_charge', 'special_care')),
	CONSTRAINT "customer_approvals_status_check" CHECK ("customer_approvals"."status" in ('pending', 'approved')),
	CONSTRAINT "customer_approvals_method_check" CHECK ("customer_approvals"."method" is null or "customer_approvals"."method" in ('verbal', 'signature', 'email_otp', 'sms_otp'))
);
--> statement-breakpoint
ALTER TABLE "customer_approvals" ADD CONSTRAINT "customer_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_approvals" ADD CONSTRAINT "customer_approvals_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_approvals" ADD CONSTRAINT "customer_approvals_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_approvals" ADD CONSTRAINT "customer_approvals_witnessed_by_users_id_fk" FOREIGN KEY ("witnessed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_approvals" ADD CONSTRAINT "customer_approvals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_approvals_item_trigger_uq" ON "customer_approvals" USING btree ("order_item_id","approval_trigger");--> statement-breakpoint
CREATE INDEX "customer_approvals_order_status_idx" ON "customer_approvals" USING btree ("organization_id","order_id","status");