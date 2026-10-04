import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentClient,AGENT_SESSION_KEY,agentActivityLabel,agentAccessLabel,agentPermissionMode,
  agentPermissionDraftMessage} from '../src/agent_client.js';
import {deliverAgentTextDraft} from '../src/agent_text_delivery.js';

const id='a'.repeat(32);
function storage(initial={}){
  const values=new Map(Object.entries(initial)),writes=[];
  return {values,writes,getItem:key=>values.get(key)||null,
    setItem:(key,value)=>{writes.push([key,value]);values.set(key,value);}};
}
function status(extra={}){return {sessionId:id,activity:'working',activeTurnId:'turn-1',
  transcript:[{user:'Hello',assistant:'Hi',status:'working',turnId:'turn-1',assistantTruncated:false}],
  pendingApprovals:[],cursor:3,events:[],...extra};}

test('full access label requires both unrestricted access and automatic approvals',()=>{
  assert.equal(agentAccessLabel({accessMode:'danger-full-access',approvalMode:'automatic'}),
    'Full access · automatic approvals');
  assert.equal(agentAccessLabel({accessMode:'danger-full-access',approvalMode:'reviewed'}),
    'Reviewed · full PC access');
  assert.equal(agentAccessLabel({accessMode:'workspace-write',approvalMode:'reviewed'}),
    'Reviewed · workspace access');
  assert.equal(agentAccessLabel({accessMode:'read-only',approvalMode:'reviewed'}),
    'Limited · read-only access');
});

test('missing or unsupported permission combinations never claim full access',()=>{
  for(const value of [undefined,null,{},
    {accessMode:'danger-full-access'},
    {approvalMode:'automatic'},
    {accessMode:'danger-full-access',approvalMode:'future-mode'},
    {accessMode:'workspace-write',approvalMode:'automatic'},
    {accessMode:'read-only',approvalMode:'automatic'},
    {accessMode:'future-mode',approvalMode:'reviewed'}
  ])assert.equal(agentAccessLabel(value),'Permissions unknown');
});

test('permission chooser reflects the confirmed policy while labels retain sandbox differences',()=>{
  assert.equal(agentPermissionMode({accessMode:'danger-full-access',approvalMode:'automatic'}),'full-access');
  assert.equal(agentPermissionMode({accessMode:'workspace-write',approvalMode:'reviewed'}),'reviewed');
  assert.equal(agentPermissionMode({accessMode:'read-only',approvalMode:'reviewed'}),'reviewed');
  assert.equal(agentPermissionMode({accessMode:'danger-full-access',approvalMode:'reviewed'}),'reviewed');
  for(const value of [null,{},
    {accessMode:'workspace-write',approvalMode:'automatic'}
  ])assert.equal(agentPermissionMode(value),null);
});

test('a differing permission selection remains explicitly unapplied until confirmed by the service',()=>{
  const reviewed={accessMode:'workspace-write',approvalMode:'reviewed'};
  assert.equal(agentPermissionDraftMessage(reviewed,null),'');
  assert.equal(agentPermissionDraftMessage(reviewed,'reviewed'),'');
  assert.match(agentPermissionDraftMessage(reviewed,'full-access'),/^Not applied: Full access/);
  assert.match(agentPermissionDraftMessage(reviewed,'full-access'),/Enable Full access/);
  assert.equal(agentAccessLabel(reviewed),'Reviewed · workspace access');
  const full={accessMode:'danger-full-access',approvalMode:'automatic'};
  assert.equal(agentPermissionDraftMessage(full,'full-access'),'');
  assert.match(agentPermissionDraftMessage(full,'reviewed'),/^Not applied: Reviewed/);
});

test('an unapplied permission selection blocks new text, context, capture and concept-build turns without losing the draft',async()=>{
  const calls=[],client=new AgentClient(async(path,body)=>{
    calls.push([path,body]);return status({activeTurnId:null,turnId:'turn-1'});
  },storage({[AGENT_SESSION_KEY]:id}));
  client.status=status({activeTurnId:null,accessMode:'workspace-write',approvalMode:'reviewed'});
  client.permissionDraft='full-access';
  const context={schemaVersion:1,roomId:'web-room'};
  const input={value:'Create a rocket'};
  for(const args of [[],[context],[context,null,'auto','b'.repeat(32)],
    [context,{conceptId:id,version:1},'blender']]){
    await assert.rejects(deliverAgentTextDraft(input,input.value,text=>client.send(text,...args)),/Not applied: Full access/);
    assert.equal(input.value,'Create a rocket');
  }
  assert.deepEqual(calls,[]);
  client.permissionDraft=null;
  await client.send(input.value,context);
  assert.equal(calls[0][0],'/api/agent/turn');
});

test('unapplied permissions do not block steering or stopping the active turn',async()=>{
  const calls=[],current=status({accessMode:'workspace-write',approvalMode:'reviewed'});
  const client=new AgentClient(async(path,body)=>{
    calls.push([path,body]);
    return path==='/api/agent/steer'?{turnId:'turn-1'}:current;
  },storage({[AGENT_SESSION_KEY]:id}));
  client.status=current;client.permissionDraft='full-access';
  await client.steer('Keep the existing rocket');
  await client.cancel();
  assert.ok(calls.some(([path])=>path==='/api/agent/steer'));
  assert.ok(calls.some(([path])=>path==='/api/agent/cancel'));
  assert.ok(calls.every(([path])=>path!=='/api/agent/turn'));
  assert.match(client.pendingPermissionChange(),/^Not applied/);
});

test('idle browser permission choices send explicit consent and use confirmed service status',async()=>{
  const calls=[],store=storage({[AGENT_SESSION_KEY]:id});
  let current=status({activeTurnId:null,accessMode:'workspace-write',approvalMode:'reviewed',
    permissionsChangeAllowed:true});
  const client=new AgentClient(async(path,body)=>{
    calls.push([path,body]);
    if(path==='/api/agent/permissions')current={...current,
      accessMode:body.mode==='full-access'?'danger-full-access':'workspace-write',
      approvalMode:body.mode==='full-access'?'automatic':'reviewed'};
    return current;
  },store);
  await client.restore();
  await client.setPermissions('full-access',true);
  assert.equal(agentAccessLabel(client.status),'Full access · automatic approvals');
  await client.setPermissions('reviewed');
  assert.equal(agentPermissionMode(client.status),'reviewed');
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/permissions'),[
    ['/api/agent/permissions',{sessionId:id,mode:'full-access',confirmed:true}],
    ['/api/agent/permissions',{sessionId:id,mode:'reviewed',confirmed:false}]
  ]);
  assert.deepEqual(store.writes,[],'permission choices are confirmed by the service, not stored as browser authority');
});

test('full access needs explicit consent and permission changes require a connected idle supported session',async()=>{
  const calls=[],client=new AgentClient(async(path,body)=>{calls.push([path,body]);},
    storage({[AGENT_SESSION_KEY]:id}));
  await assert.rejects(client.setPermissions('full-access',true),/Connect to Codex/);
  client.status=status({activeTurnId:null,permissionsChangeAllowed:true});
  for(const consent of [undefined,false,'true',1,null])
    await assert.rejects(client.setPermissions('full-access',consent),/Confirm access/);
  await assert.rejects(client.setPermissions('unsupported',true),/Choose Reviewed or Full access/);
  client.status={...client.status,activeTurnId:'active-turn'};
  await assert.rejects(client.setPermissions('reviewed'),/current turn/);
  client.status={...client.status,activeTurnId:null,permissionsChangeAllowed:false};
  await assert.rejects(client.setPermissions('full-access',true),/unavailable/);
  delete client.status.permissionsChangeAllowed;
  await assert.rejects(client.setPermissions('reviewed'),/unavailable/);
  assert.deepEqual(calls,[]);
});

test('a rejected permission change does not optimistically display full access',async()=>{
  const current=status({activeTurnId:null,accessMode:'workspace-write',approvalMode:'reviewed',
    permissionsChangeAllowed:true});
  const client=new AgentClient(async path=>{
    if(path==='/api/agent/permissions')throw Error('Agent became busy');
    return current;
  },storage({[AGENT_SESSION_KEY]:id}));
  await client.restore();
  await assert.rejects(client.setPermissions('full-access',true),/Agent became busy/);
  assert.equal(agentPermissionMode(client.status),'reviewed');
  assert.equal(client.error,'Agent became busy');
});

test('polling a change from another browser refreshes the active permission label',async()=>{
  let current=status({activeTurnId:null,accessMode:'workspace-write',approvalMode:'reviewed',
    permissionsChangeAllowed:true});
  const client=new AgentClient(async()=>current,storage({[AGENT_SESSION_KEY]:id}));
  await client.restore();
  assert.equal(agentPermissionMode(client.status),'reviewed');
  current={...current,accessMode:'danger-full-access',approvalMode:'automatic'};
  await client.poll();
  assert.equal(agentAccessLabel(client.status),'Full access · automatic approvals');
});

test('an earlier status poll cannot overwrite a confirmed permission change',async()=>{
  const reviewed=status({activeTurnId:null,accessMode:'workspace-write',approvalMode:'reviewed',
    permissionsChangeAllowed:true});
  const full={...reviewed,accessMode:'danger-full-access',approvalMode:'automatic'};
  let resolvePoll;
  const client=new AgentClient(async path=>{
    if(path==='/api/agent/status')return new Promise(resolve=>{resolvePoll=resolve;});
    return full;
  },storage({[AGENT_SESSION_KEY]:id}));
  client.status=reviewed;
  const poll=client.poll();
  await client.setPermissions('full-access',true);
  resolvePoll(reviewed);
  await poll;
  assert.equal(agentPermissionMode(client.status),'full-access');
  assert.equal(client.error,'');
});

test('a stale poll cannot clear the error for a permission change with unknown outcome',async()=>{
  const reviewed=status({activeTurnId:null,accessMode:'workspace-write',approvalMode:'reviewed',
    permissionsChangeAllowed:true});
  let resolvePoll;
  const client=new AgentClient(async path=>{
    if(path==='/api/agent/status')return new Promise(resolve=>{resolvePoll=resolve;});
    throw Error('Permission response lost');
  },storage({[AGENT_SESSION_KEY]:id}));
  client.status=reviewed;
  const poll=client.poll();
  await assert.rejects(client.setPermissions('full-access',true),/response lost/);
  resolvePoll(reviewed);
  await poll;
  assert.equal(client.error,'Permission response lost');
});

test('agent session persists only an opaque Matrix ID and sends follow-ups to it',async()=>{
  const store=storage(),calls=[];
  const request=async(path,body)=>{
    calls.push([path,body]);
    if(path==='/api/agent/session')return status();
    if(path==='/api/agent/status')return status();
    if(path==='/api/agent/turn')return {sessionId:id,turnId:'turn-1',activity:'working'};
    if(path==='/api/agent/steer')return {sessionId:id,turnId:'turn-1',activity:'working'};
    if(path==='/api/agent/transcribe')return {transcript:'Put this there'};
    if(path==='/api/agent/approval')return status();
    if(path==='/api/agent/cancel')return status();
    throw Error('unexpected path');
  };
  const client=new AgentClient(request,store);
  await client.connect();
  assert.deepEqual(store.writes,[[AGENT_SESSION_KEY,id]]);
  await client.send('Make this taller');
  await client.send('Put this there',{schemaVersion:1,roomId:'room-1'});
  await client.send('Build the selected design',{schemaVersion:1,roomId:'room-1'},
    {conceptId:id,version:2});
  await client.send('Build the selected design in Blender',null,
    {conceptId:id,version:2},'blender');
  await client.steer('And add some lighting',{schemaVersion:1,roomId:'room-1'});
  assert.equal(await client.transcribe('wav-data'),'Put this there');
  await client.decide(42,'turn-1',false);
  await client.cancel();
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/turn')[0][1],
    {sessionId:id,text:'Make this taller'});
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/turn')[1][1],
    {sessionId:id,text:'Put this there',context:{schemaVersion:1,roomId:'room-1'}});
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/turn')[2][1],
    {sessionId:id,text:'Build the selected design',context:{schemaVersion:1,roomId:'room-1'},
      expectedConceptId:id,expectedConceptVersion:2,creationMode:'auto'});
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/turn')[3][1],
    {sessionId:id,text:'Build the selected design in Blender',
      expectedConceptId:id,expectedConceptVersion:2,creationMode:'blender'});
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/approval')[0][1],
    {sessionId:id,approvalId:42,turnId:'turn-1',approve:false});
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/transcribe')[0][1],
    {sessionId:id,audioBase64:'wav-data'});
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/steer')[0][1],
    {sessionId:id,turnId:'turn-1',text:'And add some lighting',
      context:{schemaVersion:1,roomId:'room-1'}});
  assert.equal(calls.filter(([path])=>path==='/api/agent/cancel')[0][1].turnId,'turn-1');
  assert.equal(client.status.transcript[0].assistant,'Hi');
  assert.equal(agentActivityLabel('using_blender'),'Using Blender');
});

test('steer uses the captured turn ID and never starts a replacement turn on failure',async()=>{
  const calls=[];
  const client=new AgentClient(async(path,body)=>{
    calls.push([path,body]);
    if(path==='/api/agent/steer')throw Error('Turn finished');
    return status();
  },storage({[AGENT_SESSION_KEY]:id}));
  await client.restore();
  await assert.rejects(client.steer('Add another object',null,'turn-1'),/Turn finished/);
  assert.deepEqual(calls.map(([path])=>path),['/api/agent/status','/api/agent/steer']);
  assert.equal(client.error,'Turn finished');
});

test('acknowledged steer stays accepted if the following status read fails',async()=>{
  const calls=[];
  const client=new AgentClient(async(path,body)=>{
    calls.push([path,body]);
    if(path==='/api/agent/steer')return {sessionId:id,turnId:'turn-1',activity:'working'};
    throw Error('Status temporarily unavailable');
  },storage({[AGENT_SESSION_KEY]:id}));
  const result=await client.steer('Add lighting',null,'turn-1');
  assert.equal(result.turnId,'turn-1');
  assert.deepEqual(calls.map(([path])=>path),['/api/agent/steer','/api/agent/status']);
  assert.equal(client.error,'Status temporarily unavailable');
});

test('an admitted turn snapshot updates the browser without another status round trip',async()=>{
  const calls=[];
  const client=new AgentClient(async(path)=>{
    calls.push(path);
    if(path==='/api/agent/turn')return {...status(),turnId:'turn-1'};
    throw Error('Redundant status request');
  },storage({[AGENT_SESSION_KEY]:id}));
  await client.send('Move this left');
  assert.deepEqual(calls,['/api/agent/turn']);
  assert.equal(client.status.activeTurnId,'turn-1');
});

test('older-service admission remains acknowledged after a failed status refresh',async()=>{
  const calls=[];
  const client=new AgentClient(async path=>{
    calls.push(path);
    if(path==='/api/agent/turn')return {sessionId:id,turnId:'turn-1',activity:'working'};
    throw Error('Status temporarily unavailable');
  },storage({[AGENT_SESSION_KEY]:id}));
  assert.equal((await client.send('Make it twice as big')).turnId,'turn-1');
  assert.deepEqual(calls,['/api/agent/turn','/api/agent/status']);
  assert.equal(client.error,'Status temporarily unavailable');
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

test('malformed expected concept identity is rejected before an Agent turn',async()=>{
  const calls=[];
  const client=new AgentClient(async(path,body)=>{
    calls.push([path,body]);return status();
  },storage({[AGENT_SESSION_KEY]:id}));
  await assert.rejects(client.send('Build this in the Matrix',null,
    {conceptId:'wrong',version:2}),/Selected concept identity is invalid/);
  assert.deepEqual(calls,[]);
  await assert.rejects(client.send('Build this in the Matrix',null,
    {conceptId:id,version:2},'native-file'),/Unknown concept creation mode/);
  assert.deepEqual(calls,[]);
});

test('only an explicit reviewed capture ID reaches one Agent turn',async()=>{
  const calls=[],context={schemaVersion:1,roomId:'web-room'};
  const client=new AgentClient(async(path,body)=>{
    calls.push([path,body]);
    if(path==='/api/agent/turn')return {sessionId:id,turnId:'turn-1',activity:'working'};
    return status();
  },storage({[AGENT_SESSION_KEY]:id}));
  const captureId='b'.repeat(32);
  await client.send('Review this view',context,null,'auto',captureId);
  await client.send('Ordinary follow-up',context);
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/turn').map(([,body])=>body),[
    {sessionId:id,text:'Review this view',context,captureId},
    {sessionId:id,text:'Ordinary follow-up',context}
  ]);
  assert.deepEqual(client.storage.writes,[],'capture ID is never stored in browser session storage');
});

test('capture ID needs request-time Matrix context and cannot share a concept turn',async()=>{
  const calls=[];
  const client=new AgentClient(async(path,body)=>{calls.push([path,body]);return status();},
    storage({[AGENT_SESSION_KEY]:id}));
  const captureId='b'.repeat(32),context={schemaVersion:1,roomId:'web-room'};
  for(const args of [
    ['Review',null,null,'auto',captureId],
    ['Review',context,null,'auto','wrong'],
    ['Review',context,null,'auto',123],
    ['Review',context,{conceptId:id,version:1},'auto',captureId]
  ])await assert.rejects(client.send(...args),/reviewed capture needs a Matrix context/);
  assert.deepEqual(calls,[]);
});
