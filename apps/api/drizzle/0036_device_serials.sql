ALTER TABLE "shop_printers" ADD COLUMN "device_type" text DEFAULT 'printer' NOT NULL;--> statement-breakpoint
ALTER TABLE "sold_printers" ADD COLUMN "device_type" text DEFAULT 'printer' NOT NULL;