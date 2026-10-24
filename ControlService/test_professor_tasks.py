import copy
import tempfile
import threading
import unittest
from pathlib import Path
from professor_tasks import ProfessorTasks
from content_catalog import ContentError

class FakeState:
    def __init__(self):
        self.lock=threading.RLock();self.agent_turn_submission_lock=threading.Lock()
        self.latest={'scene':{'roomId':'world'}};self.host_world_id='world-1';self.runtime_generation=1;self.client_id='browser'
        self.status={'activeTurnId':None,'transcript':[]}
    def online(self):return True
    def agent_portal_status(self,_):return copy.deepcopy(self.status)

class ProfessorTasksTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.state=FakeState();self.calls=[]
        self.manager=ProfessorTasks(Path(self.tmp.name)/'tasks.json',self.state,self.start)
        self.manager._start=lambda:None
        self.value={'taskId':'00000000-0000-4000-8000-000000000001','schoolSessionId':'00000000-0000-4000-8000-000000000002','sessionId':'a'*32,'title':'Two cubes','instruction':'Create two cubes','objectiveId':'volume'}
    def start(self,value):
        self.calls.append(value);self.state.status={'activeTurnId':'turn-1','transcript':[{'turnId':'turn-1','status':'working','assistant':''}]}
        return {'turnId':'turn-1'}
    def test_submit_returns_handle_retries_reuse_and_work_is_asynchronous(self):
        receipt=self.manager.submit(self.value);self.assertEqual(receipt['status'],'queued');self.assertFalse(self.calls)
        self.manager.submit(self.value);self.manager._step(self.manager.tasks[self.value['taskId']]);self.assertEqual(len(self.calls),1)
        self.state.status={'activeTurnId':None,'transcript':[{'turnId':'turn-1','status':'completed','assistant':'Two cubes created; see receipts.'}]}
        self.manager._step(self.manager.tasks[self.value['taskId']]);self.assertEqual(self.manager.submit(self.value)['status'],'completed');self.assertEqual(len(self.calls),1)
    def test_busy_operator_waits_and_changed_world_rejects_before_execution(self):
        self.manager.submit(self.value);task=self.manager.tasks[self.value['taskId']]
        self.state.status['activeTurnId']='another';self.manager._step(task);self.assertEqual(task['status'],'queued')
        self.state.status['activeTurnId']=None;self.state.runtime_generation=2;self.manager._step(task)
        self.assertEqual(task['status'],'failed');self.assertFalse(self.calls)
    def test_restart_never_replays_an_uncertain_submission(self):
        self.manager.submit(self.value);self.manager._step(self.manager.tasks[self.value['taskId']])
        restored=ProfessorTasks(self.manager.path,self.state,self.start)
        self.assertEqual(restored.get(self.value['schoolSessionId'],self.value['taskId'])['status'],'unconfirmed')
        self.assertEqual(len(self.calls),1)
    def test_wrong_lesson_and_changed_id_arguments_rejected(self):
        self.manager.submit(self.value)
        with self.assertRaises(ContentError):self.manager.submit({**self.value,'instruction':'Different'})
        with self.assertRaises(ContentError):self.manager.get('wrong',self.value['taskId'])
        self.manager.cancel(self.value['schoolSessionId'],self.value['taskId']);self.manager._step(self.manager.tasks[self.value['taskId']]);self.assertFalse(self.calls)
