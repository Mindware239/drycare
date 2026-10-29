import { z } from "zod";

export const signedLicenseSchema = z.object({
  version: z.literal(1),
  licenseId: z.string().uuid(),
  plan: z.string().trim().min(1).max(80),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  installationIds: z.array(z.string().uuid()).min(1).max(100),
});

export type SignedLicense = z.infer<typeof signedLicenseSchema>;
