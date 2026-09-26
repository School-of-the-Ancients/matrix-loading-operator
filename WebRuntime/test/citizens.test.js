import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {CitizensSimulation,createCitizensDemo} from '../src/citizens.js';

const world=()=>{
  let sequence=0;
  return new MatrixWorld(()=>`citizen-object-${++sequence}`);
};
const holder=station=>station.claim?.residentId??null;

test('demo creates two resident markers and shared stations from Matrix receipts',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:17});
  const initial=sim.snapshot();
  assert.equal(initial.paused,true);
  assert.equal(initial.clockTick,0);
  assert.deepEqual(matrix.scene.objects.map(object=>object.assetId),
    ['chair','table','orb','orb']);
  assert.equal(new Set(initial.residents.map(resident=>resident.objectId)).size,2);
  assert.equal(initial.stations.find(station=>station.id==='chair').capacity,1);
  assert.deepEqual(sim.advance(),initial,'a paused timer must not advance state');
  const first=sim.step();
  assert.equal(first.clockTick,1,'manual stepping works while paused');
  assert.equal(holder(first.stations.find(station=>station.id==='chair')),'ada');
  assert.equal(first.residents[0].activity.kind,'rest');
  assert.equal(first.residents[1].activity,null,'a waiter stays idle until its FIFO turn');
  assert.equal(first.stations.find(station=>station.id==='chair').waiters[0].residentId,'bo');
  assert.ok(first.log.some(entry=>entry.event==='blocked'&&entry.message.includes('chair occupied')));
  assert.equal(matrix.scene.objects.length,4);
});

test('a failed setup receipt rolls back earlier demo objects',()=>{
  const matrix=new MatrixWorld(()=> 'same-object-id');
  assert.throws(()=>createCitizensDemo(matrix,{seed:7}),/spawn failed/);
  assert.equal(matrix.scene.objects.length,0);
  assert.equal(matrix.undo.length,0);
});

test('movement, finite use and observed completion produce visible changing needs',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:22});
  const initial=sim.snapshot().residents.map(resident=>resident.needs);
  const startPositions=matrix.scene.objects.filter(object=>object.assetId==='orb')
    .map(object=>structuredClone(object.transform.position));
  let state;
  for(let i=0;i<60;i++){
    state=sim.step();
    for(const station of state.stations){
      assert.ok(holder(station)===null||state.residents.some(resident=>
        resident.id===holder(station)&&resident.activity?.stationId===station.id&&
        resident.activity.executionId===station.claim.executionId));
    }
    if(state.log.some(entry=>entry.event==='completed'&&entry.residentId==='ada'&&
         entry.message.includes('rest'))&&
       state.log.some(entry=>entry.event==='completed'&&entry.residentId==='bo'&&
         entry.message.includes('eat')))break;
  }
  const endPositions=matrix.scene.objects.filter(object=>object.assetId==='orb')
    .map(object=>object.transform.position);
  assert.notDeepEqual(endPositions,startPositions);
  assert.ok(state.log.some(entry=>entry.event==='arrived'&&entry.residentId==='ada'));
  assert.ok(state.log.some(entry=>entry.event==='completed'&&entry.residentId==='ada'));
  assert.ok(state.log.some(entry=>entry.event==='completed'&&entry.residentId==='bo'));
  assert.ok(state.residents[0].needs.energy>initial[0].energy);
  assert.ok(state.residents[1].needs.hunger>initial[1].hunger);
  assert.ok(state.residents.some(resident=>resident.needs.fun!==initial[
    state.residents.findIndex(item=>item.id===resident.id)].fun));
  assert.equal(matrix.undo.length,0,'simulation movement must not create authored Undo history');
  assert.ok(state.log.some(entry=>entry.event==='selected'&&entry.message.includes('score')));
});

test('the shared chair is released and a waiting resident eventually uses it',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:31});
  let state;
  for(let i=0;i<45;i++){
    state=sim.step();
    if(state.log.some(entry=>entry.event==='completed'&&entry.residentId==='bo'&&
      entry.message.includes('rest')))break;
  }
  assert.ok(state.log.some(entry=>entry.event==='blocked'&&entry.residentId==='bo'&&
    entry.message.includes('chair occupied')));
  assert.ok(state.log.some(entry=>entry.event==='completed'&&entry.residentId==='ada'&&
    entry.message.includes('rest')));
  assert.ok(state.log.some(entry=>entry.event==='completed'&&entry.residentId==='bo'&&
    entry.message.includes('rest')));
  assert.equal(holder(state.stations.find(station=>station.id==='chair')),null);
});

test('a deleted claimant retires, and its FIFO waiter proceeds without pausing',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  sim.resume();
  const first=sim.advance();
  const chair=first.stations.find(station=>station.kind==='rest');
  const waiter=chair.waiters[0];
  const ada=first.residents.find(resident=>resident.id==='ada');
  assert.equal(chair.claim.residentId,'ada');
  assert.equal(waiter.residentId,'bo');
  assert.equal(matrix.execute({requestId:'delete-ada',op:'delete',
    objectId:ada.objectId}).ok,true);
  const after=sim.advance();
  assert.equal(after.paused,false);
  assert.equal(after.clockTick,first.clockTick+1);
  assert.deepEqual(after.retiredResidentIds,['ada']);
  assert.deepEqual(after.residents.map(resident=>resident.id),['bo']);
  assert.equal(after.stations.find(station=>station.kind==='rest').claim.residentId,'bo');
  assert.equal(after.stations.find(station=>station.kind==='rest').claim.executionId,
    waiter.executionId,"the waiter's execution ID must survive handoff");
  assert.equal(after.stations.find(station=>station.kind==='rest').waiters.length,0);
  assert.ok(after.log.some(entry=>entry.event==='retired'&&entry.residentId==='ada'));
  assert.deepEqual(sim.exportState(),after);
  let completed=false;
  for(let i=0;i<40;i++){
    const state=sim.advance();
    if(state.log.some(entry=>entry.event==='completed'&&entry.residentId==='bo'&&
      entry.message.includes('rest'))){completed=true;break;}
  }
  assert.equal(completed,true,'the surviving waiter must finish using the chair');
});

test('a cancelled holder releases its claim and the waiting execution proceeds',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  const first=sim.step(),chair=first.stations.find(station=>station.kind==='rest');
  const ada=first.residents.find(resident=>resident.id==='ada');
  const waitingExecution=chair.waiters[0].executionId;
  const original=matrix.execute.bind(matrix);
  matrix.execute=(command,options)=>command.op==='set_transform'&&
    command.objectId===ada.objectId?{
      requestId:command.requestId,ok:false,error:'cancelled movement',objectId:''
    }:original(command,options);
  const after=sim.step();
  assert.equal(after.paused,true,'manual stepping retains the initial paused setting');
  assert.equal(after.residents.find(resident=>resident.id==='ada').activity,null);
  assert.equal(after.stations.find(station=>station.kind==='rest').claim.residentId,'bo');
  assert.equal(after.stations.find(station=>station.kind==='rest').claim.executionId,
    waitingExecution);
  assert.equal(after.stations.find(station=>station.kind==='rest').waiters.length,0);
  assert.ok(after.log.some(entry=>entry.event==='failed'&&entry.residentId==='ada'&&
    entry.message.includes('cancelled movement')));
  assert.deepEqual(sim.exportState(),after);
});

test('an expired claim releases its execution and hands the chair to the waiter',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  sim.step();
  const saved=sim.exportState(),chair=saved.stations.find(station=>station.kind==='rest');
  const waitingExecution=chair.waiters[0].executionId;
  const adaEnergy=saved.residents.find(resident=>resident.id==='ada').needs.energy;
  chair.claim.expiresTick=saved.clockTick+1;
  const restored=CitizensSimulation.restore(matrix,saved);
  const after=restored.step();
  assert.equal(holder(after.stations.find(station=>station.kind==='rest')),'bo');
  assert.equal(after.stations.find(station=>station.kind==='rest').claim.executionId,
    waitingExecution);
  assert.notEqual(after.residents.find(resident=>resident.id==='ada').activity?.kind,'rest');
  assert.ok(after.residents.find(resident=>resident.id==='ada').needs.energy<adaEnergy);
  assert.ok(after.log.some(entry=>entry.event==='expired'&&
    entry.message.includes('lease')));
  assert.deepEqual(restored.exportState(),after);
});

test('a bounded FIFO wait expires without granting an unobserved benefit',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  sim.step();
  const saved=sim.exportState(),chair=saved.stations.find(station=>station.kind==='rest');
  saved.clockTick=96;
  chair.claim.expiresTick=150;
  chair.waiters[0].enqueuedTick=1;
  const boEnergy=saved.residents.find(resident=>resident.id==='bo').needs.energy;
  const restored=CitizensSimulation.restore(matrix,saved);
  const after=restored.step();
  assert.equal(after.clockTick,97);
  assert.equal(chair.claim.residentId,'ada');
  assert.equal(after.stations.find(station=>station.kind==='rest').waiters.length,0);
  assert.equal(after.residents.find(resident=>resident.id==='bo').activity,null);
  assert.ok(after.residents.find(resident=>resident.id==='bo').needs.energy<boEnergy);
  assert.ok(after.log.some(entry=>entry.event==='expired'&&
    entry.message.includes('wait')));
  assert.deepEqual(restored.exportState(),after);
});

test('fixed seed and serialized mid-action state resume without duplicate spawn',()=>{
  const a=world(),b=world();
  const first=createCitizensDemo(a,{seed:123456});
  const second=createCitizensDemo(b,{seed:123456});
  first.resume();second.resume();
  for(let i=0;i<11;i++){
    assert.deepEqual(first.advance(),second.advance());
    assert.deepEqual(a.scene,b.scene);
  }
  first.pause();
  const saved=first.exportState();
  assert.equal(holder(saved.stations.find(station=>station.id==='chair')),'ada');
  assert.equal(saved.residents[0].activity.phase,'use');
  const savedScene=structuredClone(a.scene);
  const restoredWorld=world();
  assert.equal(restoredWorld.execute({requestId:'load',op:'load',scene:savedScene}).ok,true);
  const restored=CitizensSimulation.restore(restoredWorld,saved);
  assert.deepEqual(restored.exportState(),saved);
  assert.deepEqual(restored.reconcileWorld(),saved,
    'restoring a bound scene must establish its observed transform baseline');
  assert.equal(restoredWorld.scene.objects.length,4);
  for(let i=0;i<18;i++){
    assert.deepEqual(first.step(),restored.step());
    assert.deepEqual(a.scene,restoredWorld.scene);
  }
  assert.equal(restored.snapshot().log.filter(entry=>entry.event==='completed'&&
    entry.residentId==='ada'&&entry.message.includes('rest')).length,1,
  'a restored in-progress rest must grant its outcome once');
});

test('v1 mid-action state migrates atomically and replays deletion and FIFO handoff',()=>{
  const source=world(),sim=createCitizensDemo(source,{seed:31});
  sim.step();
  const legacy=sim.exportState();
  legacy.schemaVersion=1;
  delete legacy.actionSequence;
  delete legacy.retiredResidentIds;
  delete legacy.socialSession;
  delete legacy.socialEvents;
  delete legacy.relationships;
  delete legacy.nextSocialTick;
  for(const resident of legacy.residents){
    delete resident.socialSessionId;
    if(resident.activity)delete resident.activity.executionId;
  }
  legacy.stations=legacy.stations.map(station=>({id:station.id,kind:station.kind,
    objectId:station.objectId,capacity:station.capacity,
    holder:station.claim?.residentId??null}));
  legacy.log=legacy.log.filter(entry=>
    !['waiting','released','retired','expired'].includes(entry.event));
  const savedScene=structuredClone(source.scene);
  const restore=()=>{
    const matrix=world();
    assert.equal(matrix.execute({requestId:'load-fixture',op:'load',
      scene:savedScene}).ok,true);
    return {matrix,sim:CitizensSimulation.restore(matrix,legacy)};
  };
  const a=restore(),b=restore();
  for(const copy of [a,b]){
    const migrated=copy.sim.exportState();
    assert.equal(migrated.schemaVersion,3);
    assert.equal(migrated.actionSequence,1);
    assert.equal(migrated.stations.find(station=>station.kind==='rest').claim.executionId,
      migrated.residents.find(resident=>resident.id==='ada').activity.executionId);
    copy.sim.resume();
  }
  assert.deepEqual(a.sim.advance(),b.sim.advance());
  assert.equal(a.sim.snapshot().stations.find(station=>station.kind==='rest').waiters[0].residentId,
    'bo');
  const adaId=a.sim.snapshot().residents.find(resident=>resident.id==='ada').objectId;
  for(const copy of [a,b])assert.equal(copy.matrix.execute({requestId:'delete-ada',
    op:'delete',objectId:adaId}).ok,true);
  for(let i=0;i<30;i++){
    assert.deepEqual(a.sim.advance(),b.sim.advance());
    assert.deepEqual(a.matrix.scene,b.matrix.scene);
  }
  assert.deepEqual(a.sim.exportState().retiredResidentIds,['ada']);
  assert.ok(a.sim.snapshot().log.some(entry=>entry.event==='completed'&&
    entry.residentId==='bo'&&entry.message.includes('rest')));
});

test('rejected movement releases its claim without granting benefit',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:31});
  const original=matrix.execute.bind(matrix);
  matrix.execute=(command,options)=>command.op==='set_transform'?{
    requestId:command.requestId,ok:false,error:'test movement rejection',objectId:''
  }:original(command,options);
  const failed=sim.step();
  assert.equal(failed.residents[0].activity,null);
  assert.equal(holder(failed.stations.find(station=>station.id==='chair')),null);
  assert.equal(failed.residents[0].needs.energy,19.45);
  assert.ok(failed.log.some(entry=>entry.event==='failed'&&entry.message.includes('movement rejected')));
});

test('rejected observed interaction cannot grant a need benefit',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:31});
  const original=matrix.execute.bind(matrix);
  matrix.execute=(command,options)=>command.op==='interact'&&command.kind==='rest'?{
    requestId:command.requestId,ok:false,error:'seat unavailable',objectId:'',outcome:undefined
  }:original(command,options);
  let state;
  for(let i=0;i<18;i++)state=sim.step();
  assert.ok(state.log.some(entry=>entry.event==='failed'&&entry.residentId==='ada'&&
    entry.message.includes('seat unavailable')));
  assert.ok(!state.log.some(entry=>entry.event==='completed'&&entry.residentId==='ada'&&
    entry.message.includes('rest')));
  assert.ok(state.residents[0].needs.energy<20);
  assert.notEqual(holder(state.stations.find(station=>station.id==='chair')),'ada');
});

test('removing a reserved station cancels claims and lets survivors continue',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:31});
  sim.resume();
  sim.advance();
  const before=sim.snapshot();
  assert.equal(holder(before.stations.find(station=>station.id==='chair')),'ada');
  const beforeEnergy=before.residents[0].needs.energy;
  const chairId=before.stations.find(station=>station.id==='chair').objectId;
  assert.equal(matrix.execute({requestId:'remove-chair',op:'delete',objectId:chairId}).ok,true);
  const after=sim.advance();
  assert.equal(after.stations.some(station=>station.id==='chair'),false);
  assert.equal(after.clockTick,before.clockTick+1);
  assert.equal(after.paused,false);
  assert.ok(after.residents[0].needs.energy<=beforeEnergy,
    'a deleted chair cannot grant an unobserved rest benefit');
  assert.ok(after.log.some(entry=>entry.event==='retired'&&entry.message.includes('chair')));
  assert.deepEqual(sim.exportState(),after);
  let continued=false;
  for(let i=0;i<30;i++){
    const state=sim.advance();
    assert.equal(state.paused,false);
    assert.ok(state.residents.every(resident=>resident.activity?.kind!=='rest'),
      'a retired rest station cannot be selected as an exploration target');
    if(state.log.some(entry=>entry.event==='completed'&&
      (entry.message.includes('eat')||entry.message.includes('explore'))))
      continued=true;
    sim.exportState();
  }
  assert.equal(continued,true,'survivors continue with remaining activities');
  const scene=structuredClone(matrix.scene);
  assert.throws(()=>CitizensSimulation.restore(matrix,before),/missing or incompatible/);
  assert.deepEqual(matrix.scene,scene,'rejected restore must not change the world');
});

test('loading an identical scene cancels stale execution claims and wait tickets',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  sim.resume();
  const before=sim.advance();
  const adaEnergy=before.residents.find(resident=>resident.id==='ada').needs.energy;
  const chair=before.stations.find(station=>station.kind==='rest');
  assert.equal(chair.claim.residentId,'ada');
  assert.equal(chair.waiters[0].residentId,'bo');
  const sameScene=structuredClone(matrix.scene);
  assert.equal(matrix.execute({requestId:'reload-same-scene',op:'load',
    scene:sameScene}).ok,true);
  const after=sim.advance();
  assert.equal(after.paused,true);
  assert.equal(after.clockTick,before.clockTick);
  assert.equal(after.stations.find(station=>station.kind==='rest').claim,null);
  assert.equal(after.stations.find(station=>station.kind==='rest').waiters.length,0);
  assert.equal(after.residents.find(resident=>resident.id==='ada').needs.energy,adaEnergy);
  assert.ok(after.log.some(entry=>entry.event==='paused'&&
    entry.message.includes('Scene replacement')));
  assert.deepEqual(sim.exportState(),after);
});

test('own movement is observed without falsely interrupting a running simulation',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:17});
  sim.resume();
  const afterMove=sim.advance();
  assert.equal(afterMove.paused,false);
  assert.deepEqual(sim.reconcileWorld(),afterMove);
  assert.equal(sim.advance().clockTick,2);
  assert.equal(sim.snapshot().paused,false);
});

test('an authored resident move cancels its activity and releases its station',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:17});
  sim.resume();
  const before=sim.advance();
  const ada=before.residents.find(resident=>resident.id==='ada');
  assert.equal(ada.activity.kind,'rest');
  const transform=structuredClone(matrix.requireObject(ada.objectId).transform);
  transform.position.x+=.8;
  assert.equal(matrix.execute({requestId:'author-move-ada',op:'set_transform',
    objectId:ada.objectId,transform}).ok,true);
  const after=sim.reconcileWorld();
  assert.equal(after.paused,true);
  assert.equal(after.clockTick,before.clockTick);
  assert.equal(after.residents.find(resident=>resident.id==='ada').activity,null);
  assert.equal(after.residents.find(resident=>resident.id==='ada').needs.energy,ada.needs.energy);
  assert.equal(holder(after.stations.find(station=>station.kind==='rest')),null);
  assert.equal(after.residents.find(resident=>resident.id==='bo').activity,null);
  assert.equal(after.stations.find(station=>station.kind==='rest').waiters[0].residentId,'bo');
  assert.ok(after.log.some(entry=>entry.event==='failed'&&entry.residentId==='ada'&&
    entry.message.includes('moved externally')));
  assert.deepEqual(sim.advance(),after,'the paused timer must not resume on its own');
});

test('an authored station move cancels the holder before an interaction completes',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:17});
  sim.resume();
  const before=sim.advance();
  const chair=before.stations.find(station=>station.kind==='rest');
  const transform=structuredClone(matrix.requireObject(chair.objectId).transform);
  transform.position.z+=1;
  assert.equal(matrix.execute({requestId:'author-move-chair',op:'set_transform',
    objectId:chair.objectId,transform}).ok,true);
  const after=sim.reconcileWorld();
  assert.equal(after.paused,true);
  assert.equal(after.clockTick,before.clockTick);
  assert.equal(holder(after.stations.find(station=>station.kind==='rest')),null);
  assert.equal(after.residents.find(resident=>resident.id==='ada').activity,null);
  assert.ok(after.log.some(entry=>entry.event==='failed'&&entry.residentId==='ada'&&
    entry.message.includes('chair was moved externally')));
});

test('a running station component cancels its reservation and cannot be checkpointed',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:17});
  const before=sim.step();
  const chair=before.stations.find(station=>station.kind==='rest');
  const bo=before.residents.find(resident=>resident.id==='bo');
  const energy=before.residents.find(resident=>resident.id==='ada').needs.energy;
  const drift={schemaVersion:1,name:'Drift',outputs:{
    'position.x':{op:'add',args:[{op:'self',path:'position.x'},{op:'const',value:1}]}}};
  assert.equal(matrix.execute({requestId:'move-chair-component',op:'attach_component',
    objectId:chair.objectId,targetObjectId:bo.objectId,
    componentId:'webcomp:drift:0123456789ab',package:drift}).ok,true);
  const after=sim.reconcileWorld();
  assert.equal(after.paused,true);
  assert.equal(after.clockTick,before.clockTick);
  assert.equal(holder(after.stations.find(station=>station.kind==='rest')),null);
  assert.equal(after.residents.find(resident=>resident.id==='ada').activity,null);
  assert.equal(after.residents.find(resident=>resident.id==='ada').needs.energy,energy);
  assert.throws(()=>sim.exportState(),/binding is missing or incompatible/);
  assert.throws(()=>CitizensSimulation.restore(matrix,before),/station object is missing or incompatible/);
  assert.equal(matrix.execute({requestId:'stop-chair-component',op:'stop_component',
    objectId:chair.objectId}).ok,true);
  sim.reconcileWorld();
  assert.equal(holder(sim.exportState().stations.find(station=>station.kind==='rest')),null,
    'a stopped component is no longer moving the visible station');
});

test('an active station behavior interrupts its holder while a paused behavior does not',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:17});
  const chair=sim.snapshot().stations.find(station=>station.kind==='rest');
  const bob={kind:'bob',enabled:true,paused:true,axis:'y',speedDegreesPerSecond:0,
    amplitudeMeters:.2,frequencyHz:1};
  assert.equal(matrix.execute({requestId:'paused-chair-bob',op:'set_behavior',
    objectId:chair.objectId,behavior:bob}).ok,true);
  const paused=sim.snapshot();
  assert.deepEqual(sim.reconcileWorld(),paused);
  const before=sim.step();
  assert.equal(holder(before.stations.find(station=>station.kind==='rest')),'ada');
  assert.equal(matrix.execute({requestId:'run-chair-bob',op:'set_behavior',
    objectId:chair.objectId,behavior:{...bob,paused:false}}).ok,true);
  const after=sim.reconcileWorld();
  assert.equal(after.paused,true);
  assert.equal(after.clockTick,before.clockTick);
  assert.equal(holder(after.stations.find(station=>station.kind==='rest')),null);
  assert.equal(after.residents.find(resident=>resident.id==='ada').activity,null);
  assert.throws(()=>sim.exportState(),/binding is missing or incompatible/);
});

test('an active resident behavior releases its station before further movement',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:17});
  const before=sim.step(),ada=before.residents.find(resident=>resident.id==='ada');
  const bob={kind:'bob',enabled:true,paused:false,axis:'y',speedDegreesPerSecond:0,
    amplitudeMeters:.2,frequencyHz:1};
  assert.equal(matrix.execute({requestId:'run-ada-bob',op:'set_behavior',
    objectId:ada.objectId,behavior:bob}).ok,true);
  const after=sim.reconcileWorld();
  assert.equal(after.paused,true);
  assert.equal(after.clockTick,before.clockTick);
  assert.equal(after.residents.find(resident=>resident.id==='ada').activity,null);
  assert.equal(holder(after.stations.find(station=>station.kind==='rest')),null);
  assert.equal(after.residents.find(resident=>resident.id==='ada').needs.energy,ada.needs.energy);
});

test('restore rejects corrupt reservation and wrong room without changing Matrix scene',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:4});
  sim.step();
  const before=structuredClone(matrix.scene);
  const broken=sim.exportState();
  broken.stations.find(station=>station.id==='chair').claim.residentId='bo';
  assert.throws(()=>CitizensSimulation.restore(matrix,broken),/reservation/);
  const wrongRoom=sim.exportState();
  wrongRoom.world.roomId='elsewhere';
  assert.throws(()=>CitizensSimulation.restore(matrix,wrongRoom),/Invalid Citizens state/);
  assert.deepEqual(matrix.scene,before);
  assert.equal(matrix.scene.objects.length,4);
});

test('restore rejects a checkpoint missing an active activity station',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:29});
  sim.step();
  const saved=sim.exportState();
  saved.stations=saved.stations.filter(station=>station.kind!=='rest');
  const before=structuredClone(matrix.scene);
  assert.throws(()=>CitizensSimulation.restore(matrix,saved),/Invalid Citizens reservation/);
  assert.deepEqual(matrix.scene,before);
});

test('v2 restore rejects forged claims, wait tickets, bounds and unknown fields',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  sim.step();
  const valid=sim.exportState(),scene=structuredClone(matrix.scene);
  const variants=[
    state=>{state.stations[0].claim.executionId=state.stations[0].waiters[0].executionId;},
    state=>{state.stations[0].claim.expiresTick=state.clockTick+73;},
    state=>{state.stations[0].waiters[0].executionId=state.stations[0].claim.executionId;},
    state=>{state.stations[0].waiters[0].enqueuedTick=state.clockTick+1;},
    state=>{state.stations[0].waiters.push(structuredClone(state.stations[0].waiters[0]));},
    state=>{state.stations[0].extra=true;},
    state=>{state.retiredResidentIds.push('bo');},
    state=>{state.residents=[];state.paused=false;}
  ];
  for(const change of variants){
    const broken=structuredClone(valid);
    change(broken);
    assert.throws(()=>CitizensSimulation.restore(matrix,broken),/Invalid Citizens/);
    assert.deepEqual(matrix.scene,scene,'bad Citizens state must not mutate Matrix');
  }
});

test('deleting the last resident yields a valid paused zero-resident state',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  sim.resume();
  sim.advance();
  for(const resident of sim.snapshot().residents)
    assert.equal(matrix.execute({requestId:`delete-${resident.id}`,op:'delete',
      objectId:resident.objectId}).ok,true);
  const after=sim.advance();
  assert.equal(after.paused,true);
  assert.equal(after.clockTick,1);
  assert.equal(after.residents.length,0);
  assert.deepEqual(after.retiredResidentIds,['ada','bo']);
  assert.ok(after.stations.every(station=>station.claim===null&&station.waiters.length===0));
  assert.deepEqual(sim.exportState(),after);
  assert.deepEqual(sim.step(),after,'empty simulation must not advance');
  assert.deepEqual(sim.resume(),after,'empty simulation cannot run');
});

test('v2 checkpoints migrate to v3 without changing active claims or Matrix objects',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  sim.step();
  const saved=sim.exportState();
  saved.schemaVersion=2;
  delete saved.socialSession;delete saved.socialEvents;
  delete saved.relationships;delete saved.nextSocialTick;
  for(const resident of saved.residents)delete resident.socialSessionId;
  const scene=structuredClone(matrix.scene);
  const migrated=CitizensSimulation.restore(matrix,saved).exportState();
  assert.equal(migrated.schemaVersion,3);
  assert.deepEqual(migrated.stations,saved.stations);
  assert.deepEqual(migrated.relationships,[{a:'ada',b:'bo',score:50}]);
  assert.equal(migrated.socialSession,null);
  assert.ok(migrated.nextSocialTick>=35);
  assert.deepEqual(matrix.scene,scene);
});

test('fixed seed records decline, timeout and completion; only a receipt changes relationship',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:1});
  let previous=sim.snapshot();
  const allEvents=[];
  for(let i=0;i<300;i++){
    const state=sim.step();
    if(state.socialEvents.length>previous.socialEvents.length)
      allEvents.push(state.socialEvents.at(-1));
    const changed=state.relationships[0].score!==previous.relationships[0].score;
    assert.equal(changed,state.socialEvents.at(-1)?.event==='ended'&&
      state.socialEvents.at(-1).tick===state.clockTick,
    'relationship changes only on a matching observed social completion');
    previous=state;
  }
  assert.ok(allEvents.some(event=>event.event==='declined'));
  assert.ok(allEvents.some(event=>event.event==='timed_out'));
  assert.ok(allEvents.some(event=>event.event==='accepted'));
  const ended=allEvents.filter(event=>event.event==='ended');
  assert.equal(ended.length,2);
  assert.equal(previous.relationships[0].score,60);
  assert.ok(ended.every(event=>event.requestId.startsWith('citizens-1-social-')));
  assert.ok(previous.log.some(entry=>entry.event==='completed'&&
    entry.message.includes('Social ended')));
  assert.ok(previous.log.some(entry=>entry.event==='completed'&&
    entry.message.includes('rest')),
  'individual need actions continue alongside bounded social sessions');
  assert.deepEqual(sim.exportState(),previous);
});

test('an accepted mid-conversation checkpoint replays one observed end after restore',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
  while(sim.snapshot().clockTick<80)sim.step();
  assert.equal(sim.snapshot().socialSession?.phase,'active');
  assert.ok(sim.snapshot().socialSession.travelTicks>0);
  sim.pause();
  const saved=sim.exportState(),scene=structuredClone(matrix.scene);
  const restoredWorld=world();
  assert.equal(restoredWorld.execute({requestId:'load-social',op:'load',scene}).ok,true);
  const restored=CitizensSimulation.restore(restoredWorld,saved);
  assert.deepEqual(restored.exportState(),saved);
  for(let i=0;i<24;i++){
    assert.deepEqual(sim.step(),restored.step());
    assert.deepEqual(matrix.scene,restoredWorld.scene);
  }
  const after=restored.exportState();
  assert.equal(after.socialEvents.filter(event=>event.event==='ended').length,1);
  assert.equal(after.relationships[0].score,55);
  assert.equal(after.socialSession,null);
  assert.ok(after.residents.every(resident=>resident.socialSessionId===null));
});

test('a forged converse outcome interrupts the session without granting social benefit',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
  while(sim.snapshot().clockTick<77)sim.step();
  assert.equal(sim.snapshot().socialSession?.phase,'active');
  const original=matrix.execute.bind(matrix);
  matrix.execute=(command,options)=>{
    const receipt=original(command,options);
    if(command.op==='interact'&&command.kind==='converse'&&receipt.ok)
      receipt.outcome.sessionId='different-session';
    return receipt;
  };
  for(let i=0;i<30&&sim.snapshot().socialSession;i++)sim.step();
  const after=sim.exportState();
  assert.equal(after.socialSession,null);
  assert.equal(after.relationships[0].score,50);
  assert.equal(after.socialEvents.at(-1).event,'interrupted');
  assert.ok(after.residents.every(resident=>resident.socialSessionId===null));
  assert.ok(!after.socialEvents.some(event=>event.event==='ended'));
});

test('authored movement and deletion cancel both participants atomically',()=>{
  for(const mutation of ['move','delete']){
    const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
    sim.resume();
    while(sim.snapshot().clockTick<77)sim.step();
    const session=sim.snapshot().socialSession;
    const invitee=sim.snapshot().residents.find(item=>item.id===session.inviteeId);
    if(mutation==='move'){
      const object=matrix.scene.objects.find(item=>item.objectId===invitee.objectId);
      const transform=structuredClone(object.transform);
      transform.position.x+=1;
      assert.equal(matrix.execute({requestId:'move-invitee',op:'set_transform',
        objectId:invitee.objectId,transform}).ok,true);
    }else assert.equal(matrix.execute({requestId:'delete-invitee',op:'delete',
      objectId:invitee.objectId}).ok,true);
    const after=sim.reconcileWorld();
    assert.equal(after.socialSession,null);
    assert.equal(after.socialEvents.at(-1).event,'interrupted');
    assert.ok(after.residents.every(resident=>resident.socialSessionId===null));
    assert.equal(after.relationships[0].score,50);
    assert.equal(after.paused,mutation==='move');
    assert.deepEqual(sim.exportState(),after);
  }
});

test('explicit cancellation and scene replacement end a social session once',()=>{
  for(const mode of ['stop','replace']){
    const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
    while(sim.snapshot().clockTick<77)sim.step();
    const before=sim.snapshot();
    let after;
    if(mode==='stop'){
      after=sim.cancelSocial('operator stopped the Citizens demo');
      assert.deepEqual(sim.cancelSocial('duplicate stop'),after,
        'a repeated stop cannot add a second terminal event');
    }else{
      assert.equal(matrix.execute({requestId:'replace-scene',op:'load',
        scene:structuredClone(matrix.scene)}).ok,true);
      after=sim.reconcileWorld();
      assert.equal(after.paused,true);
    }
    assert.equal(after.socialSession,null);
    assert.equal(after.socialEvents.filter(event=>event.event==='interrupted').length,1);
    assert.equal(after.relationships[0].score,before.relationships[0].score);
    assert.ok(after.residents.every(resident=>resident.socialSessionId===null));
    assert.deepEqual(sim.exportState(),after);
  }
});

test('v3 restore rejects mismatched bilateral IDs, forged social events and unknown fields',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
  while(sim.snapshot().clockTick<77)sim.step();
  const saved=sim.exportState(),scene=structuredClone(matrix.scene);
  const variants=[
    state=>{state.residents[0].socialSessionId='other-session';},
    state=>{state.socialSession.expiresTick++;},
    state=>{state.socialSession.executionId=state.residents[0].activity?.executionId||0;},
    state=>{state.socialEvents[0].requestId='forged';},
    state=>{state.relationships[0].a='bo';},
    state=>{state.socialSession.extra=true;}
  ];
  for(const change of variants){
    const broken=structuredClone(saved);change(broken);
    assert.throws(()=>CitizensSimulation.restore(matrix,broken),/Invalid Citizens/);
    assert.deepEqual(matrix.scene,scene);
  }
});

test('v3 checkpoint text accepts paired Unicode and rejects unpaired UTF-16 surrogates',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
  const saved=sim.exportState();
  const valid=structuredClone(saved);
  valid.residents[0].name='🙂'.repeat(20);
  valid.residents[0].lastOutcome='🙂'.repeat(80);
  assert.deepEqual(CitizensSimulation.restore(matrix,valid).exportState(),valid);

  const invalidName=structuredClone(saved);
  invalidName.residents[0].name='\ud800';
  assert.throws(()=>CitizensSimulation.restore(matrix,invalidName),/Invalid Citizens resident/);

  const invalidId=structuredClone(saved);
  invalidId.residents[0].id='\udfff';
  invalidId.relationships=[{a:'bo',b:'\udfff',score:50}];
  assert.throws(()=>CitizensSimulation.restore(matrix,invalidId),/Invalid Citizens resident/);
});
