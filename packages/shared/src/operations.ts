/** Shared lists and validation for stock (inventory & purchasing) and customer claims. */
import { z } from "zod";

// ---------------------------------------------------------------- inventory

export const INVENTORY_CATEGORIES = ["Solvents & chemicals", "Detergents", "Stain removers", "Packaging & hangers", "Tags & labels", "Spare parts", "Cleaning supplies", "Other"] as const;

/** Units shown to staff. Quantities are stored as thousandths of a unit so 1.5 L or 0.25 kg are exact. */
export const INVENTORY_UNITS = { L: "litre", ml: "millilitre", kg: "kilogram", g: "gram", pcs: "piece", box: "box", pack: "pack", roll: "roll", can: "can" } as const;
export type InventoryUnit = keyof typeof INVENTORY_UNITS;
const UNIT_KEYS = Object.keys(INVENTORY_UNITS) as [InventoryUnit, ...InventoryUnit[]];

/** Expense category a purchase bill is filed under by default. */
export const INVENTORY_EXPENSE_CATEGORY: Record<(typeof INVENTORY_CATEGORIES)[number], string> = {
  "Solvents & chemicals": "Solvents & chemicals",
  Detergents: "Detergents & consumables",
  "Stain removers": "Solvents & chemicals",
  "Packaging & hangers": "Packaging & hangers",
  "Tags & labels": "Office & stationery",
  "Spare parts": "Machine maintenance",
  "Cleaning supplies": "Detergents & consumables",
  Other: "Other",
};

/** Starter list offered to a new shop ("Add common items"); prices are left for the shop to enter. */
export const STARTER_INVENTORY: { name: string; category: (typeof INVENTORY_CATEGORIES)[number]; unit: InventoryUnit; reorderLevel: number }[] = [
  { name: "Perchloroethylene (dry-cleaning solvent)", category: "Solvents & chemicals", unit: "L", reorderLevel: 20 },
  { name: "Hydrocarbon solvent", category: "Solvents & chemicals", unit: "L", reorderLevel: 20 },
  { name: "Liquid detergent", category: "Detergents", unit: "L", reorderLevel: 10 },
  { name: "Detergent powder", category: "Detergents", unit: "kg", reorderLevel: 10 },
  { name: "Fabric softener", category: "Detergents", unit: "L", reorderLevel: 5 },
  { name: "Starch", category: "Detergents", unit: "kg", reorderLevel: 2 },
  { name: "Stain remover — protein (blood, food)", category: "Stain removers", unit: "ml", reorderLevel: 500 },
  { name: "Stain remover — oil & grease", category: "Stain removers", unit: "ml", reorderLevel: 500 },
  { name: "Rust remover", category: "Stain removers", unit: "ml", reorderLevel: 250 },
  { name: "Wire hangers", category: "Packaging & hangers", unit: "pcs", reorderLevel: 200 },
  { name: "Plastic hangers", category: "Packaging & hangers", unit: "pcs", reorderLevel: 100 },
  { name: "Garment covers (poly)", category: "Packaging & hangers", unit: "pcs", reorderLevel: 200 },
  { name: "Carry bags", category: "Packaging & hangers", unit: "pcs", reorderLevel: 100 },
  { name: "Tag label rolls", category: "Tags & labels", unit: "roll", reorderLevel: 5 },
  { name: "Receipt paper rolls", category: "Tags & labels", unit: "roll", reorderLevel: 5 },
  { name: "Safety pins", category: "Tags & labels", unit: "box", reorderLevel: 2 },
];

/** Accepts a quantity with up to 3 decimals and returns thousandths of a unit. */
export const toMilli = (q: number) => Math.round(q * 1000);
export const fromMilli = (m: number) => m / 1000;
const quantity = z.number().positive("Enter a quantity").max(10_000_000).refine((q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, "Use at most 3 decimals");

export const inventoryItemSchema = z.object({
  name: z.string().trim().min(2, "Enter the item name").max(120),
  category: z.enum(INVENTORY_CATEGORIES),
  unit: z.enum(UNIT_KEYS),
  reorderLevel: z.number().min(0).max(10_000_000).default(0),
  lastUnitCost: z.number().int().min(0).max(100_000_000).optional(),
  preferredSupplierId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(300).optional(),
  isActive: z.boolean().optional(),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the supplier name").max(120),
  contactPerson: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  gstin: z.union([z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GSTIN format is not valid"), z.literal("")]).optional(),
  address: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(300).optional(),
  isActive: z.boolean().optional(),
});

/** Stock leaving or corrected outside a purchase. `count` sets the shelf quantity after a physical stock check. */
export const STOCK_MOVEMENT_KINDS = ["opening", "purchase", "use", "wastage", "count", "return"] as const;
export const STOCK_MOVEMENT_LABELS: Record<(typeof STOCK_MOVEMENT_KINDS)[number], string> = {
  opening: "Opening stock", purchase: "Received from supplier", use: "Used in work", wastage: "Wasted / damaged", count: "Stock check correction", return: "Returned to supplier",
};
export const stockMovementSchema = z.object({
  branchId: z.uuid(),
  itemId: z.uuid(),
  kind: z.enum(["opening", "use", "wastage", "count", "return"]),
  /** For `count`, the quantity actually on the shelf (may be 0); otherwise the amount moved. */
  quantity: z.number().min(0).max(10_000_000),
  unitCost: z.number().int().min(0).max(100_000_000).optional(),
  note: z.string().trim().max(300).optional(),
});

export const purchaseOrderSchema = z.object({
  branchId: z.uuid(),
  supplierId: z.uuid(),
  expectedOn: z.iso.date().optional(),
  notes: z.string().trim().max(500).optional(),
  /** false keeps it as a draft that can still be edited. */
  place: z.boolean().default(true),
  lines: z.array(z.object({
    itemId: z.uuid(),
    quantity,
    unitCost: z.number().int().min(0).max(100_000_000),
    taxBps: z.number().int().min(0).max(2800).default(0),
  })).min(1, "Add at least one item").max(100),
});

export const goodsReceiptSchema = z.object({
  lines: z.array(z.object({ lineId: z.uuid(), quantity: z.number().min(0).max(10_000_000), unitCost: z.number().int().min(0).max(100_000_000).optional() })).min(1),
  note: z.string().trim().max(300).optional(),
  /** Records the supplier's bill for this delivery under Expenses. */
  bill: z.object({
    category: z.string().trim().min(2).max(60),
    method: z.enum(["cash", "upi", "card", "bank_transfer", "other"]),
    reference: z.string().trim().max(80).optional(),
    paidFromDrawer: z.boolean().optional(),
  }).optional(),
});

export const PO_STATUS_LABELS = { draft: "Draft", ordered: "Ordered", partial: "Part received", received: "Received", cancelled: "Cancelled" } as const;

// ---------------------------------------------------------------- claims

export const CLAIM_KINDS = { damaged: "Damaged garment", lost: "Lost / missing garment", stain: "Stain not removed", shrunk: "Shrunk or stretched", colour: "Colour faded or bled", wrong_item: "Wrong garment returned", late: "Late delivery", other: "Other complaint" } as const;
export type ClaimKind = keyof typeof CLAIM_KINDS;
export const CLAIM_STATUS_LABELS = { open: "New", investigating: "Investigating", approved: "Approved — to settle", rejected: "Rejected", settled: "Settled" } as const;
export type ClaimStatus = keyof typeof CLAIM_STATUS_LABELS;
export const CLAIM_RESOLUTIONS = { wallet_credit: "Credit to customer wallet", cash: "Pay compensation", reclean: "Re-clean / repair free of charge", none: "No compensation" } as const;
export type ClaimResolution = keyof typeof CLAIM_RESOLUTIONS;

export const createClaimSchema = z.object({
  customerId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  garmentId: z.uuid().optional(),
  exceptionId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  kind: z.enum(Object.keys(CLAIM_KINDS) as [ClaimKind, ...ClaimKind[]]),
  description: z.string().trim().min(5, "Describe what the customer reported").max(1000),
  /** What the customer is asking for, in paise (optional). */
  customerAsk: z.number().int().min(0).max(100_000_000).optional(),
}).refine((v) => v.customerId || v.orderId || v.garmentId, "Choose the customer or order the claim is about");

export const claimDecisionSchema = z.object({
  outcome: z.enum(["approve", "reject"]),
  resolution: z.enum(["wallet_credit", "cash", "reclean", "none"]),
  amount: z.number().int().min(0).max(100_000_000).default(0),
  note: z.string().trim().min(5, "Explain the decision (at least 5 characters)").max(1000),
}).refine((v) => v.outcome === "reject" || v.resolution !== "none" || v.amount === 0, "Choose how the customer is compensated")
  .refine((v) => !(v.outcome === "approve" && (v.resolution === "wallet_credit" || v.resolution === "cash")) || v.amount > 0, "Enter the compensation amount");

export const claimSettleSchema = z.object({
  branchId: z.uuid().optional(),
  /** For cash compensation: how it was paid. */
  method: z.enum(["cash", "upi", "bank_transfer"]).optional(),
  reference: z.string().trim().max(80).optional(),
  paidFromDrawer: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});
