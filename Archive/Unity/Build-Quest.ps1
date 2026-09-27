param([string]$UnityEditor = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Unity.exe')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $UnityEditor)) { throw "Unity Editor missing: $UnityEditor" }
$log = Join-Path $PSScriptRoot 'Validation\quest-build.log'
$buildProcess = Start-Process -FilePath $UnityEditor -ArgumentList @('-batchmode','-quit','-projectPath',('"' + $PSScriptRoot + '"'),'-buildTarget','Android','-executeMethod','ArSandbox.SandboxProjectSetup.BuildQuest','-logFile',('"' + $log + '"')) -WindowStyle Hidden -PassThru
# Unity compiler servers may outlive the Editor. Wait for this Editor process,
# rather than every descendant process in Start-Process -Wait's job.
$buildProcess.WaitForExit()
if ($buildProcess.ExitCode -ne 0) { throw "Quest build failed. See $log" }
Write-Host (Join-Path $PSScriptRoot 'Builds\Quest\AR-Sandbox.apk')
