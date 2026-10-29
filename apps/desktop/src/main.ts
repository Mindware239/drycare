/**
 * DryCare for PC — Electron main process.
 *
 * Starts a private PostgreSQL server (data in %APPDATA%\DryCare\pgdata), runs the DryCare API
 * in-process on 127.0.0.1 and shows it in an app window. Nothing needs to be installed separately
 * and the shop works without internet.
 */
import { app, BrowserWindow, dialog, Menu, safeStorage, shell } from "electron";
import EmbeddedPostgres from "embedded-postgres";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nodeRequire = createRequire(import.meta.url);
const embeddedPostgresExitHook = createRequire(nodeRequire.resolve("embedded-postgres"))("async-exit-hook") as {
  unhookEvent: (event: string) => void;
};
// Electron performs its own shutdown; the library's `exit` hook expects a callback Node cannot provide there.
embeddedPostgresExitHook.unhookEvent("exit");

// Test runs can point at a throwaway data folder instead of %APPDATA%\DryCare.
if (process.env.DRYCARE_USER_DATA) app.setPath("userData", process.env.DRYCARE_USER_DATA);

const here = path.dirname(fileURLToPath(import.meta.url));
const resources = app.isPackaged ? process.resourcesPath : path.join(here, "resources");
const userData = app.getPath("userData");
const configFile = path.join(userData, "config.json");
const logFile = path.join(userData, "logs", "drycare.log");

interface Config {
  pgPassword: string;
  pgPort: number;
  appPort: number;
  lanAccess: boolean;
  backupDir: string;
  installationId: string;
  /** DryCare Cloud address for optional sync (HTTPS). Set by the installer/support; never a secret. */
  cloudUrl?: string;
}

function log(...parts: unknown[]) {
  const line = `[${new Date().toISOString()}] ${parts.map((p) => (p instanceof Error ? p.stack : typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`;
  try {
    mkdirSync(path.dirname(logFile), { recursive: true });
    appendFileSync(logFile, line);
  } catch {}
  if (!app.isPackaged) process.stdout.write(line);
}

function loadConfig(): Config {
  mkdirSync(userData, { recursive: true });
  const defaults: Config = {
    pgPassword: randomBytes(24).toString("base64url"),
    pgPort: 54329,
    appPort: 47321,
    lanAccess: false,
    backupDir: process.env.DRYCARE_BACKUP_DIR || path.join(app.getPath("documents"), "DryCare Backups"),
    installationId: randomUUID(),
  };
  let cfg = defaults;
  if (existsSync(configFile)) cfg = { ...defaults, ...JSON.parse(readFileSync(configFile, "utf8")) };
  saveConfig(cfg);
  return cfg;
}
const saveConfig = (cfg: Config) => writeFileSync(configFile, JSON.stringify(cfg, null, 2));

function portFree(port: number, host: string) {
  return new Promise<boolean>((resolve) => {
    const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}
/** A port Windows lets us bind right now (it picks one outside every reserved range). */
function osAssignedPort(host: string) {
  return new Promise<number>((resolve, reject) => {
    const s = net.createServer().once("error", reject).once("listening", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.listen(0, host);
  });
}
/**
 * Prefers the saved port so bookmarks and LAN links keep working. Hyper-V, WSL and Docker make Windows
 * reserve whole blocks of ports (e.g. 54307–54506), so when the preferred block is unavailable we let
 * Windows choose a free port instead of failing to start.
 */
async function findPort(preferred: number, host: string) {
  for (let p = preferred; p < preferred + 20; p++) if (await portFree(p, host)) return p;
  const p = await osAssignedPort(host);
  log(`Ports ${preferred}–${preferred + 19} are unavailable (reserved by Windows or in use); using ${p}`);
  return p;
}

let config: Config;
let pg: EmbeddedPostgres | undefined;
let win: BrowserWindow | undefined;
let splash: BrowserWindow | undefined;
let serverMod: typeof import("./server-entry") | undefined;
let appUrl = "";
let quitting = false;

const databaseDir = () => path.join(userData, "pgdata");

/**
 * Clean shutdown. On Windows embedded-postgres stops the server with `taskkill /f`, which is a
 * crash from Postgres' point of view. pg_ctl performs a proper fast shutdown (checkpoint, close
 * files); afterwards we tell the library the process is gone so its exit hook does nothing.
 */
async function stopDatabase() {
  if (!pg) return;
  if (process.platform === "win32") {
    try {
      const { pg_ctl } = await import("@embedded-postgres/windows-x64");
      await new Promise<void>((resolve, reject) =>
        execFile(pg_ctl, ["stop", "-D", databaseDir(), "-m", "fast", "-w", "-t", "60"], { windowsHide: true }, (err, stdout, stderr) => {
          log("[pg_ctl]", (stdout + stderr).trim());
          err ? reject(err) : resolve();
        }),
      );
      (pg as unknown as { process?: unknown }).process = undefined;
      pg = undefined;
      return;
    } catch (e) {
      log("pg_ctl stop failed, falling back to process stop", e);
    }
  }
  await pg?.stop();
  pg = undefined;
}

async function startDatabase() {
  const dir = databaseDir();
  const fresh = !existsSync(path.join(dir, "PG_VERSION"));
  config.pgPort = await findPort(config.pgPort, "127.0.0.1");
  saveConfig(config);
  pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "drycare",
    password: config.pgPassword,
    port: config.pgPort,
    persistent: true,
    authMethod: "scram-sha-256",
    // UTF-8 regardless of the Windows locale (which would otherwise give WIN1252 and garble
    // Hindi/Marathi names and the ₹ sign). Locale "C" keeps sorting predictable on every PC.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    // Listen on loopback only: the database is never reachable from the network.
    postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
    onLog: (m) => log("[pg]", String(m).trim()),
    onError: (e) => log("[pg:error]", e),
  });
  if (fresh) {
    log("Initialising new database in", dir);
    await pg.initialise();
  }
  await pg.start();
  if (fresh) await pg.createDatabase("drycare");
}

async function startApp() {
  config = loadConfig();
  mkdirSync(config.backupDir, { recursive: true });
  showSplash("Starting database…");
  await startDatabase();

  const host = config.lanAccess ? "0.0.0.0" : "127.0.0.1";
  config.appPort = await findPort(config.appPort, host);
  saveConfig(config);
  Object.assign(process.env, {
    DATABASE_URL: `postgres://drycare:${encodeURIComponent(config.pgPassword)}@127.0.0.1:${config.pgPort}/drycare`,
    DRYCARE_MODE: "desktop",
    NODE_ENV: "production",
    API_HOST: host,
    API_PORT: String(config.appPort),
    WEB_DIST: path.join(resources, "web"),
    BACKUP_DIR: config.backupDir,
    APP_VERSION: app.getVersion(),
    LICENSE_ENFORCED: String(app.isPackaged),
    LICENSE_PUBLIC_KEY: existsSync(path.join(resources, "license-public.pem"))
      ? readFileSync(path.join(resources, "license-public.pem"), "utf8")
      : "",
    LICENSE_FILE: path.join(userData, "license.json"),
    LICENSE_INSTALLATION_ID: config.installationId,
    COOKIE_SECURE: "false",
    SESSION_TTL_HOURS: "14",
  });

  showSplash("Preparing DryCare…");
  serverMod = await import("./server-entry");
  serverMod.setCloudUrl(process.env.DRYCARE_CLOUD_URL || config.cloudUrl || null);
  serverMod.setCredentialStore(dpapiCredentialStore());
  const urls = await serverMod.startServer({ migrationsDir: path.join(resources, "drizzle"), host, port: config.appPort });
  appUrl = urls.localUrl;
  log("DryCare running at", appUrl, urls.lanUrls.length ? `LAN: ${urls.lanUrls.join(", ")}` : "(this PC only)");

  serverMod
    .autoBackupIfDue(config.backupDir, app.getVersion(), 20)
    .then((b) => b && log("Daily backup created", b.name))
    .catch((e) => log("Daily backup failed", e));

  createMainWindow();
  buildMenu();
}

/**
 * The cloud device credential, encrypted with Windows DPAPI via Electron safeStorage (only this Windows user can
 * decrypt it). Lives only in the main process; the web screens never see it.
 */
function dpapiCredentialStore() {
  const file = path.join(userData, "sync-credential.bin");
  return {
    async load() {
      if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return null;
      try {
        return JSON.parse(safeStorage.decryptString(readFileSync(file)));
      } catch (e) {
        log("Cloud credential could not be read", e);
        return null;
      }
    },
    async save(c: unknown) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is not available, so the cloud credential cannot be stored safely.");
      writeFileSync(file, safeStorage.encryptString(JSON.stringify(c)));
    },
    async clear() {
      rmSync(file, { force: true });
    },
  };
}

function showSplash(text: string) {
  if (!splash) {
    splash = new BrowserWindow({ width: 420, height: 220, frame: false, resizable: false, center: true, show: true, backgroundColor: "#0f6a5d", icon: iconPath() });
  }
  const html = `<html><body style="margin:0;font-family:Segoe UI,sans-serif;background:#0f6a5d;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh">
    <div style="font-size:28px;font-weight:700">Dry<span style="color:#94eadb">Care</span></div>
    <div style="margin-top:14px;font-size:13px;opacity:.85">${text}</div></body></html>`;
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

const iconPath = () => path.join(resources, "icon.ico");

function createMainWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: "DryCare",
    icon: iconPath(),
    backgroundColor: "#f6f7f9",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once("ready-to-show", () => {
    splash?.destroy();
    splash = undefined;
    win!.maximize();
    win!.show();
  });
  // Print pages (receipt, tags) open in their own window; anything external opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(appUrl)) return { action: "allow", overrideBrowserWindowOptions: { width: 900, height: 800, icon: iconPath(), autoHideMenuBar: true } };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(appUrl)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.loadURL(`${appUrl}/activate`);
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "DryCare",
      submenu: [
        { label: "Back up now", click: () => backupNow() },
        { label: "Restore backup…", click: () => restoreBackup() },
        { label: "Open backup folder", click: () => shell.openPath(config.backupDir) },
        { label: "Change backup folder…", click: () => changeBackupFolder() },
        { type: "separator" },
        { label: "Allow other computers in this shop", type: "checkbox", checked: config.lanAccess, click: (item) => toggleLan(item.checked) },
        { type: "separator" },
        { label: "Open log file", click: () => shell.openPath(logFile) },
        { type: "separator" },
        { label: "Quit DryCare", accelerator: "Alt+F4", click: () => app.quit() },
      ],
    },
    {
      label: "View",
      submenu: [{ role: "reload" }, { type: "separator" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }, { role: "toggleDevTools" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About DryCare",
          click: () =>
            dialog.showMessageBox(win!, {
              type: "info",
              title: "About DryCare",
              message: `DryCare for PC  v${app.getVersion()}`,
              detail: `Dry cleaning & laundry store management.\n\nData folder: ${userData}\nBackups: ${config.backupDir}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function backupNow() {
  try {
    const b = await serverMod!.backupNow(config.backupDir, app.getVersion());
    const r = await dialog.showMessageBox(win!, { type: "info", message: "Backup saved", detail: `${b.name}\n\nCopy the backup folder to a pen drive or cloud drive regularly.`, buttons: ["OK", "Open folder"] });
    if (r.response === 1) shell.openPath(config.backupDir);
  } catch (e) {
    log("Manual backup failed", e);
    dialog.showErrorBox("Backup failed", String((e as Error).message ?? e));
  }
}

async function restoreBackup() {
  const pick = await dialog.showOpenDialog(win!, { title: "Choose a DryCare backup", defaultPath: config.backupDir, filters: [{ name: "DryCare backup", extensions: ["dcbak"] }], properties: ["openFile"] });
  if (pick.canceled || !pick.filePaths[0]) return;
  const file = pick.filePaths[0];
  try {
    const m = await serverMod!.backupManifest(file);
    const when = new Date(m.createdAt).toLocaleString("en-IN");
    const ok = await dialog.showMessageBox(win!, {
      type: "warning",
      buttons: ["Cancel", "Replace all data"],
      defaultId: 0,
      cancelId: 0,
      title: "Restore backup",
      message: `Replace ALL current data with the backup from ${when}?`,
      detail: "Everything entered after that time will be removed. A safety copy of the current data is saved first. Everyone will need to sign in again.",
    });
    if (ok.response !== 1) return;
    const r = await serverMod!.restoreFrom(file, config.backupDir, app.getVersion());
    log("Restored backup", file, "safety copy", r.safety.name);
    await dialog.showMessageBox(win!, { type: "info", message: "Backup restored", detail: `Data restored to ${when}.\nSafety copy of the previous data: ${r.safety.name}` });
    win?.loadURL(`${appUrl}/login`);
  } catch (e) {
    log("Restore failed", e);
    dialog.showErrorBox("Restore failed — no data was changed", String((e as Error).message ?? e));
  }
}

async function changeBackupFolder() {
  const pick = await dialog.showOpenDialog(win!, { title: "Choose backup folder", defaultPath: config.backupDir, properties: ["openDirectory", "createDirectory"] });
  if (pick.canceled || !pick.filePaths[0]) return;
  config.backupDir = pick.filePaths[0];
  saveConfig(config);
  await dialog.showMessageBox(win!, { type: "info", message: "Backup folder changed", detail: `${config.backupDir}\n\nDryCare will restart to apply the change.` });
  relaunch();
}

async function toggleLan(on: boolean) {
  const r = await dialog.showMessageBox(win!, {
    type: "question",
    buttons: ["Cancel", on ? "Allow & restart" : "Disable & restart"],
    cancelId: 0,
    message: on ? "Let other computers in this shop use DryCare?" : "Stop other computers from connecting?",
    detail: on
      ? "Other PCs, tablets and phones on the same Wi-Fi/LAN will be able to open DryCare in a web browser and sign in with their own staff accounts. Windows may ask you to allow DryCare through the firewall — choose 'Private networks' only."
      : "Only this PC will be able to use DryCare.",
  });
  if (r.response !== 1) return buildMenu();
  config.lanAccess = on;
  saveConfig(config);
  relaunch();
}

function relaunch() {
  app.relaunch();
  app.quit();
}

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() =>
    startApp().catch(async (e) => {
      log("Startup failed", e);
      splash?.destroy();
      dialog.showErrorBox("DryCare could not start", `${(e as Error).message}\n\nDetails are in ${logFile}`);
      await stopDatabase().catch(() => {});
      app.exit(1);
    }),
  );
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    (async () => {
      try {
        // Closing backup: at most one per hour so quick restarts don't pile up files.
        if (serverMod) await serverMod.autoBackupIfDue(config.backupDir, app.getVersion(), 1).catch((err) => log("Closing backup failed", err));
        await serverMod?.stopServer();
        await stopDatabase();
      } catch (err) {
        log("Shutdown error", err);
      }
      app.exit(0);
    })();
  });
}
