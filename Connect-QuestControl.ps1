param(
    [string]$Serial,
    [string]$Adb = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe',
    [ValidateRange(1, 65535)][int]$Port = 8765
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Adb -PathType Leaf)) { throw 'ADB executable was not found. Supply -Adb with its full path.' }

$deviceOutput = & $Adb devices 2>$null
if ($LASTEXITCODE -ne 0) { throw 'ADB device discovery failed.' }
$devices = @($deviceOutput | ForEach-Object {
    if ($_ -match '^(\S+)\s+(device|unauthorized|offline)\s*$') {
        [PSCustomObject]@{ Serial = $Matches[1]; State = $Matches[2] }
    }
})
if ($Serial) {
    $devices = @($devices | Where-Object { $_.Serial -eq $Serial })
    if ($devices.Count -ne 1 -or $devices[0].State -ne 'device') {
        throw 'The selected device is missing, offline, or unauthorized. Connect it and accept USB debugging.'
    }
} else {
    $devices = @($devices | Where-Object { $_.State -eq 'device' })
    if ($devices.Count -eq 0) { throw 'No authorized device is connected. Connect the Quest by USB and accept USB debugging.' }
    if ($devices.Count -gt 1) { throw 'Several authorized devices are connected. Select the intended Quest with -Serial.' }
}
$deviceArgs = @('-s', $devices[0].Serial)
$modelOutput = & $Adb @deviceArgs shell getprop ro.product.model 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Could not verify the selected device model.' }
$questModel = ($modelOutput -join "`n").Trim()
if ($questModel -cnotin @('Quest Pro', 'Quest 3')) {
    throw 'The selected device is not a supported Quest Pro or Quest 3. USB forwarding was not changed.'
}

$serviceUrl = "http://127.0.0.1:$Port"
$headers = @{}
if ($env:SANDBOX_TOKEN) { $headers.Authorization = 'Bearer ' + $env:SANDBOX_TOKEN }
try {
    $health = Invoke-RestMethod -Uri "$serviceUrl/api/health" -Headers $headers -TimeoutSec 5
} catch {
    throw 'PC service health check failed. Start the control service on this port and match its SANDBOX_TOKEN if configured.'
}
if ($health.ok -ne $true) { throw 'PC service did not report healthy. USB forwarding was not changed.' }

# Replace only this local port mapping; leave all other reverse rules intact.
$portSpec = "tcp:$Port"
$null = & $Adb @deviceArgs reverse $portSpec $portSpec 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Could not establish USB forwarding. Check the headset connection and authorization.' }
$rules = & $Adb @deviceArgs reverse --list 2>$null
if ($LASTEXITCODE -ne 0) { throw 'USB forwarding was requested, but its mapping could not be verified.' }
$verified = @($rules | Where-Object {
    $fields = $_.Trim() -split '\s+'
    $fields.Count -eq 3 -and $fields[1] -eq $portSpec -and $fields[2] -eq $portSpec
}).Count -gt 0
if (-not $verified) { throw 'The requested USB forwarding mapping is absent. Reconnect the headset and retry this script.' }

Write-Host "USB control forwarding ready for $questModel on port $Port. Other reverse rules were preserved."
try {
    $state = Invoke-RestMethod -Uri "$serviceUrl/api/state" -Headers $headers -TimeoutSec 5
    if ($state.online -eq $true) {
        Write-Host 'The PC service reports an online runtime. Confirm the headset connection in the Operator page.'
    } else {
        Write-Host 'Open Matrix Operator manually from Unknown Sources in the headset, then check the Operator page.'
    }
} catch {
    Write-Host 'USB forwarding is verified; runtime status is unavailable. Open Matrix Operator manually if needed.'
}
