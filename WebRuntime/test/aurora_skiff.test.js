import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {instantiateAnimatedAsset,stopAnimatedAsset} from '../src/asset_animation.js';

test('Aurora Skiff GLB cruises and plays Ion Burst on selection',async()=>{
  const raw=await readFile(new URL('../art/aurora-skiff.glb',import.meta.url));
  const bytes=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  const asset={geometry:{animationClips:[
    {name:'Cruise',durationSeconds:2.0416666666666665},
    {name:'Ion Burst',durationSeconds:1.5416666666666667}]}};
  const instance=instantiateAnimatedAsset(gltf,asset,
    {binding:{loopClip:'Cruise',selectClip:'Ion Burst'}});
  const wing=instance.model.getObjectByName('Wing_pivot_L');
  const halo=instance.model.getObjectByName('Jump_halo_rig');
  assert.ok(wing&&halo);
  assert.equal(typeof instance.select,'function');
  const wingBefore=wing.quaternion.clone();
  instance.mixer.update(.55);
  assert.ok(wing.quaternion.angleTo(wingBefore)>.01);
  instance.select();
  instance.mixer.update(.6);
  assert.ok(halo.scale.x>.1);
  assert.ok(wing.quaternion.angleTo(wingBefore)>.1);
  stopAnimatedAsset(instance.mixer,instance.model);
});
