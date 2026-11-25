[CmdletBinding()]
param(
    [string]$ApkPath = "app\build\outputs\apk\debug\app-debug.apk",
    [ValidateRange(1, 65535)]
    [int]$BackendPort = 8000,
    [switch]$SkipBuild,
    [switch]$SkipInstall,
    [switch]$SkipReverse
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-AdbPath {
    $command = Get-Command adb -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @()
    if ($env:ANDROID_HOME) {
        $candidates += (Join-Path $env:ANDROID_HOME "platform-tools\adb.exe")
    }
    if ($env:ANDROID_SDK_ROOT) {
        $candidates += (Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe")
    }
    if ($env:LOCALAPPDATA) {
        $candidates += (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe")
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "adb was not found. Install Android SDK Platform-Tools and configure ANDROID_HOME or PATH."
}

function Invoke-Adb {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $script:AdbPath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -ne 0) {
        $displayArguments = @()
        $redactNext = $false
        foreach ($argument in $Arguments) {
            if ($redactNext) {
                $displayArguments += "<device>"
                $redactNext = $false
            }
            else {
                $displayArguments += $argument
                if ($argument -eq "-s") {
                    $redactNext = $true
                }
            }
        }
        throw "adb command failed: $($displayArguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }
    return @($output)
}

function Get-PhysicalDevice {
    $deviceLines = Invoke-Adb -Arguments @("devices")
    $serials = @(
        $deviceLines |
            ForEach-Object { [string]$_ } |
            Where-Object { $_ -match '^([^\s]+)\s+device(?:\s|$)' } |
            ForEach-Object { $Matches[1] }
    )

    $physical = @()
    foreach ($serial in $serials) {
        $qemu = (Invoke-Adb -Arguments @("-s", $serial, "shell", "getprop", "ro.kernel.qemu") | Select-Object -First 1).Trim()
        if ($serial -notmatch '^emulator-' -and $qemu -ne "1") {
            $physical += $serial
        }
    }

    if ($physical.Count -eq 0) {
        throw "No authorized physical Android device was detected. Enable USB debugging, connect one phone, and accept the authorization prompt. Emulators are rejected."
    }
    if ($physical.Count -gt 1) {
        throw "Multiple physical Android devices were detected. Keep exactly one acceptance device connected to avoid installing to the wrong phone."
    }
    return $physical[0]
}

$script:AdbPath = Resolve-AdbPath
$effectiveApkPath = if ([IO.Path]::IsPathRooted($ApkPath)) { $ApkPath } else { Join-Path $PSScriptRoot $ApkPath }
$deviceSerial = Get-PhysicalDevice
$sdkLevel = [int]((Invoke-Adb -Arguments @("-s", $deviceSerial, "shell", "getprop", "ro.build.version.sdk") | Select-Object -First 1).Trim())
$androidVersion = (Invoke-Adb -Arguments @("-s", $deviceSerial, "shell", "getprop", "ro.build.version.release") | Select-Object -First 1).Trim()

if ($sdkLevel -lt 24) {
    throw "The device API Level is $sdkLevel, below the required minSdk 24."
}

Write-Host "Detected one physical device (Android $androidVersion / API $sdkLevel). The device serial is not printed or persisted."

if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot "gradlew.bat") :app:assembleDebug --stacktrace
    if ($LASTEXITCODE -ne 0) {
        throw "The Android Debug APK build failed."
    }
}

$resolvedApk = $null
if (-not $SkipInstall) {
    if (-not (Test-Path -LiteralPath $effectiveApkPath)) {
        throw "Debug APK not found: $effectiveApkPath"
    }
    $resolvedApk = (Resolve-Path -LiteralPath $effectiveApkPath).Path
    Invoke-Adb -Arguments @("-s", $deviceSerial, "install", "-r", $resolvedApk) | Out-Host
}

if (-not $SkipReverse) {
    Invoke-Adb -Arguments @("-s", $deviceSerial, "reverse", "tcp:$BackendPort", "tcp:$BackendPort") | Out-Null
    Write-Host "USB loopback forwarding is active: device tcp:$BackendPort -> host tcp:$BackendPort."
}

$packageName = "com.paipiange.nvzhuang.debug"
& $script:AdbPath -s $deviceSerial shell pm revoke $packageName android.permission.RECORD_AUDIO 2>$null | Out-Null
Invoke-Adb -Arguments @("-s", $deviceSerial, "shell", "am", "force-stop", $packageName) | Out-Null
Invoke-Adb -Arguments @("-s", $deviceSerial, "shell", "am", "start", "-n", "$packageName/com.paipiange.nvzhuang.MainActivity") | Out-Host

Write-Host ""
Write-Host "Complete these checks on the physical device. The script does not fabricate manual results:"
Write-Host "1. Deny microphone permission on the first call. The page must show microphone_denied and allow retry."
Write-Host "2. Allow permission and complete at least 10 turns. Confirm stable captions, playback, and resource use."
Write-Host "3. Interrupt assistant playback at least 5 times. Playback must stop within one second and begin a new turn."
Write-Host "4. Press Home during a call, then return. Capture must stop in background and restart only after explicit action."
Write-Host "5. Switch once between a headset, Bluetooth, or the system speaker. The app must recover without crashing."
Write-Host "6. Disconnect and restore the network. Verify bounded reconnect, retry-now, and cancel-reconnect actions."
Write-Host ""
Write-Host "Do not include device serials, user recordings, real API keys, or private addresses in acceptance notes."
