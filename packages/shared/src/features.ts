/**
 * What a shop can switch on or off. A shop's features come from its plan, and the software owner can then allow or
 * block any of them for that one shop. These keys are stored in `commercial_plans.entitlements_json`, in shop
 * overrides and inside signed desktop licenses, so never rename one.
 */
export const FEATURE_CATEGORIES = ["Core", "Garments", "Operations", "Customers", "Money", "Reports", "Administration"] as const;
export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];
export type FeatureDef = {
  label: string;
  description: string;
  category: FeatureCategory;
  /** Used when a plan has never had this feature set. New paid extras default to off, existing modules to on. */
  whenUnset: boolean;
  /** This feature cannot work without these. */
  dependsOn?: readonly string[];
};

const DEFS = {
  dashboard: { label: "Dashboard", description: "The day's figures and shortcuts on the first screen.", category: "Core", whenUnset: true },
  orders: { label: "Orders & new order", description: "Taking orders at the counter and managing them.", category: "Core", whenUnset: true, dependsOn: ["customers", "catalogue", "cashier"] },
  customers: { label: "Customers", description: "Customer records and history.", category: "Core", whenUnset: true },
  catalogue: { label: "Services & prices", description: "The garments, services and price lists orders are priced from.", category: "Core", whenUnset: true },
  cashier: { label: "Cashier & shifts", description: "Opening and closing cash shifts. Payments at the counter are recorded against them.", category: "Core", whenUnset: true },
  invoices: { label: "Invoices & receipts", description: "Viewing, printing and sending customer invoices.", category: "Core", whenUnset: true, dependsOn: ["orders"] },
  garmentTags: { label: "Garment tags", description: "Printing garment and bag tags.", category: "Core", whenUnset: true, dependsOn: ["orders"] },
  scanStation: { label: "Scan station", description: "Moving garments between stages by scanning their tags.", category: "Core", whenUnset: true, dependsOn: ["orders"] },
  labelDesigner: { label: "Tag designer", description: "Any tag size and layout, saved designs, and fine barcode adjustment. Without it, the shop prints the ready-made 38 × 30 mm taffeta tag.", category: "Garments", whenUnset: false },
  productionBoard: { label: "Production board", description: "The board showing every garment by stage, and overdue work. Garments can still be moved from the scan station without it.", category: "Garments", whenUnset: true },
  tagTracking: { label: "Tag tracking", description: "The complete history of any tag: every scan, stage and person.", category: "Garments", whenUnset: true },
  transfers: { label: "Facility transfers", description: "Sending garments between a store and a central plant, with checks at each end.", category: "Garments", whenUnset: true },
  garmentExceptions: { label: "Garment exceptions", description: "Recording missing, damaged and rework garments, and following them up.", category: "Garments", whenUnset: true },
  cloudSync: { label: "Cloud sync for PCs", description: "Keeps a copy of a PC shop's data online, to view from anywhere.", category: "Administration", whenUnset: false },
  rfid: { label: "RFID module", description: "Link RFID tags to garments, track them and bill at handover with an RFID reader. Sold and invoiced separately from the plans.", category: "Garments", whenUnset: false },
  deliveries: { label: "Pickup & delivery", description: "Pickups, deliveries, drivers and the driver's screen.", category: "Operations", whenUnset: true },
  laundry: { label: "Self-service laundry", description: "Machines, self-service orders, the kiosk and laundry reports.", category: "Operations", whenUnset: true },
  inventory: { label: "Stock & purchasing", description: "Consumables stock, suppliers and purchase orders.", category: "Operations", whenUnset: true },
  customerMemberships: { label: "Customer memberships", description: "The shop sells membership plans to its own customers, with an automatic discount on their orders.", category: "Customers", whenUnset: false },
  claims: { label: "Claims & complaints", description: "Recording customer complaints and claims, deciding them and settling them.", category: "Customers", whenUnset: true },
  marketing: { label: "Marketing campaigns", description: "Customer campaigns and message previews.", category: "Customers", whenUnset: true },
  onlineBooking: { label: "Online pickup booking", description: "The public page where customers book a pickup.", category: "Customers", whenUnset: true },
  whatsapp: { label: "SMS / WhatsApp updates", description: "Order updates by SMS or WhatsApp. Without it, customers get them by email if they have one. Nothing is sent by SMS or WhatsApp until a provider is connected.", category: "Customers", whenUnset: true },
  wallet: { label: "Customer wallet", description: "Adding money to a customer's wallet and wallet compensation on claims. Customers can always spend a balance they already have.", category: "Money", whenUnset: true },
  expenses: { label: "Expenses", description: "Recording shop expenses, including money paid from the cash drawer.", category: "Money", whenUnset: true },
  reports: { label: "Reports", description: "The reports centre: sales, money, dues and tax reports. The dashboard stays available without it.", category: "Reports", whenUnset: true },
  advancedReports: { label: "Advanced reports", description: "Sales by service, garment and branch, discounts, customer and staff reports. Daily sales, money, dues and GST reports are in every plan.", category: "Reports", whenUnset: true, dependsOn: ["reports"] },
  staffManagement: { label: "Staff & roles", description: "Adding staff, attendance and leave. Existing staff can still sign in without it.", category: "Administration", whenUnset: true },
  integrations: { label: "Integrations & notifications", description: "The screen showing which outside services and notifications are connected.", category: "Administration", whenUnset: true },
  auditLog: { label: "Audit log", description: "The record of who changed what in the shop.", category: "Administration", whenUnset: true },
} as const;

export type FeatureKey = keyof typeof DEFS;
export const FEATURES: Record<FeatureKey, FeatureDef> = DEFS;
export type FeatureMap = Record<FeatureKey, boolean>;
export type FeatureOverrides = Partial<Record<FeatureKey, boolean>>;
/** When a shop's exception ends, as an ISO date and time. An exception with no entry here lasts until it is changed. */
export type FeatureOverrideExpiry = Partial<Record<FeatureKey, string>>;

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
/** Set by a plan or a shop exception. The RFID module is not: it comes only from its own paid period. */
export const PLAN_FEATURE_KEYS = FEATURE_KEYS.filter((key) => key !== "rfid");

/** The software's own workings, not sold features: a shop must always be able to sign in, stay secure and pay. */
export const CORE_FEATURE_LABELS = ["Sign-in & security", "License checks", "Business settings", "Plan & billing"] as const;

export const allFeatures = (): FeatureMap => Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])) as FeatureMap;

export type FeatureRules = { expiry?: FeatureOverrideExpiry | null; globallyOff?: readonly string[]; now?: number };

/** An exception still in force: one past its end date no longer counts. */
export function activeOverride(key: FeatureKey, overrides: FeatureOverrides | null | undefined, rules: FeatureRules = {}): boolean | undefined {
  const value = overrides?.[key];
  if (value === undefined) return undefined;
  const until = rules.expiry?.[key];
  return until && Date.parse(until) <= (rules.now ?? Date.now()) ? undefined : value;
}

/**
 * What a shop may use. In order: the plan, then this shop's exception, then what each feature depends on, and last the
 * software owner's global switch, which nothing overrides. `null` for the plan means no plan limits apply.
 */
export function resolveFeatures(plan: Record<string, boolean> | null | undefined, overrides?: FeatureOverrides | null, rules: FeatureRules = {}): FeatureMap {
  const map = Object.fromEntries(FEATURE_KEYS.map((key) => {
    const fromPlan = plan ? plan[key] ?? FEATURES[key].whenUnset : true;
    return [key, activeOverride(key, overrides, rules) ?? fromPlan];
  })) as FeatureMap;
  for (const key of FEATURE_KEYS) if (FEATURES[key].dependsOn?.some((dep) => !map[dep as FeatureKey])) map[key] = false;
  for (const key of rules.globallyOff ?? []) if (key in map) map[key as FeatureKey] = false;
  return map;
}

/** Why a shop cannot use a feature, so the screen can say the right thing. */
export type FeatureLock = { reason: "plan" | "admin" | "global" | "license" | "addon"; plans: string[]; currentPlan: string | null; message: string | null; label?: string; description?: string };

/** What a plan is frozen to when a shop buys it. Later edits to the plan reach new customers, not this shop. */
export function planSnapshot(entitlements: Record<string, boolean> | null | undefined): Record<string, boolean> {
  return { ...(entitlements ?? {}), ...resolveFeatures(entitlements ?? {}) };
}

/**
 * Every screen in the shop's menu, and what controls it. The test suite compares this with the real menu, so a new screen
 * cannot be added without deciding this. A screen with no feature is in every plan, for the reason given.
 */
export const APP_MODULES: { path: string; label: string; feature?: FeatureKey; why?: string }[] = [
  { path: "/dashboard", label: "Dashboard", feature: "dashboard" },
  { path: "/pos", label: "New order", feature: "orders" },
  { path: "/orders", label: "Orders", feature: "orders" },
  { path: "/customers", label: "Customers", feature: "customers" },
  { path: "/production", label: "Production board", feature: "productionBoard" },
  { path: "/scan", label: "Scan station", feature: "scanStation" },
  { path: "/tags", label: "Tag tracking", feature: "tagTracking" },
  { path: "/rfid", label: "RFID", feature: "rfid" },
  { path: "/transfers", label: "Facility transfers", feature: "transfers" },
  { path: "/exceptions", label: "Garment exceptions", feature: "garmentExceptions" },
  { path: "/laundry", label: "Machines & live status", feature: "laundry" },
  { path: "/laundry/new", label: "New self-service order", feature: "laundry" },
  { path: "/laundry/orders", label: "Self-service orders", feature: "laundry" },
  { path: "/laundry/reports", label: "Laundry reports", feature: "laundry" },
  { path: "/laundry/settings", label: "Laundry setup & pricing", feature: "laundry" },
  { path: "/deliveries", label: "Pickups & deliveries", feature: "deliveries" },
  { path: "/driver", label: "My deliveries", feature: "deliveries" },
  { path: "/cashier", label: "Cashier & shifts", feature: "cashier" },
  { path: "/expenses", label: "Expenses", feature: "expenses" },
  { path: "/inventory", label: "Stock & purchasing", feature: "inventory" },
  { path: "/reports", label: "Reports", feature: "reports" },
  { path: "/memberships", label: "Memberships", feature: "customerMemberships" },
  { path: "/claims", label: "Claims & complaints", feature: "claims" },
  { path: "/campaigns", label: "Marketing campaigns", feature: "marketing" },
  { path: "/catalogue", label: "Services & prices", feature: "catalogue" },
  { path: "/integrations", label: "Integrations & notifications", feature: "integrations" },
  { path: "/staff", label: "Staff & roles", feature: "staffManagement" },
  { path: "/settings", label: "Business settings", why: "the shop's name, tax details and bills are set here" },
  { path: "/billing", label: "Plan & billing", why: "a shop must always be able to pay" },
  { path: "/audit", label: "Audit & messages", feature: "auditLog" },
];

/** GST included in a price: the tax is taken out of the amount, rounded to the paisa. */
export function splitInclusiveTax(amount: number, taxBps: number) {
  const taxable = Math.round((amount * 10000) / (10000 + taxBps));
  return { taxable, tax: amount - taxable };
}

/** The only tag size a shop without the tag designer can print. */
export const BASIC_TAG_SIZE = { widthMm: 38, heightMm: 30 } as const;

/**
 * Whether the software owner allows this Windows printer. An empty list means no restriction has been set.
 * Each entry is a piece of the model name, matched against both the printer's name and its driver.
 */
export function isPrinterApproved(printer: { name: string; driver?: string | null }, approved: readonly string[]) {
  if (!approved.length) return true;
  const haystack = `${printer.name} ${printer.driver ?? ""}`.toLowerCase();
  return approved.some((model) => model.trim() !== "" && haystack.includes(model.trim().toLowerCase()));
}
