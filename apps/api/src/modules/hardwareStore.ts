/**
 * The hardware store on the public website: products, packages and the delivery charge, kept in platform settings and
 * edited in Super admin. Pictures are files on this server, because they are too large to keep with the settings.
 */
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_HARDWARE_STORE, STORE_CATEGORIES, packagePrice, type HardwareStore } from "@drycare/shared";
import { db, schema } from "../db/client";
import { env } from "../env";
import { audit } from "../lib/audit";
import { requirePlatformAdmin } from "../lib/context";
import { AppError, notFound, unprocessable } from "../lib/errors";
import { hardwarePolicy } from "../lib/entitlements";
import { write } from "../lib/platformSettings";

const KEY = "hardware_store";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const imageDir = () => path.resolve(env.STORE_IMAGE_DIR ?? path.join(process.cwd(), ".local", "store-images"));
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

async function readStore(): Promise<HardwareStore> {
  const row = await db.query.platformSettings.findFirst({ where: eq(schema.platformSettings.key, KEY) });
  return (row?.value as unknown as HardwareStore | undefined)?.products ? (row!.value as unknown as HardwareStore) : DEFAULT_HARDWARE_STORE;
}

const slug = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,60}$/);
const text = (max: number) => z.string().trim().max(max);
const categories = STORE_CATEGORIES.map((c) => c.key) as [string, ...string[]];
const storeSchema = z.object({
  deliveryChargePaise: z.number().int().min(0).max(100_000_000),
  products: z.array(z.object({
    key: slug, name: text(80).min(2), category: z.enum(categories), kind: z.enum(["equipment", "consumable"]), unit: text(20).min(1), description: text(300), specs: z.array(text(120).min(1)).max(12), compatibility: text(300),
    pricePaise: z.number().int().min(0).max(1_000_000_000).nullable(),
    imageUrl: z.string().regex(/^\/api\/v1\/commercial\/hardware-store\/images\/[a-z0-9-]+\.(png|jpg|webp)$/).nullable(),
    published: z.boolean(),
  })).min(1).max(100),
  packages: z.array(z.object({
    key: slug, name: text(60).min(2), audience: text(120), includesSoftware: z.boolean(), published: z.boolean(),
    items: z.array(z.object({ product: slug, qty: z.number().int().min(1).max(1000) })).min(1).max(40),
  })).max(12),
});

/** What a magic number says a file is. The name and the browser's word for it are not trusted, and SVG is refused because it can carry scripts. */
function imageType(b: Buffer): string | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

export async function hardwareStoreRoutes(app: FastifyInstance) {
  /** Public. A package's total appears only once every item in it has a price. */
  app.get("/commercial/hardware-store", async () => {
    const [store, policy] = await Promise.all([readStore(), hardwarePolicy()]);
    const name = (key: string) => store.products.find((p) => p.key === key);
    return {
      categories: STORE_CATEGORIES,
      deliveryChargePaise: store.deliveryChargePaise,
      products: store.products.filter((p) => p.published),
      packages: store.packages.filter((p) => p.published).map((p) => ({
        key: p.key, name: p.name, audience: p.audience, includesSoftware: p.includesSoftware,
        items: p.items.filter((l) => name(l.product)).map((l) => ({ product: l.product, name: name(l.product)!.name, unit: name(l.product)!.unit, kind: name(l.product)!.kind, qty: l.qty })),
        hardwarePaise: packagePrice(p, store.products),
      })),
      compatible: { printers: policy.printers, scanners: policy.scanners },
    };
  });

  app.get("/commercial/hardware-store/images/:file", async (req, reply) => {
    const { file } = z.object({ file: z.string().regex(/^[a-z0-9-]+\.(png|jpg|webp)$/) }).parse(req.params);
    const full = path.join(imageDir(), file);
    if (!existsSync(full)) throw notFound("Picture");
    reply.header("content-type", IMAGE_TYPES[file.split(".").pop()!]).header("x-content-type-options", "nosniff").header("cache-control", "public, max-age=31536000, immutable");
    return reply.send(createReadStream(full));
  });

  app.get("/platform-admin/hardware-store", async (req) => {
    requirePlatformAdmin(req);
    return readStore();
  });

  app.put("/platform-admin/hardware-store", async (req) => {
    const auth = requirePlatformAdmin(req);
    const body = storeSchema.parse(req.body);
    const keys = new Set(body.products.map((p) => p.key));
    if (keys.size !== body.products.length) throw unprocessable("Two products have the same code.", "DUPLICATE_PRODUCT");
    for (const p of body.packages) {
      const lost = p.items.find((l) => !keys.has(l.product));
      if (lost) throw unprocessable(`${p.name} includes a product that no longer exists.`, "PACKAGE_PRODUCT_MISSING");
      if (new Set(p.items.map((l) => l.product)).size !== p.items.length) throw unprocessable(`${p.name} lists a product twice.`, "PACKAGE_DUPLICATE");
    }
    const before = await readStore();
    await db.transaction(async (tx) => {
      await write(tx, KEY, body as unknown as Record<string, unknown>, auth.userId);
      await audit(tx, req, { action: "platform.hardware_store_changed", resourceType: "platform_settings", actorUserId: auth.userId, before: { deliveryChargePaise: before.deliveryChargePaise, prices: before.products.map((p) => [p.key, p.pricePaise]) }, after: { deliveryChargePaise: body.deliveryChargePaise, prices: body.products.map((p) => [p.key, p.pricePaise]) } });
    });
    return body;
  });

  await app.register(async (scope) => {
    scope.addContentTypeParser("application/octet-stream", (_req, payload, done) => done(null, payload));
    scope.post("/platform-admin/hardware-store/images", { bodyLimit: MAX_IMAGE_BYTES + 1024 }, async (req, reply) => {
      const auth = requirePlatformAdmin(req);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req.body as Readable) {
        size += (chunk as Buffer).length;
        if (size > MAX_IMAGE_BYTES) throw new AppError(413, "IMAGE_TOO_LARGE", "This picture is larger than 3 MB.");
        chunks.push(chunk as Buffer);
      }
      const bytes = Buffer.concat(chunks);
      const type = imageType(bytes);
      if (!type) throw unprocessable("Choose a PNG, JPG or WebP picture.", "IMAGE_TYPE");
      mkdirSync(imageDir(), { recursive: true });
      const file = `p-${randomBytes(12).toString("hex")}.${type}`;
      writeFileSync(path.join(imageDir(), file), bytes);
      await audit(db, req, { action: "platform.hardware_store_image_added", resourceType: "platform_settings", actorUserId: auth.userId, after: { file, size } });
      reply.code(201);
      return { url: `/api/v1/commercial/hardware-store/images/${file}` };
    });
  });
}
