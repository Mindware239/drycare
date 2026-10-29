/** Installs the self-service laundry starter services/prices into named shops. Usage: tsx scripts/install-laundry.ts <org-id>… */
import { db, schema, sqlClient } from "../apps/api/src/db/client";
import { installLaundryDefaults } from "../apps/api/src/modules/laundry";

for (const id of process.argv.slice(2)) {
  const [org] = await sqlClient<{ name: string }[]>`select name from organizations where id = ${id}`;
  if (!org) { console.log(`${id}: not found`); continue; }
  const r = await db.transaction(async (tx) => {
    const res = await installLaundryDefaults(tx, id);
    await tx.insert(schema.auditLogs).values({ organizationId: id, action: "laundry.defaults_installed", resourceType: "laundry_service", after: { ...res, via: "install-laundry script" } });
    return res;
  });
  console.log(`${org.name}: ${r.added} self-service services added`);
}
await sqlClient.end();
process.exit(0);
