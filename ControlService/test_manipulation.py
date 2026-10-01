from copy import deepcopy
import tempfile
import unittest
from unittest.mock import patch
from server import APIError, State, scene
from test_matrix_move import ROOM
from matrix_tool_bridge import MatrixToolBridge, manipulation_action, manipulation_status, scene_summary
import urllib.error
from agent_session import _new_matrix_approval_summary

class ManipulationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.state=State(self.temp.name)
        self.state.exchange({'clientId':'web-client','snapshot':deepcopy(ROOM),'results':[]})

    def request(self,**changes):
        return {'room_id':ROOM['scene']['roomId'],'scene_revision':self.state.revision,
                'object_id':'chair-1','expected_asset_id':'chair','manipulation':'locked',**changes}

    def ack(self,request_id,policy,object_id='chair-1',ok=True):
        room=deepcopy(ROOM);room['scene']['objects'][0]['manipulation']=policy
        self.state.exchange({'clientId':'web-client','snapshot':room,
            'results':[{'requestId':request_id,'objectId':object_id,'ok':ok,'error':'' if ok else 'Rejected'}]})

    def test_matching_receipt_and_observed_policy_required(self):
        r=self.state.agent_set_manipulation(self.request());self.assertEqual(r['status'],'queued')
        c=self.state.pending[r['requestId']];self.assertEqual(c['expectedManipulation'],'grabbable')
        self.assertEqual(c['expectedTransform'],ROOM['scene']['objects'][0]['transform'])
        self.ack(r['requestId'],'grabbable');self.assertEqual(self.state.agent_manipulation_status(r['requestId'])['status'],'unconfirmed')
        r=self.state.agent_set_manipulation(self.request());self.ack(r['requestId'],'locked')
        self.assertEqual(self.state.agent_manipulation_status(r['requestId'])['status'],'succeeded')
        self.assertEqual(scene_summary(self.state)['objects'][0]['manipulation'],'locked')
        self.assertEqual(scene(self.state.latest['scene'])['objects'][0]['manipulation'],'locked')
        r=self.state.agent_set_manipulation(self.request(manipulation='grabbable'))
        self.ack(r['requestId'],'grabbable',object_id='wrong')
        self.assertEqual(self.state.agent_manipulation_status(r['requestId'])['status'],'unconfirmed')

    def test_scene_identity_revision_play_and_invalid_policy_reject(self):
        for changes in ({'scene_revision':0},{'expected_asset_id':'other'},{'manipulation':'auto'}, {'object_id':'missing'}):
            with self.assertRaises(APIError):self.state.agent_set_manipulation(self.request(**changes))
        room=deepcopy(ROOM);room['creatorMode'].update(mode='play',simulation='running',revision=1)
        self.state.exchange({'clientId':'web-client','snapshot':room,'results':[]})
        with self.assertRaises(APIError):self.state.agent_set_manipulation(self.request())
        invalid=deepcopy(ROOM['scene']);invalid['objects'][0]['manipulation']=[]
        with self.assertRaises(APIError):scene(invalid)

    def test_private_bridge_urls_and_exact_approval(self):
        with patch('matrix_tool_bridge._request_json',return_value={}) as send:
            manipulation_action('http://127.0.0.1:9999/scene','token',self.request())
            self.assertEqual(send.call_args.args[0],'http://127.0.0.1:9999/manipulation')
            manipulation_status('http://127.0.0.1:9999/scene','token','a'*32)
            self.assertEqual(send.call_args.args[0],'http://127.0.0.1:9999/manipulations/'+'a'*32)
        with self.assertRaises(ValueError):manipulation_status('http://127.0.0.1:9999/scene','token','../scene')
        self.assertIn('locked',_new_matrix_approval_summary('matrix_set_manipulation',self.request()))
        self.assertIsNone(_new_matrix_approval_summary('matrix_set_manipulation',self.request(manipulation='unknown')))

    def test_private_http_route_authentication_and_confirmed_receipt(self):
        bridge=MatrixToolBridge(self.state);self.addCleanup(bridge.close)
        with self.assertRaises(urllib.error.HTTPError) as denied:
            manipulation_action(bridge.url,'wrong-token',self.request())
        self.assertEqual(denied.exception.code,404)
        self.assertFalse(self.state.pending)
        with patch('matrix_tool_bridge.MOVE_WAIT',.01):
            queued=manipulation_action(bridge.url,bridge.token,self.request())
        self.assertEqual(queued['status'],'queued')
        self.ack(queued['requestId'],'locked')
        result=manipulation_status(bridge.url,bridge.token,queued['requestId'])
        self.assertEqual((result['requestId'],result['status']),(queued['requestId'],'succeeded'))
