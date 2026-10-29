import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { signedLicenseSchema } from "../packages/shared/src/license";

const root = path.resolve(import.meta.dirname, "..");
const defaultPrivateKey = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "DryCareLicenseIssuer", "license-private.pem");
const defaultPublicKey = path.join(root, "apps", "desktop", "build", "license-public.pem");

function optionValues(args: string[], name: string) {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
      values.push(value);
      i++;
    }
  }
  return values;
}

function option(args: string[], name: string) {
  return optionValues(args, name)[0];
}

function askSecret(prompt: string) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Run this command in an interactive terminal so the signing passphrase can be entered without echo.");
  }
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const input = process.stdin;
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          reject(new Error("Cancelled"));
          return;
        }
        if (byte === 13 || byte === 10) {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (byte >= 32 && byte <= 126) {
          value += String.fromCharCode(byte);
          process.stdout.write("*");
        }
      }
    };
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function keygen() {
  if (existsSync(defaultPrivateKey) || existsSync(defaultPublicKey)) {
    throw new Error(`A license key file already exists. Refusing to overwrite either key. Private key: ${defaultPrivateKey}; public key: ${defaultPublicKey}`);
  }
  const passphrase = await askSecret("Create a strong private-key passphrase (minimum 16 characters): ");
  if (passphrase.length < 16) throw new Error("Use a passphrase with at least 16 characters.");
  const confirm = await askSecret("Confirm private-key passphrase: ");
  if (confirm !== passphrase) throw new Error("Passphrases do not match.");

  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase },
  });
  mkdirSync(path.dirname(defaultPrivateKey), { recursive: true });
  mkdirSync(path.dirname(defaultPublicKey), { recursive: true });
  writeFileSync(defaultPublicKey, publicKey, { encoding: "utf8", flag: "wx" });
  writeFileSync(defaultPrivateKey, privateKey, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log(`Public verification key saved for desktop builds: ${defaultPublicKey}`);
  console.log(`Encrypted private signing key saved outside the project: ${defaultPrivateKey}`);
  console.log("Back up the encrypted private key and its passphrase separately. If either is lost, existing licenses continue to work, but you cannot issue renewals.");
}

async function issue(args: string[]) {
  const privateKeyFile = path.resolve(option(args, "--private-key") ?? defaultPrivateKey);
  const plan = option(args, "--plan");
  const expires = option(args, "--expires");
  const installationIds = optionValues(args, "--device-code").map((id) => id.trim().toLowerCase());
  if (!plan) throw new Error("Specify a custom plan name with --plan, for example --plan Standard.");
  if (!expires) throw new Error("Specify --expires YYYY-MM-DD or --expires never.");
  if (!installationIds.length) throw new Error("Provide each licensed PC's activation request code using one or more --device-code options.");
  if (!existsSync(privateKeyFile)) throw new Error(`Private signing key not found: ${privateKeyFile}`);
  if (installationIds.length > 100) throw new Error("A license can include at most 100 PC request codes.");

  let expiresAt: string | null = null;
  if (expires.toLowerCase() !== "never") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw new Error("Use an expiry date formatted YYYY-MM-DD, or 'never'.");
    const date = new Date(`${expires}T23:59:59.999Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== expires) throw new Error("Expiry date is invalid.");
    expiresAt = date.toISOString();
    if (Date.parse(expiresAt) <= Date.now()) throw new Error("Expiry date must be in the future.");
  }

  const uniqueIds = [...new Set(installationIds)];
  if (uniqueIds.length !== installationIds.length) throw new Error("The same PC request code was provided more than once.");
  const unsigned = {
    version: 1 as const,
    licenseId: randomUUID(),
    plan: plan.trim(),
    issuedAt: new Date().toISOString(),
    expiresAt,
    installationIds: uniqueIds,
  };
  const payload = signedLicenseSchema.parse(unsigned);
  const passphrase = await askSecret("Private-key passphrase: ");
  const privateKey = readFileSync(privateKeyFile, "utf8");
  const signature = sign(null, Buffer.from(JSON.stringify(payload)), { key: privateKey, passphrase });
  const key = `DRYCARE1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature.toString("base64url")}`;
  console.log("\nSigned offline activation key (send to the customer):\n");
  console.log(key);
  console.log(`\nLicense ${payload.licenseId}: plan=${payload.plan}; PCs=${uniqueIds.length}; expiry=${payload.expiresAt ?? "perpetual"}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "keygen") await keygen();
  else if (command === "issue") await issue(args);
  else throw new Error("Use `pnpm license:keygen` once, then `pnpm license:issue -- --plan <name> --expires YYYY-MM-DD --device-code <request-code> [--device-code <another-pc>]`.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "License issuer failed.");
  process.exitCode = 1;
});
