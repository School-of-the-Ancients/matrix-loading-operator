"""Own one bounded local worker, without opening a port or sharing credentials."""
import atexit
import base64
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
from tts import TTSError

ROOT = Path(__file__).resolve().parent.parent
PYTHON = ROOT / '.voice-venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
MODELS = ROOT / '.voice-models' / 'kokoro'
MAX_WAV = 16 * 1024 * 1024


def available():
    return PYTHON.is_file() and all((MODELS / name).is_file()
                                  for name in ('kokoro-v1.0.onnx', 'voices-v1.0.bin'))


class Worker:
    def __init__(self):
        self.lock = threading.Lock()
        self.process = None
        self.output = None

    def close(self):
        process, self.process = self.process, None
        if process:
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
            for stream in (process.stdin, process.stdout):
                if stream:
                    stream.close()

    def start(self):
        if self.process and self.process.poll() is None:
            return
        self.close()
        if not available():
            raise TTSError('Local professor voices are not installed. Run Tools/Setup-ProfessorVoices.ps1.', 503)
        env = {key: value for key, value in os.environ.items()
               if not key.endswith(('API_KEY', 'TOKEN')) and not key.startswith(('OPENAI_', 'AZURE_OPENAI_'))}
        self.process = subprocess.Popen(
            [str(PYTHON), '-I', '-u', str(Path(__file__).with_name('kokoro_worker.py')), str(MODELS)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding='utf-8', env=env,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        process, output = self.process, queue.Queue(maxsize=2)
        self.output = output

        def read():
            try:
                for line in process.stdout:
                    output.put(line)
            except (OSError, ValueError):
                pass
            finally:
                output.put(None)

        threading.Thread(target=read, daemon=True).start()

    def synthesize(self, text, profile):
        if not self.lock.acquire(timeout=75):
            raise TTSError('Professor voice is busy. Try again shortly.', 429)
        try:
            self.start()
            self.process.stdin.write(json.dumps({'text': text, 'voice': profile['voice'],
                                                'speed': profile.get('speed', 1),
                                                'language': profile.get('language', 'en-us')}) + '\n')
            self.process.stdin.flush()
            line = self.output.get(timeout=75)
            if line is None:
                raise ValueError('Worker stopped')
            result = json.loads(line)
            data = base64.b64decode(result['wav'], validate=True)
            if not 44 <= len(data) <= MAX_WAV or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
                raise ValueError('Invalid WAV')
            return data
        except (OSError, ValueError, KeyError, queue.Empty) as error:
            self.close()
            raise TTSError('Local professor speech failed. Text remains saved; retry playback.', 503) from error
        finally:
            self.lock.release()


worker = Worker()
atexit.register(worker.close)
