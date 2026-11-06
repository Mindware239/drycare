import { z } from "zod";

export const signedLicenseSchema = z.object({
  version: z.literal(1),
  licenseId: z.string().uuid(),
  plan: z.string().trim().min(1).max(80),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  installationIds: z.array(z.string().uuid()).min(1).max(100),
  /**
   * A PC works offline, so its key carries what this customer may use. Keys issued before this existed have
   * neither field and keep full access. Older app versions ignore both.
   */
  features: z.record(z.string(), z.boolean()).optional(),
  hardware: z.object({
    printers: z.array(z.string().max(120)).max(200),
    scanners: z.array(z.string().max(120)).max(200),
    /** Printers and scanners Mindware sold to this customer. When present, only these can be connected and used. */
    soldPrinters: z.array(z.object({ serial: z.string().max(80), bill: z.string().max(80), model: z.string().max(120), kind: z.enum(["printer", "scanner"]).optional() })).max(500).optional(),
    rfidReaders: z.array(z.string().max(120)).max(200).optional(),
    driverUrl: z.string().max(500).nullable().optional(),
  }).optional(),
  limits: z.object({ branches: z.number().int().min(1).nullable() }).optional(),
  /** Added later, so older keys have none of these and older app versions ignore them. */
  organizationId: z.string().uuid().optional(),
  customerName: z.string().max(160).optional(),
  licenseType: z.enum(["subscription", "standalone", "lifetime", "annual", "monthly", "enterprise", "trial"]).optional(),
  entitlementVersion: z.number().int().min(1).optional(),
  /** How long this PC may go without reaching the licensing server. None: it may stay offline until the key expires. */
  offlineGraceDays: z.number().int().min(1).nullable().optional(),
  /** What still works after expiry. Business data is never deleted either way. */
  expiryPolicy: z.enum(["read_only", "locked"]).optional(),
});

export type SignedLicense = z.infer<typeof signedLicenseSchema>;

/** The licensing server's answer to a PC checking in, signed with the same key as the license. */
export const licenseStatusTokenSchema = z.object({
  version: z.literal(1),
  /** The one-time code from this PC's request, so an old answer cannot be replayed. */
  nonce: z.string().uuid(),
  installationId: z.string().uuid(),
  licenseId: z.string().uuid(),
  status: z.enum(["active", "suspended", "revoked", "deactivated"]),
  reason: z.string().max(500).nullable().optional(),
  /** A newer signed key, when something has changed. */
  key: z.string().max(20_000).optional(),
  serverTime: z.string().datetime(),
});
export type LicenseStatusToken = z.infer<typeof licenseStatusTokenSchema>;

/** What a PC is offered, signed by the licensing key. It repeats the PC's one-time code, so it cannot be replayed. */
export type ReleaseManifest = {
  version: 2;
  nonce: string;
  installationId: string;
  release: {
    version: string; title: string | null; sha256: string; sha512: string; size: number; notes: string; message: string | null;
    mandatory: boolean; automatic: boolean; restartRequired: boolean; deadline: string | null; window: { start: number; end: number } | null;
    minSupportedVersion: string | null; rollback: boolean; channel: string; signatureStatus: string | null; feedToken: string;
  } | null;
  suspendedVersions: string[];
  serverTime: string;
};

export type ReleaseTarget = { type: "all" } | { type: "beta" } | { type: "customers" | "businesses" | "installations" | "license_types"; ids: string[] };

/** Settings for a release that cannot all be true. */
export function releaseConfigProblems(c: { version?: string; mandatory?: boolean; automatic?: boolean; updateDeadline?: string | null; maintenanceStart?: number | null; maintenanceEnd?: number | null; minSupportedVersion?: string | null }) {
  const problems: string[] = [];
  if (c.updateDeadline && !c.mandatory) problems.push("A deadline only applies to a mandatory update.");
  if (c.updateDeadline && Date.parse(c.updateDeadline) <= Date.now()) problems.push("The deadline must be in the future.");
  if ((c.maintenanceStart == null) !== (c.maintenanceEnd == null)) problems.push("Set both the start and end of the maintenance window.");
  if (c.maintenanceStart != null && c.maintenanceStart === c.maintenanceEnd) problems.push("The maintenance window cannot start and end at the same hour.");
  if (c.automatic && c.maintenanceStart == null) problems.push("An automatic update needs a maintenance window, so it never interrupts work.");
  if (c.version && c.minSupportedVersion && compareVersions(c.minSupportedVersion, c.version) > 0) problems.push("The minimum supported version cannot be newer than this version.");
  return problems;
}

/** Negative if a is older than b. */
export function compareVersions(a: string, b: string) {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}
