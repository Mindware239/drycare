/**
 * Reports centre end to end: every report runs on a shop with real activity, totals add up, and access follows roles.
 * Run: pnpm reports-test (fresh @test.local shop each run).
 */
import { randomUUID } from "node:crypto";
import { buildServer } from "../apps/api/src/app";
import { sqlClient } from "../apps/api/src/db/client";

const app = await buildServer();
let failures = 0;
const results: string[] = [];
const check = (label: string, cond: boolean, extra?: unknown) => {
  if (cond) results.push(`  ✓ ${label}`);
  else { failures++; results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 400)}` : ""}`); }
};
class Client {
  cookie = "";
  async req(method: string, url: string, body?: unknown) {
    const res = await app.inject({ method: method as "GET", url: `/api/v1${url}`, payload: body as object, headers: { cookie: this.cookie, "x-drycare-csrf": "1" } });
    const set = res.headers["set-cookie"];
    if (set) this.cookie = (Array.isArray(set) ? set[0] : set).split(";")[0];
    let json: any;
    try { json = res.json(); } catch {}
    return { status: res.statusCode, json };
  }
}
const runId = randomUUID().slice(0, 6);
const owner = new Client();
await owner.req("POST", "/organizations", { businessName: `Report Shop ${runId}`, ownerName: "Report Owner", email: `owner-rep-${runId}@test.local`, password: `Owner-${runId}-Password1`, acceptedTerms: true });
const session = (await owner.req("GET", "/auth/session")).json;
const branchId = session.branches[0].id;
await owner.req("POST", "/cashier-shifts", { branchId, openingCash: 0 });
const [gts, svcs] = await Promise.all([owner.req("GET", "/garment-types"), owner.req("GET", "/services")]);
const shirt = gts.json.find((g: any) => g.name === "Shirt"), suit = gts.json.find((g: any) => g.name === "Suit (2 pc)");
const DC = svcs.json.find((s: any) => s.serviceCode === "DC"), SI = svcs.json.find((s: any) => s.serviceCode === "SI");
const cust = (await owner.req("POST", "/customers", { name: "Rahul Sharma", phone: `+91 98${String(Date.now()).slice(-8)}` })).json;
const b2b = (await owner.req("POST", "/customers", { name: "Hotel Blue", phone: `+91 97${String(Date.now()).slice(-8)}`, gstin: "27ABCDE1234F1Z5" })).json;
const promisedAt = new Date(Date.now() + 2 * 86400_000).toISOString();
await owner.req("POST", "/orders", { customerId: cust.id, branchId, promisedAt, items: [{ garmentTypeId: suit.id, serviceId: DC.id, quantity: 1 }], payments: [{ amount: 20000, method: "cash" }] });
await owner.req("POST", "/orders", { customerId: b2b.id, branchId, promisedAt, items: [{ garmentTypeId: shirt.id, serviceId: SI.id, quantity: 10 }], payments: [{ amount: 17700, method: "upi", reference: `UPI${runId}` }] });
await owner.req("POST", "/expenses", { branchId, category: "Chemicals", amount: 50000, spentOn: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), description: "Solvent", method: "cash" });

const catalogue = (await owner.req("GET", "/reports/catalogue")).json;
check("owner sees the full catalogue (17 reports)", Array.isArray(catalogue) && catalogue.length === 17, catalogue?.length);
for (const r of catalogue) {
  const res = await owner.req("GET", `/reports/run/${r.key}`);
  const ok = res.status === 200 && Array.isArray(res.json.rows);
  const totalsOk = !res.json?.totals || Object.entries(res.json.totals).every(([k, v]) => Math.abs((v as number) - res.json.rows.reduce((s: number, row: any) => s + Number(row[k] ?? 0), 0)) < 0.001);
  check(`${r.group} · ${r.title} runs${ok ? ` (${res.json.rows.length} rows)` : ""}`, ok && totalsOk, res.json);
}
const gst = (await owner.req("GET", "/reports/run/gst-summary")).json;
check("GST summary splits B2B (GSTIN customer) and B2C", gst.totals.b2b_taxable > 0 && gst.totals.b2c_taxable > 0, gst.totals);
const daybook = (await owner.req("GET", "/reports/run/daybook")).json;
check("day book: ₹200 cash + ₹177 UPI in, ₹500 expense out", daybook.totals.cash === 20000 && daybook.totals.upi === 17700 && daybook.totals.expenses === 50000 && daybook.totals.net === 20000 + 17700 - 50000, daybook.totals);
const prod = (await owner.req("GET", "/reports/run/staff-productivity")).json;
check("staff productivity credits the owner with 2 orders", prod.rows.find((r: any) => r.staff === "Report Owner")?.orders === 2, prod.rows);
const pending = (await owner.req("GET", "/reports/run/pending-register")).json;
check("pending register counts all 11 garments as fresh", pending.totals.total === 11 && pending.totals.d0_2 === 11, pending.totals);
check("bad date range is a clear 400", (await owner.req("GET", "/reports/run/daybook?from=2026-10-10&to=2026-10-01")).status === 400);
check("unknown report is 404", (await owner.req("GET", "/reports/run/nope")).status === 404);

await owner.req("POST", "/staff", { name: "Counter Staff", email: `rec-rep-${runId}@test.local`, password: `Staff-${runId}-Password1`, roleKey: "reception", branchIds: [branchId] });
const rec = new Client();
await rec.req("POST", "/auth/login", { email: `rec-rep-${runId}@test.local`, password: `Staff-${runId}-Password1` });
const recCat = (await rec.req("GET", "/reports/catalogue")).json;
check("reception sees only non-money reports", recCat.length > 0 && recCat.every((r: any) => !["daybook", "gst-summary", "dues"].includes(r.key)), recCat.map((r: any) => r.key));
check("reception cannot run the day book", (await rec.req("GET", "/reports/run/daybook")).status === 403);

console.log(results.join("\n"));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await app.close();
await sqlClient.end();
process.exit(failures ? 1 : 0);
