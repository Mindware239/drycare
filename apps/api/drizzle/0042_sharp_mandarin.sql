ALTER TABLE "transfer_batches" ADD COLUMN "expected_back_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfer_batches" ADD COLUMN "return_of_batch_id" uuid;