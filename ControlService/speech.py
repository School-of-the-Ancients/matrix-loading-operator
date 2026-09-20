"""PC-local speech adapter. Audio is bounded, processed in memory and never saved.

Optional faster-whisper dependencies live in .speech-venv, separate from the
standard-library control service. The worker is offline and has a hard timeout.
"""
from __future__ import annotations

import base64
import binascii
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parent.parent
MAX_AUDIO_BYTES = 480044  # 15 seconds, 16 kHz mono PCM16, canonical WAV header.


class SpeechError(Exception):
    def __init__(self, message, status=422):
        self.status = status
        super().__init__(message)


def decode_audio(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 4 * ((MAX_AUDIO_BYTES + 2) // 3):
        raise SpeechError("Voice recording must be between 0.25 and 15 seconds", 400)
    try:
        data = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise SpeechError("Invalid audio encoding", 400) from None
    validate_audio(data)
    return data


def validate_audio(data):
    if not 44 <= len(data) <= MAX_AUDIO_BYTES:
        raise SpeechError("Voice recording exceeds the 15 second limit", 400)
    try:
        with wave.open(io.BytesIO(data), "rb") as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, 16000, "NONE"):
                raise SpeechError("Audio must be 16 kHz mono PCM16 WAV", 400)
            frames = audio.getnframes()
            if not 4000 <= frames <= 240000:
                raise SpeechError("Hold push-to-talk for 0.25 to 15 seconds", 400)
            pcm = audio.readframes(frames)
            if len(pcm) != frames * 2:
                raise SpeechError("Incomplete voice recording", 400)
    except (wave.Error, EOFError, struct.error):
        raise SpeechError("Invalid WAV recording", 400) from None
    # Avoid Whisper hallucinations on silence before loading a model.
    samples = struct.unpack("<" + "h" * frames, pcm)
    rms = (sum(sample * sample for sample in samples) / frames) ** 0.5 / 32768
    if rms < 0.001:
        raise SpeechError("No speech heard. Hold the left trigger and speak again.")


def configuration():
    python = Path(os.environ.get("SANDBOX_SPEECH_PYTHON", str(ROOT / ".speech-venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))))
    model = Path(os.environ.get("SANDBOX_SPEECH_MODEL", str(ROOT / ".speech-models" / "base.en")))
    if not python.is_file() or not all((model / name).is_file() for name in ("model.bin", "config.json", "tokenizer.json")):
        raise SpeechError("Local speech recognition is not installed. Run Setup-LocalSpeech.ps1 on the PC.", 503)
    return python, model


def public_status():
    try:
        configuration()
        return {"configured": True, "provider": "Local Whisper (PC)", "language": "English", "maxSeconds": 15}
    except SpeechError as error:
        return {"configured": False, "provider": "Local Whisper (PC)", "error": str(error)}


def transcribe(data):
    validate_audio(data)
    python, model = configuration()
    env = dict(os.environ)
    # No provider credentials, telemetry or implicit model downloads in the worker.
    for key in tuple(env):
        if key.endswith(("API_KEY", "TOKEN")) or key in ("SANDBOX_TOKEN", "HF_TOKEN_PATH"):
            env.pop(key, None)
    env.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
    try:
        process = subprocess.run([str(python), str(Path(__file__).resolve()), "--worker", str(model)],
                                 input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 env=env, timeout=90, check=False,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        raise SpeechError("Speech recognition timed out. Try a shorter recording.", 504) from None
    except OSError:
        raise SpeechError("Could not start local speech recognition. Run Setup-LocalSpeech.ps1.", 503) from None
    if process.returncode:
        raise SpeechError("Local speech recognition failed. Check the PC speech installation.", 503)
    try:
        result = json.loads(process.stdout)
        transcript = result["transcript"]
        if not isinstance(transcript, str) or len(transcript) > 4000:
            raise ValueError()
        transcript = " ".join(transcript.split())
    except (ValueError, KeyError, TypeError):
        raise SpeechError("Speech recognition returned invalid text", 502) from None
    if not transcript:
        raise SpeechError("No speech heard. Hold the left trigger and speak again.")
    return transcript


def worker(model):
    from faster_whisper import WhisperModel
    data = sys.stdin.buffer.read(MAX_AUDIO_BYTES + 1)
    validate_audio(data)
    engine = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
    segments, _ = engine.transcribe(io.BytesIO(data), language="en", beam_size=5,
                                   vad_filter=True, condition_on_previous_text=False)
    transcript = " ".join(segment.text.strip() for segment in segments
                          if segment.no_speech_prob < 0.6 and segment.avg_logprob > -1.0)
    sys.stdout.write(json.dumps({"transcript": transcript}))


if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "--worker":
    worker(sys.argv[2])
