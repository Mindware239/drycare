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
    /** Printers Mindware sold to this customer. When present, only these can be connected and printed to. */
    soldPrinters: z.array(z.object({ serial: z.string().max(80), bill: z.string().max(80), model: z.string().max(120) })).max(500).optional(),
    rfidReaders: z.array(z.string().max(120)).max(200).optional(),
    driverUrl: z.string().max(500).nullable().optional(),
  }).optional(),
  limits: z.object({ branches: z.number().int().min(1).nullable() }).optional(),
});

export type SignedLicense = z.infer<typeof signedLicenseSchema>;
