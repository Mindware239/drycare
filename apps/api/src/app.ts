import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { env } from "./env";
import { loadAuth } from "./lib/context";
import { AppError } from "./lib/errors";
import { sqlClient } from "./db/client";
import { authRoutes } from "./modules/auth";
import { organizationRoutes } from "./modules/organization";
import { customerRoutes } from "./modules/customers";
import { catalogueRoutes } from "./modules/catalogue";
import { orderRoutes } from "./modules/orders";
import { paymentRoutes } from "./modules/payments";
import { productionRoutes } from "./modules/production";
import { reportRoutes } from "./modules/reports";
import { systemRoutes } from "./modules/system";
import { deliveryRoutes } from "./modules/deliveries";
import { marketingRoutes } from "./modules/marketing";
import { commercialRoutes } from "./modules/commercial";
import { platformAdminRoutes } from "./modules/platformAdmin";
import { platformConsoleRoutes } from "./modules/platformConsole";
import { platformBillingRoutes } from "./modules/platformBilling";
import { platformLicenseRoutes } from "./modules/platformLicenses";
import { reportsCenterRoutes } from "./modules/reportsCenter";
import { bookingRoutes } from "./modules/booking";
import { walletRoutes } from "./modules/wallet";
import { assertWritable } from "./lib/subscriptionAccess";
import { logisticsRoutes } from "./modules/logistics";
import { laundryRoutes } from "./modules/laundry";
import { inventoryRoutes } from "./modules/inventory";
import { claimRoutes } from "./modules/claims";
import { syncRoutes } from "./modules/sync";
import { syncCloudRoutes } from "./modules/syncCloud";
import { assertDesktopLicense, isLicenseActivationRequest } from "./lib/license";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "warn",
      // FR-AUD-004: never log credentials or session tokens.
      redact: ["req.headers.cookie", "req.headers.authorization", "body.password"],
    },
    genReqId: (req) => (req.headers["x-request-id"] as string) || randomUUID(),
    // Fastify accepts a boolean, hop count or address list; the cast only keeps its overloads apart.
    trustProxy: env.TRUST_PROXY as unknown as boolean,
    bodyLimit: 1_000_000,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute" });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
  });

  /**
   * CSRF defence for cookie sessions: SameSite=Lax cookie + every state-changing request must carry
   * a custom header, which cross-site forms cannot set and cross-origin scripts cannot send
   * without a CORS preflight (which this API never approves).
   */
  app.addHook("onRequest", async (req) => {
    const publicMarketingUnsubscribe = req.url.split("?")[0] === "/api/v1/marketing/unsubscribe";
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.url.startsWith("/api/") && !req.url.startsWith("/api/v1/webhooks/") && !publicMarketingUnsubscribe) {
      if (req.headers["x-drycare-csrf"] !== "1") throw new AppError(403, "CSRF_REJECTED", "Missing CSRF header");
    }
  });

  app.addHook("preHandler", async (req) => {
    if (!isLicenseActivationRequest(req.method, req.url)) assertDesktopLicense();
    req.auth = await loadAuth(req);
    // Lapsed trial / expired plan: the shop stays signed in and can read and pay, but cannot change data.
    await assertWritable(req);
  });

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: "The request contains invalid fields.", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })), requestId },
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    }
    const pgCode = (err as { code?: string }).code;
    if (pgCode === "23505") {
      return reply.code(409).send({ error: { code: "DUPLICATE", message: "This record already exists or the request was already processed.", details: [], requestId } });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests. Please wait and try again.", details: [], requestId } });
    }
    req.log.error({ err, requestId }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Quote the request ID to support.", details: [], requestId } });
  });

  app.get("/health", async () => {
    await sqlClient`select 1`;
    return { status: "ok" };
  });

  /** For uptime monitors and deploy checks: database reachable and the schema version this server is running on. */
  app.get("/health/ready", async (_req, reply) => {
    try {
      const [cfg] = await sqlClient`select schema_version from sync_config where id = 1`;
      return { status: "ok", schemaVersion: cfg?.schema_version ?? "unknown", mode: env.DRYCARE_MODE, uptimeSeconds: Math.round(process.uptime()) };
    } catch {
      reply.code(503);
      return { status: "unavailable" };
    }
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(organizationRoutes);
      await api.register(customerRoutes);
      await api.register(catalogueRoutes);
      await api.register(orderRoutes);
      await api.register(paymentRoutes);
      await api.register(productionRoutes);
      await api.register(reportRoutes);
      await api.register(systemRoutes);
      await api.register(deliveryRoutes);
      await api.register(marketingRoutes);
      await api.register(commercialRoutes);
      await api.register(platformAdminRoutes);
      await api.register(platformConsoleRoutes);
      await api.register(platformBillingRoutes);
      await api.register(platformLicenseRoutes);
      await api.register(reportsCenterRoutes);
      await api.register(bookingRoutes);
      await api.register(walletRoutes);
      await api.register(logisticsRoutes);
      await api.register(laundryRoutes);
      await api.register(inventoryRoutes);
      await api.register(claimRoutes);
      await api.register(syncRoutes);
      await api.register(syncCloudRoutes);
    },
    { prefix: "/api/v1" },
  );

  if (env.WEB_DIST) await serveWebApp(app, env.WEB_DIST);

  return app;
}

/**
 * Serves the statically exported web app (desktop edition): "/orders/view" → orders/view.html,
 * "/" → index.html. Unknown API paths still return the JSON 404.
 */
async function serveWebApp(app: FastifyInstance, root: string) {
  const base = path.resolve(root);
  await app.register(fastifyStatic, { root: base, serve: false });
  const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
  app.setNotFoundHandler((req, reply) => {
    const urlPath = decodeURIComponent((req.url.split("?")[0] ?? "/").replace(/\/+$/, "")) || "/";
    if (req.method !== "GET" || urlPath.startsWith("/api/")) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found", details: [], requestId: req.id } });
    }
    const candidates = urlPath === "/" ? ["index.html"] : [urlPath.slice(1), `${urlPath.slice(1)}.html`, `${urlPath.slice(1)}/index.html`];
    for (const rel of candidates) {
      const abs = path.resolve(base, rel);
      if (!abs.startsWith(base)) break; // path traversal guard
      if (isFile(abs)) {
        if (rel.startsWith("_next/static/")) reply.header("cache-control", "public, max-age=31536000, immutable");
        return reply.sendFile(rel);
      }
    }
    return reply.code(404).sendFile("404.html");
  });
}
