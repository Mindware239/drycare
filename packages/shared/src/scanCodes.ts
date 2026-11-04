/**
 * Line barcodes get wider, easier-to-scan bars when they carry fewer characters, so a tag's line barcode
 * can hold a short form of its number: NEWDEL-2026-00001-01 becomes NEWDEL260000101.
 * The full number is still what is stored and printed as text.
 */
const FULL_TAG = /^([^-]+)-20(\d{2})-(\d{5})-(\d{2})$/;
const SHORT_TAG = /^([^-]+?)(\d{2})(\d{5})(\d{2})$/;

export function compactTagCode(tagCode: string) {
  const m = FULL_TAG.exec(tagCode);
  return m ? `${m[1]}${m[2]}${m[3]}${m[4]}` : tagCode;
}

/** Turns whatever a scanner typed into the stored code. Codes with hyphens are already in full form. */
export function expandScanCode(raw: string) {
  const code = raw.trim().toUpperCase();
  if (code.includes("-")) return code;
  const m = SHORT_TAG.exec(code);
  return m ? `${m[1]}-20${m[2]}-${m[3]}-${m[4]}` : code;
}
