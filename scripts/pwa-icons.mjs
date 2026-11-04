/**
 * Generates every app icon from the Drycare logo (apps/web/public/site/logo.png):
 * browser icons, installable-app (PWA) icons, the Windows app icon and the logo version for dark backgrounds.
 * Run: node scripts/pwa-icons.mjs   (re-run whenever the logo changes)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(repo, "apps/web");
// sharp ships with Next.js; resolve it from there.
const sharp = createRequire(createRequire(path.join(web, "package.json")).resolve("next"))("sharp");
const logoFile = path.join(web, "public/site/logo.png");
const out = path.join(web, "public/icons");
mkdirSync(out, { recursive: true });

/** The logo on a white tile, so its black "D" stays visible on dark taskbars and home screens. */
async function tile(size, { scale = 0.78, rounded = true } = {}) {
  const radius = rounded ? Math.round(size * 0.2) : 0;
  const background = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#ffffff"/></svg>`);
  const logo = await sharp(logoFile).resize({ width: Math.round(size * scale) }).png().toBuffer();
  return sharp(background).composite([{ input: logo, gravity: "center" }]).png().toBuffer();
}

for (const size of [192, 512]) {
  writeFileSync(path.join(out, `icon-${size}.png`), await tile(size));
  // Maskable: Android crops icons to circles/squircles, so keep the logo inside the central safe zone.
  writeFileSync(path.join(out, `maskable-${size}.png`), await tile(size, { scale: 0.6, rounded: false }));
}
writeFileSync(path.join(out, "apple-touch-icon.png"), await tile(180, { rounded: false }));
writeFileSync(path.join(web, "public/site/favicon.png"), await tile(128));
writeFileSync(path.join(web, "src/app/icon.png"), await tile(64));

// Windows app icon: an .ico file holding PNG images.
const desktop = path.join(repo, "apps/desktop/build");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map((size) => tile(size, { scale: size <= 32 ? 0.92 : 0.82 })));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size === 256 ? 0 : size, entry);
  header.writeUInt8(size === 256 ? 0 : size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
writeFileSync(path.join(desktop, "icon.ico"), Buffer.concat([header, ...images]));
writeFileSync(path.join(desktop, "icon.png"), await tile(512));

// Logo for dark backgrounds: the black "D" becomes white, the green "C" is unchanged.
const { data, info } = await sharp(logoFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) {
  const [r, g] = [data[i], data[i + 1]];
  // Green pixels have green well above red; anti-aliased dark edges do not.
  if (g - r < 40) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
  }
}
await sharp(data, { raw: info }).png().toFile(path.join(web, "public/site/logo-dark.png"));

console.log("Icons written");
