/**
 * Builds the standalone desktop app into stage/app:
 *   main.mjs (+ lazily loaded server chunk)  — Electron main + DryCare API, bundled by esbuild
 *   resources/web      — statically exported web screens
 *   resources/drizzle  — database migrations
 *   node_modules       — only the native/binary packages (embedded Postgres, argon2), installed flat with npm
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const stage = path.join(root, "stage", "app");
const licensePublicKey = path.join(root, "build", "license-public.pem");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const NATIVE = Object.keys(pkg.dependencies);
const run = (cmd, cwd = repo) => execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env } });

console.log("› Building web screens (static export)…");
run("pnpm --filter @drycare/web build:static");

console.log("› Preparing stage…");
if (!existsSync(licensePublicKey)) {
  throw new Error("Missing apps/desktop/build/license-public.pem. Create the license signing key in Super admin → Licenses & releases (it saves this file automatically), or download the public key there and save it here.");
}
const keepModules = existsSync(path.join(stage, "node_modules")) && existsSync(path.join(stage, "package.json")) && readFileSync(path.join(stage, "package.json"), "utf8").includes(pkg.dependencies["embedded-postgres"]);
for (const entry of ["main.mjs", "chunks", "resources"]) rmSync(path.join(stage, entry), { recursive: true, force: true });
mkdirSync(path.join(stage, "resources"), { recursive: true });
cpSync(path.join(repo, "apps/web/out"), path.join(stage, "resources/web"), { recursive: true });
cpSync(path.join(repo, "apps/api/drizzle"), path.join(stage, "resources/drizzle"), { recursive: true });
cpSync(path.join(root, "build/icon.ico"), path.join(stage, "resources/icon.ico"));
cpSync(licensePublicKey, path.join(stage, "resources/license-public.pem"));

console.log("› Bundling main process + API…");
await build({
  entryPoints: { main: path.join(root, "src/main.ts") },
  outdir: stage,
  outExtension: { ".js": ".mjs" },
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  conditions: ["node"],
  external: ["electron", ...NATIVE, "@embedded-postgres/*"],
  // CommonJS dependencies (fastify, postgres…) call require(); give the ESM bundle a real one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  sourcemap: "linked",
  legalComments: "none",
  logLevel: "warning",
});

writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: "drycare",
      productName: "DryCare",
      version: pkg.version,
      description: pkg.description,
      author: "DryCare",
      main: "main.mjs",
      type: "module",
      dependencies: pkg.dependencies,
    },
    null,
    2,
  ),
);

if (!keepModules) {
  console.log("› Installing native packages (embedded PostgreSQL, argon2)…");
  rmSync(path.join(stage, "node_modules"), { recursive: true, force: true });
  run("npm install --omit=dev --no-package-lock --no-audit --no-fund", stage);
}
console.log(`✓ Desktop app staged in ${path.relative(repo, stage)}`);
