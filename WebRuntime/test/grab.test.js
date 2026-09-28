import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {beginGrab,moveGrab,moveGrabThumbstick,finishGrab,beginPointerGrab,movePointerGrab,movePointerGrabVertical,finishPointerGrab,moveDesktopCamera} from '../src/grab.js';
import {MatrixWorld,ANCHOR_ID} from '../src/protocol.js';
import {loadStoredScene,saveStoredScene,restoreStoredScene} from '../src/scene_store.js';

test('controller grab preserves offset, commits a scene transform and remains undoable',()=>{
  const scene=new THREE.Scene();
  const controller=new THREE.Group();controller.position.set(0,1,-1);scene.add(controller);
  const root=new THREE.Group();root.position.set(0,0,-2);scene.add(root);
  const original={position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
  const grab=beginGrab(controller,root);
  assert.equal(finishGrab(grab,original),null,'press and release without moving should not add undo history');
  controller.position.x=1;
  controller.rotation.y=Math.PI/2;
  moveGrab(grab);
  const expected=new THREE.Matrix4().multiplyMatrices(controller.matrixWorld,grab.offset);
  assert.ok(root.matrixWorld.elements.every((value,index)=>Math.abs(value-expected.elements[index])<1e-6));
  const transform=finishGrab(grab,original);
  assert.ok(transform);
  assert.deepEqual(transform.position,{x:0,y:0,z:-1});
  assert.equal(transform.rotation.y,90);
  const world=new MatrixWorld(()=> 'held-object');
  assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'block',anchorId:ANCHOR_ID,transform:original}).ok,true);
  assert.equal(world.execute({requestId:'move',op:'set_transform',objectId:'held-object',transform}).ok,true);
  assert.deepEqual(world.snapshot().scene.objects[0].transform,transform);
  const values=new Map(),storage={getItem:key=>values.get(key)||null,
    setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  assert.equal(saveStoredScene(world.scene,storage,storage),'');
  const reopened=new MatrixWorld();
  restoreStoredScene(reopened,loadStoredScene(storage,storage));
  assert.deepEqual(reopened.requireObject('held-object').transform,transform);
  assert.equal(world.execute({requestId:'undo',op:'undo'}).ok,true);
  assert.deepEqual(world.scene.objects[0].transform,original);
});

test('thumbstick uses a dead zone, frame time, and bounded travel',()=>{
  const scene=new THREE.Scene(),controller=new THREE.Group(),root=new THREE.Group();
  scene.add(controller,root);root.position.z=-2;
  const grab=beginGrab(controller,root),forward=new THREE.Vector3(0,0,-1);
  assert.equal(moveGrabThumbstick(grab,[0,0,.17,0],false,forward,.1),false);
  assert.equal(moveGrabThumbstick(grab,[0,0,NaN,0],false,forward,.1),false);
  assert.equal(moveGrabThumbstick(grab,[0,0,1,0],false,forward,0),false);
  assert.equal(moveGrabThumbstick(grab,[0,0,1,0],false,forward,.1),true);
  moveGrab(grab);
  assert.ok(Math.abs(root.position.x-.075)<1e-9);
  const depth=beginGrab(controller,new THREE.Group());
  assert.equal(moveGrabThumbstick(depth,[0,0,0,-1],false,forward,.1),true);
  assert.ok(Math.abs(depth.stickOffset.z+.075)<1e-9);
  const small=beginGrab(controller,new THREE.Group());
  for(let index=0;index<10;index++)moveGrabThumbstick(small,[0,0,1,0],false,forward,.01);
  assert.ok(Math.abs(small.stickOffset.x-grab.stickOffset.x)<1e-9);
  for(let index=0;index<100;index++)moveGrabThumbstick(grab,[0,0,1,0],false,forward,.1);
  assert.ok(Math.abs(grab.stickOffset.length()-3)<1e-9);
});

test('viewer-relative stick translation preserves a rotated AR parent and click changes height',()=>{
  const scene=new THREE.Scene(),controller=new THREE.Group(),anchor=new THREE.Group();
  anchor.rotation.y=Math.PI/2;scene.add(controller,anchor);
  const root=new THREE.Group();root.position.set(0,.5,-2);anchor.add(root);
  scene.updateMatrixWorld(true);
  const start=root.getWorldPosition(new THREE.Vector3());
  const grab=beginGrab(controller,root),forward=new THREE.Vector3(0,0,-1);
  anchor.position.x=.25;
  assert.equal(moveGrabThumbstick(grab,[0,0,1,0],false,forward,.1),true);
  assert.equal(moveGrabThumbstick(grab,[0,0,0,-1],true,forward,.1),true);
  moveGrab(grab);
  const end=root.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(end.x-start.x-.075)<1e-9);
  assert.ok(Math.abs(end.y-start.y-.075)<1e-9);
  assert.ok(Math.abs(end.z-start.z)<1e-9);
  const transform=finishGrab(grab,{position:{x:0,y:.5,z:-2},rotation:{x:0,y:0,z:0},scale:{x:2,y:1,z:3}});
  assert.deepEqual(transform.scale,{x:2,y:1,z:3});
  const expectedLocal=anchor.worldToLocal(start.clone().add(new THREE.Vector3(.075,.075,0)));
  assert.ok(Math.abs(transform.position.z-expectedLocal.z)<.001);
});

test('lost controller tracking suspends a grab at its last valid transform',()=>{
  const scene=new THREE.Scene(),controller=new THREE.Group(),root=new THREE.Group();
  scene.add(controller,root);root.position.z=-2;
  const grab=beginGrab(controller,root);
  controller.position.x=.5;moveGrab(grab);
  controller.visible=false;controller.position.x=2;
  assert.equal(moveGrab(grab),false);
  const transform=finishGrab(grab,{position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}});
  assert.equal(transform.position.x,.5);
});

test('an offset AR origin validates the authored local pose',()=>{
  const scene=new THREE.Scene(),anchor=new THREE.Group(),controller=new THREE.Group();
  anchor.position.x=150;controller.position.x=150;scene.add(anchor,controller);
  const root=new THREE.Group();root.position.z=-2;anchor.add(root);
  const grab=beginGrab(controller,root);
  controller.position.x+=.1;
  assert.equal(moveGrab(grab),true);
  assert.ok(Math.abs(root.position.x-.1)<1e-9);
});

test('desktop drag moves an object across its horizontal plane while arrow keys move the viewer',()=>{
  const scene=new THREE.Scene();
  const root=new THREE.Group();root.position.set(0,0,-2);scene.add(root);
  const raycaster=new THREE.Raycaster(new THREE.Vector3(0,1,3),new THREE.Vector3(0,-1,-5).normalize());
  const grab=beginPointerGrab(raycaster,root);
  assert.ok(grab);
  raycaster.ray.origin.x=1;
  assert.equal(movePointerGrab(grab,raycaster),true);
  assert.deepEqual(finishPointerGrab(grab,{position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}).position,
    {x:1,y:0,z:-2});
  const camera=new THREE.PerspectiveCamera();camera.position.set(0,1.7,0);camera.lookAt(0,1.7,-1);
  moveDesktopCamera(camera,new Set(['ArrowUp','ArrowRight']),.04);
  assert.ok(camera.position.x>0&&camera.position.z<0);
  assert.equal(camera.position.y,1.7);
});

test('Shift drag changes height and switching back to floor drag keeps that height',()=>{
  const scene=new THREE.Scene();
  const root=new THREE.Group();root.position.set(0,0,-2);scene.add(root);
  const raycaster=new THREE.Raycaster(new THREE.Vector3(0,1,3),new THREE.Vector3(0,-1,-5).normalize());
  const grab=beginPointerGrab(raycaster,root);
  assert.ok(grab);
  assert.equal(movePointerGrabVertical(grab,raycaster,-50),true);
  assert.equal(root.position.y,.5);
  assert.equal(movePointerGrab(grab,raycaster),true);
  assert.ok(Math.abs(root.position.y-.5)<1e-6);
  raycaster.ray.origin.x=1;
  assert.equal(movePointerGrab(grab,raycaster),true);
  assert.deepEqual(finishPointerGrab(grab,{position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}).position,
    {x:1,y:.5,z:-2});
});
