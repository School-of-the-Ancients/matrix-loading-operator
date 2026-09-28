import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Box3,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {instantiateAnimatedAsset,stopAnimatedAsset} from '../src/asset_animation.js';

test('Version 4 bridge lantern clip advances and loops in the browser mixer',async()=>{
  const raw=await readFile(new URL('../art/concept-v4-garden-bridge-animated.glb',import.meta.url));
  const bytes=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  const previousCreateImageBitmap=globalThis.createImageBitmap;
  const previousSelf=globalThis.self;
  // Node has no image decoder; the test exercises the real GLB animation and
  // Matrix mixer. Image bytes and format are checked by the PC GLB validator.
  globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
  globalThis.self=globalThis;
  try{
    const gltf=await new GLTFLoader().parseAsync(bytes,'');
    assert.equal(gltf.animations.length,1);
    assert.equal(gltf.animations[0].name,'Lantern Pulse');
    const instance=instantiateAnimatedAsset(gltf,{geometry:{animationClips:[
      {name:'Lantern Pulse',durationSeconds:2.0416666666666665}]}});
    const pane=instance.model.getObjectByName('left_near_lantern_inner_amber_glass');
    assert.ok(pane);
    const rest=pane.scale.y;
    instance.mixer.update(.5);
    assert.ok(Math.abs(pane.scale.y-rest)>.1,
      `lantern glass visibly changes height: rest ${rest}, now ${pane.scale.y}`);
    instance.mixer.update(2.0416666666666665);
    assert.ok(Math.abs(pane.scale.y-rest)>.1,'the single clip loops');
    stopAnimatedAsset(instance.mixer,instance.model);
  }finally{
    if(previousCreateImageBitmap===undefined)delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap=previousCreateImageBitmap;
    if(previousSelf===undefined)delete globalThis.self;
    else globalThis.self=previousSelf;
  }
});

test('Agent-authored Beacon GLB has a moving named clip in the browser mixer',async()=>{
  const raw=await readFile(new URL('../art/concept-v4-garden-bridge-beacon.glb',import.meta.url));
  const bytes=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  const previousCreateImageBitmap=globalThis.createImageBitmap;
  const previousSelf=globalThis.self;
  globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
  globalThis.self=globalThis;
  try{
    const gltf=await new GLTFLoader().parseAsync(bytes,'');
    assert.equal(gltf.animations.length,1);
    const clip=gltf.animations[0];
    assert.equal(clip.name,'Lantern Beacon');
    const instance=instantiateAnimatedAsset(gltf,{geometry:{animationClips:[
      {name:clip.name,durationSeconds:clip.duration}]}});
    const pane=instance.model.getObjectByName('left_near_lantern_inner_amber_glass');
    assert.ok(pane);
    const rest=pane.scale.y;
    instance.mixer.update(.5);
    assert.ok(Math.abs(pane.scale.y-rest)>.025*Math.abs(rest),
      `Beacon glass moves at half-second: rest ${rest}, now ${pane.scale.y}`);
    stopAnimatedAsset(instance.mixer,instance.model);
  }finally{
    if(previousCreateImageBitmap===undefined)delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap=previousCreateImageBitmap;
    if(previousSelf===undefined)delete globalThis.self;
    else globalThis.self=previousSelf;
  }
});

test('strong Beacon derivative visibly changes lantern height and position',async()=>{
  const raw=await readFile(new URL('../art/concept-v4-garden-bridge-beacon-strong.glb',import.meta.url));
  const bytes=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  const previousCreateImageBitmap=globalThis.createImageBitmap;
  const previousSelf=globalThis.self;
  globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
  globalThis.self=globalThis;
  try{
    const gltf=await new GLTFLoader().parseAsync(bytes,'');
    assert.equal(gltf.animations.length,1);
    const clip=gltf.animations[0];
    assert.equal(clip.name,'Lantern Beacon Strong');
    const instance=instantiateAnimatedAsset(gltf,{geometry:{animationClips:[
      {name:clip.name,durationSeconds:clip.duration}]}});
    const pane=instance.model.getObjectByName('left_near_lantern_inner_amber_glass');
    assert.ok(pane);
    instance.model.updateMatrixWorld(true);
    const restBounds=new Box3().setFromObject(pane);
    const restHeight=restBounds.getSize(new Vector3()).y;
    const restCenter=restBounds.getCenter(new Vector3()).y;
    instance.mixer.update(.5);
    instance.model.updateMatrixWorld(true);
    const movedBounds=new Box3().setFromObject(pane);
    assert.ok(movedBounds.getSize(new Vector3()).y-restHeight>.08,
      'the amber pane gains at least eight centimetres in height');
    assert.ok(movedBounds.getCenter(new Vector3()).y-restCenter>.05,
      'the amber pane rises at least five centimetres');
    stopAnimatedAsset(instance.mixer,instance.model);
  }finally{
    if(previousCreateImageBitmap===undefined)delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap=previousCreateImageBitmap;
    if(previousSelf===undefined)delete globalThis.self;
    else globalThis.self=previousSelf;
  }
});
