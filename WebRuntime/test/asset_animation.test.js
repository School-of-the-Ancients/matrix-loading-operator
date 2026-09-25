import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {readFile} from 'node:fs/promises';
import {instantiateAnimatedAsset,stopAnimatedAsset} from '../src/asset_animation.js';

function animatedRig(){
  const scene=new THREE.Group();
  const wing=new THREE.Bone();wing.name='Wing';scene.add(wing);
  const mesh=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());
  mesh.bind(new THREE.Skeleton([wing]));scene.add(mesh);
  const track=new THREE.VectorKeyframeTrack('Wing.position',[0,1],[0,0,0,0,1,0]);
  return {scene,animations:[new THREE.AnimationClip('Flight',1,[track])]};
}

test('one validated GLB clip loops on an independently cloned rig',()=>{
  const gltf=animatedRig();
  const asset={geometry:{animationClips:[{name:'Flight',durationSeconds:1}]}};
  const first=instantiateAnimatedAsset(gltf,asset);
  const second=instantiateAnimatedAsset(gltf,asset);
  const sourceBone=gltf.scene.getObjectByName('Wing');
  const firstBone=first.model.getObjectByName('Wing');
  const secondBone=second.model.getObjectByName('Wing');
  assert.notEqual(firstBone,sourceBone);
  assert.notEqual(firstBone,secondBone);
  assert.notEqual(first.model.children[1].skeleton.bones[0],sourceBone);
  first.mixer.update(.5);
  assert.ok(Math.abs(firstBone.position.y-.5)<.001);
  assert.equal(secondBone.position.y,0);
  first.mixer.update(.75);
  assert.ok(Math.abs(firstBone.position.y-.25)<.001);
  stopAnimatedAsset(first.mixer,first.model);
  stopAnimatedAsset(second.mixer,second.model);
});

test('clip mismatch fails closed and multiple clips wait for explicit binding',()=>{
  const gltf=animatedRig();
  assert.throws(()=>instantiateAnimatedAsset(gltf,{geometry:{animationClips:[]}}),/differ/);
  const second=new THREE.AnimationClip('Roar',1,gltf.animations[0].tracks);
  const pair={...gltf,animations:[...gltf.animations,second]};
  const instance=instantiateAnimatedAsset(pair,{geometry:{animationClips:[
    {name:'Flight',durationSeconds:1},{name:'Roar',durationSeconds:1}]}});
  assert.equal(instance.mixer,null);
  const support=instantiateAnimatedAsset(gltf,{geometry:{animationClips:[{name:'Flight',durationSeconds:1}]}},{play:false});
  assert.equal(support.mixer,null);
  const excessive=new THREE.AnimationClip('Flight',1,[new THREE.VectorKeyframeTrack('Wing.position',
    [0,1],[0,0,0,1000,0,0])]);
  assert.throws(()=>instantiateAnimatedAsset({...gltf,animations:[excessive]},
    {geometry:{animationClips:[{name:'Flight',durationSeconds:1}]}}),/differ/);
});

test('named selection clip plays once, restarts on reselection, and returns to loop',()=>{
  const gltf=animatedRig();
  const roar=new THREE.AnimationClip('Roar',.5,[new THREE.VectorKeyframeTrack(
    'Wing.position',[0,.5],[0,0,0,0,2,0])]);
  gltf.animations.push(roar);
  const asset={geometry:{animationClips:[
    {name:'Flight',durationSeconds:1},{name:'Roar',durationSeconds:.5}]}};
  const binding={loopClip:'Flight',selectClip:'Roar'};
  const first=instantiateAnimatedAsset(gltf,asset,{binding});
  const second=instantiateAnimatedAsset(gltf,asset,{binding});
  const wing=first.model.getObjectByName('Wing');
  first.mixer.update(.2);
  assert.ok(wing.position.y>0);
  first.select();
  first.mixer.update(.25);
  assert.ok(Math.abs(wing.position.y-1)<.001);
  first.select();
  first.mixer.update(.5);
  assert.equal(second.model.getObjectByName('Wing').position.y,0);
  first.mixer.update(.25);
  assert.ok(Math.abs(wing.position.y-.25)<.001);
  assert.throws(()=>instantiateAnimatedAsset(gltf,asset,{binding:{loopClip:'Unknown',selectClip:'Roar'}}),/binding differs/);
  stopAnimatedAsset(first.mixer,first.model);
  stopAnimatedAsset(second.mixer,second.model);
});

test('Blender 5.2 exported GLB clip loads and advances in the Matrix mixer',async()=>{
  const raw=await readFile(new URL('./fixtures/animated_blender_probe.glb',import.meta.url));
  const bytes=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  const instance=instantiateAnimatedAsset(gltf,{geometry:{animationClips:[
    {name:'Flight',durationSeconds:1.2916666666666667}]}});
  assert.equal(gltf.animations[0].name,'Flight');
  const wing=instance.model.getObjectByName('Wing');
  const before=wing.quaternion.clone();
  instance.mixer.update(.5);
  assert.ok(wing.quaternion.angleTo(before)>.05);
  stopAnimatedAsset(instance.mixer,instance.model);
});
