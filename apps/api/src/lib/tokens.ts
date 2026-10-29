import { createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { schema, type DbOrTx } from "../db/client";

export type TokenPurpose = "password_reset" | "invitation" | "email_verification" | "platform_admin_mfa" | "platform_admin_reset";
export const TOKEN_TTL_HOURS: Record<TokenPurpose, number> = { password_reset: 24, invitation: 72, email_verification: 24, platform_admin_mfa: 1 / 6, platform_admin_reset: 1 / 6 };

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function issueToken(
  tx: DbOrTx,
  input: { purpose: TokenPurpose; email: string; organizationId?: string; userId?: string; payload?: Record<string, unknown>; createdBy?: string },
) {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS[input.purpose] * 3600_000);
  // A new link replaces any earlier unused link for the same person and purpose.
  await tx
    .update(schema.authTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.authTokens.purpose, input.purpose), eq(schema.authTokens.email, input.email), isNull(schema.authTokens.usedAt), isNull(schema.authTokens.revokedAt)));
  const [row] = await tx
    .insert(schema.authTokens)
    .values({ purpose: input.purpose, tokenHash: hash(token), email: input.email, organizationId: input.organizationId, userId: input.userId, payload: input.payload ?? {}, expiresAt, createdBy: input.createdBy })
    .returning();
  return { token, row, expiresAt };
}

/** Returns the token row only if it exists, matches the purpose, is unused, unrevoked and unexpired. */
export async function findValidToken(tx: DbOrTx, token: string, purpose?: TokenPurpose) {
  const row = await tx.query.authTokens.findFirst({
    where: and(eq(schema.authTokens.tokenHash, hash(token)), isNull(schema.authTokens.usedAt), isNull(schema.authTokens.revokedAt), gt(schema.authTokens.expiresAt, new Date())),
  });
  if (!row || (purpose && row.purpose !== purpose)) return undefined;
  return row;
}

/** Links are built from the address the staff member is using, so they work on the shop LAN too. */
export function linkFor(req: FastifyRequest, purpose: TokenPurpose, token: string) {
  const origin = `${req.protocol}://${req.headers["x-forwarded-host"] ?? req.headers.host}`;
  const path = purpose === "invitation" ? "accept-invite" : purpose === "email_verification" ? "verify-email" : "reset-password";
  return `${origin}/${path}?token=${token}`;
}
