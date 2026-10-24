"""Local SoVITS output for the Professor. No browser-supplied paths or URLs."""
import http.client
import json
from pathlib import Path
import threading
from tts import TTSError

CONFIG = Path(__file__).with_name('professor_voice.json')
MAX_WAV = 16 * 1024 * 1024
_slots = threading.BoundedSemaphore(2)


def configuration():
    try:
        value = json.loads(CONFIG.read_text(encoding='utf-8'))
        reference = Path(value['ref_audio_path'])
        if not reference.is_absolute() or not reference.is_file():
            raise ValueError()
        return value
    except (OSError, ValueError, KeyError, TypeError):
        raise TTSError('Professor voice reference is unavailable. Check professor_voice.json.') from None


def synthesize(text):
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 600 or any(ord(c) < 32 and c not in '\n\t' for c in text):
        raise TTSError('Professor speech needs 1 to 600 characters.', 400)
    settings = configuration()
    if not _slots.acquire(blocking=False):
        raise TTSError('Professor voice is busy. Try again shortly.', 429)
    connection = http.client.HTTPConnection('127.0.0.1', 9880, timeout=60)
    try:
        payload = {key: settings[key] for key in ('ref_audio_path','prompt_text','prompt_lang','text_lang')}
        payload.update(text=text, aux_ref_audio_paths=[], speed_factor=1.1)
        connection.request('POST', '/tts', json.dumps(payload).encode(), {'Content-Type':'application/json'})
        response = connection.getresponse()
        data = response.read(MAX_WAV + 1)
        if response.status != 200 or not 44 <= len(data) <= MAX_WAV or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
            raise TTSError('Local SoVITS did not return valid speech. The text remains saved.')
        return data
    except (OSError, http.client.HTTPException):
        raise TTSError('Start the existing GPT-SoVITS service on port 9880 to hear the professor.') from None
    finally:
        connection.close()
        _slots.release()
