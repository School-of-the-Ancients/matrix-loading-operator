import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {instantiateAnimatedAsset,stopAnimatedAsset} from '../src/asset_animation.js';

test('Ice Dragon GLB flies and responds to selection with Frost Burst',async()=>{
  const raw=await readFile(new URL('../art/ice-dragon.glb',import.meta.url));
  const bytes=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  const asset={geometry:{animationClips:[
    {name:'Flight',durationSeconds:2.0416666666666665},
    {name:'Frost Burst',durationSeconds:1.5416666666666667}]}};
  const instance=instantiateAnimatedAsset(gltf,asset,{binding:{loopClip:'Flight',selectClip:'Frost Burst'}});
  const wing=instance.model.getObjectByName('Wing_hinge_L');
  const jaw=instance.model.getObjectByName('Hinged_lower_jaw');
  assert.ok(wing&&jaw);
  assert.equal(typeof instance.select,'function');
  const wingBefore=wing.quaternion.clone();
  instance.mixer.update(.3);
  assert.ok(wing.quaternion.angleTo(wingBefore)>.03);
  const jawBefore=jaw.quaternion.clone();
  instance.select();
  instance.mixer.update(.25);
  assert.ok(jaw.quaternion.angleTo(jawBefore)>.03);
  stopAnimatedAsset(instance.mixer,instance.model);
});
