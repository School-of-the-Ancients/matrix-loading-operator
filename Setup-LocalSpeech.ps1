param([string]$Python = 'python.exe')
$ErrorActionPreference = 'Stop'
$envRoot = Join-Path $PSScriptRoot '.speech-venv'
$speechPython = Join-Path $envRoot 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $speechPython)) {
    & $Python -m venv $envRoot
    if ($LASTEXITCODE -ne 0) { throw 'Speech environment creation failed.' }
}
& $speechPython -m pip install -r (Join-Path $PSScriptRoot 'ControlService/speech-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Speech dependency installation failed.' }
$modelRoot = Join-Path $PSScriptRoot '.speech-models/base.en'
# Download only the public model and its license. No account or API key is used.
& $speechPython (Join-Path $PSScriptRoot 'ControlService/install_speech_model.py') $modelRoot
if ($LASTEXITCODE -ne 0) { throw 'Speech model download failed.' }
Write-Host 'Local English speech recognition is installed. Restart the PC Operator service if needed.'
