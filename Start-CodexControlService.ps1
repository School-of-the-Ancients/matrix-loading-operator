param(
    [ValidateRange(1, 65535)][int]$Port = 8765,
    [string]$CodexExe,
    [string]$Model
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
$names = 'SANDBOX_AI_MODE', 'SANDBOX_CODEX_EXE', 'SANDBOX_CODEX_MODEL', 'CODEX_API_KEY', 'OPENAI_API_KEY'
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$serviceExitCode = 1
try {
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
    Write-Host 'Using the existing Codex ChatGPT sign-in on this PC. Subscription usage limits apply.'
    Write-Host "Control page: http://127.0.0.1:$Port/"
    Write-Host 'Keep this terminal open. Review each AI proposal before applying it. Ctrl+C stops the service.'
    & $python (Join-Path $PSScriptRoot 'ControlService\server.py') --port $Port
    $serviceExitCode = $LASTEXITCODE
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
exit $serviceExitCode
