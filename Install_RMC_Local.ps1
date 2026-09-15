Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Info([string]$Message) {
    Write-Host "[RMC Installer] $Message"
}

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Copy-Tree([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source)) {
        return
    }
    Ensure-Directory $Destination
    Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force
}

function New-RandomSecret {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Resolve-InstallRoot {
    param([string]$DefaultRoot)

    $answer = Read-Host "Install folder [$DefaultRoot]"
    $path = if ([string]::IsNullOrWhiteSpace($answer)) { $DefaultRoot } else { $answer.Trim('"') }
    return [System.IO.Path]::GetFullPath($path)
}

function Write-EnvFile {
    param(
        [string]$ServerDir,
        [string]$InstallRoot
    )

    $dataDir = Join-Path $InstallRoot 'data'
    $sessionSecret = New-RandomSecret
    $envPath = Join-Path $ServerDir '.env'
    $envContent = @"
NODE_ENV=production
PORT=3000
RMC_DATA_DIR="$dataDir"
RMC_DB_FILE="$dataDir\rmc_pro_database.db"
SESSION_DB_FILE="$dataDir\rmc_sessions.db"
SESSION_STORE=sqlite
SESSION_SECRET=$sessionSecret
COOKIE_SECURE=false
TRUST_PROXY=false
ENFORCE_PRIVATE_ENTRY=false
PUBLIC_BASE_URL=http://localhost:3000
PUBLIC_HOST=localhost
PRIVATE_HOST=localhost
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
SESSION_COOKIE_SAMESITE=lax
"@
    Set-Content -LiteralPath $envPath -Value $envContent -Encoding UTF8
}

function Seed-Data {
    param(
        [string]$PayloadRoot,
        [string]$InstallRoot
    )

    $seedData = Join-Path $PayloadRoot 'seed\data'
    $dataDir = Join-Path $InstallRoot 'data'
    Ensure-Directory $dataDir

    $dataFolders = @('uploads', 'materials', 'qrcodes', 'staff_qrcodes')
    foreach ($folder in $dataFolders) {
        $sourceFolder = Join-Path $seedData $folder
        $targetFolder = Join-Path $dataDir $folder
        if (Test-Path -LiteralPath $sourceFolder) {
            Copy-Tree $sourceFolder $targetFolder
        } else {
            Ensure-Directory $targetFolder
        }
    }

    foreach ($file in @('rmc_pro_database.db', 'rmc_sessions.db')) {
        $sourceFile = Join-Path $seedData $file
        if (Test-Path -LiteralPath $sourceFile) {
            Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $dataDir $file) -Force
        }
    }
}

function Write-LauncherScripts {
    param(
        [string]$InstallRoot
    )

    $launcherCmd = Join-Path $InstallRoot 'Start_RMC_Local.cmd'
    $launcherPs1 = Join-Path $InstallRoot 'Start_RMC_Local.ps1'

    $launcherCmdContent = @'
@echo off
setlocal
cd /d "%~dp0server"
if not exist node_modules (
    echo Installing dependencies...
    npm install --omit=dev
    if errorlevel 1 (
        echo.
        echo Dependency installation failed.
        pause
        exit /b 1
    )
)
start "RMC Local Server" cmd /k "node server.js"
timeout /t 6 >nul
start http://localhost:3000
endlocal
'@
    Set-Content -LiteralPath $launcherCmd -Value $launcherCmdContent -Encoding ASCII

    $launcherPs1Content = @'
param()
Set-Location -LiteralPath (Join-Path $PSScriptRoot 'server')
if (-not (Test-Path -LiteralPath 'node_modules')) {
    npm install --omit=dev
    if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed."
    }
}
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'node server.js' -WindowStyle Normal
Start-Sleep -Seconds 6
Start-Process 'http://localhost:3000'
'@
    Set-Content -LiteralPath $launcherPs1 -Value $launcherPs1Content -Encoding ASCII
}

function Create-DesktopShortcut {
    param([string]$InstallRoot)

    try {
        $desktop = [Environment]::GetFolderPath('Desktop')
        $shortcutPath = Join-Path $desktop 'RMC Local Suite.lnk'
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = Join-Path $InstallRoot 'Start_RMC_Local.cmd'
        $shortcut.WorkingDirectory = $InstallRoot
        $shortcut.WindowStyle = 1
        $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,44"
        $shortcut.Description = 'Launch the local RMC server'
        $shortcut.Save()
        Write-Info "Created desktop shortcut: $shortcutPath"
    } catch {
        Write-Info "Skipping desktop shortcut: $($_.Exception.Message)"
    }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$payloadRoot = Join-Path $scriptRoot 'payload'
if (-not (Test-Path -LiteralPath $payloadRoot)) {
    throw "Payload folder not found: $payloadRoot"
}

$defaultRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'RMC Local Suite'
$installRoot = Resolve-InstallRoot -DefaultRoot $defaultRoot
$serverDir = Join-Path $installRoot 'server'
$publicDir = Join-Path $installRoot 'public'
$viewsDir = Join-Path $installRoot 'views'
$logsDir = Join-Path $installRoot 'logs'

Write-Info "Installing to $installRoot"
Ensure-Directory $installRoot
Ensure-Directory $serverDir
Ensure-Directory $publicDir
Ensure-Directory $viewsDir
Ensure-Directory $logsDir

Write-Info "Copying app files..."
Copy-Tree (Join-Path $payloadRoot 'server') $serverDir
Copy-Tree (Join-Path $payloadRoot 'public') $publicDir
Copy-Tree (Join-Path $payloadRoot 'views') $viewsDir

Write-Info "Seeding data..."
Seed-Data -PayloadRoot $payloadRoot -InstallRoot $installRoot

Write-Info "Writing local environment..."
Write-EnvFile -ServerDir $serverDir -InstallRoot $installRoot

Write-Info "Creating launcher scripts..."
Write-LauncherScripts -InstallRoot $installRoot

Create-DesktopShortcut -InstallRoot $installRoot

$nodeAvailable = $false
try {
    $null = & node --version
    if ($LASTEXITCODE -eq 0) {
        $nodeAvailable = $true
    }
} catch {
    $nodeAvailable = $false
}

if (-not $nodeAvailable) {
    Write-Info "Node.js was not found on this PC."
    Write-Info "The app files are installed, but you need Node.js 20+ to run the server."
} elseif (-not (Test-Path -LiteralPath (Join-Path $serverDir 'node_modules'))) {
    Write-Info "Installing Node dependencies..."
    Push-Location $serverDir
    try {
        npm install --omit=dev
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed."
        }
    } finally {
        Pop-Location
    }
}

Write-Info "Install complete."
Write-Info "Open '$installRoot\Start_RMC_Local.cmd' to launch the local server."
