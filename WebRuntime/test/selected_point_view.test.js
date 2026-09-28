import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixView} from '../src/view.js';
import {captureAgentContext} from '../src/agent_context.js';

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
