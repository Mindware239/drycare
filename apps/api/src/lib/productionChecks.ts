/**
 * Refuses to start the cloud server in production with settings that would be unsafe on the internet.
 * (The Windows app runs on 127.0.0.1 and is not affected.)
 */
import { env, isDesktop } from "../env";

export function productionConfigProblems(): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (isDesktop || env.NODE_ENV !== "production") return { errors, warnings };
  if (!env.COOKIE_SECURE) errors.push("COOKIE_SECURE must be true (session cookies only over HTTPS).");
  if (!/^https:\/\//.test(env.WEB_ORIGIN)) errors.push("WEB_ORIGIN must be the public https:// address (used in emails and device-link pages).");
  if (env.TRUST_PROXY === true) errors.push('TRUST_PROXY=true trusts any client-supplied IP. Set the number of proxies (e.g. "2") or their addresses.');
  if (env.DRYCARE_CLOUD_ALLOW_INSECURE) errors.push("DRYCARE_CLOUD_ALLOW_INSECURE is for local tests only.");
  if (env.SYNC_CAPTURE === "on") errors.push("SYNC_CAPTURE=on is for shop PCs, not the cloud server.");
  try {
    const db = new URL(env.DATABASE_URL);
    const local = ["localhost", "127.0.0.1"].includes(db.hostname);
    if (!local && !/sslmode=(require|verify-ca|verify-full)/.test(db.search)) warnings.push("DATABASE_URL does not require TLS (add ?sslmode=require for a managed database).");
  } catch {
    errors.push("DATABASE_URL is not a valid URL.");
  }
  if (!env.RESEND_API_KEY && !env.SMTP_HOST) warnings.push("No email provider: password resets, verification and owner notices will not be delivered.");
  if (!env.PLATFORM_SECRETS_KEY) warnings.push("PLATFORM_SECRETS_KEY is not set: online plan payments (Razorpay) cannot be configured.");
  return { errors, warnings };
}
