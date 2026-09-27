import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Box3,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MatrixWorld} from '../src/protocol.js';
import {CITIZEN_BENCH_TRANSFORM,CitizensSimulation,
  CITIZEN_BENCH_INTERACTION,citizenGeneratedRestInteraction,
  createCitizensDemo} from '../src/citizens.js';
import {projectCitizensInspector} from '../src/citizens_inspector.js';
import {createProceduralRecipe} from '../src/procedural.js';
import {storedWorld,restoreStoredWorld} from '../src/scene_store.js';

const copy=value=>structuredClone(value);
const deepFreeze=value=>{
  if(value&&typeof value==='object'){
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
const jobId='a'.repeat(32);
const spawnRequestId='b'.repeat(32);
const decision=(allowed,requestId=jobId,reason='')=>({allowed,requestId,reason,
  checkpointSequence:3});

function fixture(){
  let sequence=0;
  const world=new MatrixWorld(()=>`inspector-seat-${++sequence}`);
  const simulation=createCitizensDemo(world,{seed:29});
  simulation.resume();
  simulation.step();
  return {world,simulation};
}

async function registerSeat(world){
  const raw=await readFile(new URL('./fixtures/citizens-demo-chair.glb',
    import.meta.url));
  const sha256=createHash('sha256').update(raw).digest('hex');
  const gltf=await new GLTFLoader().parseAsync(
    raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
  const box=new Box3().setFromObject(gltf.scene);
  const size=box.getSize(new Vector3());
  const center=box.getCenter(new Vector3());
  const assetId=`web:citizen-rest-seat:${sha256.slice(0,12)}`;
  const asset={assetId,displayName:'Citizen rest seat',
    description:'Reviewed generated seat',spawnScale:1,sha256,
    byteLength:raw.byteLength,url:`/api/web/assets/${sha256}.glb`,
    localBounds:{center:{x:center.x,y:center.y,z:center.z},
      size:{x:size.x,y:size.y,z:size.z}},
    geometry:{animationClips:[]}};
  world.registerAssets([asset]);
  return {assetId,sha256,size,asset};
}

test('inspector explains seeded choice and contention without changing a frozen checkpoint',()=>{
  const {world,simulation}=fixture();
  const checkpoint=deepFreeze(simulation.snapshot());
  const before=copy(checkpoint);
  const scene=copy(world.scene);
  const view=projectCitizensInspector(checkpoint);
  assert.equal(view.tick,1);
  assert.deepEqual(view.residents.map(item=>item.name),['Ada','Bo']);
  const ada=view.residents[0],bo=view.residents[1];
  assert.equal(ada.reservation.mode,'claim');
  assert.equal(bo.reservation.mode,'queue');
  assert.equal(bo.reservation.queuePosition,1);
  assert.equal(bo.reservation.holderId,'ada');
  assert.match(bo.currentSummary,/Ada holds it/);
  assert.equal(bo.latestChoice.tick,1);
  assert.equal(bo.latestChoice.mode,'routine');
  assert.equal(bo.latestChoice.selectedKind,'rest');
  assert.equal(bo.latestChoice.candidates[0].score,56.39);
  assert.equal(bo.latestChoice.candidates[0].availabilityFactor,.6);
  assert.match(bo.latestChoice.why,/At minute 1, the recorded routine choice/);
  assert.match(bo.latestChoice.why,/current activity is shown separately/);
  assert.equal(bo.routines.find(item=>item.id==='evening-rest').active,true);
  assert.deepEqual(checkpoint,before);
  assert.deepEqual(world.scene,scene);
  const invalid=copy(checkpoint);
  invalid.residents[1].routines=null;
  assert.throws(()=>projectCitizensInspector(invalid),/validated checkpoint/);
  assert.deepEqual(world.scene,scene);
});

test('inspector follows generated request, policy, Matrix receipts, use and restart',
  async()=>{
    const {world,simulation}=fixture();
    simulation.proposeGeneratedConstruction();
    let view=projectCitizensInspector(simulation.snapshot());
    let capability=view.residents[1].capabilities[0];
    assert.equal(capability.status,'requested');
    assert.equal(capability.request.residentId,'bo');
    assert.equal(capability.request.checkpoint.clockTick,1);
    assert.equal(capability.request.capability,'asset');
    assert.equal(capability.request.action,'generate');
    assert.equal(capability.outcome.blockedStationId,'chair');
    assert.equal(capability.receipts.length,0);
    simulation.capabilityDecision(decision(true));
    capability=projectCitizensInspector(simulation.snapshot()).capabilities[0];
    assert.equal(capability.status,'generating');
    assert.equal(capability.policy.allowed,true);
    assert.equal(capability.work.jobId,jobId);
    assert.equal(capability.receipts.length,0);
    const {assetId,sha256,size,asset}=await registerSeat(world);
    simulation.generatedAssetRegistered({jobId,assetId,sha256});
    assert.equal(projectCitizensInspector(simulation.snapshot())
      .capabilities[0].status,'registered');
    simulation.generatedSpawnQueued(spawnRequestId);
    assert.equal(projectCitizensInspector(simulation.snapshot())
      .capabilities[0].status,'spawning');
    const spawn=world.execute({requestId:spawnRequestId,op:'spawn',assetId,
      anchorId:'web-floor',transform:copy(CITIZEN_BENCH_TRANSFORM)},
    {recordHistory:false});
    assert.equal(spawn.ok,true,spawn.error);
    assert.equal(world.verifyPhysicsAsset(assetId,
      {x:size.x,y:size.y,z:size.z},spawn.objectId),true);
    const interaction=world.execute({requestId:`${spawnRequestId}-interaction`,
      op:'set_interaction',objectId:spawn.objectId,
      interaction:citizenGeneratedRestInteraction(sha256),
      expectedInteraction:null},{recordHistory:false});
    assert.equal(interaction.ok,true,interaction.error);
    simulation.generatedCapabilityCompleted([spawn,interaction]);
    view=projectCitizensInspector(simulation.snapshot());
    capability=view.capabilities[0];
    assert.equal(capability.status,'succeeded');
    assert.equal(capability.outcome.status,'created');
    assert.equal(capability.outcome.objectId,spawn.objectId);
    assert.deepEqual(capability.receipts,[spawn,interaction]);
    assert.match(capability.summary,/observed Matrix creation/);
    assert.match(capability.summary,/use has not been recorded/);
    assert.equal(view.residents[1].latestChoice.tick,1);

    let used,active;
    for(let index=0;index<160;index++){
      const state=simulation.step();
      if(state.residents.find(item=>item.id==='bo')?.activity?.stationId===
         'citizen-bench'&&!active)active=state;
      if(state.generatedConstruction.status==='used'){
        used=state;
        break;
      }
    }
    assert.ok(active,'Bo reaches the created station');
    assert.match(projectCitizensInspector(active).residents[1].currentSummary,
      /rest seat created after Bo's wait for chair/);
    assert.ok(used,'Bo uses the new seat');
    assert.equal(used.clockTick,12);
    const useId=used.generatedConstruction.useRequestId;
    assert.ok(useId);
    capability=projectCitizensInspector(used).capabilities[0];
    assert.equal(capability.outcome.status,'used');
    assert.equal(capability.outcome.useRequestId,useId);
    assert.match(capability.summary,/used the object/);
    assert.deepEqual(capability.receipts,[spawn,interaction]);
    assert.equal(projectCitizensInspector(used).residents[1].latestChoice.tick,1);

    // A world checkpoint supplies the same authoritative scene and citizen
    // provenance to a fresh runtime. The projection adds nothing to the save.
    world.citizens=used;
    const saved=storedWorld(world);
    const restarted=new MatrixWorld();
    restarted.registerAssets([asset]);
    restoreStoredWorld(restarted,{...saved,originBinding:'virtual'});
    const restored=projectCitizensInspector(restarted.citizens);
    assert.equal(restored.tick,used.clockTick);
    assert.deepEqual(restored.capabilities[0],capability);
    assert.deepEqual(restored.residents.map(item=>item.id),['ada','bo']);
    assert.equal(restarted.scene.objects.filter(item=>
      item.objectId===spawn.objectId).length,1);
    const resumed=CitizensSimulation.restore(restarted,restarted.citizens);
    const interactions=[];
    const execute=restarted.execute.bind(restarted);
    restarted.execute=(command,options)=>{
      if(command.op==='interact'&&command.targetObjectId===spawn.objectId)
        interactions.push(command);
      return execute(command,options);
    };
    const next=resumed.step();
    assert.equal(next.generatedConstruction.useRequestId,useId);
    assert.equal(resumed.snapshot().generatedConstruction.status,'used');
    assert.equal(interactions.length,0);
    assert.ok(next.residents[1].needs.energy<=used.residents[1].needs.energy);

    const corrupt=copy(saved);
    corrupt.citizens.capabilityRequests[0].receipts[0].requestId='f'.repeat(32);
    const intact=storedWorld(restarted);
    assert.throws(()=>restoreStoredWorld(restarted,
      {...corrupt,originBinding:'virtual'}));
    assert.deepEqual(storedWorld(restarted),intact);
  });

test('budget denial has explicit policy and no false Matrix success',()=>{
  const {world,simulation}=fixture();
  const scene=copy(world.scene);
  simulation.proposeGeneratedConstruction();
  simulation.capabilityDecision(decision(false,null,
    'Citizen capability budget is exhausted'));
  const view=projectCitizensInspector(simulation.snapshot());
  const capability=view.residents[1].capabilities[0];
  assert.equal(capability.status,'denied');
  assert.equal(capability.policy.allowed,false);
  assert.equal(capability.policy.reason,'Citizen capability budget is exhausted');
  assert.equal(capability.receipts.length,0);
  assert.equal(capability.outcome.status,'denied');
  assert.equal(capability.outcome.objectId,null);
  assert.deepEqual(world.scene,scene);
});

test('failed generation explains its saved reason without exposing a service path',()=>{
  const first=fixture();
  first.simulation.proposeGeneratedConstruction();
  first.simulation.capabilityDecision(decision(true));
  first.simulation.generatedCapabilityFailed('Blender export failed');
  const failed=projectCitizensInspector(first.simulation.snapshot()).capabilities[0];
  assert.equal(failed.status,'failed');
  assert.equal(failed.reason,'Blender export failed');
  assert.equal(failed.outcome.reason,'Blender export failed');
  assert.equal(failed.receipts.length,0);

  const second=fixture();
  second.simulation.proposeGeneratedConstruction();
  second.simulation.capabilityDecision(decision(true));
  second.simulation.generatedCapabilityFailed('C:\\Users\\owner\\private\\asset.glb failed');
  const hidden=projectCitizensInspector(second.simulation.snapshot()).capabilities[0];
  assert.equal(hidden.reason,'An action failed; details are available to the owner.');
  assert.equal(hidden.outcome.reason,hidden.reason);
  assert.doesNotMatch(JSON.stringify(hidden),/private|asset\.glb/);
});

test('migrated procedural construction remains visible without invented receipts',()=>{
  const {world,simulation}=fixture();
  simulation.proposeConstruction();
  const requestId='e'.repeat(32);
  simulation.capabilityDecision(decision(true,requestId));
  const created=world.execute({requestId,op:'create_procedural',
    anchorId:'web-floor',procedural:createProceduralRecipe('curved-bench'),
    transform:copy(CITIZEN_BENCH_TRANSFORM)},{recordHistory:false});
  assert.equal(created.ok,true,created.error);
  const interaction=world.execute({requestId:`${requestId}-interaction`,
    op:'set_interaction',objectId:created.objectId,
    interaction:copy(CITIZEN_BENCH_INTERACTION),expectedInteraction:null},
  {recordHistory:false});
  assert.equal(interaction.ok,true,interaction.error);
  simulation.capabilityCompleted([created,interaction]);
  const older=simulation.snapshot();
  older.schemaVersion=13;
  delete older.capabilityRequests;
  delete older.generatedConstruction;
  const restored=CitizensSimulation.restore(world,older).snapshot();
  const legacy=projectCitizensInspector(restored).capabilities[0];
  assert.equal(legacy.status,'created');
  assert.equal(legacy.legacy,true);
  assert.equal(legacy.outcome.objectId,created.objectId);
  assert.equal(legacy.work.requestId,requestId);
  assert.deepEqual(legacy.receipts,[]);
  assert.match(legacy.summary,/exact capability journal was not stored/);
});
