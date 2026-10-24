import test from 'node:test';
import assert from 'node:assert/strict';
import {ProfessorConversation} from '../src/professor_conversation.js';
import {speechChunks,ProfessorVoice} from '../src/professor_voice.js';

test('a first spoken question creates a School lesson and speaks its introduction',async()=>{
  let input,spoken;
  const created={id:'new-lesson',revision:1,mentor:{name:'Leonardo'},conversation:{events:[{id:'intro',speaker:'professor',text:'Look closely.'}]}};
  const controller=new ProfessorConversation({request:async(path,body)=>{
    assert.equal(path,'/api/school/sessions');input=body;return created;
  },onReply:async(event,capture)=>{spoken={event,capture};}});
  await controller.ask('How did Leonardo think flight worked?',controller.capture(),'voice');
  assert.equal(input.inputKind,'voice');assert.equal(input.goal,'How did Leonardo think flight worked?');
  assert.equal(controller.session.id,'new-lesson');assert.equal(spoken.capture.sessionId,'new-lesson');
});

test('a first question finishing after the world changed cannot speak in the new world',async()=>{
  let world={},spoken=false;
  const controller=new ProfessorConversation({worldIdentity:()=>world,
    request:async()=>{world={};return {id:'late',mentor:{name:'Leonardo'}};},onReply:async()=>{spoken=true;}});
  await controller.ask('Teach me flight',controller.capture(),'voice');
  assert.equal(controller.session,null);assert.equal(spoken,false);
});

test('captured target never changes mid-transcription and stale lessons cannot receive replies',async()=>{
  const session={id:'a',mentor:{name:'Ada'},revision:1,conversation:{events:[]}};
  const controller=new ProfessorConversation({request:async(path,body)=>structuredClone({...session,id:path.split('/').at(-1)})});
  await controller.activate('a');const captured=controller.capture();controller.select('operator');
  assert.equal(captured.target,'professor');assert.equal(controller.current(captured),true);
  await controller.activate('b');assert.equal(controller.current(captured),false);
});
test('failed teacher delivery leaves the captured transcript durably recorded and draft recoverable',async()=>{
  const session={id:'a',mentor:{name:'Ada'},revision:1,conversation:{events:[]}},records=[];
  const controller=new ProfessorConversation({request:async(path,body)=>{
    if(path.endsWith('/conversation')){records.push(body.event);return session;}
    if(path.endsWith('/spoken-message'))throw Error('Provider offline');return session;}});
  await controller.activate('a');await assert.rejects(controller.ask('Hello',controller.capture(),'voice'),/Provider offline/);
  assert.equal(records[0].text,'Hello');assert.equal(controller.draft,'Hello');assert.equal(controller.pending,false);
});
test('speech chunks stay bounded without dropping words',()=>{
  const text='Hello world. '.repeat(200),chunks=speechChunks(text);
  assert(chunks.every(chunk=>chunk.length<=400));assert.equal(chunks.join(' '),text.trim());
});
test('stopping while speech downloads prevents late playback and resets the mouth',async()=>{
  let release,decoded=0;const states=[],mouth=[];
  const voice=new ProfessorVoice({load:()=>new Promise(resolve=>release=resolve),onState:(_,state)=>states.push(state),onMouth:level=>mouth.push(level)});
  voice.context={state:'running',resume:async()=>{},decodeAudioData:async()=>{decoded++;return {};}};
  const pending=voice.play({id:'reply',text:'Hello'},{sessionId:'a'});
  await Promise.resolve();await Promise.resolve();voice.stop();release(new ArrayBuffer(8));await pending;
  assert.equal(decoded,0);assert.deepEqual(states,['interrupted']);assert.equal(mouth.at(-1),0);
});
test('teacher text is saved and input is released while voice continues',async()=>{
  const session={id:'a',mentor:{name:'Ada'},revision:1,conversation:{events:[]}};let release;
  const controller=new ProfessorConversation({request:async(path,body)=>{
    if(path.endsWith('/conversation'))session.conversation.events.push(body.event);
    if(path.endsWith('/spoken-message'))session.conversation.events.push({id:'reply:'+body.eventId,speaker:'professor',text:'Hello'});
    return session;
  },onReply:()=>new Promise(resolve=>release=resolve)});
  await controller.activate('a');await controller.ask('Hello');
  assert.equal(controller.pending,false);assert.equal(controller.draft,'');release();
});
test('new completed Operator turns are journaled once and kept with their original lesson',async()=>{
  const records=[],session={id:'a',mentor:{name:'Ada'},revision:1,conversation:{events:[]}};
  const controller=new ProfessorConversation({request:async(path,body)=>{if(body?.event)records.push([path,body.event]);return session;}});
  await controller.activate('a');controller.observeOperator({sessionId:'op',transcript:[]});
  const status={sessionId:'op',transcript:[{turnId:'t1',user:'Move it',assistant:'Moved',status:'completed'}]};
  controller.observeOperator(status);controller.observeOperator(status);await controller.queued;
  assert.equal(records.length,2);assert(records.every(([path])=>path.includes('/a/')));
});

test('delegated Operator turns are not imported as learner commands or duplicate replies',async()=>{
  const records=[],session={id:'a',mentor:{name:'Ada'},revision:1,conversation:{events:[]}};
  const controller=new ProfessorConversation({
    request:async(path,body)=>{if(body?.event)records.push(body.event);return session;},
    isDelegatedTurn:turn=>turn.user.startsWith('[School task:')
  });
  await controller.activate('a');
  controller.observeOperator({sessionId:'op',transcript:[]});
  controller.observeOperator({sessionId:'op',transcript:[{turnId:'t1',user:'[School task:example] Inspect the world',assistant:'One object',status:'completed'}]});
  await controller.queued;
  assert.equal(records.length,0);
});

test('replacing a world under the same room identity invalidates a captured utterance',async()=>{
  let scene={};
  const controller=new ProfessorConversation({request:async()=>({id:'a',mentor:{name:'Ada'}}),worldId:()=>'room',worldIdentity:()=>scene});
  await controller.activate('a');
  const capture=controller.capture();
  scene={};
  assert.equal(controller.current(capture),false);
});
