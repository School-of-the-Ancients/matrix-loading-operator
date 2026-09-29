import test from 'node:test';
import assert from 'node:assert/strict';
import {captureAgentContext,verifyAgentContextAtDelivery} from '../src/agent_context.js';

test('voice transcription cannot deliver a former pin after it moves on the same support',async()=>{
  const world={runtimePresentation:'ar',scene:{roomId:'room-1',objects:[
    {objectId:'chair-1',anchorId:'web-floor'}]},selection:{objectId:'chair-1'}};
  let pin={anchorId:'table-1',position:{x:.2,y:0,z:.1},source:'raycast'};
  const view={roomTrackingEpoch:7,pointingTarget:()=>null,
    selectedPlacementTarget:()=>pin,viewer:()=>({frames:[]})};
  const captured=captureAgentContext(world,view,'client-1','voice_transcript');
  let finishTranscription;
  const transcribing=new Promise(resolve=>{finishTranscription=resolve;});
  const deliver=(async()=>{
    await transcribing;
    return verifyAgentContextAtDelivery(captured,
      captureAgentContext(world,view,'client-1','voice_transcript'));
  })();
  pin={anchorId:'table-1',position:{x:.7,y:0,z:.1},source:'raycast'};
  finishTranscription();
  await assert.rejects(deliver,/Selected point or object changed/);
  pin={anchorId:'table-1',position:{x:.2,y:0,z:.1},source:'raycast'};
  assert.deepEqual(verifyAgentContextAtDelivery(captured,
    captureAgentContext(world,view,'client-1','voice_transcript')).selectedPlacement,
    captured.selectedPlacement);
});

test('captures selected object and a distinct pointing hit at send time',()=>{
  const world={runtimePresentation:'ar',scene:{roomId:'webxr-session-1',objects:[{objectId:'chair-1',anchorId:'floor-1'}]},
    selection:{objectId:'chair-1'}};
  const view={roomTrackingEpoch:4,
    pointingTarget:()=>({anchorId:'floor-1',objectId:null,position:{x:2,y:0,z:-3}}),
    viewer:()=>({frames:[{anchorId:'floor-1',position:{x:0,y:1.7,z:0},forward:{x:0,y:0,z:-1}}]})};
  const context=captureAgentContext(world,view,'client-1','voice_transcript');
  assert.equal(context.selectedObjectId,'chair-1');
  assert.deepEqual(context.pointingTarget.position,{x:2,y:0,z:-3});
  assert.equal(context.viewerFrame.anchorId,'floor-1');
  assert.equal(context.inputSource,'voice_transcript');
  assert.equal(context.roomId,'webxr-session-1');
  assert.equal(context.schemaVersion,3);
  assert.equal(context.selectedPlacement,null);
  assert.equal(context.presentation,'ar');
  assert.equal(context.trackingEpoch,4);
});

test('selected placement stays distinct from live hover and selected object',()=>{
  const world={runtimePresentation:'ar',scene:{roomId:'room-1',objects:[
    {objectId:'chair-1',anchorId:'web-floor'}]},selection:{objectId:'chair-1'}};
  const frame=anchorId=>({anchorId,position:{x:0,y:1.7,z:0},
    forward:{x:0,y:0,z:-1}});
  const view={roomTrackingEpoch:8,pointingTarget:()=>null,
    selectedPlacementTarget:()=>({anchorId:'table-1',position:{x:.4,y:0,z:.2},
      source:'adjusted'}),viewer:()=>({frames:[frame('web-floor'),frame('table-1')]})};
  const context=captureAgentContext(world,view,'client-1','text');
  assert.equal(context.selectedObjectId,'chair-1');
  assert.equal(context.pointingTarget,null);
  assert.deepEqual(context.selectedPlacement,{anchorId:'table-1',
    position:{x:.4,y:0,z:.2},source:'adjusted'});
  assert.equal(context.viewerFrame.anchorId,'table-1');
});

test('does not invent a pointing hit or head pose for a plain request',()=>{
  const world={runtimePresentation:'desktop',scene:{roomId:'web-virtual-room-v1',objects:[]},selection:{objectId:''}};
  const view={pointingTarget:()=>null,viewer:()=>({frames:[{anchorId:'web-floor'}]})};
  const context=captureAgentContext(world,view,'client-1','text');
  assert.equal(context.selectedObjectId,null);
  assert.equal(context.pointingTarget,null);
  assert.equal(context.viewerFrame,null);
  assert.equal(context.trackingEpoch,null);
});

test('empty world includes a current floor viewpoint without inventing a target',()=>{
  const world={runtimePresentation:'vr',scene:{roomId:'web-virtual-room-v1',objects:[]},
    selection:{objectId:''}};
  const floor={anchorId:'web-floor',position:{x:0,y:1.7,z:0},
    forward:{x:0,y:0,z:-1},lookDirection:{x:0,y:0,z:-1}};
  const view={pointingTarget:()=>null,viewer:()=>({frames:[floor]})};
  const context=captureAgentContext(world,view,'client-1','voice_transcript');
  assert.equal(context.selectedObjectId,null);
  assert.equal(context.pointingTarget,null);
  assert.deepEqual(context.viewerFrame,floor);
  assert.equal(context.presentation,'vr');
  assert.equal(context.trackingEpoch,null);
});

test('pointing anchor outranks selection, which outranks the floor frame',()=>{
  const world={runtimePresentation:'ar',scene:{roomId:'webxr-session-1',objects:[
    {objectId:'chair-1',anchorId:'table-1'}]},selection:{objectId:'chair-1'}};
  const frame=anchorId=>({anchorId,position:{x:0,y:1.7,z:0},
    forward:{x:0,y:0,z:-1}});
  const floor=frame('web-floor'),table=frame('table-1'),wall=frame('wall-1');
  let target={anchorId:'wall-1',objectId:null,position:{x:1,y:1,z:1}};
  const view={roomTrackingEpoch:2,pointingTarget:()=>target,viewer:()=>({frames:[floor,table,wall]})};
  assert.equal(captureAgentContext(world,view,'client-1','text')
    .viewerFrame.anchorId,'wall-1');
  target=null;
  assert.equal(captureAgentContext(world,view,'client-1','text')
    .viewerFrame.anchorId,'table-1');
  world.selection.objectId='';
  assert.equal(captureAgentContext(world,view,'client-1','text')
    .viewerFrame.anchorId,'web-floor');
});

test('mode and tracking changes are part of each turn even when roomId stays the same',()=>{
  const world={runtimePresentation:'vr',scene:{roomId:'web-virtual-room-v1',objects:[]},
    selection:{objectId:''}};
  const view={roomTrackingEpoch:5,pointingTarget:()=>null,viewer:()=>null};
  const vr=captureAgentContext(world,view,'client-1','text');
  world.runtimePresentation='ar';
  const ar=captureAgentContext(world,view,'client-1','text');
  assert.equal(vr.roomId,ar.roomId);
  assert.deepEqual([vr.presentation,vr.trackingEpoch],['vr',null]);
  assert.deepEqual([ar.presentation,ar.trackingEpoch],['ar',5]);
  view.roomTrackingEpoch=6;
  assert.equal(captureAgentContext(world,view,'client-1','text').trackingEpoch,6);
  view.roomTrackingEpoch=undefined;
  assert.throws(()=>captureAgentContext(world,view,'client-1','text'),/tracking epoch/);
});
