CREATE TABLE "pickup_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"address_json" jsonb NOT NULL,
	"contact_phone" text,
	"scheduled_date" text NOT NULL,
	"time_slot" text NOT NULL,
	"instructions" text,
	"driver_user_id" uuid,
	"otp_hash" text,
	"collect_amount" bigint DEFAULT 0 NOT NULL,
	"bag_count" integer,
	"confirmation_method" text,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"event" text NOT NULL,
	"notes" text,
	"actor_user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"garment_id" uuid NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pickup_deliveries" ADD CONSTRAINT "pickup_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_deliveries" ADD CONSTRAINT "pickup_deliveries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_deliveries" ADD CONSTRAINT "pickup_deliveries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_deliveries" ADD CONSTRAINT "pickup_deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_pickup_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."pickup_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_pickup_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."pickup_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_garment_id_garments_id_fk" FOREIGN KEY ("garment_id") REFERENCES "public"."garments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_org_date_idx" ON "pickup_deliveries" USING btree ("organization_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "deliveries_driver_idx" ON "pickup_deliveries" USING btree ("driver_user_id","scheduled_date");--> statement-breakpoint
CREATE TRIGGER delivery_events_append_only BEFORE UPDATE OR DELETE ON delivery_events FOR EACH ROW EXECUTE FUNCTION drycare_forbid_change();
