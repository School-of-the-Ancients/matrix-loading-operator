"""Private stdio TTS worker; the model stays warm between spoken chunks."""
import base64
import io
import json
import sys
import wave
from pathlib import Path


def run(directory):
    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro

    directory = Path(directory)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(directory / 'kokoro-v1.0.onnx'),
                                   sess_options=options, providers=['CPUExecutionProvider'])
    engine = Kokoro.from_session(session, str(directory / 'voices-v1.0.bin'))
    for line in sys.stdin:
        try:
            request = json.loads(line)
            text, voice = request['text'], request['voice']
            if not isinstance(text, str) or not 1 <= len(text) <= 600 or voice not in engine.voices:
                raise ValueError('Invalid speech request')
            samples, rate = engine.create(text, voice=voice, speed=request['speed'], lang=request['language'])
            pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
            buffer = io.BytesIO()
            with wave.open(buffer, 'wb') as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(rate)
                audio.writeframes(pcm)
            result = {'wav': base64.b64encode(buffer.getvalue()).decode('ascii')}
        except Exception:
            # Never include local paths or text in an HTTP-visible error.
            result = {'error': 'Local Kokoro could not synthesize this speech.'}
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    run(sys.argv[1])
