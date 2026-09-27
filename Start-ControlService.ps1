param([int]$Port = 8765)
$ErrorActionPreference = 'Stop'
$pythonCommand = Get-Command python.exe -ErrorAction Stop
Write-Host "Matrix WebXR: http://127.0.0.1:$Port/web/"
Write-Host "Archived Unity Operator: http://127.0.0.1:$Port/legacy/operator"
Write-Host 'Keep this terminal open while using the sandbox. Ctrl+C stops the service.'
& $pythonCommand.Source (Join-Path $PSScriptRoot 'ControlService\server.py') --port $Port
exit $LASTEXITCODE
