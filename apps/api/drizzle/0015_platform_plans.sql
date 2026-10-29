INSERT INTO "commercial_plans"
  ("code", "name", "description", "price_paise", "currency", "interval", "gst_inclusive", "trial_eligible", "device_limit", "branch_limit", "entitlements_json", "published", "sort_order")
VALUES
  ('starter', 'Starter', 'Essential order and counter operations for one shop.', 0, 'INR', 'month', false, true, 1, 1,
   '{"pos":true,"orders":true,"customers":true,"garment_tracking":true,"billing":true,"basic_reports":true}', false, 1),
  ('growth', 'Growth', 'Advanced workflows for growing multi-outlet businesses.', 0, 'INR', 'month', false, true, 5, 3,
   '{"pos":true,"orders":true,"customers":true,"garment_tracking":true,"billing":true,"advanced_reports":true,"inventory":true,"deliveries":true,"staff_roles":true}', false, 2),
  ('enterprise', 'Enterprise', 'Contract-defined access and controls for larger operators.', 0, 'INR', 'month', false, false, 25, 100,
   '{"pos":true,"orders":true,"customers":true,"garment_tracking":true,"billing":true,"advanced_reports":true,"inventory":true,"deliveries":true,"staff_roles":true,"organization_controls":true}', false, 3)
ON CONFLICT ("code") DO NOTHING;
