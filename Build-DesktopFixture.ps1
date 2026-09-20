param(
    [string]$UnityEditor = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Unity.exe',
    [string]$OutputPath = 'Builds\Desktop\AR-Sandbox.exe'
)

# Builds the portable room simulation. This does not validate the Meta SDK or a headset.
# The isolated project contains only the explicit authored source list below.
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $UnityEditor -PathType Leaf)) {
    throw "Unity Editor missing: $UnityEditor"
}
$repositoryRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot '.desktop-fixture'))
if (-not $fixtureRoot.StartsWith($repositoryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The fixture must remain inside this repository.'
}
$markerPath = Join-Path $fixtureRoot '.sandbox-desktop-fixture'
if ((Test-Path -LiteralPath $fixtureRoot) -and -not (Test-Path -LiteralPath $markerPath)) {
    if (@(Get-ChildItem -LiteralPath $fixtureRoot -Force).Count -gt 0) {
        throw "The fixture directory contains unrelated files and has no ownership marker. Preserving $fixtureRoot"
    }
}
if ([IO.Path]::IsPathRooted($OutputPath)) {
    $outputExe = [IO.Path]::GetFullPath($OutputPath)
} else {
    $outputExe = [IO.Path]::GetFullPath((Join-Path $repositoryRoot $OutputPath))
}
if ([IO.Path]::GetExtension($outputExe) -ne '.exe') {
    throw 'OutputPath must name a Windows .exe file.'
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($relativeDirectory in @('Assets\Sandbox\Runtime', 'Assets\Sandbox\Editor', 'Packages', 'ProjectSettings')) {
    [void](New-Item -ItemType Directory -Path (Join-Path $fixtureRoot $relativeDirectory) -Force)
}
[IO.File]::WriteAllText($markerPath, ('AR Sandbox authored desktop simulation fixture.' + [Environment]::NewLine), $utf8)
$runtimeFiles = @('DesktopControls.cs', 'PcBridge.cs', 'SandboxApp.cs', 'SandboxData.cs', 'SandboxWorld.cs')
$editorFiles = @('SandboxCoreChecks.cs', 'SandboxProjectSetup.cs', 'LessonGuideChecks.cs', 'DesktopValidationBuild.cs')
foreach ($group in @(
    @{ Directory = 'Assets\Sandbox\Runtime'; Files = $runtimeFiles },
    @{ Directory = 'Assets\Sandbox\Editor'; Files = $editorFiles }
)) {
    foreach ($fileName in $group.Files) {
        foreach ($suffix in @('', '.meta')) {
            $relativeFile = Join-Path $group.Directory ($fileName + $suffix)
            $sourceFile = Join-Path $repositoryRoot $relativeFile
            if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
                throw "Required authored source missing: $relativeFile"
            }
            Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $fixtureRoot $relativeFile) -Force
        }
    }
}
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'Assets\csc.rsp'), ('-define:SANDBOX_CORE_FIXTURE' + [Environment]::NewLine), $utf8)
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'ProjectSettings\ProjectVersion.txt') -Destination (Join-Path $fixtureRoot 'ProjectSettings\ProjectVersion.txt') -Force
$playerSettings = Join-Path $fixtureRoot 'ProjectSettings\ProjectSettings.asset'
if (-not (Test-Path -LiteralPath $playerSettings)) {
    [IO.File]::WriteAllText($playerSettings, @'
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!129 &1
PlayerSettings:
  m_ObjectHideFlags: 0
  serializedVersion: 30
  companyName: AR Sandbox
  productName: AR Sandbox
  activeInputHandler: 1
'@, $utf8)
}
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'Packages\manifest.json'), @'
{
  "dependencies": {
    "com.unity.inputsystem": "1.20.0",
    "com.unity.modules.ai": "1.0.0",
    "com.unity.modules.androidjni": "1.0.0",
    "com.unity.modules.animation": "1.0.0",
    "com.unity.modules.assetbundle": "1.0.0",
    "com.unity.modules.audio": "1.0.0",
    "com.unity.modules.cloth": "1.0.0",
    "com.unity.modules.imgui": "1.0.0",
    "com.unity.modules.jsonserialize": "1.0.0",
    "com.unity.modules.particlesystem": "1.0.0",
    "com.unity.modules.physics": "1.0.0",
    "com.unity.modules.screencapture": "1.0.0",
    "com.unity.modules.ui": "1.0.0",
    "com.unity.modules.uielements": "1.0.0",
    "com.unity.modules.unitywebrequest": "1.0.0",
    "com.unity.modules.unitywebrequesttexture": "1.0.0",
    "com.unity.modules.unitywebrequestwww": "1.0.0",
    "com.unity.modules.xr": "1.0.0"
  }
}
'@, $utf8)

$validationDirectory = Join-Path $repositoryRoot 'Validation'
[void](New-Item -ItemType Directory -Path $validationDirectory -Force)
$buildLog = Join-Path $validationDirectory 'desktop-fixture-build.log'
$validationOutput = Join-Path $validationDirectory 'desktop-fixture-core-results.json'
$arguments = @(
    '-batchmode', '-quit',
    '-projectPath', ('"' + $fixtureRoot + '"'),
    '-buildTarget', 'Win64',
    '-executeMethod', 'ArSandbox.DesktopValidationBuild.Run',
    '-sandboxBuildOutput', ('"' + $outputExe + '"'),
    '-validationOutput', ('"' + $validationOutput + '"'),
    '-logFile', ('"' + $buildLog + '"')
)
Write-Host "Validating and building the isolated desktop simulation: $fixtureRoot"
$buildProcess = Start-Process -FilePath $UnityEditor -ArgumentList $arguments -WindowStyle Hidden -PassThru
$null = $buildProcess.Handle
$buildProcess.WaitForExit()
$buildProcess.Refresh()
if ($null -eq $buildProcess.ExitCode -or $buildProcess.ExitCode -ne 0) {
    throw "Desktop fixture build failed (exit $($buildProcess.ExitCode)). See $buildLog"
}
if (-not (Test-Path -LiteralPath $outputExe -PathType Leaf) -or
    -not (Select-String -LiteralPath $buildLog -SimpleMatch 'DESKTOP_FIXTURE_VALIDATION_OK' -Quiet)) {
    throw "Unity exited without confirmed validation and build success. See $buildLog"
}
Write-Host "Desktop simulation built: $outputExe"
Write-Host "Validation results: $validationOutput"
Write-Host "Build log: $buildLog"
