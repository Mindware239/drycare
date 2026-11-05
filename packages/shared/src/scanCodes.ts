/**
 * New tags and bags carry a number given by the server, as many digits long as the shop chose (six by default).
 * Tags printed before that carry one of these older forms, and must keep scanning:
 *
 *   NEWDEL-2026-00001-01 becomes  0 cc 26 00001 01   (0 = garment, cc = check on the branch code)
 *   NEWDEL-2026-00001-B1 becomes  1 cc 26 00001 01   (1 = bag)
 *
 * The full code is still what is stored and printed as text. Numbers that do not fit this pattern
 * (a 100th garment, or order 100,000) keep their full code in the barcode.
 */
const FULL_TAG = /^([^-]+)-20(\d{2})-(\d{5})-(\d{2})$/;
const FULL_BAG = /^([^-]+)-20(\d{2})-(\d{5})-B(\d{1,2})$/;
const SHORT_TAG = /^([^-]+?)(\d{2})(\d{5})(\d{2})$/;
const NUMERIC = /^([01])(\d{2})(\d{2})(\d{5})(\d{2})$/;

/** Two digits derived from the branch code, so branches that share order numbers do not collide. */
export function branchCheck(branchCode: string) {
  let sum = 0;
  for (let i = 0; i < branchCode.length; i++) sum += (i + 1) * branchCode.charCodeAt(i);
  return String(sum % 100).padStart(2, "0");
}

/** The number a line barcode holds for this tag or bag code, or the code itself if it does not fit the pattern. */
export function numericScanCode(code: string) {
  const garment = FULL_TAG.exec(code);
  if (garment) return `0${branchCheck(garment[1])}${garment[2]}${garment[3]}${garment[4]}`;
  const bag = FULL_BAG.exec(code);
  if (bag) return `1${branchCheck(bag[1])}${bag[2]}${bag[3]}${bag[4].padStart(2, "0")}`;
  return code;
}

export type ParsedScanNumber = { kind: "garment" | "bag"; check: string; ending: string };

/** What a scanned 12-digit number refers to. Only the server can turn it into a full code. */
export function parseScanNumber(raw: string): ParsedScanNumber | null {
  const m = NUMERIC.exec(raw.trim());
  if (!m) return null;
  const kind = m[1] === "0" ? "garment" : "bag";
  return { kind, check: m[2], ending: `-20${m[3]}-${m[4]}-${kind === "garment" ? m[5] : `B${Number(m[5])}`}` };
}

/** What sample tags from the designer carry. Numbering starts at 1, so all zeros is never issued. */
export const sampleScanCode = (digits = 6) => "0".repeat(digits);
/** Sample tags from the designer: all zeros, or the older number with order 00000, which is never issued. */
export const isSampleScanNumber = (raw: string) => /^0+$/.test(raw.trim()) || /^[01]\d{4}00000\d{2}$/.test(raw.trim());

/** The earlier short form, still printed on existing tags: NEWDEL-2026-00001-01 as NEWDEL260000101. */
export function compactTagCode(tagCode: string) {
  const m = FULL_TAG.exec(tagCode);
  return m ? `${m[1]}${m[2]}${m[3]}${m[4]}` : tagCode;
}

/** Turns whatever a scanner typed into the stored code, where that needs no lookup. Digits-only numbers pass through. */
export function expandScanCode(raw: string) {
  const code = raw.trim().toUpperCase();
  // Long numbers and RFID tag numbers (letters A to F and digits) are whole codes, never the old short form.
  if (code.includes("-") || /^\d+$/.test(code) || /^[0-9A-F]{16,}$/.test(code)) return code;
  const m = SHORT_TAG.exec(code);
  return m ? `${m[1]}-20${m[2]}-${m[3]}-${m[4]}` : code;
}

/** An RFID tag's number in one form, whatever the reader typed around it. Null if it cannot be one. */
export function normalizeEpc(raw: string) {
  const epc = raw.trim().toUpperCase().replace(/^0X/, "").replace(/[\s:-]/g, "");
  return /^[0-9A-F]{8,64}$/.test(epc) ? epc : null;
}

/** The old short form when a branch code was all digits: only worth trying after a number lookup finds nothing. */
export function digitsAsShortTag(code: string) {
  const m = /^\d+$/.test(code) ? SHORT_TAG.exec(code) : null;
  return m ? `${m[1]}-20${m[2]}-${m[3]}-${m[4]}` : null;
}
