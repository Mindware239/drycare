/**
 * One transfer journey on the Facility transfers page, against the running server (API_URL, default http://127.0.0.1:4000):
 * packing, dispatch, receiving at the facility, the return, and everything that can go missing on the way.
 * Run: pnpm transfer-test. Creates a throwaway shop with an @test.local address.
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
const email = `transfer-${run}@test.local`, password = "CheckPass@2026x";
await req("POST", "/organizations", { ownerName: "Transfer Owner", email, password, businessName: `Transfer Shop ${run}`, country: "IN", acceptedTerms: true });
await req("POST", "/auth/login", { email, password });
const session = (await req("GET", "/auth/session")).json;
const branchId: string = session.branches[0].id;
const gts = (await req("GET", "/garment-types")).json, svcs = (await req("GET", "/services")).json;
const service = svcs.find((s: any) => /dry clean/i.test(s.name));
const prices = (await req("GET", `/branch-prices?branchId=${branchId}`)).json;
const usable = gts.filter((g: any) => prices.some((p: any) => p.garmentTypeId === g.id && p.serviceId === service.id));
await req("POST", "/cashier-shifts", { branchId, openingCash: 0 });
const customer = (await req("POST", "/customers", { name: "Priya Mehta", phone: `+9198${String(run).slice(-8)}` })).json;
async function newOrder(n: number) {
  const r = await req("POST", "/orders", { customerId: customer.id, branchId, promisedAt: new Date(Date.now() + 72 * 3_600_000).toISOString(), items: usable.slice(0, n).map((g: any) => ({ garmentTypeId: g.id, serviceId: service.id, quantity: 1 })), payments: [] });
  if (r.status !== 201) throw new Error(`Order failed: ${JSON.stringify(r.json)}`);
  return r.json;
}
const journeys = async () => (await req("GET", `/transfers/journeys?branchId=${branchId}`)).json as any[];
const rowOf = async (id: string) => (await journeys()).find((x) => x.id === id);
const waiting = async () => (await req("GET", `/transfers/waiting?branchId=${branchId}`)).json as any[];
const scan = async (id: string, code: string) => (await req("POST", `/transfers/${id}/scan`, { code })).json;
const start = async () => (await req("POST", "/transfers", { branchId, direction: "to_facility", facilityName: "Central plant" })).json;

const orderA = await newOrder(3);
const orderB = await newOrder(2);
const orderC = await newOrder(1);
const tagsOf = (o: any) => o.garments.map((g: any) => g.tagCode as string);
const bagOf = (o: any) => o.bags[0];

section("Waiting to send");
let pool = await waiting();
check("new orders' bags are waiting", [orderA, orderB, orderC].every((o) => pool.some((w) => w.id === bagOf(o).id)), pool.map((w) => w.bagCode));
check("each lists its garments", pool.find((w) => w.id === bagOf(orderA).id)?.garments.length === 3);

section("Packing");
const out = await start();
let row = await rowOf(out.id);
check("a new batch is packing", row?.stage === "packing" && row.garments === 0, row);
let r = await req("POST", `/transfers/${out.id}/dispatch`, {});
check("an empty batch cannot go", r.status === 422, r.json);
let s = await scan(out.id, bagOf(orderA).bagCode);
check("scanning a bag label adds it", s.result === "bag_added", s);
pool = await waiting();
check("so it is no longer waiting", !pool.some((w) => w.id === bagOf(orderA).id));
r = await req("POST", `/transfers/${out.id}/bags`, { bagId: bagOf(orderB).id });
check("with no scanner, a bag can be added by hand", r.status === 200 && r.json.bags.length === 2, r.json);
r = await req("POST", `/transfers/${out.id}/bags`, { bagId: bagOf(orderB).id });
check("but not twice", r.status === 409, r.json);
const other = await start();
r = await req("POST", `/transfers/${other.id}/bags`, { bagId: bagOf(orderB).id });
check("nor into a second batch", r.status === 422 && /already in batch/.test(r.json.error.message), r.json);
r = await req("DELETE", `/transfers/${other.id}`);
check("a draft can be discarded", r.status === 200 && !(await rowOf(other.id)), r.json);
for (const t of tagsOf(orderA)) await scan(out.id, t);
s = await scan(out.id, tagsOf(orderA)[0]);
check("a repeat scan is a duplicate", s.result === "duplicate", s);
s = await scan(out.id, "NOPE-000");
check("an unknown tag is refused", s.result === "not_found", s);
row = await rowOf(out.id);
check("the row shows bags, garments and scans", row.bags === 2 && row.garments === 5 && row.scanned === 3, row);
r = await req("POST", `/transfers/${out.id}/dispatch`, {});
check("garments added by hand must be scanned, or accepted", r.status === 422 && r.json.error.code === "UNVERIFIED_GARMENTS", r.json);
r = await req("POST", `/transfers/${out.id}/dispatch`, { acceptUnverified: true, expectedBackAt: new Date(Date.now() - 3_600_000).toISOString() });
check("expected back must be in the future", r.status === 422 && r.json.error.code === "EXPECTED_BACK_IN_PAST", r.json);
const backBy = new Date(Date.now() + 24 * 3_600_000).toISOString();
r = await req("POST", `/transfers/${out.id}/dispatch`, { acceptUnverified: true, expectedBackAt: backBy, transportReference: "MH 01 AB 1234" });
check("it dispatches, with the date and vehicle", r.status === 200 && r.json.status === "dispatched" && r.json.transportReference === "MH 01 AB 1234", r.json);
row = await rowOf(out.id);
check("the row is in transit, with its back-by date", row.stage === "transit" && new Date(row.expectedBackAt).toISOString() === backBy, row);
r = await req("DELETE", `/transfers/${out.id}`);
check("a dispatched batch cannot be discarded", r.status === 422, r.json);
r = await req("POST", `/transfers/${out.id}/start-return`, {});
check("it cannot come back before it arrives", r.status === 422 && r.json.error.code === "NOT_AT_FACILITY", r.json);

section("At the facility");
const all = [...tagsOf(orderA), ...tagsOf(orderB)];
const lostTag = tagsOf(orderA)[2];
for (const t of all) if (t !== lostTag) await scan(out.id, t);
row = await rowOf(out.id);
check("progress counts what arrived", row.arrived === 4, row);
r = await req("POST", `/transfers/${out.id}/receive`, {});
check("unscanned garments block a plain receipt", r.status === 422 && r.json.error.code === "GARMENTS_MISSING", r.json);
r = await req("POST", `/transfers/${out.id}/receive`, { partial: true });
check("a reason is required", r.status === 400, r.json);
r = await req("POST", `/transfers/${out.id}/receive`, { partial: true, notes: "Not in the bag when opened" });
check("it can finish with one flagged missing", r.status === 200 && r.json.status === "received_with_exceptions", r.json);
row = await rowOf(out.id);
check("it stays active, at the facility, showing the missing one", row.stage === "at_facility" && row.missing === 1 && row.atFacility === 4 && row.backExpected === 4, row);

section("Coming back");
r = await req("POST", `/transfers/${out.id}/start-return`, {});
const ret = r.json;
check("the return starts on its way, linked to the batch", r.status === 200 && ret.status === "dispatched" && ret.direction === "to_shop" && ret.returnOfBatchId === out.id, r.json);
r = await req("POST", `/transfers/${out.id}/start-return`, {});
check("asking twice gives the same return", r.json.id === ret.id, r.json);
const list = await journeys();
check("the journey stays one row", !list.some((x) => x.id === ret.id) && list.find((x) => x.id === out.id)?.returnId === ret.id);
check("garments are on their way to the shop", ret.garments.filter((g: any) => g.location === "in_transit_to_shop").length === 4 && ret.garments.filter((g: any) => g.location === "missing").length === 1, ret.garments.map((g: any) => g.location));
const backTags = all.filter((t) => t !== lostTag);
for (const t of backTags.slice(0, 3)) await scan(ret.id, t);
row = await rowOf(out.id);
check("progress counts what is back", row.back === 3 && row.stage === "at_facility", row);
const notes = "One still at the plant";
r = await req("POST", `/transfers/${ret.id}/receive`, {});
check("one not back blocks a plain finish", r.status === 422 && r.json.error.code === "GARMENTS_MISSING" && /1 of 4/.test(r.json.error.message), r.json);

section("The missing one turns up");
s = await scan(ret.id, lostTag);
check("a garment flagged missing can be scanned back", s.result === "verified", s);
row = await rowOf(out.id);
check("which clears its flag", row.missing === 0, row);
await scan(ret.id, backTags[3]);
r = await req("POST", `/transfers/${ret.id}/receive`, {});
check("all back, the return finishes", r.status === 200 && r.json.status === "received", r.json);
row = await rowOf(out.id);
check("and the journey is done", row.stage === "done" && row.missing === 0 && Boolean(row.doneAt), row);
const order = (await req("GET", `/orders/${orderA.id}`)).json;
check("the garment that turned up is back at the shop", order.garments.find((g: any) => g.tagCode === lostTag)?.location === "shop_storage", order.garments?.map((g: any) => g.location));

section("A garment that never comes back");
const out2 = await start();
await scan(out2.id, bagOf(orderC).bagCode);
await scan(out2.id, tagsOf(orderC)[0]);
const orderD = await newOrder(2);
await scan(out2.id, bagOf(orderD).bagCode);
for (const t of tagsOf(orderD)) await scan(out2.id, t);
await req("POST", `/transfers/${out2.id}/dispatch`, {});
await scan(out2.id, tagsOf(orderC)[0]);
await scan(out2.id, tagsOf(orderD)[0]);
await req("POST", `/transfers/${out2.id}/receive`, { partial: true, notes: "Second garment not found" });
const flagged = await rowOf(out2.id);
check("one is flagged at the facility", flagged.missing === 1 && flagged.atFacility === 2, flagged);
const ret2 = (await req("POST", `/transfers/${out2.id}/start-return`, {})).json;
await scan(ret2.id, tagsOf(orderC)[0]);
r = await req("POST", `/transfers/${ret2.id}/receive`, {});
check("a garment expected but not back blocks a plain finish", r.status === 422, r.json);
r = await req("POST", `/transfers/${ret2.id}/receive`, { partial: true, notes: "Facility cannot find it" });
check("it can finish with it flagged", r.status === 200 && r.json.status === "received_with_exceptions", r.json);
row = await rowOf(out2.id);
check("the journey is done, showing both missing", row.stage === "done" && row.missing === 2, row);
const exceptions = (await req("GET", "/garment-exceptions")).json.filter((e: any) => e.orderId === orderD.id);
check("one exception per garment, not two", exceptions.length === 2, exceptions.map((e: any) => e.tagCode));

section("A garment already flagged missing is not flagged twice");
const orderE = await newOrder(2);
const out3 = await start();
await scan(out3.id, bagOf(orderE).bagCode);
for (const t of tagsOf(orderE)) await scan(out3.id, t);
await req("POST", `/transfers/${out3.id}/dispatch`, {});
await scan(out3.id, tagsOf(orderE)[0]);
await req("POST", `/transfers/${out3.id}/receive`, { partial: true, notes: "Second garment not found" });
const ret3 = (await req("POST", `/transfers/${out3.id}/start-return`, {})).json;
await scan(ret3.id, tagsOf(orderE)[0]);
r = await req("POST", `/transfers/${ret3.id}/receive`, {});
check("everything expected back finishes, with no reason needed", r.status === 200 && r.json.status === "received_with_exceptions", r.json);
const once = (await req("GET", "/garment-exceptions")).json.filter((e: any) => e.orderId === orderE.id);
check("it keeps its first exception only", once.length === 1, once.length);
row = await rowOf(out3.id);
check("and still shows as missing", row.stage === "done" && row.missing === 1, row);

section("Everything back to the shop");
pool = await waiting();
check("returned garments are not waiting to be sent again", !pool.some((w) => w.id === bagOf(orderA).id), pool.map((w) => w.bagCode));

section("Access");
const saved = cookie;
cookie = "";
check("signed out, nothing is shown", [401, 403].includes((await req("GET", `/transfers/journeys?branchId=${branchId}`)).status));
cookie = saved;

console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
