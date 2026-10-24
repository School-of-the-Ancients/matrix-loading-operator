import base64
import io
import json
import queue
import unittest
from unittest.mock import Mock, patch
import kokoro_speech
from tts import TTSError


class KokoroWorkerTests(unittest.TestCase):
    def prepared(self, response):
        worker = kokoro_speech.Worker()
        worker.process = Mock()
        worker.process.poll.return_value = None
        worker.process.stdin = io.StringIO()
        worker.output = queue.Queue()
        worker.output.put(response)
        return worker

    def test_selected_profile_and_valid_wave_return_from_warm_worker(self):
        data=b'RIFF'+b'\0'*4+b'WAVE'+b'\0'*40
        worker=self.prepared(json.dumps({'wav':base64.b64encode(data).decode()}))
        self.assertEqual(worker.synthesize('Hello',{'voice':'bm_george','language':'en-gb','speed':1}),data)
        payload=json.loads(worker.process.stdin.getvalue())
        self.assertEqual(payload,{'text':'Hello','voice':'bm_george','language':'en-gb','speed':1})

    def test_invalid_audio_and_exited_worker_fail_without_a_silent_voice_fallback(self):
        for response in (None,json.dumps({'error':'private error details'}),json.dumps({'wav':'aW52YWxpZA=='})):
            worker=self.prepared(response)
            with patch.object(worker,'close') as close:
                with self.assertRaises(TTSError) as failure:worker.synthesize('Hello',{'voice':'bm_george'})
                self.assertNotIn('private error',str(failure.exception))
                close.assert_called_once()
            self.assertTrue(worker.lock.acquire(blocking=False))
            worker.lock.release()

    def test_missing_install_has_actionable_error(self):
        with patch('kokoro_speech.available',return_value=False):
            with self.assertRaisesRegex(TTSError,'Setup-ProfessorVoices'):kokoro_speech.Worker().synthesize('Hello',{'voice':'bm_george'})
