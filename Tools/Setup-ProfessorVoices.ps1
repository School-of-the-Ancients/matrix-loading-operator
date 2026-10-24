$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot
$voiceEnvironment=Join-Path $projectRoot '.voice-venv'
$voicePython=Join-Path $voiceEnvironment 'Scripts\python.exe'
$models=Join-Path $projectRoot '.voice-models\kokoro'
if(!(Get-Command uv -ErrorAction SilentlyContinue)){throw 'Install uv from https://docs.astral.sh/uv/ first.'}
if(!(Test-Path -LiteralPath $voicePython)){
    & uv venv --python 3.11 $voiceEnvironment
    if($LASTEXITCODE -ne 0){throw 'Voice environment creation failed.'}
}
& uv pip install --python $voicePython -r (Join-Path $PSScriptRoot 'requirements-professor-voices.txt')
if($LASTEXITCODE -ne 0){throw 'Voice dependency installation failed.'}
New-Item -ItemType Directory -Path $models -Force | Out-Null
$files=@{
    'kokoro-v1.0.onnx'='beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a'
    'voices-v1.0.bin'='bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'
}
foreach($name in $files.Keys){
    $target=Join-Path $models $name
    if((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant() -eq $files[$name]){continue}
    $partial="$target.partial"
    & curl.exe -fL --retry 2 "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/$name" -o $partial
    if($LASTEXITCODE -ne 0){throw "Download failed: $name"}
    if((Get-FileHash -LiteralPath $partial).Hash.ToLowerInvariant() -ne $files[$name]){throw "Model checksum mismatch: $name"}
    Move-Item -LiteralPath $partial -Destination $target -Force
}
Write-Output 'Local professor voices installed. Restart Matrix, then choose Professor voice in the conversation panel.'
