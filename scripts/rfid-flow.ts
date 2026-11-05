/**
 * A garment's whole life with an RFID tag, through the API: intake, production, racks, the facility and back, stock
 * checks, delivery, tracking and the tag going back into the pool. Run: pnpm rfid-test
 * No reader is involved: a handheld only types tag numbers, which is what this sends.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { buildServer } from "../apps/api/src/app";
import { db, schema, sqlClient } from "../apps/api/src/db/client";

const app = await buildServer();
const runId = randomUUID().slice(0, 8);
let failures = 0;
const results: string[] = [];
function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) results.push(`  ✓ ${label}`);
  else { failures++; results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 500)}` : ""}`); }
}
class Client {
  cookie = "";
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({ method: method as "GET", url: `/api/v1${url}`, payload: body as object, headers: { cookie: this.cookie, "x-drycare-csrf": "1", ...headers } });
    const set = res.headers["set-cookie"];
    if (set) this.cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
    let json: any;
    try { json = res.json(); } catch { /* Not every answer is JSON. */ }
    return { status: res.statusCode, json };
  }
}

const platform = (await db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.slug, "drycare-platform") }))!;
const role = (await db.query.roles.findFirst({ where: (r, { and, eq }) => and(eq(r.organizationId, platform.id), eq(r.key, "platform_admin")) }))!;
const [saUser] = await db.insert(schema.users).values({ email: `sa-rfid-${runId}@test.local`, name: "RFID Test Admin", passwordHash: "x", isPlatformAdmin: true }).returning();
await db.insert(schema.memberships).values({ organizationId: platform.id, userId: saUser.id, roleId: role.id });
const token = randomBytes(32).toString("base64url");
await db.insert(schema.sessions).values({ id: createHash("sha256").update(token).digest("hex"), userId: saUser.id, organizationId: platform.id, expiresAt: new Date(Date.now() + 3600_000) });
const sa = new Client();
sa.cookie = `dc_session=${token}`;

async function signup(label: string) {
  const c = new Client();
  const r = await c.req("POST", "/organizations", { businessName: `RFID Flow ${label} ${runId}`, ownerName: "RFID Owner", email: `rfid-${label}-${runId}@test.local`, password: `Flow-${runId}-Password1`, acceptedTerms: true });
  if (r.status !== 201) throw new Error(JSON.stringify(r.json));
  const session = (await c.req("GET", "/auth/session")).json;
  return { c, orgId: session.organization.id as string, branchId: session.branches[0].id as string };
}
const hex = runId.toUpperCase().replace(/[^0-9A-F]/g, "0");
const epc = (n: number) => `E280${hex}${String(n).padStart(12, "0")}`;

try {
  const { c: shop, orgId, branchId } = await signup("a");
  await sa.req("POST", `/platform-admin/organizations/${orgId}/addons/rfid`, { months: 1, amountPaise: 0 });
  await shop.req("POST", "/cashier-shifts", { branchId, openingCash: 0 });
  const serviceId = (await shop.req("POST", "/services", { name: `RFID clean ${runId}`, category: "Dry Clean", serviceCode: `R${runId}`.slice(0, 8).toUpperCase(), unitType: "per_piece", workflowStages: ["received", "cleaning", "finishing", "ready"] })).json.id;
  const garmentTypeId = (await shop.req("POST", "/garment-types", { name: `RFID Suit ${runId}`, category: "Men" })).json.id;
  const priceList = (await shop.req("GET", "/price-lists")).json[0];
  await shop.req("POST", `/price-lists/${priceList.id}/prices`, { garmentTypeId, serviceId, unitPrice: 10000, taxBps: 0 });
  const customerId = (await shop.req("POST", "/customers", { name: "Rfid Customer", phone: `+91 95${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` })).json.id;
  const rackId = (await shop.req("POST", "/storage-locations", { branchId, code: `R${runId}`.slice(0, 8), description: "Test rack" })).json.id;
  const order = async (quantity: number, key: string) => (await shop.req("POST", "/orders", { customerId, branchId, items: [{ garmentTypeId, serviceId, quantity }], promisedAt: new Date(Date.now() + 864e5).toISOString(), payments: [] }, { "idempotency-key": `${key}-${runId}` })).json;
  const read = async (epcs: string[], extra: object = {}) => (await shop.req("POST", "/rfid/read", { epcs, ...extra })).json.items as any[];
  const move = async (item: any, to: string) => shop.req("POST", `/garments/${item.garmentId}/transitions`, { to, version: item.version });

  // ---- Intake
  const o1 = await order(4, "o1");
  for (let i = 0; i < 4; i++) await shop.req("POST", "/rfid/link", { garmentId: o1.garments[i].id, epc: epc(i + 1) });
  let r = await shop.req("GET", `/orders/${o1.id}`);
  check("the order shows each garment's tag", r.json.garments.every((g: any) => g.rfid), r.json.garments);
  r = await shop.req("GET", `/customers/${customerId}/garments`);
  check("the customer's record shows them too", r.json.filter((g: any) => g.rfid).length === 4, r.json);

  // ---- Production, by reading tags
  let items = await read([epc(1)]);
  check("a read says what is next for the garment", items[0].stage === "received" && items[0].workflowStages.includes("cleaning") && typeof items[0].version === "number", items[0]);
  for (const to of ["cleaning", "finishing"]) { r = await move(items[0], to); items = await read([epc(1)], { silent: true }); }
  check("a garment moves through its stages by tag", items[0].stage === "finishing", items[0]);
  r = await move(items[0], "ready");
  check("ready still needs a rack", r.status === 422 && r.json.error.code === "LOCATION_REQUIRED", r.json);
  r = await shop.req("POST", `/garments/${items[0].garmentId}/storage-location`, { storageLocationId: rackId });
  items = await read([epc(1)], { silent: true });
  check("the rack shows on the next read", !!items[0].rack, items[0]);
  r = await move(items[0], "ready");
  check("with a rack it becomes ready", r.status === 200 && r.json.currentStatus === "ready", r.json);
  items = await read([epc(1)], { silent: true });
  r = await move(items[0], "delivered");
  check("a read cannot skip handover", r.status === 422 || r.status === 403, r.json);

  // ---- The facility and back
  const o2 = await order(2, "o2");
  await shop.req("POST", "/rfid/link", { garmentId: o2.garments[0].id, epc: epc(11) });
  await shop.req("POST", "/rfid/link", { garmentId: o2.garments[1].id, epc: epc(12) });
  const batch = async (direction: string) => (await shop.req("POST", "/transfers", { branchId, direction, facilityName: "Central Plant", transportReference: "VAN-7" })).json.id as string;
  const scan = async (id: string, code: string) => (await shop.req("POST", `/transfers/${id}/scan`, { code })).json;
  const out = await batch("to_facility");
  let s = await scan(out, epc(11));
  check("a tag read loads its bag onto the transfer", ["verified", "bag_added"].includes(s.result), s);
  s = await scan(out, epc(12));
  check("the bag's other garment is verified by its tag", s.result === "verified", s);
  s = await scan(out, epc(12));
  check("a repeated read is only a duplicate", s.result === "duplicate", s);
  r = await shop.req("POST", `/transfers/${out}/dispatch`, {});
  check("the transfer goes out", r.status === 200, r.json);
  await scan(out, epc(11));
  await scan(out, epc(12));
  r = await shop.req("POST", `/transfers/${out}/receive`, {});
  check("the facility receives it by tags", r.status === 200, r.json);
  items = await read([epc(11)], { silent: true });
  check("the tag shows the garment at the facility", items[0].location === "at_facility", items[0]);
  r = await shop.req("POST", "/rfid/stock-check", { branchId, place: "facility", epcs: [epc(11)] });
  check("a stock check at the facility finds one and misses one", r.status === 200 && r.json.expected === 2 && r.json.found === 1 && r.json.missing[0]?.scanCode === o2.garments[1].scanCode, r.json);

  // ---- Stock check at the shop
  const free = epc(90);
  await shop.req("POST", "/rfid/tags", { epcs: [free] });
  r = await shop.req("GET", `/rfid/expected?branchId=${branchId}&place=shop`);
  check("the shop knows how many tags to expect", r.json.expected === 4 && r.json.untagged === 0, r.json);
  const o3 = await order(1, "o3");
  r = await shop.req("GET", `/rfid/expected?branchId=${branchId}&place=shop`);
  check("a garment with no tag is counted separately", r.json.expected === 4 && r.json.untagged === 1, r.json);
  r = await shop.req("POST", "/rfid/stock-check", { branchId, place: "shop", epcs: [epc(1), epc(2), epc(3), epc(11), free, "ABCDEF0011223344"] });
  check("found, missing and misplaced are all reported", r.json.found === 3 && r.json.missing.length === 1 && r.json.missing[0].scanCode === o1.garments[3].scanCode && r.json.unexpected.length === 3, r.json);
  const states = r.json.unexpected.map((u: any) => u.state).sort();
  check("it says why each does not belong", JSON.stringify(states) === JSON.stringify(["free", "linked", "unknown"]), states);
  r = await shop.req("POST", "/rfid/stock-check", { branchId, place: "shop", rackId, epcs: [epc(1)] });
  check("one rack can be checked on its own", r.json.expected === 1 && r.json.found === 1 && r.json.missing.length === 0, r.json);
  r = await shop.req("GET", `/tags/trace?code=${epc(1)}`);
  check("the record shows the tag and where it was last seen", r.json.rfid?.epc === epc(1) && String(r.json.rfid?.lastSeen?.notes).includes("Stock check"), r.json.rfid);

  // ---- Finding things
  r = await shop.req("GET", `/tags?search=${epc(2)}`);
  check("tag tracking finds a garment by its RFID number", r.json.rows.length === 1 && r.json.rows[0].rfid === epc(2), r.json);
  r = await shop.req("GET", "/tags?rfid=without");
  check("tag tracking lists garments with no tag", r.json.rows.length === 1 && r.json.rows[0].id === o3.garments[0].id && r.json.summary.withRfid === 0, r.json.summary);
  r = await shop.req("GET", "/tags?rfid=with");
  check("and counts those with one", r.json.summary.withRfid === 6, r.json.summary);
  r = await shop.req("GET", `/garments/by-tag/${epc(2).toLowerCase()}`);
  check("the scan station accepts a tag typed in any case", r.status === 200 && r.json.id === o1.garments[1].id, r.json);

  // ---- Delivery
  const o4 = await order(2, "o4");
  await shop.req("POST", "/rfid/link", { garmentId: o4.garments[0].id, epc: epc(21) });
  await shop.req("POST", "/rfid/link", { garmentId: o4.garments[1].id, epc: epc(22) });
  await sqlClient`update garments set current_status = 'ready', qc_passed_at = now() where order_id = ${o4.id}`;
  await sqlClient`update orders set operational_status = 'ready' where id = ${o4.id}`;
  const balance = (await shop.req("GET", `/orders/${o4.id}`)).json.invoice.balance;
  await shop.req("POST", `/orders/${o4.id}/payments`, { payments: [{ amount: balance, method: "cash" }] }, { "idempotency-key": `o4-pay-${runId}` });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const stop = (await shop.req("POST", "/deliveries", { kind: "delivery", customerId, branchId, orderId: o4.id, address: { line1: "12 Main Road", city: "Mumbai" }, scheduledDate: today, timeSlot: "10:00-12:00" })).json;
  r = await shop.req("GET", `/deliveries/${stop.id}`);
  check("a delivery's list holds each garment's tag, for the bagging screen", r.json.items?.every((i: any) => [epc(21), epc(22)].includes(i.rfid)), r.json.items);
  const me = (await shop.req("GET", "/auth/session")).json.user.id;
  r = await shop.req("POST", `/deliveries/${stop.id}/assign`, { driverUserId: me });
  check("a rider is assigned", r.status === 200, r.json);
  r = await shop.req("POST", `/deliveries/${stop.id}/dispatch`, { scannedTags: o4.garments.map((g: any) => g.tagCode) });
  check("the delivery goes out", r.status === 200, r.json);
  items = await read([epc(21)], { silent: true });
  check("the tag stays on the garment while out", items[0].state === "linked" && items[0].stage === "dispatched", items[0]);
  r = await shop.req("POST", "/rfid/stock-check", { branchId, place: "shop", epcs: [epc(21)] });
  check("a garment out for delivery counts as should not be here", r.json.unexpected.some((u: any) => u.epc === epc(21)), r.json.unexpected);
  r = await shop.req("POST", `/deliveries/${stop.id}/complete`, { outcome: "completed", method: "in_person", receivedBy: "Rfid Customer" });
  check("the delivery completes", r.status === 200, r.json);
  items = await read([epc(21), epc(22)], { silent: true });
  check("then both tags are free for the next garments", items.every((i) => i.state === "free"), items);
  const o5 = await order(1, "o5");
  r = await shop.req("POST", "/rfid/link", { garmentId: o5.garments[0].id, epc: epc(21) });
  check("a freed tag goes on the next garment", r.status === 201, r.json);
  r = await shop.req("GET", `/tags/trace?code=${o4.garments[0].scanCode}`);
  check("the old garment's history still shows its tag", r.json.timeline.some((e: any) => e.type === "rfid" && e.action === "released"), r.json.timeline);
  r = await shop.req("POST", `/orders/${o5.id}/cancel`, { reason: "Customer changed their mind" });
  items = await read([epc(21)], { silent: true });
  check("a cancelled order frees its tags too", items[0].state === "free", items[0]);

  // ---- Who can see what
  await shop.req("POST", "/staff", { name: "Counter", email: `rec-${runId}@test.local`, password: `Staff-${runId}-Password1`, roleKey: "operator", branchIds: [branchId] });
  const operator = new Client();
  await operator.req("POST", "/auth/login", { email: `rec-${runId}@test.local`, password: `Staff-${runId}-Password1` });
  r = await operator.req("POST", "/rfid/basket", { epcs: [epc(2)] });
  check("production staff can read a basket, but see no money", r.status === 200 && r.json.orders[0].balance === undefined, r.json);
  const { c: other, orgId: otherOrg, branchId: otherBranch } = await signup("b");
  r = await other.req("GET", `/rfid/summary`);
  check("another shop has no RFID until it pays", r.status === 403, r.json);
  await sa.req("POST", `/platform-admin/organizations/${otherOrg}/addons/rfid`, { months: 1, amountPaise: 0 });
  r = await other.req("POST", "/rfid/read", { epcs: [epc(2)] });
  check("another shop's reader learns nothing about this shop's tag", r.json.items[0].state === "unknown", r.json);
  r = await other.req("GET", `/garments/by-tag/${epc(2)}`);
  check("nor can it open the garment", r.status === 404, r.json);
  r = await other.req("POST", "/rfid/stock-check", { branchId: otherBranch, epcs: [epc(2)] });
  check("its stock check does not see it either", r.status === 200 && r.json.expected === 0 && r.json.unexpected[0].state === "unknown", r.json);
} finally {
  await sqlClient`delete from sessions where user_id = ${saUser.id}`;
  await app.close();
  await sqlClient.end();
}
console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll RFID checks passed");
process.exit(failures ? 1 : 0);
