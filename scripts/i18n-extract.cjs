// Lists the English text on screens and in server messages, for translation.
// Writes apps/web/src/i18n/_keys.json and reports how much of each language is still missing.
// Usage: pnpm i18n:extract
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const tsPath = fs.readdirSync(path.join(ROOT, "node_modules/.pnpm")).filter((d) => d.startsWith("typescript@")).pop();
const ts = require(path.join(ROOT, "node_modules/.pnpm", tsPath, "node_modules/typescript"));

const SOURCES = ["apps/web/src", "packages/shared/src", "apps/api/src/modules", "apps/api/src/lib"];
// The owner's console and invoices to shops stay in English; legal text needs a lawyer's translation.
const SKIP = /(super-admin|\.test\.|SubscriptionInvoice|\/i18n|lib\/(mailer|license|razorpay|machineControl|backup|productionChecks|commercialInvoice)|modules\/platform|marketing\/(Legal|Privacy|Terms)|countries\.ts)/;
const API = /apps[\\/]api/;
const MARKETING = /components\/marketing\//;
const ERROR_CALL = /^(badRequest|unprocessable|conflict|forbidden|notFound|unauthorized|AppError)$/;
const TEXT_ATTR = new Set(["label", "placeholder", "title", "hint", "aria-label", "alt", "description", "subtitle", "heading", "text", "emptyText", "confirmText", "sub", "def"]);
const TEXT_PROP = new Set(["label", "title", "description", "hint", "placeholder", "heading", "text", "subtitle", "message", "note", "desc", "sub", "def", "name", "body", "q", "a", "group", "error", "detail", "tip", "summary", "help"]);
const TEXT_CALL = /(toast|setError|setErr|setMsg|setMessage|setNotice|confirm|alert|prompt|Error|flash|setFlash|note|setOk|setDone|setStatus)$/i;

const isWords = (s) =>
  /\p{L}{2}/u.test(s) && !/^(https?:|\/|#|\.|@)/.test(s) && !/^[a-z0-9_\-./:]+$/.test(s) &&
  !/^[A-Z0-9_]+$/.test(s) && !/^[a-z-]+(:[a-z-]+)?(\s+[!a-z0-9:\[\]\-/.%#()_,]+)+$/.test(s) && !/\b(select\s.+\sfrom\s|insert into\s|delete from\s|update\s+\w+\s+set\s)/i.test(s) && !/^[a-z]+\.[a-z_.]+/.test(s);
const ENTITIES = { apos: "'", quot: '"', amp: "&", lt: "<", gt: ">", nbsp: " ", rarr: "→", larr: "←", middot: "·", mdash: "—", ndash: "–", times: "×", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };
/** JSX source holds &apos; where the screen shows an apostrophe. */
const decode = (s) => s.replace(/&(#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(Number(e.slice(1))) : ENTITIES[e] ?? m));
const clean = (s) => decode(s).replace(/\s+/g, " ").trim();

const keys = new Set();
const add = (s) => {
  s = clean(s);
  if (s && isWords(s) && s.length < 900) keys.add(s);
};
/** `${n} garments for ${name}` becomes "{0} garments for {1}". Words inside the slots are collected on their own. */
function template(node) {
  let text = node.head.text;
  node.templateSpans.forEach((span, i) => {
    text += `{${i}}` + span.literal.text;
  });
  const letters = text.replace(/\{\d+\}/g, "");
  if ((letters.match(/\p{L}/gu) || []).length >= 3) add(text);
}
function takeValue(n) {
  if (ts.isStringLiteralLike(n)) add(n.text);
  else if (ts.isTemplateExpression(n)) template(n);
  else if (ts.isConditionalExpression(n)) { takeValue(n.whenTrue); takeValue(n.whenFalse); }
  else if (ts.isParenthesizedExpression(n)) takeValue(n.expression);
  else if (ts.isBinaryExpression(n) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind)) { takeValue(n.left); takeValue(n.right); }
}
const looksLikeLabel = (s) => /^[A-Z¿]/.test(s);
/** Wording known to appear on screen, even all in small letters like "garments in store". */
const NOT_WORDS = /\d(px|vw|%)|clamp\(|minmax\(|repeat\(|translate[XY]?\(|rgba?\(|path\(|#[0-9a-f]{3,6}\b|sans-serif|^\S+ auto$|^https?:|^[A-Z0-9]+$/;
const shown = (raw) => { const s = clean(raw); if (/\p{L}{2}/u.test(s) && s.length < 900 && (!NOT_WORDS.test(s) || /\p{L}{3}.*\s\p{L}{3}/u.test(s.replace(NOT_WORDS, "")) )) keys.add(s); };

function scan(file) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const api = API.test(file);
  const visit = (n) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isTaggedTemplateExpression(n)) return; // SQL
    // Text between JSX tags is always shown on screen, even all in small letters like "garments in store".
    if (ts.isJsxText(n)) shown(n.text);
    // label = "Custom Pricing"; billing = `Billed ${amount} upfront`
    else if (!api && ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && (ts.isStringLiteralLike(n.right) || ts.isTemplateExpression(n.right)) && /^[A-Z/]/.test(ts.isTemplateExpression(n.right) ? n.right.head.text : n.right.text)) takeValue(n.right);
    // function FinalCta({ title = "See Drycare Working in Your Store" })
    else if (ts.isBindingElement(n) && n.initializer && ts.isStringLiteralLike(n.initializer) && n.initializer.text.includes(" ")) shown(n.initializer.text);
    // The sample figures in the public site's illustrations: { value: "310 garments", pill: "6 due today" }
    else if (MARKETING.test(file.replace(/\\/g, "/")) && ts.isPropertyAssignment(n) && ts.isStringLiteralLike(n.initializer) && /\p{L}{2}/u.test(n.initializer.text) && !/^(https?:|\/|#|\.)/.test(n.initializer.text) && n.initializer.text.includes(" ") && !/^[a-z-]+(:[a-z-]+)?( [a-z0-9:\[\]\-/.%#()_,!]+)+$/.test(n.initializer.text.replace(/\d+ (due|garments|pickups|pieces|scheduled|completed)/g, ""))) shown(n.initializer.text);
    else if (ts.isJsxExpression(n) && n.expression && !(n.parent && ts.isJsxAttribute(n.parent) && !TEXT_ATTR.has(n.parent.name.getText()))) takeValue(n.expression);
    else if (ts.isJsxAttribute(n) && TEXT_ATTR.has(n.name.getText()) && n.initializer) { if (ts.isStringLiteral(n.initializer)) shown(n.initializer.text); }
    else if (ts.isCallExpression(n)) {
      const name = n.expression.getText();
      if (api ? ERROR_CALL.test(name) : TEXT_CALL.test(name)) n.arguments.slice(0, 1).forEach(takeValue);
      if (name.endsWith(".refine") || name.endsWith(".regex")) n.arguments.slice(1).forEach(takeValue);
      if (/\.(min|max|length|email|uuid)$/.test(name)) n.arguments.forEach((a) => { if (ts.isStringLiteralLike(a)) add(a.text); });
    } else if (ts.isNewExpression(n) && /Error$/.test(n.expression.getText()) && n.arguments?.[0]) takeValue(n.arguments[0]);
    else if (!api && ts.isPropertyAssignment(n) && TEXT_PROP.has(n.name.getText())) takeValue(n.initializer);
    else if (!api && ts.isArrayLiteralExpression(n)) n.elements.forEach((e) => { if (ts.isStringLiteralLike(e) && looksLikeLabel(e.text)) add(e.text); });
    else if (!api && ts.isConditionalExpression(n)) { for (const b of [n.whenTrue, n.whenFalse]) if (ts.isStringLiteralLike(b) && looksLikeLabel(b.text)) add(b.text); else if (ts.isTemplateExpression(b)) template(b); }
    else if (!api && ts.isVariableDeclaration(n) && n.initializer && ts.isStringLiteralLike(n.initializer) && looksLikeLabel(n.initializer.text) && n.initializer.text.includes(" ")) add(n.initializer.text);
    // Lookup tables: { cash: "Cash", bank_transfer: "Bank transfer" }
    else if (!api && ts.isPropertyAssignment(n) && ts.isStringLiteralLike(n.initializer) && looksLikeLabel(n.initializer.text)) add(n.initializer.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
for (const dir of SOURCES) for (const f of walk(path.join(ROOT, dir))) if (!SKIP.test(f.replace(/\\/g, "/"))) scan(f);
// Reports, garments and services come as data from the server.
for (const f of ["apps/api/src/modules/reportsCenter.ts", "apps/api/src/lib/standardCatalogue.ts", "apps/api/src/modules/platformConsole.ts"]) {
  const sf = ts.createSourceFile(f, fs.readFileSync(path.join(ROOT, f), "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (n) => {
    if (ts.isTaggedTemplateExpression(n)) return;
    if (ts.isPropertyAssignment(n) && ["title", "description", "label", "group", "name", "category"].includes(n.name.getText()) && ts.isStringLiteralLike(n.initializer)) add(n.initializer.text);
    if (ts.isCallExpression(n)) n.arguments.forEach((a) => { if (ts.isStringLiteralLike(a) && looksLikeLabel(a.text)) add(a.text); });
    // Rows of the garment list: ["Formal Trousers", "Men", 100, 50, 20, 60]
    if (ts.isArrayLiteralExpression(n)) n.elements.forEach((e) => { if (ts.isStringLiteralLike(e) && looksLikeLabel(e.text)) add(e.text); });
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

for (const k of JSON.parse(fs.readFileSync(path.join(ROOT, "apps/web/src/i18n/_extra.json"), "utf8"))) keys.add(k);

// Indian state names are shown as they are.
const INDIAN_STATES = /^(Andhra Pradesh|Arunachal Pradesh|Assam|Bihar|Chhattisgarh|Goa|Gujarat|Haryana|Himachal Pradesh|Jharkhand|Karnataka|Kerala|Madhya Pradesh|Maharashtra|Manipur|Meghalaya|Mizoram|Nagaland|Odisha|Punjab|Rajasthan|Sikkim|Tamil Nadu|Telangana|Tripura|Uttar Pradesh|Uttarakhand|West Bengal|Delhi|Chandigarh|Puducherry|Ladakh|Jammu (and|&) Kashmir|Lakshadweep|Andaman (and|&) Nicobar Islands|Dadra (and|&) Nagar Haveli.*)$/;
const out = path.join(ROOT, "apps/web/src/i18n");
const list = [...keys].filter((k) => !INDIAN_STATES.test(k)).sort();
fs.writeFileSync(path.join(out, "_keys.json"), JSON.stringify(list, null, 0).replace(/","/g, '",\n"'));
const words = list.reduce((a, s) => a + s.split(" ").length, 0);
console.log(`${list.length} strings, ${words} words`);
for (const lang of ["ar", "de", "es", "ru", "zh"]) {
  const dict = JSON.parse(fs.readFileSync(path.join(out, `${lang}.json`), "utf8"));
  const missing = list.filter((k) => !dict[k]);
  console.log(`${lang}: ${list.length - missing.length} done, ${missing.length} missing`);
}
