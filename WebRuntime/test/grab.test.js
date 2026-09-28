import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {beginGrab,moveGrab,moveGrabThumbstick,rotateGrabThumbstick,sampleHeldMotion,heldReleaseMotion,finishGrab,beginPointerGrab,movePointerGrab,movePointerGrabVertical,finishPointerGrab,moveDesktopCamera} from '../src/grab.js';
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

test('recent held motion becomes bounded release momentum while stillness and tracking gaps do not',()=>{
  const root=new THREE.Group(),grab={root};
  sampleHeldMotion(grab,0);
  root.position.x=.16;
  root.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.3);
  sampleHeldMotion(grab,40);
  root.position.x=.24;
  root.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.45);
  const motion=heldReleaseMotion(grab,60,6,12);
  assert.ok(Math.abs(motion.linearVelocity.x-4)<1e-9);
  assert.ok(Math.abs(motion.angularVelocity.y-7.5)<1e-9);
  assert.deepEqual(motion.linearVelocity.y,0);
  const rapid={root:new THREE.Group()};
  sampleHeldMotion(rapid,0);
  rapid.root.position.x=2;
  rapid.root.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),2);
  const bounded=heldReleaseMotion(rapid,40,6,12);
  assert.ok(Math.abs(bounded.linearVelocity.x-6)<1e-7);
  assert.ok(Math.abs(bounded.angularVelocity.y-12)<1e-7);
  const diagonal={root:new THREE.Group()};
  sampleHeldMotion(diagonal,0);
  diagonal.root.position.set(2,2,2);
  diagonal.root.quaternion.setFromAxisAngle(new THREE.Vector3(1,1,1).normalize(),2);
  const cappedDiagonal=heldReleaseMotion(diagonal,40,6,12);
  assert.ok(Math.hypot(...Object.values(cappedDiagonal.linearVelocity))<=6);
  assert.ok(Math.hypot(...Object.values(cappedDiagonal.angularVelocity))<=12,
    'diagonal caps must satisfy the rigid release validator after rounding');
  const still={root:new THREE.Group()};
  sampleHeldMotion(still,0);
  assert.equal(heldReleaseMotion(still,40,6,12),null);
  const settled={root:new THREE.Group()};
  sampleHeldMotion(settled,0);
  settled.root.position.x=.3;
  sampleHeldMotion(settled,30);
  sampleHeldMotion(settled,50);
  sampleHeldMotion(settled,70);
  assert.equal(heldReleaseMotion(settled,90,6,12),null,
    'a deliberate pause before release must not reuse earlier movement');
  const stale={root:new THREE.Group()};
  sampleHeldMotion(stale,0);
  stale.root.position.x=.5;
  sampleHeldMotion(stale,100);
  assert.equal(heldReleaseMotion(stale,130,6,12),null,
    'a tracking gap must clear the old movement before release');
});

test('grabbing-hand thumbstick retains its dead zone, frame time, and bounded translation',()=>{
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

test('free-hand thumbstick spins and flips the held object in place with a dead zone and bounded angular rate',()=>{
  const scene=new THREE.Scene(),controller=new THREE.Group(),root=new THREE.Group();
  scene.add(controller,root);root.position.z=-2;
  const grab=beginGrab(controller,root),forward=new THREE.Vector3(0,0,-1);
  assert.equal(rotateGrabThumbstick(grab,[0,0,.17,0],forward,.1),false);
  assert.equal(rotateGrabThumbstick(grab,[0,0,NaN,0],forward,.1),false);
  assert.equal(rotateGrabThumbstick(grab,[0,0,1,0],forward,0),false);
  assert.equal(rotateGrabThumbstick(grab,[0,0,1,0],forward,5),true);
  const twelveDegrees=THREE.MathUtils.degToRad(12);
  assert.ok(Math.abs(grab.stickRotation.angleTo(new THREE.Quaternion())-twelveDegrees)<1e-9,
    'a long frame must be capped at a tenth of a second');
  moveGrab(grab);
  assert.ok(root.position.distanceTo(new THREE.Vector3(0,0,-2))<1e-9,
    'stick rotation must not move the object center');
  assert.ok(root.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),twelveDegrees))<1e-7);
  assert.equal(rotateGrabThumbstick(grab,[0,0,-1,0],forward,.1),true);
  moveGrab(grab);
  assert.ok(root.quaternion.angleTo(new THREE.Quaternion())<1e-7,'opposite stick input reverses the spin');
  const flip=beginGrab(controller,root);
  assert.equal(rotateGrabThumbstick(flip,[0,0,0,-1],forward,.1),true);
  moveGrab(flip);
  assert.ok(root.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),twelveDegrees))<1e-7,
    'stick up flips about the viewer horizontal right axis');
  const small=beginGrab(controller,new THREE.Group());
  for(let index=0;index<10;index++)rotateGrabThumbstick(small,[0,0,1,0],forward,.01);
  assert.ok(Math.abs(small.stickRotation.angleTo(new THREE.Quaternion())-twelveDegrees)<1e-9,
    'ten short frames rotate as far as one capped tenth-second frame');
  const lookingEast=beginGrab(controller,new THREE.Group());
  assert.equal(rotateGrabThumbstick(lookingEast,[0,0,0,-1],new THREE.Vector3(1,0,0),.1),true);
  assert.ok(lookingEast.stickRotation.angleTo(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0,0,1),twelveDegrees))<1e-7,
  'flip axis follows the viewer horizontal right as the viewer turns');
  const somersaultRoot=new THREE.Group();somersaultRoot.position.z=-2;scene.add(somersaultRoot);
  const somersault=beginGrab(controller,somersaultRoot);
  for(let index=0;index<15;index++)rotateGrabThumbstick(somersault,[0,0,0,-1],forward,.1);
  moveGrab(somersault);
  assert.ok(somersaultRoot.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1,0,0),Math.PI))<1e-7,'the stick can turn the object upside down');
  for(let index=0;index<15;index++)rotateGrabThumbstick(somersault,[0,0,0,-1],forward,.1);
  moveGrab(somersault);
  assert.ok(somersaultRoot.quaternion.angleTo(new THREE.Quaternion())<1e-7,
    'continued stick input completes the flip without a travel limit');
  assert.ok(somersaultRoot.position.distanceTo(new THREE.Vector3(0,0,-2))<1e-9);
});

test('viewer-relative spin and flip compose with translation, a moving AR parent, and saved transform',()=>{
  const scene=new THREE.Scene(),controller=new THREE.Group(),anchor=new THREE.Group();
  anchor.rotation.y=Math.PI/2;scene.add(controller,anchor);
  const root=new THREE.Group();root.position.set(0,.5,-2);root.scale.set(2,1,3);anchor.add(root);
  scene.updateMatrixWorld(true);
  const grab=beginGrab(controller,root),forward=new THREE.Vector3(0,0,-1);
  anchor.position.x=.25;anchor.rotation.y+=Math.PI/4;
  controller.position.x=.4;controller.rotation.y=Math.PI/6;
  controller.updateMatrixWorld(true);
  const controllerWorld=new THREE.Matrix4().multiplyMatrices(controller.matrixWorld,grab.offset);
  const expectedPosition=new THREE.Vector3(),physicalRotation=new THREE.Quaternion(),expectedScale=new THREE.Vector3();
  controllerWorld.decompose(expectedPosition,physicalRotation,expectedScale);
  assert.equal(moveGrabThumbstick(grab,[0,0,0,-1],false,forward,.1),true);
  expectedPosition.add(grab.stickOffset);
  assert.equal(rotateGrabThumbstick(grab,[0,0,1,0],forward,.1),true);
  assert.equal(rotateGrabThumbstick(grab,[0,0,0,-1],forward,.1),true);
  moveGrab(grab);
  assert.ok(root.getWorldPosition(new THREE.Vector3()).distanceTo(expectedPosition)<1e-9,
    'stick rotation must retain the controller-derived world position');
  assert.ok(root.getWorldQuaternion(new THREE.Quaternion()).angleTo(grab.stickRotation.clone().multiply(physicalRotation))<1e-9,
    'stick rotation composes with physical controller rotation in world space');
  assert.ok(root.scale.distanceTo(expectedScale)<1e-9);
  const original={position:{x:0,y:.5,z:-2},rotation:{x:0,y:0,z:0},scale:{x:2,y:1,z:3}};
  const transform=finishGrab(grab,original);
  assert.deepEqual(transform.scale,{x:2,y:1,z:3});
  assert.ok(Math.abs(transform.rotation.x)>1&&Math.abs(transform.rotation.y)>1);
  const world=new MatrixWorld(()=> 'held-object');
  assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'block',anchorId:ANCHOR_ID,transform:original}).ok,true);
  assert.equal(world.execute({requestId:'spin',op:'set_transform',objectId:'held-object',transform}).ok,true);
  const values=new Map(),storage={getItem:key=>values.get(key)||null,
    setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  assert.equal(saveStoredScene(world.scene,storage,storage),'');
  const reopened=new MatrixWorld();restoreStoredScene(reopened,loadStoredScene(storage,storage));
  assert.deepEqual(reopened.requireObject('held-object').transform,transform);
  assert.equal(world.execute({requestId:'undo',op:'undo'}).ok,true);
  assert.deepEqual(world.requireObject('held-object').transform,original);
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
