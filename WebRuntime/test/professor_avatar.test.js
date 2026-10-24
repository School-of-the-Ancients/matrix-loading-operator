import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {placeProfessor,validProfessorBinding} from '../src/professor_avatar.js';
const session='00000000-0000-4000-8000-000000000001';
const avatar={catalogId:'generic-professor',assetId:'professor-placeholder',assetSha256:'',representation:'generic',availability:'ready'};
const request={schoolSessionId:session,teacherId:'euclid',teacherName:'Euclid',catalogId:avatar.catalogId};
test('professor placement is idempotent, persists through restore, and retains other objects',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  world.execute({requestId:'block',op:'spawn',assetId:'block',anchorId:'web-floor',transform:{position:{x:4,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}});
  const first=placeProfessor(world,avatar,request,{x:1,y:0,z:-2});
  placeProfessor(world,avatar,request,{x:7,y:0,z:1});
  assert.equal(world.scene.objects.length,2);
  assert.deepEqual(world.requireObject(first.objectId).transform.position,{x:1,y:0,z:-2});
  const restored=new MatrixWorld();
  assert.equal(restored.execute({requestId:'load',op:'load',scene:world.scene}).ok,true);
  assert.deepEqual(restored.requireObject(first.objectId).professor,world.requireObject(first.objectId).professor);
  assert.equal(restored.scene.objects[0].assetId,'block');
});
test('unknown avatar and corrupt teacher binding cannot mutate the world',()=>{
  const world=new MatrixWorld();
  assert.throws(()=>placeProfessor(world,{...avatar,catalogId:'other'},request,{x:0,y:0,z:0}));
  assert.throws(()=>placeProfessor(world,avatar,{...request,teacherName:'bad\nname'},{x:0,y:0,z:0}));
  assert.equal(world.scene.objects.length,0);
  assert.equal(validProfessorBinding({schemaVersion:1,...request,assetSha256:'x',representation:'generic'},'professor-placeholder'),false);
});
test('saved corrupt binding is rejected before replacing the current scene',()=>{
  const world=new MatrixWorld(()=> 'prof');placeProfessor(world,avatar,request,{x:0,y:0,z:0});
  const scene=structuredClone(world.scene);scene.objects[0].professor.assetSha256='bad';
  assert.equal(world.execute({requestId:'bad-load',op:'load',scene}).ok,false);
  assert.equal(world.scene.objects[0].professor.assetSha256,'');
});
test('professor authoring respects Creator mode',()=>{
  const world=new MatrixWorld();world.creatorMode.mode='play';
  assert.throws(()=>placeProfessor(world,avatar,request,{x:0,y:0,z:0}),/Creator Mode/);
  assert.equal(world.scene.objects.length,0);
});

test('rebinding a teacher supports undo and redo without moving their avatar',()=>{
  const world=new MatrixWorld(()=> 'prof');placeProfessor(world,avatar,request,{x:1,y:0,z:-2});
  placeProfessor(world,avatar,{...request,teacherName:'Updated teacher'},{x:0,y:0,z:0});
  assert.equal(world.scene.objects[0].professor.teacherName,'Updated teacher');
  assert.equal(world.execute({requestId:'undo-binding',op:'undo'}).ok,true);
  assert.equal(world.scene.objects[0].professor.teacherName,'Euclid');
  assert.equal(world.execute({requestId:'redo-binding',op:'redo'}).ok,true);
  assert.equal(world.scene.objects[0].professor.teacherName,'Updated teacher');
  assert.deepEqual(world.scene.objects[0].transform.position,{x:1,y:0,z:-2});
});
