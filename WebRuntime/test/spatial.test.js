import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixWorld} from '../src/protocol.js';
import {MatrixView,validateRenderedFootprint} from '../src/view.js';
import {storedWorld,storedBrowserWorld,saveStoredWorld,loadStoredWorld,
  restoreStoredWorld,restoreBestStoredWorld} from '../src/scene_store.js';
import {viewerPose,planeData,insideBoundary,footprintInsideBoundary,
  footprintFitsRoomSupport,volumeIntersectsMeasuredPlane,
  matchPlaneAnchor,samePlaneShape,measuredFloorHeight} from '../src/spatial.js';

const boundary=[{x:-2,y:0,z:-2},{x:2,y:0,z:-2},{x:2,y:0,z:2},{x:-2,y:0,z:2}];
const anchor={anchorId:'webxr-plane-1',displayName:'FLOOR',source:'webxr',semanticLabels:['FLOOR'],
  surface:{kind:'support',boundary},roomPose:{position:{x:1,y:0,z:-1},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}};
const transform={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
const storage=()=>{const values=new Map();return {
  getItem:key=>values.get(key)||null,
  setItem:(key,value)=>values.set(key,value),
  removeItem:key=>values.delete(key)};};

test('AR scene uses session room planes, confirms alignment, and restores the desktop scene',()=>{
  let next=0;const world=new MatrixWorld(()=>`id-${++next}`);
  const virtual=world.execute({requestId:'preview',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:{...transform,position:{x:0,y:0,z:-2}}});
  assert.equal(virtual.ok,true);
  const desktop=structuredClone(world.scene);
  world.enterAR();world.setSpatialAnchors([{...anchor,anchorId:'webxr-plane-table',displayName:'TABLE',semanticLabels:['TABLE']},anchor]);
  assert.equal(world.snapshot().roomContext.mode,'ar');
  assert.equal(world.snapshot().selection.anchorId,'web-floor');
  assert.equal(world.snapshot().scene.objects[0].objectId,virtual.objectId);
  world.setSelection('',{x:0,y:0,z:0},anchor.anchorId);
  assert.match(world.execute({requestId:'before',op:'spawn',assetId:'orb',anchorId:anchor.anchorId,placement:'surface',transform}).error,/Confirm .*room alignment/);
  assert.match(world.execute({requestId:'origin-missing',op:'confirm_room'}).error,/tracked room origin/);
  world.setOriginLocated(true);
  world.setSpatialObservation({planeObservedAt:performance.now()-2100});
  assert.match(world.execute({requestId:'stale-plane-confirm',op:'confirm_room'}).error,
    /measured support surface/);
  assert.equal(world.snapshot().roomContext.alignmentVerified,false);
  world.setSpatialObservation({planeObservedAt:performance.now()});
  assert.equal(world.execute({requestId:'confirm',op:'confirm_room'}).ok,true);
  world.spatial.planeObservedAt=performance.now()-2100;
  assert.equal(world.snapshot().roomContext.alignmentVerified,false);
  assert.match(world.execute({requestId:'stale-plane-place',op:'spawn',assetId:'orb',
    anchorId:anchor.anchorId,placement:'surface',transform}).error,/measured planes/);
  assert.equal(world.scene.objects.length,1,'stale measured placement leaves the scene untouched');
  world.setSpatialObservation({planeObservedAt:performance.now()});
  const placed=world.execute({requestId:'place',op:'spawn',assetId:'orb',anchorId:anchor.anchorId,placement:'surface',transform});
  assert.equal(placed.ok,true);
  assert.equal(world.snapshot().scene.objects[1].anchorId,anchor.anchorId);
  assert.equal(world.snapshot().scene.objects[1].transform.position.y,0);
  assert.match(world.execute({requestId:'outside',op:'spawn',assetId:'orb',anchorId:anchor.anchorId,placement:'surface',transform:{...transform,position:{x:1.9,y:0,z:0}}}).error,/footprint/);
  world.setSpatialAnchors([]);
  assert.equal(world.snapshot().readOnly,true);
  assert.equal(world.snapshot().roomContext.state,'missing');
  world.leaveAR();assert.deepEqual(world.scene,desktop);
  assert.equal(world.snapshot().roomContext.mode,'white-room');
});

test('measured AR move keeps the panorama and object identities in the same world',()=>{
  let next=0;const world=new MatrixWorld(()=>`integrated-${++next}`);
  const digest='b'.repeat(64);
  const asset={assetId:`panorama:forest:${digest.slice(0,12)}`,
    displayName:'Forest',sha256:digest,byteLength:2048,width:4,height:2,
    format:'png',url:`/api/web/environments/${digest}.png`};
  world.registerEnvironmentAssets([asset]);
  const panorama={schemaVersion:1,kind:'equirectangular',
    assetId:asset.assetId,sha256:digest,yawDegrees:45};
  const applied=world.execute({requestId:'integrated-panorama',op:'set_environment',
    roomId:world.scene.roomId,expectedEnvironment:null,environment:panorama});
  assert.equal(applied.ok,true,applied.error);
  const spawned=world.execute({requestId:'integrated-spawn',op:'spawn',
    assetId:'orb',anchorId:'web-floor',transform});
  assert.equal(spawned.ok,true,spawned.error);
  world.enterAR();world.setSpatialAnchors([anchor]);world.setOriginLocated(true);
  world.setSpatialObservation({planeObservedAt:performance.now(),trackingEpoch:2,
    webFloorPose:anchor.roomPose});
  assert.equal(world.execute({requestId:'integrated-confirm',op:'confirm_room'}).ok,true);
  const before=world.snapshot();
  assert.deepEqual(before.scene.environment,panorama);
  assert.equal(before.spatialObservation.trackingEpoch,2);
  const moved=world.execute({requestId:'integrated-move',op:'set_transform',
    objectId:spawned.objectId,transform:{...transform,position:{x:.5,y:0,z:0}},
    roomConstraint:{anchorId:anchor.anchorId,trackingEpoch:2}});
  assert.equal(moved.ok,true,moved.error);
  assert.equal(world.scene.objects[0].objectId,spawned.objectId);
  assert.deepEqual(world.scene.environment,panorama);
  world.leaveAR();
  assert.deepEqual(world.scene.environment,panorama);
  assert.equal(world.scene.objects[0].objectId,spawned.objectId);
  assert.equal(world.snapshot().spatialObservation,undefined);
});

test('queued surface spawn rejects a changed tracking epoch or lost room observation',()=>{
  let sequence=0;
  const world=new MatrixWorld(()=>`surface-${++sequence}`);
  world.enterAR();world.setSpatialAnchors([anchor]);world.setOriginLocated(true);
  const observe=epoch=>world.setSpatialObservation({planeObservedAt:performance.now(),
    trackingEpoch:epoch,webFloorPose:anchor.roomPose});
  observe(4);
  assert.equal(world.execute({requestId:'confirm-spawn',op:'confirm_room'}).ok,true);
  const spawn=(requestId,trackingEpoch=4,anchorId=anchor.anchorId)=>world.execute({
    requestId,op:'spawn',assetId:'orb',anchorId:anchor.anchorId,
    placement:'surface',transform,
    roomConstraint:{anchorId,trackingEpoch}});
  observe(5); // The same plane ID can survive room relocalization.
  assert.match(spawn('relocalized').error,/Room observation changed/);
  assert.match(spawn('wrong-support',5,'another-support').error,/target support/);
  world.spatial.planeObservedAt=performance.now()-2100;
  assert.match(spawn('stale-plane',5).error,/Room observation changed/);
  assert.equal(world.scene.objects.length,0);
  observe(5);world.setOriginLocated(false);
  assert.match(spawn('lost-origin',5).error,/aligned AR room/);
  assert.equal(world.scene.objects.length,0);
  world.setOriginLocated(true);observe(6);
  assert.equal(world.execute({requestId:'reconfirm-spawn',op:'confirm_room'}).ok,true);
  const placed=spawn('current-spawn',6);
  assert.equal(placed.ok,true,placed.error);
  assert.equal(world.scene.objects.length,1);
  assert.equal(world.scene.objects[0].anchorId,'web-floor');
  assert.equal(placed.outcome.supportAnchorId,anchor.anchorId);
  assert.deepEqual(placed.outcome.transform,world.scene.objects[0].transform);
  const saved=storedWorld(world);
  assert.equal(saved.scene.objects[0].objectId,placed.objectId);
  world.leaveAR();
  assert.deepEqual(world.scene.objects,saved.scene.objects,
    'the room-aware spawn remains in the same digital world after AR exit');
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,saved);
  assert.deepEqual(reopened.scene.objects,saved.scene.objects);
});

test('room-aware spawn retains the same AR pose through a rotated origin and saves its ID',()=>{
  let sequence=0;
  const world=new MatrixWorld(()=>`durable-${++sequence}`);
  const pose=(x,y,z,ry=0)=>({position:{x,y,z},rotation:{x:0,y:ry,z:0},
    scale:{x:1,y:1,z:1}});
  const support={...anchor,roomPose:pose(2,.75,3)};
  const webFloorPose=pose(2,0,3,90);
  world.enterAR();world.setSpatialAnchors([support]);world.setOriginLocated(true);
  world.setSpatialObservation({planeObservedAt:performance.now(),trackingEpoch:9,
    webFloorPose});
  assert.equal(world.execute({requestId:'confirm-durable',op:'confirm_room'}).ok,true);
  const local={...transform,position:{x:.5,y:0,z:.25},
    rotation:{x:0,y:30,z:0}};
  const placed=world.execute({requestId:'place-durable',op:'spawn',assetId:'orb',
    anchorId:support.anchorId,placement:'surface',transform:local,
    roomConstraint:{anchorId:support.anchorId,trackingEpoch:9}});
  assert.equal(placed.ok,true,placed.error);
  const object=world.requireObject(placed.objectId);
  assert.equal(object.anchorId,'web-floor');
  assert.deepEqual(object.transform.position,{x:-.25,y:.75,z:.5});
  assert.deepEqual(object.transform.rotation,{x:0,y:-60,z:0});
  assert.equal(world.snapshot().scene.objects[0].objectId,placed.objectId);
  const saved=storedWorld(world);
  world.originAnchorHandle='current-room-handle';
  const browserSaved=storedBrowserWorld(world),tab=storage(),durable=storage();
  assert.equal(browserSaved.originBinding,'ar');
  assert.equal(browserSaved.originAnchorHandle,'current-room-handle');
  assert.equal(saveStoredWorld(browserSaved,tab,durable),'');
  world.leaveAR();
  assert.deepEqual(world.scene.objects,saved.scene.objects);
  const reopened=new MatrixWorld();
  assert.equal(restoreBestStoredWorld(reopened,loadStoredWorld(storage(),durable),durable).state,
    'restored');
  assert.deepEqual(reopened.scene.objects,saved.scene.objects);
  assert.equal(reopened.scene.objects[0].objectId,placed.objectId);
  assert.equal(reopened.originAnchorHandle,'current-room-handle');
});

test('guarded placement uses the latest boundary even when display smoothing keeps the old plane',()=>{
  let sequence=0;
  const world=new MatrixWorld(()=>`edge-${++sequence}`);
  const existing=world.execute({requestId:'edge-original',op:'spawn',assetId:'orb',
    anchorId:'web-floor',transform});
  assert.equal(existing.ok,true);
  world.enterAR();world.setSpatialAnchors([anchor]);world.setOriginLocated(true);
  const observe=()=>world.setSpatialObservation({planeObservedAt:performance.now(),
    trackingEpoch:1,webFloorPose:anchor.roomPose});
  observe();
  assert.equal(world.execute({requestId:'edge-confirm',op:'confirm_room'}).ok,true);
  const shrunk=structuredClone(anchor);
  shrunk.surface.boundary=boundary.map(point=>({
    x:point.x>0?point.x-.015:point.x+.015,y:0,
    z:point.z>0?point.z-.015:point.z+.015}));
  world.setSpatialAnchors([shrunk]);observe();
  assert.deepEqual(world.snapshot().anchors.find(item=>item.anchorId===anchor.anchorId)
    .surface.boundary,boundary,'the displayed plane remains smoothed');
  const edgeTransform={...transform,position:{x:1.74,y:0,z:0}};
  const constraint={anchorId:anchor.anchorId,trackingEpoch:1};
  const spawn=world.execute({requestId:'guarded-edge-spawn',op:'spawn',
    assetId:'orb',anchorId:anchor.anchorId,placement:'surface',
    transform:edgeTransform,roomConstraint:constraint});
  assert.match(spawn.error,/footprint/);
  const move=world.execute({requestId:'guarded-edge-move',op:'set_transform',
    objectId:existing.objectId,transform:edgeTransform,roomConstraint:constraint});
  assert.match(move.error,/footprint/);
  assert.equal(world.scene.objects.length,1);
  assert.deepEqual(world.requireObject(existing.objectId).transform,transform);
  assert.equal(world.execute({requestId:'guarded-center-spawn',op:'spawn',
    assetId:'orb',anchorId:anchor.anchorId,placement:'surface',
    transform,roomConstraint:constraint}).ok,true);
});

test('room-constrained edits reject intersected shelf and wall polygons, but allow contact and clear neighbors',()=>{
  let sequence=0;
  const world=new MatrixWorld(()=>`volume-${++sequence}`);
  const origin={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},
    scale:{x:1,y:1,z:1}};
  const floor={...structuredClone(anchor),roomPose:origin};
  const shelf={...structuredClone(anchor),anchorId:'shelf',displayName:'SHELF',
    semanticLabels:['SHELF'],roomPose:{...origin,position:{x:0,y:.6,z:0}},
    surface:{kind:'support',boundary:[{x:-.4,z:-.4},{x:.4,z:-.4},
      {x:.4,z:.4},{x:-.4,z:.4}]}};
  const wall={...structuredClone(anchor),anchorId:'wall',displayName:'WALL',
    semanticLabels:['WALL'],roomPose:{...origin,
      position:{x:1.6,y:.9,z:0},rotation:{x:0,y:0,z:-90}},
    surface:{kind:'wall',boundary:[{x:-1,z:-1},{x:1,z:-1},
      {x:1,z:1},{x:-1,z:1}]}};
  const constraint={anchorId:floor.anchorId,trackingEpoch:4};
  const observe=planes=>{world.setSpatialAnchors(planes);
    world.setSpatialObservation({planeObservedAt:performance.now(),
      trackingEpoch:4,webFloorPose:origin});};
  world.enterAR();world.setOriginLocated(true);observe([floor,shelf,wall]);
  assert.equal(world.execute({requestId:'confirm-volume',op:'confirm_room'}).ok,true);
  assert.equal(volumeIntersectsMeasuredPlane(transform,world.asset('block').localBounds,
    1,origin,shelf),true);
  assert.equal(volumeIntersectsMeasuredPlane(transform,world.asset('orb').localBounds,
    1,origin,shelf),false,'orb top stays below the separate shelf');
  const floorSpawn=(requestId,assetId,position,scale={x:1,y:1,z:1})=>
    world.execute({requestId,op:'spawn',assetId,anchorId:floor.anchorId,
      placement:'surface',roomConstraint:constraint,
      transform:{...transform,position,scale}});
  assert.match(floorSpawn('blocked-shelf','block',{x:0,y:0,z:0}).error,
    /Object volume intersects another measured room surface/);
  assert.equal(world.scene.objects.length,0);
  assert.equal(floorSpawn('clear-orb','orb',{x:0,y:0,z:0}).ok,true);
  const tabletop=world.execute({requestId:'shelf-orb',op:'spawn',assetId:'orb',
    anchorId:shelf.anchorId,placement:'surface',transform});
  assert.equal(tabletop.ok,true,tabletop.error);
  const nearWall=floorSpawn('near-wall','block',{x:.9,y:0,z:0},
    {x:.5,y:.5,z:.5});
  assert.equal(nearWall.ok,true,nearWall.error);
  const movable=world.execute({requestId:'virtual-near-wall',op:'spawn',
    assetId:'block',anchorId:'web-floor',transform:{...transform,
      position:{x:.9,y:0,z:0},scale:{x:.5,y:.5,z:.5}}});
  assert.equal(movable.ok,true,movable.error);
  const movedWall={...wall,roomPose:{...wall.roomPose,
    position:{x:1.2,y:.9,z:0}}};
  observe([floor,shelf,movedWall]);
  const conflict=floorSpawn('blocked-wall','block',{x:1.1,y:0,z:0},
    {x:.5,y:.5,z:.5});
  assert.match(conflict.error,/Object volume intersects another measured room surface/);
  assert.equal(floorSpawn('past-wall-end','block',{x:1.1,y:0,z:1.6},
    {x:.5,y:.5,z:.5}).ok,true,
  'the finite wall polygon does not block clear floor space beyond its edge');
  const move=world.execute({requestId:'blocked-wall-move',op:'set_transform',
    objectId:movable.objectId,roomConstraint:constraint,
    transform:{...transform,position:{x:1.1,y:0,z:0},
      scale:{x:.5,y:.5,z:.5}}});
  assert.match(move.error,/Object volume intersects another measured room surface/);
  assert.equal(world.requireObject(movable.objectId).transform.position.x,.9);
});

test('a concave measured shelf does not occupy its open notch',()=>{
  const origin={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},
    scale:{x:1,y:1,z:1}};
  const shelf={...structuredClone(anchor),anchorId:'u-shelf',
    roomPose:{...origin,position:{x:0,y:.1,z:0}},
    surface:{kind:'support',boundary:[
      {x:-1,z:-1},{x:1,z:-1},{x:1,z:1},{x:.5,z:1},
      {x:.5,z:-.5},{x:-.5,z:-.5},{x:-.5,z:1},{x:-1,z:1}]}};
  const bounds={center:{x:0,y:.5,z:0},size:{x:1,y:1,z:1}};
  const inNotch={...transform,position:{x:0,y:0,z:.3},
    scale:{x:.2,y:.2,z:.2}};
  const inArm={...inNotch,position:{x:-.75,y:0,z:.3}};
  assert.equal(volumeIntersectsMeasuredPlane(inNotch,bounds,1,origin,shelf),false);
  assert.equal(volumeIntersectsMeasuredPlane(inArm,bounds,1,origin,shelf),true);
});

test('WebXR viewer and plane coordinates are read from the XR frame',()=>{
  const pose={transform:{position:{x:1,y:1.6,z:-2},orientation:{x:0,y:0,z:0,w:1}}};
  const frame={getViewerPose:()=>pose,getPose:()=>pose};
  assert.deepEqual(viewerPose(frame,{}).position.toArray(),[1,1.6,-2]);
  assert.deepEqual(viewerPose(frame,{}).direction.toArray(),[0,0,-1]);
  const plane={planeSpace:{},orientation:'horizontal',semanticLabel:'floor',polygon:boundary};
  const measured=planeData(plane,frame,{},'webxr-plane-1');
  assert.equal(measured.surface.kind,'support');
  assert.equal(measured.displayName,'FLOOR');
  assert.equal(insideBoundary({x:0,z:0},measured.surface.boundary),true);
  assert.equal(insideBoundary({x:3,z:0},measured.surface.boundary),false);
});

test('AR snapshot reports age only after a detected-planes observation',t=>{
  const world=new MatrixWorld();world.enterAR();
  assert.deepEqual(world.snapshot().spatialObservation,
    {schemaVersion:1,planeAgeMs:null,trackingEpoch:0,webFloorPose:null});
  const originalDocument=globalThis.document;
  globalThis.document={getElementById:()=>({textContent:''})};
  t.after(()=>{if(originalDocument===undefined)delete globalThis.document;
    else globalThis.document=originalDocument;});
  const view=Object.create(MatrixView.prototype);
  Object.assign(view,{world,isAR:true,lastPlaneTime:0,lastPlaneObservedAt:null,
    roomTrackingEpoch:3,planeOutlines:new Map(),planeIds:new WeakMap(),
    virtualFloorRoot:new THREE.Group(),roomAnchor:null,roomAnchorPending:false,
    roomAnchorLocated:false,roomAnchorRestoreFailed:false,roomCaptureRequested:false,
    sessionStartedAt:0,operatorPanel:{setOriginLabel(){}},xrViewer:null});
  view.updatePlanes(500,{detectedPlanes:new Set(),session:{}},{});
  const observedAt=world.spatial.planeObservedAt;
  assert.ok(Number.isFinite(observedAt));
  assert.ok(world.snapshot().spatialObservation.planeAgeMs<1000);
  assert.equal(world.snapshot().spatialObservation.trackingEpoch,3);
  view.updatePlanes(900,{session:{}},{});
  assert.equal(world.spatial.planeObservedAt,observedAt,
    'a frame without detectedPlanes does not refresh measured-plane evidence');
  world.spatial.planeObservedAt=performance.now()-60001;
  assert.equal(world.snapshot().spatialObservation.planeAgeMs,null);
  world.leaveAR();
  assert.equal(world.snapshot().spatialObservation,undefined);
});

test('room alignment requires a located anchor and expires when its pose is lost',()=>{
  const world=new MatrixWorld();world.enterAR();world.setSpatialAnchors([anchor]);
  assert.match(world.execute({requestId:'early-confirm',op:'confirm_room'}).error,/tracked room origin/);
  const view=Object.create(MatrixView.prototype);
  Object.assign(view,{world,isAR:true,roomAnchor:{anchorSpace:{}},
    roomAnchorLocated:false,roomAnchorRestoredHandle:null,roomAnchorRestoreFailed:false,
    roomPoseMissingSince:0,roomTrackingEpoch:1,lastPlaneObservedAt:performance.now(),
    virtualFloorRoot:new THREE.Group(),anchorRoots:new Map(),
    observationStale:false,onRuntimeChange(){},onAssetError(){}});
  view.updateRoomAnchor({getPose:()=>({transform:{position:{x:1,y:0,z:2},
    orientation:{x:0,y:0,z:0,w:1}}})},{});
  assert.deepEqual(world.snapshot().spatialObservation.webFloorPose.position,{x:1,y:0,z:2});
  assert.equal(world.execute({requestId:'tracked-confirm',op:'confirm_room'}).ok,true);
  assert.equal(world.snapshot().roomContext.alignmentVerified,true);
  world.spatial.originObservedAt=performance.now()-2100;
  assert.equal(world.snapshot().roomContext.alignmentVerified,false);
  assert.equal(world.snapshot().spatialObservation.webFloorPose,null);
  assert.match(world.execute({requestId:'stale-origin-spawn',op:'spawn',assetId:'orb',
    anchorId:anchor.anchorId,placement:'surface',transform}).error,/current room alignment/);
  view.updateRoomAnchor({getPose:()=>({transform:{position:{x:1,y:0,z:2},
    orientation:{x:0,y:0,z:0,w:1}}})},{});
  assert.equal(world.snapshot().roomContext.alignmentVerified,false,
    'tracking recovery needs a new alignment confirmation');
  assert.equal(world.execute({requestId:'reconfirm',op:'confirm_room'}).ok,true);
  view.updateRoomAnchor({getPose:()=>null},{});
  assert.equal(world.snapshot().roomContext.alignmentVerified,false);
  assert.deepEqual(world.snapshot().spatialObservation,
    {schemaVersion:1,planeAgeMs:null,trackingEpoch:2,webFloorPose:null});
});

test('a guarded virtual-floor move respects a rotated measured room support and persists its ID',()=>{
  let sequence=0;
  const world=new MatrixWorld(()=>`room-guard-${++sequence}`);
  const spawned=world.execute({requestId:'spawn-original',op:'spawn',assetId:'orb',
    anchorId:'web-floor',transform});
  assert.equal(spawned.ok,true);
  const original=structuredClone(world.requireObject(spawned.objectId).transform);
  world.enterAR();
  const pose=(x,y,z,ry=0)=>({position:{x,y,z},rotation:{x:0,y:ry,z:0},
    scale:{x:1,y:1,z:1}});
  const webFloorPose=pose(2,0,3,90);
  const support={...anchor,roomPose:pose(2,0,3),surface:{kind:'support',
    boundary:[{x:-.3,y:0,z:-1},{x:.3,y:0,z:-1},
      {x:.3,y:0,z:1},{x:-.3,y:0,z:1}]}};
  const next={...transform,position:{x:.5,y:0,z:0}};
  assert.equal(footprintFitsRoomSupport(next,world.objectBounds(
    world.requireObject(spawned.objectId)),1,webFloorPose,support).ok,true,
  'virtual X maps along measured support Z after the 90-degree room rotation');
  world.setSpatialAnchors([support]);world.setOriginLocated(true);
  const observe=()=>world.setSpatialObservation({planeObservedAt:performance.now(),
    trackingEpoch:7,webFloorPose});
  observe();
  assert.equal(world.execute({requestId:'confirm-guard',op:'confirm_room'}).ok,true);
  const move=(requestId,position,trackingEpoch=7)=>world.execute({requestId,
    op:'set_transform',objectId:spawned.objectId,
    transform:{...transform,position},
    roomConstraint:{anchorId:support.anchorId,trackingEpoch}});
  assert.match(move('stale-epoch',next.position,6).error,/Room observation changed/);
  world.spatial.planeObservedAt=performance.now()-2100;
  assert.match(move('stale-plane',next.position).error,/Room observation changed/);
  observe();
  assert.match(move('outside-room',{x:1,y:0,z:0}).error,/footprint/);
  assert.match(move('above-room',{x:.5,y:.15,z:0}).error,/feet/);
  assert.deepEqual(world.requireObject(spawned.objectId).transform,original);
  world.setSpatialAnchors([{...support,surface:{...support.surface,boundary:[
    {x:-.3,y:0,z:-.2},{x:.3,y:0,z:-.2},
    {x:.3,y:0,z:.2},{x:-.3,y:0,z:.2}]}}]);
  observe();
  assert.match(move('shrunk-room',next.position).error,/footprint/);
  assert.deepEqual(world.requireObject(spawned.objectId).transform,original);
  world.setSpatialAnchors([support]);observe();
  world.setOriginUnavailable(true);
  assert.equal(move('origin-lost',next.position).ok,false);
  assert.deepEqual(world.requireObject(spawned.objectId).transform,original);
  world.setOriginUnavailable(false);world.setOriginLocated(true);observe();
  assert.equal(world.execute({requestId:'reconfirm-guard',op:'confirm_room'}).ok,true);
  assert.equal(move('guarded-move',next.position).ok,true);
  assert.equal(world.requireObject(spawned.objectId).objectId,spawned.objectId);
  assert.deepEqual(world.requireObject(spawned.objectId).transform,next);
  world.leaveAR();
  assert.equal(world.scene.objects[0].objectId,spawned.objectId);
  assert.deepEqual(world.scene.objects[0].transform,next);
});

test('a relocalized floor keeps its session ID only when its shape is unique',()=>{
  const shifted={...structuredClone(anchor),anchorId:'new-plane',roomPose:{...anchor.roomPose,position:{x:4,y:-.3,z:3}}};
  assert.equal(samePlaneShape(anchor,shifted),true);
  assert.equal(matchPlaneAnchor(shifted,[anchor]),anchor.anchorId);
  assert.equal(matchPlaneAnchor(shifted,[anchor,{...anchor,anchorId:'identical-floor'}]),null);
  assert.equal(matchPlaneAnchor(shifted,[anchor],new Set([anchor.anchorId])),null);
  const changed={...shifted,surface:{...shifted.surface,boundary:boundary.map(p=>({...p,x:p.x*1.3}))}};
  assert.equal(matchPlaneAnchor(changed,[anchor]),null);
});

test('virtual scene uses the closest measured floor below the headset',()=>{
  const floor=(y,label='FLOOR')=>({...anchor,semanticLabels:[label],roomPose:{...anchor.roomPose,position:{x:0,y,z:0}}});
  assert.equal(measuredFloorHeight([floor(-1.466),floor(-1.469),floor(1,'CEILING')],-.645),-1.466);
  assert.equal(measuredFloorHeight([floor(1),floor(-4)],-.645),null);
});

test('surface footprint cannot bridge a concave notch even when all four corners are inside',()=>{
  const u=[{x:0,z:0},{x:3,z:0},{x:3,z:3},{x:2,z:3},
    {x:2,z:2},{x:1,z:2},{x:1,z:3},{x:0,z:3}];
  const bridged=[{x:.5,z:.5},{x:2.5,z:.5},{x:2.5,z:2.5},{x:.5,z:2.5}];
  assert.ok(bridged.every(point=>insideBoundary(point,u)));
  assert.equal(insideBoundary({x:1.5,z:1.5},u),true,'center is supported');
  assert.equal(footprintInsideBoundary(bridged,u),false);
  assert.equal(footprintInsideBoundary([{x:.25,z:.25},{x:2.75,z:.25},
    {x:2.75,z:.75},{x:.25,z:.75}],u),true);
  assert.equal(footprintInsideBoundary([{x:0,z:0},{x:3,z:0},{x:3,z:3},{x:0,z:3}],u),false);
  assert.equal(footprintInsideBoundary([{x:-2,z:-2},{x:2,z:-2},{x:2,z:2},{x:-2,z:2}],boundary),true);

  const world=new MatrixWorld(()=> 'placed');world.enterAR();
  world.setSpatialAnchors([{...anchor,surface:{kind:'support',boundary:u}}]);
  world.setOriginLocated(true);
  world.setSpatialObservation({planeObservedAt:performance.now()});
  assert.equal(world.execute({requestId:'confirm',op:'confirm_room'}).ok,true);
  const result=world.execute({requestId:'bridge',op:'spawn',assetId:'block',anchorId:anchor.anchorId,
    placement:'surface',transform:{...transform,position:{x:1.5,y:0,z:1.5},
      scale:{x:2,y:1,z:2}}});
  assert.equal(result.ok,false);
  assert.match(result.error,/footprint/);
});

test('surface footprint uses the horizontally recentered GLB bounds',()=>{
  const world=new MatrixWorld(()=> 'placed');world.enterAR();
  world.externalAssets.push({assetId:'web:offset-left',spawnScale:1,url:'/asset.glb',
    localBounds:{center:{x:-.8,y:1,z:0},size:{x:.6,y:1,z:.6}}},
  {assetId:'web:offset-right',spawnScale:1,url:'/asset.glb',
    localBounds:{center:{x:.8,y:1,z:0},size:{x:.6,y:1,z:.6}}});
  const support=[{x:0,z:0},{x:2,z:0},{x:2,z:2},{x:0,z:2}];
  world.setSpatialAnchors([{...anchor,surface:{kind:'support',boundary:support}}]);
  world.setOriginLocated(true);
  world.setSpatialObservation({planeObservedAt:performance.now()});
  assert.equal(world.execute({requestId:'confirm',op:'confirm_room'}).ok,true);
  const overhang=world.execute({requestId:'overhang',op:'spawn',assetId:'web:offset-left',anchorId:anchor.anchorId,
    placement:'surface',transform:{...transform,position:{x:1.8,y:0,z:1}}});
  assert.match(overhang.error,/footprint/,'rendered model would extend beyond the right edge');
  const valid=world.execute({requestId:'valid',op:'spawn',assetId:'web:offset-right',anchorId:anchor.anchorId,
    placement:'surface',transform:{...transform,position:{x:1.2,y:0,z:1}}});
  assert.equal(valid.ok,true,'the recentered visible model fits');
  assert.equal(world.requireObject(valid.objectId).transform.position.y,0,
    'an imported GLB is already floor aligned by the renderer');
});

test('moving, duplicating, or loading a support object cannot bypass footprint validation',()=>{
  let nextId=0;
  const world=new MatrixWorld(()=>String(++nextId));world.enterAR();
  const support=[{x:0,z:0},{x:2,z:0},{x:2,z:2},{x:0,z:2}];
  world.setSpatialAnchors([{...anchor,surface:{kind:'support',boundary:support}}]);
  world.setOriginLocated(true);
  world.setSpatialObservation({planeObservedAt:performance.now()});
  assert.equal(world.execute({requestId:'confirm',op:'confirm_room'}).ok,true);
  const spawn=world.execute({requestId:'spawn',op:'spawn',assetId:'block',anchorId:anchor.anchorId,
    placement:'surface',transform:{...transform,position:{x:1.4,y:0,z:1}}});
  assert.equal(spawn.ok,true);
  const object=world.requireObject(spawn.objectId);
  assert.match(world.execute({requestId:'duplicate',op:'duplicate',objectId:object.objectId}).error,/footprint/);
  assert.match(world.execute({requestId:'move',op:'set_transform',objectId:object.objectId,
    transform:{...object.transform,position:{...object.transform.position,x:1.6}}}).error,/footprint/);
  const invalidScene=structuredClone(world.scene);
  invalidScene.objects[0].transform.position.x=1.6;
  assert.match(world.execute({requestId:'load',op:'load',scene:invalidScene}).error,/footprint/);
  assert.equal(world.scene.objects.length,1);
  assert.equal(world.scene.objects[0].transform.position.x,1.4);
});

test('rendered GLB geometry cannot exceed the registered support footprint',()=>{
  const asset={localBounds:{center:{x:0,y:.5,z:0},size:{x:1,y:1,z:1}}};
  assert.doesNotThrow(()=>validateRenderedFootprint(asset,{x:1,y:1,z:1}));
  assert.throws(()=>validateRenderedFootprint(asset,{x:1.02,y:1,z:1}),/registered bounds/);
  assert.throws(()=>validateRenderedFootprint(asset,{x:1,y:1,z:1.02}),/registered bounds/);
});
