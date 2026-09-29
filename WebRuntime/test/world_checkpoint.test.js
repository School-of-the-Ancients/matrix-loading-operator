import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {selectedPointAt,currentSelectedPoint} from '../src/selected_point.js';
import {applyPCWorld,captureWorldRestoreGuard} from '../src/world_checkpoint.js';
import {storedWorld} from '../src/scene_store.js';
import {startGame} from '../src/game.js';
import {createCitizensDemo} from '../src/citizens.js';
import {createRigidPhysics} from '../src/physics_rigid.js';
import {transitionCreatorMode} from '../src/creator_mode.js';

const pose={position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
const spec={kind:'game',title:'Orb delivery',summary:'Deliver an orb.',
  roles:[{roleId:'pickup',kind:'pickup',assetId:'orb',count:1},
    {roleId:'zone',kind:'delivery-zone',assetId:'pedestal',count:1}],
  rules:[{event:'release-near',actorRoleId:'pickup',targetRoleId:'zone',distanceMeters:.5,scorePoints:1}],
  objectives:[{kind:'delivered-count',roleId:'pickup',targetCount:1}]};

test('prepared world restore rejects an AR layout change during its wait',()=>{
  const world=current(),unchanged=captureWorldRestoreGuard(world);
  world.arLayoutOffset={x:.25,z:0,yawDegrees:0};
  assert.throws(unchanged,/World changed while checkpoint restore/);
});

function current(){
  const world=new MatrixWorld(()=> 'current-orb');
  assert.equal(world.execute({requestId:'current',op:'spawn',assetId:'orb',
    anchorId:'web-floor',transform:pose}).ok,true);
  world.setSelection('current-orb',pose.position,'web-floor');
  return world;
}

function saved(){
  const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  startGame(world,spec);
  world.game.state.score=1;
  world.game.state.deliveries=[world.game.bindings.pickup[0]];
  world.game.state.objectiveProgress={pickup:1};
  world.game.state.phase='won';
  return storedWorld(world);
}

test('PC restore exchanges exact IDs and game progress before replacing the displayed world',async()=>{
  const world=current(),checkpoint=saved();
  await applyPCWorld(world,checkpoint,async()=>{
    assert.deepEqual(storedWorld(world),checkpoint);
  });
  assert.deepEqual(storedWorld(world),checkpoint);
  assert.equal(world.game.state.phase,'won');
  assert.equal(world.originBinding,'unknown','a PC checkpoint has no AR provenance');
});

test('failed PC exchange leaves the prior scene, game, selection and undo state intact',async()=>{
  const world=current(),before=storedWorld(world),selection=structuredClone(world.selection),
    undo=structuredClone(world.undo),redo=structuredClone(world.redo);
  world.originBinding='ar';
  world.originAnchorHandle='old-room-handle';
  world.arLayoutOffset={x:.25,z:-.5,yawDegrees:15};
  await assert.rejects(applyPCWorld(world,saved(),async()=>{throw Error('connection lost');}),
    /connection lost/);
  assert.deepEqual(storedWorld(world),before);
  assert.deepEqual(world.selection,selection);
  assert.deepEqual(world.undo,undo);
  assert.deepEqual(world.redo,redo);
  assert.equal(world.originBinding,'ar');
  assert.equal(world.originAnchorHandle,'old-room-handle');
  assert.deepEqual(world.arLayoutOffset,{x:.25,z:-.5,yawDegrees:15});
});

test('PC restore invalidates a pinned point only after the exchange succeeds',async()=>{
  const world=current(),checkpoint=saved();
  const point=selectedPointAt(world,'web-floor',{x:.5,y:0,z:-.5},null);
  world.selectedPlacement=point;
  const epoch=world.placementWorldEpoch;
  await assert.rejects(applyPCWorld(world,checkpoint,async()=>{
    throw Error('exchange rejected');
  }),/exchange rejected/);
  assert.equal(world.placementWorldEpoch,epoch);
  assert.equal(currentSelectedPoint(world,point,null),point);
  await applyPCWorld(world,checkpoint,async()=>{});
  assert.notEqual(world.placementWorldEpoch,epoch);
  assert.equal(currentSelectedPoint(world,point,null),null);
  assert.deepEqual(world.snapshot().selection,world.selection);
});

test('failed PC exchange restores the prior control progress and target scale',async()=>{
  const world=current();
  world.idFactory=()=> 'checkpoint-control-panel';
  const panel=world.execute({requestId:'checkpoint-control-panel',op:'spawn',
    assetId:'wall',anchorId:'web-floor',transform:{...pose,
      position:{x:2,y:0,z:-2}}}).objectId;
  world.requireObject(panel).control={schemaVersion:1,label:'Cycle orb size',
    action:{kind:'cycle-values',channel:'transform.scale',targetObjectId:'current-orb',
      values:[[1,1,1],[2,2,2]]}};
  world.requireObject('current-orb').transform.scale={x:2,y:2,z:2};
  world.controlStates[panel]={index:1,revision:3};
  const before=storedWorld(world);
  await assert.rejects(applyPCWorld(world,saved(),async()=>{
    assert.equal(Object.keys(world.controlStates).length,0);
    throw Error('exchange rejected');
  }),/exchange rejected/);
  assert.deepEqual(storedWorld(world),before);
  assert.deepEqual(world.controlStates[panel],{index:1,revision:3});
});

test('failed PC exchange restores Creator Mode, gravity, and the running rigid solver',async()=>{
  const world=current();
  world.attachRigidPhysics(await createRigidPhysics());
  const body=world.execute({requestId:'rigid-current',op:'set_rigid_body',
    objectId:'current-orb',rigidBody:{schemaVersion:1,type:'dynamic',
      collider:'bounds-box',restitution:0,friction:.8,sensor:false}});
  assert.equal(body.ok,true,body.error);
  const gravity=world.execute({requestId:'gravity-current',op:'set_gravity',
    gravity:{x:0,y:-3,z:0}});
  assert.equal(gravity.ok,true,gravity.error);
  world.creatorMode=transitionCreatorMode(world.creatorMode,'enter-play',0);
  world.creatorMode=transitionCreatorMode(world.creatorMode,'enter-creator',1);
  world.rigidPhysics.setPose('current-orb',{position:{x:1,y:1,z:-2},
    rotation:{x:0,y:0,z:0,w:1}});
  world.syncRigidTransform('current-orb',world.rigidPhysics.state('current-orb'));
  const before=storedWorld(world),solver=world.rigidPhysics.snapshot(),
    generation=world.authoredGeneration;
  const checkpoint=saved();
  checkpoint.creatorMode={schemaVersion:1,mode:'play',simulation:'paused',revision:7};
  checkpoint.rigidGravity={x:0,y:-1,z:0};
  await assert.rejects(applyPCWorld(world,checkpoint,async()=>{
    assert.deepEqual(world.creatorMode,checkpoint.creatorMode);
    assert.deepEqual(world.rigidGravity,checkpoint.rigidGravity);
    throw Error('exchange rejected');
  }),/exchange rejected/);
  assert.deepEqual(storedWorld(world),before);
  assert.deepEqual(world.rigidPhysics.snapshot(),solver);
  assert.deepEqual(world.rigidPhysics.state('current-orb').position,{x:1,y:1,z:-2});
  assert.equal(world.authoredGeneration,generation);
  world.rigidPhysics.dispose();
});

test('PC world restore resumes a moving dynamic body from checkpoint velocity',async()=>{
  const original=new MatrixWorld(()=> 'checkpoint-body');
  original.attachRigidPhysics(await createRigidPhysics());
  const active=new MatrixWorld(()=> 'other-body');
  active.attachRigidPhysics(await createRigidPhysics());
  try{
    const spawned=original.execute({requestId:'checkpoint-spawn',op:'spawn',
      assetId:'block',anchorId:'web-floor',transform:{...pose,
        position:{x:0,y:2,z:-2}}});
    assert.equal(spawned.ok,true,spawned.error);
    const rigid=original.execute({requestId:'checkpoint-rigid',op:'set_rigid_body',
      objectId:spawned.objectId,rigidBody:{schemaVersion:1,type:'dynamic',
        collider:'bounds-box',restitution:0,friction:.8,sensor:false}});
    assert.equal(rigid.ok,true,rigid.error);
    for(let frame=0;frame<12;frame++)original.advanceRigidPhysics(1/60);
    const checkpoint=storedWorld(original);
    assert.ok(checkpoint.rigidMotion.bodies[0].linearVelocity.y<0);
    await applyPCWorld(active,checkpoint,async()=>{
      assert.deepEqual(storedWorld(active),checkpoint);
    });
    assert.deepEqual(active.rigidPhysics.state(spawned.objectId).linearVelocity,
      checkpoint.rigidMotion.bodies[0].linearVelocity);
    const y=active.rigidPhysics.state(spawned.objectId).position.y;
    active.advanceRigidPhysics(1/60);
    assert.ok(active.rigidPhysics.state(spawned.objectId).position.y<y);
  }finally{original.rigidPhysics.dispose();active.rigidPhysics.dispose();}
});

test('PC restore clears Citizens on success and rolls them back on failed exchange',async()=>{
  const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(world,{seed:43});
  simulation.step();world.citizens=simulation.snapshot();
  const before=storedWorld(world),checkpoint=saved();
  await assert.rejects(applyPCWorld(world,checkpoint,async()=>{
    assert.equal(world.citizens,null);
    throw Error('exchange rejected');
  }),/exchange rejected/);
  assert.deepEqual(storedWorld(world),before);
  await applyPCWorld(world,checkpoint,async()=>{});
  assert.equal(world.citizens,null);
  assert.deepEqual(storedWorld(world),checkpoint);
});

test('PC restore can repair a missing Citizens chair and still roll back a failed exchange',async()=>{
  const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(world,{seed:47});
  world.citizens=simulation.snapshot();
  const checkpoint=storedWorld(world);
  const chairId=world.citizens.stations.find(station=>station.kind==='rest').objectId;
  assert.equal(world.execute({requestId:'external-delete',op:'delete',objectId:chairId}).ok,true);
  const invalidScene=structuredClone(world.scene),invalidCitizens=structuredClone(world.citizens);
  assert.throws(()=>storedWorld(world),/missing or incompatible/);
  await assert.rejects(applyPCWorld(world,checkpoint,async()=>{throw Error('exchange rejected');}),
    /exchange rejected/);
  assert.deepEqual(world.scene,invalidScene);
  assert.deepEqual(world.citizens,invalidCitizens);
  await applyPCWorld(world,checkpoint,async()=>{});
  assert.deepEqual(storedWorld(world),checkpoint);
});

test('invalid PC checkpoint cannot replace a browser world',async()=>{
  const world=current(),before=storedWorld(world),missing=saved();
  missing.scene.objects[0].assetId='web:missing';
  let exchanged=false;
  await assert.rejects(applyPCWorld(world,missing,async()=>{exchanged=true;}),/Invalid scene object/);
  assert.equal(exchanged,false);
  assert.deepEqual(storedWorld(world),before);
});
