import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Box3,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MatrixWorld} from '../src/protocol.js';
import {CITIZEN_BENCH_TRANSFORM,CITIZEN_GENERATED_PROFILE_ID,
  CitizensSimulation,citizenGeneratedRestInteraction,
  createCitizensDemo} from '../src/citizens.js';

const copy=value=>structuredClone(value);
const jobId='a'.repeat(32);
const spawnRequestId='b'.repeat(32);
const decision=(allowed,requestId=jobId,reason='')=>({allowed,requestId,reason,
  checkpointSequence:3});
function setup(){
  let sequence=0;
  const world=new MatrixWorld(()=>`generated-seat-${++sequence}`);
  const simulation=createCitizensDemo(world,{seed:29});
  simulation.resume();
  const first=simulation.step();
  assert.equal(first.stations[0].claim.residentId,'ada');
  assert.equal(first.stations[0].waiters[0].residentId,'bo');
  return {world,simulation};
}
async function registeredFixture(world){
  const raw=await readFile(new URL('./fixtures/citizens-demo-chair.glb',
    import.meta.url));
  const sha256=createHash('sha256').update(raw).digest('hex');
  const gltf=await new GLTFLoader().parseAsync(
    raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
  const box=new Box3().setFromObject(gltf.scene);
  const size=box.getSize(new Vector3());
  const center=box.getCenter(new Vector3());
  const assetId=`web:citizen-rest-seat:${sha256.slice(0,12)}`;
  const asset={assetId,displayName:'Citizen rest seat',description:'Blender seat',
    spawnScale:1,sha256,byteLength:raw.byteLength,
    url:`/api/web/assets/${sha256}.glb`,
    localBounds:{center:{x:center.x,y:center.y,z:center.z},
      size:{x:size.x,y:size.y,z:size.z}},geometry:{animationClips:[]}};
  world.registerAssets([asset]);
  return {assetId,sha256,size,asset};
}

test('generated seat request records an independent bounded need and denial',()=>{
  const {world,simulation}=setup();
  const original=copy(world.scene);
  const record=simulation.proposeGeneratedConstruction();
  assert.equal(record.residentId,'bo');
  assert.equal(record.status,'requested');
  assert.equal(simulation.proposeGeneratedConstruction(),null);
  const requested=simulation.exportState();
  const entry=requested.capabilityRequests[0];
  assert.equal(entry.request.capability,'asset');
  assert.equal(entry.request.action,'generate');
  assert.deepEqual(entry.request.parameters,{profileId:CITIZEN_GENERATED_PROFILE_ID,
    transform:CITIZEN_BENCH_TRANSFORM});
  assert.equal(entry.request.checkpoint.clockTick,1);
  assert.deepEqual(entry.request.checkpoint.objectIds,
    world.scene.objects.map(item=>item.objectId).sort());
  assert.deepEqual(Object.values(entry.work),[null,null,null,null,null,null]);
  assert.deepEqual(CitizensSimulation.restore(world,requested).exportState(),
    requested);
  const denied=simulation.capabilityDecision(decision(false,null,
    'Citizen generation budget exhausted'));
  assert.equal(denied.generatedConstruction.status,'denied');
  assert.equal(denied.capabilityRequests[0].status,'denied');
  assert.deepEqual(world.scene,original);
  assert.deepEqual(CitizensSimulation.restore(world,denied).exportState(),denied);
});

test('generated GLB requires exact registration, Matrix object and receipts before success and use',async()=>{
  const {world,simulation}=setup();
  simulation.proposeGeneratedConstruction();
  simulation.capabilityDecision(decision(true));
  assert.equal(simulation.snapshot().generatedConstruction.status,'generating');
  assert.equal(simulation.snapshot().capabilityRequests[0].work.jobId,jobId);
  const {assetId,sha256,size}=await registeredFixture(world);
  assert.throws(()=>simulation.generatedAssetRegistered({jobId,
    assetId,sha256:'0'.repeat(64)}),/matching registered generated GLB/);
  const registered=simulation.generatedAssetRegistered({jobId,assetId,sha256});
  assert.equal(registered.generatedConstruction.status,'registered');
  simulation.generatedSpawnQueued(spawnRequestId);
  const spawning=simulation.exportState();
  assert.equal(spawning.generatedConstruction.status,'spawning');
  assert.equal(spawning.capabilityRequests[0].work.spawnRequestId,
    spawnRequestId);
  const spawn=world.execute({requestId:spawnRequestId,op:'spawn',assetId,
    anchorId:'web-floor',transform:copy(CITIZEN_BENCH_TRANSFORM)},
  {recordHistory:false});
  assert.equal(spawn.ok,true,spawn.error);
  assert.equal(simulation.snapshot().generatedConstruction.status,'spawning');
  assert.throws(()=>simulation.generatedCapabilityCompleted([spawn,spawn]),
    /verified Matrix rest seat|exact Matrix receipts/);
  assert.equal(world.verifyPhysicsAsset(assetId,{x:size.x,y:size.y,z:size.z},
    spawn.objectId),true);
  const descriptor=citizenGeneratedRestInteraction(sha256);
  const interaction=world.execute({requestId:`${spawnRequestId}-interaction`,
    op:'set_interaction',objectId:spawn.objectId,
    interaction:descriptor,expectedInteraction:null},{recordHistory:false});
  assert.equal(interaction.ok,true,interaction.error);
  const completed=simulation.generatedCapabilityCompleted([spawn,interaction]);
  assert.equal(completed.generatedConstruction.status,'created');
  assert.equal(completed.capabilityRequests[0].status,'succeeded');
  assert.deepEqual(completed.capabilityRequests[0].receipts,[spawn,interaction]);
  assert.equal(completed.stations[2].id,'citizen-bench');
  assert.deepEqual(CitizensSimulation.restore(world,completed).exportState(),
    completed);
  for(const forge of [
    state=>{state.generatedConstruction.sha256='0'.repeat(64);
      state.capabilityRequests[0].work.sha256='0'.repeat(64);},
    state=>{state.capabilityRequests[0].receipts[0].requestId='f'.repeat(32);},
    state=>{state.capabilityRequests[0].receipts[1].objectId='absent';},
    state=>{state.capabilityRequests[0].policy.requestId='f'.repeat(32);}
  ]){
    const forged=copy(completed);
    forge(forged);
    assert.throws(()=>CitizensSimulation.restore(world,forged));
  }
  const uses=[];
  const execute=world.execute.bind(world);
  world.execute=(command,options)=>{
    const receipt=execute(command,options);
    if(command.op==='interact'&&command.targetObjectId===spawn.objectId)
      uses.push({command,receipt});
    return receipt;
  };
  let used;
  for(let i=0;i<160;i++){
    const state=simulation.step();
    if(state.generatedConstruction.status==='used'){used=state;break;}
  }
  assert.ok(used,'Bo must use the registered generated seat');
  assert.equal(uses.length,1);
  assert.equal(uses[0].receipt.ok,true,uses[0].receipt.error);
  assert.equal(uses[0].receipt.requestId,used.generatedConstruction.useRequestId);
  assert.equal(uses[0].receipt.outcome.targetObjectId,spawn.objectId);
  assert.deepEqual(CitizensSimulation.restore(world,used).exportState(),used);
});

test('generation failure and ambiguous spawn preserve safe terminal provenance',async()=>{
  const {world,simulation}=setup();
  simulation.proposeGeneratedConstruction();
  simulation.capabilityDecision(decision(true));
  const failed=simulation.generatedCapabilityFailed('Blender export failed');
  assert.equal(failed.generatedConstruction.status,'failed');
  assert.deepEqual(failed.capabilityRequests[0].receipts,[]);
  assert.deepEqual(CitizensSimulation.restore(world,failed).exportState(),failed);

  const second=setup();
  second.simulation.proposeGeneratedConstruction();
  second.simulation.capabilityDecision(decision(true));
  const {assetId,sha256}=await registeredFixture(second.world);
  second.simulation.generatedAssetRegistered({jobId,assetId,sha256});
  second.simulation.generatedSpawnQueued(spawnRequestId);
  const unknown=second.simulation.generatedCapabilityFailed(
    'Matrix spawn receipt is unconfirmed',{unconfirmed:true});
  assert.equal(unknown.generatedConstruction.status,'unconfirmed');
  assert.equal(unknown.capabilityRequests[0].status,'unconfirmed');
  assert.deepEqual(CitizensSimulation.restore(second.world,unknown)
    .exportState(),unknown);
});
