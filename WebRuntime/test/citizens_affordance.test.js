import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Box3,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ANCHOR_ID,MatrixWorld,validInteractionDescriptor} from '../src/protocol.js';
import {CitizensSimulation,citizensFurnitureReadiness,
  createCitizensWithSelectedFurniture} from '../src/citizens.js';

const sha='d'.repeat(64);
const asset={assetId:`web:shared-seat:${sha.slice(0,12)}`,
  displayName:'Shared seat',description:'Static registered furniture',
  spawnScale:1,sha256:sha,byteLength:1024,url:`/api/web/assets/${sha}.glb`,
  localBounds:{center:{x:0,y:.5,z:0},size:{x:1,y:1,z:1}},
  geometry:{animationClips:[]}};
const descriptor=()=>({schemaVersion:1,interactionId:'shared-seat-rest',
  kind:'rest',assetSha256:sha,
  requiredCapabilities:['static-virtual-floor','verified-rendered-bounds'],
  availability:['target-static','floor-aligned','rendered-verified'],
  approachPose:{x:0,z:.78},usePose:{x:0,z:.35},rangeMeters:.6,
  durationTicks:4,capacity:1,effect:{need:'energy',delta:31}});
const pose=(x,z)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
function setup({verify=true}={}){
  let sequence=0;
  const world=new MatrixWorld(()=>`seat-object-${++sequence}`);
  world.registerAssets([asset]);
  const receipt=world.execute({requestId:'spawn-shared-seat',op:'spawn',
    assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose(0,-2)});
  assert.equal(receipt.ok,true);
  const seatId=receipt.objectId;
  if(verify){
    assert.equal(world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},seatId),true);
    assert.equal(world.execute({requestId:'author-shared-seat',op:'set_interaction',
      objectId:seatId,interaction:descriptor(),expectedInteraction:null}).ok,true);
  }
  return {world,seatId};
}
const advanceUntil=(sim,predicate,limit=120)=>{
  for(let i=0;i<limit;i++){
    const state=sim.step();
    if(predicate(state))return state;
  }
  assert.fail(`Expected state did not occur within ${limit} ticks`);
};

test('the original demo chair matches its reviewed SHA, static geometry and poses',async()=>{
  const raw=await readFile(new URL('./fixtures/citizens-demo-chair.glb',import.meta.url));
  const reviewed=JSON.parse(await readFile(new URL(
    './fixtures/citizens-demo-chair-interaction.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(raw).digest('hex'),reviewed.assetSha256);
  assert.equal(validInteractionDescriptor(reviewed),true);
  const bytes=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  assert.deepEqual(gltf.animations,[]);
  const size=new Box3().setFromObject(gltf.scene).getSize(new Vector3());
  for(const [axis,expected] of [['x',.62],['y',.95],['z',.62]])
    assert.ok(Math.abs(size[axis]-expected)<1e-6,`${axis} measured bounds`);
});

test('a selected registered GLB seats one resident and grants only its receipt-backed benefit',()=>{
  const {world,seatId}=setup();
  assert.equal(citizensFurnitureReadiness(world,seatId),'');
  const sim=createCitizensWithSelectedFurniture(world,{seed:17,objectId:seatId});
  const initial=sim.snapshot();
  assert.equal(initial.schemaVersion,6);
  assert.deepEqual(initial.stations[0].interaction,descriptor());
  assert.equal(initial.stations[0].objectId,seatId);
  assert.equal(initial.stations[0].capacity,1);
  const first=sim.step();
  assert.equal(first.stations[0].claim.residentId,'ada');
  assert.equal(first.stations[0].waiters[0].residentId,'bo');
  const adaBefore=first.residents.find(item=>item.id==='ada').needs.energy;
  const uses=[];
  const execute=world.execute.bind(world);
  world.execute=(command,options)=>{
    const result=execute(command,options);
    if(command.op==='interact'&&command.targetObjectId===seatId)
      uses.push({command,result});
    return result;
  };
  const completed=advanceUntil(sim,state=>state.log.some(entry=>
    entry.residentId==='ada'&&entry.event==='completed'&&
    entry.message.includes('rest')));
  assert.equal(uses.length,1);
  assert.equal(uses[0].result.ok,true);
  assert.equal(uses[0].command.interactionId,'shared-seat-rest');
  assert.deepEqual(uses[0].result.outcome.effect,{need:'energy',delta:31});
  assert.ok(completed.residents.find(item=>item.id==='ada').needs.energy>adaBefore);
  assert.equal(world.requireObject(seatId).interaction.interactionId,'shared-seat-rest');
  assert.equal(world.scene.objects.length,3);
  const boCompleted=advanceUntil(sim,state=>state.log.some(entry=>
    entry.residentId==='bo'&&entry.event==='completed'&&
    entry.message.includes('rest')));
  assert.equal(uses.length,2);
  assert.ok(boCompleted.log.some(entry=>entry.residentId==='bo'&&
    entry.event==='blocked'&&entry.message.includes('occupied')));
});

test('the authored station restores with stable object IDs after its GLB is reverified',()=>{
  const {world,seatId}=setup();
  const sim=createCitizensWithSelectedFurniture(world,{seed:19,objectId:seatId});
  sim.step();sim.pause();
  const saved=sim.exportState(),scene=structuredClone(world.scene);
  let restoredSequence=0;
  const recovered=new MatrixWorld(()=>`restored-${++restoredSequence}`);
  recovered.registerAssets([asset]);
  assert.equal(recovered.execute({requestId:'load-shared-seat',op:'load',scene}).ok,true);
  const restored=CitizensSimulation.restore(recovered,saved);
  assert.deepEqual(restored.exportState(),saved);
  assert.equal(restored.resume().paused,true,
    'saved GLB does not inherit renderer verification across a reload');
  assert.equal(recovered.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},seatId),true);
  assert.equal(restored.resume().paused,false);
  const completed=advanceUntil(restored,state=>state.log.some(entry=>
    entry.event==='completed'&&entry.message.includes('rest')));
  assert.equal(completed.stations[0].objectId,seatId);
  assert.deepEqual(recovered.requireObject(seatId).interaction,descriptor());
});

test('removing a reviewed GLB definition interrupts its claim without granting energy',()=>{
  const {world,seatId}=setup();
  const sim=createCitizensWithSelectedFurniture(world,{seed:21,objectId:seatId});
  const first=sim.step();
  const energy=first.residents.find(item=>item.id==='ada').needs.energy;
  assert.equal(world.execute({requestId:'remove-shared-seat',op:'remove_interaction',
    objectId:seatId,expectedInteraction:descriptor()}).ok,true);
  const interrupted=sim.step();
  assert.equal(interrupted.paused,true);
  assert.equal(interrupted.clockTick,first.clockTick);
  assert.equal(interrupted.residents.find(item=>item.id==='ada').needs.energy,energy);
  assert.equal(interrupted.stations[0].claim,null);
  assert.ok(interrupted.log.some(entry=>entry.event==='failed'&&
    entry.message.includes('incompatible')));
  assert.throws(()=>sim.exportState(),/binding is missing or incompatible/);
});

test('an unverified or unreviewed registered GLB is unavailable as Citizens furniture',()=>{
  const {world,seatId}=setup({verify:false});
  assert.match(citizensFurnitureReadiness(world,seatId),/reviewed interaction/);
  assert.equal(world.execute({requestId:'premature-seat',op:'set_interaction',
    objectId:seatId,interaction:descriptor(),expectedInteraction:null}).ok,false);
  assert.equal(world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},seatId),true);
  assert.match(citizensFurnitureReadiness(world,seatId),/reviewed interaction/);
  assert.equal(world.execute({requestId:'reviewed-seat',op:'set_interaction',
    objectId:seatId,interaction:descriptor(),expectedInteraction:null}).ok,true);
  assert.equal(citizensFurnitureReadiness(world,seatId),'');
});
