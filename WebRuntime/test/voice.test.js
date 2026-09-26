import test from 'node:test';
import assert from 'node:assert/strict';
import {pcmWav,base64Bytes,VoiceRecorder} from '../src/voice.js';

test('microphone samples become bounded 16 kHz mono PCM16 WAV for the local speech service',()=>{
  const input=Float32Array.from({length:24000},(_,index)=>Math.sin(2*Math.PI*440*index/48000)*.25);
  const wav=pcmWav([input.subarray(0,10000),input.subarray(10000)],48000);
  const view=new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0,4)),'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8,12)),'WAVE');
  assert.equal(view.getUint16(22,true),1);
  assert.equal(view.getUint32(24,true),16000);
  assert.equal(view.getUint16(34,true),16);
  assert.equal(wav.length,44+8000*2);
  assert.equal(Buffer.from(base64Bytes(wav),'base64').compare(Buffer.from(wav)),0);
  assert.throws(()=>pcmWav([input.subarray(0,1000)],48000),/quarter second/);
});

test('a second recording cannot start while the first microphone stream is closing',async()=>{
  let finishClose;
  const recorder=new VoiceRecorder();recorder.active=true;
  recorder.chunks=[new Float32Array(8000).fill(.25)];
  recorder.processor={disconnect(){}};recorder.source={disconnect(){}};recorder.mute={disconnect(){}};
  recorder.stream={getTracks:()=>[{stop(){}}]};
  recorder.context={sampleRate:16000,close:()=>new Promise(resolve=>{finishClose=resolve;})};
  const first=recorder.stop();
  await assert.rejects(recorder.start(),/Already recording/);
  finishClose();
  assert.ok((await first).length>44);
  assert.equal(recorder.stopping,false);
});
