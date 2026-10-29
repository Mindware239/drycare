/**
 * Installs the built-in catalogue into named shops (same as "Add garments" in Services & prices).
 * Usage: tsx scripts/install-catalogue.ts <organization-id> [<organization-id> …]
 */
import { db, schema, sqlClient } from "../apps/api/src/db/client";
import { installStandardCatalogue } from "../apps/api/src/lib/standardCatalogue";

const ids = process.argv.slice(2);
if (!ids.length) throw new Error("Pass one or more organization ids");
for (const id of ids) {
  const [org] = await sqlClient<{ name: string }[]>`select name from organizations where id = ${id}`;
  if (!org) { console.log(`${id}: not found`); continue; }
  const result = await db.transaction(async (tx) => {
    const r = await installStandardCatalogue(tx, id);
    await tx.insert(schema.auditLogs).values({ organizationId: id, action: "catalogue.standard_installed", resourceType: "garment_type", after: { ...r, via: "install-catalogue script" } });
    return r;
  });
  const [{ n }] = await sqlClient<{ n: number }[]>`select count(*)::int as n from garment_types where organization_id = ${id}`;
  console.log(`${org.name}: +${result.added} garments, +${result.prices} prices, ${result.moved} re-categorised, +${result.services} service(s) → ${n} garments`);
}
await sqlClient.end();
process.exit(0);
