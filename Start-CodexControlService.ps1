param(
    [ValidateRange(1, 65535)][int]$Port = 8765,
    [string]$CodexExe,
    [string]$Model,
    [ValidateSet('read-only', 'workspace-write', 'danger-full-access')][string]$AgentSandbox = 'workspace-write',
    [ValidateSet('default', 'unelevated')][string]$WindowsSandbox = 'default',
    [string]$ContentLibrary,
    [string]$SpeechRoot
)
$ErrorActionPreference = 'Stop'
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Port $Port is already in use. Stop the existing Operator service before starting this one."
}
if (-not $CodexExe) { $CodexExe = (Get-Command codex.exe -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $CodexExe -PathType Leaf) -or [IO.Path]::GetExtension($CodexExe) -ne '.exe') {
    throw 'Supply the native Codex executable, or make codex.exe available on PATH.'
}
$python = (Get-Command python.exe -ErrorAction Stop).Source
$names = 'SANDBOX_AI_MODE', 'SANDBOX_CODEX_EXE', 'SANDBOX_CODEX_MODEL', 'SANDBOX_CODEX_AGENT_SANDBOX', 'SANDBOX_CODEX_WINDOWS_SANDBOX', 'CODEX_API_KEY', 'OPENAI_API_KEY', 'MATRIX_CONTENT_CONFIG', 'MATRIX_CONTENT_CACHE', 'SANDBOX_SPEECH_PYTHON', 'SANDBOX_SPEECH_MODEL'
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$defaultContentLibrary = Join-Path $env:USERPROFILE 'Documents\Codex\MatrixPolyHavenLibrary'
if (-not $ContentLibrary -and -not $env:MATRIX_CONTENT_CONFIG -and
    (Test-Path -LiteralPath (Join-Path $defaultContentLibrary 'matrix-content-config.json') -PathType Leaf)) {
    $ContentLibrary = $defaultContentLibrary
}
$serviceExitCode = 1
try {
    if ($SpeechRoot -or (-not $env:SANDBOX_SPEECH_PYTHON -and -not $env:SANDBOX_SPEECH_MODEL)) {
        $roots = @()
        if ($SpeechRoot) {
            $roots = @((Resolve-Path -LiteralPath $SpeechRoot -ErrorAction Stop).Path)
        } else {
            $roots = @($PSScriptRoot)
            $parent = Split-Path -Parent $PSScriptRoot
            $roots += @(Get-ChildItem -LiteralPath $parent -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -ne $PSScriptRoot } | Select-Object -ExpandProperty FullName)
        }
        $installed = @($roots | Where-Object {
            (Test-Path -LiteralPath (Join-Path $_ '.speech-venv\Scripts\python.exe') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $_ '.speech-models\base.en\model.bin') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $_ '.speech-models\base.en\config.json') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $_ '.speech-models\base.en\tokenizer.json') -PathType Leaf)
        })
        if (-not $SpeechRoot -and $installed -contains $PSScriptRoot) { $installed = @($PSScriptRoot) }
        if ($SpeechRoot -and $installed.Count -ne 1) { throw "No complete local speech installation at $SpeechRoot" }
        if ($installed.Count -eq 1) {
            [Environment]::SetEnvironmentVariable('SANDBOX_SPEECH_PYTHON', (Join-Path $installed[0] '.speech-venv\Scripts\python.exe'), 'Process')
            [Environment]::SetEnvironmentVariable('SANDBOX_SPEECH_MODEL', (Join-Path $installed[0] '.speech-models\base.en'), 'Process')
            Write-Host "Using local speech installation: $($installed[0])"
        }
    }
    if ($ContentLibrary) {
        $library = (Resolve-Path -LiteralPath $ContentLibrary -ErrorAction Stop).Path
        $config = Join-Path $library 'matrix-content-config.json'
        if (-not (Test-Path -LiteralPath $config -PathType Leaf)) {
            throw "The content catalog is missing: $config"
        }
        $cache = Join-Path $library 'Cache'
        New-Item -ItemType Directory -Path $cache -Force | Out-Null
        [Environment]::SetEnvironmentVariable('MATRIX_CONTENT_CONFIG', $config, 'Process')
        [Environment]::SetEnvironmentVariable('MATRIX_CONTENT_CACHE', $cache, 'Process')
        Write-Host "Using content library: $library"
    }
    # The user selected subscription access. Let Codex manage its own saved login.
    [Environment]::SetEnvironmentVariable('CODEX_API_KEY', $null, 'Process')
    [Environment]::SetEnvironmentVariable('OPENAI_API_KEY', $null, 'Process')
    # Codex writes its successful login status to stderr; Windows PowerShell 5
    # otherwise turns that native output into a terminating NativeCommandError.
    $ErrorActionPreference = 'Continue'
    $login = @(& $CodexExe login status 2>&1)
    $loginExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($loginExitCode -ne 0 -or -not ($login | Where-Object { "$_".Trim() -eq 'Logged in using ChatGPT' })) {
        throw 'Codex ChatGPT sign-in is unavailable. Run codex login on this PC, then retry.'
    }
    [Environment]::SetEnvironmentVariable('SANDBOX_AI_MODE', 'codex-cli', 'Process')
    [Environment]::SetEnvironmentVariable('SANDBOX_CODEX_EXE', $CodexExe, 'Process')
    [Environment]::SetEnvironmentVariable('SANDBOX_CODEX_MODEL', $Model, 'Process')
    [Environment]::SetEnvironmentVariable('SANDBOX_CODEX_AGENT_SANDBOX', $AgentSandbox, 'Process')
    [Environment]::SetEnvironmentVariable('SANDBOX_CODEX_WINDOWS_SANDBOX', $(if ($WindowsSandbox -eq 'default') { $null } else { $WindowsSandbox }), 'Process')
    Write-Host 'Using the existing Codex ChatGPT sign-in on this PC. Subscription usage limits apply.'
    Write-Host "Agent Portal sandbox: $AgentSandbox; Windows sandbox: $WindowsSandbox"
    Write-Host "Control page: http://127.0.0.1:$Port/"
    Write-Host 'Keep this terminal open. Review each AI proposal before applying it. Ctrl+C stops the service.'
    & $python (Join-Path $PSScriptRoot 'ControlService\server.py') --port $Port
    $serviceExitCode = $LASTEXITCODE
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
exit $serviceExitCode
