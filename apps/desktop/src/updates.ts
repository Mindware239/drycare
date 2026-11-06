/**
 * Updates for the PC edition. The screens and the server are packed inside the installer, so a change to the website
 * never reaches a PC by itself: it needs a new version, published to the update folder with `pnpm dist`'s files
 * (latest.yml, the .exe and its .blockmap).
 *
 * Checked at start and every six hours when there is internet; a PC offline just keeps working. Nothing is downloaded or
 * installed without the shop agreeing. The download is checked against the SHA-512 in latest.yml, and the shop's data is
 * backed up before the installer runs. Shop data lives outside the app folder, so installing never touches it.
 */
import { app, dialog, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const { autoUpdater } = electronUpdater;
const SIX_HOURS = 6 * 60 * 60 * 1000;

type Options = {
  window: () => BrowserWindow | null;
  log: (...parts: unknown[]) => void;
  /** Saves the shop's data just before the installer runs. */
  backup: () => Promise<unknown>;
};

/** Where versions are published. Set when the app is built, or by DRYCARE_UPDATE_URL for testing. */
function feedUrl() {
  if (process.env.DRYCARE_UPDATE_URL) return process.env.DRYCARE_UPDATE_URL;
  const file = path.join(process.resourcesPath, "update.json");
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { url?: string }).url || null : null;
  } catch {
    return null;
  }
}

const notes = (value: unknown) => {
  const text = typeof value === "string" ? value : Array.isArray(value) ? value.map((n: { note?: string }) => n.note ?? "").join("\n") : "";
  return text.replace(/<[^>]+>/g, "").trim();
};

let manual = false;
let busy = false;

export function setupUpdates({ window, log, backup }: Options) {
  const url = feedUrl();
  const ready = app.isPackaged && Boolean(url);
  if (ready) {
    autoUpdater.setFeedURL({ provider: "generic", url: url! });
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.logger = { info: (m: unknown) => log("update:", m), warn: (m: unknown) => log("update:", m), error: (m: unknown) => log("update error:", m), debug: () => {} };
    // For an automated test of the download, which has nobody to press the buttons.
    const unattended = process.env.DRYCARE_UPDATE_UNATTENDED === "1";

    autoUpdater.on("update-available", async (info) => {
      const w = window();
      log(`update: version ${info.version} is available`);
      if (unattended) return void autoUpdater.downloadUpdate();
      const options = {
        type: "info" as const,
        title: "Update available",
        message: `Drycare ${info.version} is available`,
        detail: `You have version ${app.getVersion()}.\n\n${notes(info.releaseNotes) || "This version brings the latest screens and fixes."}\n\nYour data is not changed by downloading. It is backed up before installing.`,
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      };
      const { response } = w ? await dialog.showMessageBox(w, options) : await dialog.showMessageBox(options);
      if (response === 0) {
        busy = true;
        void autoUpdater.downloadUpdate().catch((e: Error) => log("update error:", e.message));
      }
    });

    autoUpdater.on("update-not-available", () => {
      log("update: this is the latest version");
      if (!manual) return;
      manual = false;
      const w = window();
      if (w) void dialog.showMessageBox(w, { type: "info", title: "No update", message: "You have the latest version", detail: `Drycare ${app.getVersion()}` });
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
      log(`update: version ${info.version} downloaded and checked`);
      if (unattended) return;
      const options = {
        type: "info" as const,
        title: "Ready to install",
        message: `Drycare ${info.version} is ready to install`,
        detail: "Drycare will back up your data, close, install the update and open again. This takes about a minute.",
        buttons: ["Install now", "Later"],
        defaultId: 0,
        cancelId: 1,
      };
      const { response } = w ? await dialog.showMessageBox(w, options) : await dialog.showMessageBox(options);
      if (response !== 0) return;
      try {
        await backup();
      } catch (e) {
        // No backup, no install: the old version keeps working and nothing is lost.
        log("update: backup before installing failed", e);
        dialog.showErrorBox("Update not installed", `Your data could not be backed up, so the update was not installed. Drycare will keep working as it is.\n\n${(e as Error).message}`);
        return;
      }
      autoUpdater.quitAndInstall(true, true);
    });

    autoUpdater.on("error", (e) => {
      busy = false;
      const w = window();
      w?.setProgressBar(-1);
      w?.setTitle("Drycare");
      log("update error:", e.message);
      if (!manual) return; // No internet is normal for a PC; only say so when someone asked.
      manual = false;
      if (w) void dialog.showMessageBox(w, { type: "warning", title: "Could not check for updates", message: "Could not reach the update service", detail: "Check the internet connection and try again. Drycare keeps working without it." });
    });

    const quietCheck = () => {
      if (!busy) void autoUpdater.checkForUpdates().catch((e: Error) => log("update error:", e.message));
    };
    setTimeout(quietCheck, 30_000);
    setInterval(quietCheck, SIX_HOURS);
  }

  /** Help > Check for updates. */
  return function checkNow() {
    const w = window();
    if (!ready) {
      if (w) void dialog.showMessageBox(w, { type: "info", title: "Updates", message: app.isPackaged ? "Updates are not set up for this copy" : "Updates work only in an installed copy", detail: `Drycare ${app.getVersion()}. Ask your Drycare provider for the latest installer.` });
      return;
    }
    manual = true;
    void autoUpdater.checkForUpdates().catch((e: Error) => log("update error:", e.message));
  };
}
