/**
 * Getting back to the working version if an update does not come up healthy. Before installing, the app folder is copied
 * aside and a small watchdog starts, separate from Drycare. If the new version does not report healthy in time, the
 * watchdog puts the old folder back and starts it.
 *
 * Only the program is restored, never the database. Migrations only add to the database, so an older version keeps
 * working on it, and a backup was taken before installing in case someone needs to restore by hand.
 */
export type RollbackPaths = { appDir: string; copyDir: string; exeName: string; healthFile: string; resultFile: string; toVersion: string; fromVersion: string; waitSeconds: number };

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function rollbackScript(p: RollbackPaths) {
  return `$ErrorActionPreference = 'Continue'
$appDir = ${q(p.appDir)}; $copyDir = ${q(p.copyDir)}; $exeName = ${q(p.exeName)}; $health = ${q(p.healthFile)}; $result = ${q(p.resultFile)}
$to = ${q(p.toVersion)}; $from = ${q(p.fromVersion)}
$deadline = (Get-Date).AddSeconds(${p.waitSeconds})
while ((Get-Date) -lt $deadline) {
  if (Test-Path $health) {
    $h = Get-Content $health -Raw -ErrorAction SilentlyContinue
    if ($h -match [regex]::Escape($to)) {
      Remove-Item -Recurse -Force $copyDir -ErrorAction SilentlyContinue
      Remove-Item -Force $health -ErrorAction SilentlyContinue
      exit 0
    }
  }
  Start-Sleep -Seconds 3
}
# Never came up healthy: close whatever is running from this folder, then put the old version back.
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($appDir, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
& robocopy $copyDir $appDir /MIR /R:3 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
$ok = $LASTEXITCODE -lt 8
$stamp = (Get-Date).ToString('o')
@{ from = $from; to = $to; restored = $ok; at = $stamp } | ConvertTo-Json | Set-Content -Path $result -Encoding UTF8
if ($ok) { Start-Process -FilePath (Join-Path $appDir $exeName); Remove-Item -Recurse -Force $copyDir -ErrorAction SilentlyContinue }
`;
}
