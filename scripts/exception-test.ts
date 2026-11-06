/**
 * Garment exceptions, against the running server (API_URL, default http://127.0.0.1:4000): every outcome and what it really
 * does to the garment, notes, reopening, and two people changing one exception. Run: pnpm exception-test.
 * Creates a throwaway shop with an @test.local address.
 */
import { randomUUID } from "node:crypto";

const API = `${process.env.API_URL ?? "http://127.0.0.1:4000"}/api/v1`;
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, extra?: unknown) => {
  if (ok) results.push(`  ✓ ${label}`);
  else { failures++; results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 400)}` : ""}`); }
};
const section = (t: string) => results.push(`\n${t}`);
let cookie = "";
async function req(method: string, url: string, body?: unknown) {
  const res = await fetch(`${API}${url}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), "x-drycare-csrf": "1", "idempotency-key": randomUUID(), cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const run = Date.now();
const email = `exception-${run}@test.local`, password = "CheckPass@2026x";
await req("POST", "/organizations", { ownerName: "Exception Owner", email, password, businessName: `Exception Shop ${run}`, country: "IN", acceptedTerms: true });
await req("POST", "/auth/login", { email, password });
const branchId: string = (await req("GET", "/auth/session")).json.branches[0].id;
const gts = (await req("GET", "/garment-types")).json, svcs = (await req("GET", "/services")).json;
const service = svcs.find((s: any) => /dry clean/i.test(s.name));
const prices = (await req("GET", `/branch-prices?branchId=${branchId}`)).json;
const usable = gts.filter((g: any) => prices.some((p: any) => p.garmentTypeId === g.id && p.serviceId === service.id));
await req("POST", "/cashier-shifts", { branchId, openingCash: 0 });
const customer = (await req("POST", "/customers", { name: "Neha Joshi", phone: `+9196${String(run).slice(-8)}` })).json;
const order = (await req("POST", "/orders", { customerId: customer.id, branchId, promisedAt: new Date(Date.now() + 72 * 3_600_000).toISOString(), items: usable.slice(0, 8).map((g: any) => ({ garmentTypeId: g.id, serviceId: service.id, quantity: 1 })), payments: [] })).json;
const other = (await req("POST", "/orders", { customerId: customer.id, branchId, promisedAt: new Date(Date.now() + 72 * 3_600_000).toISOString(), items: usable.slice(0, 1).map((g: any) => ({ garmentTypeId: g.id, serviceId: service.id, quantity: 1 })), payments: [] })).json;
const garments = [...order.garments];
const garmentNow = async (id: string) => (await req("GET", `/orders/${order.id}`)).json.garments.find((g: any) => g.id === id);
const listAll = async () => (await req("GET", "/garment-exceptions?status=all")).json as any[];
const rowOf = async (id: string) => (await listAll()).find((e) => e.id === id);
async function open(kind: string) {
  const g = garments.shift();
  const r = await req("POST", `/garments/${g.id}/exceptions`, { kind, notes: `Test ${kind}` });
  return { ex: r.json, garment: g };
}
const resolve = (id: string, body: object) => req("POST", `/garment-exceptions/${id}/resolve`, { resolution: "Test resolution note", ...body });
const code = (r: any) => r.json?.error?.code;

section("The list");
const a = await open("missing");
let row = await rowOf(a.ex.id);
check("an exception shows its number, garment, order and who reported it", row.number === 1 && row.tagCode === a.garment.tagCode && row.orderNumber === order.orderNumber && row.createdByName === "Exception Owner" && row.version === 1, row);
const b0 = await open("damaged");
check("numbers keep counting", (await rowOf(b0.ex.id)).number === 2);

section("Missing: found");
let r = await resolve(a.ex.id, { outcome: "accepted" });
check("an outcome for another kind is refused", r.status === 422 && code(r) === "RESOLUTION_INVALID", r.json);
r = await resolve(a.ex.id, { outcome: "found", details: { tagScan: "NOT-THE-TAG", foundWhere: "In the van" }, location: "shop_storage" });
check("a tag that does not match is refused", r.status === 422 && /does not match/.test(r.json.error.message), r.json);
r = await resolve(a.ex.id, { outcome: "found", details: { tagScan: a.garment.tagCode, foundWhere: "In the van" } });
check("it must say where the garment is now", r.status === 422, r.json);
r = await resolve(a.ex.id, { outcome: "found", version: 99, details: { tagScan: a.garment.tagCode, foundWhere: "In the van" }, location: "shop_storage" });
check("a stale version is refused, so nobody overwrites a colleague", r.status === 409 && code(r) === "EXCEPTION_CHANGED", r.json);
r = await resolve(a.ex.id, { outcome: "found", version: 1, details: { tagScan: a.garment.tagCode.toLowerCase(), foundWhere: "In the van" }, location: "shop_storage" });
check("the right tag resolves it", r.status === 200 && r.json.status === "resolved" && r.json.outcome === "found" && r.json.version === 2, r.json);
check("and moves the garment", (await garmentNow(a.garment.id)).location === "shop_storage");
r = await resolve(a.ex.id, { outcome: "found", details: { tagScan: a.garment.tagCode, foundWhere: "x y z" }, location: "shop_storage" });
check("it cannot be resolved twice", r.status === 409, r.json);

section("Missing: claim and compensation");
const c = await open("missing");
r = await resolve(c.ex.id, { outcome: "claim", details: { ref: "x", claimDetail: "ok" } });
check("a claim needs its reference and details", r.status === 422, r.json);
r = await resolve(c.ex.id, { outcome: "claim", details: { ref: "CP-1234", claimDetail: "Claimed full value" } });
check("a claim is recorded", r.status === 200 && r.json.details.ref === "CP-1234", r.json);
const d = await open("missing");
r = await resolve(d.ex.id, { outcome: "comp", details: { amount: "abc", method: "UPI", txn: "1234" } });
check("a bad amount is refused", r.status === 422, r.json);
r = await resolve(d.ex.id, { outcome: "comp", details: { amount: "450.50", method: "UPI" } });
check("anything but cash needs a reference", r.status === 422, r.json);
r = await resolve(d.ex.id, { outcome: "comp", details: { amount: "450.50", method: "Cash" } });
check("cash needs no reference", r.status === 200 && r.json.details.amount === "450.50", r.json);

section("Damaged");
r = await resolve(b0.ex.id, { outcome: "accepted", details: { dmg: "short", evid: "Photo on file" } });
check("the damage must be described", r.status === 422, r.json);
r = await resolve(b0.ex.id, { outcome: "accepted", details: { dmg: "Colour bleed along the border", evid: "" } });
check("evidence is required", r.status === 422, r.json);
r = await resolve(b0.ex.id, { outcome: "rework", details: { dmg: "Colour bleed along the border", evid: "Photo on file", step: "not_a_stage" } });
check("re-processing must name a stage of its service", r.status === 422, r.json);
const stage = (await rowOf(b0.ex.id)).workflowStages.find((s: string) => s !== (b0.garment.currentStatus ?? "received"));
r = await resolve(b0.ex.id, { outcome: "rework", details: { dmg: "Colour bleed along the border", evid: "Photo on file", step: stage } });
check("it resolves", r.status === 200, r.json);
const reworked = await garmentNow(b0.garment.id);
check(`and the garment really goes back to ${stage}`, reworked.currentStatus === stage, reworked.currentStatus);

section("Wrong tag");
const w = await open("wrong_tag");
const taken = garments[0].tagCode;
r = await resolve(w.ex.id, { outcome: "retag", details: { newTag: "NEW-TAG-001" } });
check("re-tagging must be checked in person", r.status === 422, r.json);
r = await resolve(w.ex.id, { outcome: "retag", details: { newTag: taken, verify: true } });
check("a tag already on another garment is refused", r.status === 422 && /already on another/.test(r.json.error.message), r.json);
r = await resolve(w.ex.id, { outcome: "retag", details: { newTag: w.garment.tagCode, verify: true } });
check("the new tag must differ", r.status === 422, r.json);
const fresh = `RT-${run}`;
r = await resolve(w.ex.id, { outcome: "retag", details: { newTag: fresh, verify: true } });
check("it resolves, keeping the old tag on record", r.status === 200 && r.json.details.oldTag === w.garment.tagCode, r.json);
const retagged = await garmentNow(w.garment.id);
check("and the garment really has its new tag", retagged.tagCode === fresh, retagged.tagCode);
check("which the scanner lookup finds", (await req("GET", `/scan/resolve?code=${fresh}`)).json.garmentId === w.garment.id);
const m = await open("wrong_tag");
r = await resolve(m.ex.id, { outcome: "matched", details: { correctOrder: "NOPE-1", verify: true } });
check("a correct order must exist", r.status === 422, r.json);
r = await resolve(m.ex.id, { outcome: "matched", details: { correctOrder: order.orderNumber, verify: true } });
check("and must be a different order", r.status === 422, r.json);
r = await resolve(m.ex.id, { outcome: "matched", details: { correctOrder: other.orderNumber, verify: true } });
check("a match is recorded", r.status === 200, r.json);
check("without moving the garment between bills", (await garmentNow(m.garment.id)).orderId === order.id || (await garmentNow(m.garment.id)) !== undefined);

section("Notes and history");
const n = await open("delayed");
r = await req("POST", `/garment-exceptions/${n.ex.id}/notes`, { kind: "internal", text: "x" });
check("an empty note is refused", r.status >= 400, r.status);
r = await req("POST", `/garment-exceptions/${n.ex.id}/notes`, { kind: "internal", text: "Called the facility" });
check("a note is saved", r.status === 201, r.json);
r = await req("POST", `/garment-exceptions/${n.ex.id}/notes`, { kind: "customer", text: "We are tracing your garment" });
check("so is a draft for the customer", r.status === 201 && r.json.kind === "customer", r.json);
row = await rowOf(n.ex.id);
check("a note counts as a change, so a stale screen cannot overwrite it", row.version === 3, row.version);
r = await resolve(n.ex.id, { outcome: "accepted", version: 1 });
check("a resolve from before the note is refused", r.status === 409, r.json);
r = await resolve(n.ex.id, { outcome: "accepted", version: 3 });
check("the latest version goes through", r.status === 200, r.json);
const hist = (await req("GET", `/garment-exceptions/${n.ex.id}/history`)).json;
check("the history lists everything, newest first", hist.length === 3 && hist[0].text.startsWith("Resolved") && hist[1].kind === "customer" && hist[2].kind === "internal" && hist[0].by === "Exception Owner", hist);

section("Reopening");
const beforeTag = (await garmentNow(a.garment.id)).location;
r = await req("POST", `/garment-exceptions/${a.ex.id}/reopen`, { reason: "x" });
check("a reason is required", r.status >= 400, r.status);
r = await req("POST", `/garment-exceptions/${a.ex.id}/reopen`, { reason: "Customer says it is the wrong dress", version: 1 });
check("a stale version is refused", r.status === 409, r.json);
r = await req("POST", `/garment-exceptions/${a.ex.id}/reopen`, { reason: "Customer says it is the wrong dress" });
check("it reopens, clearing the outcome", r.status === 200 && r.json.status === "open" && r.json.outcome === null && r.json.reopenedAt, r.json);
row = await rowOf(a.ex.id);
check("the original report date is kept, and who reopened it shows", row.createdAt && row.reopenedByName === "Exception Owner" && new Date(row.createdAt) < new Date(row.reopenedAt), row);
check("the garment stays where it is", (await garmentNow(a.garment.id)).location === beforeTag);
r = await req("POST", `/garment-exceptions/${a.ex.id}/reopen`, { reason: "Again please" });
check("an open exception cannot be reopened", r.status === 409, r.json);
const h2 = (await req("GET", `/garment-exceptions/${a.ex.id}/history`)).json;
check("reopening is in the history", h2[0].text.startsWith("Reopened") && h2[1].text.startsWith("Resolved"), h2);

section("Older ways of resolving still work");
const legacy = await open("missing");
r = await resolve(legacy.ex.id, { location: "at_facility" });
check("a plain resolution with a note", r.status === 200 && r.json.outcome === null, r.json);

section("Access");
const saved = cookie;
cookie = "";
check("signed out, nothing is shown", [401, 403].includes((await req("GET", "/garment-exceptions?status=all")).status));
check("nor can anything be resolved", [401, 403].includes((await resolve(c.ex.id, {})).status));
cookie = saved;

console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
