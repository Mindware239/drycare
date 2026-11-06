/**
 * All monetary values are integer minor units (paise for INR). Never use floats for money.
 */
export type Minor = number;

export function toMinor(major: number | string): Minor {
  const n = typeof major === "string" ? Number(major) : major;
  if (!Number.isFinite(n)) throw new Error("Invalid amount");
  return Math.round(n * 100);
}

export function fromMinor(minor: Minor): number {
  return minor / 100;
}

export function formatMoney(minor: Minor, currency = "INR", locale = currency === "INR" ? "en-IN" : "en"): string {
  // Amounts are held in hundredths of the main unit for every currency; the currency decides how many digits show.
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

/** Basis points: 1800 bps = 18%. Rounds half away from zero to the nearest minor unit. */
export function applyBps(amount: Minor, bps: number): Minor {
  const raw = (amount * bps) / 10000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}
