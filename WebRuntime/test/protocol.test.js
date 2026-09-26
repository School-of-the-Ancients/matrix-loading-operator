import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld,ROOM_ID,ANCHOR_ID,ASSETS} from '../src/protocol.js';

const pose=(x=0,y=0,z=-2)=>({position:{x,y,z},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}});
const command=(requestId,op,extra={})=>({requestId,op,...extra});

test('web runtime emits the existing Matrix schema and catalog',()=>{
  const world=new MatrixWorld(()=> 'object-1');
  const snapshot=world.snapshot();
  assert.equal(snapshot.scene.schemaVersion,1);
  assert.equal(snapshot.scene.roomId,ROOM_ID);
  assert.equal(snapshot.anchors[0].anchorId,ANCHOR_ID);
  assert.deepEqual(snapshot.behaviorKinds,['rotate','bob']);
  assert.equal(snapshot.roomContext.mode,'white-room');
  assert.deepEqual(ASSETS.map(a=>a.assetId),['chair','table','wall','pedestal','block','orb','column']);
});

test('spawn, transform, behavior, undo and restore preserve stable identity',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const created=world.execute(command('1','spawn',{assetId:'table',anchorId:ANCHOR_ID,transform:pose()}));
  assert.equal(created.ok,true);assert.equal(created.objectId,'object-1');
  assert.equal(world.execute(command('2','set_transform',{objectId:'object-1',transform:pose(1,0,-2)})).ok,true);
  const behavior={kind:'rotate',enabled:true,paused:false,axis:'y',speedDegreesPerSecond:30,amplitudeMeters:.05,frequencyHz:.5};
  assert.equal(world.execute(command('3','set_behavior',{objectId:'object-1',behavior})).ok,true);
  const saved=structuredClone(world.scene);
  assert.equal(world.execute(command('4','clear')).ok,true);
  assert.equal(world.scene.objects.length,0);
  assert.equal(world.execute(command('5','load',{scene:saved})).ok,true);
  assert.deepEqual(world.scene,saved);
  assert.equal(world.execute(command('6','undo')).ok,true);
  assert.equal(world.scene.objects.length,0);
  assert.equal(world.execute(command('7','redo')).ok,true);
  assert.equal(world.scene.objects[0].objectId,'object-1');
});

test('local observed movement validates and receipts without filling authored Undo history',()=>{
  const world=new MatrixWorld(()=> 'resident-1');
  const spawn=world.execute(command('spawn-1','spawn',{assetId:'orb',anchorId:ANCHOR_ID,transform:pose()}));
  assert.equal(spawn.ok,true);
  const beforeUndo=world.undo.length;
  const moved=world.execute(command('move-1','set_transform',
    {objectId:spawn.objectId,transform:pose(.25,0,-2)}),{recordHistory:false});
  assert.deepEqual({requestId:moved.requestId,ok:moved.ok,objectId:moved.objectId},
    {requestId:'move-1',ok:true,objectId:'resident-1'});
  assert.equal(world.requireObject(spawn.objectId).transform.position.x,.25);
  assert.equal(world.undo.length,beforeUndo);
  const rejected=world.execute(command('move-2','set_transform',
    {objectId:spawn.objectId,transform:pose(101,0,-2)}),{recordHistory:false});
  assert.equal(rejected.ok,false);
  assert.equal(world.requireObject(spawn.objectId).transform.position.x,.25);
  assert.equal(world.undo.length,beforeUndo);
});

test('an unrecorded mutation invalidates stale redo history',()=>{
  const world=new MatrixWorld(()=> 'resident-1');
  const spawn=world.execute(command('spawn','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0)}));
  assert.equal(spawn.ok,true);
  assert.equal(world.execute(command('author-move','set_transform',
    {objectId:spawn.objectId,transform:pose(1)})).ok,true);
  assert.equal(world.execute(command('undo','undo')).ok,true);
  assert.equal(world.redo.length,1);
  const move=world.execute(command('simulation-move','set_transform',
    {objectId:spawn.objectId,transform:pose(2)}),{recordHistory:false});
  assert.equal(move.ok,true);
  assert.equal(world.requireObject(spawn.objectId).transform.position.x,2);
  assert.equal(world.redo.length,0);
  assert.match(world.execute(command('redo','redo')).error,/History is empty/);
  assert.equal(world.requireObject(spawn.objectId).transform.position.x,2);
});

test('an advertised finite interaction returns an in-range observed outcome',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const chair=world.execute(command('spawn-chair','spawn',
    {assetId:'chair',anchorId:ANCHOR_ID,transform:pose(0,0,-2)}));
  const actor=world.execute(command('spawn-actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0,0,-1.4)}));
  assert.equal(chair.ok,true);assert.equal(actor.ok,true);
  assert.deepEqual(world.snapshot().assets.find(asset=>asset.assetId==='chair').interactions,
    [{kind:'rest',rangeMeters:.8}]);
  const beforeUndo=world.undo.length;
  const outcome=world.execute(command('rest-1','interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  assert.equal(outcome.ok,true);
  assert.deepEqual(outcome.outcome,{kind:'rest',actorObjectId:actor.objectId,
    targetObjectId:chair.objectId,observedDistanceMeters:.6});
  assert.equal(world.undo.length,beforeUndo);
  assert.equal(world.execute(command('eat-1','interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'eat'})).ok,false);
  assert.equal(world.execute(command('move-away','set_transform',
    {objectId:actor.objectId,transform:pose(3,0,-1.4)}),{recordHistory:false}).ok,true);
  const rejected=world.execute(command('rest-2','interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  assert.match(rejected.error,/out of interaction range/);
  assert.equal(rejected.outcome,undefined);
});

test('bad geometry bounds and incompatible saved scenes fail without mutation',()=>{
  const world=new MatrixWorld(()=> 'object-1');
  const original=structuredClone(world.scene);
  assert.equal(world.execute(command('1','spawn',{assetId:'unknown',anchorId:ANCHOR_ID,transform:pose()})).ok,false);
  assert.equal(world.execute(command('2','spawn',{assetId:'orb',anchorId:ANCHOR_ID,transform:pose(101,0,0)})).ok,false);
  assert.equal(world.execute(command('3','load',{scene:{...original,roomId:'another-room'}})).ok,false);
  assert.deepEqual(world.scene,original);
  assert.equal(world.undo.length,0);
});

test('selection and duplicate use acknowledged IDs and never alter another object',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  world.execute(command('1','spawn',{assetId:'chair',anchorId:ANCHOR_ID,transform:pose()}));
  const copied=world.execute(command('2','duplicate',{objectId:'object-1'}));
  assert.equal(copied.objectId,'object-2');
  assert.equal(world.scene.objects[0].transform.position.x,0);
  assert.equal(world.scene.objects[1].transform.position.x,.3);
  assert.equal(world.execute(command('3','select',{objectId:'object-2'})).ok,true);
  assert.equal(world.snapshot().selection.objectId,'object-2');
});

test('registered GLB appears in live catalog and restores with its immutable ID',()=>{
  const world=new MatrixWorld(()=> 'web-object-1');
  const sha='a'.repeat(64);
  const asset={assetId:`web:glass-arch:${sha.slice(0,12)}`,displayName:'Glass Arch',description:'A Blender-made arch.',spawnScale:.5,
    localBounds:{center:{x:0,y:1,z:0},size:{x:2,y:2,z:1}},
    sha256:sha,byteLength:1024,url:`/api/web/assets/${sha}.glb`};
  world.registerAssets([asset]);
  assert.equal(world.snapshot().assets.at(-1).assetId,asset.assetId);
  assert.equal(world.snapshot().assets.at(-1).spawnScale,.5);
  assert.deepEqual(world.snapshot().assets.at(-1).localBounds,asset.localBounds);
  assert.equal(world.execute(command('1','spawn',{assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose()})).ok,true);
  const saved=structuredClone(world.scene);
  world.execute(command('2','clear'));
  assert.equal(world.execute(command('3','load',{scene:saved})).ok,true);
  assert.equal(world.scene.objects[0].assetId,asset.assetId);
  assert.throws(()=>world.registerAssets([{...asset,url:'https://another.example/model.glb'}]),/Invalid web asset/);
  assert.throws(()=>world.registerAssets([{...asset,geometry:{animationClips:[
    {name:'Flight',durationSeconds:1},{name:'Flight',durationSeconds:1}]}}]),/animation metadata/);
  const unicode='🐉'.repeat(40);
  world.registerAssets([{...asset,geometry:{animationClips:[{name:unicode,durationSeconds:1}]}}]);
  assert.equal(world.asset(asset.assetId).geometry.animationClips[0].name,unicode);
});

test('GLB animation binding is validated, persisted, undoable, and removable',()=>{
  const world=new MatrixWorld(()=> 'dragon-1');
  const sha='b'.repeat(64);
  const asset={assetId:`web:dragon:${sha.slice(0,12)}`,displayName:'Dragon',description:'Animated GLB',
    spawnScale:1,sha256:sha,byteLength:2048,url:`/api/web/assets/${sha}.glb`,
    geometry:{animationClips:[{name:'Flight',durationSeconds:1},{name:'Roar',durationSeconds:.5}]}};
  world.registerAssets([asset]);
  assert.equal(world.snapshot().animationSchemaVersion,1);
  assert.deepEqual(world.snapshot().assets.at(-1).animationClips,['Flight','Roar']);
  assert.equal(world.execute(command('1','spawn',{assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose()})).ok,true);
  const binding={loopClip:'Flight',selectClip:'Roar'};
  assert.equal(world.execute(command('2','bind_animation',{objectId:'dragon-1',...binding})).ok,true);
  assert.deepEqual(world.scene.objects[0].animation,binding);
  const saved=structuredClone(world.scene);
  assert.equal(world.execute(command('3','bind_animation',{objectId:'dragon-1',loopClip:'Missing',selectClip:null})).ok,false);
  assert.deepEqual(world.scene,saved);
  assert.equal(world.execute(command('4','undo')).ok,true);
  assert.equal(world.scene.objects[0].animation,undefined);
  assert.equal(world.execute(command('5','redo')).ok,true);
  assert.deepEqual(world.scene.objects[0].animation,binding);
  assert.equal(world.execute(command('6','clear')).ok,true);
  assert.equal(world.execute(command('7','load',{scene:saved})).ok,true);
  assert.deepEqual(world.scene.objects[0].animation,binding);
  assert.equal(world.execute(command('8','bind_animation',{objectId:'dragon-1',loopClip:null,selectClip:null})).ok,true);
  assert.equal(world.scene.objects[0].animation,undefined);
  const bad=structuredClone(saved);bad.objects[0].animation.selectClip='Unknown';
  assert.equal(world.execute(command('9','load',{scene:bad})).ok,false);
});
