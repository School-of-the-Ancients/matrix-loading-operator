import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverAgentVoiceTranscript,prepareAgentVoiceRecording} from '../src/agent_voice_delivery.js';
import {verifyAgentContextAtDelivery} from '../src/agent_context.js';
import {AgentClient} from '../src/agent_client.js';
import {MatrixView,operatorPanel} from '../src/view.js';

test('speaking from chat, world, archives, proposal and mode pages opens the same Codex conversation',()=>{
  const previous=globalThis.document;
  const context={fillRect(){},strokeRect(){},fillText(){},measureText(){return {width:0};}};
  globalThis.document={createElement:()=>({getContext:()=>context})};
  try{
    for(const enter of [()=>{},p=>p.toggleWorld(),p=>p.toggleArchives(),
      p=>p.setProposal({summary:'Move cube',commands:[]}),p=>p.toggleModePage(),
      p=>{p.toggleAgent();p.toggleConcepts();},p=>{p.toggleAgent();p.togglePanoramas();}]){
      const panel=operatorPanel();enter(panel);
      const view=Object.create(MatrixView.prototype);view.operatorPanel=panel;
      view.renderer={xr:{isPresenting:false}};
      let permissionChecks=0;
      const agentClient={status:{activeTurnId:null},assertPermissionsApplied(){permissionChecks++;}};
      assert.equal(prepareAgentVoiceRecording({agentClient,
        showConversation:()=>view.showOperatorAgentMode()}),null);
      assert.equal(panel.isAgentMode(),true,'speech opens Codex before recording');
      assert.equal(panel.hit({x:190/1024,y:1-212/768}),'creation-mode-auto',
        'speech opens the actual Codex conversation, including from image galleries');
      assert.equal(permissionChecks,1,'each page uses the same applied-permission gate');
    }
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('speech from another page pins the active Codex turn and cannot start an independent planner edit',async()=>{
  const calls=[],input={value:''};
  const agentClient={status:{activeTurnId:'turn-at-recording'},
    assertPermissionsApplied(){throw Error('active-turn steering must remain allowed');},
    async steer(text,context,turnId){calls.push([text,turnId]);}};
  const capturedTurnId=prepareAgentVoiceRecording({agentClient,showConversation:()=>calls.push('open-codex')});
  agentClient.status.activeTurnId='different-turn';
  assert.equal(await deliverAgentVoiceTranscript({agentClient,input,capturedTurnId,
    transcript:'Move it here',deliverWhenIdle:()=>{throw Error('must not create another turn');}}),'steered');
  assert.deepEqual(calls,['open-codex',['Move it here','turn-at-recording']]);
});

test('disconnected, starting and unapplied-permission states stop speech before microphone recording',()=>{
  assert.throws(()=>prepareAgentVoiceRecording({agentClient:null,showConversation(){}}),/Connect to Codex/);
  assert.throws(()=>prepareAgentVoiceRecording({agentClient:{conversationStarting:true},
    showConversation(){throw Error('must not open a replacement chat');}}),/finish starting/);
  assert.throws(()=>prepareAgentVoiceRecording({agentClient:{status:{activeTurnId:null},
    assertPermissionsApplied(){throw Error('Not applied: Full access');}},showConversation(){}}),/Not applied/);
});

test('an unapplied permission choice retains transcribed speech without starting a new turn',async()=>{
  const sessionId='a'.repeat(32),calls=[];
  const current={sessionId,transcript:[],cursor:0,activeTurnId:null,
    accessMode:'workspace-write',approvalMode:'reviewed'};
  const agentClient=new AgentClient(async(path)=>{calls.push(path);return current;},
    {getItem:()=>sessionId,setItem(){}});
  agentClient.status=current;agentClient.permissionDraft='full-access';
  const input={value:'Keep the landing legs'};
  let deliveries=0;
  await assert.rejects(deliverAgentVoiceTranscript({agentClient,input,transcript:'Create a rocket',
    deliverWhenIdle:async()=>{deliveries++;return 'sent';}}),/Not applied: Full access/);
  assert.equal(deliveries,0);
  assert.deepEqual(calls,['/api/agent/status']);
  assert.equal(input.value,'Keep the landing legs\nCreate a rocket');
});

test('active voice steering is allowed while a different permission choice is unapplied',async()=>{
  const calls=[],input={value:''};
  const agentClient={
    async restore(){return {activeTurnId:'current-turn'};},
    assertPermissionsApplied(){throw Error('Must not block steering');},
    async steer(text,context,turnId){calls.push([text,turnId]);}
  };
  assert.equal(await deliverAgentVoiceTranscript({agentClient,input,transcript:'Make it blue',
    deliverWhenIdle:async()=>{throw Error('Must not start another turn');}}),'steered');
  assert.deepEqual(calls,[['Make it blue','current-turn']]);
  assert.equal(input.value,'');
});

test('voice steer retains transcript when a pinned point moves during transcription',async()=>{
  const pin=x=>({anchorId:'table-1',position:{x,y:0,z:.1},source:'raycast'});
  const captured={roomId:'room-1',presentation:'ar',trackingEpoch:7,
    selectedObjectId:'chair-1',selectedPlacement:pin(.2)};
  const current={...captured,selectedPlacement:pin(.7)};
  const input={value:''};let steers=0;
  await assert.rejects(deliverAgentVoiceTranscript({
    agentClient:{async restore(){return {activeTurnId:'turn-1'};},
      async steer(){steers++;}},input,transcript:'Put it there',context:captured,
    resolveContext:()=>verifyAgentContextAtDelivery(captured,current),
    deliverWhenIdle:async()=>{throw Error('must not start a new turn');}}),
  /Selected point or object changed/);
  assert.equal(steers,0);
  assert.equal(input.value,'Put it there');
});

test('voice recorded while idle joins a text turn that starts during transcription',async()=>{
  const input={value:''},calls=[];
  const agentClient={
    async restore(){calls.push('refresh');return {activeTurnId:'text-turn'};},
    async steer(text,context,turnId){calls.push([text,context,turnId]);}
  };
  const kind=await deliverAgentVoiceTranscript({agentClient,input,
    transcript:'Add a blue lamp',context:{schemaVersion:3},
    deliverWhenIdle:async()=>{throw Error('must not start another turn');}});
  assert.equal(kind,'steered');
  assert.deepEqual(calls,['refresh',['Add a blue lamp',{schemaVersion:3},'text-turn']]);
  assert.equal(input.value,'');
});

test('failed or stale voice steer retains speech with an existing unsent draft',async()=>{
  const input={value:'Make it taller'};
  const agentClient={
    async restore(){throw Error('must use the turn captured at recording');},
    async steer(text,context,turnId){assert.equal(turnId,'old-turn');throw Error('Turn changed');}
  };
  await assert.rejects(deliverAgentVoiceTranscript({agentClient,input,
    transcript:'Add a blue lamp',capturedTurnId:'old-turn',
    deliverWhenIdle:async()=>{throw Error('must not start another turn');}}),/Turn changed/);
  assert.equal(input.value,'Make it taller\nAdd a blue lamp');
});

test('failed new voice turn retains the recognized words for manual retry',async()=>{
  const input={value:''};
  await assert.rejects(deliverAgentVoiceTranscript({
    agentClient:{async restore(){return {activeTurnId:null};}},input,
    transcript:'Build a lamp',deliverWhenIdle:async()=>{throw Error('Turn already active');}
  }),/Turn already active/);
  assert.equal(input.value,'Build a lamp');
});
