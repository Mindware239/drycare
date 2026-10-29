import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";

export function marketingUnsubscribeToken(organizationId: string, customerId: string) {
  if (!env.MARKETING_UNSUBSCRIBE_SECRET) throw new Error("Marketing unsubscribe signing secret is not configured");
  return createHmac("sha256", env.MARKETING_UNSUBSCRIBE_SECRET)
    .update(`${organizationId}:${customerId}`)
    .digest("base64url");
}

export function isValidMarketingUnsubscribeToken(organizationId: string, customerId: string, token: string) {
  if (!env.MARKETING_UNSUBSCRIBE_SECRET) return false;
  const expected = Buffer.from(marketingUnsubscribeToken(organizationId, customerId));
  const provided = Buffer.from(token);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
