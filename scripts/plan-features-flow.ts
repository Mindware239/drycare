/**
 * Plans, per-shop features, renewals, approved hardware and customer memberships, end to end through the API.
 * Run: pnpm --filter @drycare/api features-test
 * The approved-hardware list is shared, so it is restored at the end. Test license keys are for random PCs and are removed.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { buildServer } from "../apps/api/src/app";
import { db, schema, sqlClient } from "../apps/api/src/db/client";
import { customerChannel } from "../apps/api/src/lib/entitlements";

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

const runId = randomUUID().slice(0, 6);
const REASON = "Automated test of plan features";
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const platformOrg = await db.query.organizations.findFirst({ where: (o, { eq: e }) => e(o.slug, "drycare-platform") });
const platformRole = platformOrg && await db.query.roles.findFirst({ where: (r, { and, eq: e }) => and(e(r.organizationId, platformOrg.id), e(r.key, "platform_admin")) });
if (!platformOrg || !platformRole) throw new Error("Run pnpm admin:create once before this test.");
const [saUser] = await db.insert(schema.users).values({ email: `sa-features-${runId}@test.local`, name: "Features Test Admin", passwordHash: "x", isPlatformAdmin: true }).returning();
await db.insert(schema.memberships).values({ organizationId: platformOrg.id, userId: saUser.id, roleId: platformRole.id });
const token = randomBytes(32).toString("base64url");
await db.insert(schema.sessions).values({ id: createHash("sha256").update(token).digest("hex"), userId: saUser.id, organizationId: platformOrg.id, expiresAt: new Date(Date.now() + 3600_000) });
const sa = new Client();
sa.cookie = `dc_session=${token}`;

const plans = await db.select().from(schema.commercialPlans);
const planByCode = (code: string) => plans.find((p) => p.code === code)!;
const starter = planByCode("starter");
const growth = planByCode("growth");
if (!starter || !growth) throw new Error("The starter and growth plans are needed for this test.");

const hardwareBefore = (await sa.req("GET", "/platform-admin/hardware")).json;
const licenseIds: string[] = [];
let testPlanId: string | null = null;

async function signup(label: string) {
  const c = new Client();
  const r = await c.req("POST", "/organizations", { businessName: `Feature Flow ${label} ${runId}`, ownerName: "Feature Owner", email: `owner-feat-${label}-${runId}@test.local`, password: `Flow-${runId}-Password1`, acceptedTerms: true });
  if (r.status !== 201) throw new Error(`signup failed: ${JSON.stringify(r.json)}`);
  const session = (await c.req("GET", "/auth/session")).json;
  return { c, orgId: session.organization.id as string, branchId: session.branches[0].id as string };
}
const features = async (c: Client) => (await c.req("GET", "/auth/session")).json.features;

try {
  const { c: shop, orgId, branchId } = await signup("a");

  section("Trial");
  let f = await features(shop);
  check("a trial shop can try every feature", f.labelDesigner && f.customerMemberships && f.inventory && f.laundry, f);

  section("Starter plan (basic)");
  let r = await shop.req("POST", `/platform-admin/organizations/${orgId}/subscription`, { planId: starter.id, endsOn: dayFromNow(30), reason: REASON });
  check("a shop owner cannot give itself a plan", r.status === 403, r.json);
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/subscription`, { planId: starter.id, endsOn: dayFromNow(-1), reason: REASON });
  check("an end date in the past is refused", r.status === 409 && r.json.error.code === "END_DATE_IN_PAST", r.json);
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/subscription`, { planId: starter.id, endsOn: dayFromNow(30), reason: "short" });
  check("a reason is required", r.status === 400, r.json);
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/subscription`, { planId: starter.id, endsOn: dayFromNow(30), reason: REASON });
  check("super admin can put a shop on Starter without a payment", r.status === 201, r.json);
  const firstSubId = r.json.id;
  f = await features(shop);
  check("Starter has no tag designer, memberships, stock, laundry or campaigns", !f.labelDesigner && !f.customerMemberships && !f.inventory && !f.laundry && !f.marketing, f);
  check("Starter keeps what it already had saved on the plan", f.deliveries && f.onlineBooking, f);

  for (const [url, name] of [["/inventory/items", "stock"], ["/suppliers", "suppliers"], ["/membership-plans", "memberships"], ["/customer-memberships", "member list"], ["/laundry/config", "laundry"], ["/marketing/campaigns", "campaigns"]]) {
    r = await shop.req("GET", url);
    check(`${name} are refused by the server`, r.status === 403 && r.json.error.code === "FEATURE_NOT_IN_PLAN", { status: r.status, json: r.json });
  }
  r = await shop.req("GET", "/customers");
  check("core screens still work", r.status === 200, r.json);

  section("Tag designer is locked on Starter");
  const customDesign = { widthMm: 70, heightMm: 40, border: false, elements: {}, barcode: { type: "code128", show: true, x: 0, y: 0, centered: true, moduleDots: 2, heightDots: 72 } };
  r = await shop.req("PATCH", "/organizations/current", { settings: { labels: { garmentDesign: customDesign, density: 7, printerName: "My printer" } } });
  check("saving tag settings still works", r.status === 200, r.json);
  let labels = r.json.settings.labels;
  check("a custom tag design sent directly to the server is ignored", labels.garmentDesign.widthMm !== 70, labels.garmentDesign);
  check("printer settings are saved", labels.density === 7 && labels.printerName === "My printer", labels);
  check("the tag stays at the ready-made taffeta size", labels.garmentDesign.widthMm === 38 && labels.garmentDesign.heightMm === 30, labels.garmentDesign);

  section("Shop owners cannot unlock features themselves");
  r = await shop.req("PATCH", "/organizations/current", { featureOverrides: { labelDesigner: true }, settings: { featureOverrides: { labelDesigner: true } } });
  f = await features(shop);
  check("sending overrides in the shop's own settings changes nothing", !f.labelDesigner, f);
  r = await shop.req("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides: { labelDesigner: true }, reason: REASON });
  check("the super admin route refuses a shop owner", r.status === 403, r.json);

  section("Super admin exceptions for one shop");
  r = await sa.req("GET", `/platform-admin/organizations/${orgId}/entitlements`);
  check("the console shows the plan and its features", r.json.plan?.name === starter.name && r.json.planFeatures.labelDesigner === false, r.json);
  r = await sa.req("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides: { unknownThing: true }, reason: REASON });
  check("an unknown feature is refused", r.status === 400, r.json);
  r = await sa.req("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides: { labelDesigner: true, deliveries: false }, reason: REASON });
  check("exceptions save", r.status === 200 && r.json.effective.labelDesigner && !r.json.effective.deliveries, r.json);
  r = await shop.req("PATCH", "/organizations/current", { settings: { labels: { garmentDesign: customDesign } } });
  check("with the exception on, the custom design saves", r.json.settings.labels.garmentDesign.widthMm === 70, r.json.settings?.labels?.garmentDesign);
  r = await shop.req("GET", "/deliveries");
  check("with the exception off, deliveries are refused", r.status === 403, r.json);
  await sa.req("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides: { deliveries: true }, reason: REASON });
  r = await shop.req("PATCH", "/organizations/current", { settings: { labels: { density: 9, garmentDesign: { ...customDesign, widthMm: 80 } } } });
  labels = r.json.settings.labels;
  check("after the exception ends the saved design survives but cannot change", labels.garmentDesign.widthMm === 70 && labels.density === 9, labels.garmentDesign);

  section("Online booking");
  await sa.req("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides: {}, reason: REASON });
  r = await shop.req("PUT", "/booking/settings", { enabled: true });
  check("booking settings save while the feature is on", r.status === 200, r.json);
  const slug = (await shop.req("GET", "/organizations/current")).json.slug;
  const pub = new Client();
  r = await pub.req("GET", `/public/booking/${slug}`);
  check("the public booking page opens", r.status === 200, r.json);
  await sa.req("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides: { onlineBooking: false }, reason: REASON });
  r = await pub.req("GET", `/public/booking/${slug}`);
  check("with the feature off, the public page closes too", r.status === 404, r.json);
  await sa.req("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides: {}, reason: REASON });

  section("Renewing and changing plans");
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/subscription`, { planId: starter.id, endsOn: dayFromNow(60), reason: REASON });
  check("renewing the same plan extends the same subscription", r.status === 201 && r.json.id === firstSubId, r.json);
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/subscription`, { planId: growth.id, endsOn: dayFromNow(365), reason: REASON });
  check("upgrading starts a new subscription", r.status === 201 && r.json.id !== firstSubId, r.json);
  const old = await db.query.commercialSubscriptions.findFirst({ where: (s, { eq }) => eq(s.id, firstSubId) });
  check("the old subscription is closed", old?.status === "canceled", old);
  f = await features(shop);
  check("Growth unlocks the tag designer, memberships and stock", f.labelDesigner && f.customerMemberships && f.inventory, f);

  section("Plan editor keeps other plan settings");
  r = await sa.req("POST", "/platform-admin/plans", { code: `smoke-feat-${runId}`, name: `Feature Test ${runId}` });
  testPlanId = r.json.id;
  await sqlClient`update commercial_plans set entitlements_json = ${JSON.stringify({ cloudSync: true })}::jsonb where id = ${testPlanId!}`;
  r = await sa.req("PATCH", `/platform-admin/plans/${testPlanId}`, { entitlements: { labelDesigner: true } });
  check("saving features does not erase cloud sync", r.json.entitlements.cloudSync === true && r.json.entitlements.labelDesigner === true, r.json);

  section("Customer memberships");
  await shop.req("POST", "/cashier-shifts", { branchId, openingCash: 0 });
  const serviceId = (await shop.req("POST", "/services", { name: "Feature clean", category: "Dry Clean", serviceCode: "FEAT", unitType: "per_piece", workflowStages: ["received", "ready"] })).json.id;
  const garmentTypeId = (await shop.req("POST", "/garment-types", { name: `Feature Shirt ${runId}`, category: "Men" })).json.id;
  const priceList = (await shop.req("GET", "/price-lists")).json[0];
  await shop.req("POST", `/price-lists/${priceList.id}/prices`, { garmentTypeId, serviceId, unitPrice: 10000, taxBps: 0 });
  const customerId = (await shop.req("POST", "/customers", { name: "Member Customer", phone: `+91 97${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` })).json.id;
  const quoteBody = (extra: object = {}) => ({ customerId, branchId, items: [{ garmentTypeId, serviceId, quantity: 1 }], ...extra });

  r = await shop.req("POST", "/membership-plans", { name: "Gold", price: 99900, durationDays: 365, discountBps: 0 });
  check("a plan needs a discount", r.status === 400, r.json);
  r = await shop.req("POST", "/membership-plans", { name: "Gold", price: 99900, durationDays: 365, discountBps: 1000 });
  check("a shop can create a membership plan", r.status === 201, r.json);
  const gold = r.json;
  const silver = (await shop.req("POST", "/membership-plans", { name: "Silver", price: 0, durationDays: 30, discountBps: 500 })).json;

  r = await shop.req("POST", "/orders/quote", quoteBody());
  check("before buying, no discount applies", r.status === 200 && r.json.totals.discountTotal === 0 && r.json.membership === null, r.json);
  r = await shop.req("POST", `/customers/${customerId}/memberships`, { planId: gold.id, branchId });
  check("a paid plan needs a payment method", r.status === 400, r.json);
  r = await shop.req("POST", `/customers/${customerId}/memberships`, { planId: gold.id, branchId, method: "upi" });
  check("UPI needs a transaction reference", r.status === 400, r.json);
  r = await shop.req("POST", `/customers/${customerId}/memberships`, { planId: gold.id, branchId, method: "cash" });
  check("selling a membership works", r.status === 201 && r.json.pricePaid === 99900, r.json);
  const firstMembership = r.json;
  const payment = await db.query.payments.findFirst({ where: (p, { eq }) => eq(p.id, firstMembership.paymentId) });
  check("the fee is recorded as money received, in the open shift", payment?.amount === 99900 && payment.status === "succeeded" && !!payment.shiftId, payment);

  r = await shop.req("POST", "/orders/quote", quoteBody());
  check("a member gets the discount automatically", r.json.totals.discountTotal === 1000 && r.json.membership?.applied === true, r.json);
  r = await shop.req("POST", "/orders/quote", quoteBody({ discountBps: 500 }));
  check("a smaller manual discount does not add to it", r.json.discountBps === 1000 && r.json.totals.discountTotal === 1000, r.json);
  r = await shop.req("POST", "/orders/quote", quoteBody({ discountBps: 2000 }));
  check("a bigger manual discount is used instead", r.json.discountBps === 2000 && r.json.membership?.applied === false, r.json);

  const now = new Date();
  const [campaign] = await db.insert(schema.marketingCampaigns).values({ organizationId: orgId, name: "Test", subject: "Test", body: "Test", audience: {}, createdBy: saUser.id }).returning();
  const [lowCoupon] = await db.insert(schema.marketingCoupons).values({ organizationId: orgId, campaignId: campaign.id, code: `LOW${runId}`.toUpperCase(), discountBps: 500, startsAt: new Date(now.getTime() - 3600_000), expiresAt: new Date(now.getTime() + 86_400_000) }).returning();
  r = await shop.req("POST", "/orders", { ...quoteBody({ couponCode: lowCoupon.code }), promisedAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), payments: [] }, { "idempotency-key": `feat-${runId}` });
  check("the order uses the membership over a smaller coupon", r.status === 201 && r.json.customerMembershipId === firstMembership.id && r.json.couponId === null && r.json.discountBps === 1000, r.json);
  const redeemed = await sqlClient`select id from marketing_coupon_redemptions where coupon_id = ${lowCoupon.id}`;
  check("that coupon is not used up", redeemed.length === 0, redeemed);

  r = await shop.req("POST", `/customers/${customerId}/memberships`, { planId: silver.id, branchId });
  check("a second, different plan is refused while one is active", r.status === 409 && r.json.error.code === "MEMBERSHIP_ACTIVE", r.json);
  r = await shop.req("POST", `/customers/${customerId}/memberships`, { planId: gold.id, branchId, method: "cash" });
  check("renewing early adds on to the end date", r.status === 201 && r.json.startsAt === firstMembership.endsAt, { renewal: r.json, firstMembership });
  const renewal = r.json;

  const { c: other, branchId: otherBranch } = await signup("b");
  await sa.req("POST", `/platform-admin/organizations/${(await other.req("GET", "/auth/session")).json.organization.id}/subscription`, { planId: growth.id, endsOn: dayFromNow(30), reason: REASON });
  r = await other.req("POST", `/customers/${customerId}/memberships`, { planId: gold.id, branchId: otherBranch, method: "cash" });
  check("another shop cannot sell to this customer", r.status === 404, r.json);
  r = await other.req("GET", `/customers/${customerId}/memberships`);
  check("another shop sees none of this customer's memberships", r.status === 200 && r.json.current === null && r.json.history.length === 0, r.json);
  r = await other.req("PATCH", `/membership-plans/${gold.id}`, { discountBps: 9000 });
  check("another shop cannot change this shop's plan", r.status === 404, r.json);
  r = await other.req("POST", `/customer-memberships/${firstMembership.id}/cancel`, { reason: REASON });
  check("another shop cannot cancel this membership", r.status === 409, r.json);

  r = await shop.req("PATCH", `/membership-plans/${gold.id}`, { discountBps: 5000 });
  r = await shop.req("POST", "/orders/quote", quoteBody());
  check("changing a plan does not change what a customer already bought", r.json.discountBps === 1000, r.json);

  r = await shop.req("GET", "/customer-memberships?state=current&search=Member");
  check("the member list finds the customer", r.status === 200 && r.json.length === 2 && r.json[0].customerName === "Member Customer", r.json);

  await sa.req("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides: { customerMemberships: false }, reason: REASON });
  r = await shop.req("POST", "/orders/quote", quoteBody());
  check("with memberships switched off, no discount applies", r.json.totals.discountTotal === 0 && r.json.membership === null, r.json);
  await sa.req("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides: {}, reason: REASON });

  r = await shop.req("POST", `/customer-memberships/${firstMembership.id}/cancel`, { reason: "short" });
  check("cancelling needs a reason", r.status === 400, r.json);
  r = await shop.req("POST", `/customer-memberships/${firstMembership.id}/cancel`, { reason: REASON });
  check("a membership can be cancelled", r.status === 200 && r.json.status === "cancelled", r.json);
  r = await shop.req("POST", "/orders/quote", quoteBody());
  check("a cancelled membership gives no discount, and a renewal not started yet gives none either", r.json.totals.discountTotal === 0, r.json);
  await sqlClient`update customer_memberships set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = ${renewal.id}`;
  r = await shop.req("POST", "/orders/quote", quoteBody());
  check("an expired membership gives no discount", r.json.totals.discountTotal === 0 && r.json.membership === null, r.json);
  r = await shop.req("POST", `/customers/${customerId}/memberships`, { planId: silver.id, branchId });
  check("a free plan needs no payment, and can be sold once the old one has ended", r.status === 201 && r.json.paymentId === null, r.json);

  section("Cancelling and renewing a shop");
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/subscription/cancel`, { reason: REASON });
  check("super admin can cancel a plan", r.status === 200 && r.json.status === "canceled", r.json);
  r = await shop.req("POST", "/customers", { name: "Blocked Customer", phone: "+91 9000000000" });
  check("a cancelled shop cannot make changes", r.status === 402 && r.json.error.code === "SUBSCRIPTION_REQUIRED", r.json);
  r = await shop.req("GET", "/customers");
  check("a cancelled shop can still see its data", r.status === 200, r.json);
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/subscription/cancel`, { reason: REASON });
  check("cancelling twice is refused", r.status === 409, r.json);
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/subscription`, { planId: growth.id, endsOn: dayFromNow(30), reason: REASON });
  check("super admin can renew an expired or cancelled shop", r.status === 201, r.json);
  r = await shop.req("POST", "/customers", { name: "Allowed Customer", phone: `+91 96${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` });
  check("after renewal the shop can make changes again", r.status === 201, r.json);

  section("Approved hardware");
  r = await shop.req("PUT", "/platform-admin/hardware", { printers: ["Anything"], scanners: [] });
  check("a shop owner cannot change the approved list", r.status === 403, r.json);
  r = await sa.req("PUT", "/platform-admin/hardware", { printers: ["TSC TE244", "TSC TE244"], scanners: ["Honeywell HH400"] });
  check("super admin can set the approved list, without duplicates", r.status === 200 && r.json.printers.length === 1, r.json);
  r = await shop.req("GET", "/labels/hardware");
  check("shops can see the approved list", r.json.printers[0] === "TSC TE244" && r.json.scanners[0] === "Honeywell HH400", r.json);

  section("Branch limit");
  const { c: basic, orgId: basicOrg, branchId: basicBranch } = await signup("c");
  const addBranch = (code: string) => basic.req("POST", "/branches", { name: `Branch ${code}`, branchCode: code });
  r = await addBranch("TRIAL1");
  check("a trial shop can add branches", r.status === 201, r.json);
  const extraBranch = r.json.id;
  await sa.req("POST", `/platform-admin/organizations/${basicOrg}/subscription`, { planId: starter.id, endsOn: dayFromNow(30), reason: REASON });
  r = await addBranch("OVER1");
  check("over the plan's limit, a new branch is refused", r.status === 403 && r.json.error.code === "BRANCH_LIMIT_REACHED", r.json);
  r = await basic.req("GET", "/branches");
  check("branches already open are not closed by a lower plan", r.json.filter((b: any) => b.status === "active").length === 2, r.json);
  await basic.req("PATCH", `/branches/${extraBranch}`, { status: "inactive" });
  r = await addBranch("OVER2");
  check("still at the limit with one active branch, a new one is refused", r.status === 403, r.json);
  r = await basic.req("PATCH", `/branches/${extraBranch}`, { status: "active" });
  check("reopening a branch over the limit is refused too", r.status === 403 && r.json.error.code === "BRANCH_LIMIT_REACHED", r.json);
  r = await basic.req("PATCH", `/branches/${basicBranch}`, { name: "Renamed Main Store" });
  check("editing an open branch still works at the limit", r.status === 200, r.json);
  r = await sa.req("PUT", `/platform-admin/organizations/${basicOrg}/entitlements`, { overrides: {}, branchLimit: 2, reason: REASON });
  check("super admin can allow more branches for one shop", r.status === 200, r.json);
  r = await sa.req("GET", `/platform-admin/organizations/${basicOrg}/entitlements`);
  check("the console shows the branch numbers", r.json.branches.planLimit === 1 && r.json.branches.override === 2 && r.json.branches.limit === 2 && r.json.branches.active === 1, r.json.branches);
  r = await basic.req("PATCH", `/branches/${extraBranch}`, { status: "active" });
  check("with the exception, the branch reopens", r.status === 200, r.json);
  r = await addBranch("OVER3");
  check("the exception is a limit too", r.status === 403, r.json);
  await sa.req("PUT", `/platform-admin/organizations/${basicOrg}/entitlements`, { overrides: {}, branchLimit: null, reason: REASON });
  r = await sa.req("GET", `/platform-admin/organizations/${basicOrg}/entitlements`);
  check("the exception can be removed", r.json.branches.limit === 1 && r.json.branches.override === null, r.json.branches);

  section("Wallet on a plan without it");
  const walletCustomer = (await basic.req("POST", "/customers", { name: "Wallet Customer", phone: `+91 94${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` })).json.id;
  const walletItems = await (async () => {
    const svc = (await basic.req("POST", "/services", { name: "Wallet clean", category: "Dry Clean", serviceCode: "WALT", unitType: "per_piece", workflowStages: ["received", "ready"] })).json.id;
    const gt = (await basic.req("POST", "/garment-types", { name: `Wallet Shirt ${runId}`, category: "Men" })).json.id;
    const list = (await basic.req("GET", "/price-lists")).json[0];
    await basic.req("POST", `/price-lists/${list.id}/prices`, { garmentTypeId: gt, serviceId: svc, unitPrice: 10000, taxBps: 0 });
    return [{ garmentTypeId: gt, serviceId: svc, quantity: 1 }];
  })();
  await basic.req("POST", "/cashier-shifts", { branchId: basicBranch, openingCash: 0 });
  r = await basic.req("POST", `/customers/${walletCustomer}/wallet/topups`, { branchId: basicBranch, amount: 50000, method: "cash" });
  check("adding money is refused", r.status === 403 && r.json.error.code === "FEATURE_NOT_IN_PLAN", r.json);
  r = await basic.req("POST", `/customers/${walletCustomer}/wallet/adjustments`, { amount: 50000, reason: "Goodwill credit attempt" });
  check("adding money by adjustment is refused too", r.status === 403, r.json);
  await sa.req("PUT", `/platform-admin/organizations/${basicOrg}/entitlements`, { overrides: { wallet: true }, reason: REASON });
  r = await basic.req("POST", `/customers/${walletCustomer}/wallet/topups`, { branchId: basicBranch, amount: 50000, method: "cash" });
  check("with the exception on, a top-up works", r.status === 201 && r.json.balance === 50000, r.json);
  await sa.req("PUT", `/platform-admin/organizations/${basicOrg}/entitlements`, { overrides: { wallet: false }, reason: REASON });
  r = await basic.req("GET", `/customers/${walletCustomer}/wallet`);
  check("after it ends, the customer's balance is still there", r.status === 200 && r.json.balance === 50000, r.json);
  r = await basic.req("POST", "/orders", { customerId: walletCustomer, branchId: basicBranch, items: walletItems, promisedAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), payments: [{ amount: 10000, method: "store_credit" }] }, { "idempotency-key": `wallet-${runId}` });
  check("the customer can still spend their balance", r.status === 201, r.json);
  r = await basic.req("POST", `/customers/${walletCustomer}/wallet/adjustments`, { amount: -40000, reason: "Settling leftover balance in cash" });
  check("the shop can still settle a leftover balance", r.status === 201 && r.json.balance === 0, r.json);
  r = await basic.req("POST", "/claims", { customerId: walletCustomer, branchId: basicBranch, kind: "stain", description: "Stain on the shirt collar" });
  check("a claim can be opened", r.status === 201, r.json);
  const claimId = r.json.id;
  r = await basic.req("POST", `/claims/${claimId}/decision`, { outcome: "approve", resolution: "wallet_credit", amount: 5000, note: "Agreed compensation" });
  check("wallet compensation on a claim is refused", r.status === 403 && r.json.error.code === "FEATURE_NOT_IN_PLAN", r.json);
  r = await basic.req("POST", `/claims/${claimId}/decision`, { outcome: "approve", resolution: "cash", amount: 5000, note: "Agreed compensation" });
  check("cash compensation still works", r.status === 200, r.json);
  await sa.req("PUT", `/platform-admin/organizations/${basicOrg}/entitlements`, { overrides: {}, reason: REASON });

  section("Reports");
  r = await basic.req("GET", "/reports/catalogue");
  const entry = (key: string) => r.json.find((e: any) => e.key === key);
  check("advanced reports are marked as locked on Starter", entry("sales-service")?.locked === true && entry("staff-productivity")?.locked === true, r.json?.map?.((e: any) => [e.key, e.locked]));
  check("everyday and filing reports are not", entry("gst-summary")?.locked === false && entry("sales-day")?.locked === false && entry("dues")?.locked === false && entry("daybook")?.locked === false, r.json?.map?.((e: any) => [e.key, e.locked]));
  r = await basic.req("GET", "/reports/run/sales-service");
  check("an advanced report is refused by the server", r.status === 403 && r.json.error.code === "FEATURE_NOT_IN_PLAN", r.json);
  r = await basic.req("GET", "/reports/run/gst-summary");
  check("the GST summary works on Starter", r.status === 200, r.json);
  r = await shop.req("GET", "/reports/run/sales-service");
  check("Growth gets the advanced report", r.status === 200, r.json);

  section("SMS / WhatsApp updates");
  check("Starter: an email customer gets email instead of WhatsApp", await customerChannel(basicOrg, "whatsapp", "a@test.local") === "email");
  check("Starter: a customer with no email gets nothing, rather than a failed send", await customerChannel(basicOrg, "sms", null) === "none");
  check("Starter: a customer who chose email is unaffected", await customerChannel(basicOrg, "email", "a@test.local") === "email");
  check("Growth: WhatsApp stays WhatsApp", await customerChannel(orgId, "whatsapp", "a@test.local") === "whatsapp");

  section("Membership invoices and GST");
  const { c: taxShop, orgId: taxOrg, branchId: taxBranch } = await signup("d");
  await sa.req("POST", `/platform-admin/organizations/${taxOrg}/subscription`, { planId: growth.id, endsOn: dayFromNow(30), reason: REASON });
  r = await taxShop.req("PATCH", "/organizations/current", { gstin: "27AABCM1234F1Z5" });
  check("the shop has a GSTIN", r.status === 200 && r.json.gstin === "27AABCM1234F1Z5", r.json);
  await taxShop.req("POST", "/cashier-shifts", { branchId: taxBranch, openingCash: 0 });
  const newCustomer = async (c: Client, name: string) => (await c.req("POST", "/customers", { name, phone: `+91 93${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` })).json.id;
  const taxPlan = (await taxShop.req("POST", "/membership-plans", { name: "GST Gold", price: 118000, taxBps: 1800, durationDays: 365, discountBps: 1000 })).json;
  r = await taxShop.req("POST", `/customers/${await newCustomer(taxShop, "Tax One")}/memberships`, { planId: taxPlan.id, branchId: taxBranch, method: "cash" });
  check("the GST is taken out of the price", r.status === 201 && r.json.pricePaid === 118000 && r.json.taxAmount === 18000 && r.json.taxBps === 1800, r.json);
  check("the invoice number fits GST's 16 characters", typeof r.json.invoiceNumber === "string" && r.json.invoiceNumber.length <= 16, r.json.invoiceNumber);
  const taxSale = r.json;
  r = await taxShop.req("POST", `/customers/${await newCustomer(taxShop, "Tax Two")}/memberships`, { planId: taxPlan.id, branchId: taxBranch, method: "cash" });
  check("invoice numbers run in an unbroken series", Number(r.json.invoiceNumber.slice(-6)) === Number(taxSale.invoiceNumber.slice(-6)) + 1, [taxSale.invoiceNumber, r.json.invoiceNumber]);
  r = await taxShop.req("GET", `/customer-memberships/${taxSale.id}/invoice`);
  check("the invoice has what the printout needs", r.status === 200 && r.json.customer.name === "Tax One" && r.json.payment.paymentMethod === "cash" && r.json.branch.name.length > 0, r.json);
  r = await other.req("GET", `/customer-memberships/${taxSale.id}/invoice`);
  check("another shop cannot read this invoice", r.status === 404, r.json);
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  r = await taxShop.req("GET", `/reports/run/gst-summary?from=${today}&to=${today}`);
  const gst18 = r.json.rows?.find((row: any) => String(row.rate).startsWith("18"));
  check("membership sales are in the GST summary", gst18?.tax === 36000 && gst18?.taxable === 200000 && gst18?.invoices === 2, r.json.rows);
  r = await other.req("POST", "/membership-plans", { name: "No GSTIN", price: 118000, taxBps: 1800, durationDays: 30, discountBps: 500 });
  const noGstPlan = r.json;
  r = await other.req("POST", `/customers/${await newCustomer(other, "No Gst Customer")}/memberships`, { planId: noGstPlan.id, branchId: otherBranch, method: "cash" });
  check("a shop with no GSTIN charges no GST, whatever the plan says", r.status === 201 && r.json.taxAmount === 0 && r.json.taxBps === 0 && r.json.pricePaid === 118000, r.json);

  section("PC license keys carry features and hardware");
  const signing = (await sa.req("GET", "/platform-admin/licenses/signing-key")).json;
  if (!signing.exists) results.push("  - skipped: no signing key on this database");
  else {
    const decode = (key: string) => JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    r = await sa.req("POST", "/platform-admin/licenses", { customerName: `Feature Flow ${runId}`, plan: starter.name, expiresOn: dayFromNow(30), installationIds: [randomUUID()] });
    check("a key is issued", r.status === 201, r.json);
    licenseIds.push(r.json.id);
    let payload = decode(r.json.key);
    check("a key for Starter has Starter's features", payload.features.labelDesigner === false && payload.features.deliveries === true, payload);
    check("the key carries the approved hardware", payload.hardware.printers[0] === "TSC TE244" && payload.hardware.scanners[0] === "Honeywell HH400", payload);
    const firstId = r.json.id;
    r = await sa.req("POST", `/platform-admin/licenses/${firstId}/renew`, { plan: growth.name, expiresOn: dayFromNow(400) });
    check("a key can be renewed onto a higher plan", r.status === 201, r.json);
    licenseIds.push(r.json.id);
    payload = decode(r.json.key);
    check("the renewed key has the new features, same PC and new end date", payload.features.labelDesigner === true && payload.installationIds.length === 1 && payload.expiresAt.startsWith(dayFromNow(400)), payload);
    r = await sa.req("POST", "/platform-admin/licenses", { customerName: `Feature Flow ${runId}`, plan: "One-off", expiresOn: dayFromNow(30), installationIds: [randomUUID()], features: { labelDesigner: true, laundry: false } });
    licenseIds.push(r.json.id);
    payload = decode(r.json.key);
    check("ticks on the form are what the key carries", payload.features.labelDesigner === true && payload.features.laundry === false, payload);

    const pcs = (n: number) => Array.from({ length: n }, () => randomUUID());
    r = await sa.req("POST", "/platform-admin/licenses", { customerName: `Feature Flow ${runId}`, plan: starter.name, expiresOn: dayFromNow(30), installationIds: pcs(starter.deviceLimit + 1) });
    check("more PCs than the plan includes is refused", r.status === 409 && r.json.error.code === "PC_LIMIT_EXCEEDED", r.json);
    r = await sa.req("POST", "/platform-admin/licenses", { customerName: `Feature Flow ${runId}`, plan: starter.name, expiresOn: dayFromNow(30), installationIds: pcs(starter.deviceLimit + 1), allowExtraPcs: true });
    check("super admin can knowingly allow more PCs", r.status === 201, r.json);
    licenseIds.push(r.json.id);
    check("the key carries the branch limit", decode(r.json.key).limits.branches === starter.branchLimit, decode(r.json.key));

    const { orgId: pcOrg } = await signup("e");
    const inForce = pcs(starter.deviceLimit);
    r = await sa.req("POST", "/platform-admin/licenses", { organizationId: pcOrg, customerName: `Feature Flow ${runId}`, plan: starter.name, expiresOn: dayFromNow(30), installationIds: inForce });
    check("a shop can use all its PCs", r.status === 201, r.json);
    licenseIds.push(r.json.id);
    const pcKey = r.json.id;
    r = await sa.req("POST", "/platform-admin/licenses", { organizationId: pcOrg, customerName: `Feature Flow ${runId}`, plan: starter.name, expiresOn: dayFromNow(30), installationIds: pcs(1) });
    check("a second key cannot take the shop over its PC limit", r.status === 409 && r.json.error.code === "PC_LIMIT_EXCEEDED", r.json);
    r = await sa.req("POST", `/platform-admin/licenses/${pcKey}/renew`, { expiresOn: dayFromNow(60) });
    check("renewing the same PCs does not count them twice", r.status === 201, r.json);
    licenseIds.push(r.json.id);
  }
} finally {
  await sa.req("PUT", "/platform-admin/hardware", hardwareBefore);
  if (licenseIds.length) await sqlClient`delete from desktop_licenses where id = any(${licenseIds})`;
  if (testPlanId) await sqlClient`update commercial_plans set published = false where id = ${testPlanId}`;
  await sqlClient`delete from sessions where user_id = ${saUser.id}`;
  await app.close();
  await sqlClient.end();
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
