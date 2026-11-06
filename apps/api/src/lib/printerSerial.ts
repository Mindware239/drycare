/**
 * Asks a USB printer for its own serial number, on a PC. Windows does not know it (a TSC P210 shows as 000001), but a
 * TSC printer answers the TSPL query OUT "";_SERIAL$ over USB without printing anything.
 *
 * Only TSC printers are asked, by USB vendor ID 1203: another brand might print the question as text on a tag.
 */
import { execFile } from "node:child_process";
import { env } from "../env";

const READ_SERIAL = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class DrycareTsc {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool CancelIoEx(SafeFileHandle h, IntPtr o);
  public static string Ask(string path, string command, int waitMs) {
    var h = CreateFile(path, 0xC0000000, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
    if (h.IsInvalid) return "";
    var sb = new StringBuilder();
    var fs = new FileStream(h, FileAccess.ReadWrite, 1, true);
    try {
      var data = Encoding.ASCII.GetBytes(command + "\\r\\n");
      var w = fs.BeginWrite(data, 0, data.Length, null, null);
      if (!w.AsyncWaitHandle.WaitOne(2000)) return "";
      fs.EndWrite(w);
      var deadline = DateTime.UtcNow.AddMilliseconds(waitMs);
      var buf = new byte[256];
      while (DateTime.UtcNow < deadline && sb.ToString().IndexOf('\\n') < 0) {
        var r = fs.BeginRead(buf, 0, buf.Length, null, null);
        if (!r.AsyncWaitHandle.WaitOne(1200)) { CancelIoEx(h, IntPtr.Zero); try { fs.EndRead(r); } catch { } break; }
        var n = fs.EndRead(r);
        if (n > 0) sb.Append(Encoding.ASCII.GetString(buf, 0, n));
      }
    } finally { CancelIoEx(h, IntPtr.Zero); try { fs.Dispose(); } catch { } }
    return sb.ToString();
  }
}
"@
$printer = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $env:DRYCARE_PRINTER } | Select-Object -First 1
if (-not $printer -or $printer.PortName -notmatch '^([A-Za-z]+?)(\\d+)$') { exit 0 }
$base = $Matches[1]; $number = [int]$Matches[2]
$root = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\DeviceClasses\\{28d78fad-5a12-11d1-ae5b-0000f803a8c2}'
foreach ($key in Get-ChildItem $root) {
  if ($key.PSChildName -notmatch 'VID_1203') { continue }
  $params = Get-ItemProperty -Path ("Registry::" + $key.Name + "\\#\\Device Parameters") -ErrorAction SilentlyContinue
  if ($params -and $params.'Base Name' -eq $base -and [int]$params.'Port Number' -eq $number) {
    [DrycareTsc]::Ask(($key.PSChildName -replace '^##\\?#', '\\\\?\\'), 'OUT "";_SERIAL$', 2500)
    exit 0
  }
}
`;

/** The serial number the printer itself reports, or null if it did not answer: not a TSC printer, unplugged or busy. */
export function readPrinterSerial(printerName: string): Promise<string | null> {
  if (env.DRYCARE_MODE !== "desktop" || process.platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    const encoded = Buffer.from(READ_SERIAL, "utf16le").toString("base64");
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { env: { ...process.env, DRYCARE_PRINTER: printerName }, timeout: 15_000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const serial = stdout.trim().toUpperCase().replace(/\s+/g, "");
      resolve(/^[A-Z0-9-]{4,80}$/.test(serial) ? serial : null);
    });
  });
}
