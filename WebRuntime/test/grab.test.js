import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {beginGrab,moveGrab,finishGrab,beginPointerGrab,movePointerGrab,finishPointerGrab,moveDesktopCamera} from '../src/grab.js';
import {MatrixWorld,ANCHOR_ID} from '../src/protocol.js';

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
  assert.equal(world.execute({requestId:'undo',op:'undo'}).ok,true);
  assert.deepEqual(world.scene.objects[0].transform,original);
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
