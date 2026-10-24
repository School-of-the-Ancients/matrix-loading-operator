import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from unittest.mock import patch
from server import Server, State
from agent_portal import AgentPortal
from concept_store import ConceptStore
from test_agent_portal import FakeBackend
from test_concept_store import FakeConceptCatalog, FakeNativePortal

class ProfessorHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name);self.state=State(root/'state')
        self.state.agent_portal=AgentPortal(root/'portal',lambda:FakeBackend([False]))
        catalog=FakeConceptCatalog(root/'cache');self.native=FakeNativePortal(catalog.image)
        self.state.concepts=ConceptStore(root/'concepts',lambda:catalog,lambda:self.native)
        self.server=Server(('127.0.0.1',0),self.state,'local-test-token-012345678901234')
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'
        self.ui=root/'ui';self.ui.mkdir();(self.ui/'index.html').write_text('<main>Entire Professor UI</main>')
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
    def call(self,path,body=None,auth=True,**headers):
        if auth:headers['Authorization']='Bearer '+self.server.token
        if body is not None:headers['Content-Type']='application/json'
        req=urllib.request.Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
        try:r=urllib.request.urlopen(req,timeout=10)
        except urllib.error.HTTPError as e:r=e
        with r:return r.status,r.headers,r.read()
    def test_actions_keep_existing_auth_origin_and_strict_fields(self):
        sid=json.loads(self.call('/api/agent/session',{})[2])['sessionId']
        body=dict(sessionId=sid,schoolSessionId='00000000-0000-4000-8000-000000000001',requestId='00000000-0000-4000-8000-000000000002',requestVersion=1,lessonRevision=1,kind='artifact',prompt='Static exhibit',objectiveId='proof',learningIntent='Explain proof',interaction=dict(requirement='none',description='Static.',capabilities=[]))
        self.assertEqual(self.call('/api/professor/actions',body,auth=False)[0],401)
        self.assertEqual(self.call('/api/professor/actions',body,Origin='https://outside.example')[0],403)
        self.assertEqual(self.call('/api/professor/actions',{**body,'tool':'shell'})[0],400)
        result=json.loads(self.call('/api/professor/actions',body,Origin=self.base)[2])
        query=f"/api/professor/actions?sessionId={sid}&actionId={result['actionId']}"
        self.assertEqual(self.call(query,auth=False)[0],401)
        self.assertEqual(json.loads(self.call(query)[2])['conceptId'],result['conceptId'])
        self.call('/api/professor/actions',body);self.assertEqual(len(self.native.requests),1)
    def test_build_endpoint_preserves_auth_origin_and_rejects_arbitrary_fields(self):
        self.assertEqual(self.call('/api/professor/builds',{},auth=False)[0],401)
        self.assertEqual(self.call('/api/professor/builds',{},Origin='https://outside.example')[0],403)
        self.assertEqual(self.call('/api/professor/builds',{'prompt':'run anything'})[0],400)

    def test_avatar_catalog_uses_existing_auth_and_contains_only_public_entries(self):
        self.assertEqual(self.call('/api/professor/avatars',auth=False)[0],401)
        code,_,body=self.call('/api/professor/avatars')
        self.assertEqual(code,200)
        catalog=json.loads(body)
        self.assertEqual(catalog['schemaVersion'],1)
        self.assertEqual(catalog['avatars'][0]['catalogId'],'generic-professor')
        self.assertNotIn('sourcePath',body.decode())

    def test_professor_voice_keeps_auth_and_fixed_server_adapters(self):
        self.assertEqual(self.call('/api/professor/speak',{'text':'hello'},auth=False)[0],401)
        self.assertEqual(self.call('/api/professor/speak',{'text':'hello','url':'http://elsewhere'})[0],400)
        with patch('server.professor_speech.synthesize',return_value=b'RIFF-test'):
            code,headers,body=self.call('/api/professor/speak',{'text':'hello'})
            self.assertEqual(code,200);self.assertEqual(body,b'RIFF-test');self.assertEqual(headers['Content-Type'],'audio/wav')
        with patch('server.speech.decode_audio',return_value=b'audio'),patch('server.speech.transcribe',return_value='hello'):
            self.assertEqual(json.loads(self.call('/api/professor/transcribe',{'audioBase64':'test'})[2])['transcript'],'hello')
            self.assertTrue(self.state.voice_worker.acquire(blocking=False));self.state.voice_worker.release()

    def test_mount_is_opt_in_loopback_same_origin_and_does_not_relax_matrix_policy(self):
        self.assertEqual(self.call('/professor/')[0],503)
        self.server.professor_ui=self.ui
        self.assertEqual(self.call('/professor/',auth=False)[0],401)
        self.assertEqual(self.call('/professor/',Origin='https://outside.example')[0],403)
        code,headers,body=self.call('/professor/');self.assertEqual(code,200)
        self.assertIn('Entire Professor UI',body.decode());self.assertIn("frame-ancestors 'self'",headers['Content-Security-Policy'])
        self.assertIn("frame-ancestors 'none'",self.call('/api/health')[1]['Content-Security-Policy'])
        self.assertEqual(self.call('/professor/assets/../server.py')[0],404)
        self.assertEqual(self.call('/api/school/sessions',Origin='https://outside.example')[0],403)
