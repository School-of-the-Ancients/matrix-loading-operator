param(
    [string]$Serial,
    [string]$Adb = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe'
)
$ErrorActionPreference = 'Stop'
$apk = Join-Path $PSScriptRoot 'Builds\WhiteRoomQuest\MatrixOperator.apk'
$applicationId = 'com.matt.matrixoperator.whiteroom'
if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) {
    throw 'Builds\WhiteRoomQuest\MatrixOperator.apk is missing. Run Build-WhiteRoom.ps1 -Target Quest first.'
}
if (-not (Test-Path -LiteralPath $Adb -PathType Leaf)) { throw "ADB missing: $Adb" }

$deviceOutput = & $Adb devices
if ($LASTEXITCODE -ne 0) { throw 'ADB device discovery failed.' }
$devices = @($deviceOutput | ForEach-Object {
    if ($_ -match '^(\S+)\s+(device|unauthorized|offline)\s*$') {
        [PSCustomObject]@{ Serial = $Matches[1]; State = $Matches[2] }
    }
})
if ($Serial) {
    $devices = @($devices | Where-Object { $_.Serial -eq $Serial })
    if ($devices.Count -ne 1 -or $devices[0].State -ne 'device') {
        throw 'The specified headset is missing, unauthorized, or offline. Connect it and accept USB debugging, then retry.'
    }
} else {
    $devices = @($devices | Where-Object { $_.State -eq 'device' })
    if ($devices.Count -eq 0) {
        throw 'No authorized Android device is connected. Connect the Quest by USB, enable developer mode, and accept USB debugging.'
    }
    if ($devices.Count -gt 1) {
        throw 'More than one authorized Android device is connected. Specify the intended headset with -Serial.'
    }
}
$deviceArgs = @('-s', $devices[0].Serial)

& $Adb @deviceArgs install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'White-room APK installation failed. Existing app data was not explicitly erased.' }

& $Adb @deviceArgs reverse tcp:8765 tcp:8765
if ($LASTEXITCODE -ne 0) { throw 'APK installed, but USB forwarding failed. The app was not launched.' }

$launchOutput = & $Adb @deviceArgs shell am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p $applicationId
$launchExitCode = $LASTEXITCODE
$launchOutput | ForEach-Object { Write-Host $_ }
if ($launchExitCode -ne 0 -or -not ($launchOutput -match '^\s*Status:\s*ok\s*$')) {
    throw 'APK installed and USB forwarded, but Android did not confirm a successful white-room launch.'
}

Write-Host 'Installed and launched Matrix Operator white room; PC control service is forwarded over USB.'
Write-Host 'Run Start-ControlService.ps1 on this PC to enable Operator commands and scene saves.'
