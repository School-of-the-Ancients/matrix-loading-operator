"""Bounded PC text-to-speech output for headset browsers without Web Speech audio."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess

MAX_TEXT = 300
MAX_WAV = 4 * 1024 * 1024
WORKER = Path(__file__).with_name("tts_worker.ps1")


class TTSError(Exception):
    def __init__(self, message, status=503):
        self.status = status
        super().__init__(message)


def synthesize(value):
    if not isinstance(value, str) or not value.strip() or len(value) > MAX_TEXT or any(ord(char) < 32 for char in value):
        raise TTSError("Reply must be 1 to 300 printable characters", 400)
    if os.name != "nt":
        raise TTSError("PC speech output is available on Windows")
    powershell = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    try:
        result = subprocess.run([str(powershell), "-NoProfile", "-NonInteractive", "-File", str(WORKER)],
                                input=value.encode("utf-8"), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=25, check=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired):
        raise TTSError("PC speech output could not start") from None
    data = result.stdout
    if result.returncode or not 44 <= len(data) <= MAX_WAV or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise TTSError("PC speech output failed")
    return data
