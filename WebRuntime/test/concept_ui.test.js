import test from 'node:test';
import assert from 'node:assert/strict';
import {ConceptUI} from '../src/concept_ui.js';

test('a concept UI action ignores a late result or error from another session',async()=>{
  const oldSession='a'.repeat(32),newSession='b'.repeat(32);
  let rendered=0;
  const ui={getSession:()=>newSession,notice:'Submitting old image',noticeError:true,
    client:{sessionId:oldSession,_session(id){this.sessionId=id;}},
    render:()=>{rendered++;}};
  const result=await ConceptUI.prototype._currentResult.call(ui,oldSession,
    Promise.resolve({job:{id:'old'}}));
  assert.equal(result,null);
  assert.equal(ui.notice,'');
  assert.equal(ui.noticeError,false);
  assert.equal(ui.client.sessionId,newSession);
  const lateFailure=await ConceptUI.prototype._currentResult.call(ui,oldSession,
    Promise.reject(Error('Old job failed')));
  assert.equal(lateFailure,null);
  assert.equal(rendered,2);
  await assert.rejects(ConceptUI.prototype._currentResult.call(
    {...ui,getSession:()=>oldSession},oldSession,Promise.reject(Error('Current job failed'))),
  /Current job failed/);
});

test('selected-design build uses the refreshed concept identity and requires a ready selection',async()=>{
  const sessionId='a'.repeat(32),oldId='b'.repeat(32),selectedId='c'.repeat(32);
  let refreshes=0;
  const ui={_session:async()=>sessionId,getSession:()=>sessionId,
    client:{selected:{conceptId:oldId,version:1},async refresh(){
      refreshes++;this.selected={conceptId:selectedId,version:2};
    }}};
  const expected=await ConceptUI.prototype.expectedBuild.call(ui,'Build this in the Matrix');
  assert.deepEqual(expected,{conceptId:selectedId,version:2});
  assert.equal(refreshes,1);
  assert.equal(await ConceptUI.prototype.expectedBuild.call(ui,'Build this bridge'),null);
  assert.equal(refreshes,1);
  ui.client.refresh=async()=>{ui.client.selected=null;};
  await assert.rejects(ConceptUI.prototype.expectedBuild.call(ui,'Build the selected design'),
    /Select a ready concept version/);
});
