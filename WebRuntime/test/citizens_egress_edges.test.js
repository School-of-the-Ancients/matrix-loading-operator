import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {CitizensSimulation,createCitizensDemo} from '../src/citizens.js';

const pose=(x,z)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
const resident=(state,id)=>state.residents.find(item=>item.id===id);
const chair=state=>state.stations.find(item=>item.id==='chair');
const position=(world,objectId)=>world.scene.objects.find(item=>
  item.objectId===objectId)?.transform.position;

function atAdaEgress(){
  let sequence=0;
  const world=new MatrixWorld(()=>`egress-edge-${++sequence}`);
  const sim=createCitizensDemo(world,{seed:31});
  for(let tick=0;tick<45;tick++){
    const state=sim.step();
    if(resident(state,'ada').activity?.phase==='egress'&&
      chair(state).waiters[0]?.residentId==='bo')return {world,sim,state};
  }
  assert.fail('Expected Ada to complete the chair use with Bo holding its FIFO ticket');
}

function stepUntil(sim,predicate,limit=110){
  for(let i=0;i<limit;i++){
    const state=sim.step();
    if(predicate(state))return state;
  }
  assert.fail(`Expected state within ${limit} simulation minutes`);
}

test('an unrelated wall at the waiter start does not make Ada retain a cleared chair',()=>{
  const {world,sim}=atAdaEgress();
  const ready=stepUntil(sim,state=>resident(state,'ada').activity?.phase==='egress'&&
    resident(state,'ada').activity.travelTicks===3,6);
  const bo=resident(ready,'bo'),boStart=position(world,bo.objectId);
  const boEnergy=bo.needs.energy;
  const waiter=structuredClone(chair(ready).waiters[0]);
  const wall=world.execute({requestId:'block-only-bo-start',op:'spawn',
    assetId:'wall',anchorId:'web-floor',transform:pose(boStart.x,boStart.z)});
  assert.equal(wall.ok,true,wall.error);

  const after=sim.step();
  const ada=resident(after,'ada');
  const adaPose=position(world,ada.objectId);
  const chairPose=position(world,chair(after).objectId);
  assert.ok(Math.hypot(adaPose.x-chairPose.x,adaPose.z-(chairPose.z+.62))>.36,
    'Ada has moved clear of the chair approach');
  assert.notEqual(chair(after).claim?.residentId,'ada',
    "a waiter start obstruction cannot hold the completed user's claim");
  assert.equal(chair(after).claim?.executionId??chair(after).waiters[0]?.executionId,
    waiter.executionId,'Bo keeps its original FIFO execution');
  assert.deepEqual(sim.exportState(),after);

  const terminal=stepUntil(sim,state=>state.log.some(entry=>
    entry.residentId==='bo'&&entry.tick>=after.clockTick&&
    (entry.event==='failed'||entry.event==='expired')),100);
  assert.equal(resident(terminal,'bo').activity,null);
  assert.equal(chair(terminal).claim?.residentId==='bo',false);
  assert.ok(resident(terminal,'bo').needs.energy<boEnergy,
    'an unreachable chair gives Bo no rest benefit');
  assert.deepEqual(sim.exportState(),terminal);
});

test('a global navigation pause during egress preserves the FIFO ticket through resume',()=>{
  const {world,sim,state}=atAdaEgress();
  const ticket=structuredClone(chair(state).waiters[0]);
  const claim=structuredClone(chair(state).claim);
  const wall=world.execute({requestId:'spawn-unrelated-moving-wall',op:'spawn',
    assetId:'wall',anchorId:'web-floor',transform:pose(6,6)});
  assert.equal(wall.ok,true,wall.error);
  const bob={kind:'bob',enabled:true,paused:false,axis:'y',
    speedDegreesPerSecond:0,amplitudeMeters:.2,frequencyHz:1};
  const animated=world.execute({requestId:'activate-unrelated-wall',
    op:'set_behavior',objectId:wall.objectId,behavior:bob});
  assert.equal(animated.ok,true,animated.error);

  const paused=sim.step();
  assert.equal(paused.paused,true);
  assert.equal(resident(paused,'ada').activity?.phase,'egress');
  assert.equal(chair(paused).claim?.executionId,claim.executionId);
  assert.deepEqual(chair(paused).waiters[0],ticket,
    'global navigation unavailability must not consume Bo\'s FIFO execution');
  assert.deepEqual(sim.exportState(),paused);

  const stopped=world.execute({requestId:'pause-unrelated-wall',
    op:'set_behavior',objectId:wall.objectId,behavior:{...bob,paused:true}});
  assert.equal(stopped.ok,true,stopped.error);
  assert.equal(sim.resume().paused,false);
  const handoff=stepUntil(sim,next=>chair(next).claim?.residentId==='bo',20);
  assert.equal(chair(handoff).claim.executionId,ticket.executionId);
  assert.deepEqual(sim.exportState(),handoff);
});

test('a mismatched egress receipt after real movement retains the claim until verified clearance',()=>{
  const {world,sim,state}=atAdaEgress();
  const ada=resident(state,'ada');
  const prior=structuredClone(position(world,ada.objectId));
  const claim=structuredClone(chair(state).claim);
  const execute=world.execute.bind(world);
  let altered=false,verifiedEgressMoves=0;
  world.execute=(command,options)=>{
    const receipt=execute(command,options);
    if(command.op==='set_transform'&&
      command.requestId?.includes('-egress-')&&receipt.ok){
      if(!altered){altered=true;return {...receipt,requestId:'mismatched-egress-receipt'};}
      verifiedEgressMoves++;
    }
    return receipt;
  };

  const uncertain=sim.step();
  assert.equal(altered,true);
  assert.notDeepEqual(position(world,ada.objectId),prior,
    'MatrixWorld applied the first move before its receipt was altered');
  assert.equal(uncertain.paused,true);
  assert.equal(chair(uncertain).claim?.executionId,claim.executionId);
  const reconciled=sim.reconcileWorld();
  assert.equal(chair(reconciled).claim?.executionId,claim.executionId,
    'reconciling the observed partial move must not release a used seat');
  assert.equal(resident(reconciled,'ada').activity?.phase,'egress');
  assert.deepEqual(sim.exportState(),reconciled);

  assert.equal(sim.resume().paused,false);
  const cleared=stepUntil(sim,next=>chair(next).claim?.residentId!=='ada',20);
  assert.ok(verifiedEgressMoves>0,
    'later receipt-backed moves must clear the approach before release');
  assert.deepEqual(sim.exportState(),cleared);
});

test('an expiring egress lease and near-timeout FIFO ticket remain checkpoint-valid',()=>{
  const {world,sim}=atAdaEgress();
  const saved=sim.exportState();
  saved.clockTick=95;
  saved.nextSocialTick=110;
  chair(saved).claim.expiresTick=96;
  chair(saved).waiters[0].enqueuedTick=0;
  const restored=CitizensSimulation.restore(world,saved);
  assert.deepEqual(restored.exportState(),saved,
    'the near-timeout input must itself be a valid checkpoint');

  const next=restored.step();
  assert.equal(next.clockTick,96);
  assert.equal(next.paused,true);
  assert.equal(chair(next).claim?.residentId,'ada',
    'expiring the departure lease cannot transfer an occupied seat');
  assert.equal(chair(next).waiters.length,0,
    'the FIFO ticket must be retired once its 96-minute wait limit is reached');
  assert.deepEqual(restored.exportState(),next,
    'a paused simulation must never yield an unsaveable state');
  assert.deepEqual(CitizensSimulation.restore(world,next).exportState(),next);
});

test('an identical scene replacement during egress retains the claim and FIFO ticket until clearance',()=>{
  const {world,sim,state}=atAdaEgress();
  const ada=resident(state,'ada');
  const claim=structuredClone(chair(state).claim);
  const ticket=structuredClone(chair(state).waiters[0]);
  const before=sim.exportState();
  const originalScene=world.scene;
  const replacement=structuredClone(originalScene);
  const loaded=world.execute({requestId:'replace-during-egress',op:'load',
    scene:replacement});
  assert.equal(loaded.ok,true,loaded.error);
  assert.notEqual(world.scene,originalScene);
  assert.deepEqual(world.scene.objects,replacement.objects,
    'the replacement retains the same objects and poses');

  const reconciled=sim.reconcileWorld();
  assert.equal(reconciled.paused,true,'scene replacement requires an explicit resume');
  assert.equal(resident(reconciled,'ada').activity?.phase,'egress');
  assert.equal(chair(reconciled).claim?.executionId,claim.executionId,
    'the used chair stays claimed while Ada remains at its approach');
  assert.deepEqual(chair(reconciled).waiters[0],ticket,
    'Bo retains his original FIFO ticket and execution');
  assert.equal(resident(reconciled,'ada').needs.energy,before.residents.find(item=>
    item.id==='ada').needs.energy,'reconciliation does not repeat the rest benefit');
  assert.deepEqual(sim.exportState(),reconciled);

  const execute=world.execute.bind(world);
  let verifiedEgressMoves=0;
  world.execute=(command,options)=>{
    const receipt=execute(command,options);
    if(command.op==='set_transform'&&command.objectId===ada.objectId&&
      command.requestId?.includes('-egress-')&&receipt.ok)verifiedEgressMoves++;
    return receipt;
  };
  assert.equal(sim.resume().paused,false);
  const handoff=stepUntil(sim,next=>chair(next).claim?.residentId==='bo',20);
  assert.ok(verifiedEgressMoves>0,
    'receipt-backed egress moves must precede release of the used chair');
  assert.equal(chair(handoff).claim.executionId,ticket.executionId);
  assert.equal(resident(handoff,'ada').activity,null);
  assert.deepEqual(sim.exportState(),handoff);
});
