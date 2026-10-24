import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {operatorPanel,MatrixView} from '../src/view.js';
import {transcriptContent} from '../src/xr_transcript.js';
const example={id:'lesson',mentor:{name:'Leonardo'},conversation:{events:[
  {id:'1',speaker:'learner',recipient:'professor',text:'Which part turns?'},
  {id:'2',speaker:'professor',recipient:'learner',text:'Look at the shaft. What drives it?',delivery:'spoken'}]}};

function fixture(t){
  const before=globalThis.document,drawn=[],positions=[];
  const ctx={fillRect(){},strokeRect(){},fillText(text,x,y){drawn.push(String(text));positions.push({text:String(text),x,y});},measureText:text=>({width:text.length*14})};
  globalThis.document={createElement:()=>({getContext:()=>ctx})};t.after(()=>{globalThis.document=before;});
  const panel=operatorPanel();return {panel,drawn,positions,hit:(x,y)=>panel.hit({x:x/1024,y:1-y/768})};
}
test('the floating panel exposes transcript in normal and WORLD views without a DOM overlay',t=>{
  const {panel,drawn,hit}=fixture(t);assert.equal(hit(150,70),'toggle-transcript');
  panel.setXRMode('ar');panel.toggleWorld();assert.equal(hit(150,70),'exit-xr');
  assert.equal(hit(850,132),'toggle-transcript');
  panel.setTranscript(transcriptContent(example));panel.toggleTranscript();
  assert(drawn.includes('Look at the shaft. What drives it?'));assert(drawn.includes('Leonardo · Spoken · Message 2/2'));
  assert.equal(hit(195,570),'transcript-older');assert.equal(hit(800,570),'transcript-latest');
});
test('reviewing an older message survives new replies and latest returns to the professor',t=>{
  const {panel,drawn}=fixture(t);panel.setTranscript(transcriptContent(example));panel.toggleTranscript();
  panel.olderTranscript();drawn.length=0;
  const next=structuredClone(example);next.conversation.events.push({id:'3',speaker:'professor',recipient:'learner',text:'What changes if it is heavier?',delivery:'spoken'});
  panel.setTranscript(transcriptContent(next));assert(drawn.includes('Which part turns?'));assert(!drawn.includes('What changes if it is heavier?'));
  drawn.length=0;panel.latestTranscript();assert(drawn.includes('What changes if it is heavier?'));
});
test('controller transcript clicks are consumed by the panel without grabbing the world',t=>{
  const {panel}=fixture(t);panel.group.visible=true;let selected=false;
  const view={operatorPanel:panel,raycaster:{set(){},intersectObject:()=>[{uv:{x:150/1024,y:1-70/768}}]},selectFromRay(){selected=true;}};
  MatrixView.prototype.selectFromController.call(view,new THREE.Group());assert.equal(selected,false);
});
test('transcript survives transient status replacement and text stays below navigation',t=>{
  const {panel,drawn,positions}=fixture(t);
  panel.setMessage('Body below controls');assert(positions.find(p=>p.text==='Body below controls').y>=205);
  panel.setTranscript(transcriptContent(example));panel.toggleTranscript();drawn.length=0;positions.length=0;
  panel.setMessage('PC service connected');
  panel.setAgentStatus({activity:'Ready',content:'Codex output',pending:false,active:false,voiceStatus:'Finished',latestTurnId:'later'});
  assert(drawn.includes('Look at the shaft. What drives it?'));assert(!drawn.includes('PC service connected'));assert(!drawn.includes('Codex output'));
  assert(positions.filter(p=>p.text==='Look at the shaft. What drives it?').every(p=>p.y>190&&p.y<480));
});
test('learner page keeps professor speech controls while Operator runs in the background',t=>{
  const {panel,drawn,hit}=fixture(t);panel.setTranscript(transcriptContent(example));panel.openTranscript();
  panel.setAgentStatus({active:true,pending:false,content:'Background build',voiceStatus:'',latestTurnId:'build'});
  assert.equal(hit(220,680),'professor-voice');assert.equal(hit(600,680),'stop-professor-voice');
  assert.equal(hit(870,680),'next');assert.equal(hit(690,70),'toggle-agent');
  assert(!drawn.slice(-20).includes('STOP TURN'));
});
