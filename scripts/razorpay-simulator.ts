/** A tiny stand-in for the Razorpay API used by the automated billing test (orders, payments, key check). */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

export async function startRazorpaySimulator(keyId: string, keySecret: string) {
  const orders = new Map<string, { id: string; amount: number; currency: string; status: string; notes: Record<string, string> }>();
  const payments = new Map<string, { id: string; order_id: string; amount: number; currency: string; status: string; method: string }>();
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== auth) return send(401, { error: { description: "Authentication failed" } });
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://sim");
      if (req.method === "GET" && url.pathname === "/orders") return send(200, { items: [] });
      if (req.method === "POST" && url.pathname === "/orders") {
        const body = JSON.parse(raw);
        const order = { id: `order_${randomBytes(7).toString("hex")}`, amount: body.amount, currency: body.currency, status: "created", notes: body.notes ?? {} };
        orders.set(order.id, order);
        return send(200, order);
      }
      const o = url.pathname.match(/^\/orders\/([^/]+)$/);
      if (req.method === "GET" && o) return orders.has(o[1]) ? send(200, orders.get(o[1])) : send(404, { error: { description: "order not found" } });
      const p = url.pathname.match(/^\/payments\/([^/]+)$/);
      if (req.method === "GET" && p) return payments.has(p[1]) ? send(200, payments.get(p[1])) : send(404, { error: { description: "payment not found" } });
      send(404, { error: { description: "not simulated" } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    /** Simulates the customer completing checkout for an order. */
    pay(orderId: string, opts: { status?: string; amount?: number } = {}) {
      const order = orders.get(orderId)!;
      const payment = { id: `pay_${randomBytes(7).toString("hex")}`, order_id: orderId, amount: opts.amount ?? order.amount, currency: order.currency, status: opts.status ?? "captured", method: "upi" };
      payments.set(payment.id, payment);
      order.status = "paid";
      return payment;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
