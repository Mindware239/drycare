ALTER TABLE "expenses" ADD COLUMN "vendor" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_shift_id_cashier_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."cashier_shifts"("id") ON DELETE no action ON UPDATE no action;