import { and, eq, like } from "drizzle-orm";
import { MAX_SCAN_DIGITS, MIN_SCAN_DIGITS, branchCheck, digitsAsShortTag, expandScanCode, parseScanNumber } from "@drycare/shared";
import { schema, type db, type Tx } from "../db/client";
import { AppError } from "./errors";

/**
 * Turns anything a scanner can type into the stored tag or bag code. A number is looked up within
 * this organization. If two records ever matched, it refuses rather than opening the wrong garment.
 */
export async function resolveScanCode(tx: Tx | typeof db, orgId: string, raw: string) {
  const code = expandScanCode(raw);
  const isNumber = /^\d+$/.test(code);
  if (isNumber && code.length >= MIN_SCAN_DIGITS && code.length <= MAX_SCAN_DIGITS) {
    const [bags, garments] = await Promise.all([
      tx.select({ code: schema.bags.bagCode }).from(schema.bags).where(and(eq(schema.bags.organizationId, orgId), eq(schema.bags.scanCode, code))).limit(2),
      tx.select({ code: schema.garments.tagCode }).from(schema.garments).where(and(eq(schema.garments.organizationId, orgId), eq(schema.garments.scanCode, code))).limit(2),
    ]);
    const matches = [...bags, ...garments];
    if (matches.length > 1) throw new AppError(409, "AMBIGUOUS_TAG", "This barcode matches more than one tag. Type the full number printed on the tag.");
    if (matches[0]) return matches[0].code;
  }
  const parsed = parseScanNumber(code);
  if (!parsed) return (isNumber && digitsAsShortTag(code)) || code;
  const rows = parsed.kind === "garment"
    ? (await tx.select({ code: schema.garments.tagCode }).from(schema.garments).where(and(eq(schema.garments.organizationId, orgId), like(schema.garments.tagCode, `%${parsed.ending}`))))
    : (await tx.select({ code: schema.bags.bagCode }).from(schema.bags).where(and(eq(schema.bags.organizationId, orgId), like(schema.bags.bagCode, `%${parsed.ending}`))));
  const matches = rows.filter((r) => branchCheck(r.code.split("-")[0]) === parsed.check);
  if (matches.length > 1) throw new AppError(409, "AMBIGUOUS_TAG", "This barcode matches more than one tag. Type the full number printed on the tag.");
  return matches[0]?.code ?? code;
}
