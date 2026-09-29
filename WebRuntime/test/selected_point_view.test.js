import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixView} from '../src/view.js';
import {captureAgentContext} from '../src/agent_context.js';
import {MatrixWorld} from '../src/protocol.js';

test('two AR pin clicks keep alignment and reject an old queued room target',()=>{
  const identity={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},
    scale:{x:1,y:1,z:1}};
  const boundary=[{x:-1,y:0,z:-1},{x:1,y:0,z:-1},
    {x:1,y:0,z:1},{x:-1,y:0,z:1}];
  const world=new MatrixWorld();
  world.enterAR();
  world.setSpatialAnchors([{anchorId:'table-1',displayName:'TABLE',source:'webxr',
    semanticLabels:['TABLE'],surface:{kind:'support',boundary},roomPose:identity}]);
  world.setOriginLocated(true);
  world.setSpatialObservation({planeObservedAt:performance.now(),trackingEpoch:4,
    webFloorPose:identity});
  assert.equal(world.execute({requestId:'confirm-room',op:'confirm_room'}).ok,true);
  const view=Object.create(MatrixView.prototype);
  view.world=world;view.isAR=true;view.roomTrackingEpoch=4;
  view.selectedPoint=null;
  view.refreshSelectedPointMarker=()=>{};view.onSelectedPointChange=()=>{};
  view.highlight=()=>{};view.onSelection=()=>{};
  view.onAssetError=message=>{throw Error(message);};
  view.selectPlacementPoint('table-1',{x:.2,y:0,z:.1});
  assert.equal(view.roomTrackingEpoch,5);
  assert.equal(world.spatial.alignmentVerified,true);
  view.selectPlacementPoint('table-1',{x:.4,y:0,z:.1});
  assert.equal(view.roomTrackingEpoch,6);
  assert.equal(world.spatial.trackingEpoch,6);
  assert.equal(world.spatial.alignmentVerified,true);
  assert.deepEqual(view.selectedPlacementTarget().position,{x:.4,y:0,z:.1});
  assert.throws(()=>world.assertCurrentRoomConstraint(
    {anchorId:'table-1',trackingEpoch:5},'table-1'),
    /Room observation changed/);
  const placed=world.execute({requestId:'fresh-target',op:'spawn',assetId:'orb',
    anchorId:'table-1',placement:'surface',
    transform:{...identity,position:{x:.4,y:0,z:.1}},
    roomConstraint:{anchorId:'table-1',trackingEpoch:6}});
  assert.equal(placed.ok,true,placed.error);
});

test('successive controller ray hits move one visible marker while hover and object selection stay separate',()=>{
  const boundary=[{x:-1,y:0,z:-1},{x:1,y:0,z:-1},
    {x:1,y:0,z:1},{x:-1,y:0,z:1}];
  const world={runtimePresentation:'ar',scene:{roomId:'room-1',objects:[
    {objectId:'chair-1',anchorId:'web-floor'}]},
    placementWorldEpoch:0,
    selection:{anchorId:'web-floor',objectId:'',position:{x:0,y:0,z:-2}},
    spatial:{alignmentVerified:true,stale:false,originUnavailable:false,
      trackingEpoch:3,
      observedAnchors:[{anchorId:'table-1',source:'webxr',
        surface:{kind:'support',boundary}}]},
    originFresh:()=>true,planeFresh:()=>true,
    setSelection(objectId,position,anchorId){this.selection={objectId,position,anchorId};}};
  const root=new THREE.Group();
  const surface=new THREE.Mesh(new THREE.PlaneGeometry(2,2),
    new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  surface.rotation.x=-Math.PI/2;surface.userData.anchorId='table-1';root.add(surface);
  root.updateMatrixWorld(true);
  const view=Object.create(MatrixView.prototype);
  view.world=world;view.isAR=true;view.roomTrackingEpoch=3;
  view.objectRoots=new Map();view.planeOutlines=new Map([['table-1',root]]);
  view.raycaster=new THREE.Raycaster();view.virtualFloorRoot=new THREE.Group();
  view.selectedPointMarker=new THREE.Mesh(new THREE.SphereGeometry(.0175),
    new THREE.MeshBasicMaterial());
  view.selectedPoint=null;view.highlight=()=>{};view.onSelection=()=>{};
  let markerChanges=0;view.onSelectedPointChange=()=>{markerChanges++;};
  const errors=[];view.onAssetError=message=>errors.push(message);
  const click=(x,z)=>{
    view.raycaster.set(new THREE.Vector3(x,1,z),new THREE.Vector3(0,-1,0));
    view.selectFromRay();
  };
  click(.25,.2);
  assert.deepEqual(view.selectedPlacementTarget().position,{x:.25,y:0,z:.2});
  assert.equal(view.selectedPointMarker.visible,true);
  view.reticleVisible=true;view.reticleAnchorId='table-1';
  view.reticle=new THREE.Group();view.reticle.position.set(.8,0,.8);
  click(5,5);
  assert.deepEqual(view.selectedPlacementTarget().position,{x:.25,y:0,z:.2},
    'a controller ray miss must not pin the unrelated viewer-gaze reticle');
  world.selection.objectId='chair-1';
  click(.6,-.3);
  assert.deepEqual(view.selectedPlacementTarget().position,{x:.6,y:0,z:-.3});
  view.pointingTarget=()=>null;view.viewer=()=>null;
  const context=captureAgentContext(world,view,'client-1','text');
  assert.equal(context.selectedObjectId,'chair-1');
  assert.deepEqual(context.selectedPlacement.position,{x:.6,y:0,z:-.3});
  view.raycaster.set(new THREE.Vector3(-.5,1,.5),new THREE.Vector3(0,-1,0));
  view.refreshSelectedPointMarker();
  assert.deepEqual(view.selectedPlacementTarget().position,{x:.6,y:0,z:-.3});
  assert.equal(world.selection.objectId,'chair-1');
  world.spatial.originUnavailable=true;
  view.refreshSelectedPointMarker();
  assert.equal(view.selectedPointMarker.visible,false);
  assert.ok(markerChanges>=3);
  assert.equal(view.selectedPlacementTarget(),null);
  world.spatial.originUnavailable=false;
  world.spatial.alignmentVerified=false;
  view.refreshSelectedPointMarker();
  assert.equal(view.selectedPointMarker.visible,false);
  assert.equal(captureAgentContext(world,view,'client-1','text').selectedPlacement,null);
  assert.deepEqual(errors,[]);
});
