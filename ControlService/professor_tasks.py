"""Durable, asynchronous teacher requests through the existing Matrix Operator."""
import copy
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time
from content_catalog import ContentError

UUID = re.compile(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\Z')
SESSION = re.compile(r'[a-f0-9]{32}\Z')
ACTIVE = ('queued', 'submitting', 'running', 'cancelling')

def require(ok, message, status=400):
    if not ok: raise ContentError(status, message)

def checked(value, instruction_limit=2000):
    require(isinstance(value,dict) and set(value)=={'taskId','schoolSessionId','sessionId','title','instruction','objectiveId'},'Invalid Operator task')
    for key,pattern in (('taskId',UUID),('schoolSessionId',UUID),('sessionId',SESSION)):
        require(isinstance(value[key],str) and pattern.fullmatch(value[key]),'Invalid '+key)
    for key,limit in (('title',120),('instruction',instruction_limit),('objectiveId',40)):
        require(isinstance(value[key],str) and 0<len(value[key].strip())<=limit and not any(ord(c)<32 and c not in '\n\t' for c in value[key]),'Invalid '+key)
    return copy.deepcopy(value)

class ProfessorTasks:
    def __init__(self, path, state, start_turn, poll_seconds=1):
        self.path=Path(path);self.state=state;self.start_turn=start_turn;self.poll_seconds=poll_seconds
        self.lock=threading.RLock();self.stop_event=threading.Event();self.worker=None;self.tasks={}
        if self.path.exists():
            try:
                saved=json.loads(self.path.read_text('utf-8'))
                require(saved.get('version')==1 and isinstance(saved.get('tasks'),dict),'Unreadable Professor task archive',503)
                self.tasks=saved['tasks']
                # A restart never silently replays an uncertain world action.
                for task in self.tasks.values():
                    if task['status'] in ACTIVE:
                        task.update(status='unconfirmed',message='Service restarted. Inspect the original Operator turn before retrying.')
                self._save()
            except (ValueError,KeyError,TypeError,OSError):
                raise ContentError(503,'Professor task archive is unreadable; it was not replaced') from None

    def _save(self):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=self.path.parent,delete=False) as file:
            name=file.name;json.dump({'version':1,'tasks':self.tasks},file);file.flush();os.fsync(file.fileno())
        os.replace(name,self.path)

    def _scope(self):
        with self.state.lock:
            require(self.state.online() and self.state.latest,'Connect the Matrix world before delegating',409)
            return {'roomId':self.state.latest['scene']['roomId'],'hostWorldId':self.state.host_world_id,
                    'runtimeGeneration':self.state.runtime_generation,'clientId':self.state.client_id}

    def submit(self, value, *, asset_only=False):
        value=checked(value, 4000 if asset_only else 2000)
        with self.lock:
            old=self.tasks.get(value['taskId'])
            if old:
                require(all(old[key]==item for key,item in value.items()),'Task identity was reused with different arguments',409)
                return copy.deepcopy(old)
            require(len(self.tasks)<1000 and sum(t['status'] in ACTIVE for t in self.tasks.values())<12,'Professor task queue is full',429)
            self.state.agent_portal_status(value['sessionId'])
            task={**value,'status':'queued','createdAt':time.time(),'updatedAt':time.time(),'scope':None if asset_only else self._scope(),
                  'assetOnly':asset_only,
                  'turnId':None,'result':'','message':'Waiting for Matrix Operator.'}
            self.tasks[value['taskId']]=task;self._save();self._start()
            return copy.deepcopy(task)

    def _start(self):
        if not self.worker or not self.worker.is_alive():
            self.worker=threading.Thread(target=self._run,name='professor-operator-tasks',daemon=True);self.worker.start()

    def get(self, school_session_id, task_id):
        with self.lock:
            task=self.tasks.get(task_id)
            require(task and task['schoolSessionId']==school_session_id,'Professor task not found',404)
            return copy.deepcopy(task)

    def _update(self, task, **fields):
        with self.lock:task.update(**fields,updatedAt=time.time());self._save()

    def _step(self,task):
        try:
            status=self.state.agent_portal_status(task['sessionId'])
            if task['status']=='queued':
                if time.time()-task['createdAt']>1800:
                    self._update(task,status='failed',message='Queued task expired before execution.');return
                if status.get('activeTurnId'):return
                if not task.get('assetOnly') and task['scope']!=self._scope():
                    self._update(task,status='failed',message='The connected world changed before this task started.');return
                if not self.state.agent_turn_submission_lock.acquire(blocking=False):return
                try:
                    with self.lock:
                        if task['status']!='queued':return
                        self._update(task,status='submitting',message='Submitting to Matrix Operator.')
                    request={'sessionId':task['sessionId'],'text':
                        f"[School {'avatar' if task.get('assetOnly') else 'task'}:{task['taskId']}] This task was delegated by the active School professor. Use the existing Matrix tools and permissions. "
                        'Preserve unrelated objects. Report actual results and failed or unconfirmed actions honestly. '
                        'Do not claim an image is a loaded object. The professor continues a separate conversation. '
                        'For exhibit requests, search matrix_search_library and the existing scene/assets first. '
                        'Reuse a suitable existing asset or prefab. If none fits, create in Blender and register the result '
                        'in the user library. Do not recreate an already suitable exhibit.\n'
                        +task['instruction']}
                    accepted=self.start_turn(request)
                    turn_id=accepted.get('turnId') or accepted.get('activeTurnId')
                    require(isinstance(turn_id,str) and turn_id,'Operator acceptance had no turn identity',502)
                    self._update(task,status='running',turnId=turn_id,message='Matrix Operator is working; the professor can continue talking.')
                finally:self.state.agent_turn_submission_lock.release()
            elif task['status'] in ('running','cancelling'):
                turn=next((item for item in status.get('transcript',[]) if item.get('turnId')==task['turnId']),None)
                if turn and turn.get('status') in ('completed','failed','cancelled'):
                    result=str(turn.get('assistant',''))[:20000]
                    self._update(task,status=turn['status'],result=result,
                                 message='Operator turn '+turn['status']+'. Results remain attributed to Operator; scene receipts retain authority.')
                elif turn and turn.get('status')=='unknown':
                    self._update(task,status='unconfirmed',message='Operator could not confirm how this turn ended. Inspect its receipts before retrying.')
                elif not turn and status.get('activeTurnId')!=task['turnId']:
                    self._update(task,status='unconfirmed',message='The original Operator turn could not be confirmed. Inspect it before retrying.')
        except Exception as error:
            self._update(task,status='failed' if task['status']=='queued' else 'unconfirmed',message=str(error)[:500])

    def _run(self):
        while not self.stop_event.is_set():
            with self.lock:
                task=next((t for t in self.tasks.values() if t['status'] in ACTIVE),None)
                if not task:
                    self.worker=None
                    return
            self._step(task)
            self.stop_event.wait(self.poll_seconds)

    def cancel(self,school_session_id,task_id):
        with self.lock:
            task=self.tasks.get(task_id)
            require(task and task['schoolSessionId']==school_session_id,'Professor task not found',404)
            if task['status']=='queued':self._update(task,status='cancelled',message='Cancelled before execution.')
            elif task['status']=='running':
                self.state.agent_portal.cancel(task['sessionId'],task['turnId'])
                self._update(task,status='cancelling',message='Cancellation requested; waiting for Operator confirmation.')
            return copy.deepcopy(task)

    def close(self):
        self.stop_event.set()
        if self.worker and self.worker is not threading.current_thread():self.worker.join(timeout=2)
