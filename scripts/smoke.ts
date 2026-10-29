/**
 * End-to-end acceptance checks against a real database (SRS §16). Run: pnpm smoke
 * Creates two fresh tenants each run, so it is safe to repeat.
 */
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { buildServer } from "../apps/api/src/app";
import { db, schema, sqlClient } from "../apps/api/src/db/client";
import { isLoopbackAddress } from "../apps/api/src/modules/system";
import { getInstallationLicenseState, isLicenseActivationRequest, verifySignedLicense } from "../apps/api/src/lib/license";
import { signedLicenseSchema } from "../packages/shared/src/license";

const app = await buildServer();
let failures = 0;
const results: string[] = [];

function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) results.push(`  ✓ ${label}`);
  else {
    failures++;
    results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  }
}

class Client {
  cookie = "";
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({
      method: method as "GET",
      url: `/api/v1${url}`,
      payload: body as object,
      headers: { cookie: this.cookie, "x-drycare-csrf": "1", ...headers },
    });
    const set = res.headers["set-cookie"];
    if (set) this.cookie = (Array.isArray(set) ? set[0] : set).split(";")[0];
    let json: any = undefined;
    try {
      json = res.json();
    } catch {}
    return { status: res.statusCode, json };
  }
}

const runId = randomUUID().slice(0, 6);
async function newTenant(name: string) {
  const c = new Client();
  const r = await c.req("POST", "/organizations", {
    businessName: `${name} ${runId}`,
    ownerName: "Test Owner",
    email: `owner-${name.toLowerCase()}-${runId}@test.local`,
    password: "correct-horse-battery",
    branchName: "Main",
    branchCode: "MN",
    acceptedTerms: true,
  });
  if (r.status !== 201) throw new Error(`signup failed: ${JSON.stringify(r.json)}`);
  const s = await c.req("GET", "/auth/session");
  const trial = await c.req("GET", "/auth/trial-status");
  check("cloud signup creates a server-controlled trial", trial.status === 200 && trial.json.status === "trial" && trial.json.trialEndsAt && trial.json.daysRemaining > 0, trial.json);
  return { c, session: s.json, email: `owner-${name.toLowerCase()}-${runId}@test.local` };
}

console.log("DryCare acceptance checks\n");

// ---------- setup
const [commercialPlan] = await db
  .insert(schema.commercialPlans)
  .values({
    code: `smoke-${runId}`,
    name: `Smoke Plan ${runId}`,
    description: "Free plan used by the acceptance suite",
    pricePaise: 0,
    interval: "month",
    published: true,
    deviceLimit: 5,
    branchLimit: 3,
  })
  .returning();

const A = await newTenant("Alpha");
const B = await newTenant("Beta");
const plans = await A.c.req("GET", "/commercial/plans");
check("commercial plans API publishes only configured plans", plans.status === 200 && plans.json.some((plan: any) => plan.id === commercialPlan.id), plans.json);
const requestedSubscription = await A.c.req("POST", "/commercial/subscriptions", { planId: commercialPlan.id });
check("free commercial plan activates an idempotent subscription request", requestedSubscription.status === 201 && requestedSubscription.json.subscription.status === "active" && requestedSubscription.json.checkoutRequired === false, requestedSubscription.json);
const currentSubscription = await A.c.req("GET", "/commercial/subscription");
check("tenant subscription status API returns the selected plan", currentSubscription.status === 200 && currentSubscription.json.subscription.id === requestedSubscription.json.subscription.id && currentSubscription.json.plan.id === commercialPlan.id, currentSubscription.json);
const duplicateSubscription = await A.c.req("POST", "/commercial/subscriptions", { planId: commercialPlan.id });
check("duplicate commercial subscription is rejected", duplicateSubscription.status === 409 && duplicateSubscription.json.error.code === "SUBSCRIPTION_EXISTS", duplicateSubscription.json);
const canceledSubscription = await A.c.req("POST", "/commercial/subscriptions/cancel");
check("active commercial subscription can schedule cancellation", canceledSubscription.status === 200 && canceledSubscription.json.cancelAt === canceledSubscription.json.endsAt, canceledSubscription.json);
const branchA = A.session.branches[0].id;
const [gts, svcs] = await Promise.all([A.c.req("GET", "/garment-types"), A.c.req("GET", "/services")]);
const shirt = gts.json.find((g: any) => g.name === "Shirt");
const suit = gts.json.find((g: any) => g.name === "Suit (2 pc)");
const DC = svcs.json.find((s: any) => s.serviceCode === "DC");
const SI = svcs.json.find((s: any) => s.serviceCode === "SI");
const catalogueService = await A.c.req("POST", "/services", {
  name: "Smoke-test service",
  category: "Alterations",
  serviceCode: `QA${runId.toUpperCase()}`,
  workflowStages: DC.workflowStages,
});
check("service CRUD stores a category", catalogueService.status === 201 && catalogueService.json.category === "Alterations", catalogueService.json);
const editedCatalogueService = await A.c.req("PATCH", `/services/${catalogueService.json.id}`, { category: "Laundry", name: "Updated smoke-test service" });
check("service category and name can be edited", editedCatalogueService.status === 200 && editedCatalogueService.json.category === "Laundry" && editedCatalogueService.json.name === "Updated smoke-test service", editedCatalogueService.json);
const catalogueGarment = await A.c.req("POST", "/garment-types", { name: `Smoke Garment ${runId}`, category: "Test" });
const editedCatalogueGarment = await A.c.req("PATCH", `/garment-types/${catalogueGarment.json.id}`, { name: `Updated Smoke Garment ${runId}`, category: "Formal" });
check("garment CRUD updates searchable catalogue fields", catalogueGarment.status === 201 && editedCatalogueGarment.status === 200 && editedCatalogueGarment.json.category === "Formal", editedCatalogueGarment.json);

// ---------- AC-02 customer management
results.push("AC-02 Customer management");
const cust = await A.c.req("POST", "/customers", { name: "Rahul Sharma", phone: "+91 98765 43210", email: `rahul-${runId}@test.local`, gstin: "27ABCDE1234F1Z5" });
check("create customer", cust.status === 201, cust.json);
check("customer tax registration is stored", cust.json.gstin === "27ABCDE1234F1Z5");
const dup = await A.c.req("POST", "/customers", { name: "Rahul S", phone: "9876543210" });
check("duplicate phone detected (FR-CRM-004)", dup.status === 409 && dup.json.error.code === "POSSIBLE_DUPLICATE", dup.json);
const found = await A.c.req("GET", "/customers?q=43210");
check("find by mobile number", found.json.items.some((x: any) => x.id === cust.json.id));
const foundByEmail = await A.c.req("GET", `/customers?q=rahul-${runId}`);
check("customer search matches email", foundByEmail.json.items.some((x: any) => x.id === cust.json.id));
await A.c.req("PATCH", "/organizations/current", { settings: { customerDuplicateMatch: ["email"] } });
const emailDup = await A.c.req("POST", "/customers", { name: "Duplicate email", email: `RAHUL-${runId}@test.local` });
check("configured email duplicate detection is case-insensitive", emailDup.status === 409 && emailDup.json.error.code === "POSSIBLE_DUPLICATE");
const phoneNotMatched = await A.c.req("POST", "/customers", { name: "Different phone rule", phone: "+91 98765 43210", email: `different-${runId}@test.local` });
check("unconfigured duplicate field is not matched", phoneNotMatched.status === 201, phoneNotMatched.json);
await A.c.req("PATCH", "/organizations/current", { settings: { customerDuplicateMatch: ["phone"] } });
const newAddress = await A.c.req("POST", `/customers/${cust.json.id}/addresses`, { label: "Home", line1: "12 Lake Road", city: "Pune", state: "Maharashtra", pincode: "411001", isDefault: true });
check("customer address can be created", newAddress.status === 201, newAddress.json);
const editedAddress = await A.c.req("PATCH", `/customers/${cust.json.id}/addresses/${newAddress.json.id}`, { label: "Office", line1: "20 Market Road", city: "Pune", state: "Maharashtra", pincode: "411002", isDefault: true });
const profileAfterAddress = await A.c.req("GET", `/customers/${cust.json.id}`);
check("customer address edit route updates saved address", editedAddress.status === 200 && profileAfterAddress.json.addresses[0].address.line1 === "20 Market Road", editedAddress.json);
const noPhone = await A.c.req("POST", "/customers", { name: "Walk-in without phone" });
check("customer without phone supported", noPhone.status === 201);

// ---------- AC-03 / AC-05 order creation + pricing
results.push("AC-03/05 Order creation & pricing");
const promisedAt = new Date(Date.now() + 2 * 86400_000).toISOString();
const orderBody = {
  customerId: cust.json.id,
  branchId: branchA,
  promisedAt,
  items: [
    { garmentTypeId: suit.id, serviceId: DC.id, quantity: 1, colour: "Navy", conditionFlags: ["stain"], conditionNotes: "Stain on left sleeve" },
    { garmentTypeId: shirt.id, serviceId: SI.id, quantity: 2, colour: "White" },
  ],
  payments: [{ amount: 20000, method: "cash" }],
};
const quote = await A.c.req("POST", "/orders/quote", orderBody);
// Suit DC 350.00 + 2 × shirt SI 15.00 = 380.00, +18% GST = 448.40
check("server-side quote: 380.00 + 18% GST = 448.40", quote.json?.totals?.grandTotal === 44840, quote.json?.totals);
const idemKey = randomUUID();
const o1 = await A.c.req("POST", "/orders", orderBody, { "idempotency-key": idemKey });
check("order created", o1.status === 201, o1.json);
const order = o1.json;
check("3 physical garments with unique tags (FR-GAR-001)", order.garments.length === 3 && new Set(order.garments.map((g: any) => g.tagCode)).size === 3);
check("totals match quote", order.grandTotal === quote.json.totals.grandTotal);
check("advance recorded, balance = 248.40", order.invoice.paid === 20000 && order.invoice.balance === 24840, order.invoice);
const o1again = await A.c.req("POST", "/orders", orderBody, { "idempotency-key": idemKey });
check("retry with same idempotency key returns same order, no duplicate", o1again.json.id === order.id);
const ordersList = await A.c.req("GET", `/customers/${cust.json.id}/orders`);
check("customer history shows exactly one order", ordersList.json.length === 1, ordersList.json.length);
const garmentHistory = await A.c.req("GET", `/customers/${cust.json.id}/garments`);
check("customer garment history returns items from saved orders", garmentHistory.status === 200 && garmentHistory.json.length === 3, garmentHistory.json);
const badPrice = await A.c.req("POST", "/orders", { ...orderBody, payments: [], items: [{ ...orderBody.items[0], overrideUnitPrice: 100 }] });
check("price override without reason rejected", badPrice.status === 400);

// Future price change does not alter historical order
const pl = (await A.c.req("GET", "/price-lists")).json[0];
await A.c.req("POST", `/price-lists/${pl.id}/prices`, { garmentTypeId: suit.id, serviceId: DC.id, unitPrice: 50000, taxBps: 1800 });
const priceHistory = await A.c.req("GET", `/price-lists/${pl.id}/prices/history?garmentTypeId=${suit.id}&serviceId=${DC.id}`);
check("price changes retain effective-dated history", priceHistory.status === 200 && priceHistory.json.length >= 2 && priceHistory.json[0].unitPrice === 50000, priceHistory.json);
const scheduledPriceTime = new Date(Date.now() + 3 * 86400_000).toISOString();
await A.c.req("POST", `/price-lists/${pl.id}/prices`, { garmentTypeId: suit.id, serviceId: DC.id, unitPrice: 55000, taxBps: 1800, effectiveFrom: scheduledPriceTime });
const beforeScheduledPrice = await A.c.req("POST", "/orders/quote", orderBody);
check("scheduled prices do not affect quotes before their effective date", beforeScheduledPrice.json.totals.grandTotal === 62540, beforeScheduledPrice.json.totals);
const reloaded = await A.c.req("GET", `/orders/${order.id}`);
check("future price change leaves old invoice unchanged (FR-CAT-005)", reloaded.json.grandTotal === 44840);
const newQuote = await A.c.req("POST", "/orders/quote", orderBody);
check("new quote uses new price", newQuote.json.totals.grandTotal === 62540, newQuote.json.totals);

// ---------- AC-04 / AC-07 garment tracking & QC
results.push("AC-04/07 Garment tracking & quality control");
const suitTag = order.garments.find((g: any) => g.workflowStages.includes("cleaning"));
const shirtTags = order.garments.filter((g: any) => g.id !== suitTag.id);
const byTag = await A.c.req("GET", `/garments/by-tag/${suitTag.tagCode}`);
check("scan tag resolves garment", byTag.json.id === suitTag.id);
const ownerId = (await A.c.req("GET", "/auth/session")).json.user.id;
const productionStaff = await A.c.req("GET", `/production/staff?branchId=${branchA}`);
check("production assignee list is branch-scoped and permission-filtered", productionStaff.status === 200 && productionStaff.json.some((person: any) => person.userId === ownerId));
const assignedGarment = await A.c.req("POST", `/garments/${suitTag.id}/assignments`, { userId: ownerId, version: byTag.json.version });
check("garment can be assigned with an audited version update", assignedGarment.status === 200 && assignedGarment.json.assignedUserId === ownerId);
const staleAssignment = await A.c.req("POST", `/garments/${suitTag.id}/assignments`, { userId: null, version: byTag.json.version });
check("stale assignment update is rejected", staleAssignment.status === 422 && staleAssignment.json.error.code === "STALE_VERSION");
const crossTenantAssignment = await B.c.req("POST", `/garments/${suitTag.id}/assignments`, { userId: ownerId, version: assignedGarment.json.version });
check("cross-tenant garment assignment is hidden", crossTenantAssignment.status === 404);
const skip = await A.c.req("POST", `/garments/${suitTag.id}/transitions`, { to: "packing" });
check("skipping stages rejected", skip.status === 422 && skip.json.error.code === "INVALID_TRANSITION", skip.json);
const bareDeliver = await A.c.req("POST", `/garments/${suitTag.id}/transitions`, { to: "delivered" });
check("bare 'delivered' status change rejected", bareDeliver.status === 422);
for (const to of ["inspection", "sorting", "cleaning", "finishing", "quality_control"]) {
  const r = await A.c.req("POST", `/garments/${suitTag.id}/transitions`, { to });
  if (r.status !== 200) check(`advance to ${to}`, false, r.json);
}
const qcBypass = await A.c.req("POST", `/garments/${suitTag.id}/transitions`, { to: "packing" });
check("QC cannot be bypassed via transition endpoint", qcBypass.status === 422 && qcBypass.json.error.code === "USE_INSPECTION");
const fail = await A.c.req("POST", `/garments/${suitTag.id}/inspections`, { outcome: "fail", reworkReason: "Stain still visible" });
check("failed QC sends garment to rework", fail.json.currentStatus === "rework", fail.json);
await A.c.req("POST", `/garments/${suitTag.id}/transitions`, { to: "cleaning" });
for (const to of ["finishing", "quality_control"]) await A.c.req("POST", `/garments/${suitTag.id}/transitions`, { to });
const pass = await A.c.req("POST", `/garments/${suitTag.id}/inspections`, { outcome: "pass", checklist: { stains: true, buttons: true } });
check("passed QC moves to packing", pass.json.currentStatus === "packing");
const noLoc = await A.c.req("POST", `/garments/${suitTag.id}/transitions`, { to: "ready" });
check("ready requires rack location", noLoc.status === 422 && noLoc.json.error.code === "LOCATION_REQUIRED");
const locs = await A.c.req("GET", `/storage-locations?branchId=${branchA}`);
await A.c.req("POST", `/garments/${suitTag.id}/storage-location`, { storageLocationId: locs.json[0].id });
const ready = await A.c.req("POST", `/garments/${suitTag.id}/transitions`, { to: "ready" });
check("garment ready", ready.json.currentStatus === "ready", ready.json);
check("full movement history recorded with actor", ready.json.history.length >= 10 && ready.json.history.every((h: any) => h.actor));
const partial = await A.c.req("GET", `/orders/${order.id}`);
check("order is partially ready (1 of 3)", partial.json.operationalStatus === "partially_ready", partial.json.operationalStatus);

// ---------- customer approval holds
results.push("Customer approval holds");
const approvalBody = {
  ...orderBody,
  payments: [],
  items: [
    { ...orderBody.items[0], overrideUnitPrice: 60000, overrideReason: "Additional stain-treatment charge" },
    { ...orderBody.items[0], specialCareApprovalRequired: true, specialCareReason: "Hand-finish the delicate buttons" },
  ],
};
const paymentBeforeApproval = await A.c.req("POST", "/orders", { ...approvalBody, payments: [{ amount: 1000, method: "cash" }] });
check("order with pending approval cannot collect an advance", paymentBeforeApproval.status === 422 && paymentBeforeApproval.json.error.code === "CUSTOMER_APPROVAL_REQUIRED");
const approvalOrderResult = await A.c.req("POST", "/orders", approvalBody);
const approvalOrder = approvalOrderResult.json;
check("additional charge and special care create separate approval holds", approvalOrderResult.status === 201 && approvalOrder.approvals.length === 2);
const extraChargeApproval = approvalOrder.approvals.find((a: any) => a.trigger === "additional_charge");
const specialCareApproval = approvalOrder.approvals.find((a: any) => a.trigger === "special_care");
const extraChargeItem = approvalOrder.items.find((item: any) => item.id === extraChargeApproval?.orderItemId);
const expectedAdditionalCharge = extraChargeItem
  ? (extraChargeItem.unitPrice - extraChargeItem.listUnitPrice) * extraChargeItem.quantity
  : undefined;
check("additional charge hold records amount and reason", Number(extraChargeApproval?.additionalCharge) === expectedAdditionalCharge && extraChargeApproval?.reason === "Additional stain-treatment charge");
const approvalGarment = approvalOrder.garments.find((g: any) => g.orderItemId === specialCareApproval?.orderItemId);
const approvalTag = (await A.c.req("GET", `/garments/${approvalGarment.id}`)).json;
const toInspection = await A.c.req("POST", `/garments/${approvalGarment.id}/transitions`, { to: "inspection", version: approvalTag.version });
const toSorting = await A.c.req("POST", `/garments/${approvalGarment.id}/transitions`, { to: "sorting", version: toInspection.json.version });
const heldAtCleaning = await A.c.req("POST", `/garments/${approvalGarment.id}/transitions`, { to: "cleaning", version: toSorting.json.version });
check("pending customer approval holds garment before cleaning", heldAtCleaning.status === 422 && heldAtCleaning.json.error.code === "CUSTOMER_APPROVAL_REQUIRED");
const paymentOnHold = await A.c.req("POST", `/orders/${approvalOrder.id}/payments`, { payments: [{ amount: 1000, method: "cash" }] });
check("pending customer approval blocks later payment collection", paymentOnHold.status === 422 && paymentOnHold.json.error.code === "CUSTOMER_APPROVAL_REQUIRED");
const noVerbalEvidence = await A.c.req("POST", `/orders/${approvalOrder.id}/approvals/${extraChargeApproval.id}/confirm`, { method: "verbal", customerName: "Rahul Sharma" });
check("verbal approval requires witness notes", noVerbalEvidence.status === 400);
const signedOff = await A.c.req("POST", `/orders/${approvalOrder.id}/approvals/${extraChargeApproval.id}/confirm`, { method: "signature", customerName: "Rahul Sharma" });
check("typed-name in-person approval records customer and staff witness", signedOff.status === 200 && signedOff.json.approvals.find((a: any) => a.id === extraChargeApproval.id).witnessName === "Test Owner");
const stillHeld = await A.c.req("POST", `/garments/${approvalGarment.id}/transitions`, { to: "cleaning", version: toSorting.json.version });
check("one approved trigger does not clear a separate pending hold", stillHeld.status === 422 && stillHeld.json.error.code === "CUSTOMER_APPROVAL_REQUIRED");
const verballyApproved = await A.c.req("POST", `/orders/${approvalOrder.id}/approvals/${specialCareApproval.id}/confirm`, { method: "verbal", customerName: "Rahul Sharma", notes: "Customer confirmed by phone" });
check("verbal approval is witnessed and auditable", verballyApproved.status === 200 && verballyApproved.json.approvals.find((a: any) => a.id === specialCareApproval.id).method === "verbal");
const releasedToCleaning = await A.c.req("POST", `/garments/${approvalGarment.id}/transitions`, { to: "cleaning", version: toSorting.json.version });
check("garment proceeds after all customer holds are approved", releasedToCleaning.status === 200 && releasedToCleaning.json.currentStatus === "cleaning");

// ---------- AC-06 / AC-08 payments, handover, partial delivery
results.push("AC-06/08 Payments & delivery");
const due = await A.c.req("POST", `/orders/${order.id}/handover`, { garmentIds: [suitTag.id] });
check("handover blocked while balance due", due.status === 422 && due.json.error.code === "BALANCE_DUE");
const notReady = await A.c.req("POST", `/orders/${order.id}/handover`, { garmentIds: [shirtTags[0].id], allowWithBalance: true });
check("unready garment cannot be handed over", notReady.status === 422 && notReady.json.error.code === "NOT_READY");
const over = await A.c.req("POST", `/orders/${order.id}/payments`, { payments: [{ amount: 999999, method: "cash" }] });
check("overpayment rejected", over.status === 422);
const upiNoRef = await A.c.req("POST", `/orders/${order.id}/payments`, { payments: [{ amount: 1000, method: "upi" }] });
check("UPI payment requires a reference", upiNoRef.status === 400);
const payKey = randomUUID();
const split = await A.c.req("POST", `/orders/${order.id}/payments`, { payments: [{ amount: 14840, method: "upi", reference: "UPI123456" }, { amount: 10000, method: "cash" }] }, { "idempotency-key": payKey });
check("split UPI + cash payment clears balance", split.json?.invoice?.balance === 0, split.json?.invoice);
const splitRetry = await A.c.req("POST", `/orders/${order.id}/payments`, { payments: [{ amount: 14840, method: "upi", reference: "UPI123456" }, { amount: 10000, method: "cash" }] }, { "idempotency-key": payKey });
check("payment retry does not double-collect", splitRetry.json?.invoice?.paid === 44840, splitRetry.json?.invoice);
const handover = await A.c.req("POST", `/orders/${order.id}/handover`, { garmentIds: [suitTag.id] });
check("partial handover succeeds", handover.status === 200, handover.json);
check("order partially delivered, not closed", handover.json.operationalStatus === "partially_delivered" && !handover.json.closedAt);

// refunds
const cashPay = handover.json.payments.find((p: any) => p.payment_method === "cash" && Number(p.payment_amount) === 10000);
const tooBig = await A.c.req("POST", `/payments/${cashPay.id}/refunds`, { amount: 10001, reason: "test" });
check("refund cannot exceed payment", tooBig.status === 422);
const refund = await A.c.req("POST", `/payments/${cashPay.id}/refunds`, { amount: 2000, reason: "Goodwill for delay" });
check("refund reopens balance of 20.00", refund.json?.invoice?.balance === 2000, refund.json?.invoice);

// ---------- AC-11 permissions
results.push("AC-11 Permissions");
await A.c.req("POST", "/staff", { name: "Counter", email: `counter-${runId}@test.local`, password: "counter-pass-123", roleKey: "reception" });
const R = new Client();
await R.req("POST", "/auth/login", { email: `counter-${runId}@test.local`, password: "counter-pass-123" });
const customerForCounter = await R.req("GET", `/customers/${cust.json.id}`);
const counterOrders = await R.req("GET", `/customers/${cust.json.id}/orders`);
const counterGarments = await R.req("GET", `/customers/${cust.json.id}/garments`);
check("customer profile hides financial totals without financial permission", customerForCounter.status === 200 && !customerForCounter.json.financialVisible && customerForCounter.json.stats.outstanding === undefined);
check("customer order history omits financial amounts without financial permission", counterOrders.status === 200 && counterOrders.json.every((item: any) => item.grand_total === undefined && item.balance === undefined));
check("customer garment history omits charged prices without financial permission", counterGarments.status === 200 && counterGarments.json.every((item: any) => item.unit_price === undefined));
check("customer payments require financial permission", (await R.req("GET", `/customers/${cust.json.id}/payments`)).status === 403);
const rDash = await R.req("GET", "/dashboard");
check("reception sees dashboard without financial figures", rDash.status === 200 && rDash.json.sales === null);
check("reception cannot issue refunds", (await R.req("POST", `/payments/${cashPay.id}/refunds`, { amount: 100, reason: "x" + "yz" })).status === 403);
check("reception cannot view financial reports", (await R.req("GET", "/reports/receivables")).status === 403);
check("reception cannot edit catalogue services", (await R.req("PATCH", `/services/${catalogueService.json.id}`, { category: "Restricted" })).status === 403);
const integrationStatus = await A.c.req("GET", "/system/integrations");
check(
  "owner can view safe integration status without provider secrets",
  integrationStatus.status === 200 &&
    typeof integrationStatus.json.emailProviderConfigured === "boolean" &&
    !JSON.stringify(integrationStatus.json).includes("RESEND_API_KEY"),
);
check("reception cannot view integration configuration", (await R.req("GET", "/system/integrations")).status === 403);
const otherBranch = await A.c.req("POST", "/branches", { name: "Other", branchCode: "OT" });
const branchStaff = await A.c.req("POST", "/staff", { name: "Other Branch", email: `branch-${runId}@test.local`, password: "branch-pass-123", roleKey: "reception", branchIds: [otherBranch.json.id] });
const branchClient = new Client();
await branchClient.req("POST", "/auth/login", { email: `branch-${runId}@test.local`, password: "branch-pass-123" });
const branchCustomerOrders = await branchClient.req("GET", `/customers/${cust.json.id}/orders`);
const branchCustomerGarments = await branchClient.req("GET", `/customers/${cust.json.id}/garments`);
const branchPriceList = await A.c.req("POST", "/price-lists", { name: "Main branch only", branchId: branchA });
check("customer order history is isolated to assigned branches", branchStaff.status === 201 && branchCustomerOrders.status === 200 && branchCustomerOrders.json.length === 0);
check("customer garment history is isolated to assigned branches", branchCustomerGarments.status === 200 && branchCustomerGarments.json.length === 0);
check("branch staff cannot read another branch price list", (await branchClient.req("GET", `/price-lists/${branchPriceList.json.id}/prices`)).status === 403);
check(
  "desktop recovery recognizes IPv4 and IPv6 loopback sockets",
  isLoopbackAddress("127.0.0.1") && isLoopbackAddress("::1") && isLoopbackAddress("::ffff:127.0.0.1"),
);
check(
  "desktop recovery rejects non-local socket addresses",
  !isLoopbackAddress("192.168.1.24") && !isLoopbackAddress("203.0.113.10") && !isLoopbackAddress(undefined),
);
const signingPair = generateKeyPairSync("ed25519");
const licensePublicKey = signingPair.publicKey.export({ type: "spki", format: "pem" }).toString();
const installA = randomUUID();
const installB = randomUUID();
const issuedAt = new Date(Date.now() - 60_000).toISOString();
const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
const signedPayload = signedLicenseSchema.parse({
  version: 1,
  licenseId: randomUUID(),
  plan: "Office Test",
  issuedAt,
  expiresAt,
  installationIds: [installA, installB],
});
const signedBytes = Buffer.from(JSON.stringify(signedPayload));
const activationKey = `DRYCARE1.${signedBytes.toString("base64url")}.${sign(null, signedBytes, signingPair.privateKey).toString("base64url")}`;
const verifiedLicense = verifySignedLicense(activationKey, licensePublicKey);
check("signed offline license verifies and supports separately issued PC seats", verifiedLicense?.installationIds.length === 2);
check("license is restricted to the listed PC request codes", getInstallationLicenseState(verifiedLicense, installA) === "active" && getInstallationLicenseState(verifiedLicense, randomUUID()) === "invalid");
check("expired signed license is rejected", getInstallationLicenseState({ ...signedPayload, expiresAt: new Date(Date.now() - 1000).toISOString() }, installA) === "expired");
// Change a character inside the signed payload: the final signature character is mostly base64 padding
// bits, so swapping it can decode to identical bytes and made this check flaky.
const tamperAt = "DRYCARE1.".length + 5;
const tamperedActivationKey = `${activationKey.slice(0, tamperAt)}${activationKey[tamperAt] === "A" ? "B" : "A"}${activationKey.slice(tamperAt + 1)}`;
check("tampered activation key is rejected", verifySignedLicense(tamperedActivationKey, licensePublicKey) === null);
check("only activation and safe status endpoints bypass license enforcement", isLicenseActivationRequest("POST", "/api/v1/system/license/activate") && !isLicenseActivationRequest("POST", "/api/v1/orders"));
const cloudDesktopRecovery = await A.c.req("POST", "/system/desktop-owner-recovery", {
  email: `owner-${runId}@test.local`,
  password: "new-owner-pass-123",
});
check("desktop password recovery is unavailable in cloud mode", cloudDesktopRecovery.status === 404);
check("reception cannot change prices", (await R.req("POST", `/price-lists/${pl.id}/prices`, { garmentTypeId: suit.id, serviceId: DC.id, unitPrice: 1 })).status === 403);
check("reception cannot pass QC", (await R.req("POST", `/garments/${shirtTags[0].id}/inspections`, { outcome: "pass" })).status === 403);
const bigDiscount = await R.req("POST", "/orders/quote", { ...orderBody, discountBps: 5000 });
check("reception cannot give 50% discount without approval", bigDiscount.status === 403);
const noCsrf = await app.inject({ method: "POST", url: "/api/v1/customers", payload: { name: "x" }, headers: { cookie: R.cookie } });
check("request without CSRF header rejected", noCsrf.statusCode === 403);
const anon = new Client();
check("unauthenticated request rejected", (await anon.req("GET", "/customers")).status === 401);

// ---------- AC-01 tenant isolation
results.push("AC-01 Tenant isolation");
check("tenant B cannot read tenant A order", (await B.c.req("GET", `/orders/${order.id}`)).status === 404);
check("tenant B cannot read tenant A customer", (await B.c.req("GET", `/customers/${cust.json.id}`)).status === 404);
check("tenant B cannot scan tenant A tag", (await B.c.req("GET", `/garments/by-tag/${suitTag.tagCode}`)).status === 404);
check("tenant B cannot move tenant A garment", (await B.c.req("POST", `/garments/${shirtTags[0].id}/transitions`, { to: "finishing" })).status === 404);
check("tenant B cannot pay tenant A order", (await B.c.req("POST", `/orders/${order.id}/payments`, { payments: [{ amount: 100, method: "cash" }] })).status === 404);
check("tenant B cannot refund tenant A payment", (await B.c.req("POST", `/payments/${cashPay.id}/refunds`, { amount: 100, reason: "steal" })).status === 404);
const bOrderOnA = await B.c.req("POST", "/orders", { ...orderBody, payments: [] });
check("tenant B cannot create order for tenant A customer/branch", bOrderOnA.status >= 400 && bOrderOnA.status < 500, bOrderOnA.status);
const bSearch = await B.c.req("GET", "/customers?q=Rahul");
check("tenant B customer search does not leak A's customers", bSearch.json.items.length === 0);

// ---------- AC-10 reporting reconciles
results.push("AC-10 Reporting");
const dash = await A.c.req("GET", "/dashboard");
check("gross billed includes both invoices", dash.json.sales.grossBilled === 44840 + approvalOrder.grandTotal, dash.json.sales);
check("collections = 448.40 − 20.00 refund", dash.json.collections.net === 42840, dash.json.collections);
check("outstanding includes the held approval order", dash.json.receivables.outstanding === 2000 + approvalOrder.grandTotal, dash.json.receivables);
check("rework rate = 1 fail / 2 inspections", dash.json.operations.reworkRate === 0.5, dash.json.operations);

// ---------- FR-DEL pickup & delivery
results.push("FR-DEL Pickup & delivery");
{
  const shirtSI = { garmentTypeId: shirt.id, serviceId: SI.id, quantity: 1 };
  const od = (await A.c.req("POST", "/orders", { customerId: cust.json.id, branchId: branchA, promisedAt, items: [shirtSI] })).json;
  const g = od.garments[0];
  for (const to of ["finishing", "quality_control"]) await A.c.req("POST", `/garments/${g.id}/transitions`, { to });
  await A.c.req("POST", `/garments/${g.id}/inspections`, { outcome: "pass" });
  await A.c.req("POST", `/garments/${g.id}/storage-location`, { storageLocationId: locs.json[1].id });
  await A.c.req("POST", `/garments/${g.id}/transitions`, { to: "ready" });
  check("scan station can no longer send garments out without a delivery", (await A.c.req("POST", `/garments/${g.id}/transitions`, { to: "dispatched" })).status === 422);

  const address = { line1: "12 Sea View Apartments", city: "Mumbai" };
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const base = { kind: "delivery", customerId: cust.json.id, branchId: branchA, orderId: od.id, address, scheduledDate: tomorrow, timeSlot: "10:00-12:00" };
  const due = await A.c.req("POST", "/deliveries", base);
  check("delivery with unpaid balance needs collect-on-delivery or credit", due.status === 422 && due.json.error.code === "BALANCE_DUE", due.json);
  const del = await A.c.req("POST", "/deliveries", { ...base, collectOnDelivery: true });
  check("delivery scheduled with amount to collect", del.status === 201 && Number(del.json.collect_amount) === od.grandTotal && del.json.items.length === 1, del.json);
  check("OTP is never shown to staff", del.json.hasOtp === true && !("otp_hash" in del.json) && !JSON.stringify(del.json).match(/"otp"/));
  const dup = await A.c.req("POST", "/deliveries", { ...base, collectOnDelivery: true });
  check("same garment cannot be on two deliveries", dup.status === 422 && dup.json.error.code === "ALREADY_SCHEDULED");

  await A.c.req("POST", "/staff", { name: "Driver Dev", email: `driver-${runId}@test.local`, password: "driver-pass-123", roleKey: "driver" });
  const D = new Client();
  await D.req("POST", "/auth/login", { email: `driver-${runId}@test.local`, password: "driver-pass-123" });
  const drivers = (await A.c.req("GET", "/drivers")).json;
  const driverId = drivers.find((d: any) => d.name === "Driver Dev")?.id;
  check("driver appears in assignable drivers", !!driverId);
  check("cannot dispatch before assigning an agent", (await A.c.req("POST", `/deliveries/${del.json.id}/dispatch`, { scannedTags: [g.tagCode] })).status === 422);
  await A.c.req("POST", `/deliveries/${del.json.id}/assign`, { driverUserId: driverId });
  const pickupOther = await A.c.req("POST", "/deliveries", { kind: "pickup", customerId: cust.json.id, branchId: branchA, address, scheduledDate: tomorrow, timeSlot: "12:00-14:00" });
  const dList = (await D.req("GET", "/deliveries?status=active")).json;
  check("driver sees only stops assigned to them (FR-DEL-006)", dList.length === 1 && dList[0].id === del.json.id, dList.length);
  check("driver cannot open an unassigned stop", (await D.req("GET", `/deliveries/${pickupOther.json.id}`)).status === 404);
  check("driver cannot schedule deliveries", (await D.req("POST", "/deliveries", { ...base, collectOnDelivery: true })).status === 403);
  check("driver cannot browse customers or orders", (await D.req("GET", "/customers")).status === 403 && (await D.req("GET", `/orders/${od.id}`)).status === 403);

  const bad = await D.req("POST", `/deliveries/${del.json.id}/dispatch`, { scannedTags: ["WRONG-TAG"] });
  check("dispatch blocked when scanned tags don't match the manifest", bad.status === 422 && bad.json.error.code === "MANIFEST_MISMATCH", bad.json);
  const out = await D.req("POST", `/deliveries/${del.json.id}/dispatch`, { scannedTags: [g.tagCode.toLowerCase()] });
  check("dispatch after verifying every tag", out.json.status === "out" && out.json.items[0].current_status === "dispatched", out.json);

  const [{ payload }] = await sqlClient`select payload from outbox_events where event_type = 'delivery.scheduled' and payload->>'deliveryId' = ${del.json.id}`;
  const otp = (payload as any).otp as string;
  const wrongOtp = await D.req("POST", `/deliveries/${del.json.id}/complete`, { outcome: "completed", method: "otp", otp: otp === "000000" ? "111111" : "000000" });
  check("wrong OTP rejected", wrongOtp.status === 422 && wrongOtp.json.error.code === "OTP_MISMATCH");
  const unpaid = await D.req("POST", `/deliveries/${del.json.id}/complete`, { outcome: "completed", method: "otp", otp });
  check("cannot hand over before collecting the amount due", unpaid.status === 422 && unpaid.json.error.code === "BALANCE_DUE");
  const done = await D.req("POST", `/deliveries/${del.json.id}/complete`, { outcome: "completed", method: "otp", otp, payments: [{ amount: od.grandTotal, method: "cash" }] });
  check("delivered with OTP + doorstep cash payment", done.json.status === "completed" && done.json.items[0].current_status === "delivered", done.json);
  const odAfter = (await A.c.req("GET", `/orders/${od.id}`)).json;
  check("order closed and fully paid after delivery", odAfter.operationalStatus === "delivered" && odAfter.invoice.balance === 0 && !!odAfter.closedAt);

  // pickup: failed attempt → reschedule → collected → booked as an order
  const pk = pickupOther.json;
  await A.c.req("POST", `/deliveries/${pk.id}/assign`, { driverUserId: driverId });
  await D.req("POST", `/deliveries/${pk.id}/dispatch`, {});
  const noReason = await D.req("POST", `/deliveries/${pk.id}/complete`, { outcome: "failed" });
  check("failed attempt needs a reason", noReason.status === 400);
  const failed = await D.req("POST", `/deliveries/${pk.id}/complete`, { outcome: "failed", failureReason: "customer_not_available" });
  check("failed pickup recorded", failed.json.status === "failed");
  const resched = await A.c.req("POST", `/deliveries/${pk.id}/reschedule`, { scheduledDate: tomorrow, timeSlot: "16:00-18:00" });
  check("rescheduled keeps the agent", resched.json.status === "assigned" && resched.json.time_slot === "16:00-18:00");
  await D.req("POST", `/deliveries/${pk.id}/dispatch`, {});
  const collected = await D.req("POST", `/deliveries/${pk.id}/complete`, { outcome: "completed", bagCount: 2 });
  check("pickup completed with bag count", collected.json.status === "completed" && collected.json.bag_count === 2 && Number(collected.json.attempts) === 2);
  const fromPickup = await A.c.req("POST", "/orders", { customerId: cust.json.id, branchId: branchA, promisedAt, items: [shirtSI], pickupId: pk.id });
  check("order booked from pickup is linked", fromPickup.status === 201 && fromPickup.json.orderSource === "pickup", fromPickup.json);
  const again = await A.c.req("POST", "/orders", { customerId: cust.json.id, branchId: branchA, promisedAt, items: [shirtSI], pickupId: pk.id });
  check("a pickup can be booked only once", again.status === 422);
  check("tenant B cannot see tenant A deliveries", (await B.c.req("GET", `/deliveries/${pk.id}`)).status === 404);
}

// ---------- FR-AUTH-004 / 008 reset links & invitations
results.push("FR-AUTH Password reset & invitations");
{
  const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;
  const staff = (await A.c.req("GET", "/staff")).json;
  const counter = staff.find((s: any) => s.email === `counter-${runId}@test.local`);
  check("reception cannot create reset links", (await R.req("POST", `/staff/${counter.membershipId}/reset-link`, {})).status === 403);
  const link = await A.c.req("POST", `/staff/${counter.membershipId}/reset-link`, {});
  check("owner gets a one-time reset link", link.status === 200 && link.json.url.includes("/reset-password?token="), link.json);
  const t = tokenOf(link.json.url);
  const info = await anon.req("GET", `/auth/token/${t}`);
  check("link shows who it is for", info.json.purpose === "password_reset" && info.json.email === `counter-${runId}@test.local`);
  check("short new password rejected", (await anon.req("POST", "/auth/reset-password", { token: t, password: "short" })).status === 400);
  const reset = await anon.req("POST", "/auth/reset-password", { token: t, password: "brand-new-pass-1" });
  check("password reset succeeds", reset.status === 200);
  check("old sessions are signed out after reset", (await R.req("GET", "/auth/session")).status === 401);
  check("link cannot be used twice", (await new Client().req("POST", "/auth/reset-password", { token: t, password: "another-pass-12" })).status === 410);
  const L = new Client();
  check("old password no longer works", (await L.req("POST", "/auth/login", { email: `counter-${runId}@test.local`, password: "counter-pass-123" })).status === 401);
  check("new password works", (await L.req("POST", "/auth/login", { email: `counter-${runId}@test.local`, password: "brand-new-pass-1" })).status === 200);
  const f1 = await anon.req("POST", "/auth/forgot-password", { email: "nobody@nowhere.test" });
  const f2 = await anon.req("POST", "/auth/forgot-password", { email: A.email });
  check("forgot-password gives the same answer for unknown emails", f1.status === 200 && f1.json.message === f2.json.message);

  const inv = await A.c.req("POST", "/staff/invitations", { name: "New Inspector", email: `inspector-${runId}@test.local`, roleKey: "inspector" });
  check("invitation created with link", inv.status === 201 && inv.json.url.includes("/accept-invite?token="));
  const it = tokenOf(inv.json.url);
  check("pending invitation is listed", (await A.c.req("GET", "/staff/invitations")).json.some((i: any) => i.id === inv.json.id));
  const N = new Client();
  check("weak password rejected on accept", (await N.req("POST", "/auth/accept-invitation", { token: it, password: "123" })).status === 400);
  const acc = await N.req("POST", "/auth/accept-invitation", { token: it, password: "inspector-pass-1" });
  check("invitation accepted and signed in", acc.status === 201 && (await N.req("GET", "/auth/session")).json.role.key === "inspector");
  check("invitation cannot be reused", (await new Client().req("POST", "/auth/accept-invitation", { token: it, password: "inspector-pass-1" })).status === 410);
  const inv2 = await A.c.req("POST", "/staff/invitations", { name: "Temp", email: `temp-${runId}@test.local`, roleKey: "operator" });
  check("tenant B cannot revoke tenant A's invitation", (await B.c.req("POST", `/staff/invitations/${inv2.json.id}/revoke`, {})).status === 404);
  await A.c.req("POST", `/staff/invitations/${inv2.json.id}/revoke`, {});
  check("revoked invitation link is dead", (await anon.req("GET", `/auth/token/${tokenOf(inv2.json.url)}`)).status === 410);
  check("cannot invite an existing staff member", (await A.c.req("POST", "/staff/invitations", { name: "Dup", email: `counter-${runId}@test.local`, roleKey: "reception" })).status === 409);
}

// ---------- ledger immutability
results.push("Ledger integrity");
let blocked = false;
try {
  await sqlClient`update payments set amount = 1 where id = ${cashPay.id}`;
} catch {
  blocked = true;
}
check("database blocks editing a payment amount", blocked);
blocked = false;
try {
  await sqlClient`delete from audit_logs where organization_id = ${A.session.organization.id}`;
} catch {
  blocked = true;
}
check("database blocks deleting audit logs", blocked);

console.log(results.join("\n"));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
// The suite's plan must never stay visible to real shops.
await sqlClient`update commercial_plans set published = false where id = ${commercialPlan.id}`;
await app.close();
await sqlClient.end();
process.exit(failures ? 1 : 0);
