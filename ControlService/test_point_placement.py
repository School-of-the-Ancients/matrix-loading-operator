"""Free/precise point placement uses observed frames and one existing action path."""
from copy import deepcopy
import json
import tempfile
import unittest
from unittest.mock import patch

from agent_portal import build_matrix_turn_message, compact_matrix_context
from agent_session import _new_matrix_approval_summary
from matrix_tool_bridge import MatrixToolBridge, move_selected_point
from server import APIError, State, agent_turn_context, snapshot
from test_matrix_move import ROOM

def point(x=0, y=0, z=0):
    return dict(x=x, y=y, z=z)

def pose(x=0, y=0, z=0, yaw=0):
    return dict(position=point(x,y,z), rotation=point(0,yaw,0), scale=point(1,1,1))

def room(fit=False):
    value=deepcopy(ROOM)
    value['scene']['roomId']='webxr-session-point-test'
    value['scene']['objects'][0]['transform']['rotation']=point(20,45,-15)
    value['roomContext'].update(mode='ar',alignmentVerified=False)
    value['runtimeDescriptor']={'schemaVersion':1,'client':'matrix-web','renderer':'threejs-webxr','presentation':'ar'}
    value['pointPlacement']={'schemaVersion':1,'fitToRoom':fit}
    value['spatialObservation']={'schemaVersion':1,'trackingEpoch':7,'planeAgeMs':50,'webFloorPose':pose(1,0,0,90)}
    value['anchors'].append({'anchorId':'webxr-plane-table','displayName':'Table','source':'webxr',
        'semanticLabels':['TABLE'],'roomPose':pose(3,1,2),
        'surface':{'kind':'support','boundary':[point(-.2,0,-.2),point(.2,0,-.2),point(.2,0,.2),point(-.2,0,.2)]}})
    value['selection']={'objectId':'chair-1','anchorId':'webxr-plane-table','position':point(.1,0,.1)}
    return value

class PointPlacementTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state=State(self.temp.name)
        self.current=room()
        self.exchange()

    def exchange(self):
        self.state.exchange({'clientId':'point-client','snapshot':self.current,'results':[]})

    def request(self, **changes):
        return {'room_id':self.current['scene']['roomId'],'scene_revision':self.state.revision,
            'object_id':'chair-1','expected_asset_id':'chair','anchor_id':'webxr-plane-table',
            'selected_position':point(.1,0,.1),'tracking_epoch':7,**changes}

    def context(self, **changes):
        return {'schemaVersion':4,'clientId':'point-client','inputSource':'text','roomId':self.current['scene']['roomId'],
            'selectedObjectId':'chair-1','selectedPlacement':{'anchorId':'webxr-plane-table','position':point(.1,0,.1),'source':'raycast'},
            'pointingTarget':None,'viewerFrame':None,'presentation':'ar','trackingEpoch':7,'fitToRoom':False,**changes}

    def test_free_move_converts_frames_preserves_tilt_size_and_does_not_require_bounds(self):
        with patch('server.overlapping_room_plane',side_effect=AssertionError('No fitting for free AR')):
            result=self.state.agent_move_selected_point(self.request())
        command=self.state.pending[result['requestId']]
        self.assertEqual(result['status'],'queued')
        self.assertEqual(len(self.state.pending),1)
        self.assertEqual(command['transform']['position'],point(-2.1,1,2.1))
        original=self.current['scene']['objects'][0]['transform']
        self.assertEqual(command['transform']['rotation'],original['rotation'])
        self.assertEqual(command['transform']['scale'],original['scale'])
        self.assertNotIn('roomConstraint',command)
        self.assertFalse(command['pointTarget']['fitToRoom'])
        observed=deepcopy(self.current)
        observed['scene']['objects'][0]['transform']=deepcopy(command['transform'])
        self.state.exchange({'clientId':'point-client','snapshot':observed,'results':[
            {'requestId':result['requestId'],'ok':True,'error':'','objectId':'chair-1'}]})
        self.assertEqual(self.state.agent_move_status(result['requestId'])['status'],'succeeded')

    def test_free_context_keeps_room_advice_and_provides_resolved_world_point(self):
        context=agent_turn_context(self.state,self.context())
        compact=compact_matrix_context(context)
        self.assertFalse(compact['fitToRoom'])
        self.assertFalse(compact['roomSpatial']['alignmentVerified'])
        self.assertEqual(compact['worldPlacement'],{'anchorId':'web-floor','position':point(-2.1,1,2.1)})
        message=build_matrix_turn_message('Put this here',context)
        self.assertIn('matrix_move_to_selected_point',message)
        self.assertIn('Room context can inspire',message)
        self.assertIn('Do not search source code',message)

    def test_precise_mode_requires_alignment_and_keeps_existing_constraints(self):
        self.current['pointPlacement']['fitToRoom']=True
        self.exchange()
        with self.assertRaises(APIError):
            self.state.agent_move_selected_point(self.request())
        self.assertFalse(self.state.pending)
        self.current['roomContext']['alignmentVerified']=True
        self.current['assets'][0]['localBounds']={'center':point(0,1,0),'size':point(2,2,2)}
        self.exchange()
        result=self.state.agent_move_selected_point(self.request())
        command=self.state.pending[result['requestId']]
        self.assertEqual(command['roomConstraint'],{'anchorId':'webxr-plane-table','trackingEpoch':7})
        self.assertEqual(command['transform']['rotation'],point(0,45,0))
        self.assertEqual(command['transform']['scale'],self.current['scene']['objects'][0]['transform']['scale'])
        self.assertTrue(command['pointTarget']['fitToRoom'])

    def test_stale_pin_selection_mode_epoch_and_scene_reject_without_queueing(self):
        for change in ({'selected_position':point(.15,0,.1)},{'object_id':'other'},
                       {'tracking_epoch':6},{'tracking_epoch':True},{'scene_revision':-1},
                       {'anchor_id':'gone'},{'expected_asset_id':'other'}):
            with self.subTest(change=change),self.assertRaises(APIError):
                self.state.agent_move_selected_point(self.request(**change))
            self.assertFalse(self.state.pending)
        with self.assertRaises(APIError):
            agent_turn_context(self.state,self.context(fitToRoom=True))
        self.current['spatialObservation']['planeAgeMs']=3000
        self.exchange()
        with self.assertRaises(APIError):
            self.state.agent_move_selected_point(self.request())

    def test_virtual_floor_point_works_without_room_planes(self):
        self.current['anchors']=self.current['anchors'][:1]
        self.current['selection'].update(anchorId='web-floor',position=point(2,0,-3))
        self.current['spatialObservation']['planeAgeMs']=None
        self.exchange()
        result=self.state.agent_move_selected_point(self.request(anchor_id='web-floor',selected_position=point(2,0,-3)))
        self.assertEqual(self.state.pending[result['requestId']]['transform']['position'],point(2,0,-3))

    def test_old_clients_and_invalid_setting_cannot_silently_bypass_point_guard(self):
        for setting in ({'schemaVersion':1,'fitToRoom':1},{'schemaVersion':True,'fitToRoom':False},
                        {'schemaVersion':1,'fitToRoom':False,'extra':0}):
            with self.subTest(setting=setting),self.assertRaises(APIError):
                snapshot({**self.current,'pointPlacement':setting})
        self.current.pop('pointPlacement')
        self.exchange()
        with self.assertRaises(APIError):
            self.state.agent_move_selected_point(self.request())

    def test_reviewed_mode_has_exact_bounded_point_summary(self):
        summary=_new_matrix_approval_summary('matrix_move_to_selected_point',self.request())
        self.assertIn('webxr-plane-table',summary)
        self.assertIn('(0.1,0,0.1)',summary)
        self.assertIsNone(_new_matrix_approval_summary('matrix_move_to_selected_point',self.request(tracking_epoch=True)))

    def test_private_bridge_dispatches_one_selected_point_action(self):
        bridge=MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        with patch('matrix_tool_bridge.MOVE_WAIT',0):
            result=move_selected_point(bridge.url,bridge.token,self.request())
        self.assertEqual(result['status'],'queued')
        self.assertEqual(len(self.state.pending),1)
        self.assertEqual(self.state.pending[result['requestId']]['transform']['position'],point(-2.1,1,2.1))

if __name__=='__main__':
    unittest.main()
