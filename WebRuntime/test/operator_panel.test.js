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
