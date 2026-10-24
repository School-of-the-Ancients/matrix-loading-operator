import unittest
from unittest.mock import patch
import professor_speech
import json
from pathlib import Path
from professor_context import checked_lesson_context
from agent_portal import compact_matrix_context
from tts import TTSError

class ProfessorSpeechTests(unittest.TestCase):
    def test_lesson_context_is_bounded_and_survives_operator_prompt_compaction(self):
        lesson={'sessionId':'00000000-0000-4000-8000-000000000001','teacherName':'Ada','goal':'Algorithms','events':[{'speaker':'learner','recipient':'professor','text':'Explain a loop'}]}
        self.assertEqual(compact_matrix_context({'lessonContext':checked_lesson_context(lesson)})['lessonContext'],lesson)
        with self.assertRaises(ValueError):checked_lesson_context({**lesson,'shell':'execute'})
    def test_browser_cannot_choose_a_path_or_url(self):
        for value in ({'url':'http://elsewhere'}, '', 'x'*601):
            with self.assertRaises(TTSError):professor_speech.synthesize(value)
    def test_sovits_uses_fixed_loopback_and_validates_audio(self):
        with patch.object(professor_speech,'configuration',return_value={'ref_audio_path':str(Path(__file__).resolve()),'prompt_text':'reference','prompt_lang':'en','text_lang':'en'}),patch.object(professor_speech.http.client,'HTTPConnection') as factory:
            response=factory.return_value.getresponse.return_value
            response.status=200;response.read.return_value=b'not audio'
            with self.assertRaises(TTSError):professor_speech.synthesize('Hello')
            factory.assert_called_once_with('127.0.0.1',9880,timeout=60)
            factory.return_value.close.assert_called_once()

    def test_configured_teachers_route_to_distinct_allowlisted_local_voices(self):
        settings=json.loads(professor_speech.CONFIG.read_text())
        with patch.object(professor_speech.kokoro_speech.worker,'synthesize',return_value=b'RIFF-test') as speak:
            self.assertEqual(professor_speech.synthesize('Hello','davinci'),b'RIFF-test')
            self.assertEqual(speak.call_args.args[1]['voice'],'bm_george')
            professor_speech.synthesize('Hello','ada_lovelace')
            self.assertEqual(speak.call_args.args[1]['voice'],'bf_emma')
            professor_speech.synthesize('Hello','custom-teacher')
            self.assertEqual(speak.call_args.args[1]['voice'],'am_michael')
            professor_speech.synthesize('Hello','davinci','emma')
            self.assertEqual(speak.call_args.args[1]['voice'],'bf_emma')
        for voice in ('../../file','http://elsewhere',{},'x'*81):
            with self.assertRaises(TTSError):professor_speech.select_profile(settings,'davinci',voice)

    def test_voice_catalog_never_exposes_reference_paths_or_private_configuration(self):
        catalog=professor_speech.public_catalog()
        self.assertEqual(catalog['teachers']['davinci'],'george')
        self.assertNotIn('ref_audio_path',json.dumps(catalog))
        self.assertNotIn('prompt_text',json.dumps(catalog))
