"""Allowlisted local Professor voice profiles. No browser paths or URLs."""
import http.client
import json
from pathlib import Path
import threading
from tts import TTSError
import kokoro_speech

CONFIG = Path(__file__).with_name('professor_voice.json')
MAX_WAV = 16 * 1024 * 1024
_slots = threading.BoundedSemaphore(2)


def configuration():
    try:
        value = json.loads(CONFIG.read_text(encoding='utf-8'))
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (OSError, ValueError, KeyError, TypeError):
        raise TTSError('Professor voice reference is unavailable. Check professor_voice.json.') from None


def public_catalog():
    settings = configuration()
    ready = kokoro_speech.available()
    profiles = settings.get('profiles', {})
    return {'defaultVoice': settings.get('defaultVoice', 'riko'),
            'teachers': settings.get('teachers', {}),
            'voices': [{'id': key, 'label': value['label'], 'provider': value['provider'],
                        'available': ready if value['provider'] == 'kokoro' else Path(settings.get('ref_audio_path', '')).is_file()}
                       for key, value in profiles.items()]}


def select_profile(settings, teacher_id=None, voice_id=None):
    if teacher_id is not None and (not isinstance(teacher_id, str) or len(teacher_id) > 160):
        raise TTSError('Invalid professor identity.', 400)
    if voice_id is not None and (not isinstance(voice_id, str) or len(voice_id) > 80):
        raise TTSError('Invalid professor voice.', 400)
    profiles = settings.get('profiles')
    if not profiles:
        if voice_id not in (None, '', 'riko'):
            raise TTSError('Unknown professor voice.', 400)
        return {'provider': 'sovits'}
    selected = voice_id or settings.get('teachers', {}).get(teacher_id, settings['defaultVoice'])
    if selected not in profiles:
        raise TTSError('Unknown professor voice.', 400)
    return profiles[selected]


def synthesize(text, teacher_id=None, voice_id=None):
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 600 or any(ord(c) < 32 and c not in '\n\t' for c in text):
        raise TTSError('Professor speech needs 1 to 600 characters.', 400)
    settings = configuration()
    profile = select_profile(settings, teacher_id, voice_id)
    if not _slots.acquire(blocking=False):
        raise TTSError('Professor voice is busy. Try again shortly.', 429)
    connection = None
    try:
        if profile['provider'] == 'kokoro':
            return kokoro_speech.worker.synthesize(text, profile)
        reference = Path(settings.get('ref_audio_path', ''))
        if not reference.is_absolute() or not reference.is_file():
            raise TTSError('Riko voice reference is unavailable. Choose a local professor voice.', 503)
        connection = http.client.HTTPConnection('127.0.0.1', 9880, timeout=60)
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
        if connection:
            connection.close()
        _slots.release()
