/**
 * Self-service laundry pricing. All money is integer paise and all weight integer grams, so the
 * server (authoritative) and the checkout screen (preview) compute identical totals.
 */

export const LAUNDRY_PRICING_METHODS = ["weight", "item", "cycle", "time", "package"] as const;
export type LaundryPricingMethod = (typeof LAUNDRY_PRICING_METHODS)[number];
export const LAUNDRY_METHOD_LABELS: Record<LaundryPricingMethod, string> = {
  weight: "By weight (per kg)",
  item: "By item",
  cycle: "Per machine cycle",
  time: "By time (per minute)",
  package: "Package (fixed price)",
};

export const LAUNDRY_MACHINE_TYPES = ["washer", "dryer", "iron_station"] as const;
export type LaundryMachineType = (typeof LAUNDRY_MACHINE_TYPES)[number];
export const LAUNDRY_MACHINE_LABELS: Record<LaundryMachineType, string> = { washer: "Washing machine", dryer: "Dryer", iron_station: "Ironing station" };

export const LAUNDRY_MACHINE_STATUSES = ["available", "reserved", "running", "completed", "out_of_service", "maintenance"] as const;
export type LaundryMachineStatus = (typeof LAUNDRY_MACHINE_STATUSES)[number];

export interface LaundryRule {
  method: LaundryPricingMethod;
  unitPrice: number; // per kg | per cycle | per minute | package price
  minWeightGrams: number;
  weightIncrementGrams: number;
  minMinutes: number;
  minimumCharge: number;
  packageLabel?: string | null;
}

export interface LaundryQuoteInput {
  weightGrams?: number;
  units?: number; // cycles or minutes
  items?: { name: string; unitPrice: number; quantity: number }[];
  discount?: { type: "percent"; bps: number } | { type: "fixed"; amount: number };
  taxBps: number;
}

export interface LaundryQuoteLine { description: string; quantity: number; unitPrice: number; amount: number }
export interface LaundryQuote {
  lines: LaundryQuoteLine[];
  billableGrams: number | null;
  units: number | null;
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
}

export class LaundryPricingError extends Error {}

/** Weight rounded up to the configured increment, never below the minimum billable weight. */
export function billableWeight(grams: number, rule: Pick<LaundryRule, "minWeightGrams" | "weightIncrementGrams">) {
  if (!Number.isInteger(grams) || grams <= 0) throw new LaundryPricingError("Enter the laundry weight");
  const step = Math.max(1, rule.weightIncrementGrams);
  return Math.max(rule.minWeightGrams, Math.ceil(grams / step) * step);
}

const kg = (grams: number) => (grams / 1000).toFixed(grams % 1000 === 0 ? 0 : grams % 100 === 0 ? 1 : 2);

export function quoteLaundry(rule: LaundryRule, input: LaundryQuoteInput): LaundryQuote {
  let lines: LaundryQuoteLine[] = [];
  let billableGrams: number | null = null;
  let units: number | null = null;
  switch (rule.method) {
    case "weight": {
      billableGrams = billableWeight(input.weightGrams ?? 0, rule);
      const amount = Math.round((rule.unitPrice * billableGrams) / 1000);
      lines = [{ description: `Weight ${kg(billableGrams)} kg`, quantity: billableGrams, unitPrice: rule.unitPrice, amount }];
      break;
    }
    case "item": {
      const items = (input.items ?? []).filter((i) => i.quantity > 0);
      if (!items.length) throw new LaundryPricingError("Add at least one item");
      for (const i of items) if (!Number.isInteger(i.quantity) || i.quantity > 500) throw new LaundryPricingError(`Invalid quantity for ${i.name}`);
      lines = items.map((i) => ({ description: i.name, quantity: i.quantity, unitPrice: i.unitPrice, amount: i.unitPrice * i.quantity }));
      break;
    }
    case "cycle":
    case "time": {
      const raw = input.units ?? 0;
      if (!Number.isInteger(raw) || raw <= 0 || raw > (rule.method === "cycle" ? 20 : 600)) throw new LaundryPricingError(rule.method === "cycle" ? "Choose 1–20 cycles" : "Enter the minutes");
      units = rule.method === "time" ? Math.max(rule.minMinutes, raw) : raw;
      lines = [{ description: rule.method === "cycle" ? `${units} cycle${units === 1 ? "" : "s"}` : `${units} min`, quantity: units, unitPrice: rule.unitPrice, amount: rule.unitPrice * units }];
      break;
    }
    case "package":
      lines = [{ description: rule.packageLabel || "Package", quantity: 1, unitPrice: rule.unitPrice, amount: rule.unitPrice }];
      break;
  }
  let subtotal = lines.reduce((s, l) => s + l.amount, 0);
  if (rule.minimumCharge > subtotal) {
    lines.push({ description: "Minimum charge adjustment", quantity: 1, unitPrice: rule.minimumCharge - subtotal, amount: rule.minimumCharge - subtotal });
    subtotal = rule.minimumCharge;
  }
  let discount = 0;
  if (input.discount) {
    discount = input.discount.type === "percent" ? Math.round((subtotal * input.discount.bps) / 10_000) : input.discount.amount;
    if (!Number.isInteger(discount) || discount < 0) throw new LaundryPricingError("Invalid discount");
    if (discount > subtotal) throw new LaundryPricingError("Discount cannot exceed the amount");
  }
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * input.taxBps) / 10_000);
  return { lines, billableGrams, units, subtotal, discount, taxable, tax, total: taxable + tax };
}

/** Typical starting configuration for an Indian self-service laundromat (prices in paise). Every value is editable. */
export const DEFAULT_LAUNDRY_SERVICES: {
  code: string; name: string; machineTypes: LaundryMachineType[];
  rules: Partial<Record<LaundryPricingMethod, Partial<LaundryRule> & { unitPrice: number }>>;
  items?: [string, number][];
}[] = [
  { code: "WASH", name: "Self-service wash", machineTypes: ["washer"], rules: { weight: { unitPrice: 6000, minWeightGrams: 3000, weightIncrementGrams: 500 }, cycle: { unitPrice: 15000 } } },
  { code: "DRY", name: "Self-service dry", machineTypes: ["dryer"], rules: { cycle: { unitPrice: 10000 }, time: { unitPrice: 300, minMinutes: 20 } } },
  { code: "IRON", name: "Self-service ironing", machineTypes: ["iron_station"], rules: { item: { unitPrice: 0 }, time: { unitPrice: 200, minMinutes: 15 } }, items: [["Shirt / top", 1000], ["Trousers / jeans", 1000], ["Saree", 3000], ["Bedsheet", 2000]] },
  { code: "WD", name: "Wash + dry", machineTypes: ["washer", "dryer"], rules: { weight: { unitPrice: 9000, minWeightGrams: 3000, weightIncrementGrams: 500 }, package: { unitPrice: 22000, packageLabel: "Wash + dry (one load up to 7 kg)" } } },
  { code: "WI", name: "Wash + iron", machineTypes: ["washer", "iron_station"], rules: { weight: { unitPrice: 10000, minWeightGrams: 3000, weightIncrementGrams: 500 }, item: { unitPrice: 0 } }, items: [["Shirt / top", 2500], ["Trousers / jeans", 2500], ["T-shirt", 2000], ["Bedsheet", 4000]] },
  { code: "WDI", name: "Wash + dry + iron", machineTypes: ["washer", "dryer", "iron_station"], rules: { weight: { unitPrice: 12000, minWeightGrams: 3000, weightIncrementGrams: 500 }, package: { unitPrice: 35000, packageLabel: "Full service (one load up to 7 kg)" } } },
];
