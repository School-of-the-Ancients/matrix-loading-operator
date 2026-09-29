import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixWorld} from '../src/protocol.js';
import {MatrixView} from '../src/view.js';
import {adjustedARLayoutOffset,checkedARLayoutOffset,composeARLayoutPose} from '../src/ar_layout.js';
import {storedWorld,storedBrowserWorld,saveStoredWorld,loadStoredWorld,
  restoreStoredWorld,saveCheckpoint,loadCheckpoint} from '../src/scene_store.js';
import {ROOM_ANCHOR_KEY,archiveAndRebaseRoom,roomArchives} from '../src/room_origin.js';

function storage(){
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),
    removeItem:key=>values.delete(key)};
}
const transform={position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}};
const anchorPose={transform:{position:{x:1,y:0,z:2},
  orientation:{x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2}}};

test('whole-layout steps compose with the tracked anchor, with bounded yaw and translation',()=>{
  const root=new THREE.Group();
  const offset=adjustedARLayoutOffset({x:0,z:0,yawDegrees:0},'layout-right');
  assert.deepEqual(offset,{x:.25,z:0,yawDegrees:0});
  composeARLayoutPose(root,anchorPose,offset);
  assert.ok(Math.abs(root.position.x-1)<1e-6);
  assert.ok(Math.abs(root.position.z-1.75)<1e-6,
    'anchor yaw rotates the saved local translation into the room');
  const turned=adjustedARLayoutOffset(offset,'layout-turn-left');
  assert.deepEqual(turned,{x:.25,z:0,yawDegrees:15});
  composeARLayoutPose(root,anchorPose,turned);
  const expected=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),
    THREE.MathUtils.degToRad(105));
  assert.ok(Math.abs(root.quaternion.dot(expected))>1-1e-6);
  assert.deepEqual(adjustedARLayoutOffset({x:0,z:0,yawDegrees:0},'layout-forward'),
    {x:0,z:-.25,yawDegrees:0});
  assert.throws(()=>checkedARLayoutOffset({x:11,z:0,yawDegrees:0}),/Invalid saved/);
  assert.throws(()=>adjustedARLayoutOffset({x:10,z:0,yawDegrees:0},'layout-right'),
    /Invalid saved/);
});

test('AR layout adjustment invalidates pins and room approval, then survives Exit AR and reopen',()=>{
  const previousStorage=globalThis.localStorage,local=storage(),tab=storage();
  globalThis.localStorage=local;local.setItem(ROOM_ANCHOR_KEY,'handle-1');
  try{
    const world=new MatrixWorld(()=> 'same-object');
    assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'orb',
      anchorId:'web-floor',transform}).ok,true);
    const digitalBefore=storedWorld(world);
    world.originBinding='ar';world.originAnchorHandle='handle-1';world.enterAR();
    world.setOriginLocated(true);
    world.spatial.alignmentVerified=true;
    world.spatial.layoutReviewPending=false;
    world.spatial.anchors=[{surface:{kind:'support'}}];
    world.selectedPlacement={anchorId:'web-floor',position:{x:0,y:0,z:-1}};
    let cleared=0,saved=0;
    const view={world,isAR:true,readOnly:false,roomAnchorLocated:true,
      roomAnchorPersistent:true,roomAnchorPose:anchorPose,roomTrackingEpoch:4,
      lastPlaneObservedAt:performance.now(),virtualFloorRoot:new THREE.Group(),
      clearSelectedPoint(){cleared++;world.selectedPlacement=null;},
      onRuntimeChange(){saved++;}};
    const offset=MatrixView.prototype.adjustARLayout.call(view,'layout-right');
    assert.deepEqual(offset,{x:.25,z:0,yawDegrees:0});
    assert.equal(view.roomTrackingEpoch,5);
    assert.equal(cleared,1);
    assert.equal(world.selectedPlacement,null);
    assert.equal(world.spatial.alignmentVerified,false);
    assert.equal(world.spatial.layoutReviewPending,true);
    assert.equal(saved,1);
    assert.ok(Math.abs(view.virtualFloorRoot.position.z-1.75)<1e-6);
    assert.deepEqual(storedWorld(world),digitalBefore,
      'layout placement must not rewrite object IDs or local transforms');
    assert.match(world.execute({requestId:'too-early',op:'confirm_room'}).error,
      /Review digital layout clearance/);
    MatrixView.prototype.confirmARLayoutReview.call(view);
    assert.equal(world.spatial.layoutReviewPending,false);
    world.setSpatialObservation({planeObservedAt:performance.now(),
      trackingEpoch:view.roomTrackingEpoch,webFloorPose:world.spatial.webFloorPose});
    assert.equal(world.execute({requestId:'confirm',op:'confirm_room'}).ok,true);
    assert.throws(()=>world.assertCurrentRoomConstraint(
      {anchorId:'old-shelf',trackingEpoch:4},'old-shelf'),/changed or is stale/);
    assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,local),'');
    assert.deepEqual(loadStoredWorld(tab,local).value.arLayoutOffset,offset);
    world.leaveAR();
    assert.deepEqual(world.arLayoutOffset,offset);
    assert.deepEqual(storedWorld(world),digitalBefore);
    const reopened=new MatrixWorld();
    restoreStoredWorld(reopened,loadStoredWorld(tab,local).value);
    assert.deepEqual(reopened.arLayoutOffset,offset);
    assert.equal(reopened.originAnchorHandle,'handle-1');
    assert.deepEqual(storedWorld(reopened),digitalBefore);
    reopened.enterAR();
    assert.equal(reopened.spatial.layoutReviewPending,true,
      'a new AR session must review physical clearance again');
    const restoredView={world:reopened,isAR:true,roomAnchor:{anchorSpace:{}},
      roomAnchorLocated:false,roomAnchorRestoredHandle:'handle-1',
      roomPoseMissingSince:0,roomTrackingEpoch:1,virtualFloorRoot:new THREE.Group(),
      anchorRoots:new Map(),onRuntimeChange(){}};
    MatrixView.prototype.updateRoomAnchor.call(restoredView,
      {getPose:()=>anchorPose},{});
    assert.ok(Math.abs(restoredView.virtualFloorRoot.position.z-1.75)<1e-6);
    assert.equal(reopened.spatial.webFloorPose.position.z,1.75,
      'typed placement observes the composed root pose after reopen');
  }finally{
    if(previousStorage===undefined)delete globalThis.localStorage;
    else globalThis.localStorage=previousStorage;
  }
});

test('room recovery preserves the old offset in the archive but starts the new anchor at zero',()=>{
  const world=new MatrixWorld(()=> 'same-object'),local=storage();
  assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'orb',
    anchorId:'web-floor',transform}).ok,true);
  world.originBinding='ar';world.originAnchorHandle='old-handle';
  world.arLayoutOffset={x:1,z:-.5,yawDegrees:30};
  const scene=storedWorld(world);
  world.enterAR();world.setOriginUnavailable(true);
  const archive=archiveAndRebaseRoom(world,local);
  assert.deepEqual(archive.arLayoutOffset,{x:1,z:-.5,yawDegrees:30});
  assert.equal(archive.anchorHandle,'old-handle');
  assert.deepEqual(roomArchives(local)[0].arLayoutOffset,archive.arLayoutOffset);
  assert.deepEqual(world.arLayoutOffset,{x:0,z:0,yawDegrees:0});
  assert.equal(world.spatial.layoutReviewPending,true);
  assert.deepEqual(storedWorld(world),scene);
});

test('manual browser checkpoint retains only anchor-bound layout and rejects forged provenance',()=>{
  const world=new MatrixWorld(()=> 'same-object'),manual=storage(),durable=storage();
  assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'orb',
    anchorId:'web-floor',transform}).ok,true);
  world.originBinding='ar';world.originAnchorHandle='handle-1';
  world.arLayoutOffset={x:.5,z:-.25,yawDegrees:15};
  const value=storedBrowserWorld(world);
  assert.equal(saveCheckpoint(value.scene,value.game,manual,value.originBinding,
    value.originAnchorHandle,value.citizens??null,value.creatorMode,value.rigidGravity,
    value.controlStates,value.rigidMotion,value.arLayoutOffset),'');
  assert.deepEqual(loadCheckpoint(manual).arLayoutOffset,world.arLayoutOffset);
  const restored=new MatrixWorld();
  restoreStoredWorld(restored,loadCheckpoint(manual));
  assert.equal(restored.scene.objects[0].objectId,'same-object');
  assert.deepEqual(restored.arLayoutOffset,world.arLayoutOffset);
  assert.equal(saveStoredWorld({...value,originAnchorHandle:undefined},durable,durable)
    .includes('could not be serialized'),true);
  const {originAnchorHandle,...unbound}=value;
  assert.throws(()=>restoreStoredWorld(new MatrixWorld(),
    {...unbound,originBinding:'virtual'}),/Saved AR layout has no verified room anchor/);
  assert.deepEqual(storedWorld(world),storedWorld(restored));
});

test('Exit AR keeps a placed environment-only world bound to its room',()=>{
  const world=new MatrixWorld();
  world.scene.environment={assetId:'panorama-test',sha256:'placeholder',yawDegrees:0};
  world.originBinding='ar';world.originAnchorHandle='handle-1';
  world.arLayoutOffset={x:.25,z:0,yawDegrees:0};
  world.enterAR();world.leaveAR();
  assert.equal(world.originBinding,'ar');
  assert.equal(world.originAnchorHandle,'handle-1');
  assert.deepEqual(world.arLayoutOffset,{x:.25,z:0,yawDegrees:0});
});

test('restoring another browser layout during AR invalidates the old root and epoch',()=>{
  const previousStorage=globalThis.localStorage,local=storage();
  globalThis.localStorage=local;local.setItem(ROOM_ANCHOR_KEY,'handle-1');
  try{
    const world=new MatrixWorld(()=> 'same-object');
    assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'orb',
      anchorId:'web-floor',transform}).ok,true);
    world.originBinding='ar';world.originAnchorHandle='handle-1';
    const oldCheckpoint=storedBrowserWorld(world);
    world.enterAR();world.setOriginLocated(true);
    const view={world,isAR:true,readOnly:false,roomAnchorLocated:true,
      roomAnchorPersistent:true,roomAnchorPose:anchorPose,roomTrackingEpoch:1,
      lastPlaneObservedAt:performance.now(),virtualFloorRoot:new THREE.Group(),
      clearSelectedPoint(){world.selectedPlacement=null;},onRuntimeChange(){}};
    MatrixView.prototype.adjustARLayout.call(view,'layout-right');
    const nudgedEpoch=view.roomTrackingEpoch;
    assert.deepEqual(world.arLayoutOffset,{x:.25,z:0,yawDegrees:0});
    world.spatial.layoutReviewPending=false;world.spatial.alignmentVerified=true;
    restoreStoredWorld(world,oldCheckpoint);
    assert.equal(MatrixView.prototype.refreshARLayoutFromWorld.call(view),true);
    assert.equal(view.roomTrackingEpoch,nudgedEpoch+1);
    assert.equal(world.spatial.layoutReviewPending,true);
    assert.equal(world.spatial.alignmentVerified,false);
    assert.ok(Math.abs(view.virtualFloorRoot.position.z-2)<1e-6);
  }finally{
    if(previousStorage===undefined)delete globalThis.localStorage;
    else globalThis.localStorage=previousStorage;
  }
});
