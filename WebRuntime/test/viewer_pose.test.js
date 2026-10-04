import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixView} from '../src/view.js';
import {captureAgentContext} from '../src/agent_context.js';

function viewFixture({presenting=false,ar=false}={}){
  const view=Object.create(MatrixView.prototype);
  view.renderer={xr:{isPresenting:presenting}};
  view.isAR=ar;
  view.camera=new THREE.PerspectiveCamera(70,1,.01,100);
  view.camera.position.set(9,1.8,9);
  view.camera.lookAt(9,1.8,8);
  view.camera.updateMatrixWorld(true);
  view.virtualFloorRoot=new THREE.Group();
  view.virtualFloorRoot.updateMatrixWorld(true);
  view.planeOutlines=new Map();
  view.world={runtimePresentation:ar?'ar':presenting?'vr':'desktop',
    spatial:{anchors:[]},scene:{roomId:'room-1',objects:[]},
    selection:{objectId:''}};
  view.xrViewer=null;
  view.xrViewerCapturedAt=0;
  view.roomTrackingEpoch=0;
  return view;
}

function trackedFrame(position){
  return {getViewerPose:()=>({transform:{position,
    orientation:{x:0,y:0,z:0,w:1}}})};
}

test('desktop empty-world Agent context uses its camera floor frame',()=>{
  const view=viewFixture();
  view.pointingTarget=()=>null;
  const context=captureAgentContext(view.world,view,'client-1','text');
  assert.equal(context.pointingTarget,null);
  assert.equal(context.viewerFrame.anchorId,'web-floor');
  assert.deepEqual(context.viewerFrame.position,{x:9,y:1.8,z:9});
  assert.deepEqual(context.viewerFrame.forward,{x:0,y:0,z:-1});
});

test('VR uses the current headset pose rather than the desktop camera',()=>{
  const view=viewFixture({presenting:true});
  view.captureXrViewer(trackedFrame({x:2,y:1.65,z:3}),{},performance.now());
  assert.equal(view.hasFreshXrViewer(),true);
  assert.deepEqual(view.viewer().frames[0].position,{x:2,y:1.65,z:3});
  assert.deepEqual(view.viewer().frames[0].forward,{x:0,y:0,z:-1});
});

test('AR reports floor and support frames from the same tracked headset pose',()=>{
  const view=viewFixture({presenting:true,ar:true});
  view.virtualFloorRoot.position.set(1,0,0);
  view.virtualFloorRoot.updateMatrixWorld(true);
  const support=new THREE.Group();support.position.set(3,0,0);
  support.updateMatrixWorld(true);
  view.planeOutlines.set('table-1',support);
  view.world.spatial.anchors.push({anchorId:'table-1',surface:{kind:'support'}});
  view.captureXrViewer(trackedFrame({x:3,y:1.7,z:-1}),{},performance.now());
  assert.deepEqual(view.viewer().frames.map(frame=>frame.anchorId),
    ['web-floor','table-1']);
  assert.deepEqual(view.viewer().frames[0].position,{x:2,y:1.7,z:-1});
  assert.deepEqual(view.viewer().frames[1].position,{x:0,y:1.7,z:-1});
});

test('missing and stale XR poses cannot provide Agent placement context',()=>{
  const view=viewFixture({presenting:true});
  view.pointingTarget=()=>null;
  assert.equal(view.viewer(),null);
  assert.equal(captureAgentContext(view.world,view,'client-1','text').viewerFrame,null);
  view.captureXrViewer(trackedFrame({x:1,y:1.7,z:2}),{},performance.now());
  assert.equal(view.viewer().frames[0].anchorId,'web-floor');
  view.xrViewerCapturedAt=performance.now()-MatrixView.XR_VIEWER_MAX_AGE_MS-1;
  assert.equal(view.viewer(),null);
  assert.equal(view.pointingTarget(),null);
  assert.equal(captureAgentContext(view.world,view,'client-1','text').viewerFrame,null);
  view.captureXrViewer(trackedFrame({x:1,y:1.7,z:2}),{},performance.now());
  view.captureXrViewer(null,null);
  assert.equal(view.xrViewerCapturedAt,0);
  assert.equal(view.roomTrackingEpoch,1);
  assert.equal(view.viewer(),null);
});

test('Operator Agent panel selection is idempotent and opens in XR',()=>{
  const view=viewFixture({presenting:true});
  let agent=false,toggles=0,placements=0;
  view.operatorPanel={group:{visible:false},isAgentMode:()=>agent,
    openAgent:()=>{if(!agent){agent=true;toggles++;}}};
  view.positionOperatorPanel=()=>{placements++;};
  assert.equal(view.showOperatorAgentMode(),true);
  assert.equal(view.showOperatorAgentMode(),true);
  assert.equal(agent,true);
  assert.equal(toggles,1);
  assert.equal(view.operatorPanel.group.visible,true);
  assert.equal(placements,2);
  view.readOnly=true;
  assert.equal(view.showOperatorAgentMode(),false);
  assert.equal(toggles,1);
});

test('room tracking epoch changes on unavailable origin and first anchor pose loss',()=>{
  const view=viewFixture({presenting:true,ar:true});
  view.roomAnchor={anchorSpace:{}};
  view.roomAnchorLocated=true;
  view.roomPoseMissingSince=0;
  view.roomAnchorRestoreFailed=false;
  view.world.digitalWorldVisit=false;
  view.world.spatial.originUnavailable=false;
  view.world.setOriginUnavailable=value=>{view.world.spatial.originUnavailable=value;};
  view.world.setOriginLocated=value=>{view.world.spatial.originLocated=value;};
  view.world.setSpatialObservation=()=>{};
  view.onRuntimeChange=()=>{};
  view.onAssetError=()=>{};
  view.updateRoomAnchor({getPose:()=>null},{});
  assert.equal(view.roomTrackingEpoch,1);
  view.updateRoomAnchor({getPose:()=>null},{});
  assert.equal(view.roomTrackingEpoch,1);
  view.markRoomOriginUnavailable('lost origin');
  assert.equal(view.roomTrackingEpoch,2);
});
