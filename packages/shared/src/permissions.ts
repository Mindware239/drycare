/**
 * Action-level permissions (SRS §12). Roles are bundles of these keys; the backend checks keys,
 * never role names, so tenants can define custom roles later without code changes.
 */
export const PERMISSIONS = {
  "org.manage": "Manage organization settings",
  "branches.manage": "Create and edit branches",
  "staff.manage": "Manage staff accounts and roles",
  "customers.read": "View customer records",
  "customers.write": "Create and edit customers",
  "customers.merge": "Merge duplicate customers",
  "catalogue.manage": "Manage garment types, services and prices",
  "prices.override": "Override item prices",
  "discounts.approve": "Approve discounts above the counter limit",
  "orders.read": "View orders",
  "orders.create": "Create orders",
  "orders.edit": "Edit permitted order fields",
  "orders.cancel": "Cancel orders",
  "orders.release_with_due": "Hand over garments with an outstanding balance",
  "garments.process": "Move garments through processing stages",
  "garments.override": "Resolve garment exceptions and override workflow",
  "qc.approve": "Pass or fail quality inspections",
  "payments.collect": "Collect payments",
  "payments.refund": "Approve and issue refunds",
  "shifts.manage": "Open and close cashier shifts",
  "deliveries.manage": "Schedule and dispatch pickups and deliveries",
  "deliveries.drive": "See and complete own assigned pickups and deliveries",
  "complaints.manage": "Log and investigate complaints and damage claims",
  "inventory.manage": "Manage inventory and suppliers",
  "expenses.manage": "Record expenses",
  "reports.view": "View operational reports",
  "reports.financial": "View financial reports",
  "audit.view": "View audit logs",
  "laundry.view": "View self-service laundry machines and orders",
  "laundry.operate": "Run self-service laundry: take orders and payments, start and finish machines",
  "laundry.manage": "Configure self-service services, pricing and machines",
  "laundry.maintain": "Record machine maintenance and take machines out of service",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export interface RoleDefinition {
  key: string;
  name: string;
  permissions: Permission[];
}

export const SYSTEM_ROLES: RoleDefinition[] = [
  { key: "owner", name: "Owner", permissions: ALL_PERMISSIONS },
  {
    key: "manager",
    name: "Store manager",
    permissions: ALL_PERMISSIONS.filter((p) => !["org.manage", "customers.merge"].includes(p)),
  },
  {
    key: "reception",
    name: "Reception / counter",
    permissions: ["customers.read", "customers.write", "orders.read", "orders.create", "payments.collect", "garments.process", "reports.view", "deliveries.manage", "complaints.manage", "laundry.view", "laundry.operate"],
  },
  { key: "operator", name: "Cleaning operator", permissions: ["orders.read", "garments.process", "laundry.view", "laundry.operate"] },
  { key: "inspector", name: "Quality inspector", permissions: ["orders.read", "garments.process", "qc.approve"] },
  { key: "packer", name: "Packing staff", permissions: ["orders.read", "garments.process"] },
  { key: "cashier", name: "Cashier", permissions: ["customers.read", "orders.read", "payments.collect", "shifts.manage", "laundry.view", "laundry.operate"] },
  { key: "maintenance", name: "Maintenance staff", permissions: ["laundry.view", "laundry.maintain"] },
  { key: "kiosk", name: "Kiosk tablet (self-service)", permissions: ["laundry.view", "laundry.operate"] },
  { key: "driver", name: "Delivery agent", permissions: ["deliveries.drive", "payments.collect"] },
  {
    key: "accountant",
    name: "Accountant",
    permissions: ["customers.read", "orders.read", "reports.view", "reports.financial", "expenses.manage", "audit.view"],
  },
];
