import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin} from '@pixiv/three-vrm';
import {ProfessorMotion} from '../src/professor_motion.js';
const base=new URL('../art/professors/',import.meta.url);
const catalog=JSON.parse(readFileSync(new URL('catalog.json',base)));
globalThis.self=globalThis;
test('bundled scholar avatars load, speak and point with unchanged root transforms',async()=>{
  assert.equal(catalog.avatars.length,6);
  for(const item of catalog.avatars){
    const bytes=readFileSync(new URL(item.file,base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);
    assert(bytes.length<600000);
    const loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));
    const {userData:{vrm}}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    assert.equal(vrm.meta.metaVersion,'1');assert(vrm.lookAt);
    const root=vrm.scene,position=root.position.clone(),rotation=root.quaternion.clone();
    const motion=new ProfessorMotion(vrm);vrm.update(0);root.updateMatrixWorld(true);
    vrm.expressionManager.setValue('aa',1);
    const target=new THREE.Vector3(2,1.3,2);
    for(let i=0;i<120;i++){motion.update(1/60,{speaking:true,point:true,attentionTarget:target});vrm.update(1/60);}
    root.updateMatrixWorld(true);
    const arm=vrm.humanoid.getRawBoneNode('leftUpperArm').getWorldPosition(new THREE.Vector3());
    const hand=vrm.humanoid.getRawBoneNode('leftHand').getWorldPosition(new THREE.Vector3());
    assert(hand.sub(arm).normalize().dot(target.sub(arm).normalize())>.97,item.id);
    let mouth=false;root.traverse(node=>{if(node.morphTargetInfluences?.some(value=>value>.9))mouth=true;});
    assert(mouth,`${item.id} mouth opens`);assert(root.position.equals(position));assert(root.quaternion.equals(rotation));
  }
});
