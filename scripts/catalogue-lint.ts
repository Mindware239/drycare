/** Static checks on the built-in catalogue: unique names, every garment priced, category counts. Run with tsx. */
import { STANDARD_CATEGORIES, STANDARD_GARMENTS } from "../apps/api/src/lib/standardCatalogue";

const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
const seen = new Map<string, string>();
let problems = 0;
for (const g of STANDARD_GARMENTS) {
  if (seen.has(key(g.name))) { problems++; console.log(`DUPLICATE: ${g.name} = ${seen.get(key(g.name))}`); }
  seen.set(key(g.name), g.name);
  if (!Object.keys(g.prices).length) { problems++; console.log(`UNPRICED: ${g.name}`); }
}
console.log(`${STANDARD_GARMENTS.length} garments in ${STANDARD_CATEGORIES.length} categories`);
for (const c of STANDARD_CATEGORIES) console.log(`  ${c}: ${STANDARD_GARMENTS.filter((g) => g.category === c).length}`);
console.log(problems ? `${problems} PROBLEM(S)` : "CATALOGUE LINT PASSED");
process.exit(problems ? 1 : 0);
