import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {createProceduralRecipe} from '../src/procedural.js';
import {CitizensSimulation,CITIZEN_BENCH_INTERACTION,
  CITIZEN_BENCH_TRANSFORM,createCitizensDemo} from '../src/citizens.js';

const clone=value=>structuredClone(value);
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
  const restored=CitizensSimulation.restore(world,old).exportState();
  assert.deepEqual(restored,current);
  assert.equal(restored.construction,null);
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
  assert.deepEqual(CitizensSimulation.restore(world,requested).exportState(),requested);
  const denied=simulation.constructionDenied('one autonomous creation is outside budget');
  assert.equal(denied.construction.status,'denied');
  assert.equal(denied.construction.reason,'one autonomous creation is outside budget');
  assert.equal(denied.stations[0].waiters[0].residentId,'bo');
  assert.deepEqual(world.scene,scene);
  assert.equal(simulation.proposeConstruction(),null);
  assert.deepEqual(CitizensSimulation.restore(world,denied).exportState(),denied);
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

test('observed procedural and interaction receipts transfer Bo to the bench and one real use',()=>{
  const {world,simulation}=setup();
  const coreIds=world.scene.objects.map(item=>item.objectId);
  const residentIds=simulation.snapshot().residents.map(item=>item.objectId);
  const intent=simulation.proposeConstruction();
  simulation.constructionQueued('citizen-create-bench-1');
  const recipe=createProceduralRecipe('curved-bench');
  const created=world.execute({requestId:'citizen-create-bench-1',
    op:'create_procedural',anchorId:'web-floor',
    procedural:recipe,transform:clone(CITIZEN_BENCH_TRANSFORM)},
  {recordHistory:false});
  assert.equal(created.ok,true,created.error);
  assert.equal(simulation.exportState().construction.status,'queued',
    'a new object alone cannot complete construction');
  const reviewed=world.execute({requestId:'citizen-create-bench-1-interaction',
    op:'set_interaction',objectId:created.objectId,
    interaction:clone(CITIZEN_BENCH_INTERACTION),expectedInteraction:null},
  {recordHistory:false});
  assert.equal(reviewed.ok,true,reviewed.error);
  assert.throws(()=>simulation.constructionCreated(
    {...created,requestId:'wrong'},reviewed),/matching Matrix receipts/);
  assert.equal(simulation.snapshot().construction.status,'queued');
  const bound=simulation.constructionCreated(created,reviewed);
  assert.equal(bound.construction.status,'created');
  assert.equal(bound.construction.requestId,created.requestId);
  assert.equal(bound.construction.interactionRequestId,reviewed.requestId);
  assert.equal(bound.construction.objectId,created.objectId);
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
  simulation.constructionQueued('citizen-create-bench-fail');
  const before=simulation.snapshot();
  assert.throws(()=>simulation.constructionCreated({requestId:'citizen-create-bench-fail',
    ok:true,error:'',objectId:'absent'},
  {requestId:'citizen-create-bench-fail-interaction',ok:true,error:'',objectId:'absent'}),
  /reviewed Matrix bench/);
  assert.deepEqual(simulation.snapshot(),before);
  const failed=simulation.constructionFailed('Matrix rejected the procedural recipe');
  assert.equal(failed.construction.status,'failed');
  assert.equal(failed.stations.length,2);
  assert.equal(failed.stations[0].waiters[0].residentId,'bo');
  assert.equal(world.scene.objects.length,4);
  assert.deepEqual(CitizensSimulation.restore(world,failed).exportState(),failed);
});

test('a later Bo bench visit cannot claim the transferred wait as used',()=>{
  const {world,simulation}=setup();
  const original=simulation.proposeConstruction();
  simulation.constructionQueued('later-visit-create');
  const created=world.execute({requestId:'later-visit-create',
    op:'create_procedural',anchorId:'web-floor',
    procedural:createProceduralRecipe('curved-bench'),
    transform:clone(CITIZEN_BENCH_TRANSFORM)},{recordHistory:false});
  assert.equal(created.ok,true,created.error);
  const reviewed=world.execute({requestId:'later-visit-create-interaction',
    op:'set_interaction',objectId:created.objectId,
    interaction:clone(CITIZEN_BENCH_INTERACTION),expectedInteraction:null},
  {recordHistory:false});
  assert.equal(reviewed.ok,true,reviewed.error);
  simulation.constructionCreated(created,reviewed);

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
