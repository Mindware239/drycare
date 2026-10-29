import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  WEB_ORIGIN: z.string().default("http://localhost:3210"),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  TRIAL_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  NODE_ENV: z.string().default("development"),
  /**
   * Which reverse proxies may set X-Forwarded-For (client IP for rate limits and audit). Default: none.
   * Production behind one proxy/load balancer: "1" (or the proxy's IP/CIDR). Never "true" on the open internet.
   */
  TRUST_PROXY: z.string().default("false").transform((v): boolean | number | string => (v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v)),
  /**
   * "saas": many independent businesses on one server (chain / commercial version).
   * "desktop": standalone single-store PC install — one business, local database, local backups.
   */
  DRYCARE_MODE: z.enum(["saas", "desktop"]).default("saas"),
  /** Local change capture for cloud sync. Default: on for the Windows app, off for the cloud server. */
  SYNC_CAPTURE: z.enum(["on", "off"]).optional(),
  /** DryCare Cloud base URL the PC links to (HTTPS). Unset = cloud sync not configured on this install. */
  DRYCARE_CLOUD_URL: z.string().url().optional(),
  /** Only for local integration tests: allows http:// to localhost. Never set in production. */
  DRYCARE_CLOUD_ALLOW_INSECURE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /** When set, the API also serves the statically exported web app from this folder. */
  WEB_DIST: z.string().optional(),
  BACKUP_DIR: z.string().optional(),
  APP_VERSION: z.string().default("0.1.0"),
  LICENSE_ENFORCED: z.string().default("false").transform((v) => v === "true"),
  LICENSE_PUBLIC_KEY: z.string().optional(),
  LICENSE_FILE: z.string().optional(),
  LICENSE_INSTALLATION_ID: z.string().uuid().optional(),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  MARKETING_UNSUBSCRIBE_SECRET: z.string().optional(),
  PLATFORM_SECRETS_KEY: z.string().optional(),
  CUSTOMER_APPROVAL_SECRET: z.string().min(32).optional(),
});

export const env = schema.parse(process.env);
export const isDesktop = env.DRYCARE_MODE === "desktop";
