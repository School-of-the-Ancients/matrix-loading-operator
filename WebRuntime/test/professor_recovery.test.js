import test from 'node:test';
import assert from 'node:assert/strict';
import {ProfessorRecovery} from '../src/professor_recovery.js';
import {ProfessorConversation} from '../src/professor_conversation.js';

const leonardo={objectId:'leonardo',professor:{schoolSessionId:'lesson-leonardo'}};
const socrates={objectId:'socrates',professor:{schoolSessionId:'lesson-socrates'}};
const storage=()=>({value:null,getItem(){return this.value;},setItem(key,value){this.value=value;}});
function fixture(objects,request){
  let scene={objects};const saved=storage();
  const calls=[];
  const conversation=new ProfessorConversation({worldIdentity:()=>scene,request:async(path,body)=>{
    calls.push({path,body});return request?request(path,body):{id:path.split('/').at(-1),mentor:{id:'davinci',name:'Leonardo'}};
  }});
  const recovery=new ProfessorRecovery({storage:saved,conversation,scene:()=>scene});
  return {conversation,recovery,calls,saved,changeScene:next=>scene=next};
}
test('reloading a saved avatar reopens its lesson without creating a greeting lesson',async()=>{
  const f=fixture([leonardo]);await f.recovery.restore();
  assert.equal(f.conversation.session.id,'lesson-leonardo');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].body,undefined);
  await f.recovery.restore();assert.equal(f.calls.length,1);
});
test('saved active professor wins in a multi-professor world; another world cannot inherit it',async()=>{
  const f=fixture([leonardo,socrates]);
  f.conversation.session={id:'lesson-leonardo'};f.recovery.remember();f.conversation.session=null;
  await f.recovery.restore();assert.equal(f.conversation.session.id,'lesson-leonardo');
  const empty=fixture([]);empty.saved.value=f.saved.value;await empty.recovery.restore();
  assert.equal(empty.conversation.session,null);assert.equal(empty.calls.length,0);
});
test('ambiguous saved professors require a choice instead of silently starting Socrates',async()=>{
  const f=fixture([leonardo,socrates]);
  await assert.rejects(f.recovery.restore(),/more than one/);
  assert.equal(f.calls.length,0);
  f.conversation.session={id:'lesson-leonardo'};await f.recovery.restore();
  assert.equal(f.recovery.error,'');
});
test('an explicit professor link resolves only a teacher already bound in the scene',async()=>{
  const f=fixture([{...leonardo,professor:{...leonardo.professor,teacherId:'davinci'}},socrates]);
  f.recovery.preferredTeacher='davinci';await f.recovery.restore();
  assert.equal(f.conversation.session.id,'lesson-leonardo');
  const missing=fixture([leonardo,socrates]);missing.recovery.preferredTeacher='not-present';
  await assert.rejects(missing.recovery.restore(),/more than one/);
});
test('failed saved lesson recovery keeps the error and never creates a replacement lesson',async()=>{
  const f=fixture([leonardo],()=>{throw Error('offline');});
  await assert.rejects(f.recovery.restore(),/could not reopen/);
  await assert.rejects(f.recovery.restore(),/could not reopen/);
  assert.equal(f.calls.length,1);assert.equal(f.conversation.session,null);
});
test('voice input cannot start a fresh lesson while saved lesson recovery is pending',async()=>{
  let release;const f=fixture([leonardo],()=>new Promise(r=>release=r));
  const restore=f.recovery.restore();
  assert.equal(f.conversation.restoring,true);
  assert.equal(f.recovery.restoringId,'lesson-leonardo');
  await assert.rejects(f.conversation.ask('Hello'),/saved lesson/);
  release({id:'lesson-leonardo',mentor:{name:'Leonardo'}});await restore;
  assert.equal(f.conversation.restoring,false);
  assert.equal(f.recovery.restoringId,null);
});
test('a world switch or explicit lesson choice wins over late restoration',async()=>{
  let release;const f=fixture([leonardo],()=>new Promise(r=>release=r));
  const restore=f.recovery.restore();f.changeScene({objects:[]});
  release({id:'lesson-leonardo',mentor:{name:'Leonardo'}});await restore;
  assert.equal(f.conversation.session,null);
});
