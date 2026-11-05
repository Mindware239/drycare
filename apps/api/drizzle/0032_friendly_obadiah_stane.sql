ALTER TABLE "bags" ADD COLUMN "scan_code" text;--> statement-breakpoint
ALTER TABLE "garments" ADD COLUMN "scan_code" text;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT organization_id FROM "bags"
      UNION ALL
      SELECT organization_id FROM "garments"
    ) AS records
    GROUP BY organization_id
    HAVING count(*) > 999999
  ) THEN
    RAISE EXCEPTION 'A shop has more than 999,999 existing garment and bag tags; six-digit barcode migration cannot continue.';
  END IF;
END $$;--> statement-breakpoint
WITH numbered AS (
  SELECT kind, id, organization_id,
         row_number() OVER (PARTITION BY organization_id ORDER BY created_at, kind, id) AS scan_number
  FROM (
    SELECT 'bag'::text AS kind, id, organization_id, created_at FROM "bags"
    UNION ALL
    SELECT 'garment'::text AS kind, id, organization_id, created_at FROM "garments"
  ) AS records
)
UPDATE "bags" AS b
SET scan_code = lpad(n.scan_number::text, 6, '0')
FROM numbered AS n
WHERE n.kind = 'bag' AND n.id = b.id;--> statement-breakpoint
WITH numbered AS (
  SELECT kind, id, organization_id,
         row_number() OVER (PARTITION BY organization_id ORDER BY created_at, kind, id) AS scan_number
  FROM (
    SELECT 'bag'::text AS kind, id, organization_id, created_at FROM "bags"
    UNION ALL
    SELECT 'garment'::text AS kind, id, organization_id, created_at FROM "garments"
  ) AS records
)
UPDATE "garments" AS g
SET scan_code = lpad(n.scan_number::text, 6, '0')
FROM numbered AS n
WHERE n.kind = 'garment' AND n.id = g.id;--> statement-breakpoint
ALTER TABLE "bags" ALTER COLUMN "scan_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "garments" ALTER COLUMN "scan_code" SET NOT NULL;--> statement-breakpoint
INSERT INTO "number_sequences" ("organization_id", "scope", "next_value")
SELECT organization_id, 'tag_scan', coalesce(max(scan_code::integer), 0) + 1
FROM (
  SELECT organization_id, scan_code FROM "bags"
  UNION ALL
  SELECT organization_id, scan_code FROM "garments"
) AS records
GROUP BY organization_id
ON CONFLICT ("organization_id", "scope") DO UPDATE
SET "next_value" = greatest("number_sequences"."next_value", excluded."next_value");--> statement-breakpoint
CREATE UNIQUE INDEX "bags_org_scan_code_uq" ON "bags" USING btree ("organization_id","scan_code");--> statement-breakpoint
CREATE UNIQUE INDEX "garments_org_scan_code_uq" ON "garments" USING btree ("organization_id","scan_code");