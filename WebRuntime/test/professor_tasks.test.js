import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProfessorTaskClient} from '../src/professor_tasks.js';
test('task submission verifies the same saved identity and does not block another conversation',async()=>{
  const task={id:'t',title:'Counters',instruction:'Make counters',objectiveId:'steps'};let release;
  const client=new ProfessorTaskClient({ensureSession:async()=> 'agent',request:async(path)=>{
    if(path==='/api/professor/task')return {taskId:'t',schoolSessionId:'lesson',status:'queued'};
    return new Promise(resolve=>release=()=>resolve({id:'lesson',operatorTasks:[{...task,status:'running'}]}));
  }});
  let finished=false;const submitted=client.submit(task,{sessionId:'lesson'}).then(()=>finished=true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);assert.equal(client.records.get('t').status,'queued');
  // Neither the teaching controller nor its pending flag is owned by this request.
  assert.equal(client.submitting.has('t'),true);release();await submitted;assert.equal(client.records.get('t').status,'running');
});
test('stale conversation cannot submit a new task',async()=>{
  let calls=0;const client=new ProfessorTaskClient({isCurrent:()=>false,request:async()=>{calls++;},ensureSession:async()=> 'agent'});
  await client.submit({id:'t'},{sessionId:'old'});assert.equal(calls,0);
});
