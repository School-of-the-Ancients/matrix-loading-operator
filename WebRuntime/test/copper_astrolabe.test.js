import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Box3,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

test('Copper Astrolabe GLB includes the revised static geometry',async()=>{
  const raw=await readFile(new URL('../art/copper-astrolabe/copper-astrolabe-final.glb',import.meta.url));
  const bytes=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  assert.equal(gltf.animations.length,0);
  let meshes=0;
  gltf.scene.traverse(object=>{if(object.isMesh)meshes++});
  // GLTFLoader expands multi-material primitives into more drawables than the
  // catalog's 51 glTF mesh definitions.
  assert.equal(meshes,59);
  assert.ok(gltf.scene.getObjectByName('CA_|_hand-faceted_blue_core_|_GLB'));
  for(let i=1;i<=3;i++)assert.ok(gltf.scene.getObjectByName(`CA_|_turquoise_gem_finial_${i}_|_GLB`));
  const size=new Box3().setFromObject(gltf.scene).getSize(new Vector3());
  assert.ok(size.x>2.8&&size.y>3.1&&size.z>1.4);
});
