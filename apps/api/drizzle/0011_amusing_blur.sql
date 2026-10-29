ALTER TABLE "customers" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "category" text DEFAULT 'General' NOT NULL;--> statement-breakpoint
UPDATE "services" SET "category" = CASE "service_code"
	WHEN 'DC' THEN 'Dry Clean'
	WHEN 'WI' THEN 'Laundry'
	WHEN 'SI' THEN 'Steam Press'
	WHEN 'ST' THEN 'Stain Treatment'
	ELSE 'General'
END;