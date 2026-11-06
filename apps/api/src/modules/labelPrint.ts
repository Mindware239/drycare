import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { assertSamePrinter, usablePrinterNames } from "./printerRegistry";
import { BASIC_TAG_SIZE, buildTsplJob, bytesPerRow, isPrinterApproved } from "@drycare/shared";
import { db, schema } from "../db/client";
import { env } from "../env";
import { requireAuth, requirePermission } from "../lib/context";
import { hardwarePolicy, hasFeature } from "../lib/entitlements";
import { AppError, badRequest } from "../lib/errors";

type Printer = {
  name: string;
  offline: boolean;
  isDefault: boolean;
  driver: string | null;
  port: string | null;
  status: string;
  dpi: number | null;
  /** The paper size set in the Windows driver, in mm. Direct printing does not depend on it. */
  driverPaper: { widthMm: number; heightMm: number } | null;
  waitingJobs: number;
};

const PRINTER_STATUS: Record<number, string> = { 1: "Unknown", 2: "Unknown", 3: "Ready", 4: "Printing", 5: "Warming up", 6: "Stopped", 7: "Offline" };

const LIST_PRINTERS = `
$config = @{}; Get-CimInstance Win32_PrinterConfiguration | ForEach-Object { $config[$_.Name] = $_ }
$jobs = @{}; Get-CimInstance Win32_PrintJob | ForEach-Object { $n = ($_.Name -split ',')[0]; $jobs[$n] = 1 + [int]$jobs[$n] }
Get-CimInstance Win32_Printer | ForEach-Object {
  $c = $config[$_.Name]
  [pscustomobject]@{
    name = $_.Name; offline = [bool]$_.WorkOffline; isDefault = [bool]$_.Default; driver = $_.DriverName; port = $_.PortName; statusCode = [int]$_.PrinterStatus
    dpi = $(if ($c) { [int]$c.XResolution } else { 0 }); paperWidth = $(if ($c) { [int]$c.PaperWidth } else { 0 }); paperLength = $(if ($c) { [int]$c.PaperLength } else { 0 })
    waitingJobs = [int]$jobs[$_.Name]
  }
} | ConvertTo-Json -Compress
`;

/** Runs a PowerShell script. Values reach it through environment variables, never by pasting them into the script. */
function powershell(script: string, values: Record<string, string> = {}, timeout = 30_000) {
  return new Promise<string>((resolve, reject) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { env: { ...process.env, ...values }, timeout, windowsHide: true, maxBuffer: 1_000_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

async function listPrinters(): Promise<Printer[]> {
  const out = await powershell(LIST_PRINTERS);
  if (!out) return [];
  type Raw = { name: string; offline: boolean; isDefault: boolean; driver: string | null; port: string | null; statusCode: number; dpi: number; paperWidth: number; paperLength: number; waitingJobs: number };
  const parsed = JSON.parse(out) as Raw | Raw[];
  return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({
    name: p.name, offline: p.offline, isDefault: p.isDefault, driver: p.driver, port: p.port,
    status: p.offline ? "Offline" : PRINTER_STATUS[p.statusCode] ?? "Unknown",
    dpi: p.dpi > 0 ? p.dpi : null,
    // Windows reports paper size in tenths of a millimetre.
    driverPaper: p.paperWidth > 0 && p.paperLength > 0 ? { widthMm: p.paperWidth / 10, heightMm: p.paperLength / 10 } : null,
    waitingJobs: p.waitingJobs,
  }));
}

/** Sends bytes to the printer exactly as they are, so the Windows driver cannot resize or re-draw the tag. */
const SEND_RAW = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DrycareRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr handle, byte[] data, int size, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Exception("Could not open the printer (" + Marshal.GetLastWin32Error() + ")");
    try {
      if (StartDocPrinter(handle, 1, new DOCINFO { pDocName = "Drycare tags", pDataType = "RAW" }) == 0) throw new Exception("The printer did not accept the job (" + Marshal.GetLastWin32Error() + ")");
      StartPagePrinter(handle);
      int written;
      bool ok = WritePrinter(handle, data, data.Length, out written);
      EndPagePrinter(handle);
      EndDocPrinter(handle);
      if (!ok || written != data.Length) throw new Exception("The tags could not be sent to the printer (" + Marshal.GetLastWin32Error() + ")");
    } finally { ClosePrinter(handle); }
  }
}
"@
[DrycareRawPrint]::Send($env:DRYCARE_PRINTER, [IO.File]::ReadAllBytes($env:DRYCARE_PRINT_FILE))
`;

const available = () => env.DRYCARE_MODE === "desktop" && process.platform === "win32";

const JOB_NAME = "Drycare tags";
/** A job still here after this long is not moving: the printer usually needs attention. */
const STUCK_AFTER_SECONDS = 25;
type RawJob = { id: number; document: string; status: string };

const READ_QUEUE = `
$printer = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $env:DRYCARE_PRINTER }
$jobs = @(Get-PrintJob -PrinterName $env:DRYCARE_PRINTER -ErrorAction SilentlyContinue | Where-Object { [string]$_.JobStatus -notlike '*Printed*' } | ForEach-Object {
  [pscustomobject]@{ id = [int]$_.Id; document = $_.DocumentName; status = [string]$_.JobStatus }
})
[pscustomobject]@{ found = [bool]$printer; offline = [bool]$printer.WorkOffline; errorState = [int]$printer.DetectedErrorState; jobs = $jobs } | ConvertTo-Json -Compress -Depth 4
`;
/** Only removes DryCare's own jobs. Anything else in the queue belongs to someone else. */
/** Windows' codes for a printer that needs attention. Many label printer drivers never report them, so a stuck job is checked too. */
const PRINTER_PROBLEM: Record<number, string> = {
  4: "The printer is out of tags. Load the roll and press FEED.",
  6: "The ribbon has finished. Replace it and press FEED.",
  7: "The printer cover is open. Close it and press FEED.",
  8: "A tag is jammed. Clear it and press FEED.",
  9: "The printer is offline. Check that it is on and the USB cable is connected.",
  10: "The printer needs attention. Check its light and press FEED.",
};
/** When each waiting job was first seen. Counting from here avoids depending on how Windows reports time zones. */
const firstSeen = new Map<string, number>();
const CLEAR_QUEUE = `
$removed = 0
Get-PrintJob -PrinterName $env:DRYCARE_PRINTER -ErrorAction SilentlyContinue | Where-Object { $_.DocumentName -eq '${JOB_NAME}' } | ForEach-Object { Remove-PrintJob -InputObject $_; $removed++ }
$removed
`;

/** Requests already handled, so a double click or a retry cannot print the same tags twice. */
const handled = new Map<string, { at: number; sent: number }>();
const REMEMBER_MS = 5 * 60_000;
const forgetOld = () => { const cutoff = Date.now() - REMEMBER_MS; for (const [key, value] of handled) if (value.at < cutoff) handled.delete(key); };

const printBody = z.object({
  printer: z.string().trim().min(1).max(200),
  widthMm: z.number().min(20).max(150),
  heightMm: z.number().min(15).max(150),
  gapMm: z.number().min(0).max(25),
  density: z.number().int().min(0).max(15),
  speed: z.number().int().min(1).max(6),
  copies: z.number().int().min(1).max(5),
  /** Sent again with the same value, the tags are not printed again. */
  requestId: z.string().trim().min(8).max(100).optional(),
  labels: z.array(z.object({ widthDots: z.number().int().min(8).max(1600), heightDots: z.number().int().min(8).max(1600), data: z.string().min(1) })).min(1).max(30),
});

export async function labelPrintRoutes(app: FastifyInstance) {
  /** Direct printing exists only in the PC edition, where the server and the printer share a computer. */
  app.get("/labels/printers", async (req) => {
    const auth = requirePermission(req, "orders.read");
    if (!available()) return { available: false, printers: [] };
    const policy = await hardwarePolicy();
    const list = await listPrinters();
    // A key listing Mindware's sold printers: only those connected with their serial and bill number may print.
    if (policy.soldPrinters) {
      const connected = await usablePrinterNames(auth.orgId);
      return { available: true, restricted: true, needsConnecting: true, printers: list.map((p) => ({ ...p, approved: connected.has(p.name) })) };
    }
    return { available: true, restricted: policy.printers.length > 0, needsConnecting: false, printers: list.map((p) => ({ ...p, approved: isPrinterApproved(p, policy.printers) })) };
  });

  /** The printer and scanner models the software owner accepts, for the setup screens. */
  app.get("/labels/hardware", async (req) => {
    requireAuth(req);
    return hardwarePolicy();
  });

  /** What Windows knows about this printer's queue. It cannot see inside the printer, so a stuck job is the best signal. */
  app.get("/labels/queue", async (req) => {
    requirePermission(req, "orders.read");
    if (!available()) return { available: false, jobs: [], stuck: false, problem: null, offline: false };
    const { printer } = z.object({ printer: z.string().trim().min(1).max(200) }).parse(req.query);
    const raw = JSON.parse(await powershell(READ_QUEUE, { DRYCARE_PRINTER: printer })) as { found: boolean; offline: boolean; errorState: number; jobs: RawJob[] | RawJob | null };
    const waiting = raw.jobs ? (Array.isArray(raw.jobs) ? raw.jobs : [raw.jobs]) : [];
    const now = Date.now();
    const keys = new Set(waiting.map((j) => `${printer}:${j.id}`));
    for (const key of firstSeen.keys()) if (key.startsWith(`${printer}:`) && !keys.has(key)) firstSeen.delete(key);
    const jobs = waiting.map((j) => {
      const key = `${printer}:${j.id}`;
      if (!firstSeen.has(key)) firstSeen.set(key, now);
      return { ...j, ageSeconds: Math.round((now - firstSeen.get(key)!) / 1000) };
    });
    return {
      available: true,
      found: raw.found,
      offline: raw.offline,
      jobs,
      stuck: jobs.some((j) => j.ageSeconds > STUCK_AFTER_SECONDS),
      problem: PRINTER_PROBLEM[raw.errorState] ?? (jobs.some((j) => /error|paper|blocked|intervention|offline/i.test(j.status)) ? "The printer has stopped. Check the roll, ribbon and cover, then press FEED." : null),
    };
  });

  app.post("/labels/queue/clear", async (req) => {
    requirePermission(req, "orders.read");
    if (!available()) throw badRequest("The print queue can only be managed in Drycare for PC.");
    const { printer } = z.object({ printer: z.string().trim().min(1).max(200) }).parse(req.body);
    if (!(await listPrinters()).some((p) => p.name === printer)) throw badRequest(`Printer "${printer}" was not found on this PC.`);
    return { removed: Number(await powershell(CLEAR_QUEUE, { DRYCARE_PRINTER: printer })) || 0 };
  });

  app.post("/labels/print", async (req) => {
    const auth = requirePermission(req, "orders.read");
    if (!available()) throw badRequest("Direct printing is available in Drycare for PC. Use the print dialog here.");
    const body = printBody.parse(req.body);
    if ((body.widthMm !== BASIC_TAG_SIZE.widthMm || body.heightMm !== BASIC_TAG_SIZE.heightMm) && !(await hasFeature(auth.orgId, "labelDesigner"))) {
      throw new AppError(403, "FEATURE_NOT_IN_PLAN", `Your plan prints the ${BASIC_TAG_SIZE.widthMm} × ${BASIC_TAG_SIZE.heightMm} mm taffeta tag. Upgrade on Plan & billing to use other tag sizes.`, [{ feature: "labelDesigner" }]);
    }
    forgetOld();
    const requestKey = body.requestId ? `${auth.orgId}:${body.requestId}` : null;
    const earlier = requestKey ? handled.get(requestKey) : undefined;
    if (earlier) return { sent: earlier.sent, duplicate: true };
    const printer = (await listPrinters()).find((p) => p.name === body.printer);
    if (!printer) throw badRequest(`Printer "${body.printer}" was not found on this PC.`);
    const policy = await hardwarePolicy();
    if (policy.soldPrinters && !(await usablePrinterNames(auth.orgId)).has(printer.name)) throw new AppError(403, "PRINTER_NOT_APPROVED", `${printer.name} is not connected. Enter the serial number and bill number of this Mindware printer first.`);
    if (!policy.soldPrinters && !isPrinterApproved(printer, policy.printers)) throw new AppError(403, "PRINTER_NOT_APPROVED", `${printer.name} is not on the approved printer list. Contact Drycare support to have this printer approved.`);
    if (printer.offline) throw new AppError(409, "PRINTER_OFFLINE", `${printer.name} is offline. Check that it is switched on and its USB cable is connected, then try again.`);
    if (policy.soldPrinters) await assertSamePrinter(auth.orgId, printer.name, printer.waitingJobs);

    const job = buildTsplJob({
      ...body,
      labels: body.labels.map((label) => {
        const bitmap = Buffer.from(label.data, "base64");
        if (bitmap.length !== bytesPerRow(label.widthDots) * label.heightDots) throw badRequest("A tag image has the wrong size.");
        return { widthDots: label.widthDots, heightDots: label.heightDots, bitmap };
      }),
    });
    const file = path.join(tmpdir(), `drycare-tags-${randomUUID()}.bin`);
    const sent = body.labels.length * body.copies;
    // Remembered before sending, so a second click arriving mid-print is also refused.
    if (requestKey) handled.set(requestKey, { at: Date.now(), sent });
    try {
      await writeFile(file, job);
      await powershell(SEND_RAW, { DRYCARE_PRINTER: printer.name, DRYCARE_PRINT_FILE: file }, 60_000);
    } catch (err) {
      if (requestKey) handled.delete(requestKey);
      req.log.error({ err }, "direct label print failed");
      throw new AppError(502, "PRINT_FAILED", "The tags could not be sent to the printer. Check the printer and try again.");
    } finally {
      await rm(file, { force: true }).catch(() => undefined);
    }
    return { sent };
  });
}
