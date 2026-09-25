import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentClient,AGENT_SESSION_KEY,agentActivityLabel} from '../src/agent_client.js';

const id='a'.repeat(32);
function storage(initial={}){
  const values=new Map(Object.entries(initial)),writes=[];
  return {values,writes,getItem:key=>values.get(key)||null,
    setItem:(key,value)=>{writes.push([key,value]);values.set(key,value);}};
}
function status(extra={}){return {sessionId:id,activity:'working',activeTurnId:'turn-1',
  transcript:[{user:'Hello',assistant:'Hi',status:'working',turnId:'turn-1',assistantTruncated:false}],
  pendingApprovals:[],cursor:3,events:[],...extra};}

test('agent session persists only an opaque Matrix ID and sends follow-ups to it',async()=>{
  const store=storage(),calls=[];
  const request=async(path,body)=>{
    calls.push([path,body]);
    if(path==='/api/agent/session')return status();
    if(path==='/api/agent/status')return status();
    if(path==='/api/agent/turn')return {sessionId:id,turnId:'turn-1',activity:'working'};
    if(path==='/api/agent/approval')return status();
    if(path==='/api/agent/cancel')return status();
    throw Error('unexpected path');
  };
  const client=new AgentClient(request,store);
  await client.connect();
  assert.deepEqual(store.writes,[[AGENT_SESSION_KEY,id]]);
  await client.send('Make this taller');
  await client.decide(42,'turn-1',false);
  await client.cancel();
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/turn')[0][1],
    {sessionId:id,text:'Make this taller'});
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/approval')[0][1],
    {sessionId:id,approvalId:42,turnId:'turn-1',approve:false});
  assert.equal(calls.filter(([path])=>path==='/api/agent/cancel')[0][1].turnId,'turn-1');
  assert.equal(client.status.transcript[0].assistant,'Hi');
  assert.equal(agentActivityLabel('using_blender'),'Using Blender');
});

test('failed resume never starts an unrelated conversation or clears its ID',async()=>{
  const store=storage({[AGENT_SESSION_KEY]:id}),calls=[];
  const client=new AgentClient(async path=>{calls.push(path);throw Error('Codex unavailable');},store);
  await assert.rejects(client.connect(),/Codex unavailable/);
  assert.deepEqual(calls,['/api/agent/status']);
  assert.equal(store.getItem(AGENT_SESSION_KEY),id);
  assert.deepEqual(store.writes,[]);
  assert.equal(client.error,'Codex unavailable');
});

test('invalid stored ID is ignored and malformed server ID is rejected',async()=>{
  const store=storage({[AGENT_SESSION_KEY]:'native-thread-id'});
  const client=new AgentClient(async()=>({sessionId:'native-thread-id',transcript:[],cursor:0}),store);
  assert.equal(client.sessionId,null);
  await assert.rejects(client.connect(),/Invalid Agent Portal session/);
  assert.deepEqual(store.writes,[]);
});
