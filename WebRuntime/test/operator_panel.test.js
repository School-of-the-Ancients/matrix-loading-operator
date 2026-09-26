import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorPanel} from '../src/view.js';

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
