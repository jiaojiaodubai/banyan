[CmdletBinding()]
param(
  [string[]]$OfficeVersions = @("16.0")
)

$ErrorActionPreference = "Stop"

$catalogId = "{215c818a-2712-432e-8d3f-098c48b7a755}"
$legacyCatalogId = "BanyanWordAddin"
$shareName = "BanyanWordAddin"
$catalogDir = Join-Path $env:LOCALAPPDATA "Banyan\WordAddinCatalog"

function Write-Step {
  param([string]$Message)
  Write-Host "[Banyan] $Message" -ForegroundColor Cyan
}

function Remove-RegistryCatalog {
  param(
    [string]$Version,
    [string]$CatalogName
  )

  $parent = "HKCU:\Software\Microsoft\Office\$Version\WEF\TrustedCatalogs"
  $target = Join-Path $parent $CatalogName
  if (-not (Test-Path -LiteralPath $target)) {
    Write-Step "Registry entry not present: $target"
    return
  }

  Remove-Item -LiteralPath $target -Recurse -Force
  Write-Step "Removed registry entry: $target"
}

Write-Step "Resetting Banyan Word add-in catalog artifacts."

foreach ($version in $OfficeVersions) {
  Remove-RegistryCatalog -Version $version -CatalogName $catalogId
  Remove-RegistryCatalog -Version $version -CatalogName $legacyCatalogId
}

if (Get-Command Get-SmbShare -ErrorAction SilentlyContinue) {
  $share = Get-SmbShare -Name $shareName -ErrorAction SilentlyContinue
  if ($share) {
    Write-Step "Removing SMB share: $shareName"
    Remove-SmbShare -Name $shareName -Force
  } else {
    Write-Step "SMB share not present: $shareName"
  }
} else {
  Write-Step "SMBShare cmdlets unavailable; trying net share."
  & net.exe share $shareName /delete | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Step "Removed share with net share: $shareName"
  } else {
    Write-Step "Share not present or could not be removed with net share: $shareName"
  }
}

if (Test-Path -LiteralPath $catalogDir) {
  Write-Step "Removing local catalog directory: $catalogDir"
  Remove-Item -LiteralPath $catalogDir -Recurse -Force
} else {
  Write-Step "Local catalog directory not present: $catalogDir"
}

Write-Step "Done."
