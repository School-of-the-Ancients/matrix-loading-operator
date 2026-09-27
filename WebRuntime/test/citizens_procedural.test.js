import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCHOR_ID,MatrixWorld} from '../src/protocol.js';
import {createProceduralRecipe,generateProcedural,
  reviseProceduralRecipe} from '../src/procedural.js';
import {CitizensSimulation,citizensFurnitureReadiness,
  createCitizensWithSelectedFurniture} from '../src/citizens.js';

const descriptor=()=>({schemaVersion:2,interactionId:'curved-seat-rest',
  kind:'rest',proceduralSource:{generatorId:'curved-bench',
    generatorVersion:'1.0.0',sourceRevision:'curved-bench-v1'},
  requiredCapabilities:['static-virtual-floor','reviewed-procedural-geometry'],
  availability:['target-static','floor-aligned','generator-available'],
  approachPose:{x:0,z:-.55},usePose:{x:0,z:-.05},rangeMeters:.7,
  durationTicks:4,capacity:1,effect:{need:'energy',delta:31}});
const pose=(x,z,yaw=0)=>({position:{x,y:0,z},
  rotation:{x:0,y:yaw,z:0},scale:{x:1,y:1,z:1}});

function setup(yaw=0){
  let sequence=0;
  const world=new MatrixWorld(()=>`procedural-citizens-${++sequence}`);
  const recipe=createProceduralRecipe('curved-bench');
  const created=world.execute({requestId:'create-curved-seat',
    op:'create_procedural',procedural:recipe,anchorId:ANCHOR_ID,
    transform:pose(0,-2,yaw)});
  assert.equal(created.ok,true,created.error);
  const benchId=created.objectId;
  const reviewed=world.execute({requestId:'review-curved-seat',
    op:'set_interaction',objectId:benchId,interaction:descriptor(),
    expectedInteraction:null});
  assert.equal(reviewed.ok,true,reviewed.error);
  return {world,recipe,benchId};
}

function advanceUntil(sim,predicate,limit=160){
  for(let i=0;i<limit;i++){
    const state=sim.step();
    sim.world.citizens=state;
    if(predicate(state))return state;
  }
  assert.fail(`Expected Citizens state within ${limit} ticks`);
}

test('navigation uses the procedural bounds center when routing to a wide curved bench',()=>{
  let sequence=0;
  const world=new MatrixWorld(()=>`wide-bench-${++sequence}`);
  const recipe=createProceduralRecipe('curved-bench',
    {lengthMeters:3,depthMeters:.8,arcDegrees:120});
  const bounds=generateProcedural(recipe).localBounds;
  assert.ok(bounds.center.z>.5,'the measured footprint is offset from the recipe root');
  const created=world.execute({requestId:'create-wide-bench',
    op:'create_procedural',procedural:recipe,anchorId:ANCHOR_ID,
    transform:pose(0,-2)});
  assert.equal(created.ok,true,created.error);
  const interaction={...descriptor(),approachPose:{x:0,z:-.65},
    rangeMeters:.8};
  const reviewed=world.execute({requestId:'review-wide-bench',
    op:'set_interaction',objectId:created.objectId,interaction,
    expectedInteraction:null});
  assert.equal(reviewed.ok,true,reviewed.error);
  const sim=createCitizensWithSelectedFurniture(world,
    {seed:31,objectId:created.objectId});
  assert.equal(sim.snapshot().stations[0].objectId,created.objectId);
  const completed=advanceUntil(sim,state=>state.log.some(entry=>
    entry.event==='completed'&&entry.message.includes('rest')));
  assert.ok(completed.log.some(entry=>entry.event==='completed'));
});

test('a rotated reviewed procedural bench is a selected station with a receipt-backed rest outcome and restore',()=>{
  const {world,benchId}=setup(90);
  assert.equal(citizensFurnitureReadiness(world,benchId),'');
  const sim=createCitizensWithSelectedFurniture(world,{seed:17,objectId:benchId});
  world.citizens=sim.snapshot();
  assert.deepEqual(sim.snapshot().stations[0].interaction,descriptor());
  const first=sim.step();
  world.citizens=first;
  const energy=first.residents.find(resident=>resident.id==='ada').needs.energy;
  const uses=[];
  const execute=world.execute.bind(world);
  world.execute=(command,options)=>{
    const receipt=execute(command,options);
    if(command.op==='interact'&&command.targetObjectId===benchId)
      uses.push({command,receipt});
    return receipt;
  };
  const completed=advanceUntil(sim,state=>state.log.some(entry=>
    entry.residentId==='ada'&&entry.event==='completed'&&
    entry.message.includes('rest')));
  assert.equal(uses.length,1);
  assert.equal(uses[0].receipt.ok,true,uses[0].receipt.error);
  assert.equal(uses[0].command.interactionId,descriptor().interactionId);
  assert.deepEqual(uses[0].receipt.outcome.effect,descriptor().effect);
  assert.ok(completed.residents.find(resident=>resident.id==='ada').needs.energy>energy);
  assert.equal(completed.stations[0].objectId,benchId);

  sim.pause();
  const saved=sim.exportState(),scene=structuredClone(world.scene);
  let sequence=0;
  const restoredWorld=new MatrixWorld(()=>`restored-bench-${++sequence}`);
  const loaded=restoredWorld.execute({requestId:'load-curved-seat',op:'load',scene});
  assert.equal(loaded.ok,true,loaded.error);
  const restored=CitizensSimulation.restore(restoredWorld,saved);
  assert.deepEqual(restored.exportState(),saved);
  assert.equal(restored.world.requireObject(benchId).interaction.interactionId,
    descriptor().interactionId);
});

test('active bench revision is rejected; a paused unclaimed revision keeps the station and IDs',()=>{
  const {world,recipe,benchId}=setup();
  const sim=createCitizensWithSelectedFurniture(world,{seed:23,objectId:benchId});
  world.citizens=sim.snapshot();
  const first=sim.step();
  world.citizens=first;
  assert.ok(first.stations[0].claim);
  const revised=reviseProceduralRecipe(recipe,{lengthMeters:2.2,arcDegrees:95});
  const blocked=world.execute({requestId:'active-bench-revision',
    op:'update_procedural',objectId:benchId,expectedProcedural:recipe,
    procedural:revised});
  assert.equal(blocked.ok,false);
  assert.match(blocked.error,/Pause Citizens and release this station/);
  assert.deepEqual(world.requireObject(benchId).procedural,recipe);
  assert.equal(sim.snapshot().clockTick,first.clockTick);

  // A separate paused state has no claim, waiter or resident activity.
  const fresh=setup();
  const paused=createCitizensWithSelectedFurniture(fresh.world,
    {seed:29,objectId:fresh.benchId});
  fresh.world.citizens=paused.snapshot();
  const changed=fresh.world.execute({requestId:'paused-bench-revision',
    op:'update_procedural',objectId:fresh.benchId,
    expectedProcedural:fresh.recipe,procedural:revised});
  assert.equal(changed.ok,true,changed.error);
  assert.equal(changed.objectId,fresh.benchId);
  assert.deepEqual(fresh.world.requireObject(fresh.benchId).interaction,descriptor());
  const reviewed=paused.reconcileWorld();
  assert.equal(reviewed.paused,true);
  assert.ok(reviewed.log.some(entry=>entry.message.includes('procedural geometry was revised')));
  assert.equal(reviewed.stations[0].objectId,fresh.benchId);
  assert.deepEqual(reviewed.residents.map(resident=>resident.objectId),
    fresh.world.scene.objects.filter(object=>object.assetId==='orb').map(object=>object.objectId));
  assert.doesNotThrow(()=>paused.exportState());
  assert.equal(paused.resume().paused,false);
  const completed=advanceUntil(paused,state=>state.log.some(entry=>
    entry.event==='completed'&&entry.message.includes('rest')));
  assert.equal(completed.stations[0].objectId,fresh.benchId);
});
