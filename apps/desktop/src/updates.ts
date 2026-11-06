/**
 * Updates for the PC edition. The screens and the server are packed inside the installer, so a change to the website
 * never reaches a PC by itself: it needs a new version, published in Super admin > Software releases.
 *
 * Checked at start and every six hours when there is internet; a PC offline just keeps working. See docs/DESKTOP_RELEASE.md.
 */
import { app, dialog, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID, verify } from "node:crypto";
import { arch as cpuArch, hostname, release as osRelease } from "node:os";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rollbackScript } from "./rollback";

const { autoUpdater } = electronUpdater;
const SIX_HOURS = 6 * 60 * 60 * 1000;
/** How long a new version has to come up healthy before it is rolled back. */
const HEALTH_WAIT_SECONDS = 300;

type Manifest = {
  nonce: string; installationId: string; suspendedVersions: string[]; serverTime: string;
  release: { version: string; title: string | null; sha256: string; sha512: string; size: number; notes: string; message: string | null; mandatory: boolean; automatic: boolean; restartRequired: boolean; deadline: string | null; window: { start: number; end: number } | null; minSupportedVersion: string | null; rollback: boolean; channel: string; signatureStatus: string | null; feedToken: string } | null;
};
/** An automatic update waits until nobody has changed anything for this long. */
const QUIET_SECONDS = 10 * 60;
type Options = {
  window: () => BrowserWindow | null;
  log: (...parts: unknown[]) => void;
  /** Saves the shop's data just before the installer runs. */
  backup: () => Promise<unknown>;
  cloudUrl: () => string | null;
  installationId: () => string;
  licenseKey: () => string | null;
  secondsSinceWork: () => number;
  publicKey: () => string;
  userData: string;
};
type BuildSettings = { url?: string; requireSigned?: boolean; publisher?: string };

function buildSettings(): BuildSettings {
  const file = path.join(process.resourcesPath, "update.json");
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as BuildSettings) : {};
  } catch {
    return {};
  }
}

const isOlder = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

function verifyManifest(token: string, publicKey: string, installationId: string, nonce: string): Manifest | null {
  const [prefix, payload, signature, ...extra] = token.split(".");
  if (prefix !== "DRYCARERELEASE2" || !payload || !signature || extra.length || !publicKey) return null;
  try {
    const bytes = Buffer.from(payload, "base64url");
    if (!verify(null, bytes, publicKey, Buffer.from(signature, "base64url"))) return null;
    const m = JSON.parse(bytes.toString("utf8")) as Manifest;
    return m.installationId === installationId && m.nonce === nonce ? m : null;
  } catch {
    return null;
  }
}

const sha256Of = (file: string) => new Promise<string>((resolve, reject) => {
  const hash = createHash("sha256");
  createReadStream(file).on("data", (d) => hash.update(d)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
});

/** The Authenticode signature, once a certificate is in use. Not enforced until a build says so. */
const authenticode = (file: string) => new Promise<{ status: string; subject: string }>((resolve) => {
  const script = `$s = Get-AuthenticodeSignature -LiteralPath $env:DRYCARE_FILE; [pscustomobject]@{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress`;
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, DRYCARE_FILE: file }, windowsHide: true, timeout: 60_000 }, (err, out) => {
    if (err) return resolve({ status: "Unknown", subject: "" });
    try { resolve(JSON.parse(out)); } catch { resolve({ status: "Unknown", subject: "" }); }
  });
});

let manual = false;
let busy = false;
let current: Manifest["release"] = null;

export function setupUpdates(o: Options) {
  const { window, log } = o;
  const settings = buildSettings();
  const base = () => (process.env.DRYCARE_UPDATE_URL || o.cloudUrl() || settings.url || "").replace(/\/+$/, "");
  const ready = () => app.isPackaged && Boolean(base());
  const pendingFile = path.join(o.userData, "update-pending.json");
  const healthFile = path.join(o.userData, "update-health.txt");
  const rollbackResult = path.join(o.userData, "update-rollback.json");
  // For an automated test of the download, which has nobody to press the buttons.
  const unattended = process.env.DRYCARE_UPDATE_UNATTENDED === "1";

  const report = (status: string, toVersion: string, fromVersion: string | null, detail?: string) => {
    const key = o.licenseKey();
    if (!base() || !key) return;
    void fetch(`${base()}/api/v1/updates/report`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ key, installationId: o.installationId(), fromVersion, toVersion, status, detail }), signal: AbortSignal.timeout(15_000) }).catch(() => {});
  };

  async function fetchManifest(): Promise<Manifest | null> {
    const key = o.licenseKey();
    if (!key) return null; // A demo with no key updates by installing the latest version by hand.
    const nonce = randomUUID();
    const res = await fetch(`${base()}/api/v1/updates/check`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-drycare-csrf": "1" },
      body: JSON.stringify({ key, installationId: o.installationId(), nonce, version: app.getVersion(), pcName: hostname(), os: `Windows ${osRelease()}`, arch: cpuArch() === "arm64" ? "arm64" : "x64" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const { token } = (await res.json()) as { token: string };
    const m = verifyManifest(token, o.publicKey(), o.installationId(), nonce);
    if (!m) log("update error: the manifest's signature did not check out, so it was ignored");
    return m;
  }

  const isRequired = () => Boolean(current && (current.mandatory || (current.minSupportedVersion && isOlder(app.getVersion(), current.minSupportedVersion))));
  const pastDeadline = () => Boolean(current?.deadline && Date.parse(current.deadline) <= Date.now());
  const inWindow = () => {
    const w = current?.window;
    if (!w) return true;
    const h = new Date().getHours();
    return w.start < w.end ? h >= w.start && h < w.end : h >= w.start || h < w.end;
  };
  const isQuiet = () => o.secondsSinceWork() >= QUIET_SECONDS;

  const ask = async (options: Electron.MessageBoxOptions) => {
    const w = window();
    return w ? dialog.showMessageBox(w, options) : dialog.showMessageBox(options);
  };

  /** Everything before the installer runs. Any failure here leaves the working version as it is. */
  async function install(file: string, version: string) {
    try {
      await o.backup();
    } catch (e) {
      log("update: backup before installing failed", e);
      report("failed", version, app.getVersion(), "backup failed");
      dialog.showErrorBox("Update not installed", `Your data could not be backed up, so the update was not installed. Drycare will keep working as it is.\n\n${(e as Error).message}`);
      return;
    }
    const appDir = path.dirname(process.execPath);
    const exeName = path.basename(process.execPath);
    const copyDir = path.join(o.userData, "update-rollback-copy");
    const scriptFile = path.join(o.userData, "update-watchdog.ps1");
    try {
      rmSync(copyDir, { recursive: true, force: true });
      mkdirSync(copyDir, { recursive: true });
      await new Promise<void>((resolve, reject) => {
        // Robocopy's exit codes below 8 all mean success.
        execFile("robocopy", [appDir, copyDir, "/MIR", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], { windowsHide: true, timeout: 10 * 60_000 }, (err) => (err && Number(err.code) >= 8 ? reject(err) : resolve()));
      });
      rmSync(healthFile, { force: true });
      writeFileSync(scriptFile, rollbackScript({ appDir, copyDir, exeName, healthFile, resultFile: rollbackResult, toVersion: version, fromVersion: app.getVersion(), waitSeconds: HEALTH_WAIT_SECONDS }), "utf8");
      writeFileSync(pendingFile, JSON.stringify({ from: app.getVersion(), to: version }));
      spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", scriptFile], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } catch (e) {
      log("update: could not prepare the way back", e);
      report("failed", version, app.getVersion(), "could not prepare rollback");
      dialog.showErrorBox("Update not installed", `Drycare could not prepare a way back to this version, so the update was not installed.\n\n${(e as Error).message}`);
      return;
    }
    report("installing", version, app.getVersion());
    autoUpdater.quitAndInstall(true, true);
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.logger = { info: (m: unknown) => log("update:", m), warn: (m: unknown) => log("update:", m), error: (m: unknown) => log("update error:", m), debug: () => {} };

  autoUpdater.on("update-available", async (info) => {
    log(`update: version ${info.version} is available`);
    if (!current || current.version !== info.version) {
      log("update error: the offered version is not in the signed manifest, so it was ignored");
      return;
    }
    const required = isRequired();
    if (unattended || current.automatic) {
      report("downloading", info.version, app.getVersion());
      busy = true;
      return void autoUpdater.downloadUpdate().catch((e: Error) => { busy = false; report("failed", info.version, app.getVersion(), e.message); log("update error:", e.message); });
    }
    const { response } = await ask({
      type: required ? "warning" : "info",
      title: required ? "Update required" : "Update available",
      message: `Drycare ${info.version} is ${required ? "required" : "available"}`,
      detail: `You have version ${app.getVersion()}.\n\n${current.message ? `${current.message}\n\n` : ""}${current.notes || "This version brings the latest screens and fixes."}\n\n${current.deadline ? `Please update by ${new Date(current.deadline).toLocaleString()}.\n\n` : ""}Your data is not changed by downloading. It is backed up before installing.`,
      buttons: required ? ["Download"] : ["Download", "Later"],
      defaultId: 0,
      cancelId: required ? 0 : 1,
    });
    if (response === 0) {
      busy = true;
      report("downloading", info.version, app.getVersion());
      void autoUpdater.downloadUpdate().catch((e: Error) => { busy = false; report("failed", info.version, app.getVersion(), e.message); log("update error:", e.message); });
    }
  });

  autoUpdater.on("update-not-available", () => {
    log("update: this is the latest version");
    if (!manual) return;
    manual = false;
    void ask({ type: "info", title: "No update", message: "You have the latest version", detail: `Drycare ${app.getVersion()}` });
  });

  autoUpdater.on("download-progress", (p) => {
    const w = window();
    w?.setProgressBar(p.percent / 100);
    w?.setTitle(`Drycare: downloading update ${Math.round(p.percent)}%`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    busy = false;
    const w = window();
    w?.setProgressBar(-1);
    w?.setTitle("Drycare");
    const file = (info as { downloadedFile?: string }).downloadedFile;
    const reject = (detail: string) => {
      log(`update error: ${detail}`);
      report("failed", info.version, app.getVersion(), detail);
    };
    if (!current || current.version !== info.version || !file) return reject("the download does not match the signed manifest");
    if ((await sha256Of(file)) !== current.sha256) return reject("the download's SHA-256 does not match the signed manifest");
    const signature = await authenticode(file);
    log(`update: code signature ${signature.status}${signature.subject ? ` (${signature.subject})` : ""}`);
    if (settings.requireSigned && (signature.status !== "Valid" || (settings.publisher && !signature.subject.includes(settings.publisher)))) return reject(`the installer is not signed by the expected publisher (${signature.status})`);
    log(`update: version ${info.version} downloaded and checked`);
    report("downloaded", info.version, app.getVersion());
    if (unattended) return;
    if (current.automatic && !pastDeadline()) {
      // Waits for the maintenance window and a quiet PC, so it never interrupts billing or printing.
      const version = info.version;
      const wait = setInterval(() => {
        if (!inWindow() || !isQuiet() || current?.version !== version) return;
        clearInterval(wait);
        log(`update: installing ${version} in the maintenance window`);
        void install(file, version);
      }, 5 * 60_000);
      return;
    }
    const required = isRequired();
    const working = !isQuiet() && o.secondsSinceWork() < 120;
    const { response } = await ask({
      type: "info",
      title: "Ready to install",
      message: `Drycare ${info.version} is ready to install`,
      detail: `${working ? "Please finish any bill or print in progress first. " : ""}Drycare will back up your data, close, install the update and open again. This takes a few minutes. If the new version has a problem, the current one comes back by itself.`,
      buttons: required ? ["Install now"] : ["Install now", "Later"],
      defaultId: 0,
      cancelId: required ? 0 : 1,
    });
    if (response === 0) await install(file, info.version);
  });

  autoUpdater.on("error", (e) => {
    busy = false;
    const w = window();
    w?.setProgressBar(-1);
    w?.setTitle("Drycare");
    log("update error:", e.message);
    if (!manual) return; // No internet is normal for a PC; only say so when someone asked.
    manual = false;
    void ask({ type: "warning", title: "Could not check for updates", message: "Could not reach the update service", detail: "Check the internet connection and try again. Drycare keeps working without it." });
  });

  async function check() {
    if (busy || !ready()) return;
    if (!o.licenseKey()) {
      if (manual) {
        manual = false;
        void ask({ type: "info", title: "Updates", message: "Updates come with a license key", detail: `Drycare ${app.getVersion()}. Activate this PC to get updates, or ask your Drycare provider for the latest installer.` });
      }
      return;
    }
    const manifest = await fetchManifest();
    if (!manifest) throw new Error("No signed manifest");
    current = manifest.release;
    // An older version is accepted only when the signed manifest says the owner started a rollback.
    if (current && !current.rollback && !isOlder(app.getVersion(), current.version)) {
      log(`update error: refused to go from ${app.getVersion()} to ${current.version} without a signed rollback`);
      current = null;
    }
    if (current) {
      autoUpdater.allowDowngrade = current.rollback;
      autoUpdater.setFeedURL({ provider: "generic", url: `${base()}/api/v1/updates/feed/${current.feedToken}` });
    }
    if (manifest.suspendedVersions.includes(app.getVersion())) log(`update: version ${app.getVersion()} has been suspended by the publisher`);
    if (!current) {
      autoUpdater.emit("update-not-available", { version: app.getVersion() } as never);
      return;
    }
    await autoUpdater.checkForUpdates();
  }

  const quiet = () => void check().catch((e: Error) => log("update error:", e.message));
  // The server address is known only once the app has started, so each check looks for it then.
  if (app.isPackaged) {
    setTimeout(() => {
      if (o.licenseKey()) return quiet();
      // A PC activated after starting should not wait six hours for its first check.
      const waiting = setInterval(() => {
        if (!o.licenseKey()) return;
        clearInterval(waiting);
        quiet();
      }, 60_000);
    }, 30_000);
    setInterval(quiet, SIX_HOURS);
  }

  return {
    /** Help > Check for updates. */
    checkNow() {
      if (!ready()) {
        void ask({ type: "info", title: "Updates", message: app.isPackaged ? "Updates are not set up for this copy" : "Updates work only in an installed copy", detail: `Drycare ${app.getVersion()}. Ask your Drycare provider for the latest installer.` });
        return;
      }
      manual = true;
      void check().catch((e: Error) => { log("update error:", e.message); if (manual) { manual = false; void ask({ type: "warning", title: "Could not check for updates", message: "Could not reach the update service", detail: "Check the internet connection and try again. Drycare keeps working without it." }); } });
    },
    /** The app started and its server answers: this version is good. Stops the watchdog and reports the result. */
    markHealthy() {
      if (existsSync(rollbackResult)) {
        try {
          const r = JSON.parse(readFileSync(rollbackResult, "utf8").replace(/^﻿/, "")) as { from: string; to: string; restored: boolean };
          report(r.restored ? "rolled_back" : "failed", r.to, r.from, r.restored ? "The new version did not start properly, so the previous one was restored." : "The previous version could not be restored.");
          log(`update: version ${r.to} did not come up healthy; restored ${r.from}`);
        } catch { /* a damaged note is not worth stopping for */ }
        rmSync(rollbackResult, { force: true });
        rmSync(pendingFile, { force: true });
      }
      if (!existsSync(pendingFile)) return;
      try {
        const p = JSON.parse(readFileSync(pendingFile, "utf8")) as { from: string; to: string };
        if (p.to === app.getVersion()) {
          writeFileSync(healthFile, app.getVersion());
          report("succeeded", p.to, p.from);
          log(`update: version ${p.to} is healthy`);
          rmSync(pendingFile, { force: true });
        }
      } catch (e) {
        log("update: could not read the update note", e);
      }
    },
  };
}
