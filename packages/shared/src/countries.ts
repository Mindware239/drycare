/**
 * What changes from country to country: tax wording and rate, currency, time zone, number and date style.
 * The tax rates are starting points a shop owner can change, not tax advice. Rates change, and whether dry cleaning
 * is taxed at the standard rate differs by place, so each shop should confirm theirs with an accountant.
 */
export const LANGUAGES = [
  { code: "en", name: "English", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl" },
  { code: "de", name: "Deutsch", dir: "ltr" },
  { code: "es", name: "Español", dir: "ltr" },
  { code: "ru", name: "Русский", dir: "ltr" },
  { code: "zh", name: "中文", dir: "ltr" },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export const isLanguage = (v: unknown): v is LanguageCode => LANGUAGES.some((l) => l.code === v);

export interface CountryPack {
  code: string;
  name: string;
  currency: string;
  timezone: string;
  language: LanguageCode;
  dialCode: string;
  /** Name of the tax printed on bills, e.g. GST, VAT, IVA. */
  taxName: string;
  /** Name of the business tax number, e.g. GSTIN, TRN, USt-IdNr. */
  taxIdLabel: string;
  /** Checked only when the shop's country is this one. */
  taxIdPattern?: string;
  taxIdExample?: string;
  /** A starting rate in basis points: 1800 = 18%. */
  defaultTaxBps: number;
  /** Whether a shop's prices normally already include the tax. */
  pricesIncludeTax: boolean;
  /** India only: half CGST, half SGST on a bill. */
  splitsGst?: boolean;
  /** India only: UPI payment links and QR codes. */
  hasUpi?: boolean;
  /** Name of a service code on an invoice, when the country uses one. */
  serviceCodeLabel?: string;
  /** Name of the postcode field. */
  postcodeLabel: string;
}

const pack = (
  code: string, name: string, currency: string, timezone: string, language: LanguageCode, dialCode: string,
  taxName: string, taxIdLabel: string, defaultTaxBps: number, pricesIncludeTax: boolean, postcodeLabel = "Postcode",
  extra: Partial<CountryPack> = {},
): CountryPack => ({ code, name, currency, timezone, language, dialCode, taxName, taxIdLabel, defaultTaxBps, pricesIncludeTax, postcodeLabel, ...extra });

export const COUNTRIES: CountryPack[] = [
  pack("IN", "India", "INR", "Asia/Kolkata", "en", "91", "GST", "GSTIN", 1800, false, "PIN code", { splitsGst: true, hasUpi: true, serviceCodeLabel: "SAC", taxIdPattern: "^\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$", taxIdExample: "22AAAAA0000A1Z5" }),
  // Arabic-speaking
  pack("AE", "United Arab Emirates", "AED", "Asia/Dubai", "ar", "971", "VAT", "TRN", 500, true, "Postcode", { taxIdPattern: "^\\d{15}$", taxIdExample: "100000000000003" }),
  pack("SA", "Saudi Arabia", "SAR", "Asia/Riyadh", "ar", "966", "VAT", "VAT number", 1500, true, "Postcode", { taxIdPattern: "^\\d{15}$", taxIdExample: "300000000000003" }),
  pack("EG", "Egypt", "EGP", "Africa/Cairo", "ar", "20", "VAT", "Tax number", 1400, true),
  pack("QA", "Qatar", "QAR", "Asia/Qatar", "ar", "974", "Tax", "Tax number", 0, true),
  pack("KW", "Kuwait", "KWD", "Asia/Kuwait", "ar", "965", "Tax", "Tax number", 0, true),
  pack("BH", "Bahrain", "BHD", "Asia/Bahrain", "ar", "973", "VAT", "VAT number", 1000, true),
  pack("OM", "Oman", "OMR", "Asia/Muscat", "ar", "968", "VAT", "VAT number", 500, true),
  pack("JO", "Jordan", "JOD", "Asia/Amman", "ar", "962", "Sales tax", "Tax number", 1600, true),
  pack("MA", "Morocco", "MAD", "Africa/Casablanca", "ar", "212", "VAT", "Tax number", 2000, true),
  // German-speaking
  pack("DE", "Germany", "EUR", "Europe/Berlin", "de", "49", "VAT", "USt-IdNr.", 1900, true, "Postcode", { taxIdPattern: "^DE\\d{9}$", taxIdExample: "DE123456789" }),
  pack("AT", "Austria", "EUR", "Europe/Vienna", "de", "43", "VAT", "UID", 2000, true, "Postcode", { taxIdPattern: "^ATU\\d{8}$", taxIdExample: "ATU12345678" }),
  pack("CH", "Switzerland", "CHF", "Europe/Zurich", "de", "41", "VAT", "UID", 810, true),
  // Spanish-speaking
  pack("ES", "Spain", "EUR", "Europe/Madrid", "es", "34", "IVA", "NIF", 2100, true),
  pack("MX", "Mexico", "MXN", "America/Mexico_City", "es", "52", "IVA", "RFC", 1600, true, "Postcode", { taxIdPattern: "^[A-ZÑ&]{3,4}\\d{6}[A-Z0-9]{3}$", taxIdExample: "XAXX010101000" }),
  pack("AR", "Argentina", "ARS", "America/Argentina/Buenos_Aires", "es", "54", "IVA", "CUIT", 2100, true),
  pack("CO", "Colombia", "COP", "America/Bogota", "es", "57", "IVA", "NIT", 1900, true),
  pack("PE", "Peru", "PEN", "America/Lima", "es", "51", "IGV", "RUC", 1800, true),
  // Russian-speaking
  pack("RU", "Russia", "RUB", "Europe/Moscow", "ru", "7", "VAT", "INN", 2200, true, "Postcode", { taxIdPattern: "^(\\d{10}|\\d{12})$", taxIdExample: "7707083893" }),
  pack("KZ", "Kazakhstan", "KZT", "Asia/Almaty", "ru", "7", "VAT", "BIN", 1600, true, "Postcode", { taxIdPattern: "^\\d{12}$", taxIdExample: "123456789012" }),
  pack("BY", "Belarus", "BYN", "Europe/Minsk", "ru", "375", "VAT", "UNP", 2000, true),
  // Chinese-speaking
  pack("CN", "China", "CNY", "Asia/Shanghai", "zh", "86", "VAT", "Tax ID", 600, true, "Postcode", { taxIdPattern: "^[0-9A-Z]{18}$", taxIdExample: "91310000000000000X" }),
  pack("HK", "Hong Kong", "HKD", "Asia/Hong_Kong", "zh", "852", "Tax", "BR number", 0, true),
  pack("TW", "Taiwan", "TWD", "Asia/Taipei", "zh", "886", "Business tax", "Tax ID", 500, true),
  // Other large markets
  pack("GB", "United Kingdom", "GBP", "Europe/London", "en", "44", "VAT", "VAT number", 2000, true, "Postcode", { taxIdPattern: "^GB\\d{9}$", taxIdExample: "GB123456789" }),
  pack("IE", "Ireland", "EUR", "Europe/Dublin", "en", "353", "VAT", "VAT number", 2300, true),
  pack("FR", "France", "EUR", "Europe/Paris", "en", "33", "VAT", "VAT number", 2000, true),
  pack("IT", "Italy", "EUR", "Europe/Rome", "en", "39", "VAT", "VAT number", 2200, true),
  pack("US", "United States", "USD", "America/New_York", "en", "1", "Sales tax", "EIN", 0, false, "ZIP code"),
  pack("CA", "Canada", "CAD", "America/Toronto", "en", "1", "Sales tax", "Business number", 500, false),
  pack("AU", "Australia", "AUD", "Australia/Sydney", "en", "61", "GST", "ABN", 1000, true),
  pack("NZ", "New Zealand", "NZD", "Pacific/Auckland", "en", "64", "GST", "IRD number", 1500, true),
  pack("SG", "Singapore", "SGD", "Asia/Singapore", "en", "65", "GST", "GST number", 900, true),
  pack("ZA", "South Africa", "ZAR", "Africa/Johannesburg", "en", "27", "VAT", "VAT number", 1500, true),
  pack("NG", "Nigeria", "NGN", "Africa/Lagos", "en", "234", "VAT", "TIN", 750, true),
  pack("KE", "Kenya", "KES", "Africa/Nairobi", "en", "254", "VAT", "PIN", 1600, true),
  pack("BD", "Bangladesh", "BDT", "Asia/Dhaka", "en", "880", "VAT", "BIN", 1500, true),
  pack("LK", "Sri Lanka", "LKR", "Asia/Colombo", "en", "94", "VAT", "TIN", 1800, true),
  pack("NP", "Nepal", "NPR", "Asia/Kathmandu", "en", "977", "VAT", "PAN", 1300, true),
];

export const DEFAULT_COUNTRY = "IN";
export const countryPack = (code?: string | null): CountryPack => COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];

/** The settings on an organization that change a pack's wording and defaults. */
export interface RegionSettings {
  country?: string;
  language?: string;
  pricesIncludeTax?: boolean;
  taxName?: string;
  taxIdLabel?: string;
  defaultTaxBps?: number;
}

export interface Region {
  country: string;
  currency: string;
  timezone: string;
  language: LanguageCode;
  taxName: string;
  taxIdLabel: string;
  taxIdExample?: string;
  defaultTaxBps: number;
  pricesIncludeTax: boolean;
  splitsGst: boolean;
  hasUpi: boolean;
  serviceCodeLabel?: string;
  postcodeLabel: string;
  dialCode: string;
}

/** A shop's region: its country's pack, with what the owner has changed on top. A shop with no country set is in India. */
export function resolveRegion(org: { defaultCurrency?: string | null; defaultTimezone?: string | null; settings?: RegionSettings | null } | null | undefined): Region {
  const s = org?.settings ?? {};
  const p = countryPack(s.country);
  return {
    country: p.code,
    currency: org?.defaultCurrency || p.currency,
    timezone: org?.defaultTimezone || p.timezone,
    language: isLanguage(s.language) ? s.language : p.language,
    taxName: s.taxName?.trim() || p.taxName,
    taxIdLabel: s.taxIdLabel?.trim() || p.taxIdLabel,
    taxIdExample: p.taxIdExample,
    defaultTaxBps: s.defaultTaxBps ?? p.defaultTaxBps,
    pricesIncludeTax: s.pricesIncludeTax ?? p.pricesIncludeTax,
    splitsGst: Boolean(p.splitsGst),
    hasUpi: Boolean(p.hasUpi),
    serviceCodeLabel: p.serviceCodeLabel,
    postcodeLabel: p.postcodeLabel,
    dialCode: p.dialCode,
  };
}

/** About how much one rupee buys in each currency. Sizes a new shop's starting prices and the plan prices shops abroad pay. Review these from time to time. */
const RUPEE_RATE: Record<string, number> = {
  INR: 1, AED: 0.042, SAR: 0.042, EGP: 0.55, QAR: 0.041, KWD: 0.0035, BHD: 0.0043, OMR: 0.0044, JOD: 0.008, MAD: 0.11,
  EUR: 0.0105, CHF: 0.0095, MXN: 0.21, ARS: 14, COP: 46, PEN: 0.04, RUB: 0.95, KZT: 6, BYN: 0.037, CNY: 0.082, HKD: 0.088,
  TWD: 0.36, GBP: 0.0088, USD: 0.0113, CAD: 0.0155, AUD: 0.0172, NZD: 0.019, SGD: 0.0146, ZAR: 0.2, NGN: 17, KES: 1.45,
  BDT: 1.38, LKR: 3.4, NPR: 1.6,
};

/** A new shop's starting price from the standard Indian list, in its own currency and rounded to two significant figures. */
export function startingPrice(rupeeMinor: number, currency: string): number {
  const rate = RUPEE_RATE[currency] ?? 1;
  if (rate === 1 || rupeeMinor <= 0) return rupeeMinor;
  const value = rupeeMinor * rate;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
  return Math.max(1, Math.round(value / step) * step);
}

/** A Drycare plan's rupee price in another currency, rounded to a clean figure. */
export const localPlanPrice = (rupeeMinor: number, currency: string) => startingPrice(rupeeMinor, currency);

/** About how many of this currency one rupee buys, for adding up money received in several currencies. */
export const rupeeRate = (currency: string) => RUPEE_RATE[currency] ?? 1;
export const RUPEE_RATES: Readonly<Record<string, number>> = RUPEE_RATE;

/** The country a computer is probably in, from its clock and then its language setting. */
export function guessCountry(timeZone: string | undefined, language: string | undefined): string | null {
  if (timeZone === "Asia/Calcutta") return "IN";
  const byZone = COUNTRIES.find((c) => c.timezone === timeZone);
  if (byZone) return byZone.code;
  const region = language?.match(/-([A-Za-z]{2})$/)?.[1]?.toUpperCase();
  return COUNTRIES.find((c) => c.code === region)?.code ?? null;
}

/** Whether a tax number fits the country's format. Countries with no known format accept any sensible number. */
export function validTaxId(country: string | undefined | null, value: string): boolean {
  const v = value.trim().toUpperCase();
  if (!v) return true;
  const pattern = countryPack(country).taxIdPattern;
  return pattern ? new RegExp(pattern).test(v) : /^[A-Z0-9][A-Z0-9 ./-]{2,29}$/.test(v);
}

/** Today's date (YYYY-MM-DD) where the shop is. */
export function todayInZone(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Time zone names go into report queries as text, so only a real zone name is accepted. */
export function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Number and date style: the language, in the country's conventions, always with ordinary digits so bills read the same. */
export function formatLocale(language: string, country: string): string {
  return `${language}-${country}-u-nu-latn`;
}
