/**
 * Builds the signed Android package and publishes it for the website's download page.
 *   DRYCARE_CLOUD_URL=https://your-server pnpm --filter @drycare/android dist
 * The app opens that address, so a shop's trial, subscription and data are the same as on the website.
 * The signing key is created once in .local/android. Keep a backup: without it, installed apps cannot be updated.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const root = path.resolve(app, "../..");
const url = (process.env.DRYCARE_CLOUD_URL ?? "").replace(/\/+$/, "");
const testBuild = process.env.DRYCARE_ANDROID_TEST === "1";
if (!/^https:\/\//.test(url) && !testBuild) {
  console.error("Set DRYCARE_CLOUD_URL to the public https address of the Drycare server. A phone cannot reach localhost.");
  process.exit(1);
}
const sdk = process.env.ANDROID_HOME ?? path.join(homedir(), "AppData/Local/Android/Sdk");
const java = process.env.JAVA_HOME ?? "C:/Program Files/Android/Android Studio/jbr";
const win = process.platform === "win32";
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, JAVA_HOME: java };
const run = (cmd, args, cwd = app) => execFileSync(cmd, args, { cwd, env, stdio: "inherit", shell: win && !cmd.endsWith(".exe") });
const version = JSON.parse(readFileSync(path.join(app, "package.json"), "utf8")).version;

writeFileSync(path.join(app, "capacitor.config.json"), JSON.stringify({ appId: "in.mindware.drycare", appName: "Drycare", webDir: "www", server: { url: url || "http://10.0.2.2:3210", cleartext: testBuild }, android: { allowMixedContent: false } }, null, 2));
if (!existsSync(path.join(app, "android"))) run("pnpm", ["exec", "cap", "add", "android"]);
run("pnpm", ["exec", "cap", "sync", "android"]);

// The launcher icon, from the website's icon.
const sharp = createRequire(import.meta.url)("sharp");
const res = path.join(app, "android/app/src/main/res");
rmSync(path.join(res, "mipmap-anydpi-v26"), { recursive: true, force: true });
const source = path.join(root, "apps/web/public/icons/icon-512.png");
for (const [dir, size] of [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]]) {
  for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) await sharp(source).resize(size, size).png().toFile(path.join(res, `mipmap-${dir}`, name));
}

run(path.join(app, "android", win ? "gradlew.bat" : "gradlew"), ["assembleRelease", "--no-daemon", "--console=plain"], path.join(app, "android"));

// Signing. The key and its password stay in .local, which is never committed.
const keyDir = path.join(root, ".local/android");
mkdirSync(keyDir, { recursive: true });
const store = path.join(keyDir, "drycare-release.jks");
const secretFile = path.join(keyDir, "signing-password.txt");
if (!existsSync(store)) {
  const password = randomBytes(24).toString("base64url");
  writeFileSync(secretFile, password, { mode: 0o600 });
  execFileSync(path.join(java, "bin/keytool.exe"), ["-genkeypair", "-keystore", store, "-alias", "drycare", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-storepass", password, "-keypass", password, "-dname", "CN=Mindware, O=Mindware, C=IN"], { env, stdio: "inherit" });
}
const tools = path.join(sdk, "build-tools/36.1.0");
// Run through the shell on Windows, so the path needs quotes: the SDK is often under a folder with a space.
const apksigner = win ? `"${path.join(tools, "apksigner.bat")}"` : path.join(tools, "apksigner");
const unsigned = path.join(app, "android/app/build/outputs/apk/release/app-release-unsigned.apk");
const out = path.join(app, "dist");
mkdirSync(out, { recursive: true });
const aligned = path.join(out, "aligned.apk");
const signed = path.join(out, `Drycare-${version}.apk`);
execFileSync(path.join(tools, "zipalign.exe"), ["-f", "-p", "4", unsigned, aligned], { env, stdio: "inherit" });
execFileSync(apksigner, ["sign", "--ks", store, "--ks-pass", `file:${secretFile}`, "--out", signed, aligned], { env, stdio: "inherit", shell: win });
rmSync(aligned, { force: true });
execFileSync(apksigner, ["verify", signed], { env, stdio: "inherit", shell: win });
const bytes = readFileSync(signed);
console.log(`Built ${signed} (${(statSync(signed).size / 1048576).toFixed(1)} MB) for ${url || "the Android emulator"}`);

if (testBuild) { console.log("Test build: not published for download."); process.exit(0); }
const dir = path.resolve(process.env.RELEASE_DIR ?? path.join(root, "apps/api/.local/releases"), "android");
mkdirSync(dir, { recursive: true });
const file = `Drycare-${version}.apk`;
copyFileSync(signed, path.join(dir, file));
writeFileSync(path.join(dir, "latest.json"), JSON.stringify({ version, file, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, null, 2));
console.log(`Published for download: ${file}`);
