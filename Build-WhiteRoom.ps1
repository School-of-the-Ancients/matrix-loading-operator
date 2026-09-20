param(
    [ValidateSet('Desktop', 'Quest')][string]$Target = 'Desktop',
    [string]$UnityEditor = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Unity.exe',
    [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not (Test-Path -LiteralPath $UnityEditor -PathType Leaf)) { throw "Unity Editor missing: $UnityEditor" }
$repositoryRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot ('.white-room-fixture\' + $Target)))
if (-not $fixtureRoot.StartsWith($repositoryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The fixture must remain inside this repository.'
}
$runtimeNames = @('SandboxData', 'SandboxWorld', 'SandboxBehaviorVisual', 'SandboxApp', 'PcBridge', 'SandboxVoiceInput', 'WhiteRoomAdapter', 'WhiteRoomDesktopControls', 'WhiteRoomXrControls')
$editorNames = @('WhiteRoomSceneSetup', 'WhiteRoomXrSetup', 'WhiteRoomPreview', 'SandboxCoreChecks')
$authoredFiles = @($runtimeNames | ForEach-Object { 'Assets\Sandbox\Runtime\' + $_ + '.cs' }) +
                 @($editorNames | ForEach-Object { 'Assets\Sandbox\Editor\' + $_ + '.cs' })
foreach ($relative in $authoredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot $relative) -PathType Leaf)) { throw "Required white-room source is missing: $relative" }
}
# Reuse a target's cache, but never import an extra script or native/vendor binary from another project.
$fixtureAssets = Join-Path $fixtureRoot 'Assets'
if (Test-Path -LiteralPath $fixtureAssets) {
    foreach ($file in Get-ChildItem -LiteralPath $fixtureAssets -Recurse -File) {
        $relative = $file.FullName.Substring($fixtureRoot.Length + 1)
        if (($file.Extension -eq '.cs' -and $relative -notin $authoredFiles) -or $file.Extension -in @('.dll', '.so', '.aar', '.jar')) {
            throw "Unexpected code in the isolated fixture: $relative. Use a clean target fixture before building."
        }
    }
}
foreach ($relative in $authoredFiles) {
    $source = Join-Path $repositoryRoot $relative
    $destination = Join-Path $fixtureRoot $relative
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force)
    Copy-Item -LiteralPath $source -Destination $destination -Force
    if (Test-Path -LiteralPath ($source + '.meta')) { Copy-Item -LiteralPath ($source + '.meta') -Destination ($destination + '.meta') -Force }
}
[void](New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'Packages') -Force)
[void](New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'ProjectSettings') -Force)
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'ProjectSettings\ProjectVersion.txt') -Destination (Join-Path $fixtureRoot 'ProjectSettings\ProjectVersion.txt') -Force
$playerSettings = Join-Path $fixtureRoot 'ProjectSettings\ProjectSettings.asset'
if (-not (Test-Path -LiteralPath $playerSettings)) {
    # Copy only Unity's text player settings, not existing XR assets, scenes, packages, or binaries.
    $settings = [IO.File]::ReadAllText((Join-Path $repositoryRoot 'ProjectSettings\ProjectSettings.asset'))
    $settings = $settings -replace 'activeInputHandler: \d+', 'activeInputHandler: 1'
    [IO.File]::WriteAllText($playerSettings, $settings, [Text.UTF8Encoding]::new($false))
}
$dependencies = [ordered]@{
    'com.unity.inputsystem' = '1.20.0'
    'com.unity.ugui' = '2.6.0'
    'com.unity.modules.androidjni' = '1.0.0'
    'com.unity.modules.animation' = '1.0.0'
    'com.unity.modules.audio' = '1.0.0'
    'com.unity.modules.imgui' = '1.0.0'
    'com.unity.modules.jsonserialize' = '1.0.0'
    'com.unity.modules.physics' = '1.0.0'
    'com.unity.modules.ui' = '1.0.0'
    'com.unity.modules.uielements' = '1.0.0'
    'com.unity.modules.unitywebrequest' = '1.0.0'
    'com.unity.modules.xr' = '1.0.0'
}
$defines = '-define:SANDBOX_CORE_FIXTURE'
$buildTarget = 'Win64'
$method = 'ArSandbox.WhiteRoomSceneSetup.BuildDesktop'
$defaultOutput = 'Builds\WhiteRoomDesktop\MatrixOperator.exe'
if ($Target -eq 'Quest') {
    $dependencies['com.unity.xr.management'] = '4.7.0'
    $dependencies['com.unity.xr.openxr'] = '1.18.0'
    $defines += ';WHITE_ROOM_OPENXR'
    $buildTarget = 'Android'
    $method = 'ArSandbox.WhiteRoomSceneSetup.BuildQuest'
    $defaultOutput = 'Builds\WhiteRoomQuest\MatrixOperator.apk'
}
$encoding = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'Packages\manifest.json'), (@{ dependencies = $dependencies } | ConvertTo-Json -Depth 4), $encoding)
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'Assets\csc.rsp'), $defines + [Environment]::NewLine, $encoding)
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $repositoryRoot $defaultOutput }
elseif (-not [IO.Path]::IsPathRooted($OutputPath)) { $OutputPath = Join-Path $repositoryRoot $OutputPath }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
if ($OutputPath.Contains('"') -or $fixtureRoot.Contains('"')) { throw 'Build paths cannot contain quote characters.' }
[void](New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force)
$validationRoot = Join-Path $repositoryRoot 'Validation'
[void](New-Item -ItemType Directory -Path $validationRoot -Force)
$buildLog = Join-Path $validationRoot ('white-room-' + $Target.ToLowerInvariant() + '.log')
$validationOutput = Join-Path $validationRoot ('white-room-' + $Target.ToLowerInvariant() + '-core-results.json')
# Clear our own log so a previous successful build cannot supply this attempt's success marker.
[IO.File]::WriteAllText($buildLog, '', $encoding)
$arguments = @('-batchmode', '-quit', '-projectPath', ('"' + $fixtureRoot + '"'), '-buildTarget', $buildTarget,
    '-executeMethod', $method, '-sandboxBuildOutput', ('"' + $OutputPath + '"'), '-validationOutput', ('"' + $validationOutput + '"'), '-logFile', ('"' + $buildLog + '"'))
Write-Host "Building $Target from the isolated Unity-only white-room fixture. Log: $buildLog"
$process = Start-Process -FilePath $UnityEditor -ArgumentList $arguments -WindowStyle Hidden -PassThru
$process.WaitForExit()
$process.Refresh()
if ($process.ExitCode -ne 0) { throw "White-room $Target build exited with code $($process.ExitCode). See $buildLog" }
if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) { throw "Unity did not produce the requested output. See $buildLog" }
$artifact = Get-Item -LiteralPath $OutputPath
if ($artifact.Length -eq 0) { throw "Build output is empty. See $buildLog" }
# Unity may reuse the unchanged launcher EXE during an incremental build; its mtime is not a build receipt.
$successMarker = 'WHITE_ROOM_BUILD_OK ' + $OutputPath
if (-not (Select-String -LiteralPath $buildLog -SimpleMatch $successMarker -Quiet)) { throw "Unity did not report the requested output as successfully built. See $buildLog" }
Write-Host "White-room $Target build verified: $OutputPath ($($artifact.Length) bytes)"
