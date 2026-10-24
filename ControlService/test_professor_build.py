"""Professor starts the existing image-bound Blender turn, never a second generator."""
import copy
import unittest
from content_catalog import ContentError
from professor_actions import build, action_key, build_prompt
from server import agent_portal_turn, concept_build_request
import test_concept_handoff as handoff


class ProfessorBuildTests(unittest.TestCase):
    setUp = handoff.ConceptHandoffTests.setUp
    exchange = handoff.ConceptHandoffTests.exchange

    def prepare(self):
        source = dict(sessionId=self.session_id, schoolSessionId='00000000-0000-4000-8000-000000000001',
            requestId='00000000-0000-4000-8000-000000000002', requestVersion=1, lessonRevision=1,
            kind='artifact', prompt='Illustrate an algorithm.', objectiveId='algorithm',
            learningIntent='Explain the algorithm by moving through its steps.',
            interaction=dict(requirement='none',description='A teaching exhibit.',capabilities=[]))
        def update(data):
            entry = data['sessions'][self.session_id]
            entry['selectedConceptId'] = None
            entry['jobs'][0].update(externalKey=action_key(source), externalRequest=source, providerId='codex-native')
        self.state.concepts._change(update)
        return source, dict(sessionId=self.session_id,schoolSessionId=source['schoolSessionId'],
            requestId=source['requestId'],requestVersion=1,actionId=action_key(source),
            conceptId=self.concept_id,conceptVersion=2,imageSha256=self.digest)

    def start(self, value):
        return build(self.state, value, lambda body: agent_portal_turn(self.state, body, validated_concept_request=True))

    def test_selects_exact_image_starts_existing_blender_turn_once_and_retains_ledger(self):
        source, value = self.prepare()
        self.assertTrue(concept_build_request(build_prompt(source)))
        result = self.start(value)
        self.assertEqual(result['build']['status'], 'requested')
        self.assertEqual(result['build']['creationMode'], 'blender')
        self.assertTrue(result['selected'])
        self.assertEqual(self.backend.sent[0][2], self.image)
        self.assertIn(source['learningIntent'], self.backend.sent[0][1])
        self.assertIn('"creationMode":"blender"', self.backend.sent[0][1])
        second = self.start(value)
        self.assertEqual(second['build']['buildRequestId'], result['build']['buildRequestId'])
        self.assertEqual(len(self.backend.sent), 1)
        self.assertEqual(len(self.state.concepts.data['sessions'][self.session_id]['jobs']), 1)

    def test_http_route_uses_real_guarded_submission_and_repeated_post_recovers(self):
        import json
        import threading
        import urllib.request
        from server import Server
        _, value = self.prepare()
        server = Server(('127.0.0.1', 0), self.state, 'local-professor-build-test-token')
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def post():
                request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/professor/builds',
                    data=json.dumps(value).encode(), headers={'Content-Type':'application/json',
                    'Authorization':'Bearer local-professor-build-test-token'})
                with urllib.request.urlopen(request, timeout=10) as response:
                    return json.load(response)
            first = post(); second = post()
            self.assertEqual(first['build']['creationMode'], 'blender')
            self.assertEqual(first['build']['buildRequestId'], second['build']['buildRequestId'])
            self.assertEqual(len(self.backend.sent), 1)
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_wrong_image_version_hash_or_request_never_selects_or_sends(self):
        _, value = self.prepare()
        for changes in ({'requestVersion':2},{'conceptVersion':3},{'imageSha256':'f'*64},
                        {'conceptId':'f'*32},{'schoolSessionId':'00000000-0000-4000-8000-000000000003'},
                        {'prompt':'arbitrary tool request'}):
            with self.subTest(changes=changes), self.assertRaises(ContentError): self.start({**value,**changes})
        self.assertEqual(self.backend.sent, [])
        self.assertIsNone(self.state.concepts.data['sessions'][self.session_id]['selectedConceptId'])

    def test_offline_runtime_and_busy_operator_do_not_start_a_build(self):
        _, value = self.prepare()
        self.state.last_seen -= 1000
        with self.assertRaises(Exception): self.start(value)
        self.assertEqual(self.backend.sent, [])
        self.exchange()
        self.state.agent_turn_submission_lock.acquire()
        try:
            with self.assertRaises(ContentError): self.start(value)
        finally: self.state.agent_turn_submission_lock.release()
        self.assertEqual(self.backend.sent, [])

    def test_panorama_cannot_be_used_as_an_exhibit_build(self):
        _, value = self.prepare()
        self.state.concepts.data['sessions'][self.session_id]['jobs'][0]['externalRequest']['kind']='location'
        with self.assertRaises(ContentError): self.start(value)
        self.assertEqual(self.backend.sent, [])


if __name__ == '__main__': unittest.main()
