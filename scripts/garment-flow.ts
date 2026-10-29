/**
 * End-to-end garment journey against a real database: intake with advance → unique garment tags in
 * a bag → label printing → dispatch to facility → receipt → processing → return with scan
 * verification → final billing with discount → settlement → handover. Run: pnpm flow-test
 * Uses fresh @test.local tenants each run, so it is safe to repeat.
 */
import { randomUUID } from "node:crypto";
import { buildServer } from "../apps/api/src/app";
import { sqlClient } from "../apps/api/src/db/client";

const app = await buildServer();
let failures = 0;
const results: string[] = [];
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) results.push(`  ✓ ${label}`);
  else {
    failures++;
    results.push(
      `  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 400)}` : ""}`,
    );
  }
}
const section = (title: string) => results.push(`\n${title}`);

class Client {
  cookie = "";
  async req(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await app.inject({
      method: method as "GET",
      url: `/api/v1${url}`,
      payload: body as object,
      headers: { cookie: this.cookie, "x-drycare-csrf": "1", ...headers },
    });
    const set = res.headers["set-cookie"];
    if (set) this.cookie = (Array.isArray(set) ? set[0] : set).split(";")[0];
    let json: any;
    try {
      json = res.json();
    } catch {}
    return { status: res.statusCode, json };
  }
}

const runId = randomUUID().slice(0, 6);
const c = new Client();
// Signup without a branch code: the server derives it.
let r = await c.req("POST", "/organizations", {
  businessName: `Flow Laundry ${runId}`,
  ownerName: "Flow Owner",
  email: `owner-flow-${runId}@test.local`,
  password: `Flow-${runId}-Password1`,
  acceptedTerms: true,
});
check("signup works without a branch code", r.status === 201, r.json);
const session = (await c.req("GET", "/auth/session")).json;
const branchId: string = session.branches[0].id;
check(
  "first branch is named Main Store with a derived code",
  session.branches[0].name === "Main Store" &&
    /^[A-Z0-9]{2,6}$/.test(session.branches[0].code),
  session.branches[0],
);

// ---- catalogue: a simple service and the five example garments at the example prices (no GST)
r = await c.req("POST", "/services", {
  name: "Flow clean",
  category: "Dry Clean",
  serviceCode: "FLOW",
  unitType: "per_piece",
  workflowStages: ["received", "cleaning", "finishing", "ready"],
});
const serviceId: string = r.json.id;
const types = (await c.req("GET", "/garment-types")).json as {
  id: string;
  name: string;
}[];
async function garmentType(name: string) {
  const found = types.find((t) => t.name === name);
  if (found) return found.id;
  return (await c.req("POST", "/garment-types", { name, category: "Men" })).json
    .id as string;
}
const list = (await c.req("GET", "/price-lists")).json[0];
const catalogue: [string, number][] = [
  ["Shirt", 10000],
  ["Trousers", 12000],
  ["Underwear", 4000],
  ["Tie", 3000],
  ["Coat", 25000],
];
const ids: Record<string, string> = {};
for (const [name, price] of catalogue) {
  ids[name] = await garmentType(name);
  r = await c.req("POST", `/price-lists/${list.id}/prices`, {
    garmentTypeId: ids[name],
    serviceId,
    unitPrice: price,
    taxBps: 0,
  });
  if (r.status !== 201) check(`price for ${name}`, false, r.json);
}
r = await c.req("GET", `/branch-prices?branchId=${branchId}`);
check(
  "branch prices endpoint returns the counter prices",
  r.json.filter((p: any) => p.serviceId === serviceId).length === 5,
  r.json.length,
);

await c.req("POST", "/cashier-shifts", { branchId, openingCash: 0 });
r = await c.req("POST", "/customers", {
  name: "Flow Customer",
  phone: `+91 98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
});
const customerId: string = r.json.id;

// ---- intake: five garments, ₹150 advance now (a second ₹50 advance follows)
section("Intake");
const promisedAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
r = await c.req(
  "POST",
  "/orders",
  {
    customerId,
    branchId,
    promisedAt,
    items: catalogue.map(([name]) => ({
      garmentTypeId: ids[name],
      serviceId,
      quantity: 1,
    })),
    payments: [{ amount: 15000, method: "cash" }],
  },
  { "idempotency-key": `flow-${runId}` },
);
check("order created", r.status === 201, r.json);
let order = r.json;
const orderId: string = order.id;
check(
  "order subtotal is ₹540",
  order.invoice.grandTotal === 54000,
  order.invoice,
);
check(
  "five garments get five different tags",
  order.garments.length === 5 &&
    new Set(order.garments.map((g: any) => g.tagCode)).size === 5,
);
check(
  "one bag expecting five garments",
  order.bags.length === 1 &&
    order.bags[0].expectedCount === 5 &&
    order.bags[0].bagCode === `${order.orderNumber}-B1`,
  order.bags,
);
check(
  "every garment is in that bag at the shop counter",
  order.garments.every(
    (g: any) => g.bagId === order.bags[0].id && g.location === "shop_counter",
  ),
);
r = await c.req(
  "POST",
  "/orders",
  {
    customerId,
    branchId,
    promisedAt,
    items: catalogue.map(([name]) => ({
      garmentTypeId: ids[name],
      serviceId,
      quantity: 1,
    })),
    payments: [{ amount: 15000, method: "cash" }],
  },
  { "idempotency-key": `flow-${runId}` },
);
check(
  "retrying the same intake does not create a duplicate order",
  r.json.id === orderId,
);
r = await c.req("POST", `/orders/${orderId}/payments`, {
  payments: [{ amount: 5000, method: "upi", reference: `UPI${runId}` }],
});
order = r.json;
check(
  "second advance: ₹200 paid, ₹340 estimated balance",
  order.invoice.paid === 20000 && order.invoice.balance === 34000,
  order.invoice,
);
r = await c.req("POST", `/orders/${orderId}/payments`, {
  payments: [{ amount: 34001, method: "cash" }],
});
check(
  "cannot collect more than the balance",
  r.status === 422 && r.json.error.code === "OVERPAYMENT",
  r.json,
);

const bagCode: string = order.bags[0].bagCode;
const tags: Record<string, string> = Object.fromEntries(
  order.items.map((i: any) => [
    i.garmentTypeName,
    order.garments.find((g: any) => g.orderItemId === i.id).tagCode,
  ]),
);
r = await c.req(
  "GET",
  `/scan/resolve?code=${encodeURIComponent(tags.Tie.toLowerCase())}`,
);
check(
  "a garment tag resolves to its order and bag",
  r.json.orderId === orderId &&
    r.json.bagId === order.bags[0].id &&
    r.json.kind === "garment",
  r.json,
);
r = await c.req("GET", `/scan/resolve?code=${bagCode}`);
check(
  "the bag code resolves to its order",
  r.json.orderId === orderId && r.json.kind === "bag",
);

// ---- labels
section("Labels");
r = await c.req("POST", `/orders/${orderId}/print-jobs`, { scope: "all" });
check(
  "print job covers 1 bag label + 5 garment tags",
  r.json.labelCount === 6 && r.json.status === "pending",
  r.json,
);
r = await c.req("POST", `/print-jobs/${r.json.id}/result`, {
  status: "failed",
  error: "Printer offline",
});
check("failed print is recorded as failed", r.json.status === "failed");
r = await c.req("POST", `/orders/${orderId}/print-jobs`, { scope: "all" });
const jobId = r.json.id;
r = await c.req("POST", `/print-jobs/${jobId}/result`, { status: "printed" });
r = await c.req("POST", `/print-jobs/${jobId}/result`, { status: "printed" });
check("a print job can only be confirmed once", r.status === 409);
r = await c.req("POST", `/orders/${orderId}/labels/reprint`, {});
order = (await c.req("GET", `/orders/${orderId}`)).json;
check(
  "reprinting keeps the same order, bag and tags",
  order.bags.length === 1 &&
    order.bags[0].bagCode === bagCode &&
    order.garments.length === 5 &&
    order.bags[0].labelPrintCount === 1,
);

// ---- dispatch to facility
section("Shop → facility");
async function batch(direction: "to_facility" | "to_shop") {
  return (
    await c.req("POST", "/transfers", {
      branchId,
      direction,
      facilityName: "Central Plant",
      transportReference: "VAN-7",
    })
  ).json.id as string;
}
const scan = async (batchId: string, code: string) =>
  (await c.req("POST", `/transfers/${batchId}/scan`, { code })).json;
const out = await batch("to_facility");
check(
  "scanning the bag adds it to the batch",
  (await scan(out, bagCode)).result === "bag_added",
);
r = await c.req("POST", `/transfers/${out}/dispatch`, {});
check(
  "dispatch is refused until garments are scanned into the bag",
  r.status === 422 && r.json.error.code === "UNVERIFIED_GARMENTS",
  r.json,
);
for (const t of Object.values(tags)) await scan(out, t);
check(
  "a repeat scan is reported as duplicate",
  (await scan(out, tags.Shirt)).result === "duplicate",
);
check(
  "an unknown code is reported",
  (await scan(out, "NOPE-123")).result === "not_found",
);
r = await c.req("GET", `/transfers/${out}`);
check(
  "duplicate scans do not double count",
  r.json.garments.filter((g: any) => g.dispatchVerified).length === 5,
);
r = await c.req("POST", `/transfers/${out}/dispatch`, {});
check(
  "batch dispatched",
  r.json.status === "dispatched" && r.json.dispatchedAt,
  r.json.status,
);
order = (await c.req("GET", `/orders/${orderId}`)).json;
check(
  "garments are in transit to the facility",
  order.garments.every((g: any) => g.location === "in_transit_to_facility"),
);
check(
  "the bag cannot join a second batch while in transit",
  (await scan(await batch("to_facility"), bagCode)).result === "unexpected",
);
for (const t of Object.values(tags)) await scan(out, t);
r = await c.req("POST", `/transfers/${out}/receive`, {});
check(
  "facility receipt with all five verified",
  r.json.status === "received",
  r.json,
);
order = (await c.req("GET", `/orders/${orderId}`)).json;
check(
  "garments are at the facility",
  order.garments.every((g: any) => g.location === "at_facility"),
);

// ---- processing at the facility
for (const g of order.garments)
  for (const to of ["cleaning", "finishing", "ready"]) {
    r = await c.req("POST", `/garments/${g.id}/transitions`, { to });
    if (r.status !== 200)
      check(`transition ${g.tagCode} → ${to}`, false, r.json);
  }

// ---- return to shop, with a missing garment caught
section("Facility → shop (return receiving)");
const back = await batch("to_shop");
check(
  "bag added to the return batch",
  (await scan(back, bagCode)).result === "bag_added",
);
for (const t of Object.values(tags)) await scan(back, t);
await c.req("POST", `/transfers/${back}/dispatch`, {});
for (const name of ["Shirt", "Trousers", "Tie", "Coat"])
  await scan(back, tags[name]);
r = await c.req("POST", `/transfers/${back}/receive`, {});
check(
  "4 of 5 scanned: receipt refused and the underwear is named",
  r.status === 422 &&
    r.json.error.code === "GARMENTS_MISSING" &&
    r.json.error.message.includes(tags.Underwear),
  r.json,
);
r = await c.req("GET", `/transfers/${back}`);
check(
  "expected vs received is visible (5 expected, 4 received)",
  r.json.garments.length === 5 &&
    r.json.garments.filter((g: any) => g.receiptVerified).length === 4,
);
await scan(back, tags.Underwear);
r = await c.req("POST", `/transfers/${back}/receive`, {});
check("all five verified: received back at shop", r.json.status === "received");
order = (await c.req("GET", `/orders/${orderId}`)).json;
check(
  "garments are back at the shop and ready",
  order.garments.every(
    (g: any) => g.location === "shop_storage" && g.currentStatus === "ready",
  ),
);
check(
  "timeline records the location moves",
  order.history.some(
    (h: any) =>
      h.previous_location === "at_facility" &&
      h.new_location === "in_transit_to_shop",
  ),
);

// ---- final billing
section("Final billing");
r = await c.req("POST", `/orders/${orderId}/collection-discount`, {
  type: "fixed",
  value: 4000,
  reason: "Regular customer",
  preview: true,
});
check(
  "preview: ₹500 total, ₹300 due",
  r.json.newGrandTotal === 50000 && r.json.balanceAfter === 30000,
  r.json,
);
r = await c.req("POST", `/orders/${orderId}/collection-discount`, {
  type: "fixed",
  value: 4000,
  reason: "Regular customer",
});
check(
  "₹40 discount issued as a credit note",
  r.status === 201 && r.json.creditNote.totalAmount === 4000,
  r.json,
);
order = r.json.order;
check(
  "totals: ₹540 − ₹40 = ₹500, ₹200 advance applied once, ₹300 due",
  order.invoice.grandTotal === 54000 &&
    order.invoice.credits === 4000 &&
    order.invoice.payable === 50000 &&
    order.invoice.paid === 20000 &&
    order.invoice.balance === 30000,
  order.invoice,
);
r = await c.req("POST", `/orders/${orderId}/collection-discount`, {
  type: "fixed",
  value: 1000,
  reason: "Again",
});
check("the discount cannot be applied twice", r.status === 409, r.json);

r = await c.req("POST", `/orders/${orderId}/payments`, {
  payments: [
    {
      amount: 30000,
      method: "bank_transfer",
      reference: `NEFT${runId}`,
      awaitingVerification: true,
    },
  ],
});
order = r.json;
check(
  "pending bank transfer does not count as paid",
  order.invoice.balance === 30000,
  order.invoice,
);
r = await c.req("POST", `/orders/${orderId}/handover`, {
  garmentIds: order.garments.map((g: any) => g.id),
  method: "counter",
});
check(
  "handover blocked while ₹300 is unpaid",
  r.status === 422 && r.json.error.code === "BALANCE_DUE",
  r.json,
);
const pendingId = order.payments.find((p: any) => p.status === "pending").id;
r = await c.req("POST", `/payments/${pendingId}/verify`, {
  outcome: "rejected",
  note: "Not in bank statement",
});
check(
  "rejected transfer stays unpaid",
  r.json.invoice.balance === 30000 &&
    r.json.payments.some((p: any) => p.status === "failed"),
);
r = await c.req("POST", `/orders/${orderId}/payments`, {
  payments: [{ amount: 30000, method: "cash" }],
});
order = r.json;
check(
  "₹300 cash settles the order: balance ₹0",
  order.invoice.balance === 0 && order.invoice.paid === 50000,
  order.invoice,
);
check(
  "paid is separate from collected: garments still at the shop",
  order.garments.every(
    (g: any) => g.currentStatus === "ready" && g.location === "shop_storage",
  ),
);
r = await c.req("POST", `/orders/${orderId}/handover`, {
  garmentIds: order.garments.map((g: any) => g.id),
  method: "counter",
});
if (r.status !== 200) check("handover accepted", false, r.json);
order = (await c.req("GET", `/orders/${orderId}`)).json;
check(
  "after handover every garment is collected",
  order.garments.every(
    (g: any) => g.currentStatus === "delivered" && g.location === "collected",
  ),
  order.garments.map((g: any) => g.location),
);

// ---- partial receipt keeps missing garments visible
section("Partial receipt");
r = await c.req(
  "POST",
  "/orders",
  {
    customerId,
    branchId,
    promisedAt,
    items: [{ garmentTypeId: ids.Shirt, serviceId, quantity: 2 }],
  },
  { "idempotency-key": `flow2-${runId}` },
);
const o2 = r.json;
check(
  "two identical shirts get two different tags",
  o2.garments.length === 2 && o2.garments[0].tagCode !== o2.garments[1].tagCode,
);
const b2 = await batch("to_facility");
await scan(b2, o2.bags[0].bagCode);
for (const g of o2.garments) await scan(b2, g.tagCode);
await c.req("POST", `/transfers/${b2}/dispatch`, {});
await scan(b2, o2.garments[0].tagCode);
r = await c.req("POST", `/transfers/${b2}/receive`, { partial: true });
check("partial receipt needs a note", r.status === 400, r.json);
r = await c.req("POST", `/transfers/${b2}/receive`, {
  partial: true,
  notes: "Second shirt not in van",
});
check(
  "partial receipt closes with exceptions",
  r.json.status === "received_with_exceptions",
);
let o2d = (await c.req("GET", `/orders/${o2.id}`)).json;
check(
  "the missing shirt is flagged on its order",
  o2d.exceptions.length === 1 &&
    o2d.exceptions[0].kind === "missing" &&
    o2d.garments.find((g: any) => g.id === o2.garments[1].id).location ===
      "missing",
  o2d.exceptions,
);
r = await c.req("POST", `/garment-exceptions/${o2d.exceptions[0].id}/resolve`, {
  resolution: "Found at plant, received",
  location: "at_facility",
});
o2d = (await c.req("GET", `/orders/${o2.id}`)).json;
check(
  "resolving puts the garment back on track",
  o2d.exceptions[0].status === "resolved" &&
    o2d.garments.every((g: any) => g.location === "at_facility"),
);

// ---- permission: counter staff cannot give a large discount
section("Permissions");
r = await c.req("POST", `/orders/${o2.id}/collection-discount`, {
  type: "percent",
  value: 5000,
  reason: "Big",
  preview: true,
});
check(
  "owner sees a large discount flagged as needing approval",
  r.json.needsApproval === true,
  r.json,
);

console.log(results.join("\n"));
console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
);
await app.close();
await sqlClient.end();
process.exit(failures ? 1 : 0);
