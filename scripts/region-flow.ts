/**
 * Country rules on real orders, against a real database: currency, tax wording, and whether shelf prices already
 * include tax. Run: pnpm region-test
 * Uses fresh @test.local tenants each run, so it is safe to repeat.
 */
import { randomUUID } from "node:crypto";
import { buildServer } from "../apps/api/src/app";
import { db, sqlClient } from "../apps/api/src/db/client";
import { applySubscriptionPayment } from "../apps/api/src/lib/subscriptionPayments";
import { formatMoney } from "../packages/shared/src/money";

const app = await buildServer();
let failures = 0;
const results: string[] = [];
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) results.push(`  ✓ ${label}`);
  else {
    failures++;
    results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 500)}` : ""}`);
  }
}

class Client {
  cookie = "";
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({ method: method as "GET", url: `/api/v1${url}`, payload: body as object, headers: { cookie: this.cookie, "x-drycare-csrf": "1", ...headers } });
    const set = res.headers["set-cookie"];
    if (set) this.cookie = (Array.isArray(set) ? set[0] : set).split(";")[0];
    let json: any;
    try {
      json = res.json();
    } catch {}
    return { status: res.statusCode, json };
  }
}

interface Case {
  country: string;
  currency: string;
  taxName: string;
  included: boolean;
  /** Shelf price and tax rate of one garment. */
  price: number;
  taxBps: number;
  taxable: number;
  tax: number;
  total: number;
}

const CASES: Case[] = [
  { country: "AE", currency: "AED", taxName: "VAT", included: true, price: 10500, taxBps: 500, taxable: 10000, tax: 500, total: 10500 },
  { country: "DE", currency: "EUR", taxName: "VAT", included: true, price: 11900, taxBps: 1900, taxable: 10000, tax: 1900, total: 11900 },
  { country: "IN", currency: "INR", taxName: "GST", included: false, price: 10000, taxBps: 1800, taxable: 10000, tax: 1800, total: 11800 },
];

const runId = randomUUID().slice(0, 6);
for (const c of CASES) {
  results.push(`\n${c.country}: ${c.included ? "price includes tax" : "tax added to price"}`);
  const owner = new Client();
  let r = await owner.req("POST", "/organizations", {
    businessName: `Region ${c.country} ${runId}`,
    ownerName: "Region Owner",
    email: `owner-region-${c.country.toLowerCase()}-${runId}@test.local`,
    password: `Region-${runId}-Password1`,
    country: c.country,
    acceptedTerms: true,
  });
  check("shop signs up", r.status === 201, r.json);
  const session = (await owner.req("GET", "/auth/session")).json;
  const region = session.organization.region;
  check("shop takes the country's currency, tax name and pricing rule", region.currency === c.currency && region.taxName === c.taxName && region.pricesIncludeTax === c.included, region);
  const branchId: string = session.branches[0].id;

  const serviceId: string = (await owner.req("POST", "/services", { name: "Region clean", category: "Dry Clean", serviceCode: "RGN", unitType: "per_piece", workflowStages: ["received", "ready"] })).json.id;
  const garmentTypeId: string = (await owner.req("POST", "/garment-types", { name: `Region shirt ${runId}`, category: "Men" })).json.id;
  const list = (await owner.req("GET", "/price-lists")).json[0];
  r = await owner.req("POST", `/price-lists/${list.id}/prices`, { garmentTypeId, serviceId, unitPrice: c.price, taxBps: c.taxBps });
  check("price saved", r.status === 201, r.json);
  await owner.req("POST", "/cashier-shifts", { branchId, openingCash: 0 });
  const customerId: string = (await owner.req("POST", "/customers", { name: "Region Customer", phone: `+${region.dialCode ?? "91"} 98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` })).json?.id;
  check("customer saved", Boolean(customerId));

  const place = (quantity: number, payments: unknown[], extra: object = {}) =>
    owner.req("POST", "/orders", { customerId, branchId, promisedAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), items: [{ garmentTypeId, serviceId, quantity }], payments, ...extra }, { "idempotency-key": randomUUID() });

  r = await place(1, [{ amount: c.total, method: "cash" }]);
  check("order placed and paid in full", r.status === 201, r.json);
  const invoice = r.json?.invoice ?? {};
  check(`customer pays ${c.total / 100}`, invoice.grandTotal === c.total, invoice);
  check(`bill shows ${c.taxable / 100} before tax`, invoice.subtotal === c.taxable, invoice);
  check(`bill shows ${c.tax / 100} tax`, invoice.taxTotal === c.tax, invoice);
  const saved = (await owner.req("GET", `/orders/${r.json.id}`)).json?.invoice;
  check("nothing left to pay", saved?.balance === 0 && saved?.paid === c.total, saved);

  // ---- what the shop pays Mindware for its plan
  const billing = (await owner.req("GET", "/commercial/billing")).json;
  const plan = billing.plans?.[0];
  check("plans are on offer", Boolean(plan), billing);
  if (plan) {
    const stored = await db.query.commercialPlans.findFirst({ where: (p, { eq }) => eq(p.id, plan.id) });
    check(`plan is priced in ${c.currency}`, plan.currency === c.currency, plan);
    if (c.country === "IN") {
      check("India: price is unchanged and GST is added", plan.pricePaise === stored!.pricePaise && plan.gstRateBps > 0 && plan.payablePaise > plan.pricePaise, plan);
      check("India: pays in rupees, with Indian payment details allowed", billing.pay.india === true, billing.pay);
    } else {
      check("abroad: price differs from the rupee figure and no Indian GST is added", plan.pricePaise !== stored!.pricePaise && plan.gstRateBps === 0 && plan.payablePaise === plan.pricePaise, plan);
      check("abroad: price is a clean figure", plan.pricePaise % 100 === 0 || plan.pricePaise % 10 === 0, plan.pricePaise);
      check("abroad: UPI and rupee bank details are not offered", billing.pay.india === false && billing.pay.upi === null && billing.pay.bank === null, billing.pay);
      const qr = await owner.req("GET", `/commercial/billing/upi-qr?planId=${plan.id}`);
      check("abroad: no UPI QR", qr.status === 404, qr.status);
    }
    results.push(`    (${plan.name}: ${formatMoney(plan.pricePaise, plan.currency)}, pays ${formatMoney(plan.payablePaise, plan.currency)})`);
    const orgId: string = session.organization.id;
    const paid = await db.transaction((tx) => applySubscriptionPayment(tx, { organizationId: orgId, plan: stored!, provider: "region_test", reference: `RGN${runId}${c.country}`, amountPaise: plan.payablePaise, currency: plan.currency, payload: {} }));
    check("payment is recorded in that currency", paid.payment.currency === c.currency && paid.payment.amountPaise === plan.payablePaise, paid.payment);
    check("invoice is in that currency for the full amount", paid.invoice?.currency === c.currency && paid.invoice?.totalPaise === plan.payablePaise, paid.invoice);
    const tax = (paid.invoice?.cgstPaise ?? 0) + (paid.invoice?.sgstPaise ?? 0) + (paid.invoice?.igstPaise ?? 0);
    check(c.country === "IN" ? "invoice carries GST" : "invoice carries no Indian GST", c.country === "IN" ? tax > 0 : tax === 0 && paid.invoice?.gstRateBps === 0, paid.invoice);
  }

  r = await place(3, [{ amount: c.total * 3, method: "cash" }]);
  check("three garments cost exactly three times as much", r.status === 201 && r.json.invoice.grandTotal === c.total * 3 && r.json.invoice.taxTotal + r.json.invoice.subtotal === c.total * 3, r.json?.invoice ?? r.json);
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
await app.close();
await sqlClient.end();
process.exit(failures ? 1 : 0);
