import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorPanel} from '../src/view.js';

test('Codex XR page exposes one shared creation-mode selector and keeps turn controls',()=>{
  const drawn=[];
  const context={
    fillRect(x,y,w,h){drawn.push({kind:'rect',x,y,w,h,color:this.fillStyle});},
    strokeRect(){},
    fillText(text,x,y){drawn.push({kind:'text',text:String(text),x,y});},
    measureText(text){return {width:String(text).length*14};},
  };
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();
    const hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    assert.equal(hit(190,212),null,'creation modes belong to the Codex page');
    panel.toggleAgent();
    assert.equal(hit(190,212),'creation-mode-auto');
    assert.equal(hit(490,212),'creation-mode-procedural');
    assert.equal(hit(810,212),'creation-mode-blender');
    assert.ok(drawn.some(item=>item.kind==='rect'&&item.x===55&&item.y===176&&
      item.color==='#53dcc5'),'Auto is selected by default');
    assert.ok(drawn.some(item=>item.kind==='text'&&item.text.startsWith('CODEX AGENT')&&
      item.y===286),'transcript starts below the selector');
    panel.setCreationMode('blender');
    assert.ok(drawn.some(item=>item.kind==='rect'&&item.x===660&&item.y===176&&
      item.color==='#53dcc5'));
    assert.equal(hit(250,680),'agent-connect');
    panel.setAgentStatus({activity:'Waiting',content:'Review this request.',pending:true,
      approvalReviewable:true,active:true,connected:true,voiceStatus:'',latestTurnId:''});
    assert.equal(hit(190,212),'creation-mode-auto');
    assert.equal(hit(150,680),'agent-approve');
    assert.equal(hit(430,680),'agent-deny');
    assert.equal(hit(650,680),'agent-stop');
    assert.throws(()=>panel.setCreationMode('anything'),/Invalid creation mode/);
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('Codex panel shows voice phases and returns to the first page for new feedback',()=>{
  const drawn=[];
  const context={
    fillRect(){},strokeRect(){},
    fillText(value){drawn.push(String(value));},
    measureText(value){return {width:String(value).length*14};},
  };
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();panel.toggleAgent();
    const longContent=Array(220).fill('conversation').join(' ');
    const agent={activity:'Ready',content:longContent,pending:false,
      approvalReviewable:false,active:false,connected:true,voiceStatus:'',latestTurnId:''};
    panel.setAgentStatus(agent);
    panel.nextPage();drawn.length=0;
    panel.setVoiceInputLabel('REQUESTING MIC');
    assert.ok(drawn.includes('REQUESTING MIC'));
    assert.ok(drawn.some(text=>text.startsWith('Page 2/')));
    drawn.length=0;
    panel.setAgentStatus({...agent,content:`Recording…\n\n${longContent}`,voiceStatus:'Recording…'});
    assert.ok(drawn.some(text=>text.startsWith('Page 1/')));
    assert.ok(drawn.includes('Recording…'));
    drawn.length=0;
    panel.setVoiceInputLabel('VOICE BUSY');
    assert.ok(drawn.includes('VOICE BUSY'));
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('completed Codex transcript stays on its page through background Operator updates',()=>{
  const drawn=[];
  const context={
    fillRect(){},strokeRect(){},
    fillText(value){drawn.push(String(value));},
    measureText(value){return {width:String(value).length*14};},
  };
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();panel.toggleAgent();
    const longContent=Array(220).fill('conversation').join(' ');
    const agent={activity:'Completed',content:longContent,pending:false,
      approvalReviewable:false,active:false,connected:true,voiceStatus:'',latestTurnId:'turn-one'};
    panel.setAgentStatus(agent);
    panel.nextPage();
    assert.ok(drawn.some(text=>text.startsWith('Page 2/')));
    for(let poll=0;poll<3;poll++){
      drawn.length=0;
      panel.setMessage('Operator connected. Aim at the panel and hold trigger.');
      panel.setProposal(null);
      panel.setAgentStatus({...agent,content:`${longContent} ${'more '.repeat(poll+1)}`});
      assert.ok(drawn.some(text=>text.startsWith('Page 2/')),
        'background exchange and transcript redraw must not return to page one');
    }
    drawn.length=0;
    panel.setAgentStatus({...agent,latestTurnId:'turn-two'});
    assert.ok(drawn.some(text=>text.startsWith('Page 1/')),
      'a new Codex turn should reveal its first page');
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('WORLD page keeps checkpoint feedback visible through ordinary redraws',()=>{
  const drawn=[];
  const context={
    fillRect(){},strokeRect(){},
    fillText(text,x,y){drawn.push({text:String(text),y,color:this.fillStyle});},
    measureText(text){return {width:String(text).length*14};},
  };
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();panel.toggleWorld();
    const notice=()=>drawn.find(item=>item.y===317);
    panel.setWorldNotice('Saved in browser · saving PC scene backup…','pending');
    assert.deepEqual(notice(),{text:'Saved in browser · saving PC scene backup…',y:317,color:'#dff7f8'});
    drawn.length=0;
    panel.setWorldInfo({objects:2,alignment:'Virtual room',canConfirm:false});
    assert.equal(notice().text,'Saved in browser · saving PC scene backup…');
    drawn.length=0;
    panel.setMessage('Operator connected');
    assert.equal(notice().text,'Saved in browser · saving PC scene backup…');
    drawn.length=0;
    panel.setWorldNotice('Saved in browser · PC scene backup failed.','error');
    assert.deepEqual(notice(),{text:'Saved in browser · PC scene backup failed.',y:317,color:'#ffad8d'});
    drawn.length=0;
    panel.setWorldNotice('Browser world checkpoint restored.');
    assert.deepEqual(notice(),{text:'Browser world checkpoint restored.',y:317,color:'#75f4df'});
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('XR WORLD panel can select, create and restore archived worlds with guarded controls',()=>{
  const drawn=[];
  const context={fillRect(){},strokeRect(){},
    fillText(value){drawn.push(String(value));},measureText(){return {width:0};}};
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();
    const hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    panel.toggleWorld();
    assert.equal(hit(510,570),'toggle-archives');
    panel.toggleArchives();
    panel.setWorldInfo({objects:0,alignment:'Virtual room',archiveReady:true,
      archiveCount:2,archiveIndex:1,archiveName:'Orb playground',
      archiveDetails:'6 objects · Orb Course'});
    assert.ok(drawn.includes('Orb playground'));
    assert.equal(hit(200,445),'archive-prev');
    assert.equal(hit(510,445),'archive-next');
    assert.equal(hit(200,550),'new-world');
    assert.equal(hit(745,550),'restore-archive');
    panel.setWorldInfo({objects:0,alignment:'AR room',originUnavailable:true,
      archiveReady:false,archiveCount:2,archiveIndex:1,
      archiveName:'Orb playground'});
    assert.equal(hit(200,550),null);
    assert.equal(hit(745,550),null);
    assert.equal(hit(462,71),'toggle-world');
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('Hide remains reachable on every Operator page',()=>{
  const context={fillRect(){},strokeRect(){},fillText(){},measureText(){return {width:0};}};
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();
    const hide={x:894/1024,y:1-71/768};
    assert.equal(panel.hit(hide),'hide-panel');
    panel.toggleWorld();assert.equal(panel.hit(hide),'hide-panel');
    panel.toggleAgent();assert.equal(panel.hit(hide),'hide-panel');
    panel.setProposal({summary:'Create one block',commands:[]});
    assert.equal(panel.hit(hide),'hide-panel');
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('immersive mode page exposes play, stop and return without hiding Operator',()=>{
  const context={fillRect(){},strokeRect(){},fillText(){},measureText(){return {width:0};}};
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();
    const hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    assert.equal(hit(597,71),'toggle-mode');
    panel.toggleModePage();
    assert.equal(hit(500,485),'enter-play');
    panel.setCreatorMode({mode:'play',simulation:'running',revision:1});
    assert.equal(hit(270,480),'enter-creator');
    assert.equal(hit(745,480),'stop-play');
    panel.setCreatorMode({mode:'play',simulation:'paused',revision:2});
    assert.equal(hit(745,480),'resume-play');
    assert.equal(hit(895,71),'hide-panel');
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});
