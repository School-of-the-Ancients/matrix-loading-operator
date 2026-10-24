import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {avatarPointerCollider,pointerObjectHits} from '../src/pointer_picking.js';
import {updateControllerRayForPanel} from '../src/view.js';

test('XR world picking ignores floating name sprites without a raycaster camera',()=>{
  const root=new THREE.Group(),sprite=new THREE.Sprite(),mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));
  sprite.raycast=()=>{throw Error('A world ray must not intersect a presentation sprite');};
  root.add(sprite,mesh);root.position.z=-2;
  const panel={group:{visible:false},mesh:new THREE.Mesh()};
  const ray={userData:{},scale:{z:1},material:{}};
  const hit=updateControllerRayForPanel(ray,new THREE.Group(),panel,[root]);
  assert.equal(hit.object,mesh);assert.equal(hit.distance,1.5);
  assert.equal(ray.userData.panelProbe.raycaster.camera,null);
});

test('avatar envelope follows parent, scale and rotation without raycasting skin',()=>{
  const parent=new THREE.Group(),avatar=new THREE.Group(),visual=new THREE.Group();
  const skin=new THREE.SkinnedMesh(new THREE.BoxGeometry(1,2,1));
  skin.raycast=()=>{throw Error('Continuous avatar picking must not deform triangles');};
  parent.add(avatar);avatar.add(visual);visual.add(skin);
  avatar.userData.pointerCollider=avatarPointerCollider(visual,{x:1,y:2,z:1});
  parent.position.set(2,0,-3);parent.rotation.y=Math.PI/2;visual.scale.setScalar(2);
  const raycaster=new THREE.Raycaster(new THREE.Vector3(2,1,0),new THREE.Vector3(0,0,-1),0,4);
  const [hit]=pointerObjectHits(raycaster,[avatar]);
  assert.equal(hit.object,avatar);assert(Math.abs(hit.distance-2)<1e-8);
  parent.position.z=-6;assert.equal(pointerObjectHits(raycaster,[avatar]).length,0);
  parent.position.z=-3;parent.visible=false;assert.equal(pointerObjectHits(raycaster,[avatar]).length,0);
});

test('nearest exhibit surfaces still win against avatar envelopes and hidden surfaces are skipped',()=>{
  const avatar=new THREE.Group();avatar.position.z=-3;
  avatar.userData.pointerCollider=avatarPointerCollider(avatar,{x:1,y:2,z:1});
  const exhibit=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));
  exhibit.position.set(0,1,-2);exhibit.add(mesh);
  const raycaster=new THREE.Raycaster(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,-1),0,4);
  assert.equal(pointerObjectHits(raycaster,[avatar,exhibit])[0].object,mesh);
  mesh.visible=false;assert.equal(pointerObjectHits(raycaster,[avatar,exhibit])[0].object,avatar);
});
