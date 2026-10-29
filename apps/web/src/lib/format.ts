import { formatMoney } from "@drycare/shared";

export const money = (paise: number | string | null | undefined, currency = "INR") => formatMoney(Number(paise ?? 0), currency);

export const dateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const dateOnly = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Rupee input (e.g. "249.50") to paise. Returns NaN on invalid input. */
export const rupeesToPaise = (v: string) => (v.trim() === "" || isNaN(Number(v)) ? NaN : Math.round(Number(v) * 100));

export const todayISO = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export const isOverdue = (promisedAt: string, status: string) =>
  new Date(promisedAt) < new Date() && ["received", "in_processing", "partially_ready"].includes(status);

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${words(n % 100)}` : ""}`;
  if (n < 100000) return `${words(Math.floor(n / 1000))} Thousand${n % 1000 ? ` ${words(n % 1000)}` : ""}`;
  if (n < 10000000) return `${words(Math.floor(n / 100000))} Lakh${n % 100000 ? ` ${words(n % 100000)}` : ""}`;
  return `${words(Math.floor(n / 10000000))} Crore${n % 10000000 ? ` ${words(n % 10000000)}` : ""}`;
}
/** Indian-style amount in words, e.g. "Rupees One Thousand Seventy Three and Eighty Paise Only". */
export function amountInWords(paise: number) {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${r ? words(r) : "Zero"}${p ? ` and ${words(p)} Paise` : ""} Only`;
}
