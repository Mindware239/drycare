/**
 * Desktop license management from the super admin console: one Ed25519 signing key (private half encrypted at rest
 * with secretBox), signing offline activation keys for PCs, a register of issued keys, and an encrypted key backup.
 * Keys use the same DRYCARE1.<payload>.<signature> format the desktop app verifies (lib/license.ts).
 */
import type { FastifyInstance } from "fastify";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { signedLicenseSchema } from "@drycare/shared";
import { db, schema } from "../db/client";
import { requirePlatformAdmin } from "../lib/context";
import { audit } from "../lib/audit";
import { conflict, notFound } from "../lib/errors";
import { openSecret, sealSecret } from "../lib/secretBox";
import { write } from "../lib/platformSettings";
import { verifySignedLicense } from "../lib/license";

type StoredSigningKey = { publicKeyPem: string; privateKeySealed: string; fingerprint: string; createdAt: string; createdBy: string };

async function signingKey(): Promise<StoredSigningKey | null> {
  const row = await db.query.platformSettings.findFirst({ where: eq(schema.platformSettings.key, "license_signing") });
  return row?.value && (row.value as StoredSigningKey).publicKeyPem ? (row.value as StoredSigningKey) : null;
}

const fingerprintOf = (publicKeyPem: string) =>
  createHash("sha256").update(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" })).digest("hex").slice(0, 16).toUpperCase().replace(/(.{4})(?!$)/g, "$1-");

/** In a development checkout, keep the desktop build's public key in step with the console's signing key. */
function writeDesktopPublicKey(publicKeyPem: string) {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) && existsSync(join(dir, "apps", "desktop"))) {
      const file = join(dir, "apps", "desktop", "build", "license-public.pem");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, publicKeyPem, "utf8");
      return file;
    }
    dir = dirname(dir);
  }
  return null;
}

export async function platformLicenseRoutes(app: FastifyInstance) {
  app.get("/platform-admin/licenses/signing-key", async (req) => {
    requirePlatformAdmin(req);
    const k = await signingKey();
    return k ? { exists: true, fingerprint: k.fingerprint, createdAt: k.createdAt, publicKeyPem: k.publicKeyPem } : { exists: false };
  });

  app.post("/platform-admin/licenses/signing-key", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req) => {
    const auth = requirePlatformAdmin(req);
    z.object({ confirm: z.literal("CREATE") }).parse(req.body);
    if (await signingKey()) throw conflict("A signing key already exists. Replacing it would stop every installed copy from accepting new keys, so it cannot be done here.", "SIGNING_KEY_EXISTS");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const value: StoredSigningKey = { publicKeyPem: publicKey, privateKeySealed: sealSecret(privateKey), fingerprint: fingerprintOf(publicKey), createdAt: new Date().toISOString(), createdBy: auth.userId };
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('license_signing'))`);
      const again = await tx.query.platformSettings.findFirst({ where: eq(schema.platformSettings.key, "license_signing") });
      if (again) throw conflict("A signing key already exists.", "SIGNING_KEY_EXISTS");
      await write(tx, "license_signing", value as unknown as Record<string, unknown>, auth.userId);
      await audit(tx, req, { action: "platform.license_signing_key_created", resourceType: "platform_settings", actorUserId: auth.userId, after: { fingerprint: value.fingerprint } });
    });
    const desktopFile = writeDesktopPublicKey(publicKey);
    return { exists: true, fingerprint: value.fingerprint, createdAt: value.createdAt, publicKeyPem: publicKey, desktopFile };
  });

  /** Private key backup, encrypted with a passphrase the admin chooses (standard PKCS#8, usable with the CLI issuer). */
  app.post("/platform-admin/licenses/signing-key/backup", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const { passphrase } = z.object({ passphrase: z.string().min(16, "Use a passphrase of at least 16 characters").max(200) }).parse(req.body);
    const k = await signingKey();
    if (!k) throw notFound("Signing key");
    const pem = createPrivateKey(openSecret(k.privateKeySealed)).export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase });
    await audit(db, req, { action: "platform.license_signing_key_backed_up", resourceType: "platform_settings", actorUserId: auth.userId, after: { fingerprint: k.fingerprint } });
    reply.header("content-type", "application/x-pem-file").header("content-disposition", `attachment; filename="drycare-license-private-${k.fingerprint}.pem"`);
    return pem;
  });

  app.get("/platform-admin/licenses", async (req) => {
    requirePlatformAdmin(req);
    const rows = await db.select({
      id: schema.desktopLicenses.id, organizationId: schema.desktopLicenses.organizationId, customerName: schema.desktopLicenses.customerName,
      plan: schema.desktopLicenses.plan, installationIds: schema.desktopLicenses.installationIds, expiresAt: schema.desktopLicenses.expiresAt,
      key: schema.desktopLicenses.key, note: schema.desktopLicenses.note, issuedAt: schema.desktopLicenses.issuedAt, issuedBy: schema.users.name,
    }).from(schema.desktopLicenses).leftJoin(schema.users, eq(schema.users.id, schema.desktopLicenses.issuedBy)).orderBy(desc(schema.desktopLicenses.issuedAt)).limit(500);
    return rows;
  });

  app.post("/platform-admin/licenses", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const body = z.object({
      organizationId: z.uuid().optional(),
      customerName: z.string().trim().min(2).max(120),
      plan: z.string().trim().min(1).max(80),
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      installationIds: z.array(z.string().trim().toLowerCase().uuid("Each PC request code is a 36-character code shown on the activation screen")).min(1).max(100),
      note: z.string().trim().max(300).optional(),
    }).parse(req.body);
    const k = await signingKey();
    if (!k) throw conflict("Create the signing key first.", "SIGNING_KEY_MISSING");
    if (new Set(body.installationIds).size !== body.installationIds.length) throw conflict("The same PC request code is listed twice.", "DUPLICATE_DEVICE");
    let expiresAt: string | null = null;
    if (body.expiresOn) {
      expiresAt = new Date(`${body.expiresOn}T23:59:59.999Z`).toISOString();
      if (Date.parse(expiresAt) <= Date.now()) throw conflict("The expiry date must be in the future.", "EXPIRY_IN_PAST");
    }
    if (body.organizationId) {
      const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, body.organizationId) });
      if (!org) throw notFound("Customer");
    }
    const payload = signedLicenseSchema.parse({ version: 1, licenseId: randomUUID(), plan: body.plan, issuedAt: new Date().toISOString(), expiresAt, installationIds: body.installationIds });
    const bytes = Buffer.from(JSON.stringify(payload));
    const signature = sign(null, bytes, createPrivateKey(openSecret(k.privateKeySealed)));
    const key = `DRYCARE1.${bytes.toString("base64url")}.${signature.toString("base64url")}`;
    // Self-check with the public key exactly as the desktop app will.
    if (!verifySignedLicense(key, k.publicKeyPem)) throw new Error("Signed key failed verification");
    await db.transaction(async (tx) => {
      await tx.insert(schema.desktopLicenses).values({
        id: payload.licenseId, organizationId: body.organizationId, customerName: body.customerName, plan: payload.plan,
        installationIds: payload.installationIds, expiresAt: expiresAt ? new Date(expiresAt) : null, key, note: body.note, issuedBy: auth.userId,
      });
      await audit(tx, req, { action: "platform.desktop_license_issued", resourceType: "desktop_license", resourceId: payload.licenseId, orgId: body.organizationId, actorUserId: auth.userId, after: { customer: body.customerName, plan: payload.plan, pcs: payload.installationIds.length, expiresAt } });
    });
    reply.code(201);
    return { id: payload.licenseId, key, plan: payload.plan, expiresAt, installationIds: payload.installationIds };
  });
}
