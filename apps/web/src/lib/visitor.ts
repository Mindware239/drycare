"use client";
/**
 * The country a visitor to the public site is in, from this computer's clock and language. They can change it on the
 * pricing page. Signed-in shops use their own country instead.
 */
import { countryPack, guessCountry, formatMoney, localPlanPrice } from "@drycare/shared";

const KEY = "drycare.visitor";
/** Anywhere without its own country settings: priced in US dollars. */
export const ELSEWHERE = "ZZ";

export type Visitor = { code: string; india: boolean; currency: string; taxName: string; taxIdLabel: string };

export function visitorCountry(): string {
  if (typeof window === "undefined") return "IN";
  let chosen: string | null = null;
  try {
    chosen = localStorage.getItem(KEY);
  } catch {}
  if (chosen) return chosen;
  return guessCountry(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language) ?? ELSEWHERE;
}

export function chooseVisitorCountry(code: string) {
  try {
    localStorage.setItem(KEY, code);
  } catch {}
  window.location.reload();
}

export function visitor(code = visitorCountry()): Visitor {
  if (code === ELSEWHERE) return { code, india: false, currency: "USD", taxName: "Tax", taxIdLabel: "Tax ID" };
  const pack = countryPack(code);
  return { code: pack.code, india: pack.code === "IN", currency: pack.currency, taxName: pack.taxName, taxIdLabel: pack.taxIdLabel };
}

/** A whole-number price needs no ".00". */
export const cleanMoney = (minor: number, currency: string) =>
  formatMoney(minor, currency, currency === "INR" ? "en-IN" : "en").replace(/[.,]00(?=\D*$)/, "");

/** A list price held in rupees, as this visitor would pay it. */
export const visitorPrice = (rupeeMinor: number, v: Visitor) => localPlanPrice(rupeeMinor, v.currency);

export const currencySign = (currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
