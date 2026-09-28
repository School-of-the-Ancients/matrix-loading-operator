import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {MatrixView} from '../src/view.js';

test('live descriptor follows desktop, VR, AR, and desktop without changing authored scene',async t=>{
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const elements=new Map();
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById(id){
    if(!elements.has(id))elements.set(id,{style:{},textContent:''});
    return elements.get(id);
  }}});
  t.after(()=>{
    if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);
    else delete globalThis.document;
  });
  const world=new MatrixWorld(()=> 'ar-room');
  const originalScene=structuredClone(world.scene);
  const view=Object.create(MatrixView.prototype);
  let session={environmentBlendMode:'opaque'};
  view.world=world;view.renderer={xr:{getSession:()=>session}};
  const panelModes=[];
  view.operatorPanel={group:{visible:true},setPinLabel(){},setOriginLabel(){},
    setXRMode(mode){panelModes.push(mode);}};
  view.controllerRays=[];view.floor={visible:true};view.grid={visible:true};
  view.scene={background:null};view.reticle={visible:false};
  view.virtualFloorRoot={visible:true,position:{set(){}},quaternion:{identity(){}}};
  view.restoreRoomAnchor=()=>{};view.acquireARHitSource=async()=>{};
  view.sync=()=>{};view.onRuntimeChange=()=>{};view.clearPlanes=()=>{};
  assert.deepEqual(world.snapshot().runtimeDescriptor,
    {schemaVersion:1,client:'matrix-web',renderer:'threejs-webxr',presentation:'desktop'});
  await view.onSessionStart();
  assert.equal(world.snapshot().runtimeDescriptor.presentation,'vr');
  assert.equal(world.snapshot().roomContext.mode,'white-room');
  view.onSessionEnd();
  assert.equal(world.snapshot().runtimeDescriptor.presentation,'desktop');
  session={environmentBlendMode:'alpha-blend'};
  await view.onSessionStart();
  assert.equal(world.snapshot().runtimeDescriptor.presentation,'ar');
  assert.equal(world.snapshot().roomContext.mode,'ar');
  view.onSessionEnd();
  assert.equal(world.snapshot().runtimeDescriptor.presentation,'desktop');
  assert.deepEqual(panelModes,['vr',null,'ar',null]);
  assert.deepEqual(world.scene,originalScene);
});
