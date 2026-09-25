import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixWorld} from '../src/protocol.js';
import {MatrixView} from '../src/view.js';
import {storedWorld} from '../src/scene_store.js';
import {ROOM_ANCHOR_KEY,ROOM_ARCHIVES_KEY,hasWorldToProtect,roomArchives,
  archiveAndClearRoom,archiveAndRebaseRoom} from '../src/room_origin.js';

function storage(){
  const entries=new Map();
  return {getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value),
    removeItem:key=>entries.delete(key)};
}
const transform={position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};

test('unavailable saved origin hides edits until recovery, then archive preserves the old world',()=>{
  const world=new MatrixWorld(()=> 'old-object'),local=storage();
  assert.equal(hasWorldToProtect(world),false);
  assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform}).ok,true);
  assert.equal(hasWorldToProtect(world),true);
  const before=storedWorld(world);
  local.setItem(ROOM_ANCHOR_KEY,'old-anchor-handle');
  world.enterAR();world.setOriginUnavailable(true);
  assert.equal(world.snapshot().readOnly,true);
  assert.equal(world.snapshot().roomContext.state,'missing');
  assert.equal(world.execute({requestId:'clear',op:'clear'}).ok,false);
  assert.equal(world.execute({requestId:'confirm',op:'confirm_room'}).ok,false);
  const archive=archiveAndClearRoom(world,local);
  assert.equal(archive.anchorHandle,'old-anchor-handle');
  assert.deepEqual(archive.world,before);
  assert.equal(roomArchives(local).length,1);
  assert.equal(local.getItem(ROOM_ANCHOR_KEY),null);
  assert.equal(world.scene.objects.length,0);
  assert.equal(world.snapshot().readOnly,true,'new room stays read-only until its anchor is tracked');
  world.setOriginUnavailable(false);
  assert.equal(world.snapshot().readOnly,undefined);
  world.leaveAR();
  assert.equal(world.scene.objects.length,0);
});

test('an AR session with saved objects but no anchor handle does not create a new origin silently',()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=storage();
  try{
    const world=new MatrixWorld(()=> 'old-object');
    world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform});
    world.enterAR();
    const view={world,isAR:true,roomAnchorRestoreFailed:false,virtualFloorRoot:new THREE.Group(),
      onAssetError(){},onRuntimeChange(){},
      markRoomOriginUnavailable(message){MatrixView.prototype.markRoomOriginUnavailable.call(this,message);}};
    MatrixView.prototype.restoreRoomAnchor.call(view,{});
    assert.equal(view.roomAnchorRestoreFailed,true);
    assert.equal(view.virtualFloorRoot.visible,false);
    assert.equal(world.snapshot().readOnly,true);
    assert.equal(world.scene.objects.length,1);
  }finally{
    if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;
  }
});

test('failed archive write leaves the old room and anchor intact',()=>{
  const world=new MatrixWorld(()=> 'old-object');
  world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform});
  world.enterAR();world.setOriginUnavailable(true);
  const old=storedWorld(world);
  const local={getItem:key=>key===ROOM_ANCHOR_KEY?'old-anchor-handle':null,
    setItem(){throw Error('quota exceeded');},removeItem(){throw Error('must not remove anchor');}};
  assert.throws(()=>archiveAndClearRoom(world,local),/quota exceeded/);
  assert.deepEqual(storedWorld(world),old);
  assert.equal(world.snapshot().readOnly,true);
});

test('explicit rebase archives the old binding while keeping world objects hidden until tracked',()=>{
  const world=new MatrixWorld(()=> 'old-object'),local=storage();
  world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform});
  const before=storedWorld(world);
  local.setItem(ROOM_ANCHOR_KEY,'old-anchor-handle');
  world.enterAR();world.setOriginUnavailable(true);
  archiveAndRebaseRoom(world,local);
  assert.deepEqual(storedWorld(world),before);
  assert.equal(world.snapshot().readOnly,true);
  assert.equal(roomArchives(local)[0].anchorHandle,'old-anchor-handle');
  assert.equal(local.getItem(ROOM_ANCHOR_KEY),null);
  world.setOriginUnavailable(false);
  world.leaveAR();
  assert.deepEqual(storedWorld(world),before);
});

test('invalid or full recovery archive cannot be overwritten by a reset',()=>{
  const world=new MatrixWorld();world.enterAR();world.setOriginUnavailable(true);
  const local=storage();local.setItem(ROOM_ARCHIVES_KEY,'{invalid');
  assert.throws(()=>archiveAndClearRoom(world,local),/archive is invalid/);
  assert.equal(local.getItem(ROOM_ARCHIVES_KEY),'{invalid');
  local.removeItem(ROOM_ARCHIVES_KEY);
  for(let index=0;index<3;index++)archiveAndClearRoom(world,local);
  assert.equal(roomArchives(local).length,3);
  assert.throws(()=>archiveAndClearRoom(world,local),/Three room recovery archives/);
});

test('room reset refuses to discard session-only objects that the archive cannot restore',()=>{
  const world=new MatrixWorld();world.enterAR();world.setOriginUnavailable(true);
  world.scene.objects.push({objectId:'physical',assetId:'orb',anchorId:'webxr-plane-1',transform});
  const local=storage();local.setItem(ROOM_ANCHOR_KEY,'old-anchor-handle');
  assert.throws(()=>archiveAndClearRoom(world,local),/Session-only physical objects cannot be archived/);
  assert.equal(local.getItem(ROOM_ANCHOR_KEY),'old-anchor-handle');
  assert.equal(world.scene.objects.length,1);
});

test('loss of a tracked room pose immediately hides the world and restores it only after tracking returns',()=>{
  const world=new MatrixWorld();world.enterAR();
  const root=new THREE.Group();let updates=0;
  const view={roomAnchor:{anchorSpace:{}},isAR:true,roomPoseMissingSince:0,
    roomAnchorLocated:true,roomAnchorRestoreFailed:false,virtualFloorRoot:root,world,
    onRuntimeChange(){updates++;},onAssetError(){}};
  MatrixView.prototype.updateRoomAnchor.call(view,{getPose:()=>null},{});
  assert.equal(root.visible,false);
  assert.equal(world.snapshot().readOnly,true);
  assert.equal(updates,1);
  view.roomPoseMissingSince=performance.now()-11000;
  MatrixView.prototype.updateRoomAnchor.call(view,{getPose:()=>null},{});
  assert.equal(view.roomAnchorRestoreFailed,true);
  MatrixView.prototype.updateRoomAnchor.call(view,{getPose:()=>({transform:{
    position:{x:1,y:0,z:2},orientation:{x:0,y:0,z:0,w:1}}})},{});
  assert.equal(root.visible,true);
  assert.equal(view.roomAnchorLocated,true);
  assert.equal(view.roomAnchorRestoreFailed,false);
  assert.equal(world.snapshot().readOnly,undefined);
});
