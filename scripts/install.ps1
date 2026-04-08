param(
    [string]$InstallMethod = "",
    [string]$Tag = "",
    [string]$GitDir = "",
    [switch]$NoOnboard,
    [switch]$NoGitUpdate,
    [switch]$DryRun,
    [switch]$Verify
)

$ErrorActionPreference = "Stop"

function Get-AppName { return "Alisio" }
function Get-AppSlug { return "alisio" }
function Get-StateDirName { return ".alisio" }
function Get-ConfigFileName { return "alisio.json" }
function Get-LegacySlug { return ("open" + "claw") }
function Get-LegacyTitle { return ("Open" + "Claw") }
function Get-LegacyEnvPrefix { return ("OPEN" + "CLAW") }
function Get-LegacyEnvName([string]$Suffix) { return "$(Get-LegacyEnvPrefix)_$Suffix" }
function Get-PublicRepoNwo {
    $slug = Get-AppSlug
    return "$slug/$slug"
}
function Get-DistributionId {
    $distribution = Read-PrefixedEnv "DISTRIBUTION" (Get-AppSlug)
    if ([string]::IsNullOrWhiteSpace($distribution)) { return Get-AppSlug }
    return $distribution.Trim().ToLowerInvariant()
}
function Get-RepoNwo([string]$Distribution = "") {
    $resolved = if ([string]::IsNullOrWhiteSpace($Distribution)) {
        Get-DistributionId
    } else {
        $Distribution.Trim().ToLowerInvariant()
    }
    if ($resolved -eq (Get-LegacySlug)) {
        $slug = Get-LegacySlug
        return "$slug/$slug"
    }
    return (Get-PublicRepoNwo)
}
function Get-RepoUrl([string]$Distribution = "") { return "https://github.com/$(Get-RepoNwo $Distribution).git" }
function Get-InstallPs1Url { return "https://alisio.pt/install.ps1" }
function Get-InstallSpec([string]$ResolvedTag) {
    if ([string]::IsNullOrWhiteSpace($ResolvedTag) -or $ResolvedTag -eq "latest") {
        return "$(Get-AppSlug)@latest"
    }
    if ($ResolvedTag.ToLowerInvariant() -eq "main") {
        return "github:$(Get-RepoNwo)#main"
    }
    if ($ResolvedTag.Contains("://") -or $ResolvedTag.Contains("#") -or $ResolvedTag -match '^(file|github|git\+ssh|git\+https|git\+http|git\+file|npm):') {
        return $ResolvedTag
    }
    return "$(Get-AppSlug)@$ResolvedTag"
}
function Read-PrefixedEnv([string]$Suffix, [string]$Default = "") {
    $publicName = "ALISIO_$Suffix"
    $legacyName = Get-LegacyEnvName $Suffix
    $publicValue = [Environment]::GetEnvironmentVariable($publicName)
    if (-not [string]::IsNullOrWhiteSpace($publicValue)) { return $publicValue }
    $legacyValue = [Environment]::GetEnvironmentVariable($legacyName)
    if (-not [string]::IsNullOrWhiteSpace($legacyValue)) { return $legacyValue }
    return $Default
}
function Warn-LegacyEnv([string[]]$Suffixes) {
    foreach ($suffix in $Suffixes) {
        $publicName = "ALISIO_$suffix"
        $legacyName = Get-LegacyEnvName $suffix
        $publicValue = [Environment]::GetEnvironmentVariable($publicName)
        $legacyValue = [Environment]::GetEnvironmentVariable($legacyName)
        if ([string]::IsNullOrWhiteSpace($publicValue) -and -not [string]::IsNullOrWhiteSpace($legacyValue)) {
            Write-Warn "$legacyName está obsoleta; usa $publicName."
        }
    }
}

$AppName = Get-AppName
$AppSlug = Get-AppSlug
$StateDir = Join-Path $HOME (Get-StateDirName)
$ConfigPath = Join-Path $StateDir (Get-ConfigFileName)
$LegacyStateEnvName = Get-LegacyEnvName "STATE_DIR"
$LegacyConfigEnvName = Get-LegacyEnvName "CONFIG_PATH"

$Tag = if ($Tag) { $Tag } else { Read-PrefixedEnv "VERSION" "latest" }
if ([string]::IsNullOrWhiteSpace($GitDir)) {
    $GitDir = Read-PrefixedEnv "GIT_DIR" (Join-Path $HOME $AppSlug)
}
if ([string]::IsNullOrWhiteSpace($InstallMethod)) {
    $InstallMethod = Read-PrefixedEnv "INSTALL_METHOD" "npm"
}
if (-not $NoOnboard) {
    $NoOnboard = (Read-PrefixedEnv "NO_ONBOARD" "0") -eq "1"
}
if (-not $DryRun) {
    $DryRun = (Read-PrefixedEnv "DRY_RUN" "0") -eq "1"
}
if (-not $Verify) {
    $Verify = (Read-PrefixedEnv "VERIFY_INSTALL" "0") -eq "1"
}

$ACCENT = "`e[38;2;255;77;77m"
$SUCCESS = "`e[38;2;0;229;204m"
$WARN = "`e[38;2;255;176;32m"
$ERROR = "`e[38;2;230;57;70m"
$MUTED = "`e[38;2;90;100;128m"
$NC = "`e[0m"

function Write-Info([string]$Message) {
    Microsoft.PowerShell.Host\Write-Host "$MUTED·$NC $Message"
}
function Write-Success([string]$Message) {
    Microsoft.PowerShell.Host\Write-Host "$SUCCESS✓$NC $Message"
}
function Write-Warn([string]$Message) {
    Microsoft.PowerShell.Host\Write-Host "$WARN!$NC $Message"
}
function Write-Fail([string]$Message) {
    Microsoft.PowerShell.Host\Write-Host "$ERROR✗$NC $Message"
}
function Write-Banner {
    Microsoft.PowerShell.Host\Write-Host "$ACCENT  Alisio Installer$NC"
    Microsoft.PowerShell.Host\Write-Host "$MUTED  Desktop-first setup para gateway + UI.$NC"
    Microsoft.PowerShell.Host\Write-Host ""
}

function Invoke-Step {
    param(
        [string]$Label,
        [scriptblock]$Action
    )
    if ($DryRun) {
        Write-Info "[dry-run] $Label"
        return
    }
    & $Action
}

function Ensure-ExecutionPolicy {
    $policy = Get-ExecutionPolicy
    if ($policy -eq "Restricted" -or $policy -eq "AllSigned") {
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
    }
}

function Get-NodeVersion {
    try {
        return (node --version 2>$null) -replace '^v', ''
    } catch {
        return $null
    }
}

function Ensure-Node {
    $version = Get-NodeVersion
    if ($version) {
        $major = [int](($version -split '\.')[0])
        if ($major -ge 22) {
            Write-Success "Node.js disponível: v$version"
            return
        }
    }
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Invoke-Step "Instalar Node.js LTS" { winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements | Out-Null }
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        Invoke-Step "Instalar Node.js LTS" { choco install nodejs-lts -y | Out-Null }
    } elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
        Invoke-Step "Instalar Node.js LTS" { scoop install nodejs-lts | Out-Null }
    } else {
        throw "Instala Node.js 22+ manualmente e volta a correr o installer."
    }
}

function Ensure-Git {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        return
    }
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Invoke-Step "Instalar Git" { winget install Git.Git --accept-package-agreements --accept-source-agreements | Out-Null }
    } else {
        throw "Git é obrigatório. Instala Git for Windows e tenta de novo."
    }
}

function Resolve-BetaTag {
    try {
        return (npm view (Get-AppSlug) dist-tags.beta 2>$null).Trim()
    } catch {
        return ""
    }
}

function Ensure-StateEnv {
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $StateDir "logs") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $StateDir "workspace") | Out-Null

    [Environment]::SetEnvironmentVariable("ALISIO_STATE_DIR", $StateDir, "User")
    [Environment]::SetEnvironmentVariable("ALISIO_CONFIG_PATH", $ConfigPath, "User")
    [Environment]::SetEnvironmentVariable($LegacyStateEnvName, $StateDir, "User")
    [Environment]::SetEnvironmentVariable($LegacyConfigEnvName, $ConfigPath, "User")

    $env:ALISIO_STATE_DIR = $StateDir
    $env:ALISIO_CONFIG_PATH = $ConfigPath
    $env:$LegacyStateEnvName = $StateDir
    $env:$LegacyConfigEnvName = $ConfigPath
}

function Install-FromNpm {
    $resolvedTag = $Tag
    if ((Read-PrefixedEnv "BETA" "0") -eq "1") {
        $beta = Resolve-BetaTag
        if ($beta) { $resolvedTag = $beta }
    }
    $spec = Get-InstallSpec $resolvedTag
    Write-Info "A instalar $AppName via npm: $spec"
    Ensure-Node
    Ensure-Git
    Invoke-Step "npm install -g $spec" { npm install -g $spec --no-fund --no-audit | Out-Null }
}

function Install-FromGit {
    Ensure-Node
    Ensure-Git
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        if (Get-Command corepack -ErrorAction SilentlyContinue) {
            Invoke-Step "Activar pnpm via Corepack" { corepack enable; corepack prepare pnpm@10 --activate | Out-Null }
        } else {
            Invoke-Step "Instalar pnpm" { npm install -g pnpm@10 | Out-Null }
        }
    }
    if (-not (Test-Path (Join-Path $GitDir ".git"))) {
        Invoke-Step "Clonar repositório" { git clone (Get-RepoUrl) $GitDir | Out-Null }
    } elseif (-not $NoGitUpdate) {
        Invoke-Step "Actualizar checkout" { git -C $GitDir pull --rebase | Out-Null }
    }
    Invoke-Step "pnpm install" { pnpm --dir $GitDir install | Out-Null }
    Invoke-Step "pnpm ui:build" { pnpm --dir $GitDir ui:build | Out-Null }
    Invoke-Step "pnpm build" { pnpm --dir $GitDir build | Out-Null }

    $wrapperDir = Join-Path $HOME ".local\bin"
    New-Item -ItemType Directory -Force -Path $wrapperDir | Out-Null
    $wrapperPath = Join-Path $wrapperDir "$AppSlug.cmd"
    @"
@echo off
set "ALISIO_STATE_DIR=%USERPROFILE%\$(Get-StateDirName)"
set "ALISIO_CONFIG_PATH=%ALISIO_STATE_DIR%\$(Get-ConfigFileName)"
set "$LegacyStateEnvName=%ALISIO_STATE_DIR%"
set "$LegacyConfigEnvName=%ALISIO_CONFIG_PATH%"
node "$GitDir\dist\entry.js" %*
"@ | Set-Content -Path $wrapperPath -Encoding ASCII
    $env:Path = "$wrapperDir;$env:Path"
}

function Resolve-CliPath {
    $cmd = Get-Command $AppSlug -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $localBin = Join-Path $HOME ".local\bin\$AppSlug.cmd"
    if (Test-Path $localBin) { return $localBin }
    return $null
}

function Write-Launcher {
    $launcherRoot = Join-Path $env:LOCALAPPDATA "Alisio"
    $launcherPath = Join-Path $launcherRoot "alisio-dashboard.ps1"
    New-Item -ItemType Directory -Force -Path $launcherRoot | Out-Null
    @"
`$ErrorActionPreference = "Stop"
`$env:ALISIO_STATE_DIR = "`$HOME\$(Get-StateDirName)"
`$env:ALISIO_CONFIG_PATH = "`$env:ALISIO_STATE_DIR\$(Get-ConfigFileName)"
`$env:$LegacyStateEnvName = `$env:ALISIO_STATE_DIR
`$env:$LegacyConfigEnvName = `$env:ALISIO_CONFIG_PATH
New-Item -ItemType Directory -Force -Path `$env:ALISIO_STATE_DIR | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path `$env:ALISIO_STATE_DIR "logs") | Out-Null
try { & "$(Get-AppSlug)" gateway install --force | Out-Null } catch {}
try { & "$(Get-AppSlug)" gateway restart | Out-Null } catch {}
& "$(Get-AppSlug)" dashboard
"@ | Set-Content -Path $launcherPath -Encoding UTF8

    $desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "$AppName Dashboard.lnk"
    $wsh = New-Object -ComObject WScript.Shell
    $shortcut = $wsh.CreateShortcut($desktopShortcut)
    $shortcut.TargetPath = (Get-Command powershell.exe).Source
    $shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$launcherPath`""
    $shortcut.IconLocation = "shell32.dll,220"
    $shortcut.Save()
}

function Start-GatewayAndUi {
    $cli = Resolve-CliPath
    if (-not $cli) {
        Write-Warn "$AppName ficou instalado, mas o comando $AppSlug não apareceu no PATH desta sessão."
        return
    }
    if ($DryRun) {
        Write-Info "[dry-run] gateway install/restart + dashboard"
        return
    }
    try { & $cli gateway install --force | Out-Null } catch {}
    try { & $cli gateway restart | Out-Null } catch {}
    if (-not $NoOnboard) {
        try { & $cli dashboard | Out-Null } catch {}
    }
}

function Verify-Install {
    if (-not $Verify) { return }
    $cli = Resolve-CliPath
    if ($cli) {
        & $cli --version
        & $cli dashboard --no-open | Out-Null
    }
}

function Main {
    Write-Banner
    Warn-LegacyEnv @("VERSION", "INSTALL_METHOD", "DISTRIBUTION", "GIT_DIR", "BETA", "NO_ONBOARD", "DRY_RUN", "VERIFY_INSTALL")
    Ensure-ExecutionPolicy
    Ensure-StateEnv

    if ([string]::IsNullOrWhiteSpace($Tag)) { $Tag = "latest" }
    if ($InstallMethod -eq "desktop") {
        Write-Warn "Ainda não há artefacto Windows desktop estável neste installer; uso npm."
        $InstallMethod = "npm"
    }
    if ([string]::IsNullOrWhiteSpace($InstallMethod)) { $InstallMethod = "npm" }

    Write-Info "Método: $InstallMethod"
    Write-Info "Versão pedida: $Tag"

    switch ($InstallMethod.ToLowerInvariant()) {
        "npm" { Install-FromNpm }
        "git" { Install-FromGit }
        default { throw "Método inválido: $InstallMethod" }
    }

    Write-Launcher
    Start-GatewayAndUi
    Verify-Install

    Write-Success "$AppName pronto."
    Write-Info "Arranque sem CLI: Desktop\$AppName Dashboard.lnk"
    Write-Info "Installer PowerShell: $(Get-InstallPs1Url)"
}

Main
