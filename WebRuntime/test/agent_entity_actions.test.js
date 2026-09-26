import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {createRigidPhysics} from '../src/physics_rigid.js';
import {transitionCreatorMode} from '../src/creator_mode.js';
import {restoreStoredWorld,storedWorld} from '../src/scene_store.js';

let request=0,object=0;
const pose=(x=0,y=0,z=0)=>({position:{x,y,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
const rigid=type=>({schemaVersion:1,type,collider:'bounds-box',
  restitution:0,friction:.8,sensor:false});
const world=()=>new MatrixWorld(()=>`entity-${++object}`);
const run=(current,op,data={})=>current.execute({requestId:`entity-request-${++request}`,op,...data});
const succeeds=(current,op,data={})=>{
  const result=run(current,op,data);
  assert.equal(result.ok,true,`${op}: ${result.error}`);
  return result;
};
const spawn=(current,assetId,transform)=>succeeds(current,'spawn',
  {assetId,anchorId:'web-floor',transform}).objectId;
const guarded=(current,objectId)=>({objectId,
  expectedTransform:structuredClone(current.requireObject(objectId).transform),
  expectedCreatorRevision:current.creatorMode.revision});

test('agent inspect and receipt-backed grab actions share game progress and survive reopen',async()=>{
  const current=world();current.attachRigidPhysics(await createRigidPhysics());
  const item=spawn(current,'block',pose(0,.5,0));
  succeeds(current,'set_rigid_body',{objectId:item,rigidBody:rigid('dynamic'),
    expectedRigidBody:null,expectedTransform:pose(0,.5,0)});
  const zone=spawn(current,'pedestal',pose(2.5,0,0));
  const exit=spawn(current,'wall',pose(4,0,0));
  succeeds(current,'bind_game',{spec:{schemaVersion:2,kind:'game',title:'Entity Actions',
    summary:'Deliver the block.',
    roles:[{roleId:'items',kind:'pickup',assetId:'block',count:1},
      {roleId:'zone',kind:'delivery-zone',assetId:'pedestal',count:1},
      {roleId:'exit',kind:'exit',assetId:'wall',count:1}],
    rules:[{event:'release-near',actorRoleId:'items',targetRoleId:'zone',
      distanceMeters:.75,scorePoints:7}],
    objectives:[{kind:'delivered-count',roleId:'items',targetCount:1}],
    consequences:[{kind:'unlock',roleId:'exit'}]},
  bindings:{items:[item],zone:[zone],exit:[exit]}});
  const initial=succeeds(current,'inspect_entity',{objectId:item}).outcome;
  assert.equal(initial.kind,'entity-inspection');
  assert.equal(initial.object.objectId,item);
  assert.equal(initial.rigidState.type,'dynamic');
  assert.equal(initial.colliderScope,'virtual-floor');
  assert.deepEqual(initial.availableActions,[]);
  assert.equal(initial.gameRoles[0].kind,'pickup');
  assert.equal(run(current,'begin_grab',guarded(current,item)).ok,false,
    'Creator Mode cannot use Play actions');

  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-play',0);
  assert.deepEqual(succeeds(current,'inspect_entity',{objectId:item}).outcome.availableActions,
    ['begin_grab']);
  const began=succeeds(current,'begin_grab',guarded(current,item));
  assert.equal(began.outcome.kind,'grab-began');
  assert.equal(began.outcome.rigidState.held,true);
  assert.deepEqual(succeeds(current,'inspect_entity',{objectId:item}).outcome.availableActions,
    ['move_grab','release_grab']);
  assert.equal(run(current,'move_grab',{...guarded(current,item),grabId:began.requestId,
    targetPose:{position:{x:4,y:.8,z:0},rotation:{x:0,y:0,z:0}}}).ok,false,
  'out-of-range move is rejected');
  assert.equal(current.requireObject(item).transform.position.x,0);
  assert.equal(run(current,'move_grab',{...guarded(current,item),grabId:'wrong-lease',
    targetPose:{position:{x:2.5,y:.8,z:0},rotation:{x:0,y:0,z:0}}}).ok,false,
  'an unrelated grab lease cannot move the body');
  const moved=succeeds(current,'move_grab',{...guarded(current,item),grabId:began.requestId,
    targetPose:{position:{x:2.5,y:.8,z:0},rotation:{x:0,y:0,z:0}}});
  assert.equal(moved.outcome.kind,'grab-moved');
  assert.equal(current.requireObject(item).transform.position.x,2.5);
  assert.equal(run(current,'release_grab',{...guarded(current,item),
    expectedCreatorRevision:0,grabId:began.requestId}).ok,false,
  'stale mode revision cannot release');
  const released=succeeds(current,'release_grab',{...guarded(current,item),
    grabId:began.requestId});
  assert.equal(released.outcome.kind,'grab-released');
  assert.equal(released.outcome.rigidState.held,false);
  assert.equal(released.outcome.gameEvent.credited,true);
  assert.deepEqual(released.outcome.gameStatus.unlockedObjectIds,[exit]);
  assert.equal(current.game.state.score,7);
  assert.equal(run(current,'release_grab',{...guarded(current,item),
    grabId:began.requestId}).ok,false,'repeated release cannot credit again');
  const second=succeeds(current,'begin_grab',guarded(current,item));
  succeeds(current,'release_grab',{...guarded(current,item),grabId:second.requestId});
  assert.equal(current.game.state.score,7,'repeated grab and release cannot duplicate credit');
  const before=current.rigidPhysics.state(item).position.y;
  for(let i=0;i<5;i++)current.advanceRigidPhysics(1/60);
  assert.ok(current.rigidPhysics.state(item).position.y<before,
    'release restores dynamic physics');
  const recovered=world();restoreStoredWorld(recovered,storedWorld(current));
  recovered.attachRigidPhysics(await createRigidPhysics());
  assert.equal(recovered.requireObject(item).objectId,item);
  assert.equal(recovered.game.state.score,7);
  assert.deepEqual(recovered.game.state.unlockedObjectIds,[exit]);
  assert.equal(succeeds(recovered,'inspect_entity',{objectId:item}).outcome.rigidState.held,false);
  current.rigidPhysics.dispose();recovered.rigidPhysics.dispose();
});

test('AR entity actions use virtual-floor bodies and stop when room origin is unavailable',async()=>{
  const current=world();current.attachRigidPhysics(await createRigidPhysics());
  const item=spawn(current,'block',pose(0,.5,0));
  succeeds(current,'set_rigid_body',{objectId:item,rigidBody:rigid('dynamic')});
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-play',0);
  current.enterAR();
  const began=succeeds(current,'begin_grab',guarded(current,item));
  assert.equal(began.outcome.rigidState.held,true);
  succeeds(current,'release_grab',{...guarded(current,item),grabId:began.requestId});
  current.setOriginUnavailable(true);
  const inspection=succeeds(current,'inspect_entity',{objectId:item}).outcome;
  assert.equal(inspection.roomContext.state,'missing');
  assert.deepEqual(inspection.availableActions,[]);
  assert.equal(run(current,'begin_grab',guarded(current,item)).ok,false);
  current.setOriginUnavailable(false);
  current.requireObject(item).anchorId='measured-plane';
  assert.equal(run(current,'begin_grab',guarded(current,item)).ok,false,
    'a measured physical surface never becomes an agent-owned virtual collider');
  current.rigidPhysics.dispose();
});

test('rigid configuration and gravity preconditions reject stale edits',async()=>{
  const current=world();current.attachRigidPhysics(await createRigidPhysics());
  const item=spawn(current,'block',pose());
  const dynamic=rigid('dynamic');
  succeeds(current,'set_rigid_body',{objectId:item,rigidBody:dynamic,
    expectedRigidBody:null,expectedTransform:pose()});
  assert.equal(run(current,'remove_rigid_body',{objectId:item,
    expectedRigidBody:rigid('static'),expectedTransform:pose()}).ok,false);
  assert.deepEqual(current.requireObject(item).rigidBody,dynamic);
  assert.equal(run(current,'set_gravity',{gravity:{x:0,y:-3,z:0},
    expectedGravity:{x:0,y:-1,z:0}}).ok,false);
  assert.deepEqual(current.rigidGravity,{x:0,y:-9.81,z:0});
  succeeds(current,'set_gravity',{gravity:{x:0,y:-3,z:0},
    expectedGravity:{x:0,y:-9.81,z:0}});
  assert.deepEqual(current.rigidGravity,{x:0,y:-3,z:0});
  current.rigidPhysics.dispose();
});
