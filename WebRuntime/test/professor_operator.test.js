import test from 'node:test';
import assert from 'node:assert/strict';
import {ProfessorOperator,validProfessorRequest} from '../src/professor_operator.js';
const payload={schoolSessionId:'00000000-0000-4000-8000-000000000001',requestId:'00000000-0000-4000-8000-000000000002',
  requestVersion:1,lessonRevision:1,kind:'artifact',prompt:'An illustrative teaching exhibit.',objectiveId:'proof',
  learningIntent:'Explain the proof.',interaction:{requirement:'none',description:'Static.',capabilities:[]}};
const result={...payload,sessionId:'a'.repeat(32),actionId:'b'.repeat(64),status:'generating'};
function fixture(request=async()=>result){
  const messages=[],calls=[],frame=new EventTarget();frame.contentWindow={postMessage:(message,origin)=>messages.push({message,origin})};
  const target=new EventTarget(),bridge=new ProfessorOperator({frame,origin:'http://127.0.0.1:8765',target,
    request:async(path,body)=>{calls.push({path,body});return request(path,body);},ensureSession:async()=>result.sessionId});
  const event=(type,data=payload,patch={})=>({source:frame.contentWindow,origin:'http://127.0.0.1:8765',
    data:{type,channel:bridge.channel,payload:data},...patch});
  return {bridge,messages,calls,event,frame};
}
test('only expected frame, origin, channel and bounded structured requests reach the existing Operator API',async t=>{
  const f=fixture();t.after(()=>f.bridge.dispose());
  for(const patch of [{origin:'https://outside.example'},{source:{}},{data:{type:'school-operator-request',channel:'other',payload}}])
    await f.bridge.receive(f.event('school-operator-request',payload,patch));
  await f.bridge.receive(f.event('school-operator-request',{...payload,code:'run shell'}));
  assert.equal(f.calls.length,0);assert.equal(validProfessorRequest({...payload,prompt:'x'.repeat(3601)}),false);
  await f.bridge.receive(f.event('school-operator-request'));
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/professor/actions');
  assert.equal(f.calls[0].body.sessionId,result.sessionId);
  assert.equal(f.messages.at(-1).message.result.actionId,result.actionId);
});
test('duplicate in-flight events submit once; reload watches only read status',async t=>{
  let release;const pending=new Promise(resolve=>release=resolve),f=fixture(()=>pending);t.after(()=>f.bridge.dispose());
  const first=f.bridge.receive(f.event('school-operator-request'));
  await f.bridge.receive(f.event('school-operator-request'));release(result);await first;
  assert.equal(f.calls.length,1);
  await f.bridge.receive(f.event('school-operator-watch',{schoolSessionId:payload.schoolSessionId,requestId:payload.requestId,
    requestVersion:1,sessionId:result.sessionId,actionId:result.actionId}));
  assert.equal(f.calls.filter(call=>call.body).length,1);assert.match(f.calls.at(-1).path,/\?sessionId=/);
});
test('failed submission stays uncertain and never emits success; late mismatched status is ignored',async t=>{
  const f=fixture(async()=>{throw Error('Image capability unavailable');});t.after(()=>f.bridge.dispose());
  await f.bridge.receive(f.event('school-operator-request'));
  assert.equal(f.messages.at(-1).message.type,'matrix-operator-error');
  assert.equal(f.messages.some(item=>item.message.type==='matrix-operator-result'),false);
});
