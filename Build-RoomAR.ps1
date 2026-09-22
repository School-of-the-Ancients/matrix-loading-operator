param(
    [string]$UnityEditor = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Unity.exe',
    [string]$OutputPath,
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not (Test-Path -LiteralPath $UnityEditor -PathType Leaf)) { throw "Unity Editor missing: $UnityEditor" }
$repositoryRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot '.room-ar-fixture'))
if (-not $fixtureRoot.StartsWith($repositoryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The room AR fixture must remain inside this repository.'
}
$runtimeNames = @('SandboxData', 'SandboxWorld', 'SandboxBehaviorVisual', 'SandboxSceneCapture', 'QuestCameraCapture', 'SandboxContentData', 'SandboxContentLoader', 'SandboxApp', 'PcBridge', 'SandboxVoiceInput',
    'WhiteRoomAdapter', 'WhiteRoomDesktopControls', 'WhiteRoomXrControls', 'QuestRoomAdapter', 'RoomDebugOutlines')
$editorNames = @('WhiteRoomSceneSetup', 'WhiteRoomXrSetup', 'SandboxCoreChecks', 'SandboxContentChecks', 'SandboxContentPackExporter', 'SandboxPrefabPreview', 'QuestBuildSetup', 'RoomArSceneSetup', 'QuestCameraCaptureChecks')
$authoredFiles = @($runtimeNames | ForEach-Object { 'Assets\Sandbox\Runtime\' + $_ + '.cs' }) +
    @($editorNames | ForEach-Object { 'Assets\Sandbox\Editor\' + $_ + '.cs' })
foreach ($relative in $authoredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot $relative) -PathType Leaf)) { throw "Required room AR source is missing: $relative" }
}
foreach ($relative in @('Packages\manifest.json', 'Packages\packages-lock.json', 'ProjectSettings\ProjectVersion.txt', 'ProjectSettings\ProjectSettings.asset')) {
    if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot $relative) -PathType Leaf)) { throw "Required project configuration is missing: $relative" }
}
# Official Meta packages are resolved normally from the pinned manifest. Do not copy
# package binaries, restore quarantined output, patch vendor assemblies, or alter protection.
$fixtureAssets = Join-Path $fixtureRoot 'Assets'
if (Test-Path -LiteralPath $fixtureAssets) {
    foreach ($file in Get-ChildItem -LiteralPath $fixtureAssets -Recurse -File) {
        $relative = $file.FullName.Substring($fixtureRoot.Length + 1)
        if (($file.Extension -eq '.cs' -and $relative -notin $authoredFiles) -or $file.Extension -in @('.dll', '.so', '.aar', '.jar')) {
            throw "Unexpected code in the isolated room AR fixture: $relative. Review the fixture before building."
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
foreach ($relative in @('Packages\manifest.json', 'Packages\packages-lock.json', 'ProjectSettings\ProjectVersion.txt')) {
    $destination = Join-Path $fixtureRoot $relative
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force)
    Copy-Item -LiteralPath (Join-Path $repositoryRoot $relative) -Destination $destination -Force
}
$encoding = [Text.UTF8Encoding]::new($false)
$playerSettings = Join-Path $fixtureRoot 'ProjectSettings\ProjectSettings.asset'
if (-not (Test-Path -LiteralPath $playerSettings)) {
    $settings = [IO.File]::ReadAllText((Join-Path $repositoryRoot 'ProjectSettings\ProjectSettings.asset'))
    $settings = $settings -replace 'activeInputHandler: \d+', 'activeInputHandler: 1'
    [IO.File]::WriteAllText($playerSettings, $settings, $encoding)
}
# Native scene code compiles against the official Meta assemblies without fixture defines.
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'Assets\csc.rsp'), '', $encoding)
if ($PrepareOnly) {
    Write-Host "Prepared room AR sources and official package manifest: $fixtureRoot"
    Write-Host 'Unity has not imported, compiled, tested, or built this fixture.'
    return
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $repositoryRoot 'Builds\RoomARQuest\MatrixOperatorAR.apk' }
elseif (-not [IO.Path]::IsPathRooted($OutputPath)) { $OutputPath = Join-Path $repositoryRoot $OutputPath }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
if ($OutputPath.Contains('"') -or $fixtureRoot.Contains('"')) { throw 'Build paths cannot contain quote characters.' }
[void](New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force)
$validationRoot = Join-Path $repositoryRoot 'Validation'
[void](New-Item -ItemType Directory -Path $validationRoot -Force)
$buildLog = Join-Path $validationRoot 'room-ar-quest.log'
$validationOutput = Join-Path $validationRoot 'room-ar-quest-core-results.json'
# A new log and explicit success marker prevent a stale APK from passing validation.
[IO.File]::WriteAllText($buildLog, '', $encoding)
$arguments = @('-batchmode', '-quit', '-projectPath', ('"' + $fixtureRoot + '"'), '-buildTarget', 'Android',
    '-executeMethod', 'ArSandbox.RoomArSceneSetup.BuildQuest', '-sandboxBuildOutput', ('"' + $OutputPath + '"'),
    '-validationOutput', ('"' + $validationOutput + '"'), '-logFile', ('"' + $buildLog + '"'))
Write-Host "Building Quest Pro room AR with official Meta/MRUK packages. Log: $buildLog"
$process = Start-Process -FilePath $UnityEditor -ArgumentList $arguments -WindowStyle Hidden -PassThru
$process.WaitForExit()
$process.Refresh()
if ($process.ExitCode -ne 0) { throw "Room AR build exited with code $($process.ExitCode). See $buildLog" }
if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) { throw "Unity did not produce the requested APK. See $buildLog" }
$artifact = Get-Item -LiteralPath $OutputPath
if ($artifact.Length -eq 0) { throw "Room AR APK is empty. See $buildLog" }
if (-not (Select-String -LiteralPath $buildLog -SimpleMatch ('ROOM_AR_BUILD_OK ' + $OutputPath) -Quiet)) {
    throw "Unity did not report this APK as successfully built. See $buildLog"
}
Write-Host "Room AR build verified: $OutputPath ($($artifact.Length) bytes). White-room package is unchanged."
