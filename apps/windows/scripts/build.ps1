param(
  [switch]$StageShell
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$solution = Join-Path $PSScriptRoot "..\Alisio.WindowsHost.sln"

if ($StageShell) {
  & (Join-Path $PSScriptRoot "stage-shell.ps1")
}

Push-Location $repoRoot
try {
  dotnet restore $solution
  dotnet build $solution -c Debug
} finally {
  Pop-Location
}
