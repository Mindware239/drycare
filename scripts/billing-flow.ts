/**
 * Software-owner billing end to end: seller profile, payment settings, shop "I have paid" report, verification,
 * GST invoices (CGST/SGST vs IGST), numbering, voiding and Razorpay signature checks. Run: pnpm billing-test
 * Platform settings are shared, so the original values are restored at the end and test invoices use a TEST/ prefix.
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { buildServer } from "../apps/api/src/app";
import { db, schema, sqlClient } from "../apps/api/src/db/client";
import { splitGst, planGross, stateCode } from "../apps/api/src/lib/commercialInvoice";
import { verifyCheckoutSignature, verifyWebhookSignature } from "../apps/api/src/lib/razorpay";
import { openSecret, sealSecret } from "../apps/api/src/lib/secretBox";
import { startRazorpaySimulator } from "./razorpay-simulator";

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
const saved = await db.select().from(schema.platformSettings);

// A throwaway super admin with a direct session (sign-in codes are emailed, so the test cannot read them).
const platformOrg = await db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.slug, "drycare-platform") });
const platformRole = platformOrg && await db.query.roles.findFirst({ where: (r, { and, eq: e }) => and(e(r.organizationId, platformOrg.id), e(r.key, "platform_admin")) });
if (!platformOrg || !platformRole) throw new Error("Run pnpm admin:create once before this test.");
const [saUser] = await db.insert(schema.users).values({ email: `sa-billing-${runId}@test.local`, name: "Billing Test Admin", passwordHash: "x", isPlatformAdmin: true }).returning();
await db.insert(schema.memberships).values({ organizationId: platformOrg.id, userId: saUser.id, roleId: platformRole.id });
const token = randomBytes(32).toString("base64url");
await db.insert(schema.sessions).values({ id: createHash("sha256").update(token).digest("hex"), userId: saUser.id, organizationId: platformOrg.id, expiresAt: new Date(Date.now() + 3600_000) });
const sa = new Client();
sa.cookie = `dc_session=${token}`;

const [plan] = await db.insert(schema.commercialPlans).values({ code: `billtest-${runId}`, name: `Billing Test ${runId}`, pricePaise: 99900, interval: "month", gstInclusive: false, published: true }).returning();

try {
  section("Pure GST maths");
  check("₹1,178.82 incl. 18% → ₹999.00 + ₹179.82", JSON.stringify(splitGst(117882, 1800, false)) === JSON.stringify({ subtotal: 99900, cgst: 0, sgst: 0, igst: 17982 }), splitGst(117882, 1800, false));
  check("intra-state splits tax into equal CGST + SGST", (() => { const s = splitGst(117882, 1800, true); return s.cgst + s.sgst === 17982 && Math.abs(s.cgst - s.sgst) <= 1; })());
  check("plan excl. GST: ₹999 → payable ₹1,178.82", planGross({ pricePaise: 99900, gstInclusive: false }, 1800) === 117882);
  check("plan incl. GST stays ₹999", planGross({ pricePaise: 99900, gstInclusive: true }, 1800) === 99900);
  check("state code from GSTIN and from state name", stateCode("27ABCDE1234F1Z5") === "27" && stateCode(null, "Maharashtra") === "27" && stateCode(null, "Karnataka") === "29");
  check("secrets round-trip through encryption", openSecret(sealSecret("rzp-secret-123")) === "rzp-secret-123" && sealSecret("a") !== sealSecret("a"));

  section("Seller billing profile (super admin)");
  let r = await sa.req("PUT", "/platform-admin/settings/billing", { gstin: "BAD" });
  check("invalid GSTIN rejected", r.status === 400, r.json);
  const seller = {
    legalName: "Mindware Infotech Pvt Ltd", tradeName: "DryCare by Mindware", gstin: "27AABCM1234F1Z5", pan: "AABCM1234F",
    addressLine1: "Office 12, Business Park", city: "Pune", state: "Maharashtra", pincode: "411001", email: "billing@test.local", phone: "+91 98200 00000",
    bank: { accountName: "Mindware Infotech Pvt Ltd", accountNumber: "1234567890", ifsc: "HDFC0001234", bankName: "HDFC Bank", branch: "Pune" },
    upiId: "mindware@okhdfcbank", upiPayeeName: "Mindware Infotech",
    invoice: { prefix: `TEST/${runId}/`, nextNumber: 1, sacCode: "997331", gstRateBps: 1800, terms: "Payment received with thanks.", footer: "", signatory: "Accounts" },
  };
  r = await sa.req("PUT", "/platform-admin/settings/billing", seller);
  check("seller profile saved with no gaps", r.status === 200 && r.json.gaps.length === 0, r.json);

  section("Payment settings (super admin)");
  r = await sa.req("PUT", "/platform-admin/settings/payments", { methods: { upi: true, bankTransfer: true, cash: false, instructions: "Share the UTR after paying." }, razorpay: { enabled: true, mode: "test", keyId: "rzp_test_ABC123" } });
  check("online payments cannot be switched on without a key secret", r.status === 409 && r.json.error.code === "RAZORPAY_KEYS_REQUIRED", r.json);
  r = await sa.req("PUT", "/platform-admin/settings/payments", { methods: { upi: true, bankTransfer: true, cash: false, instructions: "" }, razorpay: { enabled: false, mode: "live", keyId: "rzp_test_ABC123" } });
  check("test key with live mode is rejected", r.status === 409 && r.json.error.code === "RAZORPAY_MODE_MISMATCH", r.json);
  r = await sa.req("PUT", "/platform-admin/settings/payments", { methods: { upi: true, bankTransfer: true, cash: false, instructions: "Share the UTR after paying." }, razorpay: { enabled: true, mode: "test", keyId: "rzp_test_ABC123", keySecret: "supersecretvalue1234", webhookSecret: "whsec-abcd" } });
  check("keys saved; response shows only a hint", r.status === 200 && r.json.razorpay.keySecretHint === "••••1234" && !JSON.stringify(r.json).includes("supersecretvalue"), r.json);
  const stored = await db.query.platformSettings.findFirst({ where: (t, { eq }) => eq(t.key, "payments") });
  check("secret is encrypted in the database", !JSON.stringify(stored?.value).includes("supersecretvalue") && JSON.stringify(stored?.value).includes("v1."));
  r = await sa.req("PUT", "/platform-admin/settings/payments", { methods: { upi: true, bankTransfer: true, cash: false, instructions: "Share the UTR after paying." }, razorpay: { enabled: true, mode: "test", keyId: "rzp_test_ABC123" } });
  check("saving without re-entering keeps the secret", r.status === 200 && r.json.razorpay.keySecretHint === "••••1234", r.json);
  const audits = await sqlClient`select after_json from audit_logs where action = 'platform.payment_settings_updated' order by created_at desc limit 3`;
  check("audit log never contains the secret", !JSON.stringify(audits).includes("supersecretvalue"));

  section("Shop: plan & billing, report a payment");
  const shop = new Client();
  await shop.req("POST", "/organizations", { businessName: `Billing Shop ${runId}`, ownerName: "Shop Owner", email: `owner-bill-${runId}@test.local`, password: `Shop-${runId}-Password1`, acceptedTerms: true, state: "Maharashtra", city: "Pune" });
  const shopSession = (await shop.req("GET", "/auth/session")).json;
  const orgId: string = shopSession.organization.id;
  r = await shop.req("GET", "/commercial/billing");
  const billingPlan = r.json.plans?.find((p: any) => p.id === plan.id);
  check("shop sees the plan with payable amount incl. GST", r.status === 200 && billingPlan?.payablePaise === 117882, billingPlan);
  check("shop sees UPI and bank details to pay", r.json.pay?.upi?.vpa === "mindware@okhdfcbank" && r.json.pay?.bank?.ifsc === "HDFC0001234" && r.json.pay.online === true, r.json.pay);
  check("shop never receives gateway secrets", !JSON.stringify(r.json).includes("supersecret") && !JSON.stringify(r.json).includes("whsec"));
  const utr = `UTR${runId.toUpperCase()}${Date.now() % 100000}`;
  r = await shop.req("POST", "/commercial/payment-claims", { planId: plan.id, method: "upi", reference: utr, amountPaise: 117882, paidOn: "2026-10-28" });
  check("shop reports a UPI payment", r.status === 201, r.json);
  const claimId = r.json.id;
  r = await shop.req("POST", "/commercial/payment-claims", { planId: plan.id, method: "upi", reference: utr.toLowerCase(), amountPaise: 117882 });
  check("same transaction ID cannot be reported twice", r.status === 409, r.json);
  r = await sa.req("GET", "/platform-admin/payment-claims");
  check("test shop reports are kept out of the real queue", r.status === 200 && !r.json.some((c: any) => c.id === claimId), r.json?.length);

  section("Super admin verifies → subscription active + GST invoice");
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/verify-manual-payment`, { planId: plan.id, method: "upi", reference: utr, amountPaise: 99900, reason: "Checked in bank statement", claimId });
  check("amount below price incl. GST is rejected", r.status === 409 && r.json.error.code === "PAYMENT_AMOUNT_TOO_LOW", r.json);
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/verify-manual-payment`, { planId: plan.id, method: "upi", reference: utr, amountPaise: 117882, reason: "Checked in bank statement", claimId });
  check("payment verified", r.status === 201 && r.json.subscription.status === "active", r.json);
  const inv = r.json.invoice;
  check(`invoice issued with number TEST/${runId}/00001`, inv?.number === `TEST/${runId}/00001`, inv);
  check("same state (Maharashtra) → CGST + SGST, no IGST", inv?.cgstPaise + inv?.sgstPaise === 17982 && inv?.igstPaise === 0 && inv?.subtotalPaise === 99900, inv);
  check("seller and buyer details are frozen on the invoice", inv?.seller?.gstin === "27AABCM1234F1Z5" && inv?.buyer?.name?.includes("Billing Shop"), inv?.buyer);
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/verify-manual-payment`, { planId: plan.id, method: "upi", reference: utr, amountPaise: 117882, reason: "Checked in bank statement", claimId });
  check("the same claim / reference cannot be verified twice", r.status === 409, r.json);
  r = await shop.req("GET", "/commercial/billing");
  check("shop sees its active plan, the invoice and the verified report", r.json.subscription?.status === "active" && r.json.invoices.length === 1 && r.json.claims[0]?.status === "verified", { sub: r.json.subscription?.status, inv: r.json.invoices.length, claims: r.json.claims });
  r = await shop.req("GET", `/commercial/invoices/${inv.id}`);
  check("shop can open its invoice", r.status === 200 && r.json.number === inv.number && r.json.payment?.reference === utr, r.json);

  section("Renewal, IGST, numbering, voiding");
  // Move the buyer out of state: next invoice must use IGST.
  await sqlClient`update organizations set gstin = '29AAACB1234C1Z5' where id = ${orgId}`;
  r = await sa.req("POST", `/platform-admin/organizations/${orgId}/verify-manual-payment`, { planId: plan.id, method: "bank_transfer", reference: `NEFT${runId}${Date.now() % 100000}`, amountPaise: 117882, reason: "Renewal paid by NEFT" });
  const inv2 = r.json.invoice;
  check("renewal extends the subscription by another month", r.status === 201 && new Date(r.json.subscription.endsAt).getTime() - Date.now() > 55 * 86_400_000, r.json.subscription);
  check("next number is gapless: 00002", inv2?.number === `TEST/${runId}/00002`, inv2?.number);
  check("other state (Karnataka GSTIN) → IGST only", inv2?.igstPaise === 17982 && inv2?.cgstPaise === 0, inv2);
  r = await sa.req("PUT", "/platform-admin/settings/billing", { ...seller, invoice: { ...seller.invoice, nextNumber: 2 } });
  check("cannot reset numbering onto an existing invoice number", r.status === 409 && r.json.error.code === "INVOICE_NUMBER_USED", r.json);
  r = await sa.req("POST", `/platform-admin/invoices/${inv2.id}/void`, { reason: "short" });
  check("void needs a reason", r.status === 400);
  r = await sa.req("POST", `/platform-admin/invoices/${inv2.id}/void`, { reason: "Raised in error during testing" });
  check("invoice voided", r.status === 200 && r.json.status === "void", r.json);
  r = await sa.req("GET", `/platform-admin/invoices?search=${encodeURIComponent(`TEST/${runId}`)}`);
  check("test invoices are kept out of the real invoice list and totals", r.status === 200 && r.json.invoices.length === 0, r.json.invoices?.length);

  section("Shop rejection path");
  const utr2 = `UTRX${runId}${Date.now() % 100000}`;
  const claim2 = (await shop.req("POST", "/commercial/payment-claims", { planId: plan.id, method: "bank_transfer", reference: utr2, amountPaise: 117882 })).json.id;
  r = await sa.req("POST", `/platform-admin/payment-claims/${claim2}/reject`, { reason: "No such credit in the bank statement" });
  check("super admin can reject a report with a reason", r.status === 200, r.json);
  r = await shop.req("GET", "/commercial/billing");
  check("shop sees why it was rejected", r.json.claims.some((c: any) => c.status === "rejected" && c.rejectedReason?.includes("bank statement")), r.json.claims);

  section("Razorpay checkout safety");
  check("valid checkout signature accepted", verifyCheckoutSignature("order_1", "pay_1", createHmac("sha256", "s3cret").update("order_1|pay_1").digest("hex"), "s3cret"));
  check("tampered signature rejected", !verifyCheckoutSignature("order_1", "pay_2", createHmac("sha256", "s3cret").update("order_1|pay_1").digest("hex"), "s3cret"));
  check("webhook signature verified on raw body", verifyWebhookSignature('{"a":1}', createHmac("sha256", "wh").update('{"a":1}').digest("hex"), "wh") && !verifyWebhookSignature('{"a":2}', createHmac("sha256", "wh").update('{"a":1}').digest("hex"), "wh"));
  r = await shop.req("POST", "/commercial/checkout/razorpay/verify", { orderId: "order_fake123", paymentId: "pay_fake123", signature: "0".repeat(64) });
  check("forged checkout callback is refused", r.status === 400 && r.json.error.code === "PAYMENT_SIGNATURE_INVALID", r.json);
  r = await shop.req("GET", "/platform-admin/settings/payments");
  check("shops cannot read super admin payment settings", r.status === 401 || r.status === 403, r.status);

  section("Trial length and read-only after expiry");
  const lapsed = new Client();
  await lapsed.req("POST", "/organizations", { businessName: `Lapsed Shop ${runId}`, ownerName: "Lapsed Owner", email: `owner-lapsed-${runId}@test.local`, password: `Shop-${runId}-Password3`, acceptedTerms: true, state: "Maharashtra" });
  let ts = (await lapsed.req("GET", "/auth/trial-status")).json;
  check("new signups get a 7-day free trial", ts.daysRemaining === 7 && ts.access?.writable === true && ts.access.reason === "trial", ts);
  const lapsedOrg = (await lapsed.req("GET", "/auth/session")).json.organization.id;
  await sqlClient`update organizations set trial_ends_at = now() - interval '1 hour' where id = ${lapsedOrg}`;
  ts = (await lapsed.req("GET", "/auth/trial-status")).json;
  check("after the trial ends the shop is read-only", ts.access?.writable === false && ts.access.reason === "trial_ended", ts.access);
  r = await lapsed.req("POST", "/customers", { name: "Blocked Customer", phone: "+91 90000 11111" });
  check("changes are refused with a clear message", r.status === 402 && r.json.error.code === "SUBSCRIPTION_REQUIRED" && r.json.error.message.includes("Plan & billing"), r.json);
  r = await lapsed.req("GET", "/customers");
  check("data can still be read", r.status === 200);
  r = await lapsed.req("GET", "/commercial/billing");
  check("Plan & billing still opens", r.status === 200 && r.json.plans.some((p: any) => p.id === plan.id));
  const lapsedUtr = `UTRL${runId}${Date.now() % 100000}`;
  r = await lapsed.req("POST", "/commercial/payment-claims", { planId: plan.id, method: "upi", reference: lapsedUtr, amountPaise: 117882 });
  check("a lapsed shop can still report a payment", r.status === 201, r.json);
  r = await sa.req("POST", `/platform-admin/organizations/${lapsedOrg}/verify-manual-payment`, { planId: plan.id, method: "upi", reference: lapsedUtr, amountPaise: 117882, reason: "Lapsed shop paid, checked statement", claimId: r.json.id });
  r = await lapsed.req("POST", "/customers", { name: "Allowed Customer", phone: "+91 90000 22222" });
  check("after payment the shop can work again", r.status === 201, r.json);
  await sqlClient`update commercial_subscriptions set ends_at = now() - interval '1 day' where organization_id = ${lapsedOrg}`;
  ts = (await lapsed.req("GET", "/auth/trial-status")).json;
  check("plan ended yesterday: still writable during the 3-day grace", ts.access?.writable === true && ts.access.reason === "grace", ts.access);
  await sqlClient`update commercial_subscriptions set ends_at = now() - interval '4 days' where organization_id = ${lapsedOrg}`;
  r = await lapsed.req("POST", "/customers", { name: "After Grace", phone: "+91 90000 33333" });
  check("after the grace period the shop is read-only again", r.status === 402, r.json);

  section("Razorpay end to end (simulated Razorpay API)");
  const rzKey = "rzp_test_SIM123", rzSecret = `sim-secret-${runId}`, whSecret = `sim-webhook-${runId}`;
  const sim = await startRazorpaySimulator(rzKey, rzSecret);
  process.env.RAZORPAY_API_BASE = sim.base;
  try {
    r = await sa.req("PUT", "/platform-admin/settings/payments", { methods: { upi: true, bankTransfer: true, cash: false, instructions: "" }, razorpay: { enabled: true, mode: "test", keyId: rzKey, keySecret: rzSecret, webhookSecret: whSecret } });
    r = await sa.req("POST", "/platform-admin/settings/payments/razorpay/test", {});
    check("connection test passes with valid keys", r.status === 200 && r.json.ok === true, r.json);
    // A fresh shop pays online.
    const shop2 = new Client();
    await shop2.req("POST", "/organizations", { businessName: `Online Shop ${runId}`, ownerName: "Online Owner", email: `owner-online-${runId}@test.local`, password: `Shop-${runId}-Password2`, acceptedTerms: true, state: "Karnataka" });
    r = await shop2.req("POST", "/commercial/checkout/razorpay", { planId: plan.id });
    check("checkout creates a Razorpay order for the amount incl. GST", r.status === 200 && r.json.amountPaise === 117882 && r.json.keyId === rzKey && r.json.orderId?.startsWith("order_"), r.json);
    check("checkout never sends the key secret to the browser", !JSON.stringify(r.json).includes(rzSecret));
    const orderId = r.json.orderId;
    const paid = sim.pay(orderId);
    const sig = createHmac("sha256", rzSecret).update(`${orderId}|${paid.id}`).digest("hex");
    r = await shop.req("POST", "/commercial/checkout/razorpay/verify", { orderId, paymentId: paid.id, signature: sig });
    check("another shop cannot claim this payment", r.status === 400 && r.json.error.code === "PAYMENT_ORDER_MISMATCH", r.json);
    r = await shop2.req("POST", "/commercial/checkout/razorpay/verify", { orderId, paymentId: paid.id, signature: sig });
    check("signed checkout activates the plan and issues the invoice", r.status === 200 && r.json.invoiceId && !r.json.alreadyRecorded, r.json);
    const onlineInv = (await shop2.req("GET", `/commercial/invoices/${r.json.invoiceId}`)).json;
    check("online invoice: IGST (Karnataka shop, Maharashtra seller), paid via Razorpay", onlineInv.igstPaise === 17982 && onlineInv.payment?.provider === "razorpay", onlineInv);
    // The webhook for the same payment arrives afterwards: must not double-record.
    const event = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: paid.id, order_id: orderId } } } });
    const hook = (body: string, signature: string) => app.inject({ method: "POST", url: "/api/v1/webhooks/razorpay", payload: body, headers: { "content-type": "application/json", "x-razorpay-signature": signature } });
    let w = await hook(event, createHmac("sha256", whSecret).update(event).digest("hex"));
    check("webhook for an already-recorded payment is accepted without duplicating", w.statusCode === 200 && w.json().recorded === false, w.json());
    w = await hook(event, createHmac("sha256", "wrong").update(event).digest("hex"));
    check("webhook with a bad signature is refused", w.statusCode === 401);
    const count = await sqlClient`select count(*)::int as n from commercial_payments where provider = 'razorpay' and provider_reference = ${paid.id}`;
    check("exactly one payment and one invoice recorded", count[0].n === 1);
    // Webhook-only path: shop closed the browser before the callback.
    r = await shop2.req("POST", "/commercial/checkout/razorpay", { planId: plan.id });
    const paid2 = sim.pay(r.json.orderId);
    const event2 = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: paid2.id, order_id: r.json.orderId } } } });
    w = await hook(event2, createHmac("sha256", whSecret).update(event2).digest("hex"));
    check("webhook alone records the payment (browser closed) and renews", w.statusCode === 200 && w.json().recorded === true, w.json());
    const b2 = (await shop2.req("GET", "/commercial/billing")).json;
    check("shop now has two invoices and ~2 months paid", b2.invoices.length === 2 && new Date(b2.subscription.endsAt).getTime() - Date.now() > 55 * 86_400_000, { inv: b2.invoices.length, ends: b2.subscription?.endsAt });
    // A failed / uncaptured payment never activates anything.
    r = await shop2.req("POST", "/commercial/checkout/razorpay", { planId: plan.id });
    const failed = sim.pay(r.json.orderId, { status: "failed" });
    r = await shop2.req("POST", "/commercial/checkout/razorpay/verify", { orderId: r.json.orderId, paymentId: failed.id, signature: createHmac("sha256", rzSecret).update(`${r.json.orderId}|${failed.id}`).digest("hex") });
    check("a failed payment is not recorded", r.status === 400 && r.json.error.code === "PAYMENT_NOT_CAPTURED", r.json);
    r = await sa.req("PUT", "/platform-admin/settings/payments", { methods: { upi: true, bankTransfer: true, cash: false, instructions: "" }, razorpay: { enabled: false, mode: "test", keyId: rzKey } });
    r = await shop2.req("POST", "/commercial/checkout/razorpay", { planId: plan.id });
    check("checkout is unavailable when online payments are switched off", r.status === 503 && r.json.error.code === "ONLINE_PAYMENT_OFF", r.json);
  } finally {
    delete process.env.RAZORPAY_API_BASE;
    await sim.close();
  }
} finally {
  // Restore the real platform settings exactly as they were, and retire the test plan and admin.
  await db.delete(schema.platformSettings);
  if (saved.length) await db.insert(schema.platformSettings).values(saved);
  await sqlClient`update commercial_plans set published = false where id = ${plan.id}`;
  await sqlClient`update sessions set revoked_at = now() where user_id = ${saUser.id}`;
  await sqlClient`update users set status = 'disabled', is_platform_admin = false where id = ${saUser.id}`;
}
const after = await db.select().from(schema.platformSettings);
check("real platform settings restored unchanged", JSON.stringify(after.map((r) => [r.key, r.value]).sort()) === JSON.stringify(saved.map((r) => [r.key, r.value]).sort()));

console.log(results.join("\n"));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await app.close();
await sqlClient.end();
process.exit(failures ? 1 : 0);
