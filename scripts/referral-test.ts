/**
 * The referral offer and quarterly billing, against the running server (API_URL, default http://127.0.0.1:4000): what each plan
 * costs with the code, reporting and verifying a discounted payment, the GST invoice, the end date. Run: pnpm referral-test.
 * Uses a throwaway shop, and puts the owner's offer back at the end. Makes no real payment.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db, schema, sqlClient } from "../apps/api/src/db/client";

const CLOUD = process.env.API_URL ?? "http://127.0.0.1:4000";
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, extra?: unknown) => {
  if (ok) results.push(`  ✓ ${label}`);
  else { failures++; results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 400)}` : ""}`); }
};
const section = (t: string) => results.push(`\n${t}`);
const run = randomUUID().slice(0, 6);
const org = await db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.slug, "drycare-platform") });
const role = org && (await db.query.roles.findFirst({ where: (r, { and, eq }) => and(eq(r.organizationId, org.id), eq(r.key, "platform_admin")) }));
if (!org || !role) throw new Error("Run pnpm admin:create once before this test.");
const [user] = await db.insert(schema.users).values({ email: `sa-referral-${run}@test.local`, name: "Referral Test Admin", passwordHash: "x", isPlatformAdmin: true }).returning();
await db.insert(schema.memberships).values({ organizationId: org.id, userId: user.id, roleId: role.id });
const token = randomBytes(32).toString("base64url");
await db.insert(schema.sessions).values({ id: createHash("sha256").update(token).digest("hex"), userId: user.id, organizationId: org.id, expiresAt: new Date(Date.now() + 3_600_000) });
const saCookie = `dc_session=${token}`;
let shopCookie = "";
async function call(cookie: string, method: string, url: string, body?: unknown) {
  const res = await fetch(`${CLOUD}/api/v1${url}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), "x-drycare-csrf": "1", "idempotency-key": randomUUID(), cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set && cookie === shopCookie) shopCookie = set.split(";")[0];
  const raw = await res.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch {}
  return { status: res.status, set, text: raw, json };
}
const sa = (m: string, u: string, b?: unknown) => call(saCookie, m, u, b);
const shop = (m: string, u: string, b?: unknown) => call(shopCookie, m, u, b);
const [savedOffer] = await sqlClient`select value_json from platform_settings where key = ${"referral_offer"}`;
const planCode = `smoke-quarter-${run}`;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const dayFrom = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + n * 864e5));
const CODE = { code: "AIDCexchange", percent: 5, endsOn: "2026-12-31", active: true };
const utr = (t: string) => `${t}${run}${Date.now()}`.toUpperCase();

try {
  await sa("PUT", "/platform-admin/referral-offer", CODE);
  section("The website banner");
  let r = await call("", "GET", "/commercial/referral-offer");
  check("anyone can read the live offer", r.status === 200 && r.json.code === "AIDCexchange" && r.json.percent === 5 && r.json.endsOn === "2026-12-31", r.json);

  const email = `referral-${run}@test.local`, password = "CheckPass@2026x";
  const made = await fetch(`${CLOUD}/api/v1/organizations`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ ownerName: "Referral Owner", email, password, businessName: `Referral Shop ${run}`, country: "IN", acceptedTerms: true }) });
  const login = await fetch(`${CLOUD}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ email, password }) });
  shopCookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  const session = await shop("GET", "/auth/session");
  const orgId: string = session.json.organization.id;
  check("a new shop signs up", made.status === 201 && Boolean(orgId), made.status);

  const created = await sa("POST", "/platform-admin/plans", { name: `Quarter ${run}`, code: planCode, interval: "quarter" });
  check("a quarterly plan can be created", created.status < 300 && created.json.interval === "quarter", created.json);
  const quarterId: string = created.json.id;
  const up = await sa("PATCH", `/platform-admin/plans/${quarterId}`, { pricePaise: 300000, published: true, gstInclusive: false, entitlements: created.json.entitlements, reason: "Automated referral test" });
  check("and priced and offered", up.status === 200, up.json);

  const billing = (await shop("GET", "/commercial/billing")).json;
  const monthly = billing.plans.find((p: any) => p.code === "starter");
  const yearly = billing.plans.find((p: any) => p.code === "growth-yearly");
  const quarterly = billing.plans.find((p: any) => p.code === planCode);
  check("the shop sees the quarterly plan", Boolean(quarterly) && quarterly.interval === "quarter", billing.plans.map((p: any) => p.code));

  section("What the code does");
  const test = (code: string, planId: string) => shop("POST", "/commercial/referral/check", { code, planId });
  r = await test("AIDCexchange", yearly.id);
  const yearPrice = yearly.pricePaise * 0.95;
  const yearDue = Math.round(yearPrice) + Math.round((Math.round(yearPrice) * yearly.gstRateBps) / 10000);
  check(`5% off a yearly plan, before GST (${yearly.payablePaise} → ${yearDue})`, r.status === 200 && r.json.payablePaise === yearDue && r.json.discountPaise === yearly.payablePaise - yearDue && r.json.percent === 5, r.json);
  r = await test("aidcEXCHANGE ", quarterly.id);
  const quarterDue = Math.round(285000 * (1 + quarterly.gstRateBps / 10000));
  check(`5% off a quarterly plan, any capitals (${quarterly.payablePaise} → ${quarterDue})`, r.status === 200 && r.json.payablePaise === quarterDue, r.json);
  r = await test("AIDCexchange", monthly.id);
  check("not on a monthly plan", r.status === 422 && /quarterly and yearly/.test(r.json.error.message), r.json);
  r = await test("NOTACODE", yearly.id);
  check("a wrong code is refused", r.status === 422 && /not valid/.test(r.json.error.message), r.json);

  section("Paying with it");
  const qr = await shop("GET", `/commercial/billing/upi-qr?planId=${yearly.id}&referral=AIDCexchange`);
  check("the UPI QR is made", qr.status === 200 && qr.text.includes("<svg"), qr.status);
  const ref = utr("UTR");
  r = await shop("POST", "/commercial/payment-claims", { planId: yearly.id, method: "bank_transfer", reference: ref, amountPaise: 100, referral: "AIDCexchange" });
  check("a report is accepted", r.status === 201, r.json);
  const claimId: string = r.json.id;
  const [claim] = await sqlClient`select amount_paise, status, provider_payload_json as payload from commercial_payments where id = ${claimId}`;
  check("the server sets the amount, ignoring what the browser sent", Number(claim.amount_paise) === yearDue && claim.status === "pending", claim);
  const sub1 = (await shop("GET", "/commercial/billing")).json.subscription;
  check("nothing activates on an unchecked report", !sub1 || sub1.status !== "active", sub1);
  r = await shop("POST", "/commercial/payment-claims", { planId: monthly.id, method: "upi", reference: utr("UTM"), amountPaise: monthly.payablePaise, referral: "AIDCexchange" });
  check("a report cannot use the code on a monthly plan", r.status === 422, r.json);

  section("You verify it");
  const verify = (amountPaise: number) => sa("POST", `/platform-admin/organizations/${orgId}/verify-manual-payment`, { planId: yearly.id, method: "bank_transfer", reference: ref, amountPaise, reason: "Automated referral test", claimId });
  r = await verify(yearDue - 100);
  check("less than the discounted amount is refused", r.status === 409 && r.json.error.code === "PAYMENT_AMOUNT_TOO_LOW", r.json);
  r = await verify(yearDue);
  check("the discounted amount is accepted", r.status < 300, r.json);
  const after = (await shop("GET", "/commercial/billing")).json;
  check("the plan is active for a year", after.subscription?.status === "active" && Math.abs(new Date(after.subscription.endsAt).getTime() - Date.now() - 365 * 864e5) < 864e5, after.subscription);
  const inv = after.invoices[0];
  check("the invoice is for the discounted amount", Number(inv?.totalPaise) === yearDue, inv);
  const usage = (await sa("GET", "/platform-admin/referral-offer")).json;
  check("you can see the code was used", usage.used >= 1, usage);
  r = await sa("POST", `/platform-admin/organizations/${orgId}/verify-manual-payment`, { planId: yearly.id, method: "bank_transfer", reference: utr("FULL"), amountPaise: yearDue, reason: "Automated referral test" });
  check("with no code report behind it, the full price is still required", r.status === 409 && r.json.error.code === "PAYMENT_AMOUNT_TOO_LOW", r.json);

  section("Quarterly lasts 90 days");
  const email2 = `referral2-${run}@test.local`;
  await fetch(`${CLOUD}/api/v1/organizations`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ ownerName: "Referral Two", email: email2, password, businessName: `Referral Two ${run}`, country: "IN", acceptedTerms: true }) });
  const login2 = await fetch(`${CLOUD}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ email: email2, password }) });
  shopCookie = (login2.headers.get("set-cookie") ?? "").split(";")[0];
  const org2: string = (await shop("GET", "/auth/session")).json.organization.id;
  r = await sa("POST", `/platform-admin/organizations/${org2}/verify-manual-payment`, { planId: quarterId, method: "upi", reference: utr("QTR"), amountPaise: quarterly.payablePaise, reason: "Automated referral test" });
  check("a quarterly payment is accepted", r.status < 300, r.json);
  const q = (await shop("GET", "/commercial/billing")).json.subscription;
  check("and runs 90 days", Math.abs(new Date(q.endsAt).getTime() - Date.now() - 90 * 864e5) < 864e5, q?.endsAt);

  section("Ending");
  await sa("PUT", "/platform-admin/referral-offer", { ...CODE, endsOn: today });
  check("it still works on its last day", (await test("AIDCexchange", quarterId)).status === 200);
  await sa("PUT", "/platform-admin/referral-offer", { ...CODE, endsOn: dayFrom(-1) });
  r = await test("AIDCexchange", quarterId);
  check("the day after, the code has ended", r.status === 422 && /ended/.test(r.json.error.message), r.json);
  check("and the banner is gone", (await call("", "GET", "/commercial/referral-offer")).json === null);
  await sa("PUT", "/platform-admin/referral-offer", { ...CODE, active: false });
  check("turning it off ends it at once", (await test("AIDCexchange", quarterId)).status === 422 && (await call("", "GET", "/commercial/referral-offer")).json === null);

  section("Outside India");
  await sa("PUT", "/platform-admin/referral-offer", CODE);
  const made3 = `referral3-${run}@test.local`;
  await fetch(`${CLOUD}/api/v1/organizations`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ ownerName: "Referral Three", email: made3, password, businessName: `Referral Three ${run}`, country: "DE", acceptedTerms: true }) });
  const login3 = await fetch(`${CLOUD}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ email: made3, password }) });
  shopCookie = (login3.headers.get("set-cookie") ?? "").split(";")[0];
  r = await test("AIDCexchange", quarterId);
  check("the code is for India", r.status === 422 && /India/.test(r.json.error.message), r.json);

  section("Access");
  check("only the owner can read the offer's settings", [401, 403].includes((await call("", "GET", "/platform-admin/referral-offer")).status));
  check("or change them", [401, 403].includes((await call("", "PUT", "/platform-admin/referral-offer", CODE)).status));
  check("a shop cannot either", [401, 403].includes((await shop("PUT", "/platform-admin/referral-offer", CODE)).status));
} finally {
  await sqlClient`update commercial_plans set published = false where code = ${planCode}`;
  if (savedOffer) await sqlClient`update platform_settings set value_json = ${sqlClient.json(savedOffer.value_json)} where key = ${"referral_offer"}`;
  else await sqlClient`delete from platform_settings where key = ${"referral_offer"}`;
}
console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
await sqlClient.end();
process.exit(failures ? 1 : 0);
