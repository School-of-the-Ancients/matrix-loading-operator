import unittest
from unittest.mock import patch
import professor_speech
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
        with patch.object(professor_speech,'configuration',return_value={'ref_audio_path':'local.wav','prompt_text':'reference','prompt_lang':'en','text_lang':'en'}),patch.object(professor_speech.http.client,'HTTPConnection') as factory:
            response=factory.return_value.getresponse.return_value
            response.status=200;response.read.return_value=b'not audio'
            with self.assertRaises(TTSError):professor_speech.synthesize('Hello')
            factory.assert_called_once_with('127.0.0.1',9880,timeout=60)
            factory.return_value.close.assert_called_once()
