"use client";
import { cx } from "@/components/ui";

/**
 * Built-in garment illustrations. Every garment type shows one automatically (matched by name, then
 * category) until the shop uploads its own photo. A shop can also pick one explicitly in the catalogue;
 * that choice is rasterised to PNG and stored through the normal garment photo upload.
 */

interface Art {
  key: string;
  label: string;
  /** Lower-case words matched at word starts in the garment name; the longest match wins. */
  keywords: string[];
  body: string;
}

const S = (stroke: string, width = 1.6) => `stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`;

function shirt(fill: string, stroke: string) {
  return `<path d="M22 10 28 8 32 13 36 8 42 10 54 18 50 29 44 26 44 56 20 56 20 26 14 29 10 18Z" fill="${fill}" ${S(stroke)}/>
<path d="M28 8 30 16 32 13 34 16 36 8" fill="#fff" ${S(stroke)}/><path d="M32 16v40" fill="none" ${S(stroke)}/>
${[23, 31, 39, 47].map((y) => `<circle cx="34" cy="${y}" r="1" fill="${stroke}"/>`).join("")}
<path d="M23 24h7v6h-7z" fill="none" ${S(stroke)} opacity=".6"/>`;
}

function tshirt(fill: string, stroke: string) {
  return `<path d="M24 9q8 6 16 0L54 17 49 28 44 25 44 56 20 56 20 25 15 28 10 17Z" fill="${fill}" ${S(stroke)}/>
<path d="M24 9q8 6 16 0" fill="none" ${S(stroke, 2.4)}/>`;
}

function tank(fill: string, stroke: string) {
  return `<path d="M23 8h4q5 10 10 0h4q0 10 5 16V56H18V24q5-6 5-16Z" fill="${fill}" ${S(stroke)}/>`;
}

function trousers(fill: string, stroke: string, extra = "") {
  return `<path d="M20 8h24l3 48H35L32 22l-3 34H17Z" fill="${fill}" ${S(stroke)}/>
<path d="M20 13h24M32 13v9" fill="none" ${S(stroke)}/>${extra}`;
}

function shorts(fill: string, stroke: string) {
  return `<path d="M17 16h30l3 26-15 2-3-16-3 16-15-2Z" fill="${fill}" ${S(stroke)}/>
<path d="M17 21h30M32 21v7" fill="none" ${S(stroke)}/>`;
}

function blazer(fill: string, stroke: string, inner = "#fff", tie = "") {
  return `<path d="M22 9h20l11 7 2 37h-9v3H18v-3H9l2-37Z" fill="${fill}" ${S(stroke)}/>
<path d="M18 22v31M46 22v31" fill="none" ${S(stroke)} opacity=".5"/>
<path d="M26 9l6 20 6-20Z" fill="${inner}" ${S(stroke)}/>${tie}
<path d="M26 9l-3 9 5 2-3 3 7 9M38 9l3 9-5 2 3 3-7 9" fill="none" ${S(stroke)}/>
<circle cx="31" cy="38" r="1.2" fill="${stroke}"/><circle cx="31" cy="45" r="1.2" fill="${stroke}"/>`;
}

function longcoat(fill: string, stroke: string) {
  return `<path d="M23 7h18l11 7 2 34h-7V60H17V48h-7l2-34Z" fill="${fill}" ${S(stroke)}/>
<path d="M27 7l5 15 5-15M27 7l-3 8 4 2-2 3 6 2M37 7l3 8-4 2 2 3-6 2M32 22v38" fill="none" ${S(stroke)}/>
${[28, 36, 44, 52].map((y) => `<circle cx="29" cy="${y}" r="1.1" fill="${stroke}"/><circle cx="35" cy="${y}" r="1.1" fill="${stroke}"/>`).join("")}`;
}

function jacket(fill: string, stroke: string, zip = true) {
  return `<path d="M24 8h16l12 8 3 36h-9V56H18v-4H9l3-36Z" fill="${fill}" ${S(stroke)}/>
<path d="M24 8l2 5h12l2-5" fill="none" ${S(stroke)}/>
<path d="M32 13v43" fill="none" ${S(stroke)} ${zip ? 'stroke-dasharray="2 1.4"' : ""}/>
<path d="M18 50h28M18 24v26M46 24v26" fill="none" ${S(stroke)} opacity=".45"/>
<path d="M21 34h6M37 34h6" fill="none" ${S(stroke)}/>`;
}

function hoodie(fill: string, stroke: string) {
  return `<path d="M24 12q8-10 16 0l12 6 3 34h-9v4H18v-4H9l3-34Z" fill="${fill}" ${S(stroke)}/>
<path d="M25 13q7 9 14 0" fill="none" ${S(stroke)}/><path d="M30 18v8M34 18v8" ${S(stroke)}/>
<path d="M24 40h16l-2 8H26Z" fill="none" ${S(stroke)} opacity=".6"/>`;
}

function sweater(fill: string, stroke: string, sleeves = true) {
  const body = sleeves
    ? `<path d="M24 9q8 5 16 0l12 7 3 36h-8V56H17v-4H9l3-36Z" fill="${fill}" ${S(stroke)}/>`
    : `<path d="M23 8q9 14 18 0l6 10v38H17V18Z" fill="${fill}" ${S(stroke)}/>`;
  return `${body}<path d="M17 51h30" fill="none" ${S(stroke)}/>
${[20, 24, 28, 32, 36, 40, 44].map((x) => `<path d="M${x} 51v5" ${S(stroke)} opacity=".5"/>`).join("")}`;
}

function waistcoat(fill: string, stroke: string) {
  return `<path d="M22 8h5l5 15 5-15h5l5 12v34l-15 4-15-4V20Z" fill="${fill}" ${S(stroke)}/>
${[28, 35, 42].map((y) => `<circle cx="32" cy="${y}" r="1.2" fill="${stroke}"/>`).join("")}
<path d="M21 36h6M37 36h6" fill="none" ${S(stroke)}/>`;
}

function kurta(fill: string, stroke: string, bottom = 58, trim = "") {
  return `<path d="M24 8h16l12 8-4 10-4-3 2 ${bottom - 23}H18l2-${bottom - 23}-4 3-4-10Z" fill="${fill}" ${S(stroke)}/>
<path d="M28 8q4 4 8 0M32 10v14" fill="none" ${S(stroke)}/>
${[14, 18, 22].map((y) => `<circle cx="32" cy="${y}" r=".9" fill="${trim || stroke}"/>`).join("")}`;
}

function kurtaPyjama(fill: string, stroke: string) {
  return `<path d="M24 44h16l1 16h-7l-2-12-2 12h-7Z" fill="#f3efe6" ${S("#a39a86")}/>${kurta(fill, stroke, 46)}`;
}

function sherwani(fill: string, stroke: string, gold = "#e2b84a") {
  return `<path d="M24 9h16l12 7-4 11-4-3 3 36H17l3-36-4 3-4-11Z" fill="${fill}" ${S(stroke)}/>
<path d="M27 6h10v4H27Z" fill="${fill}" ${S(stroke)}/><path d="M32 10v50" fill="none" ${S(stroke)}/>
${[14, 20, 26, 32, 38].map((y) => `<circle cx="32" cy="${y}" r="1.3" fill="${gold}"/>`).join("")}
<path d="M18 56h28" stroke="${gold}" stroke-width="2"/>`;
}

function dhoti(fill: string, stroke: string) {
  return `<path d="M17 10h30l4 46H36l-4-20-4 20H13Z" fill="${fill}" ${S(stroke)}/>
<path d="M17 15h30M26 15q2 18 0 30M38 15q-2 18 0 30M32 15v15" fill="none" ${S(stroke)} opacity=".55"/>
<path d="M13 54h15M36 54h15" stroke="#d9a441" stroke-width="2"/>`;
}

function saree(fill: string, stroke: string, border: string) {
  return `<path d="M24 8h16l5 22 6 28H13l6-28Z" fill="${fill}" ${S(stroke)}/>
<path d="M40 8 19 30 13 58h8l6-26 18-24Z" fill="${border}" opacity=".85" ${S(stroke)}/>
<path d="M13 55h38" stroke="${border}" stroke-width="3"/>
${[[30, 40], [38, 46], [26, 50], [44, 38]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2" fill="${border}"/>`).join("")}`;
}

function lehenga(fill: string, stroke: string, gold = "#e8be4f") {
  return `<path d="M24 6h16l4 6-4 6H24l-4-6Z" fill="${fill}" ${S(stroke)}/>
<path d="M23 22h18l14 36H9Z" fill="${fill}" ${S(stroke)}/><path d="M23 22h18" stroke="${gold}" stroke-width="3"/>
<path d="M9 55h46" stroke="${gold}" stroke-width="3.5"/><path d="M28 24l-6 30M36 24l6 30M32 24v30" fill="none" ${S(stroke)} opacity=".4"/>`;
}

function dress(fill: string, stroke: string, long = false) {
  const hem = long ? 60 : 54;
  return `<path d="M25 7h4q3 4 6 0h4l1 10-4 9 13 ${hem - 26}H15l13-${hem - 26}-4-9Z" fill="${fill}" ${S(stroke)}/>
<path d="M24 26h16" stroke="${stroke}" stroke-width="2"/><path d="M28 28l-5 ${hem - 30}M36 28l5 ${hem - 30}" fill="none" ${S(stroke)} opacity=".4"/>`;
}

function skirt(fill: string, stroke: string) {
  return `<path d="M22 12h20l10 40H12Z" fill="${fill}" ${S(stroke)}/><path d="M22 17h20" ${S(stroke)}/>
<path d="M27 17l-5 35M37 17l5 35M32 17v35" fill="none" ${S(stroke)} opacity=".4"/>`;
}

function blouse(fill: string, stroke: string) {
  return `<path d="M24 12q8 8 16 0l11 6-3 9-5-2 1 21H20l1-21-5 2-3-9Z" fill="${fill}" ${S(stroke)}/>
<path d="M20 40q12 4 24 0" fill="none" ${S(stroke)} opacity=".5"/>`;
}

function shawl(fill: string, stroke: string, pattern: string) {
  return `<path d="M18 8h28v40H18Z" fill="${fill}" ${S(stroke)}/>
<path d="M18 8q14 8 28 0" fill="none" ${S(stroke)}/><path d="M18 14h28M18 42h28" stroke="${pattern}" stroke-width="2"/>
${[22, 26, 30, 34, 38, 42].map((x) => `<path d="M${x} 48v8" ${S(stroke)}/>`).join("")}
<path d="M26 24l6 6 6-6-6-6Z" fill="${pattern}" opacity=".8"/>`;
}

function tie(fill: string, stroke: string) {
  return `<path d="M28 6h8l-1 6 5 38-8 8-8-8 5-38Z" fill="${fill}" ${S(stroke)}/><path d="M29 12h6" ${S(stroke)}/>
<path d="M30 22l6 6M29 32l7 7M29 42l5 5" stroke="#fff" stroke-width="1.4" opacity=".55"/>`;
}

function shoe(fill: string, stroke: string, sneaker = false) {
  return `<path d="M8 40V24h12q4 8 14 9l16 4q6 2 6 9v4H8Z" fill="${fill}" ${S(stroke)}/>
<path d="M8 46h48" stroke="${sneaker ? "#fff" : stroke}" stroke-width="${sneaker ? 3 : 2}"/>
${sneaker ? `<path d="M22 30l4-2M26 33l4-2M30 35l4-2" ${S("#fff")}/>` : `<path d="M20 24q6 4 10 8" fill="none" ${S(stroke)} opacity=".5"/>`}`;
}

function blanket(fill: string, stroke: string, check: string) {
  return `<path d="M10 22h44v14H10Z" fill="${fill}" ${S(stroke)}/><path d="M12 36h40v8H12Z" fill="${fill}" ${S(stroke)}/>
<path d="M14 44h36v8H14Z" fill="${fill}" ${S(stroke)}/>
${[18, 26, 34, 42, 50].map((x) => `<path d="M${x} 22v30" stroke="${check}" stroke-width="1.6" opacity=".7"/>`).join("")}
<path d="M10 29h44M12 40h40M14 48h36" stroke="${check}" stroke-width="1.6" opacity=".7"/>`;
}

function bedsheet(fill: string, stroke: string, pattern: string) {
  return `<path d="M10 24h44v10H10ZM10 34h44v10H10ZM10 44h44v10H10Z" fill="${fill}" ${S(stroke)}/>
${[[18, 29], [32, 29], [46, 29], [25, 39], [39, 39], [18, 49], [32, 49], [46, 49]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="${pattern}"/>`).join("")}`;
}

function curtain(fill: string, stroke: string) {
  return `<path d="M8 8h48" stroke="#8a6f45" stroke-width="3"/>
<path d="M12 10h16q-2 24 4 48H12Z" fill="${fill}" ${S(stroke)}/><path d="M52 10H36q2 24-4 48h20Z" fill="${fill}" ${S(stroke)}/>
<path d="M17 10v48M22 10v48M42 10v48M47 10v48" stroke="${stroke}" stroke-width="1.2" opacity=".4"/>`;
}

function pillow(fill: string, stroke: string) {
  return `<path d="M12 18q20-6 40 0 4 14 0 28-20 6-40 0-4-14 0-28Z" fill="${fill}" ${S(stroke)}/>
<path d="M18 24q14-4 28 0M18 40q14 4 28 0" fill="none" ${S(stroke)} opacity=".4"/>`;
}

function towel(fill: string, stroke: string) {
  return `<path d="M12 20h40v12H12ZM14 32h36v12H14Z" fill="${fill}" ${S(stroke)}/>
<path d="M12 27h40M14 39h36" stroke="#fff" stroke-width="2"/>
<path d="M16 44h32v8H16Z" fill="${fill}" ${S(stroke)}/>`;
}

function robe(fill: string, stroke: string) {
  return `<path d="M24 7h16l12 8 2 18-6 1-1 24H19l-1-24-6-1 2-18Z" fill="${fill}" ${S(stroke)}/>
<path d="M24 7l8 20 8-20M32 27l-6 31" fill="none" ${S(stroke)}/><path d="M18 34h28" stroke="#fff" stroke-width="2.4"/>`;
}

function carpet(fill: string, stroke: string, pattern: string) {
  return `<path d="M12 14h40v36H12Z" fill="${fill}" ${S(stroke)}/><path d="M17 19h30v26H17Z" fill="none" stroke="${pattern}" stroke-width="2"/>
<path d="M32 23l8 9-8 9-8-9Z" fill="${pattern}"/>
${[14, 18, 22, 26, 30, 34, 38, 42, 46, 50].map((x) => `<path d="M${x} 50v5M${x} 9v5" ${S(stroke)}/>`).join("")}`;
}

function sofa(fill: string, stroke: string) {
  return `<path d="M14 18h36v16H14Z" fill="${fill}" ${S(stroke)}/><path d="M8 26h8v20H8ZM48 26h8v20h-8Z" fill="${fill}" ${S(stroke)}/>
<path d="M16 34h32v12H16Z" fill="${fill}" ${S(stroke)}/><path d="M32 34v12M10 46v6M54 46v6" ${S(stroke)}/>`;
}

function bag(fill: string, stroke: string) {
  return `<path d="M24 22q0-12 8-12t8 12" fill="none" ${S(stroke, 2.4)}/>
<path d="M12 22h40l-3 32H15Z" fill="${fill}" ${S(stroke)}/><path d="M12 30h40" ${S(stroke)} opacity=".5"/>
<rect x="29" y="28" width="6" height="5" rx="1" fill="#e2b84a"/>`;
}

function cap(fill: string, stroke: string) {
  return `<path d="M14 40q0-24 18-24t18 24Z" fill="${fill}" ${S(stroke)}/><path d="M14 40h40q-2 6-14 6H14Z" fill="${fill}" ${S(stroke)}/>
<circle cx="32" cy="16" r="2" fill="${stroke}"/><path d="M32 18v22" ${S(stroke)} opacity=".4"/>`;
}

function socks(fill: string, stroke: string) {
  return `<path d="M18 8h12v26l8 10q2 6-4 8l-14-12q-2-2-2-6Z" fill="${fill}" ${S(stroke)}/>
<path d="M32 12h12v24l6 9q1 6-5 7L34 42" fill="${fill}" opacity=".8" ${S(stroke)}/><path d="M18 13h12M32 17h12" stroke="#fff" stroke-width="2"/>`;
}

function underwear(fill: string, stroke: string) {
  return `<path d="M12 20h40l-4 12q-8 4-12 14h-8q-4-10-12-14Z" fill="${fill}" ${S(stroke)}/><path d="M12 24h40" stroke="#fff" stroke-width="2" opacity=".6"/>`;
}

function gloves(fill: string, stroke: string) {
  return `<path d="M22 54V30l-6-8q-1-3 2-3l6 5V12q0-3 3-3t3 3v-2q0-3 3-3t3 3v2q0-3 3-3t3 3v4q0-3 3-3t3 3v26l-6 14Z" fill="${fill}" ${S(stroke)}/>
<path d="M22 46h20" stroke="#fff" stroke-width="2" opacity=".6"/>`;
}

function teddy(fill: string, stroke: string) {
  return `<circle cx="20" cy="14" r="6" fill="${fill}" ${S(stroke)}/><circle cx="44" cy="14" r="6" fill="${fill}" ${S(stroke)}/>
<circle cx="32" cy="22" r="12" fill="${fill}" ${S(stroke)}/><ellipse cx="32" cy="46" rx="14" ry="13" fill="${fill}" ${S(stroke)}/>
<circle cx="27" cy="20" r="1.5" fill="${stroke}"/><circle cx="37" cy="20" r="1.5" fill="${stroke}"/><ellipse cx="32" cy="27" rx="4" ry="3" fill="#f3dcc0"/>`;
}

function frock(fill: string, stroke: string) {
  return `<path d="M26 10h12l2 10-2 4 12 26H14l12-26-2-4Z" fill="${fill}" ${S(stroke)}/>
<path d="M26 24h12" stroke="#fff" stroke-width="2.4"/><path d="M14 50q6-4 12 0t12 0 12 0" fill="none" stroke="#fff" stroke-width="1.6"/>`;
}

function romper(fill: string, stroke: string) {
  return `<path d="M24 10h4q4 5 8 0h4l8 8-4 6-4-2v18l-4 12h-6l-2-8-2 8h-6l-4-12V22l-4 2-4-6Z" fill="${fill}" ${S(stroke)}/>
<circle cx="32" cy="22" r="1.2" fill="${stroke}"/><circle cx="32" cy="28" r="1.2" fill="${stroke}"/>`;
}

function belt(fill: string, stroke: string) {
  return `<path d="M6 28h52v8H6Z" fill="${fill}" ${S(stroke)}/><rect x="40" y="25" width="12" height="14" rx="2" fill="#e2b84a" ${S("#8a6a1a")}/>
<path d="M46 28v8" ${S("#8a6a1a")}/>${[14, 20, 26, 32].map((x) => `<circle cx="${x}" cy="32" r="1.1" fill="${stroke}"/>`).join("")}`;
}

function handkerchief(fill: string, stroke: string) {
  return `<path d="M14 14h36v36H14Z" fill="${fill}" ${S(stroke)}/><path d="M18 18h28v28H18Z" fill="none" stroke="${stroke}" stroke-width="1" stroke-dasharray="2 2"/>
<path d="M14 14l36 36" stroke="${stroke}" stroke-width="1" opacity=".3"/><path d="M44 40l4 8-8-4Z" fill="${stroke}" opacity=".5"/>`;
}

function apron(fill: string, stroke: string) {
  return `<path d="M24 8h16v10l8 2-2 38H18l-2-38 8-2Z" fill="${fill}" ${S(stroke)}/>
<path d="M24 8q-6-2-8 4M40 8q6-2 8 4" fill="none" ${S(stroke)}/><path d="M16 26q-6 0-8 4M48 26q6 0 8 4" fill="none" ${S(stroke)}/>
<path d="M24 36h16v10H24Z" fill="none" ${S(stroke)} opacity=".7"/>`;
}

function repair(stroke: string) {
  return `<path d="M14 50 46 18" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/><ellipse cx="47.5" cy="16.5" rx="2.6" ry="1.4" transform="rotate(-45 47.5 16.5)" fill="#fff" stroke="#64748b" stroke-width="1.2"/>
<path d="M48 16q8 6 0 14t-16 10-12 8" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>
<circle cx="20" cy="22" r="7" fill="#fde68a" stroke="#a16207" stroke-width="1.6"/><path d="M15 22h10M20 17v10" stroke="#a16207" stroke-width="1" opacity=".6"/>`;
}

function hanger(stroke: string) {
  return `<path d="M32 22v-4q4-1 4-5t-4-4-4 3" fill="none" ${S(stroke, 2.2)}/>
<path d="M32 22 8 40q-2 3 2 4h44q4-1 2-4Z" fill="#eef2f7" ${S(stroke, 2.2)}/>`;
}

const ART: Art[] = [
  { key: "shirt", label: "Shirt", keywords: ["workwear", "chef coat", "lab coat", "shirt", "formal shirt", "uniform", "safari shirt"], body: shirt("#8fb3e0", "#3d5f8f") },
  { key: "tshirt", label: "T-shirt", keywords: ["t shirt", "tshirt", "tee", "polo", "jersey"], body: tshirt("#22c3e6", "#0e7490") },
  { key: "undershirt", label: "Undershirt", keywords: ["undershirt", "vest", "banian", "baniyan", "tank", "camisole", "inner"], body: tank("#38bdf8", "#0369a1") },
  { key: "trousers", label: "Trousers", keywords: ["trouser", "pant", "suit pant", "safari pant", "formal pant", "chino", "capri", "slack"], body: trousers("#d9c3a0", "#8a6f45") },
  { key: "jeans", label: "Jeans", keywords: ["jean", "denim"], body: trousers("#4f74b3", "#24406f", `<path d="M22 18q3 4 7 2M42 18q-3 4-7 2" fill="none" stroke="#e8b44a" stroke-width="1.2"/>`) },
  { key: "trackpant", label: "Track pant", keywords: ["track pant", "trackpant", "sweat pant", "jogger", "lower", "legging", "salwar", "palazzo"], body: trousers("#1f2a44", "#0b1222", `<path d="M19 15l-2 40M45 15l2 40" stroke="#fff" stroke-width="1.6"/>`) },
  { key: "pyjama", label: "Pyjama", keywords: ["nightwear", "nightwear set", "pyjama", "pajama", "night suit", "churidar"], body: trousers("#f3efe6", "#a39a86", `<path d="M30 13l-2 5M34 13l2 5" stroke="#a39a86" stroke-width="1.2"/>`) },
  { key: "shorts", label: "Shorts", keywords: ["short", "bermuda", "swim", "half pant", "boxer"], body: shorts("#7cc0ea", "#2b6f9c") },
  { key: "blazer", label: "Blazer", keywords: ["blazer", "coat", "sports jacket", "safari", "jodhpuri", "bandhgala", "nehru jacket"], body: blazer("#24345e", "#101a33") },
  { key: "suit", label: "Suit", keywords: ["suit", "2 pc", "3 pc", "tuxedo", "tux"], body: blazer("#2f3036", "#111114", "#fff", `<path d="M32 13l-2 3 2 12 2-12Z" fill="#c0392b"/>`) },
  { key: "overcoat", label: "Overcoat", keywords: ["women s coat", "fur garment", "fur", "leather coat", "overcoat", "over coat", "long coat", "longcoat", "trench", "raincoat", "rain coat"], body: longcoat("#c08a4f", "#7a5228") },
  { key: "jacket", label: "Jacket", keywords: ["jacket", "jacket full", "windcheater", "bomber", "puffer"], body: jacket("#4aa39a", "#22625b") },
  { key: "leather", label: "Leather jacket", keywords: ["leather"], body: jacket("#4a3328", "#21140e") },
  { key: "waistcoat", label: "Waistcoat", keywords: ["waistcoat", "waist coat", "jacket half", "half jacket", "modi jacket"], body: waistcoat("#1e2b55", "#0c1430") },
  { key: "hoodie", label: "Hoodie", keywords: ["hood", "hoodie"], body: hoodie("#2d2d33", "#0f0f12") },
  { key: "sweatshirt", label: "Sweatshirt", keywords: ["sweat shirt", "sweatshirt"], body: sweater("#dc3b3b", "#8b1c1c") },
  { key: "sweater", label: "Sweater", keywords: ["sweater", "pullover", "cardigan", "woollen", "woolen", "jumper"], body: sweater("#4f8a4a", "#2a5427") },
  { key: "sweatervest", label: "Sweater (half)", keywords: ["sweater half", "half sweater", "sleeveless sweater"], body: sweater("#8a5a34", "#4f3018", false) },
  { key: "tracksuit", label: "Track suit", keywords: ["track suit", "tracksuit", "track jacket"], body: jacket("#d62f2f", "#7d1414") },
  { key: "kurta", label: "Kurta", keywords: ["patiala", "embroidered suit", "ethnic wear", "kids ethnic", "zari", "velvet ethnic", "kurta", "kurti", "pathani", "tunic", "kameez", "salwar kameez", "salwar suit"], body: kurta("#8b2f3a", "#4c1018") },
  { key: "kurtapyjama", label: "Kurta pyjama", keywords: ["kurta pyjama", "kurta pajama", "pathani suit", "kurta set"], body: kurtaPyjama("#e8d2a8", "#9a7d48") },
  { key: "sherwani", label: "Sherwani", keywords: ["sherwani", "indo western"], body: sherwani("#1f5c45", "#0d3326") },
  { key: "achkan", label: "Achkan", keywords: ["achkan", "angarkha"], body: sherwani("#7a1f2b", "#3e0b12") },
  { key: "dhoti", label: "Dhoti", keywords: ["dhoti", "lungi", "veshti", "mundu"], body: dhoti("#fbf8ef", "#a39a86") },
  { key: "saree", label: "Saree", keywords: ["bridal saree", "designer saree", "saree", "sari"], body: saree("#d4477d", "#7d1d44", "#e8be4f") },
  { key: "silksaree", label: "Silk saree", keywords: ["silk saree", "heavy saree", "banarasi", "kanjeevaram", "kanjivaram", "saree silk", "silk heavy"], body: saree("#7b3fa0", "#3e1857", "#f0c75a") },
  { key: "lehenga", label: "Lehenga", keywords: ["lehenga", "lehnga", "ghagra", "chaniya"], body: lehenga("#c8303e", "#6e121b") },
  { key: "dress", label: "Dress", keywords: ["dress", "one piece", "anarkali"], body: dress("#e0679a", "#8c2552") },
  { key: "gown", label: "Gown", keywords: ["sequined", "beaded", "embellished", "heavily embellished", "delicate silk", "designer dress", "gown", "wedding dress", "evening dress", "bridal"], body: dress("#9b7fd1", "#4e3687", true) },
  { key: "skirt", label: "Skirt", keywords: ["petticoat", "skirt"], body: skirt("#f59e0b", "#92400e") },
  { key: "blouse", label: "Top / blouse", keywords: ["shrug", "silk blouse", "blouse", "top", "choli", "crop"], body: blouse("#f472b6", "#9d174d") },
  { key: "frock", label: "Frock", keywords: ["frock", "kids dress", "baby dress", "girl"], body: frock("#facc15", "#a16207") },
  { key: "romper", label: "Kids romper", keywords: ["romper", "baby", "kid", "child", "infant", "school uniform"], body: romper("#60a5fa", "#1d4ed8") },
  { key: "shawl", label: "Shawl / stole", keywords: ["fabric accessory", "shawl", "stole", "dupatta", "scarf", "muffler", "pashmina", "chunni"], body: shawl("#8a4b2a", "#4a2310", "#e8be4f") },
  { key: "tie", label: "Tie", keywords: ["tie", "necktie", "bow"], body: tie("#1e3a8a", "#0b1a4a") },
  { key: "cap", label: "Cap / hat", keywords: ["cap", "hat", "turban", "pagdi", "safa", "topi"], body: cap("#ef4444", "#7f1d1d") },
  { key: "shoe", label: "Shoes", keywords: ["leather shoe", "suede shoe", "sports shoe", "shoe", "boot", "loafer", "footwear", "sandal", "heel"], body: shoe("#5b3a24", "#2b1a0e") },
  { key: "sneaker", label: "Sneakers", keywords: ["sneaker", "sport shoe", "canvas shoe", "running shoe", "trainer"], body: shoe("#3b82f6", "#1e3a8a", true) },
  { key: "bag", label: "Bag", keywords: ["leather handbag", "leather purse", "leather wallet", "wallet", "school bag", "fabric bag", "bag", "purse", "handbag", "backpack", "clutch"], body: bag("#b45309", "#5c2a04") },
  { key: "socks", label: "Socks", keywords: ["sock", "stocking"], body: socks("#64748b", "#1e293b") },
  { key: "underwear", label: "Underwear", keywords: ["underwear", "brief", "innerwear", "panty", "lingerie"], body: underwear("#1f2937", "#030712") },
  { key: "gloves", label: "Gloves", keywords: ["leather glove", "glove", "mitten"], body: gloves("#a16207", "#4d2c03") },
  { key: "blanket", label: "Blanket", keywords: ["bedding", "baby bedding", "mattress topper", "blanket", "quilt", "razai", "rajai", "comforter", "duvet", "dohar", "rug blanket"], body: blanket("#60a5fa", "#1e40af", "#1e3a8a") },
  { key: "bedsheet", label: "Bedsheet", keywords: ["mattress protector", "textile", "antique textile", "decorative fabric", "bedsheet", "bed sheet", "bed cover", "bedcover", "sheet", "linen", "table cloth", "tablecloth"], body: bedsheet("#f1f5f9", "#64748b", "#38bdf8") },
  { key: "curtain", label: "Curtain", keywords: ["curtain", "drape", "blind", "parda"], body: curtain("#a78bfa", "#5b21b6") },
  { key: "pillow", label: "Pillow / cushion", keywords: ["pillow", "cushion"], body: pillow("#fde68a", "#a16207") },
  { key: "towel", label: "Towel", keywords: ["towel", "napkin", "hand towel"], body: towel("#34d399", "#047857") },
  { key: "robe", label: "Bath robe", keywords: ["hospital gown", "hotel bathrobe", "robe", "bathrobe", "bath robe", "night gown", "nightgown", "kaftan"], body: robe("#93c5fd", "#1d4ed8") },
  { key: "carpet", label: "Carpet / rug", keywords: ["carpet", "rug", "mat", "dari", "durrie"], body: carpet("#b91c1c", "#5f0f0f", "#fcd34d") },
  { key: "sofa", label: "Sofa cover", keywords: ["sofa", "seat cover", "chair cover", "couch"], body: sofa("#78716c", "#292524") },
  { key: "teddy", label: "Soft toy", keywords: ["stuffed animal", "stuffed", "teddy", "soft toy", "toy", "plush"], body: teddy("#c08a4f", "#6b4423") },
  { key: "belt", label: "Belt", keywords: ["belt", "leather belt"], body: belt("#5b3a24", "#2b1a0e") },
  { key: "handkerchief", label: "Handkerchief", keywords: ["handkerchief", "hanky", "kerchief"], body: handkerchief("#f8fafc", "#64748b") },
  { key: "apron", label: "Apron", keywords: ["apron", "chef apron"], body: apron("#e2e8f0", "#475569") },
  { key: "repair", label: "Repair / alteration", keywords: ["raffu", "darning", "alteration", "stitching", "button", "zip", "dyeing", "colouring", "restoration", "repair", "stain treatment"], body: repair("#dc2626") },
  { key: "hanger", label: "Other garment", keywords: [], body: hanger("#64748b") },
];

const BY_KEY = new Map(ART.map((a) => [a.key, a]));

/** Category names used when the garment name itself does not match anything. */
const CATEGORY_FALLBACK: [string, string][] = [
  ["shoe", "shoe"], ["footwear", "shoe"], ["household", "bedsheet"], ["home", "bedsheet"], ["kid", "romper"],
  ["women", "dress"], ["ladies", "dress"], ["ethnic", "kurta"], ["men", "shirt"], ["formal", "shirt"],
];

function normalise(text: string) {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

export function matchGarmentArt(name: string, category?: string): string {
  const n = normalise(name);
  let best = "";
  let bestLength = 0;
  for (const art of ART) {
    for (const k of art.keywords) {
      if (k.length > bestLength && n.includes(` ${k}`)) {
        best = art.key;
        bestLength = k.length;
      }
    }
  }
  if (best) return best;
  const c = normalise(category ?? "");
  return CATEGORY_FALLBACK.find(([word]) => c.includes(` ${word}`))?.[1] ?? "hanger";
}

export const GARMENT_ART_OPTIONS = ART.map(({ key, label }) => ({ key, label }));

function svgMarkup(key: string) {
  const art = BY_KEY.get(key) ?? BY_KEY.get("hanger")!;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${art.body}</svg>`;
}

const urlCache = new Map<string, string>();
export function garmentArtUrl(key: string) {
  let url = urlCache.get(key);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup(key))}`;
    urlCache.set(key, url);
  }
  return url;
}

/** Rasterises an illustration to a base64 PNG so it can be saved through the garment photo upload. */
export function garmentArtPng(key: string, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Could not prepare the picture."));
      ctx.drawImage(img, 0, 0, size, size);
      const data = canvas.toDataURL("image/png");
      resolve(data.slice(data.indexOf(",") + 1));
    };
    img.onerror = () => reject(new Error("Could not prepare the picture."));
    img.src = garmentArtUrl(key);
  });
}

/** Garment picture: the shop's uploaded photo when present, otherwise the matching built-in illustration. */
export function GarmentThumb({ garment, className }: { garment: { id: string; name: string; category?: string; hasImage?: boolean }; className?: string }) {
  const src = garment.hasImage ? `/api/v1/garment-types/${garment.id}/image` : garmentArtUrl(matchGarmentArt(garment.name, garment.category));
  return <img src={src} alt="" draggable={false} className={cx("h-full w-full object-contain", !garment.hasImage && "dc-garment-art", className)} />;
}
