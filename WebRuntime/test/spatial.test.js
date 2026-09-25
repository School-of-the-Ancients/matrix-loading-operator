import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {viewerPose,planeData,insideBoundary,matchPlaneAnchor,samePlaneShape,measuredFloorHeight} from '../src/spatial.js';

const boundary=[{x:-2,y:0,z:-2},{x:2,y:0,z:-2},{x:2,y:0,z:2},{x:-2,y:0,z:2}];
const anchor={anchorId:'webxr-plane-1',displayName:'FLOOR',source:'webxr',semanticLabels:['FLOOR'],
  surface:{kind:'support',boundary},roomPose:{position:{x:1,y:0,z:-1},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}};
const transform={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};

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
  assert.match(world.execute({requestId:'before',op:'spawn',assetId:'orb',anchorId:anchor.anchorId,placement:'surface',transform}).error,/Confirm room/);
  assert.equal(world.execute({requestId:'confirm',op:'confirm_room'}).ok,true);
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
