# Shows whether a file carries a valid Authenticode signature. Exits 1 if it does not.
param([Parameter(Mandatory = $true)][string]$Path)
$s = Get-AuthenticodeSignature -FilePath $Path
Write-Output "File:      $Path"
Write-Output "Status:    $($s.Status)"
if ($s.SignerCertificate) {
  Write-Output "Publisher: $($s.SignerCertificate.Subject)"
  Write-Output "Valid:     $($s.SignerCertificate.NotBefore) to $($s.SignerCertificate.NotAfter)"
} else {
  Write-Output "Publisher: none (this file is not code-signed)"
}
if ($s.Status -ne 'Valid') { exit 1 }
