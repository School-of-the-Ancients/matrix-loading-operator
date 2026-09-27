param(
    [string]$Serial,
    [string]$Adb = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe'
)
$ErrorActionPreference = 'Stop'
$apk = Join-Path $PSScriptRoot 'Builds\Quest\AR-Sandbox.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw 'Builds\Quest\AR-Sandbox.apk is missing. Build the Quest application first.' }
if (-not (Test-Path -LiteralPath $Adb)) { throw "ADB missing: $Adb" }
$deviceOutput = & $Adb devices
if ($LASTEXITCODE -ne 0) { throw 'ADB device discovery failed.' }
$devices = @($deviceOutput | ForEach-Object {
    if ($_ -match '^(\S+)\s+(device|unauthorized|offline)\s*$') {
        [PSCustomObject]@{ Serial = $Matches[1]; State = $Matches[2] }
    }
})
if ($Serial) { $devices = @($devices | Where-Object { $_.Serial -eq $Serial }) }
if ($devices.Count -eq 0) { throw 'Connect the Quest by USB, enable developer mode, and accept its USB debugging prompt.' }
if ($devices.Count -gt 1) { throw 'More than one Android device is connected. Specify the intended headset with -Serial.' }
if ($devices[0].State -ne 'device') { throw 'The selected headset is not authorized or is offline. Accept USB debugging in the headset and retry.' }
$deviceArgs = @('-s', $devices[0].Serial)
& $Adb @deviceArgs install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed. Existing app data was not explicitly erased.' }
& $Adb @deviceArgs reverse tcp:8765 tcp:8765
if ($LASTEXITCODE -ne 0) { throw 'APK installed, but USB forwarding failed.' }
Write-Host 'Installed AR Sandbox and forwarded the PC control service over USB.'
Write-Host 'Run Start-ControlService.ps1 on this PC, then open AR Sandbox in the headset.'
