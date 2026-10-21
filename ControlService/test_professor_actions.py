import copy
import hashlib
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

from concept_store import ConceptStore
from content_catalog import ContentError
from professor_actions import submit, status, action_key
from test_concept_store import FakeConceptCatalog, FakeNativePortal, panorama_png


class ProfessorActionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.catalog = FakeConceptCatalog(root / 'cache')
        self.native = FakeNativePortal(self.catalog.image)
        self.store = ConceptStore(root / 'concepts', lambda: self.catalog, lambda: self.native)
        self.state = SimpleNamespace(concepts=self.store, agent_turn_submission_lock=threading.Lock(),
            agent_portal_status=lambda value: None, lock=threading.RLock(), latest=None,
            online=lambda: False, client_id='runtime', runtime_generation=1, agent_environment_ids={})
        self.request = dict(sessionId='a'*32, schoolSessionId='00000000-0000-4000-8000-000000000001',
            requestId='00000000-0000-4000-8000-000000000002', requestVersion=1, lessonRevision=1,
            kind='artifact', prompt='An illustrative geometry exhibit.', objectiveId='proof',
            learningIntent='Understand the proof.', interaction=dict(requirement='none', description='Static illustration.', capabilities=[]))

    def test_same_pipeline_and_durable_duplicate_recovery_without_selection(self):
        first=submit(self.state,self.request); second=submit(self.state,{**self.request,'lessonRevision':2})
        self.assertEqual(first['actionId'],second['actionId']); self.assertEqual(len(self.native.requests),1)
        self.assertEqual(first['status'],'generating'); self.assertFalse(first['selected'])
        self.native.available=False
        restarted=ConceptStore(self.store.directory,lambda:self.catalog,lambda:self.native)
        self.state.concepts=restarted
        recovered=submit(self.state,self.request)
        self.assertEqual(recovered['conceptId'],first['conceptId']); self.assertEqual(recovered['status'],'failed')
        self.assertEqual(len(self.native.requests),1,'restart/retry must not silently start another turn')

    def test_changed_payload_and_other_operator_session_do_not_duplicate(self):
        submit(self.state,self.request)
        for changed in ({'prompt':'Different prompt'},{'kind':'location'},{'sessionId':'b'*32},{'objectiveId':'other'}):
            with self.assertRaises(ContentError): submit(self.state,{**self.request,**changed})
        self.assertEqual(len(self.native.requests),1)
        submit(self.state,{**self.request,'requestVersion':2,'prompt':'An explicit edited version.'})
        self.assertEqual(len(self.native.requests),2)

    def test_panorama_semantics_do_not_apply_the_setting(self):
        request={**self.request,'kind':'location'}
        result=submit(self.state,request)
        self.assertEqual(result['purpose'],'panorama'); self.assertIsNone(result['environment'])
        self.assertIn('360-degree equirectangular',self.native.requests[0][1])
        self.native.image.write_bytes(panorama_png())
        self.native.results['image-turn-1']={'status':'ready','imagePath':str(self.native.image), 'sha256':hashlib.sha256(self.native.image.read_bytes()).hexdigest(), 'mimeType':'image/png'}
        ready=status(self.state,request['sessionId'],action_key(request))
        self.assertEqual(ready['status'],'image_ready'); self.assertFalse(ready['selected'])
        self.assertIsNone(ready['environment']); self.assertIsNone(ready['build'])

    def test_fail_closed_native_capability_and_no_paid_or_comfy_fallback(self):
        self.native.available=False
        with self.assertRaises(ContentError): submit(self.state,self.request)
        self.assertEqual(self.native.requests,[]); self.assertEqual(self.catalog.requests,[])
        for extra in ({'code':'shell'},{'providerId':'paid'},{'url':'https://outside.example'}):
            with self.assertRaises(ContentError): submit(self.state,{**self.request,**extra})
        for field in ('requestVersion','lessonRevision'):
            with self.assertRaises(ContentError): submit(self.state,{**self.request,field:True})

    def test_image_ready_is_not_object_loaded_or_interaction(self):
        result=submit(self.state,self.request)
        self.native.results['image-turn-1']={'status':'ready','imagePath':str(self.native.image), 'sha256':hashlib.sha256(self.native.image.read_bytes()).hexdigest(), 'mimeType':'image/png'}
        ready=status(self.state,self.request['sessionId'],result['actionId'])
        self.assertEqual(ready['status'],'image_ready'); self.assertEqual(len(ready['image']['sha256']),64)
        self.assertIsNone(ready['build']); self.assertIsNone(ready['environment'])

    def test_completed_build_needs_current_observed_objects_before_loaded_receipt(self):
        result=submit(self.state,self.request)
        self.native.results['image-turn-1']={'status':'ready','imagePath':str(self.native.image),
            'sha256':hashlib.sha256(self.native.image.read_bytes()).hexdigest(),'mimeType':'image/png'}
        self.store.data['sessions'][self.request['sessionId']]['builds']=[dict(buildRequestId='f'*32,
            conceptId=result['conceptId'],conceptVersion=1,status='completed',creationMode='blender',
            roomId='room',runtimeGeneration=1,objectIds=['object'],assetIds=['web:asset'],receipts=['receipt'])]
        self.assertEqual(status(self.state,self.request['sessionId'],result['actionId'])['status'],'image_ready')
        self.state.online=lambda:True
        self.state.latest={'scene':{'roomId':'room','objects':[{'objectId':'object','assetId':'web:asset'}]}}
        loaded=status(self.state,self.request['sessionId'],result['actionId'])
        self.assertEqual(loaded['status'],'object_loaded');self.assertEqual(loaded['build']['runtimeId'],'runtime')
        self.state.latest['scene']['roomId']='different'
        self.assertEqual(status(self.state,self.request['sessionId'],result['actionId'])['status'],'image_ready')


if __name__=='__main__': unittest.main()
