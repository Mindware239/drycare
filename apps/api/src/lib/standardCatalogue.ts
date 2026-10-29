import { and, eq, isNull } from "drizzle-orm";
import { DEFAULT_TEMPLATE, type GarmentStage } from "@drycare/shared";
import { schema, type Tx } from "../db/client";

/** Standard services every new store starts with. Codes are stable identifiers used below. */
export const STANDARD_SERVICES: { code: string; name: string; category: string; unit: string; stages: GarmentStage[] }[] = [
  { code: "DC", name: "Dry clean", category: "Dry Clean", unit: "per_piece", stages: DEFAULT_TEMPLATE },
  { code: "WI", name: "Wash & iron", category: "Laundry", unit: "per_piece", stages: ["received", "sorting", "cleaning", "drying", "finishing", "quality_control", "packing", "ready"] },
  { code: "SI", name: "Steam iron", category: "Steam Press", unit: "per_piece", stages: ["received", "finishing", "quality_control", "packing", "ready"] },
  { code: "ST", name: "Stain treatment", category: "Stain Treatment", unit: "per_piece", stages: ["received", "inspection", "cleaning", "finishing", "quality_control", "packing", "ready"] },
  { code: "RA", name: "Repair & special care", category: "Repair & Alterations", unit: "per_piece", stages: ["received", "inspection", "finishing", "quality_control", "packing", "ready"] },
];

/** Display order of the standard categories at the POS counter. */
export const STANDARD_CATEGORIES = [
  "Men", "Women", "Ethnic", "Kids & Baby", "Household Linen", "Home Furnishing", "Accessories",
  "Premium & Delicate", "Footwear & Leather", "Commercial Linen", "Repair & Alterations",
] as const;

// [name, category, dry clean, wash & iron, steam iron, stain treatment, repair & special care] in rupees; 0 = not offered.
type Row = [name: string, category: (typeof STANDARD_CATEGORIES)[number], dc: number, wi: number, si: number, st: number, ra?: number];

/**
 * Built-in garment list with typical Indian counter prices (starting points only — every store
 * edits them in Services & prices). Names already shipped earlier are kept unchanged so stores that
 * installed them are matched, not duplicated.
 */
const ROWS: Row[] = [
  // ---- Men
  ["Shirt", "Men", 80, 40, 15, 60],
  ["Trousers", "Men", 90, 45, 15, 60],
  ["Formal Trousers", "Men", 100, 50, 20, 60],
  ["T-Shirt", "Men", 60, 35, 15, 50],
  ["Polo T-Shirt", "Men", 70, 40, 15, 50],
  ["Jeans", "Men", 100, 50, 20, 60],
  ["Shorts", "Men", 50, 30, 15, 40],
  ["Track Pant", "Men", 70, 40, 15, 50],
  ["Track Suit (2 pc)", "Men", 160, 90, 30, 80],
  ["Waistcoat", "Men", 130, 0, 40, 70],
  ["Blazer", "Men", 250, 0, 80, 120],
  ["Suit (2 pc)", "Men", 350, 0, 120, 150],
  ["Suit (3 pc)", "Men", 455, 0, 160, 180],
  ["Tuxedo", "Men", 320, 0, 100, 150],
  ["Safari Suit", "Men", 250, 0, 70, 100],
  ["Sports Jacket", "Men", 270, 0, 70, 110],
  ["Jacket", "Men", 300, 0, 0, 120],
  ["Long Coat", "Men", 300, 0, 80, 120],
  ["Overcoat", "Men", 340, 0, 90, 140],
  ["Raincoat", "Men", 200, 0, 0, 80],
  ["Sweater", "Men", 180, 0, 0, 80],
  ["Sweater (half sleeve)", "Men", 150, 0, 0, 70],
  ["Hoodie", "Men", 200, 100, 30, 80],
  ["Sweatshirt", "Men", 180, 90, 25, 80],
  ["Tie", "Men", 50, 0, 20, 40],
  ["Socks (pair)", "Men", 0, 20, 0, 0],
  ["Undershirt / Vest", "Men", 40, 20, 10, 0],
  ["Underwear", "Men", 40, 20, 0, 0],
  ["Pyjama", "Men", 80, 40, 15, 40],
  ["Nightwear Set", "Men", 120, 70, 25, 0],
  ["Lungi", "Men", 70, 40, 15, 0],
  // ---- Women
  ["Blouse", "Women", 70, 40, 20, 50],
  ["Top", "Women", 70, 40, 15, 50],
  ["Women's T-Shirt", "Women", 60, 35, 15, 50],
  ["Women's Jeans", "Women", 100, 50, 20, 60],
  ["Tunic", "Women", 90, 50, 20, 50],
  ["Skirt", "Women", 100, 60, 25, 60],
  ["Salwar", "Women", 70, 40, 15, 40],
  ["Churidar", "Women", 70, 40, 15, 40],
  ["Palazzo", "Women", 80, 45, 20, 50],
  ["Leggings", "Women", 50, 30, 10, 0],
  ["Salwar Kameez (2 pc)", "Women", 160, 90, 40, 80],
  ["Salwar Suit (3 pc)", "Women", 200, 110, 50, 90],
  ["Patiala Suit", "Women", 220, 120, 50, 90],
  ["Anarkali", "Women", 300, 0, 80, 120],
  ["Dress", "Women", 180, 80, 40, 100],
  ["Gown", "Women", 350, 0, 100, 150],
  ["Evening Dress", "Women", 400, 0, 100, 160],
  ["Wedding Dress", "Women", 1200, 0, 300, 400],
  ["Nightdress", "Women", 80, 50, 20, 0],
  ["Nightgown", "Women", 80, 50, 20, 0],
  ["Women's Nightwear Set", "Women", 120, 70, 25, 0],
  ["Petticoat", "Women", 50, 30, 15, 0],
  ["Shrug", "Women", 90, 50, 20, 50],
  ["Cardigan", "Women", 180, 0, 0, 80],
  ["Women's Sweater", "Women", 180, 0, 0, 80],
  ["Women's Coat", "Women", 320, 0, 80, 130],
  ["Stockings (pair)", "Women", 0, 30, 0, 0],
  // ---- Ethnic & traditional
  ["Kurta", "Ethnic", 90, 50, 20, 60],
  ["Kurti", "Ethnic", 80, 45, 20, 50],
  ["Kurta Pyjama", "Ethnic", 250, 100, 40, 80],
  ["Pathani Suit", "Ethnic", 250, 100, 40, 80],
  ["Sherwani", "Ethnic", 500, 0, 150, 200],
  ["Achkan", "Ethnic", 350, 0, 100, 150],
  ["Nehru Jacket", "Ethnic", 150, 0, 40, 70],
  ["Indo-Western", "Ethnic", 450, 0, 120, 180],
  ["Dhoti", "Ethnic", 90, 50, 20, 40],
  ["Dhoti Kurta Set", "Ethnic", 200, 100, 40, 80],
  ["Saree (plain)", "Ethnic", 150, 0, 60, 100],
  ["Saree (silk / heavy)", "Ethnic", 300, 0, 100, 150],
  ["Saree (designer / embroidered)", "Ethnic", 450, 0, 150, 200],
  ["Bridal Saree", "Ethnic", 900, 0, 250, 350],
  ["Lehenga", "Ethnic", 600, 0, 200, 250],
  ["Bridal Lehenga", "Ethnic", 1500, 0, 400, 500],
  ["Dupatta", "Ethnic", 60, 40, 20, 40],
  ["Chunni", "Ethnic", 50, 35, 15, 35],
  ["Angavastram", "Ethnic", 80, 50, 20, 40],
  ["Pheran", "Ethnic", 250, 0, 70, 100],
  ["Traditional Dress Set", "Ethnic", 400, 0, 120, 160],
  ["Embroidered Suit", "Ethnic", 350, 0, 100, 150],
  ["Zari Work Garment", "Ethnic", 450, 0, 0, 180],
  ["Velvet Ethnic Garment", "Ethnic", 450, 0, 0, 180],
  // ---- Kids & baby
  ["Baby Dress", "Kids & Baby", 60, 35, 15, 0],
  ["Baby Romper", "Kids & Baby", 50, 30, 0, 0],
  ["Onesie", "Kids & Baby", 50, 30, 0, 0],
  ["Baby Blanket", "Kids & Baby", 150, 100, 0, 0],
  ["Baby Bedding Set", "Kids & Baby", 200, 150, 0, 0],
  ["Kids Shirt", "Kids & Baby", 50, 30, 10, 40],
  ["Kids T-Shirt", "Kids & Baby", 40, 25, 10, 30],
  ["Kids Trousers", "Kids & Baby", 60, 35, 10, 40],
  ["Kids Jeans", "Kids & Baby", 70, 40, 15, 40],
  ["Kids Frock", "Kids & Baby", 80, 45, 20, 50],
  ["Kids Sweater", "Kids & Baby", 120, 0, 0, 60],
  ["Kids Jacket", "Kids & Baby", 150, 0, 0, 70],
  ["Kids Ethnic Wear", "Kids & Baby", 150, 0, 40, 70],
  ["Kids Lehenga", "Kids & Baby", 250, 0, 80, 100],
  ["Kids Sherwani", "Kids & Baby", 250, 0, 80, 100],
  ["Kids Suit", "Kids & Baby", 200, 0, 70, 90],
  ["School Uniform (set)", "Kids & Baby", 90, 60, 25, 0],
  ["School Blazer", "Kids & Baby", 180, 0, 60, 80],
  ["School Tie", "Kids & Baby", 30, 0, 10, 20],
  ["School Skirt", "Kids & Baby", 60, 35, 15, 0],
  ["School Shorts", "Kids & Baby", 50, 30, 10, 0],
  // ---- Household linen & bedding
  ["Bedsheet (single)", "Household Linen", 0, 45, 25, 0],
  ["Bedsheet", "Household Linen", 0, 60, 30, 0],
  ["Bedsheet (king / queen)", "Household Linen", 0, 80, 40, 0],
  ["Pillow Cover", "Household Linen", 0, 25, 10, 0],
  ["Pillow", "Household Linen", 150, 100, 0, 0],
  ["Pillow Protector", "Household Linen", 0, 40, 0, 0],
  ["Mattress Protector", "Household Linen", 0, 150, 0, 0],
  ["Bedspread", "Household Linen", 250, 150, 60, 0],
  ["Quilt / Razai", "Household Linen", 450, 300, 0, 0],
  ["Comforter", "Household Linen", 450, 300, 0, 0],
  ["Duvet", "Household Linen", 500, 350, 0, 0],
  ["Duvet Cover", "Household Linen", 0, 150, 60, 0],
  ["Blanket (single)", "Household Linen", 300, 200, 0, 0],
  ["Blanket (double)", "Household Linen", 450, 300, 0, 0],
  ["Blanket (heavy)", "Household Linen", 600, 400, 0, 0],
  ["Dohar", "Household Linen", 250, 150, 0, 0],
  ["Cushion Cover", "Household Linen", 60, 35, 15, 0],
  ["Cushion", "Household Linen", 150, 100, 0, 0],
  ["Table Cloth", "Household Linen", 90, 60, 25, 0],
  ["Table Runner", "Household Linen", 70, 45, 20, 0],
  ["Napkin", "Household Linen", 0, 15, 10, 0],
  ["Kitchen Towel", "Household Linen", 0, 15, 0, 0],
  ["Towel", "Household Linen", 0, 30, 0, 0],
  ["Bath Towel", "Household Linen", 0, 35, 0, 0],
  ["Hand Towel", "Household Linen", 0, 20, 0, 0],
  ["Face Towel", "Household Linen", 0, 15, 0, 0],
  ["Bath Mat", "Household Linen", 0, 50, 0, 0],
  ["Bath Robe", "Household Linen", 200, 100, 0, 0],
  ["Mosquito Net", "Household Linen", 0, 120, 0, 0],
  // ---- Curtains & home furnishing
  ["Curtain (per panel)", "Home Furnishing", 200, 120, 60, 0],
  ["Curtain (heavy)", "Home Furnishing", 300, 180, 90, 0],
  ["Blackout Curtain", "Home Furnishing", 300, 180, 0, 0],
  ["Sheer Curtain", "Home Furnishing", 150, 90, 40, 0],
  ["Window Valance", "Home Furnishing", 150, 90, 40, 0],
  ["Door Curtain", "Home Furnishing", 180, 110, 50, 0],
  ["Sofa Cover (per seat)", "Home Furnishing", 120, 80, 0, 0],
  ["Chair Cover", "Home Furnishing", 60, 40, 0, 0],
  ["Upholstery Cover", "Home Furnishing", 200, 120, 0, 0],
  ["Sofa Fabric (per seat)", "Home Furnishing", 250, 0, 0, 0],
  ["Carpet (small)", "Home Furnishing", 400, 0, 0, 0],
  ["Carpet (large)", "Home Furnishing", 900, 0, 0, 0],
  ["Rug", "Home Furnishing", 500, 0, 0, 0],
  ["Door Mat", "Home Furnishing", 0, 80, 0, 0],
  ["Wall Tapestry", "Home Furnishing", 400, 0, 0, 0],
  ["Decorative Fabric", "Home Furnishing", 200, 120, 0, 0],
  ["Mattress Topper", "Home Furnishing", 500, 350, 0, 0],
  // ---- Accessories
  ["Handkerchief", "Accessories", 0, 10, 5, 0],
  ["Bow Tie", "Accessories", 50, 0, 20, 40],
  ["Muffler / Scarf", "Accessories", 70, 40, 15, 40],
  ["Shawl", "Accessories", 150, 0, 40, 70],
  ["Stole", "Accessories", 100, 60, 25, 50],
  ["Cap / Beanie", "Accessories", 60, 40, 0, 0],
  ["Hat", "Accessories", 120, 0, 0, 0],
  ["Turban / Safa", "Accessories", 150, 0, 40, 0],
  ["Gloves (pair)", "Accessories", 60, 40, 0, 0],
  ["Belt", "Accessories", 100, 0, 0, 0],
  ["Fabric Bag", "Accessories", 0, 80, 0, 0],
  ["Handbag", "Accessories", 500, 0, 0, 150],
  ["Backpack", "Accessories", 300, 0, 0, 100],
  ["School Bag", "Accessories", 250, 150, 0, 0],
  ["Soft Toy", "Accessories", 150, 100, 0, 0],
  ["Stuffed Animal (large)", "Accessories", 300, 200, 0, 0],
  ["Fabric Accessory", "Accessories", 80, 50, 20, 0],
  // ---- Premium & delicate
  ["Designer Dress", "Premium & Delicate", 600, 0, 150, 250],
  ["Bridal Gown", "Premium & Delicate", 1500, 0, 400, 500],
  ["Embroidered Sherwani", "Premium & Delicate", 800, 0, 200, 300],
  ["Heavy Lehenga", "Premium & Delicate", 900, 0, 250, 350],
  ["Designer Saree", "Premium & Delicate", 600, 0, 180, 250],
  ["Silk Blouse", "Premium & Delicate", 150, 0, 40, 80],
  ["Velvet Jacket", "Premium & Delicate", 450, 0, 0, 180],
  ["Cashmere Sweater", "Premium & Delicate", 350, 0, 0, 150],
  ["Pashmina Shawl", "Premium & Delicate", 350, 0, 0, 150],
  ["Woollen Coat", "Premium & Delicate", 350, 0, 0, 150],
  ["Suede Jacket", "Premium & Delicate", 700, 0, 0, 250],
  ["Fur Garment", "Premium & Delicate", 900, 0, 0, 0],
  ["Delicate Silk Garment", "Premium & Delicate", 300, 0, 0, 120],
  ["Sequined Garment", "Premium & Delicate", 450, 0, 0, 180],
  ["Beaded Garment", "Premium & Delicate", 450, 0, 0, 180],
  ["Wedding Suit", "Premium & Delicate", 700, 0, 200, 250],
  ["Antique Textile", "Premium & Delicate", 800, 0, 0, 0],
  ["Heavily Embellished Garment", "Premium & Delicate", 600, 0, 0, 250],
  // ---- Footwear & leather care
  ["Shoes (pair)", "Footwear & Leather", 350, 0, 0, 100],
  ["Leather Shoes (pair)", "Footwear & Leather", 450, 0, 0, 150],
  ["Suede Shoes (pair)", "Footwear & Leather", 500, 0, 0, 150],
  ["Sneakers (pair)", "Footwear & Leather", 400, 0, 0, 120],
  ["Sports Shoes (pair)", "Footwear & Leather", 400, 0, 0, 120],
  ["Boots (pair)", "Footwear & Leather", 550, 0, 0, 150],
  ["Sandals (pair)", "Footwear & Leather", 250, 0, 0, 80],
  ["Leather Handbag", "Footwear & Leather", 700, 0, 0, 200],
  ["Leather Purse", "Footwear & Leather", 350, 0, 0, 100],
  ["Leather Wallet", "Footwear & Leather", 250, 0, 0, 80],
  ["Leather Belt", "Footwear & Leather", 200, 0, 0, 0],
  ["Leather Jacket", "Footwear & Leather", 450, 0, 0, 180],
  ["Leather Coat", "Footwear & Leather", 800, 0, 0, 250],
  ["Leather Gloves (pair)", "Footwear & Leather", 250, 0, 0, 0],
  ["Leather Accessory", "Footwear & Leather", 250, 0, 0, 0],
  // ---- Commercial & hospitality linen
  ["Hotel Bedsheet", "Commercial Linen", 0, 35, 20, 0],
  ["Hotel Pillowcase", "Commercial Linen", 0, 15, 8, 0],
  ["Hotel Duvet Cover", "Commercial Linen", 0, 80, 0, 0],
  ["Hotel Blanket", "Commercial Linen", 0, 150, 0, 0],
  ["Hotel Bath Towel", "Commercial Linen", 0, 25, 0, 0],
  ["Hotel Bathrobe", "Commercial Linen", 0, 80, 0, 0],
  ["Restaurant Tablecloth", "Commercial Linen", 0, 40, 20, 0],
  ["Restaurant Napkin", "Commercial Linen", 0, 10, 5, 0],
  ["Chef Coat", "Commercial Linen", 0, 60, 20, 40],
  ["Chef Apron", "Commercial Linen", 0, 30, 10, 0],
  ["Apron", "Commercial Linen", 50, 30, 15, 0],
  ["Uniform (set)", "Commercial Linen", 120, 70, 30, 0],
  ["Kitchen Uniform", "Commercial Linen", 0, 70, 25, 0],
  ["Waiter Uniform", "Commercial Linen", 0, 70, 25, 0],
  ["Housekeeping Uniform", "Commercial Linen", 0, 70, 25, 0],
  ["Spa Towel", "Commercial Linen", 0, 20, 0, 0],
  ["Salon Towel", "Commercial Linen", 0, 15, 0, 0],
  ["Hospital Bedsheet", "Commercial Linen", 0, 35, 20, 0],
  ["Hospital Gown", "Commercial Linen", 0, 30, 15, 0],
  ["Medical Uniform", "Commercial Linen", 0, 60, 20, 0],
  ["Industrial Uniform", "Commercial Linen", 0, 80, 25, 0],
  ["Workwear", "Commercial Linen", 0, 80, 25, 0],
  ["Safety Jacket", "Commercial Linen", 0, 90, 0, 0],
  ["Lab Coat", "Commercial Linen", 0, 60, 20, 0],
  // ---- Repair & special handling (priced under "Repair & special care")
  ["Raffu (darning)", "Repair & Alterations", 0, 0, 0, 0, 150],
  ["Colouring / Dyeing", "Repair & Alterations", 0, 0, 0, 0, 400],
  ["Alteration", "Repair & Alterations", 0, 0, 0, 0, 100],
  ["Stitching", "Repair & Alterations", 0, 0, 0, 0, 150],
  ["Button Replacement", "Repair & Alterations", 0, 0, 0, 0, 30],
  ["Zip Replacement", "Repair & Alterations", 0, 0, 0, 0, 80],
  ["Stain Treatment (special)", "Repair & Alterations", 0, 0, 0, 0, 150],
  ["Fabric Restoration", "Repair & Alterations", 0, 0, 0, 0, 300],
];

/** Category each garment had in earlier built-in lists; used to move untouched garments to the new categories. */
const LEGACY_CATEGORIES: Record<string, string> = {
  Jacket: "General", Kurti: "Women", "Saree (plain)": "Women", "Saree (silk / heavy)": "Women", Lehenga: "Women", "Bridal Lehenga": "Women",
  "Kids Shirt": "Kids", "Kids Trousers": "Kids", "Kids Frock": "Kids", "Kids Jacket": "Kids", "School Uniform (set)": "Kids", "Baby Romper": "Kids",
  Sweater: "Woollens", Cardigan: "Woollens", "Sweater (half sleeve)": "Woollens", "Woollen Coat": "Woollens", Shawl: "Woollens", "Pashmina Shawl": "Woollens",
  "Muffler / Scarf": "Woollens", "Gloves (pair)": "Woollens", "Cap / Beanie": "Woollens",
  "Bedsheet (single)": "Household", Bedsheet: "Household", "Blanket (single)": "Household", "Blanket (double)": "Household", "Quilt / Razai": "Household",
  "Duvet Cover": "Household", "Pillow Cover": "Household", "Cushion Cover": "Household", "Table Cloth": "Household", Towel: "Household", "Bath Robe": "Household",
  "Curtain (per panel)": "Household", "Curtain (heavy)": "Household", "Sofa Cover (per seat)": "Household", "Carpet (small)": "Household", "Door Mat": "Household", "Soft Toy": "Household",
  "Shoes (pair)": "Footwear & Bags", "Sneakers (pair)": "Footwear & Bags", "Leather Shoes (pair)": "Footwear & Bags", Handbag: "Footwear & Bags", Backpack: "Footwear & Bags",
  "Leather Jacket": "Men", Raincoat: "Others", Apron: "Others", "Uniform (set)": "Others",
};

const CODES = ["DC", "WI", "SI", "ST", "RA"] as const;
export const STANDARD_GARMENTS = ROWS.map(([name, category, ...prices]) => ({
  name,
  category,
  prices: Object.fromEntries(CODES.map((code, i) => [code, (prices[i] ?? 0) * 100]).filter(([, p]) => (p as number) > 0)) as Partial<Record<string, number>>,
}));

/** Matching ignores case, spaces and punctuation, so "Door Mat" = "Doormat" and "Kids' Shirt" = "Kids Shirt". */
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Brings a store up to the current built-in list:
 *  - adds missing standard services (by code) and garments (by name) with starting prices;
 *  - moves standard garments still in their old default category to the new category.
 * Existing prices, renamed garments and categories the store changed itself are never touched.
 */
export async function installStandardCatalogue(tx: Tx, orgId: string, opts: { dryRun?: boolean } = {}) {
  const existing = await tx.select({ id: schema.garmentTypes.id, name: schema.garmentTypes.name, category: schema.garmentTypes.category })
    .from(schema.garmentTypes).where(eq(schema.garmentTypes.organizationId, orgId));
  const have = new Map(existing.map((g) => [key(g.name), g]));
  const missing = STANDARD_GARMENTS.filter((g) => !have.has(key(g.name)));
  const moves = STANDARD_GARMENTS.flatMap((g) => {
    const current = have.get(key(g.name));
    return current && current.category !== g.category && LEGACY_CATEGORIES[g.name] === current.category ? [{ id: current.id, category: g.category }] : [];
  });
  const summary = { available: missing.length, recategorise: moves.length, categories: [...new Set(missing.map((g) => g.category))] };
  if (opts.dryRun) return { ...summary, added: 0, prices: 0, moved: 0, services: 0 };

  let services = await tx.select().from(schema.services).where(eq(schema.services.organizationId, orgId));
  const missingServices = STANDARD_SERVICES.filter((s) => !services.some((x) => x.serviceCode === s.code));
  if (missingServices.length) {
    await tx.insert(schema.services).values(missingServices.map((s) => ({ organizationId: orgId, name: s.name, category: s.category, serviceCode: s.code, unitType: s.unit, workflowStages: s.stages })));
    services = await tx.select().from(schema.services).where(eq(schema.services.organizationId, orgId));
  }
  let [priceList] = await tx.select().from(schema.priceLists)
    .where(and(eq(schema.priceLists.organizationId, orgId), isNull(schema.priceLists.branchId), eq(schema.priceLists.status, "active")))
    .orderBy(schema.priceLists.createdAt)
    .limit(1);
  if (!priceList) [priceList] = await tx.insert(schema.priceLists).values({ organizationId: orgId, name: "Standard prices", branchId: null }).returning();

  const inserted = missing.length
    ? await tx.insert(schema.garmentTypes).values(missing.map((g) => ({ organizationId: orgId, name: g.name, category: g.category }))).onConflictDoNothing().returning()
    : [];
  const prices = inserted.flatMap((gt) => {
    const def = missing.find((g) => g.name === gt.name)!;
    // Prices only attach to services the store still has, active, under the standard codes.
    return Object.entries(def.prices).flatMap(([code, price]) => {
      const svc = services.find((s) => s.serviceCode === code && s.active);
      return svc ? [{ organizationId: orgId, priceListId: priceList.id, garmentTypeId: gt.id, serviceId: svc.id, unitPrice: price!, taxBps: 1800 }] : [];
    });
  });
  if (prices.length) await tx.insert(schema.servicePrices).values(prices);
  for (const m of moves) await tx.update(schema.garmentTypes).set({ category: m.category }).where(eq(schema.garmentTypes.id, m.id));
  return { ...summary, available: 0, recategorise: 0, added: inserted.length, prices: prices.length, moved: moves.length, services: missingServices.length };
}
