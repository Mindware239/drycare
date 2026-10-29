/**
 * Encrypts small secrets (payment gateway keys) before they are stored in the database: AES-256-GCM.
 * The key comes from PLATFORM_SECRETS_KEY (32 bytes, base64). On a development server without it, a key is
 * generated once into .local/platform-secrets.key at the repository root; production requires the variable.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env } from "../env";
import { AppError } from "./errors";

let cached: Buffer | undefined;

function repoRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

function key() {
  if (cached) return cached;
  if (env.PLATFORM_SECRETS_KEY) {
    const k = Buffer.from(env.PLATFORM_SECRETS_KEY, "base64");
    if (k.length !== 32) throw new AppError(500, "SECRETS_KEY_INVALID", "PLATFORM_SECRETS_KEY must be 32 random bytes encoded as base64.");
    return (cached = k);
  }
  if (env.NODE_ENV === "production") {
    throw new AppError(503, "SECRETS_KEY_MISSING", "Set PLATFORM_SECRETS_KEY on the server before saving payment gateway keys.");
  }
  const file = join(repoRoot(), ".local", "platform-secrets.key");
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return (cached = Buffer.from(readFileSync(file, "utf8").trim(), "base64"));
}

export function sealSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function openSecret(sealed: string) {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new AppError(500, "SECRET_UNREADABLE", "A stored secret is damaged. Enter it again.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError(500, "SECRET_UNREADABLE", "A stored secret could not be decrypted (was PLATFORM_SECRETS_KEY changed?). Enter it again.");
  }
}

/** "••••1a2b" — enough to recognise which key is saved without revealing it. */
export const secretHint = (plain: string) => `••••${plain.slice(-4)}`;
