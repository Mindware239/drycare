ALTER TABLE "customer_membership_plans" ADD COLUMN "free_express" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_membership_plans" ADD COLUMN "perks_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD COLUMN "free_express" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD COLUMN "perks_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD COLUMN "renewal_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "label_print_jobs" ADD COLUMN "garment_ids" jsonb;