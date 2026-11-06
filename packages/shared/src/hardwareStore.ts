/**
 * The hardware and accessories Mindware sells with Drycare, and the ready-made packages. The owner edits all of this in
 * Super admin. Prices start empty: nothing shows a price until the owner has entered it. Quantities are starting suggestions.
 */
export const STORE_CATEGORIES = [
  { key: "scanning", name: "Barcode Printing & Scanning", text: "Print a barcode for every garment and read it at each step." },
  { key: "garment", name: "Garment Identification Supplies", text: "Tags that stay on the garment through cleaning." },
  { key: "pos", name: "Billing & POS Accessories", text: "Everything for the counter." },
] as const;
export type StoreCategory = (typeof STORE_CATEGORIES)[number]["key"];
export type StoreKind = "equipment" | "consumable";

export type StoreProduct = {
  key: string; name: string; category: StoreCategory; kind: StoreKind; unit: string; description: string; specs: string[]; compatibility: string;
  /** In paise. Empty until the owner sets it: the website then says Get a quote. */
  pricePaise: number | null; imageUrl: string | null; published: boolean;
};
export type StorePackage = { key: string; name: string; audience: string; includesSoftware: boolean; items: { product: string; qty: number }[]; published: boolean };
export type HardwareStore = { products: StoreProduct[]; packages: StorePackage[]; /** Freight, delivery and installation for one package in India, in paise. */ deliveryChargePaise: number };

const product = (key: string, name: string, category: StoreCategory, kind: StoreKind, unit: string, description: string, compatibility: string, specs: string[] = []): StoreProduct => ({ key, name, category, kind, unit, description, specs, compatibility, pricePaise: null, imageUrl: null, published: true });

export const DEFAULT_HARDWARE_STORE: HardwareStore = {
  deliveryChargePaise: 500000,
  products: [
    product("barcode-printer", "Barcode Printer", "scanning", "equipment", "piece", "Prints a barcode tag for every garment at the counter.", "Connected to Drycare at installation using its serial number and bill number."),
    product("barcode-scanner", "Barcode Scanner", "scanning", "equipment", "piece", "Reads garment tags at the counter, in the workshop and at delivery.", "Connected to Drycare at installation using its serial number and bill number."),
    product("barcode-labels", "Barcode Labels", "scanning", "consumable", "roll", "Label rolls for the barcode printer.", "Prints from Drycare on the barcode printer."),
    product("taffeta-rolls", "Taffeta Rolls", "garment", "consumable", "roll", "Fabric tag rolls that stay on the garment through cleaning.", "Works with Drycare’s ready-made garment tag.", ["Ready-made tag size: 38 × 30 mm"]),
    product("taffeta-stand", "External Taffeta Stand", "garment", "equipment", "piece", "Holds a taffeta roll outside the printer.", "Used with the barcode printer."),
    product("barcode-ribbon", "Barcode Ribbon", "garment", "consumable", "roll", "Ribbon matched to your barcode printer, for printing on taffeta.", "Used with the barcode printer."),
    product("bill-printer", "Bill Printer", "pos", "equipment", "piece", "Prints order receipts and invoices at the counter.", "Prints Drycare’s order receipts and invoices."),
    product("billing-rolls", "Billing Rolls", "pos", "consumable", "roll", "Paper rolls for the bill printer.", "Used with the bill printer."),
    product("cash-drawer", "Cash Drawer", "pos", "equipment", "piece", "Keeps the counter’s cash secure.", "Use it with Drycare’s cashier shifts, which track the cash in the drawer."),
  ],
  packages: [
    { key: "starter", name: "Starter Setup", audience: "Small dry-cleaning stores", includesSoftware: true, published: true, items: [{ product: "barcode-printer", qty: 1 }, { product: "barcode-scanner", qty: 1 }, { product: "barcode-labels", qty: 2 }] },
    { key: "professional", name: "Professional Setup", audience: "Growing dry-cleaning stores", includesSoftware: true, published: true, items: [{ product: "barcode-printer", qty: 1 }, { product: "barcode-scanner", qty: 1 }, { product: "barcode-labels", qty: 2 }, { product: "bill-printer", qty: 1 }, { product: "cash-drawer", qty: 1 }, { product: "billing-rolls", qty: 10 }, { product: "taffeta-rolls", qty: 2 }, { product: "barcode-ribbon", qty: 1 }] },
    { key: "complete", name: "Complete Store Setup", audience: "Full store operations", includesSoftware: true, published: true, items: [{ product: "barcode-printer", qty: 1 }, { product: "barcode-scanner", qty: 1 }, { product: "barcode-labels", qty: 5 }, { product: "bill-printer", qty: 1 }, { product: "cash-drawer", qty: 1 }, { product: "billing-rolls", qty: 25 }, { product: "taffeta-rolls", qty: 5 }, { product: "taffeta-stand", qty: 1 }, { product: "barcode-ribbon", qty: 3 }] },
  ],
};

/** The package's hardware price, or null while any item in it has no price, so a part-priced total is never shown. */
export function packagePrice(pkg: StorePackage, products: StoreProduct[]): number | null {
  let sum = 0;
  for (const line of pkg.items) {
    const p = products.find((x) => x.key === line.product);
    if (!p || p.pricePaise === null) return null;
    sum += p.pricePaise * line.qty;
  }
  return pkg.items.length ? sum : null;
}
