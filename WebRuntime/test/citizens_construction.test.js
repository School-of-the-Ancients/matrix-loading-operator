import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {createProceduralRecipe} from '../src/procedural.js';
import {CitizensSimulation,CITIZEN_BENCH_INTERACTION,
  CITIZEN_BENCH_TRANSFORM,createCitizensDemo} from '../src/citizens.js';

const clone=value=>structuredClone(value);
const allowed=requestId=>({allowed:true,requestId,reason:'',checkpointSequence:3});
const denied=reason=>({allowed:false,requestId:null,reason,checkpointSequence:3});
function setup(){
  let sequence=0;
  const world=new MatrixWorld(()=>`citizen-construction-${++sequence}`);
  const simulation=createCitizensDemo(world,{seed:29});
  simulation.resume();
  const first=simulation.step();
  assert.equal(first.stations.find(item=>item.id==='chair').claim.residentId,'ada');
  assert.equal(first.stations.find(item=>item.id==='chair').waiters[0].residentId,'bo');
  return {world,simulation};
}

test('an existing v12 Ada and Bo checkpoint gains an empty construction record',()=>{
  const {world,simulation}=setup();
  const current=simulation.exportState();
  const old=clone(current);
  old.schemaVersion=12;
  delete old.construction;
  delete old.capabilityRequests;
  delete old.generatedConstruction;
  const restored=CitizensSimulation.restore(world,old).exportState();
  assert.deepEqual(restored,current);
  assert.equal(restored.construction,null);
  assert.deepEqual(restored.capabilityRequests,[]);
});

test('Bo submits one durable need when Ada holds the only chair; denial is safe',()=>{
  const {world,simulation}=setup();
  const scene=clone(world.scene);
  const before=simulation.snapshot();
  const intent=simulation.proposeConstruction();
  assert.equal(intent.residentId,'bo');
  assert.equal(intent.blockedStationId,'chair');
  assert.equal(intent.waitExecutionId,before.stations[0].waiters[0].executionId);
  assert.equal(intent.intentId,`citizens-29-construction-${intent.waitExecutionId}`);
  assert.equal(intent.status,'requested');
  assert.equal(simulation.proposeConstruction(),null);
  const requested=simulation.exportState();
  const entry=requested.capabilityRequests[0];
  assert.equal(entry.request.residentId,'bo');
  assert.equal(entry.request.intentId,intent.intentId);
  assert.equal(entry.request.capability,'procedural');
  assert.equal(entry.request.action,'create');
  assert.equal(entry.request.checkpoint.clockTick,1);
  assert.deepEqual(entry.request.checkpoint.objectIds,
    world.scene.objects.map(item=>item.objectId).sort());
  assert.deepEqual(Object.keys(entry.request).sort(),
    ['citizenRequestId','intentId','residentId','capability','action',
      'parameters','checkpoint'].sort());
  assert.doesNotMatch(JSON.stringify(entry.request),
    /token|credential|secret|github|blender|mcp|apiKey/i);
  assert.deepEqual(CitizensSimulation.restore(world,requested).exportState(),requested);
  const refused=simulation.capabilityDecision(
    denied('one autonomous creation is outside budget'));
  assert.equal(refused.construction.status,'denied');
  assert.equal(refused.capabilityRequests[0].status,'denied');
  assert.equal(refused.construction.reason,'one autonomous creation is outside budget');
  assert.equal(refused.stations[0].waiters[0].residentId,'bo');
  assert.deepEqual(world.scene,scene);
  assert.equal(simulation.proposeConstruction(),null);
  assert.deepEqual(CitizensSimulation.restore(world,refused).exportState(),refused);
});

test('a preexisting human procedural addition leaves the Citizen quota unused',()=>{
  const {world,simulation}=setup();
  const added=world.execute({requestId:'operator-addition',
    op:'create_procedural',anchorId:'web-floor',
    procedural:createProceduralRecipe('curved-bench'),
    transform:clone(CITIZEN_BENCH_TRANSFORM)});
  assert.equal(added.ok,true,added.error);
  assert.equal(simulation.proposeConstruction(),null);
  assert.equal(simulation.snapshot().construction,null);
  assert.equal(world.scene.objects.length,5);
});

test('generic Citizen journal fails closed without an observed-world adapter',()=>{
  const {world,simulation}=setup();
  const boId=simulation.snapshot().residents.find(item=>item.id==='bo').objectId;
  const scene=clone(world.scene);
  const entry=simulation.requestCapability({intentId:'citizens-29-inspect-1',
    residentId:'bo',capability:'selection',action:'select',
    parameters:{objectId:boId}});
  assert.equal(entry.status,'requested');
  assert.equal(simulation.snapshot().construction,null);
  assert.equal(entry.request.citizenRequestId,
    'citizens-29-inspect-1/selection.select/1');
  const requestId='f'.repeat(32);
  const queued=simulation.capabilityDecision(allowed(requestId));
  assert.equal(queued.capabilityRequests[0].status,'queued');
  assert.equal(queued.construction,null);
  assert.throws(()=>simulation.capabilityCompleted([{requestId:'wrong',
    ok:true,error:'',objectId:boId}]),/approved Matrix receipt/);
  assert.equal(simulation.snapshot().capabilityRequests[0].status,'queued');
  const receipt=world.execute({requestId,op:'select',objectId:boId},
    {recordHistory:false});
  assert.equal(receipt.ok,true,receipt.error);
  assert.throws(()=>simulation.capabilityCompleted([receipt]),
    /no observed-world verifier/);
  const queuedAgain=simulation.exportState();
  assert.equal(queuedAgain.capabilityRequests[0].status,'queued');
  assert.deepEqual(queuedAgain.capabilityRequests[0].receipts,[]);
  const forged=clone(queuedAgain);
  forged.capabilityRequests[0].status='succeeded';
  forged.capabilityRequests[0].receipts=[receipt];
  assert.throws(()=>CitizensSimulation.restore(world,forged),
    /Invalid completed Citizens capability/);
  assert.equal(queuedAgain.construction,null);
  assert.deepEqual(world.scene,scene);
  assert.deepEqual(CitizensSimulation.restore(world,queuedAgain).exportState(),
    queuedAgain);

  const {world:deniedWorld,simulation:deniedSimulation}=setup();
  const deniedBoId=deniedSimulation.snapshot().residents.find(
    item=>item.id==='bo').objectId;
  const second=deniedSimulation.requestCapability({
    intentId:'citizens-29-unavailable-2',residentId:'bo',
    capability:'animation',action:'bind',parameters:{objectId:deniedBoId}});
  assert.equal(second.status,'requested');
  const refused=deniedSimulation.capabilityDecision(
    denied('Capability not allowed'));
  assert.equal(refused.capabilityRequests[0].status,'denied');
  assert.equal(refused.construction,null);
  assert.deepEqual(deniedWorld.scene.objects.length,4);
});

test('capability journal rejects values that JSON would change or omit',()=>{
  const {world,simulation}=setup();
  const boId=simulation.snapshot().residents.find(item=>item.id==='bo').objectId;
  const before=simulation.snapshot();
  const cycle={};cycle.self=cycle;
  for(const bad of [NaN,Infinity,-Infinity,undefined,new Date(),
    new Map([['x',1]]),cycle]){
    assert.throws(()=>simulation.requestCapability({
      intentId:'citizens-29-bad-value',residentId:'bo',
      capability:'selection',action:'select',
      parameters:{objectId:boId,bad}}),
    /unavailable or invalid/);
    assert.deepEqual(simulation.snapshot(),before);
  }
  const entry=simulation.requestCapability({intentId:'citizens-29-safe',
    residentId:'bo',capability:'selection',action:'select',
    parameters:{objectId:boId}});
  assert.equal(entry.status,'requested');
  const saved=simulation.exportState();
  for(const bad of [NaN,Infinity,undefined]){
    const forged=clone(saved);
    forged.capabilityRequests[0].request.parameters.bad=bad;
    assert.throws(()=>CitizensSimulation.restore(world,forged),
      /Invalid Citizens capability request/);
  }
  const requestId='8'.repeat(32);
  simulation.capabilityDecision(allowed(requestId));
  for(const bad of [NaN,Infinity,undefined]){
    assert.throws(()=>simulation.capabilityCompleted([{
      requestId,ok:true,error:'',objectId:boId,outcome:{bad}}]),
    /exact Matrix receipts/);
    const forged=simulation.snapshot();
    forged.capabilityRequests[0].status='failed';
    forged.capabilityRequests[0].reason='Matrix rejected the action';
    forged.capabilityRequests[0].receipts=[{
      requestId,ok:false,error:'Matrix rejected the action',
      objectId:'',outcome:{bad}}];
    assert.throws(()=>CitizensSimulation.restore(world,forged),
      /Invalid Citizens capability request/);
  }
  assert.equal(simulation.snapshot().capabilityRequests[0].status,'queued');
});

test('observed procedural and interaction receipts transfer Bo to the bench and one real use',()=>{
  const {world,simulation}=setup();
  const coreIds=world.scene.objects.map(item=>item.objectId);
  const residentIds=simulation.snapshot().residents.map(item=>item.objectId);
  const intent=simulation.proposeConstruction();
  const requestId='a'.repeat(32);
  simulation.capabilityDecision(allowed(requestId));
  const recipe=createProceduralRecipe('curved-bench');
  const created=world.execute({requestId,
    op:'create_procedural',anchorId:'web-floor',
    procedural:recipe,transform:clone(CITIZEN_BENCH_TRANSFORM)},
  {recordHistory:false});
  assert.equal(created.ok,true,created.error);
  assert.equal(simulation.exportState().construction.status,'queued',
    'a new object alone cannot complete construction');
  const reviewed=world.execute({requestId:`${requestId}-interaction`,
    op:'set_interaction',objectId:created.objectId,
    interaction:clone(CITIZEN_BENCH_INTERACTION),expectedInteraction:null},
  {recordHistory:false});
  assert.equal(reviewed.ok,true,reviewed.error);
  assert.throws(()=>simulation.capabilityCompleted([
    {...created,requestId:'wrong'},reviewed]),/approved Matrix receipt/);
  assert.equal(simulation.snapshot().construction.status,'queued');
  const bound=simulation.capabilityCompleted([created,reviewed]);
  assert.equal(bound.construction.status,'created');
  assert.equal(bound.construction.requestId,created.requestId);
  assert.equal(bound.construction.interactionRequestId,reviewed.requestId);
  assert.equal(bound.construction.objectId,created.objectId);
  assert.equal(bound.capabilityRequests[0].status,'succeeded');
  assert.deepEqual(bound.capabilityRequests[0].receipts,[created,reviewed]);
  assert.equal(bound.stations[0].waiters.length,0);
  assert.equal(bound.stations[2].id,'citizen-bench');
  assert.equal(bound.stations[2].claim.residentId,'bo');
  assert.equal(bound.stations[2].claim.executionId,intent.waitExecutionId);
  assert.equal(bound.residents.find(item=>item.id==='bo').activity.stationId,
    'citizen-bench');
  assert.deepEqual(world.scene.objects.slice(0,4).map(item=>item.objectId),coreIds);
  assert.deepEqual(bound.residents.map(item=>item.objectId),residentIds);
  const uses=[];
  const execute=world.execute.bind(world);
  world.execute=(command,options)=>{
    const receipt=execute(command,options);
    if(command.op==='interact'&&command.targetObjectId===created.objectId)
      uses.push({command,receipt});
    return receipt;
  };
  let used=null;
  for(let tick=0;tick<80;tick++){
    const state=simulation.step();
    if(state.construction.status==='used'){used=state;break;}
  }
  assert.ok(used,'Bo must reach and use the created bench');
  assert.equal(uses.length,1);
  assert.equal(uses[0].receipt.ok,true,uses[0].receipt.error);
  assert.equal(uses[0].receipt.outcome.actorObjectId,
    used.residents.find(item=>item.id==='bo').objectId);
  assert.equal(uses[0].receipt.outcome.targetObjectId,created.objectId);
  assert.equal(used.construction.useRequestId,uses[0].receipt.requestId);
  assert.ok(used.residents.find(item=>item.id==='bo').needs.energy>
    bound.residents.find(item=>item.id==='bo').needs.energy);
  const saved=simulation.exportState();
  assert.deepEqual(CitizensSimulation.restore(world,saved).exportState(),saved);
});

test('failed or mismatched construction never binds a phantom station',()=>{
  const {world,simulation}=setup();
  simulation.proposeConstruction();
  const requestId='b'.repeat(32);
  simulation.capabilityDecision(allowed(requestId));
  const before=simulation.snapshot();
  assert.throws(()=>simulation.capabilityCompleted([{requestId,
    ok:true,error:'',objectId:'absent'},
  {requestId:`${requestId}-interaction`,ok:true,error:'',objectId:'absent'}]),
  /reviewed Matrix bench/);
  assert.deepEqual(simulation.snapshot(),before);
  const failure={requestId,ok:false,error:'Matrix rejected the procedural recipe',
    objectId:''};
  const failed=simulation.capabilityFailed([failure],failure.error);
  assert.equal(failed.construction.status,'failed');
  assert.deepEqual(failed.capabilityRequests[0].receipts,[failure]);
  assert.equal(failed.stations.length,2);
  assert.equal(failed.stations[0].waiters[0].residentId,'bo');
  assert.equal(world.scene.objects.length,4);
  assert.deepEqual(CitizensSimulation.restore(world,failed).exportState(),failed);
});

test('failed interaction retains create, failure, and confirmed rollback receipts',()=>{
  const {world,simulation}=setup();
  simulation.proposeConstruction();
  const requestId='d'.repeat(32);
  simulation.capabilityDecision(allowed(requestId));
  const created=world.execute({requestId,op:'create_procedural',
    anchorId:'web-floor',procedural:createProceduralRecipe('curved-bench'),
    transform:clone(CITIZEN_BENCH_TRANSFORM)},{recordHistory:false});
  assert.equal(created.ok,true,created.error);
  const rejected=world.execute({requestId:`${requestId}-interaction`,
    op:'set_interaction',objectId:created.objectId,interaction:null,
    expectedInteraction:null},{recordHistory:false});
  assert.equal(rejected.ok,false);
  const rollback=world.execute({requestId:`${requestId}-rollback`,
    op:'delete',objectId:created.objectId},{recordHistory:false});
  assert.equal(rollback.ok,true,rollback.error);
  const failed=simulation.capabilityFailed([created,rejected,rollback],
    'Matrix rejected the reviewed interaction');
  assert.equal(failed.capabilityRequests[0].status,'failed');
  assert.deepEqual(failed.capabilityRequests[0].receipts,
    [created,rejected,rollback]);
  assert.equal(failed.construction.status,'failed');
  assert.equal(failed.stations.length,2);
  assert.equal(world.scene.objects.length,4);
  assert.deepEqual(CitizensSimulation.restore(world,failed).exportState(),failed);
});

test('v13 completed construction migrates without inventing historical receipts',()=>{
  const {world,simulation}=setup();
  simulation.proposeConstruction();
  const requestId='e'.repeat(32);
  simulation.capabilityDecision(allowed(requestId));
  const created=world.execute({requestId,op:'create_procedural',
    anchorId:'web-floor',procedural:createProceduralRecipe('curved-bench'),
    transform:clone(CITIZEN_BENCH_TRANSFORM)},{recordHistory:false});
  assert.equal(created.ok,true,created.error);
  const interaction=world.execute({requestId:`${requestId}-interaction`,
    op:'set_interaction',objectId:created.objectId,
    interaction:clone(CITIZEN_BENCH_INTERACTION),expectedInteraction:null},
  {recordHistory:false});
  assert.equal(interaction.ok,true,interaction.error);
  simulation.capabilityCompleted([created,interaction]);
  let completed=simulation.exportState();
  for(let tick=0;tick<80&&completed.construction.status!=='used';tick++)
    completed=simulation.step();
  assert.equal(completed.construction.status,'used');
  const legacy=clone(completed);
  legacy.schemaVersion=13;
  delete legacy.capabilityRequests;
  delete legacy.generatedConstruction;
  const restored=CitizensSimulation.restore(world,legacy).exportState();
  assert.equal(restored.schemaVersion,15);
  assert.deepEqual(restored.capabilityRequests,[]);
  assert.deepEqual(restored.construction,legacy.construction);
  assert.deepEqual(restored.residents.map(item=>item.objectId),
    legacy.residents.map(item=>item.objectId));
  assert.deepEqual(restored.stations.map(item=>item.objectId),
    legacy.stations.map(item=>item.objectId));
});

test('v14 restore rejects a valid bench recipe that differs from the saved request',()=>{
  const {world,simulation}=setup();
  simulation.proposeConstruction();
  const requestId='9'.repeat(32);
  simulation.capabilityDecision(allowed(requestId));
  const created=world.execute({requestId,op:'create_procedural',
    anchorId:'web-floor',procedural:createProceduralRecipe('curved-bench'),
    transform:clone(CITIZEN_BENCH_TRANSFORM)},{recordHistory:false});
  assert.equal(created.ok,true,created.error);
  const interaction=world.execute({requestId:`${requestId}-interaction`,
    op:'set_interaction',objectId:created.objectId,
    interaction:clone(CITIZEN_BENCH_INTERACTION),expectedInteraction:null},
  {recordHistory:false});
  assert.equal(interaction.ok,true,interaction.error);
  const saved=simulation.capabilityCompleted([created,interaction]);
  const object=world.scene.objects.find(item=>item.objectId===created.objectId);
  object.procedural=createProceduralRecipe('curved-bench',{lengthMeters:2.1});
  assert.equal(object.procedural.generatorId,'curved-bench');
  assert.throws(()=>CitizensSimulation.restore(world,saved),
    /recipe differs from its saved request/);
  assert.equal(saved.capabilityRequests[0].status,'succeeded');
});

test('a later Bo bench visit cannot claim the transferred wait as used',()=>{
  const {world,simulation}=setup();
  const original=simulation.proposeConstruction();
  const requestId='c'.repeat(32);
  simulation.capabilityDecision(allowed(requestId));
  const created=world.execute({requestId,
    op:'create_procedural',anchorId:'web-floor',
    procedural:createProceduralRecipe('curved-bench'),
    transform:clone(CITIZEN_BENCH_TRANSFORM)},{recordHistory:false});
  assert.equal(created.ok,true,created.error);
  const reviewed=world.execute({requestId:`${requestId}-interaction`,
    op:'set_interaction',objectId:created.objectId,
    interaction:clone(CITIZEN_BENCH_INTERACTION),expectedInteraction:null},
  {recordHistory:false});
  assert.equal(reviewed.ok,true,reviewed.error);
  simulation.capabilityCompleted([created,reviewed]);

  const bo=simulation.state.residents.find(item=>item.id==='bo');
  simulation.fail(bo,'the transferred trip was interrupted before use');
  const laterExecutionId=simulation.nextExecutionId();
  const bench=simulation.station('citizen-bench');
  bench.claim={residentId:'bo',executionId:laterExecutionId,
    expiresTick:simulation.state.clockTick+72};
  simulation.beginActivity(bo,'rest',bench,laterExecutionId,'a later bench visit');
  assert.notEqual(laterExecutionId,original.waitExecutionId);
  const uses=[];
  const execute=world.execute.bind(world);
  world.execute=(command,options)=>{
    const receipt=execute(command,options);
    if(command.op==='interact'&&command.targetObjectId===created.objectId)
      uses.push(receipt);
    return receipt;
  };
  for(let tick=0;tick<80&&uses.length===0;tick++)simulation.step();
  assert.equal(uses.length,1,'Bo should actually use the bench on the later trip');
  assert.equal(uses[0].ok,true,uses[0].error);
  assert.match(uses[0].requestId,
    new RegExp(`^citizens-29-action-${laterExecutionId}-`));
  const saved=simulation.exportState();
  assert.equal(saved.construction.status,'created');
  assert.equal(saved.construction.useRequestId,null);
  assert.deepEqual(CitizensSimulation.restore(world,saved).exportState(),saved);
});
