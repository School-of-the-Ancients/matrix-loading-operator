import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAT_KEY,MAX_TURNS,loadConversation,rememberTurn,clearConversation} from '../src/conversation.js';

function storage(){
  const values=new Map();
  return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}

test('follow-up turns survive a reload in the same tab and remain bounded',()=>{
  const tab=storage();let history=[];
  for(let index=0;index<9;index++)history=rememberTurn(tab,history,`request ${index}`,`reply ${index}`);
  assert.equal(history.length,MAX_TURNS);
  assert.equal(history[0].user,'request 3');
  assert.deepEqual(loadConversation(tab),history);
  assert.equal(tab.getItem(CHAT_KEY).includes('request 0'),false);
});

test('new chat clears prior context without requiring a scene reset',()=>{
  const tab=storage();const history=rememberTurn(tab,[],'Make a robot','Robot created');
  assert.equal(history.length,1);
  assert.deepEqual(clearConversation(tab),[]);
  assert.deepEqual(loadConversation(tab),[]);
});

test('malformed stored conversation is ignored',()=>{
  const tab=storage();tab.setItem(CHAT_KEY,'{bad json');
  assert.deepEqual(loadConversation(tab),[]);
});
