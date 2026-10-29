/**
 * Generates the installable-app (PWA) icons from apps/web/src/app/icon.svg.
 * Run: node scripts/pwa-icons.mjs   (re-run whenever the logo changes)
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(repo, "apps/web");
// sharp ships with Next.js; resolve it from there.
const sharp = createRequire(createRequire(path.join(web, "package.json")).resolve("next"))("sharp");
const svg = readFileSync(path.join(web, "src/app/icon.svg"));
const out = path.join(web, "public/icons");
mkdirSync(out, { recursive: true });

const BRAND = "#087b69";
for (const size of [192, 512]) {
  await sharp(svg, { density: 1200 }).resize(size, size).png().toFile(path.join(out, `icon-${size}.png`));
}
// Maskable: Android crops icons to circles/squircles, so keep the logo inside the central 80% safe zone.
for (const size of [192, 512]) {
  const inner = Math.round(size * 0.72);
  const logo = await sharp(svg, { density: 1200 }).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BRAND } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path.join(out, `maskable-${size}.png`));
}
await sharp(svg, { density: 1200 }).resize(180, 180).flatten({ background: BRAND }).png().toFile(path.join(out, "apple-touch-icon.png"));
console.log("PWA icons written to", path.relative(repo, out));
