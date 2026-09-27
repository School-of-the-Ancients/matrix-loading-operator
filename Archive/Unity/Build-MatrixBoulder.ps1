param(
    [string]$UnityEditor = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Unity.exe',
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $UnityEditor -PathType Leaf)) { throw "Unity Editor missing: $UnityEditor" }
$root = [IO.Path]::GetFullPath($PSScriptRoot)
$cacheRoot = [IO.Path]::GetFullPath($env:LOCALAPPDATA)
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))
    $suffix = [BitConverter]::ToString($bytes, 0, 4).Replace('-', '').ToLowerInvariant()
} finally { $sha.Dispose() }
# Shader Graph's built-in target reads template files through a legacy path API.
# This short project path keeps its package cache below the Windows path limit.
$fixture = [IO.Path]::GetFullPath((Join-Path $cacheRoot ('MatrixBoulderFixture-' + $suffix)))
if (-not $fixture.StartsWith($cacheRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The Boulder fixture must remain inside the local application cache.'
}
$sourceRoot = Join-Path $root 'Assets\Sandbox\MatrixBoulder'
$relativeScripts = @('Runtime\MatrixBoulderStream.cs', 'Runtime\BoulderCitizenModel.cs',
    'Runtime\BoulderCitizenDemo.cs', 'Editor\MatrixBoulderSceneSetup.cs',
    'Editor\BoulderCitizenValidation.cs')
foreach ($relative in $relativeScripts) {
    $source = Join-Path $sourceRoot $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing Boulder source: $source" }
    $destination = Join-Path (Join-Path $fixture 'Assets\Sandbox\MatrixBoulder') $relative
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force)
    Copy-Item -LiteralPath $source -Destination $destination -Force
    if (Test-Path -LiteralPath ($source + '.meta')) { Copy-Item -LiteralPath ($source + '.meta') -Destination ($destination + '.meta') -Force }
}
foreach ($relative in @('Assets\Sandbox\MatrixBoulder.meta',
        'Assets\Sandbox\MatrixBoulder\Editor.meta', 'Assets\Sandbox\MatrixBoulder\Runtime.meta',
        'Assets\Sandbox\MatrixBoulder\Materials.meta',
        'Assets\Sandbox\MatrixBoulder\Materials\CitizenBeacon.mat',
        'Assets\Sandbox\MatrixBoulder\Materials\CitizenBeacon.mat.meta',
        'Assets\Sandbox\MatrixBoulder\Scenes.meta',
        'Assets\Sandbox\MatrixBoulder\Scenes\MatrixBoulder.unity',
        'Assets\Sandbox\MatrixBoulder\Scenes\MatrixBoulder.unity.meta')) {
    $source = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    $destination = Join-Path $fixture $relative
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force)
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

[void](New-Item -ItemType Directory -Path (Join-Path $fixture 'Packages') -Force)
[void](New-Item -ItemType Directory -Path (Join-Path $fixture 'ProjectSettings') -Force)
Copy-Item -LiteralPath (Join-Path $root 'ProjectSettings\ProjectVersion.txt') -Destination (Join-Path $fixture 'ProjectSettings\ProjectVersion.txt') -Force
$settings = [IO.File]::ReadAllText((Join-Path $root 'ProjectSettings\ProjectSettings.asset'))
$settings = $settings -replace 'activeInputHandler: \d+', 'activeInputHandler: 1'
[IO.File]::WriteAllText((Join-Path $fixture 'ProjectSettings\ProjectSettings.asset'), $settings, [Text.UTF8Encoding]::new($false))
$manifest = @{
    scopedRegistries = @(@{ name = 'Cesium'; url = 'https://unity.pkg.cesium.com'; scopes = @('com.cesium.unity') })
    dependencies = [ordered]@{
        'com.cesium.unity' = '1.25.1'
        'com.unity.inputsystem' = '1.20.0'
        'com.unity.modules.imgui' = '1.0.0'
        'com.unity.modules.physics' = '1.0.0'
        'com.unity.modules.ui' = '1.0.0'
        'com.unity.modules.unitywebrequest' = '1.0.0'
        'com.unity.modules.unitywebrequesttexture' = '1.0.0'
        'com.unity.modules.imageconversion' = '1.0.0'
        'com.unity.ugui' = '2.6.0'
    }
} | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $fixture 'Packages\manifest.json'), $manifest, [Text.UTF8Encoding]::new($false))
if ($PrepareOnly) {
    Write-Host "Prepared isolated Boulder Unity project: $fixture"
    return
}

$log = Join-Path $root 'Validation\matrix-boulder-build.log'
$output = Join-Path $root 'Builds\MatrixBoulder\MatrixBoulder.exe'
[void](New-Item -ItemType Directory -Path (Split-Path -Parent $log) -Force)
[IO.File]::WriteAllText($log, '', [Text.UTF8Encoding]::new($false))
$arguments = @('-batchmode', '-quit', '-projectPath', ('"' + $fixture + '"'), '-buildTarget', 'Win64',
    '-executeMethod', 'ArSandbox.MatrixBoulder.Editor.MatrixBoulderSceneSetup.BuildDesktop',
    '-matrixBoulderBuildOutput', ('"' + $output + '"'), '-logFile', ('"' + $log + '"'))
$process = Start-Process -FilePath $UnityEditor -ArgumentList $arguments -WindowStyle Hidden -PassThru
$process.WaitForExit()
$process.Refresh()
if ($process.ExitCode -ne 0) { throw "Matrix Boulder build exited with code $($process.ExitCode). See $log" }
if (-not (Test-Path -LiteralPath $output -PathType Leaf)) { throw "Matrix Boulder player missing. See $log" }
if ((Get-Item -LiteralPath $output).Length -eq 0) { throw "Matrix Boulder player is empty. See $log" }
if (-not (Select-String -LiteralPath $log -SimpleMatch ('MATRIX_BOULDER_BUILD_OK ' + $output) -Quiet)) {
    throw "Unity did not report the current Boulder build as successful. See $log"
}

# Keep the authored scene and all Unity-generated GUIDs in the source project.
$rootMeta = Join-Path $fixture 'Assets\Sandbox\MatrixBoulder.meta'
if (-not (Test-Path -LiteralPath $rootMeta -PathType Leaf)) { throw "Boulder root .meta missing: $rootMeta" }
Copy-Item -LiteralPath $rootMeta -Destination (Join-Path $root 'Assets\Sandbox\MatrixBoulder.meta') -Force
$generatedRoot = Join-Path $fixture 'Assets\Sandbox\MatrixBoulder'
foreach ($file in Get-ChildItem -LiteralPath $generatedRoot -Recurse -File) {
    if ($file.Extension -notin @('.meta', '.unity', '.mat')) { continue }
    $relative = $file.FullName.Substring($generatedRoot.Length + 1)
    $destination = Join-Path $sourceRoot $relative
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force)
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
}
Write-Host "Matrix Boulder build verified: $output"
Write-Host "Generated scene synchronized: $sourceRoot\Scenes\MatrixBoulder.unity"
