import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixWorld} from '../src/protocol.js';
import {MatrixView} from '../src/view.js';
import {storedWorld,storedBrowserWorld,saveStoredWorld,loadStoredWorld,restoreStoredWorld,
  saveCheckpoint,loadCheckpoint} from '../src/scene_store.js';
import {ROOM_ANCHOR_KEY,ROOM_ARCHIVES_KEY,hasWorldToProtect,roomArchives,
  archiveAndClearRoom,archiveAndRebaseRoom,clearRoomArchives} from '../src/room_origin.js';

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
  assert.throws(()=>restoreStoredWorld(world,{version:2,scene:{...before.scene,objects:[]},game:null}),
    /Saved room origin is unavailable/);
  assert.equal(world.scene.objects.length,1,'checkpoint restore did not replace the protected world');
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

test('a passive AR preview with only a session anchor stays virtual after browser reopen',()=>{
  const prior=globalThis.localStorage,local=storage(),tab=storage();globalThis.localStorage=local;
  try{
    const world=new MatrixWorld(()=> 'vr-object');
    assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform}).ok,true);
    world.enterAR();
    let updates=0;
    const view={world,isAR:true,virtualFloorRoot:new THREE.Group(),anchorRoots:new Map(),
      roomAnchor:null,roomAnchorLocated:false,roomAnchorRestoreFailed:false,roomPoseMissingSince:0,
      onRuntimeChange(){updates++;}};
    MatrixView.prototype.restoreRoomAnchor.call(view,{});
    assert.equal(view.virtualFloorRoot.visible,true);
    assert.equal(world.snapshot().readOnly,undefined);
    view.roomAnchor={anchorSpace:{}}; // Session-only: no persistent handle was returned.
    MatrixView.prototype.updateRoomAnchor.call(view,{getPose:()=>({transform:{
      position:{x:1,y:0,z:2},orientation:{x:0,y:0,z:0,w:1}}})},{});
    assert.equal(world.originBinding,'virtual');
    assert.equal(updates,0,'a passive preview does not force a save or bind the world');
    assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,local),'');
    const saved=loadStoredWorld(tab,local).value;
    assert.equal(saved.originBinding,'virtual');
    const reopened=new MatrixWorld();restoreStoredWorld(reopened,saved);reopened.enterAR();
    const reopenedView={world:reopened,isAR:true,virtualFloorRoot:new THREE.Group(),anchorRoots:new Map()};
    MatrixView.prototype.restoreRoomAnchor.call(reopenedView,{});
    assert.equal(reopenedView.virtualFloorRoot.visible,true);
    assert.equal(reopened.snapshot().readOnly,undefined);
  }finally{
    if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;
  }
});

test('an ambiguous legacy world ignores an unrelated saved handle and requires explicit recovery',()=>{
  const prior=globalThis.localStorage,local=storage();
  local.setItem(ROOM_ANCHOR_KEY,'unrelated-room-handle');globalThis.localStorage=local;
  try{
    const original=new MatrixWorld(()=> 'old-object');
    original.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform});
    const world=new MatrixWorld();restoreStoredWorld(world,storedWorld(original));
    assert.equal(world.originBinding,'unknown');
    world.enterAR();
    let restores=0;
    const session={restorePersistentAnchor(){restores++;return Promise.resolve({anchorSpace:{}});}};
    const view={world,isAR:true,roomAnchorRestoreFailed:false,virtualFloorRoot:new THREE.Group(),
      renderer:{xr:{getSession:()=>session}},
      onAssetError(){},onRuntimeChange(){},
      markRoomOriginUnavailable(message){MatrixView.prototype.markRoomOriginUnavailable.call(this,message);}};
    MatrixView.prototype.restoreRoomAnchor.call(view,session);
    assert.equal(restores,0,'an unrelated handle is never restored automatically');
    assert.equal(view.roomAnchorHandleAvailable,false,'Retry cannot loop on an unknown binding');
    assert.equal(MatrixView.prototype.retryRoomOrigin.call(view),false);
    assert.equal(local.getItem(ROOM_ANCHOR_KEY),'unrelated-room-handle','archive choice retains the handle');
    assert.equal(view.roomAnchorRestoreFailed,true);
    assert.equal(view.virtualFloorRoot.visible,false);
    assert.equal(world.snapshot().readOnly,true);
    assert.equal(world.scene.objects.length,1);
    const archive=archiveAndRebaseRoom(world,local);
    assert.equal(archive.anchorHandle,'unrelated-room-handle');
    assert.equal(local.getItem(ROOM_ANCHOR_KEY),null);
    assert.equal(world.originBinding,'ar');
    assert.equal(world.snapshot().readOnly,true);
  }finally{
    if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;
  }
});

test('an AR scene edit without a persistent handle binds the browser world and locks reopen',()=>{
  const prior=globalThis.localStorage,local=storage(),tab=storage(),manual=storage();globalThis.localStorage=local;
  try{
    const world=new MatrixWorld(()=> 'ar-object');
    world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform});
    world.enterAR();
    let updates=0;
    const view={world,isAR:true,roomAnchor:{anchorSpace:{}},roomAnchorLocated:false,
      roomAnchorRestoreFailed:false,roomPoseMissingSince:0,virtualFloorRoot:new THREE.Group(),
      anchorRoots:new Map(),onRuntimeChange(){updates++;}};
    MatrixView.prototype.updateRoomAnchor.call(view,{getPose:()=>({transform:{
      position:{x:1,y:0,z:2},orientation:{x:0,y:0,z:0,w:1}}})},{});
    assert.equal(view.roomAnchorLocated,true);
    assert.equal(world.originBinding,'virtual');
    assert.equal(updates,0);
    const moved=structuredClone(transform);moved.position.x=.4;
    assert.equal(world.execute({requestId:'ar-edit',op:'set_transform',objectId:'ar-object',transform:moved}).ok,true);
    const browserWorld=storedBrowserWorld(world);
    assert.equal(browserWorld.originBinding,'ar','the changed AR scene is now room-bound');
    assert.equal(saveStoredWorld(browserWorld,tab,local),'');
    assert.equal(saveCheckpoint(browserWorld.scene,browserWorld.game,manual,browserWorld.originBinding),'');
    assert.equal(loadCheckpoint(manual).originBinding,'ar','manual browser checkpoint carries provenance');
    const reopened=new MatrixWorld();restoreStoredWorld(reopened,loadStoredWorld(tab,local).value);
    assert.equal(reopened.originBinding,'ar');
    reopened.enterAR();
    const reopenedView={world:reopened,isAR:true,roomAnchorRestoreFailed:false,
      virtualFloorRoot:new THREE.Group(),anchorRoots:new Map(),
      onAssetError(){},onRuntimeChange(){},
      markRoomOriginUnavailable(message){MatrixView.prototype.markRoomOriginUnavailable.call(this,message);}};
    MatrixView.prototype.restoreRoomAnchor.call(reopenedView,{});
    assert.equal(reopenedView.virtualFloorRoot.visible,false);
    assert.equal(reopened.snapshot().readOnly,true);
  }finally{
    if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;
  }
});

test('AR game progress binds a previously virtual world even without a handle',()=>{
  const world=new MatrixWorld();world.game={state:{score:0}};world.enterAR();
  assert.equal(storedBrowserWorld(world).originBinding,'virtual');
  world.game.state.score=1;
  assert.equal(storedBrowserWorld(world).originBinding,'ar');
});

test('a verified persistent anchor handle binds a passive preview and restores it at its pose',async()=>{
  const priorStorage=globalThis.localStorage,priorTransform=globalThis.XRRigidTransform;
  const local=storage();globalThis.localStorage=local;
  globalThis.XRRigidTransform=class {constructor(position,orientation){this.position=position;this.orientation=orientation;}};
  try{
    const world=new MatrixWorld(()=> 'persisted-object');
    world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform});
    world.enterAR();
    const session={},anchor={anchorSpace:{},requestPersistentHandle:async()=> 'saved-room-handle'};
    let saves=0;
    const view={world,isAR:true,roomAnchor:null,roomAnchorPending:false,
      roomAnchorCreationFailed:false,roomAnchorRestoreFailed:false,
      xrViewer:{position:new THREE.Vector3(0,1.7,0),direction:new THREE.Vector3(0,0,-1)},
      virtualFloorRoot:new THREE.Group(),renderer:{xr:{getSession:()=>session}},
      onRuntimeChange(){saves++;},onAssetError(){}};
    MatrixView.prototype.createRoomAnchor.call(view,{session,createAnchor:()=>Promise.resolve(anchor)}, {},0);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(local.getItem(ROOM_ANCHOR_KEY),'saved-room-handle');
    assert.equal(view.roomAnchorPersistent,true);
    assert.equal(world.originBinding,'ar');
    assert.equal(saves,1,'new binding is persisted before a browser reopen');

    const reopened=new MatrixWorld();restoreStoredWorld(reopened,storedBrowserWorld(world));reopened.enterAR();
    let restores=0;
    const restoreSession={restorePersistentAnchor:async handle=>{
      restores++;assert.equal(handle,'saved-room-handle');return anchor;}};
    const reopenedView={world:reopened,isAR:true,roomAnchorRestoreFailed:false,
      virtualFloorRoot:new THREE.Group(),anchorRoots:new Map(),
      renderer:{xr:{getSession:()=>restoreSession}},onRuntimeChange(){},onAssetError(){}};
    MatrixView.prototype.restoreRoomAnchor.call(reopenedView,restoreSession);
    assert.equal(reopenedView.virtualFloorRoot.visible,false);
    assert.equal(reopened.snapshot().readOnly,true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(restores,1);
    assert.equal(reopenedView.roomAnchor,anchor);
    MatrixView.prototype.updateRoomAnchor.call(reopenedView,{getPose:()=>({transform:{
      position:{x:1,y:0,z:2},orientation:{x:0,y:0,z:0,w:1}}})},{});
    assert.equal(reopenedView.virtualFloorRoot.visible,true);
    assert.equal(reopened.snapshot().readOnly,undefined);
  }finally{
    if(priorStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=priorStorage;
    if(priorTransform===undefined)delete globalThis.XRRigidTransform;else globalThis.XRRigidTransform=priorTransform;
  }
});

test('VR ignores a saved AR room anchor and keeps its virtual floor origin',async()=>{
  const prior=globalThis.localStorage,local=storage();
  local.setItem(ROOM_ANCHOR_KEY,'ar-room-handle');globalThis.localStorage=local;
  try{
    const root=new THREE.Group();root.position.set(0,0,0);
    const anchor={anchorSpace:{}};let restores=0,poses=0;
    const session={restorePersistentAnchor:async handle=>{restores++;assert.equal(handle,'ar-room-handle');return anchor;}};
    const view={isAR:false,roomAnchor:null,virtualFloorRoot:root,
      renderer:{xr:{getSession:()=>session}},world:new MatrixWorld(),onRuntimeChange(){}};
    MatrixView.prototype.restoreRoomAnchor.call(view,session);
    await Promise.resolve();
    assert.equal(restores,0,'VR does not restore the physical AR anchor');
    assert.equal(view.roomAnchor,null);
    view.roomAnchor=anchor; // Even a stale anchor must not move the VR floor.
    MatrixView.prototype.updateRoomAnchor.call(view,{getPose(){poses++;return {transform:{
      position:{x:3,y:1,z:4},orientation:{x:0,y:0,z:0,w:1}}};}},{});
    assert.equal(poses,0);
    assert.deepEqual(root.position.toArray(),[0,0,0]);
  }finally{
    if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;
  }
});

test('leaving an empty AR world lets later VR content remain explicitly unbound',()=>{
  const world=new MatrixWorld(()=> 'later-vr-object');
  world.enterAR();world.originBinding='ar';world.leaveAR();
  assert.equal(world.originBinding,'virtual');
  assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'orb',
    anchorId:'web-floor',transform}).ok,true);
  assert.equal(storedBrowserWorld(world).originBinding,'virtual');
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
  clearRoomArchives(local);
  assert.deepEqual(roomArchives(local),[]);
  archiveAndClearRoom(world,local);
  assert.equal(roomArchives(local).length,1);
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

test('pose loss hides measured-surface objects even after scene sync, then reveals them on recovery',()=>{
  const world=new MatrixWorld();world.enterAR();
  const anchor={anchorId:'table-plane',displayName:'TABLE',semanticLabels:['TABLE'],
    roomPose:{position:{x:0,y:1,z:-2},rotation:{x:0,y:0,z:0}},
    surface:{kind:'support',boundary:[{x:-1,y:0,z:-1},{x:1,y:0,z:-1},{x:1,y:0,z:1},{x:-1,y:0,z:1}]}};
  world.setSpatialAnchors([anchor]);
  world.scene.objects.push({objectId:'measured-object',assetId:'orb',anchorId:'table-plane',transform});
  const view=Object.create(MatrixView.prototype);
  view.world=world;view.isAR=true;view.scene=new THREE.Scene();view.virtualFloorRoot=new THREE.Group();
  view.scene.add(view.virtualFloorRoot);view.anchorRoots=new Map();view.objectRoots=new Map();
  const outline=new THREE.Group();view.scene.add(outline);view.planeOutlines=new Map([['table-plane',outline]]);
  view.highlight=()=>{};view.onRuntimeChange=()=>view.sync();view.onAssetError=()=>{};
  view.roomAnchor={anchorSpace:{}};view.roomAnchorLocated=true;view.roomPoseMissingSince=0;
  view.roomAnchorRestoreFailed=false;
  view.sync();
  assert.equal(view.anchorRoots.get('table-plane').parent,view.scene);
  assert.equal(view.objectRoots.get('measured-object').parent,view.anchorRoots.get('table-plane'));
  MatrixView.prototype.updateRoomAnchor.call(view,{getPose:()=>null},{});
  assert.equal(view.anchorRoots.get('table-plane').visible,false);
  assert.equal(view.virtualFloorRoot.visible,false);
  assert.equal(outline.visible,true,'live support outline stays visible for alignment');
  assert.equal(world.snapshot().readOnly,true);
  view.raycaster={intersectObjects(){throw Error('hidden objects should not be raycast');}};
  assert.equal(view.selectFromRay(),null);
  assert.equal(view.pointingTarget(),null);
  MatrixView.prototype.updateRoomAnchor.call(view,{getPose:()=>({transform:{
    position:{x:1,y:0,z:2},orientation:{x:0,y:0,z:0,w:1}}})},{});
  assert.equal(view.anchorRoots.get('table-plane').visible,true);
  assert.equal(view.virtualFloorRoot.visible,true);
  assert.equal(world.snapshot().readOnly,undefined);
});
