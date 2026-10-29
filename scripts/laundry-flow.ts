/**
 * Self-service laundry module, end to end against a real database. Run: pnpm laundry-test
 * Uses fresh @test.local tenants each run, so it is safe to repeat.
 */
import { randomUUID } from "node:crypto";
import { buildServer } from "../apps/api/src/app";
import { sqlClient } from "../apps/api/src/db/client";
import { startLaundrySimulator } from "./laundry-iot-simulator";

const app = await buildServer();
let failures = 0;
const results: string[] = [];
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) results.push(`  ✓ ${label}`);
  else { failures++; results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 400)}` : ""}`); }
}
const section = (t: string) => results.push(`\n${t}`);

class Client {
  cookie = "";
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({ method: method as "GET", url: `/api/v1${url}`, payload: body as object, headers: { cookie: this.cookie, "x-drycare-csrf": "1", ...headers } });
    const set = res.headers["set-cookie"];
    if (set) this.cookie = (Array.isArray(set) ? set[0] : set).split(";")[0];
    let json: any;
    try { json = res.json(); } catch {}
    return { status: res.statusCode, json };
  }
}
async function login(email: string, password: string) {
  const c = new Client();
  await c.req("POST", "/auth/login", { email, password });
  return c;
}

const runId = randomUUID().slice(0, 6);
const owner = new Client();
const ownerPassword = `Owner-${runId}-Password1`;
await owner.req("POST", "/organizations", { businessName: `Washland ${runId}`, ownerName: "Owner", email: `owner-wash-${runId}@test.local`, password: ownerPassword, acceptedTerms: true });
const session = (await owner.req("GET", "/auth/session")).json;
const branchId: string = session.branches[0].id;
await owner.req("POST", "/cashier-shifts", { branchId, openingCash: 0 });

section("Setup");
let r = await owner.req("GET", `/laundry/config?branchId=${branchId}`);
check("module starts empty", r.status === 200 && r.json.services.length === 0 && r.json.machines.length === 0, r.json);
r = await owner.req("POST", "/laundry/setup-defaults", {});
check("starter services installed", r.json.added === 6, r.json);
r = await owner.req("POST", "/laundry/setup-defaults", {});
check("installing again adds nothing", r.json.added === 0);
const mk = (body: object) => owner.req("POST", "/laundry/machines", { branchId, ...body });
const w1 = (await mk({ code: "W1", name: "Washer 1", machineType: "washer", capacityKg: 8, programs: [{ name: "Normal 40°", durationMinutes: 45 }, { name: "Quick 30°", durationMinutes: 30 }] })).json;
const w2 = (await mk({ code: "W2", name: "Washer 2", machineType: "washer", capacityKg: 6, programs: [{ name: "Normal 40°", durationMinutes: 45 }] })).json;
const d1 = (await mk({ code: "D1", name: "Dryer 1", machineType: "dryer", capacityKg: 10, programs: [{ name: "High heat", durationMinutes: 40 }] })).json;
const iot = (await mk({ code: "W9", name: "Smart washer", machineType: "washer", capacityKg: 8, controlMode: "http", adapterConfig: { baseUrl: "http://127.0.0.1:9", deviceId: "dev-9" } })).json;
check("machines created", Boolean(w1.id && w2.id && d1.id && iot.id));
check("duplicate machine code rejected", (await mk({ code: "W1", name: "Again", machineType: "washer" })).status === 409);
const config = (await owner.req("GET", `/laundry/config?branchId=${branchId}`)).json;
const svc = (code: string) => config.services.find((s: any) => s.code === code);
const prog = (m: any, name?: string) => config.machines.find((x: any) => x.id === m.id).programs.find((p: any) => !name || p.name === name);

section("Pricing (server-side)");
const quote = (body: object) => owner.req("POST", "/laundry/quote", { branchId, ...body });
r = await quote({ serviceId: svc("WASH").id, method: "weight", weightGrams: 4200 });
check("weight: 4.2 kg billed as 4.5 kg × ₹60 + 18% GST = ₹318.60", r.json.billableGrams === 4500 && r.json.subtotal === 27000 && r.json.total === 31860, r.json);
r = await quote({ serviceId: svc("WASH").id, method: "weight", weightGrams: 1000 });
check("weight: minimum 3 kg applies", r.json.billableGrams === 3000, r.json);
const ironItems = svc("WI").items;
r = await quote({ serviceId: svc("WI").id, method: "item", items: [{ itemRateId: ironItems[0].id, quantity: 3 }, { itemRateId: ironItems[3].id, quantity: 1 }] });
check("item: 3 shirts × ₹25 + 1 bedsheet × ₹40 = ₹115 + GST", r.json.subtotal === 11500 && r.json.lines.length === 2, r.json);
r = await quote({ serviceId: svc("DRY").id, method: "cycle", units: 2 });
check("cycle: 2 × ₹100", r.json.subtotal === 20000);
r = await quote({ serviceId: svc("WD").id, method: "package" });
check("package: fixed ₹220", r.json.subtotal === 22000);
r = await quote({ serviceId: svc("DRY").id, method: "time", units: 10 });
check("time: minimum 20 minutes × ₹3", r.json.subtotal === 6000, r.json);
r = await quote({ serviceId: svc("WASH").id, method: "weight", weightGrams: 5000, discount: { type: "percent", bps: 1000 }, discountReason: "Loyal customer" });
check("10% discount comes off before GST", r.json.discount === 3000 && r.json.tax === 4860 && r.json.total === 31860, r.json);
r = await quote({ serviceId: svc("WASH").id, method: "item", items: [] });
check("disabled method is refused", r.status === 400, r.json);
r = await owner.req("PUT", `/laundry/services/${svc("WASH").id}/rules/weight`, { enabled: true, unitPrice: 7000, minWeightGrams: 3000, weightIncrementGrams: 500, branchId });
check("branch-specific price override saved", r.status === 200);
r = await quote({ serviceId: svc("WASH").id, method: "weight", weightGrams: 3000 });
check("branch price (₹70/kg) overrides store-wide price", r.json.subtotal === 21000, r.json);

section("Orders, capacity and payment");
const newOrder = (body: object, key = randomUUID()) => owner.req("POST", "/laundry/orders", { branchId, ...body }, { "idempotency-key": key });
r = await newOrder({ serviceId: svc("WASH").id, method: "weight", weightGrams: 7000, machineId: w2.id, programId: prog(w2).id });
check("7 kg load refused on a 6 kg washer", r.status === 422 && r.json.error.code === "OVER_CAPACITY", r.json);
r = await newOrder({ serviceId: svc("WASH").id, method: "weight", weightGrams: 4000, machineId: d1.id });
check("a dryer cannot be booked for a wash", r.status === 422 && r.json.error.code === "MACHINE_INCOMPATIBLE", r.json);
const key = randomUUID();
r = await newOrder({ serviceId: svc("WASH").id, method: "weight", weightGrams: 4000, guestName: "Priya", guestPhone: "9876500000", machineId: w1.id, programId: prog(w1, "Normal 40°").id }, key);
check("order created with machine reserved", r.status === 201 && r.json.status === "pending_payment" && r.json.sessions[0].status === "reserved", r.json);
const order = r.json;
check("order number and public token issued", /^SS-/.test(order.orderNumber) && order.statusToken.length >= 12);
const replay = await newOrder({ serviceId: svc("WASH").id, method: "weight", weightGrams: 4000, guestName: "Priya", guestPhone: "9876500000", machineId: w1.id, programId: prog(w1, "Normal 40°").id }, key);
check("retrying the same request does not create a second order", replay.json.id === order.id);
r = await newOrder({ serviceId: svc("WASH").id, method: "weight", weightGrams: 3000, machineId: w1.id });
check("the reserved washer cannot be double-booked", r.status === 409 && r.json.error.code === "MACHINE_UNAVAILABLE", r.json);
const sessionId = order.sessions[0].id;
r = await owner.req("POST", `/laundry/sessions/${sessionId}/start`, {});
check("machine will not start before payment", r.status === 422 && r.json.error.code === "PAYMENT_REQUIRED", r.json);
r = await owner.req("POST", `/laundry/orders/${order.id}/payments`, { payments: [{ amount: order.total, method: "bank_transfer", reference: `NEFT${runId}`, awaitingVerification: true }] }, { "idempotency-key": randomUUID() });
r = await owner.req("POST", `/laundry/sessions/${sessionId}/start`, {});
check("an unverified bank transfer does not unlock the machine", r.status === 422 && r.json.error.code === "PAYMENT_REQUIRED", r.json);
const pendingId = (await owner.req("GET", `/laundry/orders/${order.id}`)).json.payments[0].id;
r = await owner.req("POST", `/laundry/orders/${order.id}/verify-payment/${pendingId}`, { outcome: "rejected", note: "Not received" });
check("rejected transfer leaves the order unpaid", r.json.status === "pending_payment" && r.json.paid === 0, r.json);
r = await owner.req("POST", `/laundry/orders/${order.id}/payments`, { payments: [{ amount: order.total + 100, method: "cash" }] }, { "idempotency-key": randomUUID() });
check("overpayment refused", r.status === 422);
const payKey = randomUUID();
r = await owner.req("POST", `/laundry/orders/${order.id}/payments`, { payments: [{ amount: order.total, method: "upi", reference: `UPI${runId}` }] }, { "idempotency-key": payKey });
check("UPI payment marks the order paid", r.json.status === "paid" && r.json.balance === 0, r.json);
r = await owner.req("POST", `/laundry/orders/${order.id}/payments`, { payments: [{ amount: order.total, method: "upi", reference: `UPI${runId}` }] }, { "idempotency-key": payKey });
const afterDup = (await owner.req("GET", `/laundry/orders/${order.id}`)).json;
check("duplicate payment request is not charged twice", afterDup.paid === order.total, afterDup.paid);

section("Machine control");
const [s1, s2] = await Promise.all([owner.req("POST", `/laundry/sessions/${sessionId}/start`, {}), owner.req("POST", `/laundry/sessions/${sessionId}/start`, {})]);
check("two simultaneous starts: one start command, both see it running", [s1, s2].every((x) => x.status === 200) && [s1.json.alreadyRunning, s2.json.alreadyRunning].filter(Boolean).length === 1, [s1.json, s2.json].map((x) => x.alreadyRunning ?? x.error));
let cfg = (await owner.req("GET", `/laundry/config?branchId=${branchId}`)).json;
check("washer shows running, vouched by staff (manual machine)", cfg.machines.find((m: any) => m.id === w1.id).status === "running" && cfg.machines.find((m: any) => m.id === w1.id).session.statusSource === "staff");
r = await owner.req("POST", `/laundry/machines/${w1.id}/maintenance`, { kind: "breakdown", notes: "Door seal", status: "maintenance" });
check("cannot take a running machine out of service", r.status === 409);
r = await owner.req("POST", `/laundry/sessions/${sessionId}/complete`, {});
check("staff confirms the cycle finished → order ready", r.json.status === "ready", r.json.status);
cfg = (await owner.req("GET", `/laundry/config?branchId=${branchId}`)).json;
check("washer waits to be unloaded (completed)", cfg.machines.find((m: any) => m.id === w1.id).status === "completed");
r = await owner.req("POST", `/laundry/machines/${w1.id}/release`, {});
r = await owner.req("POST", `/laundry/orders/${order.id}/collect`, {});
check("order collected", r.json.status === "collected");

// IoT machine whose controller cannot be reached
r = await newOrder({ serviceId: svc("WASH").id, method: "cycle", units: 1, machineId: iot.id, payments: [{ amount: 17700, method: "cash" }] });
check("paid order on smart washer", r.json.status === "paid", r.json);
const iotSession = r.json.sessions[0].id;
r = await owner.req("POST", `/laundry/sessions/${iotSession}/start`, {});
check("unreachable controller: start fails clearly", r.status === 422 && r.json.error.code === "MACHINE_START_FAILED", r.json);
cfg = (await owner.req("GET", `/laundry/config?branchId=${branchId}`)).json;
const smart = cfg.machines.find((m: any) => m.id === iot.id);
check("…and the machine is NOT shown as running", smart.status === "reserved" && smart.session.status === "reserved" && Boolean(smart.session.error), smart);

section("Connected machine (simulated controller)");
// 1 programme minute = 0.1 s; the simulator runs every cycle for at least 1 second.
const sim = await startLaundrySimulator(0, { speedup: 600 });
const smartOk = (await mk({ code: "W8", name: "Smart washer 2", machineType: "washer", capacityKg: 8, controlMode: "http", adapterConfig: { baseUrl: sim.url, deviceId: "lg-01" }, programs: [{ name: "Express", durationMinutes: 2 }] })).json;
const cfgSmart = (await owner.req("GET", `/laundry/config?branchId=${branchId}`)).json;
r = await newOrder({ serviceId: svc("WASH").id, method: "cycle", units: 1, machineId: smartOk.id, programId: cfgSmart.machines.find((m: any) => m.id === smartOk.id).programs[0].id, payments: [{ amount: 17700, method: "cash" }] });
const smartSession = r.json.sessions[0].id;
r = await owner.req("POST", `/laundry/sessions/${smartSession}/start`, {});
check("controller accepts the start → running, confirmed by the device", r.status === 200 && r.json.order.sessions[0].status === "running" && r.json.order.sessions[0].status_source === "device", r.json);
check("simulator received the start", sim.devices.get("lg-01")?.state === "running");
r = await owner.req("POST", `/laundry/sessions/${smartSession}/refresh`, {});
check("while running, a status check changes nothing", r.json.device.state === "running" && r.json.order.sessions[0].status === "running", r.json.device);
await new Promise((res) => setTimeout(res, 1300));
r = await owner.req("POST", `/laundry/sessions/${smartSession}/refresh`, {});
check("device reports done → cycle completed by the device, order ready", r.json.device.state === "done" && r.json.order.sessions[0].status === "completed" && r.json.order.sessions[0].status_source === "device" && r.json.order.status === "ready", r.json);
await owner.req("POST", `/laundry/machines/${smartOk.id}/release`, {});
// A machine fault reported mid-cycle
await fetch(`${sim.url}/machines/lg-01/reset`, { method: "POST" });
r = await newOrder({ serviceId: svc("WASH").id, method: "cycle", units: 1, machineId: smartOk.id, payments: [{ amount: 17700, method: "cash" }] });
if (!r.json.sessions) check("second smart-washer order", false, r.json);
else {
  const faultSession = r.json.sessions[0].id;
  await owner.req("POST", `/laundry/sessions/${faultSession}/start`, {});
  await fetch(`${sim.url}/machines/lg-01/fault`, { method: "POST" });
  r = await owner.req("POST", `/laundry/sessions/${faultSession}/refresh`, {});
  check("device fault → cycle marked failed with the reason, machine freed", r.json.order.sessions[0].status === "failed" && /fault/i.test(r.json.order.sessions[0].error ?? ""), r.json.order?.sessions);
}
sim.server.close();

section("Concurrency, cancellation and refunds");
const [a, b] = await Promise.all([
  newOrder({ serviceId: svc("DRY").id, method: "cycle", units: 1, machineId: d1.id }),
  newOrder({ serviceId: svc("DRY").id, method: "cycle", units: 1, machineId: d1.id }),
]);
check("two simultaneous bookings of the same dryer: exactly one succeeds", [a.status, b.status].sort().join() === "201,409", [a.status, b.status]);
const dryOrder = a.status === 201 ? a.json : b.json;
await owner.req("POST", `/laundry/orders/${dryOrder.id}/payments`, { payments: [{ amount: dryOrder.total, method: "cash" }] }, { "idempotency-key": randomUUID() });
r = await owner.req("POST", `/laundry/orders/${dryOrder.id}/cancel`, { reason: "Customer changed mind" });
check("cancelling a paid order asks how to refund", r.status === 422 && r.json.error.code === "REFUND_REQUIRED");
r = await owner.req("POST", `/laundry/orders/${dryOrder.id}/cancel`, { reason: "Customer changed mind", refundMethod: "cash" });
check("cancelled with cash refund; dryer freed", r.json.status === "cancelled" && r.json.refunded === dryOrder.total && r.json.paid === 0, r.json);
cfg = (await owner.req("GET", `/laundry/config?branchId=${branchId}`)).json;
check("dryer available again", cfg.machines.find((m: any) => m.id === d1.id).status === "available");
const shift = (await owner.req("GET", "/cashier-shifts/current")).json.shift;
check("self-service cash and refunds flow into the cashier shift", Number(shift.cashIn) >= 17700 + dryOrder.total && Number(shift.cashOut) >= dryOrder.total, shift);

section("Maintenance");
r = await owner.req("POST", `/laundry/machines/${w2.id}/maintenance`, { kind: "service", notes: "Quarterly service", status: "maintenance" });
const mt = r.json;
r = await newOrder({ serviceId: svc("WASH").id, method: "weight", weightGrams: 3000, machineId: w2.id });
check("a machine under maintenance cannot be booked", r.status === 409, r.json);
r = await owner.req("POST", `/laundry/maintenance/${mt.id}/resolve`, { notes: "Done" });
r = await owner.req("GET", `/laundry/machines/${w2.id}/history`);
check("maintenance history recorded", r.json.maintenance.length === 1 && r.json.maintenance[0].ended_at);

section("Permissions & store isolation");
await owner.req("POST", "/staff", { name: "Operator", email: `op-${runId}@test.local`, password: `Operator-${runId}-1`, roleKey: "operator" });
await owner.req("POST", "/staff", { name: "Fixer", email: `fix-${runId}@test.local`, password: `Fixer-${runId}-1a`, roleKey: "maintenance" });
const other = (await owner.req("POST", "/branches", { name: "Second shop", branchCode: "SH2" })).json;
await owner.req("POST", "/staff", { name: "Branch two", email: `b2-${runId}@test.local`, password: `Branch2-${runId}-1`, roleKey: "operator", branchIds: [other.id] });
const op = await login(`op-${runId}@test.local`, `Operator-${runId}-1`);
const fixer = await login(`fix-${runId}@test.local`, `Fixer-${runId}-1a`);
const b2 = await login(`b2-${runId}@test.local`, `Branch2-${runId}-1`);
check("operator can take orders", (await op.req("POST", "/laundry/quote", { branchId, serviceId: svc("DRY").id, method: "cycle", units: 1 })).status === 200);
check("operator cannot change prices", (await op.req("PUT", `/laundry/services/${svc("DRY").id}/rules/cycle`, { enabled: true, unitPrice: 1 })).status === 403);
check("operator cannot issue refunds on cancel", (await (async () => {
  const o = (await op.req("POST", "/laundry/orders", { branchId, serviceId: svc("DRY").id, method: "cycle", units: 1, payments: [{ amount: 11800, method: "cash" }] }, { "idempotency-key": randomUUID() })).json;
  return (await op.req("POST", `/laundry/orders/${o.id}/cancel`, { reason: "Test", refundMethod: "cash" })).status;
})()) === 403);
check("maintenance staff can take a machine out of service", (await fixer.req("POST", `/laundry/machines/${d1.id}/maintenance`, { kind: "cleaning", notes: "Lint filter", status: "out_of_service" })).status === 201);
check("maintenance staff cannot take orders", (await fixer.req("POST", "/laundry/quote", { branchId, serviceId: svc("DRY").id, method: "cycle", units: 1 })).status === 403);
check("staff of another branch cannot see this store's machines", (await b2.req("GET", `/laundry/config?branchId=${branchId}`)).status === 403);
check("…or this store's orders", (await b2.req("GET", `/laundry/orders/${order.id}`)).status === 403);
const otherOrg = new Client();
const otherSignup = await otherOrg.req("POST", "/organizations", { businessName: `Other ${runId}`, ownerName: "Other Owner", email: `owner-oth-${runId}@test.local`, password: `Other-${runId}-Password1`, acceptedTerms: true });
if (otherSignup.status !== 201) check("second business signup", false, otherSignup);
const otherRead = await otherOrg.req("GET", `/laundry/orders/${order.id}`);
check("another business cannot read this order", otherRead.status === 404, otherRead);

await owner.req("POST", "/staff", { name: "Kiosk", email: `kiosk-${runId}@test.local`, password: `Kiosk-${runId}-pass1`, roleKey: "kiosk", branchIds: [branchId] });
const kiosk = await login(`kiosk-${runId}@test.local`, `Kiosk-${runId}-pass1`);
const kioskOrder = await kiosk.req("POST", "/laundry/orders", { branchId, serviceId: svc("DRY").id, method: "cycle", units: 1 }, { "idempotency-key": randomUUID() });
check("kiosk login can create a self-service order", kioskOrder.status === 201 && kioskOrder.json.status === "pending_payment", kioskOrder.json);
check("kiosk login cannot change prices", (await kiosk.req("PUT", `/laundry/services/${svc("DRY").id}/rules/cycle`, { enabled: true, unitPrice: 1 })).status === 403);
check("kiosk login cannot see dry-cleaning orders", (await kiosk.req("GET", "/orders")).status === 403);
check("kiosk login cannot see reports or customers", (await kiosk.req("GET", "/customers?search=a")).status === 403);

section("Admin price changes");
r = await owner.req("PUT", `/laundry/services/${svc("DRY").id}/rules/cycle`, { enabled: true, unitPrice: 12000 });
check("owner changes the dryer cycle price to ₹120", r.status === 200 && r.json.unitPrice === 12000);
r = await quote({ serviceId: svc("DRY").id, method: "cycle", units: 1 });
check("new orders use the new price immediately", r.json.subtotal === 12000, r.json);
check("existing orders keep their original price", (await owner.req("GET", `/laundry/orders/${kioskOrder.json.id}`)).json.subtotal === 10000);
r = await owner.req("GET", "/laundry/price-history");
const change = r.json.find((h: any) => h.action === "laundry.pricing_updated" && h.after?.unitPrice === 12000);
check("price change history shows old → new price, service and who changed it", change && change.before?.unitPrice === 10000 && change.serviceName === "Self-service dry" && change.changedBy === "Owner", change);

section("Public status page & reports");
r = await new Client().req("GET", `/public/laundry-status/${order.statusToken}`);
check("public status works without login and hides customer and price", r.status === 200 && r.json.orderNumber === order.orderNumber && !("total" in r.json) && !JSON.stringify(r.json).includes("Priya"), r.json);
check("unknown token → 404", (await new Client().req("GET", "/public/laundry-status/AAAAAAAAAAAAAAAA")).status === 404);
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
r = await owner.req("GET", `/laundry/reports?branchId=${branchId}&from=${today}&to=${today}`);
check("reports: orders, cancellations, refunds and per-machine cycles", r.json.totals.orders >= 4 && r.json.totals.cancelled >= 1 && r.json.totals.refunded >= dryOrder.total && r.json.byMachine.find((m: any) => m.id === w1.id).cycles === 1, r.json.totals);

console.log(results.join("\n"));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await app.close();
await sqlClient.end();
process.exit(failures ? 1 : 0);
