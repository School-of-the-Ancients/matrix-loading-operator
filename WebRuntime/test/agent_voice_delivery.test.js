import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverAgentVoiceTranscript} from '../src/agent_voice_delivery.js';

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
