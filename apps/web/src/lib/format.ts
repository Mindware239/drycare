import { formatLocale, formatMoney, resolveRegion, todayInZone, type Region } from "@drycare/shared";
import { currentLanguage, setTerms } from "./i18n";

const REGION_KEY = "drycare.region";
let region: Region = resolveRegion(null);

/** The shop's country settings, used by every format below. Remembered so print pages have them too. */
export function setRegion(next: Region, remember = true) {
  region = next;
  if (typeof window === "undefined") return;
  if (remember) {
    try {
      localStorage.setItem(REGION_KEY, JSON.stringify(next));
    } catch {}
  }
  document.documentElement.toggleAttribute("data-no-upi", !next.hasUpi);
  setTerms(next, currencySymbol());
}

export const currentRegion = () => region;
export const hasUpi = () => region.hasUpi;
export const appZone = () => region.timezone;
export const appLocale = () => (region.country === "IN" && currentLanguage() === "en" ? "en-IN" : formatLocale(currentLanguage(), region.country));
/** Payment choices this country has: UPI is India's. */
export const shopMethods = <T extends string>(methods: readonly T[]) => methods.filter((m) => m !== "upi" || region.hasUpi);
export function currencySymbol() {
  return new Intl.NumberFormat(appLocale(), { style: "currency", currency: region.currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? region.currency;
}
/** An amount without decimals, for dashboards. */
export const wholeMoney = (minor: number | string) => new Intl.NumberFormat(appLocale(), { style: "currency", currency: region.currency, maximumFractionDigits: 0 }).format(Number(minor) / 100);
/** Mindware's own prices to its customers are always in rupees. */
export const rupees = (paise: number | string | null | undefined) => formatMoney(Number(paise ?? 0), "INR", "en-IN");

export const money = (minor: number | string | null | undefined, currency = region.currency) => formatMoney(Number(minor ?? 0), currency, appLocale());

export const dateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString(appLocale(), { timeZone: appZone(), day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const dateOnly = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString(appLocale(), { timeZone: appZone(), day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Rupee input (e.g. "249.50") to paise. Returns NaN on invalid input. */
export const rupeesToPaise = (v: string) => (v.trim() === "" || isNaN(Number(v)) ? NaN : Math.round(Number(v) * 100));

export const todayISO = () => todayInZone(region.timezone);

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


if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem(REGION_KEY);
    if (saved) setRegion(JSON.parse(saved) as Region, false);
  } catch {}
}
