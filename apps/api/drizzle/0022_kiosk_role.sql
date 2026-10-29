-- Kiosk tablet role for existing stores (new stores get it from SYSTEM_ROLES): self-service orders only.
INSERT INTO "roles" ("organization_id", "key", "name", "permissions", "is_system")
SELECT o."id", 'kiosk', 'Kiosk tablet (self-service)', ARRAY['laundry.view','laundry.operate'], true FROM "organizations" o
WHERE o."settings_json"->>'platformInternal' IS DISTINCT FROM 'true'
  AND NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."organization_id" = o."id" AND r."key" = 'kiosk');
