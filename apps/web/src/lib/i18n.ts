"use client";
/**
 * Language support for every screen, without each screen knowing about it.
 *
 * Screens are written in English. Once React has drawn them, this layer swaps text it recognises for the
 * translation, using the dictionaries in src/i18n. It only ever changes the words inside existing text nodes and
 * a few attributes, so React keeps working normally. Text with no dictionary entry, such as customer names and
 * order numbers, is left alone. Mark an area with `data-i18n-skip` to keep it as written.
 *
 * Run `pnpm i18n:extract` after adding screens, to list new text for translation.
 */
import { isLanguage, LANGUAGES, type LanguageCode, type Region } from "@drycare/shared";
import { currencySign, visitor } from "./visitor";

const CHOICE_KEY = "drycare.lang";
const SHOP_KEY = "drycare.lang.shop";
const ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "NOSCRIPT", "SVG"]);

type Dictionary = Record<string, string>;
const LOADERS: Record<Exclude<LanguageCode, "en">, () => Promise<{ default: Dictionary }>> = {
  ar: () => import("@/i18n/ar.json"),
  de: () => import("@/i18n/de.json"),
  es: () => import("@/i18n/es.json"),
  ru: () => import("@/i18n/ru.json"),
  zh: () => import("@/i18n/zh.json"),
};

let language: LanguageCode = "en";
let exact = new Map<string, string>();
/** `plural` slots only add an English ending such as the s in "day{1}"; translations do not use them. */
let patterns: { regex: RegExp; slots: number[]; plural: Set<number>; to: string }[] = [];
const cache = new Map<string, string>();
let terms: [RegExp, string][] = [];
/** Applied before the dictionary lookup, when a whole wording is replaced outside India. */
let sourceTerms: [RegExp, string][] = [];
let shopRegion: Region | null = null;
let shopSymbol = "";
/** The public site's own wording for a visitor outside India. */
let siteWords: ((text: string) => string) | null = null;
let observer: MutationObserver | undefined;
let started = false;
/** The dictionary is in place. Nothing is drawn or marked as done before this, or it would stay in English. */
let ready = false;

/** What each language calls a country's tax. Names already in the local language are not listed. */
const LOCAL_TAX: Record<string, Partial<Record<LanguageCode, string>>> = {
  VAT: { ar: "ضريبة القيمة المضافة", de: "MwSt", es: "IVA", ru: "НДС", zh: "增值税" },
  "Sales tax": { ar: "ضريبة المبيعات", de: "Umsatzsteuer", es: "impuesto sobre ventas", ru: "налог с продаж", zh: "销售税" },
  "VAT number": { ar: "الرقم الضريبي", de: "USt-IdNr.", es: "NIF", ru: "ИНН", zh: "增值税号" },
  Tax: { ar: "الضريبة", de: "Steuer", es: "impuesto", ru: "налог", zh: "税" },
  "Tax ID": { ar: "الرقم الضريبي", de: "Steuernummer", es: "número fiscal", ru: "налоговый номер", zh: "税号" },
  "Tax number": { ar: "الرقم الضريبي", de: "Steuernummer", es: "número fiscal", ru: "налоговый номер", zh: "税号" },
};
const localTax = (name: string) => LOCAL_TAX[name]?.[language] ?? name;
const wholeWord = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu");

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};

export const currentLanguage = () => language;
export const isRtl = () => LANGUAGES.find((l) => l.code === language)?.dir === "rtl";

/** A language someone picked on this device, then their shop's language, then their browser's. */
function preferred(): LanguageCode {
  if (typeof window === "undefined") return "en";
  for (const value of [read(CHOICE_KEY), read(SHOP_KEY), (navigator.language || "").slice(0, 2)]) if (isLanguage(value)) return value;
  return "en";
}

/** Runs before the first paint, so a page never flashes in English or in the wrong direction. Keep it in step with preferred(). */
export const BOOT_SCRIPT = `try{var c=['ar','de','es','ru','zh'],s=localStorage,l=s.getItem('${CHOICE_KEY}')||s.getItem('${SHOP_KEY}')||(navigator.language||'').slice(0,2);if(s.getItem('${CHOICE_KEY}')==='en'||(!s.getItem('${CHOICE_KEY}')&&s.getItem('${SHOP_KEY}')==='en'))l='en';var t=c.indexOf(l)>=0,z=Intl.DateTimeFormat().resolvedOptions().timeZone,f=z!=='Asia/Kolkata'&&z!=='Asia/Calcutta';if((t||f)&&location.pathname.indexOf('/super-admin')!==0){var h=document.documentElement;if(t){h.lang=l;h.dir=l==='ar'?'rtl':'ltr'}h.setAttribute('data-i18n-pending','');setTimeout(function(){h.removeAttribute('data-i18n-pending')},4000)}}catch(e){}`;

function compile(dictionary: Dictionary) {
  exact = new Map();
  patterns = [];
  cache.clear();
  for (const [from, to] of Object.entries(dictionary)) {
    if (!to) continue;
    if (!/\{\d+\}/.test(from)) {
      exact.set(from, to);
      continue;
    }
    const slots: number[] = [];
    const plural = new Set<number>();
    const parts = from.split(/(\{\d+\})/);
    const wording = from.replace(/\{\d+\}/g, "").replace(/[^\p{L}]/gu, "").length;
    const glued = (before: string | undefined, after: string | undefined) => /\p{Ll}$/u.test(before ?? "") && !/^\p{L}/u.test(after ?? "");
    const source = parts.map((part, i) => {
      const slot = part.match(/^\{(\d+)\}$/);
      if (!slot) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const n = Number(slot[1]);
      slots.push(n);
      // A slot only takes what it can hold, so an ordinary sentence that happens to contain "garment" is not mistaken for "{0} garment{1}".
      if (glued(parts[i - 1], parts[i + 1])) {
        plural.add(n);
        return "(s|es|)";
      }
      if (/^\{\d+\}$/.test(parts[i + 2] ?? "") && glued(parts[i + 1], parts[i + 3])) return "([\\d٠-٩][\\d٠-٩.,٬٫]*)";
      if (i === 1 && !parts[0] && wording < 12) return "(\\S+)";
      return "(.+?)";
    });
    patterns.push({ regex: new RegExp(`^${source.join("")}$`, "u"), slots, plural, to });
  }
  // The longest wording is the most specific.
  patterns.sort((a, b) => b.regex.source.length - a.regex.source.length);
}

function lookup(text: string): string | undefined {
  const found = exact.get(text);
  if (found) return found;
  for (const { regex, slots, plural, to } of patterns) {
    const m = text.match(regex);
    if (!m) continue;
    return to.replace(/\{(\d+)\}/g, (_, n) => {
      if (plural.has(Number(n))) return "";
      const value = m[slots.indexOf(Number(n)) + 1] ?? "";
      return lookup(value) ?? value;
    });
  }
  return undefined;
}

function words(text: string): string {
  const hit = lookup(text);
  if (hit) return hit;
  // "Name:", "Total *" and "Paid · Cash" are worded the same as "Name", "Total", "Paid" and "Cash".
  const tail = text.match(/^(.*?)(\s*[:*.…?!]+)$/);
  if (tail && tail[1]) {
    const head = lookup(tail[1]);
    if (head) return head + tail[2];
  }
  if (text.includes(" · ")) return text.split(" · ").map(words).join(" · ");
  return text;
}

/** The text in the current language, with the shop's own tax and currency wording. Whitespace around it is kept. */
export function t(text: string, shopWords = true): string {
  if (!text || (language === "en" && !(shopWords ? terms.length : siteWords))) return text;
  const key = shopWords ? text : "\u0001" + text;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  let source = m[2];
  if (shopWords) for (const [from, to] of sourceTerms) source = source.replace(from, to);
  let out = /\p{L}/u.test(source) && language !== "en" ? words(source.replace(/\s+/g, " ")) : source;
  if (shopWords) for (const [from, to] of terms) out = out.replace(from, to);
  else if (siteWords) out = siteWords(out);
  const result = m[1] + out + m[3];
  if (cache.size > 20000) cache.clear();
  cache.set(key, result);
  return result;
}

/** Outside India the app's own words for tax and money take the country's wording, in every language. */
export function setTerms(region: Region | null, symbol = "") {
  shopRegion = region;
  shopSymbol = symbol;
  buildTerms();
  if (started && ready && terms.length) redraw();
}

function buildTerms() {
  const next: [RegExp, string][] = [];
  sourceTerms = [];
  if (shopRegion && shopRegion.country !== "IN") {
    const { taxIdLabel, taxName, postcodeLabel } = shopRegion;
    sourceTerms.push([/Paytm \/ e-wallet/g, "E-wallet"]);
    next.push([/\bGSTIN\b/g, localTax(taxIdLabel)], [/\bGST\b/g, localTax(taxName)], [/\bPIN code\b/g, postcodeLabel]);
    // Screens that print the country's own wording directly, such as "VAT number" on a bill.
    for (const name of [taxIdLabel, taxName]) if (localTax(name) !== name) next.push([wholeWord(name), localTax(name)]);
    if (shopSymbol) next.push([/₹/g, shopSymbol]);
  }
  terms = next;
  buildSiteWords();
  cache.clear();
}

/** Prices and tax words on the public site follow the country the visitor is in. Sample figures take the local currency sign. */
function buildSiteWords() {
  siteWords = null;
  if (typeof window === "undefined") return;
  const v = visitor();
  if (v.india) return;
  const sign = currencySign(v.currency);
  const taxId = localTax(v.taxIdLabel);
  const tax = localTax(v.taxName);
  siteWords = (text) => text
    .replace(/₹(\d+(?:\.\d+)?)L\b/g, (_, lakh) => `${sign}${Math.round(Number(lakh) * 100)},000`)
    .replace(/₹/g, sign)
    .replace(/\bGSTIN\b/g, taxId)
    .replace(/\bGST\b/g, tax);
}

/** Everything already on the page goes through the words again. */
function redraw() {
  textDone = new WeakMap();
  attrDone = new WeakMap();
  watch();
  refresh(document.documentElement);
}

let textDone = new WeakMap<Text, string>();
let attrDone = new WeakMap<Element, Partial<Record<string, string>>>();
const skipped = (el: Element | null) => !el || SKIP_TAGS.has(el.tagName.toUpperCase()) || Boolean(el.closest("[data-i18n-skip],[translate='no']"));
/** The public site speaks to its visitor, who may have no shop yet. */
const usesShopWords = (el: Element | null) => !el?.closest(".dc-site");

/** A screen that writes {count} piece{count === 1 ? "" : "s"} leaves the English ending in a text node of its own. */
const englishEnding = (node: Text) => language !== "en" && /^(s|es)$/.test(node.data) && node.previousSibling?.nodeType === Node.TEXT_NODE;

function refreshText(node: Text) {
  if (textDone.get(node) === node.data || skipped(node.parentElement)) return;
  const out = englishEnding(node) ? "" : t(node.data, usesShopWords(node.parentElement));
  textDone.set(node, out);
  if (out !== node.data) node.data = out;
}

function refreshAttrs(el: Element) {
  if (skipped(el)) return;
  for (const name of ATTRS) {
    const value = el.getAttribute(name);
    if (!value) continue;
    const done = attrDone.get(el) ?? {};
    if (done[name] === value) continue;
    const out = t(value, usesShopWords(el));
    done[name] = out;
    attrDone.set(el, done);
    if (out !== value) el.setAttribute(name, out);
  }
}

function refresh(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return refreshText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  refreshAttrs(root as Element);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) refreshText(n as Text);
    else refreshAttrs(n as Element);
  }
}

function watch() {
  if (observer) return;
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") refreshText(r.target as Text);
      else if (r.type === "attributes") refreshAttrs(r.target as Element);
      else r.addedNodes.forEach(refresh);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  for (const name of ["alert", "confirm", "prompt"] as const) {
    const original = window[name].bind(window) as (message?: string, ...rest: unknown[]) => never;
    (window as unknown as Record<string, unknown>)[name] = (message?: string, ...rest: unknown[]) => original(typeof message === "string" ? t(message) : message, ...rest);
  }
}

function setDocumentLanguage(code: LanguageCode) {
  const html = document.documentElement;
  html.lang = code === "en" ? "en-IN" : code;
  html.dir = LANGUAGES.find((l) => l.code === code)?.dir ?? "ltr";
}

/** Starts translating this page. The owner's console stays in English, which only Mindware's staff use. */
export async function startI18n() {
  if (typeof window === "undefined") return;
  const html = document.documentElement;
  try {
    if (window.location.pathname.startsWith("/super-admin")) {
      setDocumentLanguage("en");
      return;
    }
    started = true;
    const code = preferred();
    language = code;
    setDocumentLanguage(code);
    if (code !== "en") compile((await LOADERS[code]()).default);
    ready = true;
    buildTerms();
    if (code !== "en" || terms.length || siteWords) redraw();
  } finally {
    html.removeAttribute("data-i18n-pending");
  }
}

/** Someone picks a language for this device. */
export function chooseLanguage(code: LanguageCode) {
  write(CHOICE_KEY, code);
  window.location.reload();
}

/** The shop's language applies on any device where nobody has picked one. */
export function applyShopLanguage(code: LanguageCode) {
  const before = read(SHOP_KEY);
  write(SHOP_KEY, code);
  if (read(CHOICE_KEY) || before === code || preferred() === language) return;
  window.location.reload();
}

/** After the owner changes the shop's language: this device follows it. */
export function followShopLanguage(code: LanguageCode) {
  write(CHOICE_KEY, null);
  write(SHOP_KEY, code);
  window.location.reload();
}
