param([int]$Port = 8765)
$ErrorActionPreference = 'Stop'
$pythonCommand = Get-Command python.exe -ErrorAction Stop
Write-Host "Control page: http://127.0.0.1:$Port/"
Write-Host 'Keep this terminal open while using the sandbox. Ctrl+C stops the service.'
& $pythonCommand.Source (Join-Path $PSScriptRoot 'ControlService\server.py') --port $Port
exit $LASTEXITCODE
