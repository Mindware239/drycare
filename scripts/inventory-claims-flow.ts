/** Stock, suppliers, purchase orders and customer claims end to end. Run: pnpm inventory-test */
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
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const owner = new Client();
await owner.req("POST", "/organizations", { businessName: `Stock Shop ${runId}`, ownerName: "Stock Owner", email: `owner-inv-${runId}@test.local`, password: `Owner-${runId}-Password1`, acceptedTerms: true });
const s = (await owner.req("GET", "/auth/session")).json;
const branchId = s.branches[0].id;
await owner.req("POST", "/cashier-shifts", { branchId, openingCash: 1_000_000 });

results.push("Stock items");
let r = await owner.req("POST", "/inventory/items/starter", {});
check("starter list adds common items", r.status === 201 && r.json.added >= 10, r.json);
const starterCount = r.json.added;
r = await owner.req("POST", "/inventory/items/starter", {});
check("starter list never adds duplicates", r.json.added === 0, r.json);
r = await owner.req("POST", "/inventory/items", { name: "Liquid detergent", category: "Detergents", unit: "L" });
check("duplicate item name refused", r.status === 409, r.json);
r = await owner.req("POST", "/inventory/items", { name: "Lavender perfume", category: "Other", unit: "ml", reorderLevel: 200, lastUnitCost: 50, opening: { branchId, quantity: 1000 } });
check("item with opening stock gets an automatic code", r.status === 201 && /^ITM-\d{4}$/.test(r.json.itemCode), r.json);
const perfume = r.json;
let items = (await owner.req("GET", `/inventory/items?branchId=${branchId}`)).json;
const perc = items.find((i: any) => i.name.startsWith("Perchloroethylene"));
check("list shows stock on hand", items.length === starterCount + 1 && items.find((i: any) => i.id === perfume.id).onHandMilli === 1_000_000, items.length);
check("perc starts at zero and is flagged low (reorder 20 L)", perc.onHandMilli === 0 && perc.low === true, perc);

r = await owner.req("POST", "/inventory/movements", { branchId, itemId: perfume.id, kind: "use", quantity: 1200 });
check("cannot use more than is on the shelf", r.status === 422 && r.json.error.code === "INSUFFICIENT_STOCK", r.json);
r = await owner.req("POST", "/inventory/movements", { branchId, itemId: perfume.id, kind: "use", quantity: 150.5 });
check("use 150.5 ml (decimals exact)", r.status === 201 && r.json.onHandMilli === 849_500, r.json);
r = await owner.req("POST", "/inventory/movements", { branchId, itemId: perfume.id, kind: "wastage", quantity: 50 });
check("wastage needs a note", r.status === 400, r.json);
r = await owner.req("POST", "/inventory/movements", { branchId, itemId: perfume.id, kind: "wastage", quantity: 50, note: "Bottle cracked" });
check("wastage recorded", r.status === 201 && r.json.onHandMilli === 799_500, r.json);
r = await owner.req("POST", "/inventory/movements", { branchId, itemId: perfume.id, kind: "count", quantity: 790, note: "Spillage on shelf" });
check("stock check sets the shelf to the counted 790 ml", r.status === 201 && r.json.onHandMilli === 790_000 && r.json.movement.quantityMilli === -9_500, r.json);
const race = await Promise.all([1, 2].map(() => owner.req("POST", "/inventory/movements", { branchId, itemId: perfume.id, kind: "use", quantity: 500 })));
check("two people taking 500 ml of 790 ml at once: only one succeeds", race.filter((x) => x.status === 201).length === 1, race.map((x) => x.status));
r = await owner.req("GET", `/inventory/items/${perfume.id}/movements`);
check("movement history is complete", r.json.length === 5 && r.json.reduce((a: number, m: any) => a + m.quantityMilli, 0) === 290_000, r.json.length);
let blocked = false;
try { await sqlClient`update inventory_movements set quantity_milli = 0 where item_id = ${perfume.id}`; } catch { blocked = true; }
check("stock ledger cannot be edited in the database", blocked);

results.push("Suppliers and purchase orders");
r = await owner.req("POST", "/suppliers", { name: "Sharma Chemicals", phone: "9876500000", gstin: "27abcde1234f1z5" });
check("supplier added (GSTIN upper-cased)", r.status === 201 && r.json.gstin === "27ABCDE1234F1Z5", r.json);
const supplier = r.json;
check("bad GSTIN refused", (await owner.req("POST", "/suppliers", { name: "Bad Co", gstin: "123" })).status === 400);
const detergent = items.find((i: any) => i.name === "Liquid detergent");
r = await owner.req("POST", "/purchase-orders", { branchId, supplierId: supplier.id, place: false, lines: [{ itemId: perc.id, quantity: 40, unitCost: 25000, taxBps: 1800 }, { itemId: detergent.id, quantity: 20, unitCost: 12000, taxBps: 1800 }] });
check("draft PO: 40 L × ₹250 + 20 L × ₹120 + 18% GST = ₹14,632", r.status === 201 && r.json.status === "draft" && r.json.subtotal === 1_240_000 && r.json.total === 1_463_200 && /^PO\/\d{4}\/\d{4}$/.test(r.json.poNumber), r.json);
const po = r.json;
r = await owner.req("POST", `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, quantity: 1 }] });
check("cannot receive a draft", r.status === 409, r.json);
r = await owner.req("PUT", `/purchase-orders/${po.id}`, { lines: [{ itemId: perc.id, quantity: 40, unitCost: 24000, taxBps: 1800 }, { itemId: detergent.id, quantity: 20, unitCost: 12000, taxBps: 1800 }], place: true });
check("draft edited and placed", r.status === 200 && r.json.status === "ordered" && r.json.subtotal === 1_200_000, r.json);
items = (await owner.req("GET", `/inventory/items?branchId=${branchId}`)).json;
check("ordered quantity shows as on order", items.find((i: any) => i.id === perc.id).onOrderMilli === 40_000);
r = await owner.req("PUT", `/purchase-orders/${po.id}`, { lines: [{ itemId: perc.id, quantity: 1, unitCost: 1, taxBps: 0 }] });
check("items cannot change after the order is placed", r.status === 409, r.json);
const percLine = r.status ? (await owner.req("GET", `/purchase-orders/${po.id}`)).json.lines.find((l: any) => l.itemId === perc.id) : null;
const detLine = (await owner.req("GET", `/purchase-orders/${po.id}`)).json.lines.find((l: any) => l.itemId === detergent.id);
r = await owner.req("POST", `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: percLine.id, quantity: 45 }] });
check("cannot receive more than ordered", r.status === 422 && r.json.error.code === "OVER_RECEIPT", r.json);
r = await owner.req("POST", "/expenses", { branchId, category: "Rent", amount: 2_000_000, method: "cash", spentOn: today, paidFromDrawer: true });
check("cannot pay more cash from the drawer than it holds (₹20,000 from ₹10,000)", r.status === 422 && r.json.error.code === "DRAWER_SHORT", r.json);
r = await owner.req("POST", `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: percLine.id, quantity: 25 }], bill: { category: "Solvents & chemicals", method: "cash", paidFromDrawer: true, reference: "INV-77" } });
check("part delivery of 25 L → part received", r.status === 201 && r.json.status === "partial" && r.json.receipts.length === 1, r.json);
const exp = (await sqlClient`select amount, shift_id, category from expenses where vendor = 'Sharma Chemicals' and organization_id = ${s.organization.id}`)[0];
check("supplier bill filed under expenses: 25 × ₹240 + 18% = ₹7,080 from the drawer", Number(exp?.amount) === 708_000 && exp?.shift_id !== null && exp?.category === "Solvents & chemicals", exp);
items = (await owner.req("GET", `/inventory/items?branchId=${branchId}`)).json;
const percNow = items.find((i: any) => i.id === perc.id);
check("perc stock 25 L, 15 L still on order, price updated to ₹240", percNow.onHandMilli === 25_000 && percNow.onOrderMilli === 15_000 && percNow.lastUnitCost === 24000, percNow);
check("stock value = 25 × ₹240", percNow.stockValue === 600_000, percNow.stockValue);
r = await owner.req("POST", `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: percLine.id, quantity: 15 }, { lineId: detLine.id, quantity: 20, unitCost: 11500 }] });
check("rest received → order complete", r.status === 201 && r.json.status === "received", r.json.status);
r = await owner.req("POST", `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: detLine.id, quantity: 1 }] });
check("closed order accepts no more goods", r.status === 409);
const po2 = (await owner.req("POST", "/purchase-orders", { branchId, supplierId: supplier.id, lines: [{ itemId: detergent.id, quantity: 10, unitCost: 12000 }] })).json;
r = await owner.req("POST", `/purchase-orders/${po2.id}/cancel`, { reason: "Supplier out of stock" });
check("unreceived PO can be cancelled", r.json.status === "cancelled", r.json);
r = await owner.req("GET", `/inventory/usage?from=${today}&to=${today}&branchId=${branchId}`);
const percUsage = r.json.find((u: any) => u.id === perc.id);
check("usage report: perc 40 L purchased worth ₹9,600", percUsage?.purchased === 40_000 && percUsage?.purchasedValue === 960_000, percUsage);
r = await owner.req("GET", "/suppliers");
check("supplier shows purchase total", Number(r.json[0].purchasedTotal) > 0 && r.json[0].orderCount === 1, r.json[0]);

results.push("Claims");
const [gts, svcs] = await Promise.all([owner.req("GET", "/garment-types"), owner.req("GET", "/services")]);
const suit = gts.json.find((g: any) => g.name === "Suit (2 pc)"), DC = svcs.json.find((x: any) => x.serviceCode === "DC");
const cust = (await owner.req("POST", "/customers", { name: "Unhappy Customer", phone: `+91 97${String(Date.now()).slice(-8)}` })).json;
const order = (await owner.req("POST", "/orders", { customerId: cust.id, branchId, promisedAt: new Date(Date.now() + 2 * 86400_000).toISOString(), items: [{ garmentTypeId: suit.id, serviceId: DC.id, quantity: 2 }] })).json;
const [g1, g2] = order.garments;
r = await owner.req("POST", "/claims", { garmentId: g1.id, kind: "damaged", description: "Burn mark on the sleeve after pressing", customerAsk: 300000 });
check("claim from a garment finds the order and customer", r.status === 201 && r.json.customerId === cust.id && r.json.orderId === order.id && /^CLM-\d{5}$/.test(r.json.claimNumber) && r.json.status === "open", r.json);
const claim1 = r.json;
r = await owner.req("POST", "/claims", { garmentId: g1.id, kind: "stain", description: "Second complaint same garment" });
check("only one open claim per garment", r.status === 409 && r.json.error.code === "CLAIM_EXISTS", r.json);
const other = (await owner.req("POST", "/customers", { name: "Someone Else", phone: `+91 96${String(Date.now()).slice(-8)}` })).json;
r = await owner.req("POST", "/claims", { orderId: order.id, customerId: other.id, kind: "late", description: "Mismatched customer" });
check("order must belong to the chosen customer", r.status === 400, r.json);
await owner.req("POST", "/staff", { name: "Counter", email: `rec-inv-${runId}@test.local`, password: `Staff-${runId}-Password1`, roleKey: "reception", branchIds: [branchId] });
const rec = new Client();
await rec.req("POST", "/auth/login", { email: `rec-inv-${runId}@test.local`, password: `Staff-${runId}-Password1` });
r = await rec.req("POST", "/claims", { garmentId: g2.id, kind: "lost", description: "Customer says second jacket was not returned" });
check("counter staff can log a claim", r.status === 201, r.json);
const claim2 = r.json;
check("counter staff cannot see stock", (await rec.req("GET", "/inventory/items")).status === 403);
r = await rec.req("POST", `/claims/${claim1.id}/notes`, { note: "Checked press log — iron set too hot", startInvestigation: true });
check("note moves the claim to investigating", r.status === 201 && r.json.status === "investigating" && r.json.events.length === 2, r.json.status);
r = await rec.req("POST", `/claims/${claim1.id}/decision`, { outcome: "approve", resolution: "wallet_credit", amount: 250000, note: "Our fault, compensate" });
check("counter staff cannot decide", r.status === 403, r.json);
r = await owner.req("POST", `/claims/${claim1.id}/decision`, { outcome: "approve", resolution: "wallet_credit", amount: 0, note: "Our fault" });
check("money compensation needs an amount", r.status === 400, r.json);
r = await owner.req("POST", `/claims/${claim1.id}/decision`, { outcome: "approve", resolution: "wallet_credit", amount: 250000, note: "Burn caused by our press, agreed ₹2,500" });
check("manager approves ₹2,500 wallet credit", r.status === 200 && r.json.status === "approved" && r.json.approvedAmount === 250000, r.json);
r = await owner.req("POST", `/claims/${claim1.id}/decision`, { outcome: "reject", resolution: "none", note: "Changed my mind" });
check("cannot decide twice", r.status === 409);
r = await rec.req("POST", `/claims/${claim1.id}/settle`, {});
check("counter staff cannot pay out", r.status === 403);
r = await owner.req("POST", `/claims/${claim1.id}/settle`, {});
check("settled: claim closed", r.status === 200 && r.json.status === "settled" && r.json.walletEntryId, r.json);
r = await owner.req("GET", `/customers/${cust.id}/wallet`);
check("₹2,500 is in the customer's wallet as claim credit", r.json.balance === 250000 && r.json.entries[0].kind === "claim", r.json);
r = await owner.req("POST", `/claims/${claim1.id}/settle`, {});
check("cannot settle twice", r.status === 409);

r = await owner.req("POST", `/claims/${claim2.id}/decision`, { outcome: "approve", resolution: "cash", amount: 150000, note: "Jacket lost at the facility" });
r = await owner.req("POST", `/claims/${claim2.id}/settle`, { method: "upi" });
check("UPI compensation needs a reference", r.status === 400, r.json);
r = await owner.req("POST", `/claims/${claim2.id}/settle`, { method: "cash", paidFromDrawer: true });
check("cash compensation settled", r.status === 200 && r.json.status === "settled" && r.json.expenseId, r.json);
const expRow = (await sqlClient`select amount, category, shift_id from expenses where id = ${r.json.expenseId}`)[0];
check("compensation recorded as a ‘Claims & compensation’ expense from the drawer", Number(expRow.amount) === 150000 && expRow.category === "Claims & compensation" && expRow.shift_id, expRow);

const claim3 = (await owner.req("POST", "/claims", { customerId: other.id, branchId, kind: "other", description: "Rude behaviour at the counter" })).json;
check("claim without an order", claim3.status === "open" && claim3.orderId === null, claim3);
r = await owner.req("POST", `/claims/${claim3.id}/decision`, { outcome: "reject", resolution: "none", note: "Reviewed CCTV, apologised to customer" });
check("claim rejected", r.json.status === "rejected", r.json);
r = await owner.req("POST", `/claims/${claim3.id}/notes`, { note: "late note" });
check("closed claims take no more notes", r.status === 409);
r = await owner.req("GET", "/claims/summary");
check("summary: compensation this month ₹4,000", r.json.paidThisMonth === 400000 && r.json.last90Days === 3, r.json);
r = await owner.req("GET", `/claims?status=all&search=${encodeURIComponent(g1.tagCode)}`);
check("search by garment tag", r.json.length === 1 && r.json[0].id === claim1.id, r.json.length);
blocked = false;
try { await sqlClient`delete from claim_events where claim_id = ${claim1.id}`; } catch { blocked = true; }
check("claim timeline cannot be deleted", blocked);

results.push("Isolation");
const intruder = new Client();
await intruder.req("POST", "/organizations", { businessName: `Other Shop ${runId}`, ownerName: "Other", email: `owner-inv2-${runId}@test.local`, password: `Owner-${runId}-Password1`, acceptedTerms: true });
check("another business cannot open the claim", (await intruder.req("GET", `/claims/${claim1.id}`)).status === 404);
check("another business cannot open the PO", (await intruder.req("GET", `/purchase-orders/${po.id}`)).status === 404);
r = await intruder.req("POST", "/inventory/movements", { branchId, itemId: perfume.id, kind: "use", quantity: 1 });
check("another business cannot move this stock", r.status === 403 || r.status === 404, r.status);
check("another business sees none of these items", (await intruder.req("GET", "/inventory/items")).json.every((i: any) => i.id !== perfume.id));

console.log(results.join("\n"));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await app.close();
await sqlClient.end();
process.exit(failures ? 1 : 0);
