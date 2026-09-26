import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld,ANCHOR_ID} from '../src/protocol.js';
import {advanceFloorBody,createFloorBody,physicsFloorY,validPhysicsConfig,
  PHYSICS_STEP_SECONDS} from '../src/physics_floor.js';

const sha='e'.repeat(64);
const asset={assetId:`web:test-drop:${sha.slice(0,12)}`,displayName:'Drop',description:'Measured GLB',
  spawnScale:1,sha256:sha,byteLength:1024,url:`/api/web/assets/${sha}.glb`,
  localBounds:{center:{x:0,y:.5,z:0},size:{x:1,y:1,z:1}}};
const physics=(restitution=0)=>({schemaVersion:1,kind:'gravity-floor',
  collider:'catalog-bounds-box',restitution});
const pose=(y=2)=>({position:{x:0,y,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}});
const command=(requestId,op,fields={})=>({requestId,op,...fields});
function worldWithDrop(y=2){
  const world=new MatrixWorld(()=> 'drop-1');
  world.registerAssets([asset]);
  assert.equal(world.execute(command('spawn','spawn',
    {assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose(y)})).ok,true);
  return world;
}

test('physics config is exact and normalized GLB floor is root-local zero',()=>{
  assert.equal(validPhysicsConfig(physics(.75)),true);
  for(const bad of [{...physics(),restitution:.76},{...physics(),restitution:NaN},
    {...physics(),restitution:true},{...physics(),extra:1},{...physics(),kind:'script'}])
    assert.equal(validPhysicsConfig(bad),false);
  const raised={...asset,spawnScale:.5,localBounds:{center:{x:0,y:.8,z:0},size:{x:1,y:1,z:1}}};
  assert.equal(physicsFloorY(raised,{scale:{x:2,y:2,z:2}}),0);
});

test('fixed-step floor drop reaches one bounded contact independent of render cadence',()=>{
  const object={objectId:'drop-1',assetId:asset.assetId,anchorId:ANCHOR_ID,
    transform:pose(2),physics:physics()};
  const run=(dt,frames)=>{
    let body=createFloorBody(object,asset,'set-1'),contacts=[];
    for(let index=0;index<frames;index++){
      const result=advanceFloorBody(body,dt);body=result.body;contacts.push(...result.contacts);
    }
    return {body,contacts};
  };
  const first=run(PHYSICS_STEP_SECONDS,120);
  const second=run(PHYSICS_STEP_SECONDS/2,240);
  const third=run(PHYSICS_STEP_SECONDS*2,60);
  for(const {body,contacts} of [first,second,third]){
    assert.equal(body.status,'settled');
    assert.equal(body.position.y,0);
    assert.equal(body.verticalVelocityMps,0);
    assert.equal(body.contactCount,1);
    assert.equal(contacts.length,1);
    assert.equal(body.lastContact.surface,'web-floor');
    assert.equal(body.lastContact.approximate,true);
    assert.ok(Math.abs(body.lastContact.impactSpeedMps-Math.sqrt(2*9.81*2))<.01);
  }
  assert.deepEqual(first.body.lastContact,second.body.lastContact);
  assert.deepEqual(first.body.lastContact,third.body.lastContact);
  assert.equal(object.transform.position.y,2,'solver leaves authored scene pose unchanged');
});

test('restitution rebounds and eventually settles with finite contact count',()=>{
  const object={objectId:'drop-1',assetId:asset.assetId,anchorId:ANCHOR_ID,
    transform:pose(2),physics:physics(.5)};
  let body=createFloorBody(object,asset,'set-1'),sawRebound=false;
  for(let i=0;i<1200&&body.status!=='settled';i++){
    body=advanceFloorBody(body,PHYSICS_STEP_SECONDS).body;
    sawRebound ||= body.verticalVelocityMps>0;
    assert.ok(Number.isFinite(body.position.y)&&body.position.y>=0);
    assert.ok(Math.abs(body.verticalVelocityMps)<=50);
  }
  assert.equal(sawRebound,true);
  assert.equal(body.status,'settled');
  assert.ok(body.contactCount>1&&body.contactCount<1000);
  assert.equal(body.lastContact.index,body.contactCount);
});

test('set_physics requires renderer-verified imported bounds and isolates transient state',()=>{
  const world=worldWithDrop();
  const requested=command('set-1','set_physics',{objectId:'drop-1',physics:physics()});
  assert.match(world.execute(requested).error,/verified/);
  assert.equal(world.verifyPhysicsAsset(asset.assetId,{x:1,y:1.1,z:1},'drop-1'),false);
  assert.equal(world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'drop-1'),true);
  assert.equal(world.execute(requested).ok,true);
  assert.deepEqual(world.scene.objects[0].physics,physics());
  assert.equal(world.snapshot().physicsSchemaVersion,1);
  assert.equal(world.snapshot().physicsStates[0].executionId,'set-1');
  assert.equal(world.physicsState('drop-1').status,'falling');
  for(let i=0;i<90;i++)world.advancePhysics(PHYSICS_STEP_SECONDS);
  assert.equal(world.physicsState('drop-1').status,'settled');
  assert.equal(world.scene.objects[0].transform.position.y,2);
  assert.equal(world.pausePhysics('drop-1'),true);
  assert.equal(world.physicsState('drop-1').status,'paused');
  assert.equal(world.resumePhysics('drop-1'),true);
  assert.equal(world.physicsState('drop-1').status,'settled');
  assert.equal(world.verifyPhysicsAsset(asset.assetId,{x:1,y:1.1,z:1},'drop-1'),false);
  assert.equal(world.physicsState('drop-1'),null,'invalidated renderer bounds cancel the run');
  assert.equal(world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'drop-1'),true);
  assert.equal(world.execute(command('remove','remove_physics',{objectId:'drop-1'})).ok,true);
  assert.equal(world.physicsState('drop-1'),null);
  assert.equal(world.scene.objects[0].physics,undefined);
});

test('GLB export pivot does not change floor contact after loader normalization',()=>{
  const shifted={...asset,localBounds:{center:{x:3,y:-2,z:4},size:{x:1,y:1,z:1}}};
  const world=new MatrixWorld(()=> 'shifted-1');world.registerAssets([shifted]);
  world.execute(command('spawn','spawn',
    {assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose(1)}));
  assert.equal(world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'shifted-1'),true);
  assert.equal(world.execute(command('set','set_physics',
    {objectId:'shifted-1',physics:physics()})).ok,true);
  for(let index=0;index<60;index++)world.advancePhysics(PHYSICS_STEP_SECONDS);
  assert.equal(world.physicsState('shifted-1').position.y,0);
});

test('set_transform rebases a running drop, while unrelated redraws preserve it',()=>{
  const world=worldWithDrop();world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'drop-1');
  assert.equal(world.execute(command('set-1','set_physics',{objectId:'drop-1',physics:physics()})).ok,true);
  world.advancePhysics(.1);
  const before=world.physicsState('drop-1');
  assert.ok(before.position.y<2);
  assert.equal(world.execute(command('select','select',{objectId:'drop-1'})).ok,true);
  assert.deepEqual(world.physicsState('drop-1'),before);
  assert.equal(world.pausePhysics('drop-1'),true);
  world.advancePhysics(.1);
  assert.equal(world.physicsState('drop-1').position.y,before.position.y);
  assert.equal(world.resumePhysics('drop-1'),true);
  const moved=pose(3);moved.position.x=.4;
  assert.equal(world.execute(command('move','set_transform',{objectId:'drop-1',transform:moved})).ok,true);
  assert.equal(world.physicsState('drop-1').executionId,'move');
  assert.deepEqual(world.physicsState('drop-1').position,moved.position);
  assert.equal(world.physicsState('drop-1').verticalVelocityMps,0);
  assert.equal(world.physicsState('drop-1').contactCount,0);
  assert.equal(world.execute(command('bad-move','set_transform',
    {objectId:'drop-1',transform:pose(6)})).ok,false);
  assert.deepEqual(world.scene.objects[0].transform,moved);
});

test('a redraw pauses its run until the same model re-verifies, and another instance cannot authorize it',()=>{
  let index=0;const world=new MatrixWorld(()=>`drop-${++index}`);
  world.registerAssets([asset]);
  for(let i=0;i<2;i++)world.execute(command(`spawn-${i}`,'spawn',
    {assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose()}));
  world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'drop-1');
  assert.match(world.execute(command('other','set_physics',
    {objectId:'drop-2',physics:physics()})).error,/verified/);
  assert.equal(world.execute(command('start','set_physics',
    {objectId:'drop-1',physics:physics()})).ok,true);
  world.advancePhysics(.1);
  const falling=world.physicsState('drop-1');
  assert.equal(world.invalidatePhysicsAsset('drop-1'),true);
  assert.equal(world.physicsState('drop-1').status,'paused');
  world.advancePhysics(.1);
  assert.equal(world.physicsState('drop-1').position.y,falling.position.y);
  assert.match(world.execute(command('pending','set_physics',
    {objectId:'drop-1',physics:physics()})).error,/verified/);
  world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'drop-1');
  assert.equal(world.physicsState('drop-1').status,'falling');
  world.advancePhysics(.1);
  assert.ok(world.physicsState('drop-1').position.y<falling.position.y);
  world.invalidatePhysicsAsset('drop-1',true);
  assert.equal(world.physicsState('drop-1'),null);
});

test('duplicate keeps physics config inert until its own GLB instance is verified',()=>{
  let index=0;const world=new MatrixWorld(()=>`drop-${++index}`);
  world.registerAssets([asset]);
  world.execute(command('spawn','spawn',{assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose()}));
  world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'drop-1');
  assert.equal(world.execute(command('set','set_physics',
    {objectId:'drop-1',physics:physics()})).ok,true);
  world.advancePhysics(.1);
  const original=world.physicsState('drop-1');
  const copy=world.execute(command('copy','duplicate',{objectId:'drop-1'}));
  assert.equal(copy.ok,true);
  assert.equal(copy.objectId,'drop-2');
  assert.deepEqual(world.scene.objects[1].physics,physics());
  assert.equal(world.physicsState('drop-2'),null);
  assert.match(world.execute(command('too-early','set_physics',
    {objectId:'drop-2',physics:physics()})).error,/verified/);
  world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'drop-2');
  assert.equal(world.execute(command('start-copy','set_physics',
    {objectId:'drop-2',physics:physics()})).ok,true);
  assert.equal(world.physicsState('drop-2').executionId,'start-copy');
  assert.deepEqual(world.physicsState('drop-1'),original);
});

test('saved config is inert on restore, undo, AR transition, and direct scene replacement',()=>{
  const world=worldWithDrop();world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'drop-1');
  assert.equal(world.execute(command('set','set_physics',{objectId:'drop-1',physics:physics()})).ok,true);
  const saved=structuredClone(world.scene);
  world.enterAR();
  assert.equal(world.physicsState('drop-1'),null);
  assert.deepEqual(world.scene.objects[0].physics,physics());
  assert.match(world.execute(command('ar','set_physics',{objectId:'drop-1',physics:physics()})).error,/white room/);
  world.leaveAR();
  assert.equal(world.physicsState('drop-1'),null);
  assert.equal(world.execute(command('reload','load',{scene:saved})).ok,true);
  assert.equal(world.physicsState('drop-1'),null);
  assert.match(world.execute(command('too-early','set_physics',
    {objectId:'drop-1',physics:physics()})).error,/verified/);
  world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'drop-1');
  assert.equal(world.execute(command('set-again','set_physics',{objectId:'drop-1',physics:physics()})).ok,true);
  assert.equal(world.execute(command('undo','undo')).ok,true);
  assert.equal(world.physicsState('drop-1'),null);
  assert.deepEqual(world.scene.objects[0].physics,physics());
  assert.equal(world.execute(command('redo','redo')).ok,true);
  assert.equal(world.physicsState('drop-1'),null);
  world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'drop-1');
  assert.equal(world.execute(command('set-third','set_physics',{objectId:'drop-1',physics:physics()})).ok,true);
  world.scene=structuredClone(world.scene);
  assert.equal(world.physicsState('drop-1'),null,'browser-local restore cannot inherit an old run');
});

test('physics rejects competing pose writers, built-ins, and more than 16 configured objects',()=>{
  const world=worldWithDrop();world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},'drop-1');
  const set=()=>world.execute(command('set','set_physics',{objectId:'drop-1',physics:physics()}));
  world.scene.objects[0].component={status:'stopped'};
  assert.match(set().error,/components/);
  delete world.scene.objects[0].component;
  const behavior={kind:'bob',enabled:true,paused:true,axis:'y',speedDegreesPerSecond:0,
    amplitudeMeters:.1,frequencyHz:1};
  assert.equal(world.execute(command('bob','set_behavior',{objectId:'drop-1',behavior})).ok,true);
  assert.match(set().error,/behaviors/);
  assert.equal(world.execute(command('remove-bob','remove_behavior',
    {objectId:'drop-1',behaviorKind:'all'})).ok,true);
  for(const invalidY of [-.01,5.01]){
    world.scene.objects[0].transform.position.y=invalidY;
    assert.match(set().error,/0–5 metres/);
  }
  world.scene.objects[0].transform=pose();
  world.scene.objects[0].transform.rotation.x=.02;
  assert.match(set().error,/upright/);
  world.scene.objects[0].transform=pose();
  assert.equal(set().ok,true);
  assert.match(world.execute(command('reenable','set_behavior',{objectId:'drop-1',behavior})).error,/physics/);
  assert.match(world.execute(command('attach','attach_component',{objectId:'drop-1'})).error,/physics/);
  const builtin=new MatrixWorld(()=> 'block-1');
  builtin.execute(command('spawn','spawn',{assetId:'block',anchorId:ANCHOR_ID,transform:pose()}));
  assert.match(builtin.execute(command('set','set_physics',
    {objectId:'block-1',physics:physics()})).error,/imported GLB/);
  const many=new MatrixWorld(()=>`drop-${many.scene.objects.length+1}`);
  many.registerAssets([asset]);
  for(let i=0;i<17;i++){
    const added=many.execute(command(`spawn-${i}`,'spawn',
      {assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose()}));
    assert.equal(added.ok,true);
    many.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},added.objectId);
    const result=many.execute(command(`set-${i}`,'set_physics',
      {objectId:added.objectId,physics:physics()}));
    assert.equal(result.ok,i<16);
  }
  assert.equal(many.snapshot().physicsStates.length,16);
  const invalid=structuredClone(many.scene);
  invalid.objects[16].physics=physics();
  assert.throws(()=>many.validateScene(invalid),/Physics object limit/);
});
