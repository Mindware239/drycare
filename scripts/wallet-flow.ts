/** Customer wallet end to end: top-up, pay from wallet, no double counting, races, refunds back, adjustments. Run: pnpm wallet-test */
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
await owner.req("POST", "/organizations", { businessName: `Wallet Shop ${runId}`, ownerName: "Wallet Owner", email: `owner-wal-${runId}@test.local`, password: `Owner-${runId}-Password1`, acceptedTerms: true });
const s = (await owner.req("GET", "/auth/session")).json;
const branchId = s.branches[0].id;
await owner.req("POST", "/cashier-shifts", { branchId, openingCash: 0 });
const [gts, svcs] = await Promise.all([owner.req("GET", "/garment-types"), owner.req("GET", "/services")]);
const suit = gts.json.find((g: any) => g.name === "Suit (2 pc)"), DC = svcs.json.find((x: any) => x.serviceCode === "DC");
const cust = (await owner.req("POST", "/customers", { name: "Regular Customer", phone: `+91 98${String(Date.now()).slice(-8)}` })).json;
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

let r = await owner.req("GET", `/customers/${cust.id}/wallet`);
check("new customer starts with ₹0", r.status === 200 && r.json.balance === 0, r.json);
r = await owner.req("POST", `/customers/${cust.id}/wallet/topups`, { branchId, amount: 100000, method: "upi" });
check("UPI top-up needs a reference", r.status === 400);
r = await owner.req("POST", `/customers/${cust.id}/wallet/topups`, { branchId, amount: 100000, method: "cash", note: "Advance" });
check("₹1,000 cash top-up", r.status === 201 && r.json.balance === 100000, r.json);

// Order of ₹413 (suit DC ₹350 + 18% GST) paid entirely from the wallet.
const order = (await owner.req("POST", "/orders", { customerId: cust.id, branchId, promisedAt: new Date(Date.now() + 2 * 86400_000).toISOString(), items: [{ garmentTypeId: suit.id, serviceId: DC.id, quantity: 1 }], payments: [{ amount: 41300, method: "store_credit" }] })).json;
check("order paid from the wallet", Boolean(order?.id), order);
r = await owner.req("GET", `/customers/${cust.id}/wallet`);
check("wallet now ₹587", r.json.balance === 58700, r.json.balance);
const dash = (await owner.req("GET", `/dashboard?from=${today}&to=${today}`)).json;
check("collections count the ₹1,000 top-up once, not the wallet spend", dash.collections.net === 100000, dash.collections);
const daybook = (await owner.req("GET", "/reports/run/daybook")).json;
check("day book shows ₹1,000 cash in, no extra money", daybook.totals.cash === 100000 && daybook.totals.net === 100000, daybook.totals);

// Overspend and race
const order2 = (await owner.req("POST", "/orders", { customerId: cust.id, branchId, promisedAt: new Date(Date.now() + 2 * 86400_000).toISOString(), items: [{ garmentTypeId: suit.id, serviceId: DC.id, quantity: 2 }] })).json;
r = await owner.req("POST", `/orders/${order2.id}/payments`, { payments: [{ amount: 60000, method: "store_credit" }] });
check("cannot spend more than the balance", r.status === 422 && r.json.error.code === "WALLET_INSUFFICIENT", r.json);
const race = await Promise.all([1, 2].map(() => owner.req("POST", `/orders/${order2.id}/payments`, { payments: [{ amount: 40000, method: "store_credit" }] })));
check("two counters spending ₹400 each at once: only one succeeds", race.filter((x) => x.status === 201).length === 1, race.map((x) => x.status));
r = await owner.req("GET", `/customers/${cust.id}/wallet`);
check("balance never goes negative (₹187 left)", r.json.balance === 18700, r.json.balance);

// Refund of a wallet payment goes back into the wallet
const walletPayment = (await sqlClient`select id from payments where customer_id = ${cust.id} and payment_method = 'store_credit' order by created_at limit 1`)[0];
r = await owner.req("POST", `/payments/${walletPayment.id}/refunds`, { amount: 10000, reason: "Button missing on return" });
check("refund of a wallet payment", r.status === 201, r.json);
r = await owner.req("GET", `/customers/${cust.id}/wallet`);
check("refund credited back to the wallet (₹287)", r.json.balance === 28700 && r.json.entries[0].kind === "refund", r.json.entries?.[0]);
const dash2 = (await owner.req("GET", `/dashboard?from=${today}&to=${today}`)).json;
check("wallet refund is not counted as cash leaving the shop", dash2.collections.refunded === 0, dash2.collections);

// Adjustments
r = await owner.req("POST", `/customers/${cust.id}/wallet/adjustments`, { amount: -50000, reason: "Correction" });
check("adjustment below zero is refused", r.status === 422);
r = await owner.req("POST", `/customers/${cust.id}/wallet/adjustments`, { amount: 5000, reason: "Goodwill for late delivery" });
check("manager adjustment with a reason", r.status === 201 && r.json.balance === 33700, r.json);
await owner.req("POST", "/staff", { name: "Counter", email: `rec-wal-${runId}@test.local`, password: `Staff-${runId}-Password1`, roleKey: "reception", branchIds: [branchId] });
const rec = new Client();
await rec.req("POST", "/auth/login", { email: `rec-wal-${runId}@test.local`, password: `Staff-${runId}-Password1` });
check("counter staff can top up", (await rec.req("POST", `/customers/${cust.id}/wallet/topups`, { branchId, amount: 5000, method: "cash" })).status === 201);
check("counter staff cannot adjust balances", (await rec.req("POST", `/customers/${cust.id}/wallet/adjustments`, { amount: 5000, reason: "Trying to add credit" })).status === 403);
r = await owner.req("GET", `/customers/${cust.id}/wallet`);
const sum = r.json.entries.reduce((a: number, e: any) => a + e.amount, 0);
check("statement adds up to the balance", sum === r.json.balance && r.json.balance === 38700, { sum, balance: r.json.balance });

console.log(results.join("\n"));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await app.close();
await sqlClient.end();
process.exit(failures ? 1 : 0);
