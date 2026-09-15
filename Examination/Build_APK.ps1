# Build_APK.ps1 - Builds the examination-compose-v2 debug APK
# Right-click -> Run with PowerShell

$ErrorActionPreference = "Continue"
$projectDir = Join-Path $PSScriptRoot "examination-compose-v2"
$gradlew = Join-Path $projectDir "gradlew.bat"
$outDir = Join-Path $PSScriptRoot "apk-output"
$gradleHome = Join-Path $PSScriptRoot ".gradle-home"
$localGradle = Join-Path $gradleHome "gradle-8.7\bin\gradle.bat"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Examination App - Build Debug APK" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Set JAVA_HOME to the JDK found earlier
$jdkCandidates = @(
    "C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot",
    "C:\Python314",  # skip
    "$env:JAVA_HOME"
) | Where-Object { $_ -and (Test-Path "$_\bin\java.exe") }

if ($jdkCandidates.Count -gt 0) {
    $env:JAVA_HOME = $jdkCandidates[0]
    Write-Host "Using JAVA_HOME: $env:JAVA_HOME" -ForegroundColor Gray
} else {
    Write-Host "WARNING: Could not find JDK. Gradle will try system Java." -ForegroundColor Yellow
}

# Keep Gradle state inside the workspace so builds do not depend on the user's
# global cache or a stale lock under C:\Users\sunny\.gradle.
New-Item -ItemType Directory -Path $gradleHome -Force | Out-Null
$env:GRADLE_USER_HOME = $gradleHome
Write-Host "Using GRADLE_USER_HOME: $env:GRADLE_USER_HOME" -ForegroundColor Gray

Write-Host "Project: $projectDir" -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path $gradlew)) {
    Write-Host "ERROR: gradlew.bat not found at $gradlew" -ForegroundColor Red
    pause; exit 1
}

Write-Host "Running: gradlew assembleDebug" -ForegroundColor Yellow
Write-Host "(First run downloads Gradle and dependencies - may take a few minutes)" -ForegroundColor Gray
Write-Host ""

Set-Location $projectDir
if (Test-Path $localGradle) {
    Write-Host "Using local Gradle distribution: $localGradle" -ForegroundColor Gray
    & $localGradle assembleDebug --stacktrace 2>&1
} else {
    & $gradlew assembleDebug --stacktrace 2>&1
}

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "BUILD FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
    Write-Host "Check the output above for errors." -ForegroundColor Red
    pause; exit 1
}

# Copy APK to output folder
$apkSource = Join-Path $projectDir "app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkSource) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    $timestamp = Get-Date -Format "yyyyMMdd_HHmm"
    $apkDest = Join-Path $outDir "examination-debug-$timestamp.apk"
    Copy-Item $apkSource $apkDest
    Write-Host ""
    Write-Host "BUILD SUCCEEDED" -ForegroundColor Green
    Write-Host "APK saved to: $apkDest" -ForegroundColor Green
    Write-Host ""
    Write-Host "Install on connected device:" -ForegroundColor Cyan
    Write-Host "  adb install `"$apkDest`"" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "BUILD SUCCEEDED but APK not found at expected path." -ForegroundColor Yellow
    Write-Host "Check: $apkSource" -ForegroundColor Yellow
}

Write-Host ""
if ($env:BUILD_APK_SKIP_PAUSE -ne "1" -and -not [Console]::IsInputRedirected) {
    pause
}
