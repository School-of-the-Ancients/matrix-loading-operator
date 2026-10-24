import test from 'node:test';
import assert from 'node:assert/strict';
import {readVoiceChoices,saveVoiceChoice} from '../src/professor_voice_profiles.js';
import {ProfessorConversation} from '../src/professor_conversation.js';
import {ProfessorVoice} from '../src/professor_voice.js';

test('teacher overrides survive reload and automatic removes only that teacher override',()=>{
  const storage={value:'bad json',getItem(){return this.value;},setItem(key,value){this.value=value;}};
  let choices=readVoiceChoices(storage);assert.deepEqual(choices,{});
  choices=saveVoiceChoice(storage,choices,'davinci','george');
  choices=saveVoiceChoice(storage,choices,'ada_lovelace','emma');
  assert.deepEqual(readVoiceChoices(storage),choices);
  assert.deepEqual(saveVoiceChoice(storage,choices,'davinci',''),{ada_lovelace:'emma'});
});

test('a speech request keeps its captured teacher and override across lesson switches',async()=>{
  const controller=new ProfessorConversation({request:async path=>({id:path.split('/').at(-1),mentor:{id:path.endsWith('/a')?'davinci':'ada_lovelace',name:'Teacher'}}),voiceId:id=>id==='davinci'?'george':'emma'});
  await controller.activate('a');const captured=controller.capture();
  await controller.activate('b');assert.equal(captured.teacherId,'davinci');assert.equal(captured.voiceId,'george');
  const loads=[];let resolve;
  const voice=new ProfessorVoice({load:(text,capture)=>{loads.push(capture);return new Promise(r=>resolve=r);}});
  voice.context={state:'running',resume:async()=>{},decodeAudioData:async()=>{throw Error('Should stop first');}};
  const pending=voice.play({text:'A sentence.'},captured);
  await Promise.resolve();await Promise.resolve();voice.stop();resolve(new ArrayBuffer(8));await pending;
  assert.equal(loads[0],captured);
});
