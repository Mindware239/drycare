/** Verifies the built-in catalogue install on an existing automated-test shop (owner @test.local only). */
import { db, sqlClient as sql } from "../apps/api/src/db/client";
import { installStandardCatalogue, STANDARD_GARMENTS } from "../apps/api/src/lib/standardCatalogue";

const [org] = await sql<{ id: string; name: string }[]>`
  select o.id, o.name from organizations o
  where exists (select 1 from organization_memberships m join users u on u.id = m.user_id where m.organization_id = o.id and u.email like '%@test.local')
    and (select count(*) from garment_types g where g.organization_id = o.id) < ${STANDARD_GARMENTS.length}
  order by o.created_at limit 1`;
if (!org) throw new Error("No older test shop found");
const prices = async () => (await sql<{ n: number }[]>`select count(*)::int as n from service_prices where organization_id = ${org.id}`)[0].n;
const before = await sql<{ id: string; name: string }[]>`select id, name from garment_types where organization_id = ${org.id}`;
const pricesBefore = await prices();
const preview = await db.transaction((tx) => installStandardCatalogue(tx, org.id, { dryRun: true }));
const first = await db.transaction((tx) => installStandardCatalogue(tx, org.id));
const second = await db.transaction((tx) => installStandardCatalogue(tx, org.id));
const after = await sql<{ id: string; name: string }[]>`select id, name from garment_types where organization_id = ${org.id}`;
const kept = before.every((g) => after.some((a) => a.id === g.id && a.name === g.name));
const legacyLeft = await sql<{ n: number }[]>`select count(*)::int as n from garment_types where organization_id = ${org.id} and category in ('Woollens', 'Footwear & Bags', 'Kids', 'Household') and name in ('Sweater', 'Shawl', 'Handbag', 'Kids Shirt', 'Towel')`;
const ok = preview.available === first.added && first.added > 0 && second.added === 0 && second.moved === 0 && preview.recategorise === first.moved && kept && (await prices()) === pricesBefore + first.prices && legacyLeft[0].n === 0;
console.log(org.name, { before: before.length, preview: preview.available, added: first.added, prices: first.prices, moved: first.moved, services: first.services, secondRun: second.added, after: after.length, existingUntouched: kept, legacyLeft: legacyLeft[0].n });
console.log(ok ? "CATALOGUE CHECK PASSED" : "CATALOGUE CHECK FAILED");
await sql.end();
process.exit(ok ? 0 : 1);
