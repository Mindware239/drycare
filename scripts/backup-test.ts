/**
 * Backup → change data → restore round trip, in a throwaway database (never touches real data).
 * Run: pnpm backup-test
 */
import postgres from "postgres";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = new URL(process.env.DATABASE_URL!);
const admin = postgres({ host: base.hostname, port: Number(base.port), user: base.username, password: decodeURIComponent(base.password), database: "postgres", onnotice: () => {} });
const DB = "drycare_backup_test";
await admin.unsafe(`drop database if exists ${DB} with (force)`);
await admin.unsafe(`create database ${DB} encoding 'UTF8' template template0`);
base.pathname = `/${DB}`;
process.env.DATABASE_URL = base.toString();

const { buildServer } = await import("../apps/api/src/app");
const { db, sqlClient } = await import("../apps/api/src/db/client");
const { runMigrations } = await import("../apps/api/src/db/migrate-lib");
const { createBackup, readBackupManifest, restoreBackup } = await import("../apps/api/src/lib/backup");

let failures = 0;
const check = (label: string, ok: boolean, extra?: unknown) => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || extra === undefined ? "" : `  → ${JSON.stringify(extra)}`}`);
  if (!ok) failures++;
};

await runMigrations(db, fileURLToPath(new URL("../apps/api/drizzle", import.meta.url)));
const app = await buildServer();
let cookie = "";
const call = async (method: string, url: string, body?: unknown) => {
  const r = await app.inject({ method: method as "GET", url: `/api/v1${url}`, payload: body as object, headers: { cookie, "x-drycare-csrf": "1" } });
  const sc = r.headers["set-cookie"];
  if (sc) cookie = (Array.isArray(sc) ? sc[0] : sc).split(";")[0];
  return r.json();
};

console.log("Backup / restore round trip");
await call("POST", "/organizations", { businessName: "शिव ड्राई क्लीनर्स", ownerName: "Shiv", email: "shiv@test.local", password: "Correct-Horse-Battery-1", acceptedTerms: true, branchName: "Main", branchCode: "MN" });
const session = await call("GET", "/auth/session");
const [gts, svcs] = await Promise.all([call("GET", "/garment-types"), call("GET", "/services")]);
const cust = await call("POST", "/customers", { name: "सुनीता पाटील", phone: "9822000001" });
const orderBody = (n: number) => ({
  customerId: cust.id,
  branchId: session.branches[0].id,
  promisedAt: new Date(Date.now() + 86400_000).toISOString(),
  items: [{ garmentTypeId: gts.find((g: any) => g.name === "Saree (silk / heavy)").id, serviceId: svcs.find((s: any) => s.serviceCode === "DC").id, quantity: n }],
  payments: [{ amount: 10000, method: "cash" }],
});
const o1 = await call("POST", "/orders", orderBody(1));

const dir = mkdtempSync(path.join(tmpdir(), "drycare-bk-"));
const backup = await createBackup(sqlClient, dir, { appVersion: "test", kind: "manual" });
const manifest = await readBackupManifest(backup.file);
check("backup file written with manifest", manifest.rows === backup.rows && backup.rows > 50, manifest);
const [{ perms: permsBefore }] = await sqlClient`select string_agg(array_to_string(permissions, ','), '|' order by key) as perms from roles`;

const o2 = await call("POST", "/orders", orderBody(2));
await call("POST", "/customers", { name: "Added after backup" });
check("second order exists before restore", (await call("GET", `/orders/${o2.id}`)).id === o2.id);

await restoreBackup(sqlClient, backup.file);
const [{ n: orders }] = await sqlClient`select count(*)::int as n from orders`;
check("restore removed data created after the backup", orders === 1, orders);
const [{ n: sessions }] = await sqlClient`select count(*)::int as n from sessions`;
check("restore signs everyone out", sessions === 0, sessions);

cookie = "";
await call("POST", "/auth/login", { email: "shiv@test.local", password: "Correct-Horse-Battery-1" });
const back = await call("GET", `/orders/${o1.id}`);
check("original order, garments and payment are back", back.garments?.length === 1 && back.invoice?.paid === 10000, back.invoice);
check("Unicode names survive", back.customer?.name === "सुनीता पाटील" && (await call("GET", "/auth/session")).organization.name === "शिव ड्राई क्लीनर्स");
const next = await call("POST", "/orders", orderBody(1));
check("numbering continues after restore without duplicates", next.orderNumber === o2.orderNumber, [next.orderNumber, o2.orderNumber]);
const [{ perms: permsAfter }] = await sqlClient`select string_agg(array_to_string(permissions, ','), '|' order by key) as perms from roles`;
check("role permission lists survive", permsAfter === permsBefore && permsBefore.length > 100);

let blocked = false;
try {
  await sqlClient`delete from audit_logs`;
} catch {
  blocked = true;
}
check("append-only protection still active after restore", blocked);

let rejected = false;
try {
  await restoreBackup(sqlClient, path.join(fileURLToPath(new URL("../package.json", import.meta.url))));
} catch {
  rejected = true;
}
check("non-backup file is rejected", rejected);
const [{ n: stillThere }] = await sqlClient`select count(*)::int as n from orders`;
check("failed restore leaves data unchanged", stillThere === 2, stillThere);

// Backups made by DryCare 0.1.6 and earlier (format v1, COPY text) must still restore.
const custCols = (await sqlClient`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'customers' order by ordinal_position`).map((r) => r.column_name as string);
const copyLine = (await sqlClient.unsafe(`select concat_ws(E'\\t', ${custCols.map((c) => `coalesce(replace(replace("${c}"::text, E'\\\\', E'\\\\\\\\'), E'\\t', E'\\\\t'), E'\\\\N')`).join(", ")}) as l from customers where name = 'सुनीता पाटील'`))[0].l as string;
const v1File = path.join(dir, "drycare-manual-v1.dcbak");
const { gzipSync } = await import("node:zlib");
const { writeFileSync } = await import("node:fs");
writeFileSync(v1File, gzipSync(Buffer.from(`DRYCARE-BACKUP v1\n${JSON.stringify({ createdAt: new Date().toISOString(), appVersion: "0.1.5", tables: ["customers"], rows: 1 })}\n--TABLE customers ${custCols.join(",")}\n${copyLine}\n\\.\n`)));
check("old (v1) backup manifest is readable", (await readBackupManifest(v1File)).appVersion === "0.1.5");
await restoreBackup(sqlClient, v1File);
const v1Rows = await sqlClient`select name from customers`;
check("old (v1) backup restores", v1Rows.length === 1 && v1Rows[0].name === "सुनीता पाटील", v1Rows);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
await app.close();
await sqlClient.end();
await admin.unsafe(`drop database if exists ${DB} with (force)`);
await admin.end();
process.exit(failures ? 1 : 0);
