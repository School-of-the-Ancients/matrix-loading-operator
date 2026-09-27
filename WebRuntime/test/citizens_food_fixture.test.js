import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Box3,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ANCHOR_ID,MatrixWorld,validInteractionDescriptor} from '../src/protocol.js';

const near=(actual,expected,label)=>
  assert.ok(Math.abs(actual-expected)<1e-5,`${label}: ${actual} versus ${expected}`);
const pose=(x,z,scale=1)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
  scale:{x:scale,y:scale,z:scale}});

test('original food-table GLB is self-contained, measured and usable for its exact reviewed eat effect',async()=>{
  const bytes=await readFile(new URL('./fixtures/citizens-demo-food-table.glb',import.meta.url));
  const descriptor=JSON.parse(await readFile(new URL(
    './fixtures/citizens-demo-food-table-interaction.json',import.meta.url),'utf8'));
  const sha=createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha,descriptor.assetSha256);
  assert.equal(validInteractionDescriptor(descriptor),true);
  assert.equal(descriptor.kind,'eat');
  assert.deepEqual(descriptor.effect,{need:'hunger',delta:32});
  const gltf=await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  assert.deepEqual(gltf.animations,[]);
  let meshes=0;
  gltf.scene.traverse(object=>{if(object.isMesh)meshes++;});
  assert.equal(meshes,12);
  const bounds=new Box3().setFromObject(gltf.scene);
  const size=bounds.getSize(new Vector3());
  const center=bounds.getCenter(new Vector3());
  near(bounds.min.y,0,'floor contact');
  for(const [axis,expected] of [['x',1.2],['y',.855],['z',.8]])
    near(size[axis],expected,`${axis} measured size`);
  for(const [axis,expected] of [['x',0],['y',.4275],['z',0]])
    near(center[axis],expected,`${axis} measured center`);

  const assetId=`web:citizens-demo-food-table:${sha.slice(0,12)}`;
  const world=new MatrixWorld(()=>`fixture-${++sequence}`);
  world.registerAssets([{assetId,displayName:'Citizens Demo Food Table',
    description:'Original static table with a bowl',spawnScale:1,sha256:sha,
    byteLength:bytes.byteLength,url:`/api/web/assets/${sha}.glb`,
    localBounds:{center:{x:0,y:.4275,z:0},size:{x:1.2,y:.855,z:.8}},
    geometry:{animationClips:[]}}]);
  const table=world.execute({requestId:'spawn-food-table',op:'spawn',
    assetId,anchorId:ANCHOR_ID,transform:pose(2,-2)});
  assert.equal(table.ok,true);
  assert.equal(world.verifyPhysicsAsset(assetId,{x:size.x,y:size.y,z:size.z},
    table.objectId),true);
  const authored=world.execute({requestId:'review-food-table',op:'set_interaction',
    objectId:table.objectId,interaction:descriptor,expectedInteraction:null});
  assert.equal(authored.ok,true,authored.error);
  const actor=world.execute({requestId:'spawn-food-table-actor',op:'spawn',
    assetId:'orb',anchorId:ANCHOR_ID,transform:pose(2,-2.9,.7)});
  assert.equal(actor.ok,true);
  const use=world.execute({requestId:'use-food-table',op:'interact',
    actorObjectId:actor.objectId,targetObjectId:table.objectId,kind:'eat',
    interactionId:descriptor.interactionId,expectedInteraction:descriptor});
  assert.equal(use.ok,true,use.error);
  assert.deepEqual(use.outcome.effect,descriptor.effect);
  assert.equal(use.outcome.interactionId,descriptor.interactionId);
});

let sequence=0;
