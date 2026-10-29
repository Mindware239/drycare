<#
  DryCare for PC startup test. Run: pnpm desktop:startup-test   (after: pnpm --filter @drycare/desktop build)

  Launches the desktop app twice in a throwaway data folder (never touches %APPDATA%\DryCare or the
  real "DryCare Backups" folder):
    1. First launch  - creates the database (initdb) - must reach the main window within the limit.
    2. Normal launch - with the preferred database ports deliberately occupied, so the fallback to a
                       Windows-assigned port is exercised on every PC - must also be within the limit.
  Each run is closed through the window (clean PostgreSQL shutdown) and checked for it.
  Pass -Exe to test an installed/unpacked DryCare.exe instead of the staged app.
#>
param(
  [double]$LimitSeconds = 20,
  [string]$Exe = ""
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Exe) {
  $electron = Join-Path $repo "apps\desktop\node_modules\electron\dist\electron.exe"
  $stage = Join-Path $repo "apps\desktop\stage\app"
  if (-not (Test-Path (Join-Path $stage "main.mjs"))) { throw "Staged app not found. Run: pnpm --filter @drycare/desktop build" }
  $cmd = $electron; $cmdArgs = @($stage); $procName = "electron"
} else {
  $cmd = $Exe; $cmdArgs = @(); $procName = [IO.Path]::GetFileNameWithoutExtension($Exe)
}
if (Get-Process $procName -ErrorAction SilentlyContinue) { throw "$procName is already running. Close it first." }

$work = Join-Path ([IO.Path]::GetTempPath()) ("drycare-startup-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$env:DRYCARE_USER_DATA = Join-Path $work "data"
$env:DRYCARE_BACKUP_DIR = Join-Path $work "backups"
$log = Join-Path $env:DRYCARE_USER_DATA "logs\drycare.log"
$failures = 0
$results = @()

function Launch([string]$label) {
  $before = if (Test-Path $log) { (Get-Content $log).Count } else { 0 }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = if ($cmdArgs.Count) { Start-Process $cmd -ArgumentList $cmdArgs -PassThru } else { Start-Process $cmd -PassThru }
  $ready = $null; $window = $null
  while ($sw.Elapsed.TotalSeconds -lt ($LimitSeconds + 40)) {
    $lines = if (Test-Path $log) { Get-Content $log | Select-Object -Skip $before } else { @() }
    if ($lines -match "Startup failed") { break }
    if (-not $ready -and ($lines -match "DryCare running")) { $ready = $sw.Elapsed.TotalSeconds }
    if ($ready -and -not $window) {
      $w = Get-Process $procName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*DryCare*" }
      if ($w) { $window = $sw.Elapsed.TotalSeconds; break }
    }
    Start-Sleep -Milliseconds 200
  }
  $lines = if (Test-Path $log) { Get-Content $log | Select-Object -Skip $before } else { @() }
  Start-Sleep -Seconds 2
  Get-Process $procName -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Process $procName -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
  $exited = -not (Get-Process $procName -ErrorAction SilentlyContinue)
  if (-not $exited) { Get-Process $procName -ErrorAction SilentlyContinue | Stop-Process -Force }
  $after = if (Test-Path $log) { Get-Content $log | Select-Object -Skip $before } else { @() }
  [pscustomobject]@{
    Label = $label; Window = $window; Server = $ready; Exited = $exited
    CleanShutdown = [bool]($after -match "database system is shut down")
    PortFallback = ($lines -match "unavailable \(reserved by Windows or in use\)") -join " "
    Error = ($lines -match "Startup failed") -join " "
  }
}

function Check([string]$label, [bool]$ok, [string]$detail = "") {
  if ($ok) { $script:results += "  OK   $label" } else { $script:failures++; $script:results += "  FAIL $label $detail" }
}

try {
  $first = Launch "first launch (creates the database)"
  Check "first launch reaches the main window within $LimitSeconds s ($([math]::Round([double]$first.Window, 1)) s)" ($first.Window -and $first.Window -lt $LimitSeconds) $first.Error
  Check "first launch closes with a clean database shutdown" ($first.Exited -and $first.CleanShutdown)

  # Occupy the 20 preferred database ports so the app must ask Windows for another one.
  $cfg = Get-Content (Join-Path $env:DRYCARE_USER_DATA "config.json") -Raw | ConvertFrom-Json
  $held = @()
  foreach ($port in $cfg.pgPort..($cfg.pgPort + 19)) {
    try { $l = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port); $l.Start(); $held += $l } catch { }
  }
  $second = Launch "normal launch (preferred ports blocked)"
  $held | ForEach-Object { $_.Stop() }
  Check "normal launch reaches the main window within $LimitSeconds s ($([math]::Round([double]$second.Window, 1)) s)" ($second.Window -and $second.Window -lt $LimitSeconds) $second.Error
  Check "blocked database ports fall back to a free port" ([bool]$second.PortFallback)
  Check "normal launch closes with a clean database shutdown" ($second.Exited -and $second.CleanShutdown)
  $backups = @(Get-ChildItem $env:DRYCARE_BACKUP_DIR -Filter *.dcbak -ErrorAction SilentlyContinue)
  Check "automatic backup written ($($backups.Count) file(s))" ($backups.Count -ge 1)
  if ($backups.Count) {
    $capture = node (Join-Path $PSScriptRoot "backup-capture-flag.cjs") $backups[0].FullName
    Check "an unlinked PC records nothing for upload (capture off until linked)" ($capture -eq "off") $capture
  }
} finally {
  Remove-Item Env:DRYCARE_USER_DATA, Env:DRYCARE_BACKUP_DIR -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

"DryCare startup test"
$results
""
if ($failures) { "$failures CHECK(S) FAILED"; exit 1 } else { "ALL CHECKS PASSED"; exit 0 }
