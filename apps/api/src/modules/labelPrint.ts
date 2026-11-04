import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { buildTsplJob, bytesPerRow } from "@drycare/shared";
import { env } from "../env";
import { requirePermission } from "../lib/context";
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

const printBody = z.object({
  printer: z.string().trim().min(1).max(200),
  widthMm: z.number().min(20).max(150),
  heightMm: z.number().min(15).max(150),
  gapMm: z.number().min(0).max(25),
  density: z.number().int().min(0).max(15),
  speed: z.number().int().min(1).max(6),
  copies: z.number().int().min(1).max(5),
  labels: z.array(z.object({ widthDots: z.number().int().min(8).max(1600), heightDots: z.number().int().min(8).max(1600), data: z.string().min(1) })).min(1).max(30),
});

export async function labelPrintRoutes(app: FastifyInstance) {
  /** Direct printing exists only in the PC edition, where the server and the printer share a computer. */
  app.get("/labels/printers", async (req) => {
    requirePermission(req, "orders.read");
    if (!available()) return { available: false, printers: [] };
    return { available: true, printers: await listPrinters() };
  });

  app.post("/labels/print", async (req) => {
    requirePermission(req, "orders.read");
    if (!available()) throw badRequest("Direct printing is available in Drycare for PC. Use the print dialog here.");
    const body = printBody.parse(req.body);
    const printer = (await listPrinters()).find((p) => p.name === body.printer);
    if (!printer) throw badRequest(`Printer "${body.printer}" was not found on this PC.`);
    if (printer.offline) throw new AppError(409, "PRINTER_OFFLINE", `${printer.name} is offline. Check that it is switched on and its USB cable is connected, then try again.`);

    const job = buildTsplJob({
      ...body,
      labels: body.labels.map((label) => {
        const bitmap = Buffer.from(label.data, "base64");
        if (bitmap.length !== bytesPerRow(label.widthDots) * label.heightDots) throw badRequest("A tag image has the wrong size.");
        return { widthDots: label.widthDots, heightDots: label.heightDots, bitmap };
      }),
    });
    const file = path.join(tmpdir(), `drycare-tags-${randomUUID()}.bin`);
    try {
      await writeFile(file, job);
      await powershell(SEND_RAW, { DRYCARE_PRINTER: printer.name, DRYCARE_PRINT_FILE: file }, 60_000);
    } catch (err) {
      req.log.error({ err }, "direct label print failed");
      throw new AppError(502, "PRINT_FAILED", "The tags could not be sent to the printer. Check the printer and try again.");
    } finally {
      await rm(file, { force: true }).catch(() => undefined);
    }
    return { sent: body.labels.length * body.copies };
  });
}
