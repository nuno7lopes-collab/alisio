param(
  [string]$Source = (Join-Path $PSScriptRoot "..\..\..\ui\dist"),
  [string]$Destination = (Join-Path $PSScriptRoot "..\src\Alisio.WindowsHost\Assets\Shell")
)

$ErrorActionPreference = "Stop"

$resolvedSource = Resolve-Path $Source
$indexPath = Join-Path $resolvedSource "index.html"

if (-not (Test-Path $indexPath)) {
  throw "Expected built shell assets at '$indexPath'. Run 'pnpm ui:build' first."
}

if (Test-Path $Destination) {
  Remove-Item $Destination -Recurse -Force
}

New-Item -ItemType Directory -Path $Destination -Force | Out-Null
Copy-Item (Join-Path $resolvedSource "*") $Destination -Recurse -Force

Write-Host "Staged Windows shell assets from '$resolvedSource' to '$Destination'."
