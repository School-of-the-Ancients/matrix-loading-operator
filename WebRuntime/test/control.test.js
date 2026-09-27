import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld,validateControlStates,validControlDescriptor} from '../src/protocol.js';
import {transitionCreatorMode} from '../src/creator_mode.js';
import {createRigidPhysics} from '../src/physics_rigid.js';

let serial=0;
const pose=(x=0,y=0,z=0,scale={x:1,y:1,z:1})=>({position:{x,y,z},
  rotation:{x:0,y:0,z:0},scale});
const world=()=>new MatrixWorld(()=>`control-object-${++serial}`);
const run=(current,op,fields={})=>current.execute({
  requestId:`control-request-${++serial}`,op,...fields});
const succeeds=(current,op,fields={})=>{
  const receipt=run(current,op,fields);
  assert.equal(receipt.ok,true,`${op}: ${receipt.error}`);
  return receipt;
};
const spawn=(current,assetId,transform)=>succeeds(current,'spawn',
  {assetId,anchorId:'web-floor',transform}).objectId;
const control=(targetObjectId,label='Cycle dimensions')=>({schemaVersion:1,label,
  action:{kind:'cycle-values',channel:'transform.scale',targetObjectId,
    values:[[1,1,1],[2,3,4],[3,2,1]]}});
const editGuard=(current,objectId,expectedControl=null)=>({objectId,
  expectedControl,expectedTransform:structuredClone(current.requireObject(objectId).transform),
  expectedCreatorRevision:current.creatorMode.revision});
const setGuard=(current,objectId,descriptor,expectedControl=null)=>({
  ...editGuard(current,objectId,expectedControl),
  expectedTargetTransform:structuredClone(current.requireObject(
    descriptor.action.targetObjectId).transform)});
const activateGuard=(current,objectId)=>({
  ...editGuard(current,objectId,structuredClone(current.requireObject(objectId).control)),
  expectedControlState:structuredClone(current.controlStates[objectId]),
  expectedTargetTransform:structuredClone(current.requireObject(
    current.requireObject(objectId).control.action.targetObjectId).transform)});

test('control cycles a static target in Play, advertises one action and rejects stale replay',()=>{
  const current=world();
  const target=spawn(current,'block',pose(0,0,-3));
  const switchId=spawn(current,'pedestal',pose(2,0,-3));
  const descriptor=control(target);
  succeeds(current,'set_control',{...setGuard(current,switchId,descriptor),control:descriptor});
  assert.deepEqual(current.controlStates[switchId],{index:0,revision:0});
  assert.equal(current.snapshot().controlSchemaVersion,1);
  assert.deepEqual(current.snapshot().controlStates[switchId],{index:0,revision:0});
  assert.equal(succeeds(current,'inspect_entity',{objectId:switchId}).outcome.controlState.index,0);
  assert.deepEqual(succeeds(current,'inspect_entity',{objectId:switchId}).outcome.availableActions,[]);
  assert.equal(run(current,'activate_control',activateGuard(current,switchId)).ok,false,
    'Creator Mode cannot use the Play control');

  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-play',0);
  const inspected=succeeds(current,'inspect_entity',{objectId:switchId}).outcome;
  assert.deepEqual(inspected.availableActions,['activate_control']);
  assert.deepEqual(inspected.object.control,descriptor);
  const first=activateGuard(current,switchId);
  const activated=succeeds(current,'activate_control',first);
  assert.equal(activated.outcome.kind,'control-activated');
  assert.equal(activated.outcome.objectId,switchId);
  assert.equal(activated.outcome.targetObjectId,target);
  assert.deepEqual(activated.outcome.transform.scale,{x:2,y:3,z:4});
  assert.deepEqual(activated.outcome.controlState,{index:1,revision:1});
  assert.equal(activated.outcome.creatorHistoryCleared,true);
  assert.equal(current.requireObject(target).objectId,target);
  assert.equal(run(current,'activate_control',first).ok,false,
    'replaying an observed activation cannot cycle twice');
  assert.deepEqual(current.requireObject(target).transform.scale,{x:2,y:3,z:4});
  succeeds(current,'activate_control',activateGuard(current,switchId));
  succeeds(current,'activate_control',activateGuard(current,switchId));
  assert.deepEqual(current.requireObject(target).transform.scale,{x:1,y:1,z:1},
    'the control wraps to its first authored preset');
  assert.equal(current.controlStates[switchId].revision,3);
});

test('Creator revisions preserve compatible Play state and reject incompatible target edits',()=>{
  const current=world();
  const target=spawn(current,'block',pose(0,0,-3));
  const switchId=spawn(current,'pedestal',pose(2,0,-3));
  succeeds(current,'set_control',{...setGuard(current,switchId,control(target)),control:control(target)});
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-play',0);
  succeeds(current,'activate_control',activateGuard(current,switchId));
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-creator',1);
  assert.equal(run(current,'set_transform',{objectId:target,
    expectedTransform:pose(0,0,-3,{x:2,y:3,z:4}),
    expectedCreatorRevision:2,transform:pose(0,0,-3,{x:5,y:1,z:1})}).ok,false);
  assert.deepEqual(current.requireObject(target).transform.scale,{x:2,y:3,z:4});
  const renamed=control(target,'Change exhibit size');
  succeeds(current,'set_control',{
    ...setGuard(current,switchId,renamed,control(target)),control:renamed});
  assert.deepEqual(current.controlStates[switchId],{index:1,revision:2});
  const staleEdit={...setGuard(current,switchId,
    control(target,'Newly reviewed label'),renamed),
    control:control(target,'Newly reviewed label')};
  succeeds(current,'set_transform',{objectId:target,
    expectedTransform:pose(0,0,-3,{x:2,y:3,z:4}),
    expectedCreatorRevision:2,transform:pose(0,0,-3,{x:3,y:2,z:1})});
  assert.deepEqual(current.controlStates[switchId],{index:2,revision:3});
  assert.equal(run(current,'set_control',staleEdit).ok,false,
    'a compatible target scale change still invalidates a queued control edit');
  const before=structuredClone(current.controlStates[switchId]);
  succeeds(current,'set_transform',{objectId:target,
    expectedTransform:pose(0,0,-3,{x:3,y:2,z:1}),
    expectedCreatorRevision:2,transform:pose(.5,0,-3,{x:3,y:2,z:1})});
  assert.deepEqual(current.controlStates[switchId],before,
    'a position revision does not rewind the Play control');
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-play',2);
  assert.deepEqual(succeeds(current,'inspect_entity',{objectId:switchId}).outcome.availableActions,
    ['activate_control']);
  succeeds(current,'activate_control',activateGuard(current,switchId));
  assert.deepEqual(current.requireObject(target).transform.scale,{x:1,y:1,z:1});
});

test('control states validate before restore; undo removes authoring without rewinding Play progress',()=>{
  const current=world();
  const target=spawn(current,'block',pose(0,0,-3));
  const switchId=spawn(current,'pedestal',pose(2,0,-3));
  succeeds(current,'set_control',{...setGuard(current,switchId,control(target)),control:control(target)});
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-play',0);
  succeeds(current,'activate_control',activateGuard(current,switchId));
  const savedScene=structuredClone(current.scene);
  const savedStates=structuredClone(current.controlStates);
  assert.deepEqual(validateControlStates(savedStates,savedScene)[switchId],
    {index:1,revision:1});
  assert.throws(()=>validateControlStates({[switchId]:{index:0,revision:1}},savedScene),
    /disagrees/);
  assert.throws(()=>validateControlStates({[switchId]:savedStates[switchId],ghost:
    {index:0,revision:0}},savedScene),/do not match/);
  const recovered=world();
  recovered.validateScene(savedScene);
  recovered.scene=savedScene;
  recovered.controlStates=validateControlStates(savedStates,savedScene);
  assert.deepEqual(recovered.controlStates[switchId],{index:1,revision:1});
  assert.deepEqual(recovered.requireObject(target).transform.scale,{x:2,y:3,z:4});

  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-creator',1);
  assert.equal(run(current,'undo').ok,false,
    'a pre-Play Creator snapshot must not rewind an activated control');
  assert.deepEqual(current.requireObject(target).transform.scale,{x:2,y:3,z:4});
  assert.deepEqual(current.controlStates[switchId],{index:1,revision:1});
  succeeds(current,'remove_control',{...editGuard(current,switchId,control(target))});
  assert.equal(current.controlStates[switchId],undefined);
  succeeds(current,'undo');
  assert.deepEqual(current.controlStates[switchId],{index:1,revision:0},
    'restored authoring binds to the current scale, not an old Play tick');
  succeeds(current,'redo');
  assert.equal(current.controlStates[switchId],undefined);
  assert.deepEqual(current.requireObject(target).transform.scale,{x:2,y:3,z:4});
});

test('malformed controls, dynamic targets and unsafe deletes are rejected before mutation',()=>{
  const current=world();
  const target=spawn(current,'block',pose(0,0,-3));
  const switchId=spawn(current,'pedestal',pose(2,0,-3));
  const descriptor=control(target);
  assert.equal(validControlDescriptor(descriptor),true);
  assert.equal(validControlDescriptor({...descriptor,label:' '}),false);
  assert.equal(validControlDescriptor({...descriptor,action:{...descriptor.action,
    values:[[1,1,1],[1,1,1]]}}),false);
  assert.equal(run(current,'set_control',{...setGuard(current,switchId,descriptor),
    control:{...descriptor,action:{...descriptor.action,values:[[1,1,1],[NaN,2,3]]}}}).ok,false);
  succeeds(current,'set_control',{...setGuard(current,switchId,descriptor),control:descriptor});
  assert.equal(run(current,'delete',{objectId:target}).ok,false,
    'a target cannot be orphaned by deletion');
  assert.equal(run(current,'duplicate',{objectId:switchId}).ok,false,
    'duplicating a bound control cannot create two owners');
  const other=spawn(current,'pedestal',pose(4,0,-3));
  assert.equal(run(current,'set_control',{...setGuard(current,other,control(target,'Second control')),
    control:control(target,'Second control')}).ok,false);
  succeeds(current,'remove_control',{...editGuard(current,switchId,descriptor)});
  succeeds(current,'delete',{objectId:target});
  assert.deepEqual(current.snapshot().controlStates,{});
});

test('a control scales a static Rapier collider and rejects stale physical-room tracking',async()=>{
  const current=world();current.attachRigidPhysics(await createRigidPhysics());
  const target=spawn(current,'wall',pose(0,0,-3));
  const switchId=spawn(current,'pedestal',pose(2,0,-3));
  const rigidBody={schemaVersion:1,type:'static',collider:'bounds-box',
    restitution:0,friction:.8,sensor:false};
  succeeds(current,'set_rigid_body',{objectId:target,rigidBody});
  const descriptor={schemaVersion:1,label:'Change wall size',action:{kind:'cycle-values',
    channel:'transform.scale',targetObjectId:target,values:[[1,1,1],[2,1,1]]}};
  const unsupported={...descriptor,action:{...descriptor.action,values:[[1,1,1],[20,1,1]]}};
  assert.equal(run(current,'set_control',{
    ...setGuard(current,switchId,unsupported),control:unsupported}).ok,false,
  'a preset that cannot make a supported rigid collider is rejected at authoring');
  succeeds(current,'set_control',{...setGuard(current,switchId,descriptor),control:descriptor});
  const pickup=spawn(current,'block',pose(4,.5,-3));
  succeeds(current,'set_rigid_body',{objectId:pickup,rigidBody:{...rigidBody,type:'dynamic'}});
  assert.equal(run(current,'set_rigid_body',{objectId:target,
    rigidBody:{...rigidBody,type:'dynamic'}}).ok,false,
    'a controlled target cannot gain a competing dynamic transform owner');
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-play',0);
  const before=current.rigidPhysics.snapshot().bodies.find(body=>body.objectId===target);
  assert.equal(current.beginRigidGrab(pickup),true);
  assert.deepEqual(succeeds(current,'inspect_entity',{objectId:switchId}).outcome.availableActions,[]);
  assert.equal(run(current,'activate_control',activateGuard(current,switchId)).ok,false,
    'a second-hand control press cannot silently release a held pickup');
  assert.equal(current.rigidPhysics.state(pickup).held,true);
  assert.deepEqual(current.controlStates[switchId],{index:0,revision:0});
  current.releaseRigidGrab(pickup);
  const undoDepth=current.undo.length,solverBefore=current.rigidPhysics.snapshot();
  const restore=current.rigidPhysics.restore;
  current.rigidPhysics.restore=()=>{throw Error('collider rebuild unavailable');};
  const failed=run(current,'activate_control',activateGuard(current,switchId));
  assert.equal(failed.ok,false);
  assert.match(failed.error,/collider rebuild unavailable/);
  assert.deepEqual(current.requireObject(target).transform.scale,{x:1,y:1,z:1});
  assert.deepEqual(current.controlStates[switchId],{index:0,revision:0});
  assert.equal(current.undo.length,undoDepth,'failed activation keeps Creator history');
  assert.deepEqual(current.rigidPhysics.snapshot(),solverBefore);
  current.rigidPhysics.restore=restore;
  succeeds(current,'activate_control',activateGuard(current,switchId));
  const after=current.rigidPhysics.snapshot().bodies.find(body=>body.objectId===target);
  assert.equal(before.type,'static');assert.equal(after.type,'static');
  assert.ok(after.bounds.size.x>before.bounds.size.x);
  current.enterAR();current.setOriginUnavailable(true);
  assert.deepEqual(succeeds(current,'inspect_entity',{objectId:switchId}).outcome.availableActions,[]);
  assert.equal(run(current,'activate_control',activateGuard(current,switchId)).ok,false);
  current.rigidPhysics.dispose();
});
