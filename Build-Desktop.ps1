param([string]$UnityEditor = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Unity.exe')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $UnityEditor)) { throw "Unity Editor missing: $UnityEditor" }
[void](New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'Validation') -Force)
$log = Join-Path $PSScriptRoot 'Validation\desktop-build.log'
$buildProcess = Start-Process -FilePath $UnityEditor -ArgumentList @('-batchmode','-quit','-projectPath',('"' + $PSScriptRoot + '"'),'-buildTarget','Win64','-executeMethod','ArSandbox.SandboxProjectSetup.BuildDesktop','-logFile',('"' + $log + '"')) -WindowStyle Hidden -PassThru
$buildProcess.WaitForExit()
if ($buildProcess.ExitCode -ne 0) { throw "Desktop build failed. Close the project's Editor before batch builds. See $log" }
Write-Host (Join-Path $PSScriptRoot 'Builds\Desktop\AR-Sandbox.exe')
