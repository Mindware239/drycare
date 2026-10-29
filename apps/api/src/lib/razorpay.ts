/** Minimal Razorpay client: orders, checkout signature verification, webhook verification and a credentials check. */
import { createHmac, timingSafeEqual } from "node:crypto";

type Creds = { keyId: string; keySecret: string };
/** Overridable only from the server environment, so automated tests can use a simulated Razorpay. */
const api = () => process.env.RAZORPAY_API_BASE ?? "https://api.razorpay.com/v1";

async function call<T>(creds: Creds, method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: T & { error?: { description?: string } } }> {
  const res = await fetch(`${api()}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as T & { error?: { description?: string } } };
}

export async function testRazorpay(creds: Creds) {
  try {
    const r = await call(creds, "GET", "/orders?count=1");
    if (r.ok) return { ok: true, message: "Connected: Razorpay accepted these keys." };
    if (r.status === 401) return { ok: false, message: "Razorpay rejected the Key ID or Key Secret." };
    return { ok: false, message: `Razorpay answered ${r.status}: ${r.json.error?.description ?? "unexpected response"}` };
  } catch (cause) {
    return { ok: false, message: `Could not reach Razorpay: ${(cause as Error).message}` };
  }
}

export async function createRazorpayOrder(creds: Creds, input: { amountPaise: number; currency: string; receipt: string; notes: Record<string, string> }) {
  const r = await call<{ id: string; amount: number; currency: string; status: string }>(creds, "POST", "/orders", {
    amount: input.amountPaise,
    currency: input.currency,
    receipt: input.receipt.slice(0, 40),
    notes: input.notes,
  });
  if (!r.ok) throw new Error(r.json.error?.description ?? `Razorpay order failed (${r.status})`);
  return r.json;
}

export async function fetchRazorpayPayment(creds: Creds, paymentId: string) {
  const r = await call<{ id: string; order_id: string; amount: number; currency: string; status: string; method: string }>(creds, "GET", `/payments/${encodeURIComponent(paymentId)}`);
  if (!r.ok) throw new Error(r.json.error?.description ?? `Razorpay payment lookup failed (${r.status})`);
  return r.json;
}

export async function fetchRazorpayOrder(creds: Creds, orderId: string) {
  const r = await call<{ id: string; amount: number; currency: string; status: string; notes?: { organizationId?: string; planId?: string } }>(creds, "GET", `/orders/${encodeURIComponent(orderId)}`);
  if (!r.ok) throw new Error(r.json.error?.description ?? `Razorpay order lookup failed (${r.status})`);
  return r.json;
}

function safeEqualHex(expected: string, given: string) {
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Checkout success handler: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string) {
  return safeEqualHex(createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex"), signature);
}

/** Webhook: X-Razorpay-Signature = HMAC_SHA256(raw request body, webhook secret). */
export function verifyWebhookSignature(rawBody: string, signature: string, webhookSecret: string) {
  return safeEqualHex(createHmac("sha256", webhookSecret).update(rawBody).digest("hex"), signature);
}
