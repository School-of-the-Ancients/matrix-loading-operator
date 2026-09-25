$ErrorActionPreference = 'Stop'
$speech = $null
$stream = $null
try {
    [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
    $message = [Console]::In.ReadToEnd()
    Add-Type -AssemblyName System.Speech
    $speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $stream = New-Object System.IO.MemoryStream
    $speech.SetOutputToWaveStream($stream)
    $speech.Speak($message)
    $bytes = $stream.ToArray()
    [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
} catch {
    [Console]::Error.WriteLine('PC speech output failed: ' + $_.Exception.Message)
    exit 1
} finally {
    if ($speech) { $speech.Dispose() }
    if ($stream) { $stream.Dispose() }
}
