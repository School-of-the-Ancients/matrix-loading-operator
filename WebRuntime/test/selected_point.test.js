import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedPointAt,currentSelectedPoint,agentSelectedPoint} from '../src/selected_point.js';
import {MatrixWorld} from '../src/protocol.js';

const boundary=[{x:-1,y:0,z:-1},{x:1,y:0,z:-1},
  {x:1,y:0,z:1},{x:-1,y:0,z:1}];
const world=()=>({runtimePresentation:'ar',scene:{roomId:'room-1'},
  placementWorldEpoch:0,
  selection:{objectId:'chair-1'},digitalWorldVisit:false,
  spatial:{stale:false,originUnavailable:false,alignmentVerified:true,
    trackingEpoch:7,
    observedAnchors:[{anchorId:'table-1',source:'webxr',
      surface:{kind:'support',boundary}}]},
  originFresh:()=>true,planeFresh:()=>true});

test('raycast destination is retained independently of object selection',()=>{
  const room=world();
  const selected=selectedPointAt(room,'table-1',{x:.3,y:.004,z:-.2},7);
  assert.equal(selected.position.y,0);
  assert.equal(selected.source,'raycast');
  assert.deepEqual(agentSelectedPoint(room,selected,7),{anchorId:'table-1',
    position:{x:.3,y:0,z:-.2},source:'raycast'});
  assert.equal(room.selection.objectId,'chair-1');
});

test('room change, tracking loss, and missing measured support hide old point',()=>{
  const room=world();
  const selected=selectedPointAt(room,'table-1',{x:0,y:0,z:0},7);
  assert.equal(currentSelectedPoint(room,selected,8),null);
  room.spatial.trackingEpoch=8;
  assert.equal(currentSelectedPoint(room,selected,7),null);
  room.spatial.trackingEpoch=7;
  room.spatial.originUnavailable=true;
  assert.equal(currentSelectedPoint(room,selected,7),null);
  room.spatial.originUnavailable=false;
  room.spatial.alignmentVerified=false;
  assert.equal(currentSelectedPoint(room,selected,7),null);
  room.spatial.alignmentVerified=true;
  room.spatial.observedAnchors=[];
  assert.equal(currentSelectedPoint(room,selected,7),null);
  room.spatial.observedAnchors=[{anchorId:'table-1',source:'webxr',
    surface:{kind:'support',boundary}}];
  room.scene.roomId='room-2';
  assert.equal(currentSelectedPoint(room,selected,7),null);
});

test('edited points must remain inside the measured support',()=>{
  const room=world();
  assert.throws(()=>selectedPointAt(room,'table-1',{x:2,y:0,z:0},7,'adjusted'),
    /measured support point/);
  assert.throws(()=>selectedPointAt(room,'wall-1',{x:0,y:0,z:0},7),
    /measured support point/);
  const edited=selectedPointAt(room,'table-1',{x:.4,y:0,z:.6},7,'adjusted');
  assert.equal(edited.source,'adjusted');
});

test('runtime snapshot gives planner one destination and one selected object',()=>{
  const room=new MatrixWorld(()=> 'chair-1');
  const pose={position:{x:2,y:0,z:2},rotation:{x:0,y:0,z:0},
    scale:{x:1,y:1,z:1}};
  assert.equal(room.execute({requestId:'spawn-chair-1',op:'spawn',assetId:'chair',
    anchorId:'web-floor',transform:pose}).ok,true);
  room.setSelection('chair-1',pose.position,'web-floor');
  room.selectedPlacement=selectedPointAt(room,'web-floor',{x:.5,y:0,z:-.5},0);
  assert.deepEqual(room.snapshot().selection,{anchorId:'web-floor',
    objectId:'chair-1',position:{x:.5,y:0,z:-.5}});
  room.runtimePresentation='vr';
  assert.deepEqual(room.snapshot().selection.position,pose.position);
});
