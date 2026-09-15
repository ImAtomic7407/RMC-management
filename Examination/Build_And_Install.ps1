# Build_And_Install.ps1
# Builds examination-compose-v2 debug APK and installs via ADB over WiFi
# Right-click -> Run with PowerShell  (or: pwsh -ExecutionPolicy Bypass -File Build_And_Install.ps1)

$ErrorActionPreference = "Continue"

# -- Config --------------------------------------------------------------------
$ADB_TARGET   = "192.168.1.3:39955"
$PROJECT_DIR  = Join-Path $PSScriptRoot "examination-compose-v2"
$GRADLEW      = Join-Path $PROJECT_DIR "gradlew.bat"
$APK_SOURCE   = Join-Path $PROJECT_DIR "app\build\outputs\apk\debug\app-debug.apk"
$OUT_DIR      = Join-Path $PSScriptRoot "apk-output"

# -- Helpers -------------------------------------------------------------------
function Banner($text, $color = "Cyan") {
    $line = "-" * ($text.Length + 4)
    Write-Host ""
    Write-Host "  $line" -ForegroundColor $color
    Write-Host "   $text" -ForegroundColor $color
    Write-Host "  $line" -ForegroundColor $color
    Write-Host ""
}

function Step($text)  { Write-Host ">  $text" -ForegroundColor Yellow }
function Ok($text)    { Write-Host "OK  $text" -ForegroundColor Green  }
function Err($text)   { Write-Host "X  $text" -ForegroundColor Red    }
function Info($text)  { Write-Host "   $text" -ForegroundColor Gray   }

# -- Header --------------------------------------------------------------------
Banner "RMC Examination App - Build & Install"

# -- Java / JAVA_HOME ----------------------------------------------------------
$jdkCandidates = @(
    "C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot",
    "C:\Program Files\Microsoft\jdk-17.0.12.7-hotspot",
    "C:\Program Files\Java\jdk-17",
    "$env:JAVA_HOME"
) | Where-Object { $_ -and (Test-Path "$_\bin\java.exe") }

if ($jdkCandidates.Count -gt 0) {
    $env:JAVA_HOME = $jdkCandidates[0]
    Ok "JAVA_HOME: $($env:JAVA_HOME)"
} else {
    Write-Host "!  JAVA_HOME not found - Gradle will use system Java" -ForegroundColor Yellow
}

# -- Verify project ------------------------------------------------------------
if (-not (Test-Path $GRADLEW)) {
    Err "gradlew.bat not found: $GRADLEW"
    pause; exit 1
}
Ok "Project: $PROJECT_DIR"

# -- Locate ADB ----------------------------------------------------------------
$adb = Get-Command adb -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $adb) {
    # Try common Android SDK locations
    $sdkCandidates = @(
        "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
        "$env:USERPROFILE\AppData\Local\Android\Sdk\platform-tools\adb.exe",
        "C:\Android\platform-tools\adb.exe"
    )
    $adb = $sdkCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $adb) {
    Err "adb.exe not found. Add Android SDK platform-tools to PATH."
    pause; exit 1
}
Ok "ADB: $adb"

# -- Build ---------------------------------------------------------------------
Banner "Step 1 - Gradle Build" "Yellow"
Step "Running assembleDebug..."
Info "(First run downloads dependencies - may take a few minutes)"
Write-Host ""

Set-Location $PROJECT_DIR
& $GRADLEW assembleDebug --no-daemon 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Err "BUILD FAILED (exit code $LASTEXITCODE)"
    Err "Scroll up and look for 'error:' lines."
    pause; exit 1
}

if (-not (Test-Path $APK_SOURCE)) {
    Err "Build reported success but APK not found at:"
    Info $APK_SOURCE
    pause; exit 1
}

# Copy timestamped APK to output folder
New-Item -ItemType Directory -Path $OUT_DIR -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd_HHmm"
$APK_DEST = Join-Path $OUT_DIR "examination-debug-$timestamp.apk"
Copy-Item $APK_SOURCE $APK_DEST
Write-Host ""
Ok "BUILD SUCCEEDED"
Ok "APK -> $APK_DEST"

# -- ADB Connect ---------------------------------------------------------------
Banner "Step 2 - ADB Connect ($ADB_TARGET)" "Yellow"
Step "Connecting to $ADB_TARGET..."

$connectOut = & $adb connect $ADB_TARGET 2>&1
Info $connectOut

# Wait a moment for connection to stabilise
Start-Sleep -Seconds 2

# Check if device appears as connected
$devices = & $adb devices 2>&1
$isConnected = $devices | Select-String $ADB_TARGET | Select-String "device$"   # "device" not "offline"

if (-not $isConnected) {
    Write-Host ""
    Write-Host "!  Device not shown as 'device' state. Current adb devices:" -ForegroundColor Yellow
    $devices | ForEach-Object { Info $_ }
    Write-Host ""
    Write-Host "   Possible fixes:" -ForegroundColor Yellow
    Info "   * On the phone: accept the ADB authorization dialog"
    Info "   * Run in cmd:  adb kill-server  then retry"
    Info "   * Ensure phone and PC are on the same WiFi network"
    Write-Host ""
    $continue = Read-Host "   Continue install anyway? (y/N)"
    if ($continue -ne 'y' -and $continue -ne 'Y') {
        pause; exit 1
    }
} else {
    Ok "Device connected: $ADB_TARGET"
}

# -- Install -------------------------------------------------------------------
Banner "Step 3 - Install APK" "Yellow"
Step "Installing on $ADB_TARGET ..."
Info "(Use -r to replace existing install)"
Write-Host ""

& $adb -s $ADB_TARGET install -r $APK_DEST 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Err "INSTALL FAILED (exit $LASTEXITCODE)"
    Info "Try: adb -s $ADB_TARGET uninstall com.example.examination"
    Info "Then re-run this script."
    pause; exit 1
}

# -- Launch --------------------------------------------------------------------
Banner "Step 4 - Launch App" "Green"
Step "Starting MainActivity on device..."

& $adb -s $ADB_TARGET shell am start -n "com.example/.MainActivity" 2>&1 | ForEach-Object { Info $_ }

Write-Host ""
Ok "All done!"
Info "APK:    $APK_DEST"
Info "Device: $ADB_TARGET"
Write-Host ""
pause
