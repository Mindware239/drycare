/**
 * What a shop can switch on or off. A shop's features come from its plan, and the software owner can then allow or
 * block any of them for that one shop. These keys are stored in `commercial_plans.entitlements_json`, in shop
 * overrides and inside signed desktop licenses, so never rename one.
 */
export const FEATURES = {
  labelDesigner: {
    label: "Tag designer",
    description: "Any tag size and layout, saved designs, and fine barcode adjustment. Without it, the shop prints the ready-made 38 × 30 mm taffeta tag.",
    /** Used when a plan has never had this feature set. New paid extras default to off, existing modules to on. */
    whenUnset: false,
  },
  customerMemberships: {
    label: "Customer memberships",
    description: "The shop sells membership plans to its own customers, with an automatic discount on their orders.",
    whenUnset: false,
  },
  deliveries: { label: "Pickup & delivery", description: "Pickups, deliveries, drivers and the driver's screen.", whenUnset: true },
  inventory: { label: "Stock & purchasing", description: "Consumables stock, suppliers and purchase orders.", whenUnset: true },
  laundry: { label: "Self-service laundry", description: "Machines, self-service orders, the kiosk and laundry reports.", whenUnset: true },
  marketing: { label: "Marketing campaigns", description: "Customer campaigns and message previews.", whenUnset: true },
  onlineBooking: { label: "Online pickup booking", description: "The public page where customers book a pickup.", whenUnset: true },
  wallet: { label: "Customer wallet", description: "Adding money to a customer's wallet and wallet compensation on claims. Customers can always spend a balance they already have.", whenUnset: true },
  advancedReports: { label: "Advanced reports", description: "Sales by service, garment and branch, discounts, customer and staff reports. Daily sales, money, dues and GST reports are in every plan.", whenUnset: true },
  rfid: {
    label: "RFID module",
    description: "Link RFID tags to garments, track them and bill at handover with an RFID reader. Sold and invoiced separately from the plans.",
    whenUnset: false,
  },
  whatsapp: { label: "SMS / WhatsApp updates", description: "Order updates by SMS or WhatsApp. Without it, customers get them by email if they have one. Nothing is sent by SMS or WhatsApp until a provider is connected.", whenUnset: true },
} as const;

export type FeatureKey = keyof typeof FEATURES;
export type FeatureMap = Record<FeatureKey, boolean>;
export type FeatureOverrides = Partial<Record<FeatureKey, boolean>>;

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
/** Set by a plan or a shop exception. The RFID module is not: it comes only from its own paid period. */
export const PLAN_FEATURE_KEYS = FEATURE_KEYS.filter((key) => key !== "rfid");

/** Included in every plan, so they cannot be switched off. */
export const CORE_FEATURE_LABELS = ["Counter billing & orders", "Customers", "Garment tags & tracking", "GST invoices & receipts", "Reports", "Staff & roles"] as const;

export const allFeatures = (): FeatureMap => Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])) as FeatureMap;

/** A plan's features with this shop's own exceptions on top. `null` means no plan limits apply. */
export function resolveFeatures(plan: Record<string, boolean> | null | undefined, overrides?: FeatureOverrides | null): FeatureMap {
  return Object.fromEntries(FEATURE_KEYS.map((key) => {
    const fromPlan = plan ? plan[key] ?? FEATURES[key].whenUnset : true;
    return [key, overrides?.[key] ?? fromPlan];
  })) as FeatureMap;
}

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
