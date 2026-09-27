import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {CitizensSimulation,citizensFurnitureReadiness,
  createCitizensDemo,createCitizensWithSelectedFurniture} from '../src/citizens.js';
import {segmentClear} from '../src/citizens_navigation.js';

const world=()=>{
  let sequence=0;
  return new MatrixWorld(()=>`citizen-object-${++sequence}`);
};
const holder=station=>station.claim?.residentId??null;
const appointmentOf=(state,residentId='ada',id='appointment-1')=>
  state.residents.find(item=>item.id===residentId).appointments.find(item=>item.id===id);
const pose=(x,z,yaw=0,scale=1)=>({position:{x,y:0,z},
  rotation:{x:0,y:yaw,z:0},scale:{x:scale,y:scale,z:scale}});
const spawn=(matrix,assetId,transform)=>{
  const receipt=matrix.execute({requestId:`authored-${assetId}-${matrix.scene.objects.length}`,
    op:'spawn',assetId,anchorId:'web-floor',transform});
  assert.equal(receipt.ok,true);
  return receipt.objectId;
};
const stepUntil=(sim,predicate,limit=600)=>{
  for(let i=0;i<limit;i++){
    const state=sim.snapshot();
    if(predicate(state))return state;
    sim.step();
  }
  throw Error(`Expected Citizens state was not reached within ${limit} ticks`);
};
const stripV9Fields=state=>{
  for(const resident of state.residents){
    delete resident.needs.social;
    delete resident.preferences.converse;
    delete resident.appointments;
    delete resident.appointmentSequence;
  }
};
const registeredObstacle=(hash='a'.repeat(64))=>({
  assetId:'web:citizens-obstacle',displayName:'Measured obstacle',
  description:'A static imported obstacle',spawnScale:1,
  localBounds:{center:{x:0,y:.5,z:0},size:{x:1,y:1,z:1}},
  sha256:hash,url:`/api/web/assets/${hash}.glb`,byteLength:1024
});

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

const simulationAtMinute=(seed,minute,needs={hunger:50,energy:50,fun:50})=>{
  const matrix=world();
  const created=createCitizensDemo(matrix,{seed});
  const state=created.exportState();
  state.clockTick=minute-1;
  state.nextSocialTick=minute+1000;
  for(const resident of state.residents)resident.needs={...resident.needs,...needs};
  return {matrix,simulation:CitizensSimulation.restore(matrix,state)};
};
const socialOpportunity=(seed=2)=>{
  const matrix=world(),state=createCitizensDemo(matrix,{seed}).exportState();
  state.clockTick=399;
  state.nextSocialTick=400;
  state.rngState=0x9e3779b9;
  for(const resident of state.residents){
    resident.needs={hunger:95,energy:95,fun:95,social:100};
    resident.routines=[];
  }
  return {matrix,state};
};

test('virtual clock speed is bounded, persisted, and independent of paused stepping',()=>{
  const matrix=world(),simulation=createCitizensDemo(matrix,{seed:29});
  assert.equal(simulation.snapshot().clockSpeed,1);
  assert.throws(()=>simulation.setClockSpeed(2),/speed must be 1, 4, or 16/);
  assert.throws(()=>simulation.setClockSpeed(true),/speed must be 1, 4, or 16/);
  simulation.setClockSpeed(16);
  assert.equal(simulation.advance().clockTick,0,'the timer skips a paused world');
  assert.equal(simulation.step().clockTick,1,'manual step advances one minute');
  const saved=simulation.exportState();
  assert.equal(saved.clockSpeed,16);
  assert.deepEqual(CitizensSimulation.restore(matrix,saved).exportState(),saved);
});

test('v6 worlds gain bounded daily routines without changing saved claims or scene',()=>{
  const matrix=world(),simulation=createCitizensDemo(matrix,{seed:17});
  simulation.step();
  const old=simulation.exportState(),scene=structuredClone(matrix.scene);
  old.schemaVersion=6;
  delete old.clockSpeed;
  stripV9Fields(old);
  for(const resident of old.residents){
    delete resident.routines;
    delete resident.lastDecision;
  }
  const restored=CitizensSimulation.restore(matrix,old).exportState();
  assert.equal(restored.schemaVersion,11);
  assert.equal(restored.clockSpeed,1);
  assert.deepEqual(restored.residents[0].routines.map(item=>item.id),
    ['morning-meal','morning-walk','daytime-walk','evening-rest']);
  assert.equal(restored.residents[0].lastDecision,null);
  assert.ok(restored.residents.every(resident=>resident.needs.social===50));
  assert.deepEqual(restored.residents.map(resident=>resident.preferences.converse),
    [1.2,1.1]);
  assert.deepEqual(restored.stations,old.stations);
  assert.deepEqual(matrix.scene,scene);
});

test('v7 virtual-day checkpoint migrates to v11 without changing its execution',()=>{
  const matrix=world(),simulation=createCitizensDemo(matrix,{seed:17});
  simulation.step();
  const old=simulation.exportState(),scene=structuredClone(matrix.scene);
  old.schemaVersion=7;
  stripV9Fields(old);
  const migrated=CitizensSimulation.restore(matrix,old).exportState();
  assert.equal(migrated.schemaVersion,11);
  const comparable=structuredClone(migrated);
  comparable.schemaVersion=7;
  stripV9Fields(comparable);
  assert.deepEqual(comparable,old);
  assert.ok(migrated.residents.every(resident=>resident.needs.social===50));
  assert.deepEqual(matrix.scene,scene);
});

test('v8 egress checkpoint migrates to v11 without changing claims or scene',()=>{
  const matrix=world(),simulation=createCitizensDemo(matrix,{seed:17});
  simulation.step();
  const old=simulation.exportState(),scene=structuredClone(matrix.scene);
  old.schemaVersion=8;
  stripV9Fields(old);
  const migrated=CitizensSimulation.restore(matrix,old).exportState();
  assert.equal(migrated.schemaVersion,11);
  const comparable=structuredClone(migrated);
  comparable.schemaVersion=8;
  stripV9Fields(comparable);
  assert.deepEqual(comparable,old);
  assert.deepEqual(migrated.residents.map(resident=>resident.needs.social),[50,50]);
  assert.deepEqual(migrated.residents.map(resident=>resident.preferences.converse),
    [1.2,1.1]);
  assert.deepEqual(matrix.scene,scene);
});

test('v9 social-needs state gains empty v11 appointments without changing execution',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  sim.step();
  const old=sim.exportState(),scene=structuredClone(matrix.scene);
  old.schemaVersion=9;
  for(const resident of old.residents){
    delete resident.appointments;
    delete resident.appointmentSequence;
  }
  const migrated=CitizensSimulation.restore(matrix,old).exportState();
  assert.equal(migrated.schemaVersion,11);
  assert.ok(migrated.residents.every(item=>
    Array.isArray(item.appointments)&&item.appointments.length===0&&
    item.appointmentSequence===0));
  const comparable=structuredClone(migrated);
  comparable.schemaVersion=9;
  for(const resident of comparable.residents){
    delete resident.appointments;
    delete resident.appointmentSequence;
  }
  assert.deepEqual(comparable,old);
  assert.deepEqual(matrix.scene,scene);
});

test('v10 terminal appointments migrate with a monotonic sequence and permit day-later booking',()=>{
  const matrix=world(),state=createCitizensDemo(matrix,{seed:29}).exportState();
  state.schemaVersion=10;
  state.clockTick=1447;
  for(const resident of state.residents)delete resident.appointmentSequence;
  state.residents[0].appointments=[2,3,4].map((deadline,index)=>({
    id:`appointment-${index+1}`,kind:'eat',startTick:1,deadlineTick:deadline,
    status:'missed',executionId:null,resolvedTick:deadline+1,
    requestId:null,reason:'deadline passed'}));
  const before=structuredClone(state),scene=structuredClone(matrix.scene);
  const sim=CitizensSimulation.restore(matrix,state);
  const migrated=sim.exportState();
  assert.equal(migrated.schemaVersion,11);
  assert.equal(migrated.residents[0].appointmentSequence,3);
  assert.equal(migrated.residents[0].appointments.length,3);
  assert.deepEqual(state,before);
  assert.deepEqual(matrix.scene,scene);
  const scheduled=sim.scheduleAppointment('ada',{
    kind:'rest',startTick:1448,deadlineTick:1480});
  assert.equal(appointmentOf(scheduled,'ada','appointment-4').status,'pending');
  assert.equal(scheduled.residents[0].appointmentSequence,4);
  assert.equal(scheduled.residents[0].appointments.length,4);
});

test('a due appointment selects a hard goal and completes only with its Matrix receipt',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  const receipts=[],original=matrix.execute.bind(matrix);
  matrix.execute=(command,options)=>{
    const receipt=original(command,options);
    if(command.op==='interact'&&command.kind==='eat')receipts.push(receipt);
    return receipt;
  };
  const scheduled=sim.scheduleAppointment('ada',{
    kind:'eat',startTick:1,deadlineTick:60});
  assert.equal(scheduled.schemaVersion,11);
  assert.deepEqual(appointmentOf(scheduled),{
    id:'appointment-1',kind:'eat',startTick:1,deadlineTick:60,
    status:'pending',executionId:null,resolvedTick:null,requestId:null,reason:''});
  const started=sim.step();
  const appointment=appointmentOf(started);
  assert.equal(appointment.status,'active');
  assert.equal(started.residents[0].activity.executionId,appointment.executionId);
  assert.equal(started.residents[0].lastDecision.mode,'appointment');
  assert.equal(started.residents[0].lastDecision.selectedAppointmentId,appointment.id);
  assert.equal(started.residents[0].lastDecision.candidates.length,1);
  const hungerBefore=started.residents[0].needs.hunger;
  const completed=stepUntil(sim,state=>appointmentOf(state).status==='completed',60);
  const outcome=appointmentOf(completed);
  assert.ok(outcome.resolvedTick<=outcome.deadlineTick);
  assert.equal(outcome.requestId,receipts.find(item=>item.requestId===outcome.requestId)?.requestId);
  assert.ok(completed.residents[0].needs.hunger>hungerBefore,
    'need benefit follows the observed interaction outcome');
  assert.equal(completed.residents[0].activity?.phase,'egress');
  assert.deepEqual(sim.exportState(),completed);
});

test('an observed receipt on the inclusive deadline completes, one tick later misses',()=>{
  const create=deadlineTick=>{
    const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
    const receipts=[],original=matrix.execute.bind(matrix);
    matrix.execute=(command,options)=>{
      const receipt=original(command,options);
      if(command.op==='interact'&&command.kind==='eat')
        receipts.push({tick:sim.snapshot().clockTick,receipt});
      return receipt;
    };
    sim.scheduleAppointment('ada',{
      kind:'eat',startTick:1,deadlineTick});
    return {sim,receipts};
  };
  const baseline=create(60);
  const observed=stepUntil(baseline.sim,state=>
    appointmentOf(state).status==='completed',60);
  const receiptTick=appointmentOf(observed).resolvedTick;
  assert.ok(receiptTick>2);
  assert.ok(baseline.receipts.some(item=>item.tick===receiptTick&&
    item.receipt.ok&&item.receipt.requestId===appointmentOf(observed).requestId));

  const onDeadline=create(receiptTick);
  const completed=stepUntil(onDeadline.sim,state=>
    appointmentOf(state).status==='completed',receiptTick+1);
  assert.equal(appointmentOf(completed).resolvedTick,receiptTick);
  assert.equal(appointmentOf(completed).deadlineTick,receiptTick);
  assert.ok(onDeadline.receipts.some(item=>item.tick===receiptTick&&
    item.receipt.ok&&item.receipt.requestId===appointmentOf(completed).requestId));

  const afterDeadline=create(receiptTick-1);
  const missed=stepUntil(afterDeadline.sim,state=>
    appointmentOf(state).status==='missed',receiptTick+1);
  assert.equal(missed.clockTick,receiptTick);
  assert.equal(appointmentOf(missed).resolvedTick,receiptTick);
  assert.equal(appointmentOf(missed).deadlineTick+1,receiptTick);
  assert.equal(appointmentOf(missed).requestId,null);
  assert.equal(appointmentOf(missed).reason,'deadline passed');
  assert.ok(afterDeadline.receipts.some(item=>item.tick===receiptTick&&
    item.receipt.ok),
  'a receipt on the next tick still grants its intrinsic need outcome');
});

test('a busy resident misses the deadline without interrupting its claim or FIFO peer',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:17});
  const busy=sim.step();
  assert.equal(holder(busy.stations.find(item=>item.kind==='rest')),'ada');
  assert.equal(busy.stations.find(item=>item.kind==='rest').waiters[0].residentId,'bo');
  sim.scheduleAppointment('ada',{kind:'eat',startTick:2,deadlineTick:3});
  assert.equal(sim.step().clockTick,2);
  const onDeadline=sim.step();
  assert.equal(onDeadline.clockTick,3);
  assert.equal(appointmentOf(onDeadline).status,'pending');
  const missed=sim.step();
  assert.equal(missed.clockTick,4);
  assert.equal(appointmentOf(missed).status,'missed');
  assert.equal(appointmentOf(missed).resolvedTick,4);
  assert.equal(appointmentOf(missed).requestId,null);
  assert.equal(missed.residents[0].activity?.kind,'rest');
  assert.equal(holder(missed.stations.find(item=>item.kind==='rest')),'ada');
  assert.equal(missed.stations.find(item=>item.kind==='rest').waiters[0].residentId,'bo');
  assert.deepEqual(sim.exportState(),missed);
});

test('overlapping one-shot deadlines keep their order across midnight at 16x',()=>{
  const create=()=>{
    const fixture=simulationAtMinute(29,1440,
      {hunger:95,energy:20,fun:95,social:100});
    const sim=fixture.simulation;
    sim.scheduleAppointment('ada',{kind:'rest',startTick:1440,deadlineTick:1490});
    sim.scheduleAppointment('ada',{kind:'eat',startTick:1440,deadlineTick:1475});
    sim.setClockSpeed(16);
    sim.resume();
    return fixture;
  };
  const left=create(),right=create();
  for(let minute=0;minute<16;minute++){
    assert.deepEqual(left.simulation.advance(),right.simulation.advance());
    assert.deepEqual(left.matrix.scene,right.matrix.scene);
  }
  const state=left.simulation.exportState();
  assert.equal(state.clockTick,1455);
  assert.equal(state.clockSpeed,16);
  assert.equal(state.residents[0].lastDecision.selectedAppointmentId,'appointment-2',
    'earlier deadline wins even when listed second');
  assert.equal(appointmentOf(state,'ada','appointment-2').status,'active');
  assert.equal(appointmentOf(state,'ada','appointment-1').status,'pending');
  assert.equal(state.socialSession,null);
});

test('critical hunger overrides rest but links a due meal to the urgent execution',()=>{
  const needs={hunger:14,energy:10,fun:95,social:100};
  const rest=simulationAtMinute(29,1,needs);
  rest.simulation.scheduleAppointment('ada',{
    kind:'rest',startTick:1,deadlineTick:40});
  const fedFirst=rest.simulation.step();
  assert.equal(fedFirst.residents[0].activity?.kind,'eat');
  assert.equal(appointmentOf(fedFirst).status,'pending');
  assert.equal(fedFirst.residents[0].lastDecision.mode,'needs');
  const meal=simulationAtMinute(29,1,needs);
  meal.simulation.scheduleAppointment('ada',{
    kind:'eat',startTick:1,deadlineTick:40});
  const linked=meal.simulation.step();
  assert.equal(linked.residents[0].activity?.kind,'eat');
  assert.equal(appointmentOf(linked).status,'active');
  assert.equal(appointmentOf(linked).executionId,
    linked.residents[0].activity.executionId);
  assert.equal(linked.residents[0].lastDecision.mode,'appointment');
});

test('failed receipt gives no appointment benefit and late receipt leaves a miss',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  sim.scheduleAppointment('ada',{kind:'eat',startTick:1,deadlineTick:22});
  const original=matrix.execute.bind(matrix);
  matrix.execute=(command,options)=>{
    const receipt=original(command,options);
    if(command.op==='interact'&&command.kind==='eat'&&receipt.ok)
      receipt.requestId='forged-appointment-receipt';
    return receipt;
  };
  const failed=stepUntil(sim,state=>state.log.some(entry=>
    entry.residentId==='ada'&&entry.message.includes('completion rejected')),30);
  assert.equal(appointmentOf(failed).status,'pending');
  assert.equal(appointmentOf(failed).executionId,null);
  assert.equal(appointmentOf(failed).requestId,null);
  assert.ok(failed.residents[0].needs.hunger<72);
  const missed=stepUntil(sim,state=>appointmentOf(state).status==='missed',10);
  assert.equal(missed.clockTick,23);
  assert.equal(appointmentOf(missed).resolvedTick,23);
  assert.ok(missed.residents[0].needs.hunger<72);
  assert.deepEqual(sim.exportState(),missed);

  const lateWorld=world(),late=createCitizensDemo(lateWorld,{seed:29});
  late.scheduleAppointment('ada',{kind:'eat',startTick:1,deadlineTick:5});
  const lateMiss=stepUntil(late,state=>appointmentOf(state).status==='missed',10);
  assert.equal(lateMiss.clockTick,6);
  assert.equal(lateMiss.residents[0].activity?.kind,'eat');
  const lateCompletion=stepUntil(late,state=>state.residents[0].needs.hunger>72,40);
  assert.equal(appointmentOf(lateCompletion).status,'missed');
  assert.equal(appointmentOf(lateCompletion).requestId,null);
  assert.ok(lateCompletion.log.some(entry=>entry.event==='completed'&&
    entry.residentId==='ada'&&entry.message.includes('completed eat')));
});

test('a critical meal appointment waits for its failure cooldown before linked retry',()=>{
  const matrix=world(),initial=createCitizensDemo(matrix,{seed:29});
  const state=initial.exportState();
  state.residents[0].needs.hunger=14;
  const sim=CitizensSimulation.restore(matrix,state);
  sim.scheduleAppointment('ada',{kind:'eat',startTick:1,deadlineTick:100});
  const original=matrix.execute.bind(matrix);
  let forged=false;
  matrix.execute=(command,options)=>{
    const receipt=original(command,options);
    if(!forged&&command.op==='interact'&&command.kind==='eat'&&receipt.ok){
      forged=true;
      receipt.requestId='forged-appointment-receipt';
    }
    return receipt;
  };
  const failed=stepUntil(sim,current=>current.log.some(entry=>
    entry.residentId==='ada'&&entry.message.includes('completion rejected')),45);
  assert.equal(forged,true);
  assert.equal(appointmentOf(failed).status,'pending');
  const cooldown=failed.residents[0].cooldowns.eat;
  assert.ok(cooldown>failed.clockTick);
  for(let tick=failed.clockTick+1;tick<cooldown;tick++){
    const waiting=sim.step();
    assert.equal(waiting.clockTick,tick);
    assert.equal(appointmentOf(waiting).status,'pending');
    assert.equal(waiting.residents[0].activity,null);
    assert.ok(!waiting.stations.some(station=>station.waiters.some(entry=>
      entry.residentId==='ada')));
  }
  const retried=sim.step();
  assert.equal(retried.clockTick,cooldown);
  assert.equal(appointmentOf(retried).status,'active');
  assert.equal(retried.residents[0].lastDecision.mode,'appointment');
  assert.equal(retried.residents[0].lastDecision.selectedAppointmentId,
    appointmentOf(retried).id);
  const linkedExecution=retried.residents[0].activity?.executionId??
    retried.stations.flatMap(station=>station.waiters)
      .find(entry=>entry.residentId==='ada')?.executionId;
  assert.equal(appointmentOf(retried).executionId,linkedExecution);
  const completed=stepUntil(sim,current=>
    appointmentOf(current).status==='completed',75);
  assert.ok(appointmentOf(completed).requestId);
  assert.ok(appointmentOf(completed).resolvedTick<=100);
});

test('appointment authoring is paused, bounded, and atomic against stale bindings',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  const valid={kind:'eat',startTick:1,deadlineTick:40};
  const before=sim.snapshot(),scene=structuredClone(matrix.scene);
  for(const [residentId,details] of [
    ['missing',valid],['ada',{...valid,kind:'explore'}],
    ['ada',{...valid,startTick:0}],
    ['ada',{...valid,startTick:1441,deadlineTick:1470}],
    ['ada',{...valid,deadlineTick:1}],
    ['ada',{...valid,deadlineTick:1442}],
    ['ada',{...valid,startTick:1.5}],
    ['ada',{...valid,priority:'high'}]
  ]){
    assert.throws(()=>sim.scheduleAppointment(residentId,details));
    assert.deepEqual(sim.snapshot(),before);
    assert.deepEqual(matrix.scene,scene);
  }
  const one=sim.scheduleAppointment('ada',valid);
  assert.equal(appointmentOf(one).id,'appointment-1');
  sim.scheduleAppointment('ada',{kind:'rest',startTick:60,deadlineTick:100});
  sim.scheduleAppointment('ada',{kind:'eat',startTick:120,deadlineTick:160});
  const full=sim.snapshot();
  assert.deepEqual(full.residents[0].appointments.map(item=>item.id),
    ['appointment-1','appointment-2','appointment-3']);
  assert.throws(()=>sim.scheduleAppointment('ada',{
    kind:'eat',startTick:200,deadlineTick:240}),/at most 3/);
  assert.deepEqual(sim.snapshot(),full);
  sim.resume();
  const running=sim.snapshot();
  assert.throws(()=>sim.scheduleAppointment('bo',valid),/Pause Citizens/);
  assert.deepEqual(sim.snapshot(),running);
  sim.pause();
  matrix.spatial={};
  const inAR=sim.snapshot();
  assert.throws(()=>sim.scheduleAppointment('bo',valid),/desktop virtual room/);
  assert.deepEqual(sim.snapshot(),inAR);
  matrix.spatial=null;
  const chair=matrix.scene.objects.find(item=>item.assetId==='chair');
  const transform=structuredClone(chair.transform);
  transform.position.x+=1;
  assert.equal(matrix.execute({requestId:'appointment-stale-chair',
    op:'set_transform',objectId:chair.objectId,transform}).ok,true);
  const stale=sim.snapshot(),movedScene=structuredClone(matrix.scene);
  assert.throws(()=>sim.scheduleAppointment('bo',valid),/moved or disappeared/);
  assert.deepEqual(sim.snapshot(),stale);
  assert.deepEqual(matrix.scene,movedScene);

  const selected=world(),chairId=spawn(selected,'chair',pose(0,0));
  const chairOnly=createCitizensWithSelectedFurniture(selected,
    {seed:3,objectId:chairId});
  const selectedBefore=chairOnly.snapshot();
  assert.throws(()=>chairOnly.scheduleAppointment('ada',valid),/No Citizens eat station/);
  assert.deepEqual(chairOnly.snapshot(),selectedBefore);
});

test('pending revision changes deadline precedence and stale edits leave the world intact',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  const original={kind:'rest',startTick:1,deadlineTick:40};
  sim.scheduleAppointment('ada',original);
  sim.scheduleAppointment('ada',{kind:'eat',startTick:1,deadlineTick:20});
  const scene=structuredClone(matrix.scene),before=sim.snapshot();
  for(const [expected,changes] of [
    [{...original,deadlineTick:41},original],
    [original,{...original,deadlineTick:1}],
    [original,{...original,startTick:1441,deadlineTick:1450}],
    [original,{...original,kind:'explore'}],
    [original,{...original,extra:'unexpected'}]
  ]){
    assert.throws(()=>sim.reviseAppointment('ada','appointment-1',
      expected,changes));
    assert.deepEqual(sim.snapshot(),before);
    assert.deepEqual(matrix.scene,scene);
  }
  const revised=sim.reviseAppointment('ada','appointment-1',original,
    {...original,deadlineTick:10});
  assert.equal(appointmentOf(revised).deadlineTick,10);
  const selected=sim.step();
  assert.equal(selected.residents[0].lastDecision.selectedAppointmentId,
    'appointment-1');
  assert.equal(appointmentOf(selected).status,'active');
  assert.equal(appointmentOf(selected,'ada','appointment-2').status,'pending');
  assert.deepEqual(matrix.scene.objects.map(item=>item.objectId),
    scene.objects.map(item=>item.objectId));
});

test('cancelled pending appointment keeps an outcome without claiming or granting a benefit',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  const expected={kind:'eat',startTick:1,deadlineTick:40};
  sim.scheduleAppointment('ada',expected);
  const before=sim.snapshot(),scene=structuredClone(matrix.scene);
  assert.throws(()=>sim.cancelAppointment('ada','appointment-1',
    {...expected,deadlineTick:41}),/changed/);
  assert.deepEqual(sim.snapshot(),before);
  const cancelled=sim.cancelAppointment('ada','appointment-1',expected);
  assert.deepEqual(appointmentOf(cancelled),{
    id:'appointment-1',...expected,status:'cancelled',executionId:null,
    resolvedTick:0,requestId:null,reason:'cancelled by operator'});
  assert.deepEqual(cancelled.residents[0].needs,before.residents[0].needs);
  assert.equal(cancelled.actionSequence,before.actionSequence);
  assert.equal(cancelled.requestSequence,before.requestSequence);
  assert.deepEqual(matrix.scene,scene);
  assert.deepEqual(CitizensSimulation.restore(matrix,cancelled).exportState(),
    cancelled);
});

test('five sequential missed appointments retain three outcomes and replay after restore',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  sim.step();
  const initialWaiter=structuredClone(sim.snapshot().stations.find(item=>
    item.kind==='rest').waiters[0]);
  for(let number=1;number<=5;number++){
    const now=sim.snapshot().clockTick;
    const scheduled=sim.scheduleAppointment('bo',{
      kind:'eat',startTick:now+1,deadlineTick:now+2});
    assert.equal(appointmentOf(scheduled,'bo',`appointment-${number}`).status,
      'pending');
    for(let step=0;step<3;step++)sim.step();
    const missed=sim.snapshot();
    assert.equal(missed.clockTick,now+3);
    assert.equal(appointmentOf(missed,'bo',`appointment-${number}`).status,
      'missed');
    assert.deepEqual(missed.stations.find(item=>
      item.kind==='rest').waiters[0],initialWaiter);
  }
  const retained=sim.exportState();
  const bo=retained.residents.find(item=>item.id==='bo');
  assert.equal(retained.clockTick,16);
  assert.equal(bo.appointmentSequence,5);
  assert.deepEqual(bo.appointments.map(item=>item.id),
    ['appointment-3','appointment-4','appointment-5']);
  assert.ok(bo.appointments.every(item=>item.status==='missed'&&
    item.reason==='deadline passed'));
  const cloneWorld=world();
  assert.equal(cloneWorld.execute({requestId:'load-repeated-appointments',
    op:'load',scene:structuredClone(matrix.scene)}).ok,true);
  const cloneSim=CitizensSimulation.restore(cloneWorld,retained);
  for(let index=0;index<5;index++){
    assert.deepEqual(sim.step(),cloneSim.step());
    assert.deepEqual(matrix.scene,cloneWorld.scene);
  }
});

test('active FIFO appointment cannot be revised or cancelled',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  const expected={kind:'rest',startTick:1,deadlineTick:60};
  sim.scheduleAppointment('bo',expected);
  const queued=sim.step();
  assert.equal(appointmentOf(queued,'bo').status,'active');
  assert.equal(appointmentOf(queued,'bo').executionId,
    queued.stations.find(item=>item.kind==='rest').waiters[0].executionId);
  const scene=structuredClone(matrix.scene);
  assert.throws(()=>sim.reviseAppointment('bo','appointment-1',expected,
    {...expected,startTick:2}),/Only a pending appointment/);
  assert.throws(()=>sim.cancelAppointment('bo','appointment-1',expected),
    /Only a pending appointment/);
  assert.deepEqual(sim.snapshot(),queued);
  assert.deepEqual(matrix.scene,scene);
});

test('terminal pruning retains recent cancellations and clears a removed decision',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  sim.scheduleAppointment('ada',{kind:'eat',startTick:1,deadlineTick:60});
  const completed=stepUntil(sim,state=>appointmentOf(state)?.status==='completed',60);
  assert.equal(completed.residents[0].lastDecision.selectedAppointmentId,
    'appointment-1');
  assert.match(appointmentOf(completed).requestId,
    /^citizens-29-action-[0-9]+-[0-9]+$/);
  const now=completed.clockTick;
  for(let number=2;number<=4;number++){
    const details={kind:'eat',startTick:now+1,deadlineTick:now+20};
    sim.scheduleAppointment('ada',details);
    sim.cancelAppointment('ada',`appointment-${number}`,details);
  }
  const after=sim.exportState(),ada=after.residents[0];
  assert.equal(ada.appointmentSequence,4);
  assert.deepEqual(ada.appointments.map(item=>item.id),
    ['appointment-2','appointment-3','appointment-4']);
  assert.ok(ada.appointments.every(item=>item.status==='cancelled'&&
    item.resolvedTick===now));
  assert.equal(ada.lastDecision,null);
  assert.equal(after.actionSequence,completed.actionSequence);
  assert.equal(after.requestSequence,completed.requestSequence);
});

test('numeric appointment ID order resolves same-window conflicts after ID ten',()=>{
  const matrix=world(),state=createCitizensDemo(matrix,{seed:29}).exportState();
  const ada=state.residents[0];
  ada.appointmentSequence=10;
  ada.appointments=[9,10].map(number=>({
    id:`appointment-${number}`,kind:'eat',startTick:1,deadlineTick:40,
    status:'pending',executionId:null,resolvedTick:null,requestId:null,reason:''}));
  const sim=CitizensSimulation.restore(matrix,state);
  const selected=sim.step();
  assert.equal(selected.residents[0].lastDecision.selectedAppointmentId,
    'appointment-9');
  assert.equal(appointmentOf(selected,'ada','appointment-9').status,'active');
  assert.equal(appointmentOf(selected,'ada','appointment-10').status,'pending');
});

test('v11 restore rejects forged sequence, cancelled state and capacity',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  for(let number=1;number<=3;number++){
    const details={kind:'eat',startTick:number,deadlineTick:40};
    sim.scheduleAppointment('ada',details);
    sim.cancelAppointment('ada',`appointment-${number}`,details);
  }
  const saved=sim.exportState(),scene=structuredClone(matrix.scene);
  const variants=[
    state=>{state.residents[0].appointmentSequence=2;},
    state=>{state.residents[0].appointments[0].id='appointment-01';},
    state=>{state.residents[0].appointments[0].requestId='forged';},
    state=>{state.residents[0].appointments[0].executionId=1;},
    state=>{state.residents[0].appointments[0].reason='changed';},
    state=>{state.residents[0].appointments[0].resolvedTick=41;},
    state=>{
      state.residents[0].appointmentSequence=4;
      state.residents[0].appointments.push({
        ...state.residents[0].appointments[2],id:'appointment-4'});
    }
  ];
  for(const change of variants){
    const broken=structuredClone(saved);change(broken);
    assert.throws(()=>CitizensSimulation.restore(matrix,broken),/Invalid .*Citizens/);
    assert.deepEqual(matrix.scene,scene);
    assert.deepEqual(sim.exportState(),saved);
  }
});

test('a due appointment defers a new social offer and mid-action restore replays its receipt',()=>{
  const socialWorld=world(),base=createCitizensDemo(socialWorld,{seed:29});
  const state=base.exportState();
  state.clockTick=34;
  state.nextSocialTick=35;
  for(const resident of state.residents)
    resident.needs={hunger:95,energy:95,fun:95,social:10};
  const due=CitizensSimulation.restore(socialWorld,state);
  due.scheduleAppointment('ada',{kind:'rest',startTick:35,deadlineTick:60});
  const first=due.step();
  assert.equal(first.clockTick,35);
  assert.equal(first.socialSession,null);
  assert.equal(appointmentOf(first).status,'active');

  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  sim.scheduleAppointment('ada',{kind:'eat',startTick:1,deadlineTick:60});
  for(let minute=0;minute<5;minute++)sim.step();
  const saved=sim.exportState(),restoredWorld=world();
  assert.equal(appointmentOf(saved).status,'active');
  assert.equal(restoredWorld.execute({requestId:'load-active-appointment',
    op:'load',scene:structuredClone(matrix.scene)}).ok,true);
  const restored=CitizensSimulation.restore(restoredWorld,saved);
  assert.deepEqual(restored.exportState(),saved);
  for(let minute=0;minute<25;minute++){
    assert.deepEqual(sim.step(),restored.step());
    assert.deepEqual(matrix.scene,restoredWorld.scene);
  }
  assert.equal(appointmentOf(sim.exportState()).status,'completed');
  assert.equal(appointmentOf(sim.exportState()).requestId,
    appointmentOf(restored.exportState()).requestId);
});

test('v11 restore rejects forged appointment lifecycles and reused executions atomically',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  sim.scheduleAppointment('ada',{kind:'eat',startTick:1,deadlineTick:60});
  sim.scheduleAppointment('ada',{kind:'rest',startTick:2,deadlineTick:3});
  const active=sim.step();
  assert.equal(appointmentOf(active).status,'active');
  assert.ok(active.actionSequence>=2);
  const activeScene=structuredClone(matrix.scene);
  const detached=structuredClone(active);
  detached.residents[0].appointments[0].executionId=
    active.actionSequence===appointmentOf(active).executionId?1:active.actionSequence;
  assert.throws(()=>CitizensSimulation.restore(matrix,detached),/Invalid .*Citizens/);
  assert.deepEqual(matrix.scene,activeScene);
  const completed=stepUntil(sim,state=>appointmentOf(state).status==='completed',60);
  assert.equal(appointmentOf(completed,'ada','appointment-2').status,'missed');
  const scene=structuredClone(matrix.scene);
  const variants=[
    state=>{delete state.residents[0].appointments;},
    state=>{state.residents[0].appointments[0].extra=true;},
    state=>{state.residents[0].appointments[0].resolvedTick=61;},
    state=>{state.residents[0].appointments[0].requestId='forged-receipt';},
    state=>{
      const appointment=state.residents[0].appointments[0];
      appointment.requestId=appointment.requestId.replace(/-([0-9]+)$/,
        (_,sequence)=>`-0${sequence}`);
    },
    state=>{state.residents[0].appointments[1].executionId=
      state.residents[0].appointments[0].executionId;}
  ];
  for(const change of variants){
    const broken=structuredClone(completed);change(broken);
    assert.throws(()=>CitizensSimulation.restore(matrix,broken),/Invalid .*Citizens/);
    assert.deepEqual(matrix.scene,scene);
    assert.deepEqual(sim.exportState(),completed);
  }
});

test('09:00 offers overlapping meal and walk routines with seed-stable scores',()=>{
  const seed=0x9e3779b9;
  const left=simulationAtMinute(seed,540),right=simulationAtMinute(seed,540);
  assert.deepEqual(left.simulation.step(),right.simulation.step());
  assert.deepEqual(left.matrix.scene,right.matrix.scene);
  const decision=left.simulation.snapshot().residents[0].lastDecision;
  assert.equal(decision.tick,540);
  assert.equal(decision.mode,'routine');
  assert.deepEqual(decision.candidates.map(item=>item.routineId),
    ['morning-meal','morning-walk']);
  assert.ok(decision.roll>=0&&decision.roll<1);
  assert.ok(decision.candidates.every(item=>item.score>0&&
    item.deficit>=0&&item.travelMeters>=0));
  assert.ok(['eat','explore'].includes(decision.selectedKind));
  assert.equal(decision.selectedRoutineId,
    decision.candidates.find(item=>item.kind===decision.selectedKind).routineId);
});

test('critical hunger overrides optional morning windows without awarding food early',()=>{
  const {simulation}=simulationAtMinute(0x9e3779b9,540,
    {hunger:14,energy:50,fun:95});
  const after=simulation.step();
  const ada=after.residents.find(item=>item.id==='ada');
  assert.equal(ada.lastDecision.mode,'needs');
  assert.equal(ada.lastDecision.selectedKind,'eat');
  assert.equal(ada.needs.hunger,13.55);
  assert.equal(ada.activity?.kind,'eat');
});

test('critical hunger yields an optional traveling chair claim to its FIFO waiter',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  const first=sim.step();
  const chairBefore=first.stations.find(item=>item.id==='chair');
  const adaExecution=chairBefore.claim.executionId;
  const boTicket=chairBefore.waiters[0].executionId;
  const saved=sim.exportState();
  saved.residents.find(item=>item.id==='ada').needs.hunger=15.4;
  const resumed=CitizensSimulation.restore(matrix,saved);
  const after=resumed.step();
  const ada=after.residents.find(item=>item.id==='ada');
  const chair=after.stations.find(item=>item.id==='chair');
  assert.equal(after.clockTick,2);
  assert.equal(chair.claim?.residentId,'bo');
  assert.equal(chair.claim?.executionId,boTicket,
    'the original FIFO execution receives the released chair');
  assert.equal(chair.waiters.length,0);
  assert.equal(ada.activity?.kind,'eat');
  assert.notEqual(ada.activity?.executionId,adaExecution);
  assert.equal(ada.needs.hunger,14.95,'choosing food grants no benefit');
  assert.equal(ada.needs.energy,first.residents[0].needs.energy-.55,
    'abandoned rest grants no benefit');
  assert.match(ada.lastOutcome,/Interrupted rest for critical hunger/);
  assert.ok(after.log.some(entry=>entry.residentId==='ada'&&
    entry.message.includes(`interrupted optional rest execution ${adaExecution}`)));
  assert.deepEqual(resumed.exportState(),after);
  const fed=stepUntil(resumed,state=>
    state.residents.find(item=>item.id==='ada').needs.hunger>14.95,70);
  assert.ok(fed.log.some(entry=>entry.event==='completed'&&
    entry.residentId==='ada'&&entry.message.includes('completed eat')));
});

test('a routine edit cannot hide an optional travel claim from critical hunger',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  const first=sim.step();
  const oldExecution=first.residents[0].activity.executionId;
  const waitingExecution=first.stations.find(item=>item.id==='chair')
    .waiters[0].executionId;
  const edited=sim.editRoutine('ada','morning-meal',{
    startMinute:480,endMinute:620,priority:'high'});
  assert.equal(edited.residents[0].lastDecision,null);
  assert.equal(edited.residents[0].appointmentSequence,0);
  assert.equal(edited.residents[0].activity.executionId,oldExecution);
  const saved=sim.exportState();
  saved.residents[0].needs.hunger=15.4;
  const after=CitizensSimulation.restore(matrix,saved).step();
  assert.equal(after.residents[0].activity?.kind,'eat');
  assert.match(after.residents[0].lastOutcome,/Interrupted rest for critical hunger/);
  assert.equal(after.stations.find(item=>item.id==='chair').claim?.executionId,
    waitingExecution);
});

test('migrated v6 optional FIFO ticket can yield despite its missing choice trace',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  const first=sim.step();
  const old=sim.exportState();
  old.schemaVersion=6;
  delete old.clockSpeed;
  stripV9Fields(old);
  for(const resident of old.residents){
    delete resident.routines;
    delete resident.lastDecision;
  }
  old.residents.find(item=>item.id==='bo').needs.hunger=15.4;
  const restored=CitizensSimulation.restore(matrix,old);
  const before=restored.snapshot();
  assert.equal(before.residents[1].lastDecision,null);
  assert.equal(before.residents[1].appointmentSequence,0);
  assert.equal(before.stations.find(item=>item.id==='chair').waiters[0].residentId,
    'bo');
  const after=restored.step();
  assert.equal(after.stations.find(item=>item.id==='chair').claim?.executionId,
    first.stations.find(item=>item.id==='chair').claim.executionId);
  assert.equal(after.stations.find(item=>item.id==='chair').waiters.length,0);
  assert.equal(after.residents.find(item=>item.id==='bo').activity?.kind,'eat');
  assert.match(after.residents.find(item=>item.id==='bo').lastOutcome,
    /Interrupted rest for critical hunger/);
});

test('a booked resident with no choice trace keeps its in-flight execution',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  const details={kind:'eat',startTick:20,deadlineTick:40};
  sim.scheduleAppointment('ada',details);
  sim.cancelAppointment('ada','appointment-1',details);
  const first=sim.step();
  const oldExecution=first.residents[0].activity.executionId;
  assert.equal(first.residents[0].activity.kind,'rest');
  const edited=sim.editRoutine('ada','morning-meal',{
    startMinute:480,endMinute:620,priority:'high'});
  assert.equal(edited.residents[0].lastDecision,null);
  assert.equal(edited.residents[0].appointmentSequence,1);
  const saved=sim.exportState();
  saved.residents[0].needs.hunger=15.4;
  const after=CitizensSimulation.restore(matrix,saved).step();
  assert.equal(after.residents[0].activity?.executionId,oldExecution);
  assert.equal(after.stations.find(item=>item.id==='chair').claim?.residentId,'ada');
  assert.ok(!after.log.some(entry=>entry.message.includes('interrupted optional')));
});

test('critical hunger removes an optional FIFO wait and optional explore travel',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  const first=sim.step(),saved=sim.exportState();
  const chairBefore=first.stations.find(item=>item.id==='chair');
  const adaExecution=chairBefore.claim.executionId;
  saved.residents.find(item=>item.id==='bo').needs.hunger=15.4;
  const after=CitizensSimulation.restore(matrix,saved).step();
  const chair=after.stations.find(item=>item.id==='chair');
  const bo=after.residents.find(item=>item.id==='bo');
  assert.equal(chair.claim?.executionId,adaExecution);
  assert.equal(chair.waiters.length,0);
  assert.equal(bo.activity?.kind,'eat');
  assert.equal(bo.needs.hunger,14.95);
  assert.match(bo.lastOutcome,/Interrupted rest for critical hunger/);

  const roamWorld=world(),roam=createCitizensDemo(roamWorld,{seed:31});
  const beforeRoam=roam.exportState();
  const ada=beforeRoam.residents.find(item=>item.id==='ada');
  ada.needs={hunger:16,energy:95,fun:0,social:100};
  ada.preferences={...ada.preferences,rest:.2,eat:.2,explore:2};
  ada.routines=[];
  beforeRoam.nextSocialTick=1000;
  const roaming=CitizensSimulation.restore(roamWorld,beforeRoam);
  assert.equal(roaming.step().residents[0].activity?.kind,'explore');
  const roamSaved=roaming.exportState();
  roamSaved.residents[0].needs.hunger=15.4;
  const rescued=CitizensSimulation.restore(roamWorld,roamSaved).step();
  assert.equal(rescued.residents[0].activity?.kind,'eat');
  assert.match(rescued.residents[0].lastOutcome,
    /Interrupted explore for critical hunger/);
  assert.equal(rescued.residents[0].needs.fun,0,
    'abandoned exploration gives no fun benefit');
});

test('critical hunger preserves committed use, egress and appointment executions',()=>{
  const phaseCheck=phase=>{
    const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
    const atPhase=stepUntil(sim,state=>
      state.residents[0].activity?.phase===phase&&
      (phase!=='use'||state.residents[0].activity.remainingTicks>2),65);
    const saved=sim.exportState();
    saved.residents[0].needs.hunger=15.4;
    const execution=saved.residents[0].activity.executionId;
    const after=CitizensSimulation.restore(matrix,saved).step();
    assert.ok(after.residents[0].activity?.executionId===execution||
      phase==='egress'&&after.residents[0].activity===null);
    assert.ok(!after.log.some(entry=>entry.tick===after.clockTick&&
      entry.residentId==='ada'&&entry.message.includes('interrupted optional')));
    return atPhase;
  };
  phaseCheck('use');
  phaseCheck('egress');

  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  sim.scheduleAppointment('ada',{kind:'rest',startTick:1,deadlineTick:2});
  sim.step();
  const saved=sim.exportState();
  saved.residents[0].needs.hunger=15.4;
  const execution=appointmentOf(saved).executionId;
  const restored=CitizensSimulation.restore(matrix,saved);
  assert.equal(restored.step().residents[0].activity?.executionId,execution);
  const missed=restored.step();
  assert.equal(appointmentOf(missed).status,'missed');
  assert.equal(missed.residents[0].activity?.executionId,execution,
    'a missed appointment still owns its finite in-flight execution');
  assert.ok(!missed.log.some(entry=>entry.message.includes('interrupted optional')));
});

test('critical meal cooldown keeps the current action and prevents idle retry',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  sim.step();
  const saved=sim.exportState();
  saved.residents[0].needs.hunger=15.4;
  saved.residents[0].cooldowns.eat=4;
  const execution=saved.residents[0].activity.executionId;
  const resumed=CitizensSimulation.restore(matrix,saved);
  const held=resumed.step();
  assert.equal(held.residents[0].activity?.executionId,execution);
  assert.equal(held.stations.find(item=>item.id==='chair').claim?.residentId,'ada');
  assert.ok(!held.log.some(entry=>entry.message.includes('interrupted optional')));

  const idleWorld=world(),idle=createCitizensDemo(idleWorld,{seed:31});
  const idleSaved=idle.exportState();
  idleSaved.residents[0].needs.hunger=14;
  idleSaved.residents[0].cooldowns.eat=4;
  const waiting=CitizensSimulation.restore(idleWorld,idleSaved);
  for(let tick=1;tick<4;tick++){
    const state=waiting.step();
    assert.equal(state.residents[0].activity,null);
    assert.ok(!state.stations.some(station=>station.waiters.some(item=>
      item.residentId==='ada')));
  }
  assert.equal(waiting.step().residents[0].activity?.kind,'eat');
});

test('a rejected urgent meal waits through its cooldown before another goal',()=>{
  const matrix=world(),created=createCitizensDemo(matrix,{seed:31});
  const initial=created.exportState();
  initial.residents[0].needs.hunger=14;
  const sim=CitizensSimulation.restore(matrix,initial);
  const adaId=initial.residents[0].objectId;
  const original=matrix.execute.bind(matrix);
  matrix.execute=(command,options)=>command.op==='set_transform'&&
    command.objectId===adaId?{requestId:command.requestId,ok:false,
      error:'urgent movement rejected',objectId:''}:original(command,options);
  const failed=sim.step();
  assert.equal(failed.residents[0].activity,null);
  assert.equal(failed.residents[0].cooldowns.eat,5);
  assert.equal(failed.residents[0].needs.hunger,13.55);
  matrix.execute=original;
  for(let tick=2;tick<5;tick++){
    const held=sim.step();
    assert.equal(held.residents[0].activity,null);
    assert.ok(!held.stations.some(station=>station.waiters.some(item=>
      item.residentId==='ada')));
  }
  assert.equal(sim.step().residents[0].activity?.kind,'eat');
});

test('unreachable food does not discard an optional travel claim',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  const first=sim.step();
  const saved=sim.exportState();
  saved.residents[0].needs.hunger=15.4;
  spawn(matrix,'block',pose(2.15,-2,0,2));
  const resumed=CitizensSimulation.restore(matrix,saved);
  const actor=matrix.requireObject(saved.residents[0].objectId).transform.position;
  const food=resumed.decisionCandidate(resumed.state.residents[0],actor,'eat');
  assert.ok(food.unavailable,'the block must cover every food approach');
  const after=resumed.step();
  assert.equal(after.residents[0].activity?.executionId,
    first.residents[0].activity.executionId);
  assert.equal(after.stations.find(item=>item.id==='chair').claim?.residentId,'ada');
  assert.ok(!after.log.some(entry=>entry.message.includes('interrupted optional')));
});

test('a mid-interruption checkpoint replays the exact world and Citizens state',()=>{
  const a=world(),b=world();
  const first=createCitizensDemo(a,{seed:31});
  const second=createCitizensDemo(b,{seed:31});
  first.step();second.step();
  const saved=first.exportState();
  saved.residents[0].needs.hunger=15.4;
  const other=structuredClone(saved);
  const left=CitizensSimulation.restore(a,saved);
  const right=CitizensSimulation.restore(b,other);
  for(let tick=0;tick<25;tick++){
    assert.deepEqual(left.step(),right.step());
    assert.deepEqual(a.scene,b.scene);
  }
});

test('overnight routine wraps into the next day and ends at 06:00',()=>{
  const night=simulationAtMinute(29,1440,{hunger:90,energy:20,fun:90});
  const midnight=night.simulation.step();
  assert.equal(midnight.clockTick,1440);
  assert.equal(midnight.residents[0].lastDecision.mode,'routine');
  assert.equal(midnight.residents[0].lastDecision.selectedRoutineId,'evening-rest');
  const morning=simulationAtMinute(29,1800,{hunger:90,energy:20,fun:90});
  const afterWindow=morning.simulation.step();
  assert.equal(afterWindow.residents[0].lastDecision.mode,'needs');
});

test('paused routine edits change only the next idle choice and survive restore',()=>{
  const fixture=simulationAtMinute(29,540,
    {hunger:45,energy:95,fun:35,social:100});
  const matrix=fixture.matrix,state=fixture.simulation.exportState();
  state.residents[0].routines[0].stationId='food';
  const simulation=CitizensSimulation.restore(matrix,state);
  const before=simulation.snapshot(),scene=structuredClone(matrix.scene);
  const edited=simulation.editRoutine('ada','morning-meal',{
    startMinute:600,endMinute:660,priority:'high'});
  const meal=edited.residents[0].routines.find(item=>item.id==='morning-meal');
  assert.deepEqual(meal,{...before.residents[0].routines[0],
    startMinute:600,endMinute:660,priority:'high'});
  assert.equal(meal.stationId,'food','a reviewed station binding is unchanged');
  assert.equal(edited.residents[0].lastDecision,null);
  assert.deepEqual(edited.residents[1],before.residents[1]);
  assert.equal(edited.clockTick,before.clockTick);
  assert.equal(edited.rngState,before.rngState);
  assert.deepEqual(edited.stations,before.stations);
  assert.deepEqual(matrix.scene,scene);
  assert.match(edited.log.at(-1).message,/morning-meal routine changed/);
  assert.deepEqual(CitizensSimulation.restore(matrix,simulation.exportState()).exportState(),
    edited);
  const after=simulation.step();
  assert.equal(after.residents[0].lastDecision.mode,'routine');
  assert.equal(after.residents[0].lastDecision.selectedRoutineId,'morning-walk');
  assert.deepEqual(after.residents[0].lastDecision.candidates.map(item=>item.routineId),
    ['morning-walk']);

  const higher=simulationAtMinute(29,540,{hunger:45,energy:95,fun:35,social:100});
  higher.simulation.editRoutine('ada','morning-meal',{
    startMinute:420,endMinute:600,priority:'high'});
  assert.equal(higher.simulation.step().residents[0].lastDecision.selectedRoutineId,
    'morning-meal','a high-priority meal wins above an eligible default walk');
});

test('routine edits reject invalid, running, AR, and stale binding requests atomically',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:29});
  const valid={startMinute:420,endMinute:600,priority:'default'};
  const before=sim.snapshot(),scene=structuredClone(matrix.scene);
  for(const [residentId,routineId,changes] of [
    ['missing','morning-meal',valid],['ada','missing',valid],
    ['ada','morning-meal',{...valid,endMinute:420}],
    ['ada','morning-meal',{...valid,startMinute:-1}],
    ['ada','morning-meal',{...valid,endMinute:1441}],
    ['ada','morning-meal',{...valid,priority:'urgent'}],
    ['ada','morning-meal',{...valid,startMinute:420.5}],
    ['ada','morning-meal',{...valid,kind:'eat'}],
    ['ada','morning-meal',{startMinute:420,endMinute:600}]
  ]){
    assert.throws(()=>sim.editRoutine(residentId,routineId,changes));
    assert.deepEqual(sim.snapshot(),before);
    assert.deepEqual(matrix.scene,scene);
  }
  sim.resume();
  const running=sim.snapshot();
  assert.throws(()=>sim.editRoutine('ada','morning-meal',valid),/Pause Citizens/);
  assert.deepEqual(sim.snapshot(),running);
  sim.pause();
  matrix.spatial={};
  const inAR=sim.snapshot();
  assert.throws(()=>sim.editRoutine('ada','morning-meal',valid),/desktop virtual room/);
  assert.deepEqual(sim.snapshot(),inAR);
  matrix.spatial=null;
  const chair=matrix.scene.objects.find(item=>item.assetId==='chair');
  const transform=structuredClone(chair.transform);
  transform.position.x+=1;
  assert.equal(matrix.execute({requestId:'routine-stale-chair',op:'set_transform',
    objectId:chair.objectId,transform}).ok,true);
  const stale=sim.snapshot(),movedScene=structuredClone(matrix.scene);
  assert.throws(()=>sim.editRoutine('ada','morning-meal',valid),/moved or disappeared/);
  assert.deepEqual(sim.snapshot(),stale);
  assert.deepEqual(matrix.scene,movedScene);
});

test('editing while paused preserves an active claim and FIFO waiter through replay',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:17});
  const before=sim.step();
  const chair=before.stations.find(item=>item.kind==='rest');
  assert.equal(chair.claim?.residentId,'ada');
  assert.equal(chair.waiters[0]?.residentId,'bo');
  const edited=sim.editRoutine('ada','morning-meal',{
    startMinute:480,endMinute:620,priority:'high'});
  assert.equal(edited.clockTick,before.clockTick);
  assert.equal(edited.rngState,before.rngState);
  assert.deepEqual(edited.residents[0].activity,before.residents[0].activity);
  assert.deepEqual(edited.stations,before.stations);
  assert.deepEqual(edited.socialSession,before.socialSession);
  const saved=sim.exportState(),restoredWorld=world();
  assert.equal(restoredWorld.execute({requestId:'load-edited-claim',op:'load',
    scene:structuredClone(matrix.scene)}).ok,true);
  const restored=CitizensSimulation.restore(restoredWorld,saved);
  assert.deepEqual(restored.exportState(),saved);
  for(let minute=0;minute<18;minute++){
    assert.deepEqual(sim.step(),restored.step());
    assert.deepEqual(matrix.scene,restoredWorld.scene);
  }
  assert.equal(sim.snapshot().log.filter(entry=>entry.event==='completed'&&
    entry.residentId==='ada'&&entry.message.includes('rest')).length,1);
});

test('editing a paused active social session preserves its receipt-backed result',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
  const before=stepUntil(sim,state=>state.socialSession?.phase==='active'&&
    state.socialSession.travelTicks>0,300);
  const edited=sim.editRoutine('ada','morning-meal',{
    startMinute:500,endMinute:610,priority:'low'});
  assert.deepEqual(edited.socialSession,before.socialSession);
  assert.deepEqual(edited.socialEvents,before.socialEvents);
  assert.deepEqual(edited.relationships,before.relationships);
  assert.deepEqual(edited.residents.map(item=>item.socialSessionId),
    before.residents.map(item=>item.socialSessionId));
  assert.equal(edited.clockTick,before.clockTick);
  assert.equal(edited.rngState,before.rngState);
  const saved=sim.exportState(),restoredWorld=world();
  assert.equal(restoredWorld.execute({requestId:'load-edited-social',op:'load',
    scene:structuredClone(matrix.scene)}).ok,true);
  const restored=CitizensSimulation.restore(restoredWorld,saved);
  for(let minute=0;minute<24;minute++){
    assert.deepEqual(sim.step(),restored.step());
    assert.deepEqual(matrix.scene,restoredWorld.scene);
  }
  const after=sim.exportState();
  assert.equal(after.socialEvents.filter(event=>event.event==='ended').length,1);
  assert.equal(after.relationships[0].score,55);
  assert.equal(after.relationships[0].completed.length,1);
});

test('seeded routine sampling changes with needs and activity preferences',()=>{
  const countEat=(needs,preferences=null)=>{
    let eat=0;
    for(let index=1;index<=64;index++){
      const seed=Math.imul(index,0x9e3779b1)>>>0;
      const {simulation,matrix}=simulationAtMinute(seed,540,needs);
      if(preferences){
        const state=simulation.exportState();
        state.residents[0].preferences={...state.residents[0].preferences,
          ...preferences};
        const changed=CitizensSimulation.restore(matrix,state);
        eat+=changed.step().residents[0].lastDecision.selectedKind==='eat'?1:0;
      }else eat+=simulation.step().residents[0].lastDecision.selectedKind==='eat'?1:0;
    }
    return eat;
  };
  const balanced=countEat({hunger:50,energy:50,fun:50});
  assert.ok(balanced>10&&balanced<54,
    `both overlapping windows should win across seeded trials; eat=${balanced}`);
  const hungry=countEat({hunger:35,energy:50,fun:90});
  const playful=countEat({hunger:90,energy:50,fun:30});
  assert.ok(hungry>playful+30,`need change did not shift choices: ${hungry}/${playful}`);
  const likesMeals=countEat({hunger:50,energy:50,fun:50},
    {rest:1,eat:2,explore:.2});
  const likesWalks=countEat({hunger:50,energy:50,fun:50},
    {rest:1,eat:.2,explore:2});
  assert.ok(likesMeals>likesWalks+20,
    `preferences did not shift choices: ${likesMeals}/${likesWalks}`);
});

test('one accelerated virtual day has observed activities and no unbounded state',()=>{
  const matrix=world(),simulation=createCitizensDemo(matrix,{seed:0x9e3779b9});
  simulation.setClockSpeed(16);
  const scheduled=new Set(),completed=new Set();
  for(let minute=1;minute<=1440;minute++){
    const state=simulation.step();
    assert.equal(state.clockTick,minute);
    for(const resident of state.residents){
      const decision=resident.lastDecision;
      if(decision?.tick===minute&&decision.mode==='routine')
        scheduled.add(decision.selectedRoutineId);
      assert.ok(Object.values(resident.needs).every(value=>value>=0&&value<=100));
    }
    for(const entry of state.log)if(entry.tick===minute&&entry.event==='completed'){
      for(const kind of ['rest','eat','explore'])if(entry.message.includes(`completed ${kind}`))
        completed.add(kind);
    }
  }
  const saved=simulation.exportState();
  assert.equal(saved.clockTick,1440);
  assert.equal(saved.clockSpeed,16);
  assert.ok(scheduled.has('morning-meal'));
  assert.ok(scheduled.has('morning-walk'));
  assert.ok(scheduled.has('evening-rest'));
  assert.deepEqual([...completed].sort(),['eat','explore','rest']);
  assert.ok(saved.log.length<=80);
  assert.equal(matrix.scene.objects.length,4);
});

test('v9 rejects malformed clock, routine, social need, and score trace without touching world',()=>{
  const matrix=world(),simulation=createCitizensDemo(matrix,{seed:29});
  simulation.step();
  const good=simulation.exportState(),scene=structuredClone(matrix.scene);
  for(const mutate of [
    state=>{state.clockSpeed=2;},
    state=>{state.residents[0].routines[0].endMinute=420;},
    state=>{state.residents[0].routines[0].priority='urgent';},
    state=>{state.residents[0].routines[0].stationId='missing';},
    state=>{state.residents[0].lastDecision.candidates[0].score=Infinity;},
    state=>{state.residents[0].lastDecision.selectedRoutineId='forged';},
    state=>{state.residents[0].needs.social=-1;},
    state=>{state.residents[0].preferences.converse=2.1;}
  ]){
    const invalid=structuredClone(good);mutate(invalid);
    assert.throws(()=>CitizensSimulation.restore(matrix,invalid));
    assert.deepEqual(matrix.scene,scene);
  }
});

test('a failed setup receipt rolls back earlier demo objects',()=>{
  const matrix=new MatrixWorld(()=> 'same-object-id');
  assert.throws(()=>createCitizensDemo(matrix,{seed:7}),/spawn failed/);
  assert.equal(matrix.scene.objects.length,0);
  assert.equal(matrix.undo.length,0);
});

test('selected authored table stays in the scene and its stable ID survives save and restore',()=>{
  const matrix=world();
  const tableId=spawn(matrix,'table',pose(1,-2,45));
  const blockId=spawn(matrix,'block',pose(4,3));
  matrix.setSelection(tableId,{x:1,y:0,z:-2});
  const authored=structuredClone(matrix.scene.objects);
  assert.equal(citizensFurnitureReadiness(matrix,tableId),'');
  const sim=createCitizensWithSelectedFurniture(matrix,{seed:7,objectId:tableId});
  assert.deepEqual(matrix.scene.objects.slice(0,2),authored);
  assert.equal(matrix.selection.objectId,tableId);
  assert.equal(matrix.scene.objects.length,4);
  assert.deepEqual(sim.snapshot().stations,[{id:'food',kind:'eat',objectId:tableId,
    capacity:1,claim:null,waiters:[],interaction:null}]);
  assert.equal(matrix.scene.objects[1].objectId,blockId);
  const startIds=sim.snapshot().residents.map(resident=>resident.objectId);
  stepUntil(sim,state=>state.log.some(entry=>entry.event==='completed'&&
    entry.message.includes('eat')),100);
  const saved=sim.exportState(),scene=structuredClone(matrix.scene);
  const restoredWorld=world();
  assert.equal(restoredWorld.execute({requestId:'restore-authored-furniture',
    op:'load',scene}).ok,true);
  const restored=CitizensSimulation.restore(restoredWorld,saved);
  assert.deepEqual(restored.exportState(),saved);
  assert.deepEqual(restored.snapshot().residents.map(resident=>resident.objectId),startIds);
  assert.equal(restored.snapshot().stations[0].objectId,tableId);
  for(let i=0;i<16;i++){
    assert.deepEqual(restored.step(),sim.step());
    assert.deepEqual(restoredWorld.scene,matrix.scene);
  }
});

test('selected chair residents detour around an authored wall before an observed rest',()=>{
  const matrix=world();
  const chairId=spawn(matrix,'chair',pose(0,0));
  const wallId=spawn(matrix,'wall',pose(-.9,0,90));
  assert.equal(citizensFurnitureReadiness(matrix,chairId),'');
  const sim=createCitizensWithSelectedFurniture(matrix,{seed:3,objectId:chairId});
  const adaId=sim.snapshot().residents.find(resident=>resident.id==='ada').objectId;
  const wall={id:wallId,cx:-.9,cz:0,halfX:1,halfZ:.06,yawRadians:Math.PI/2};
  let before=structuredClone(matrix.requireObject(adaId).transform.position);
  let detour=0,completed=false;
  for(let i=0;i<80;i++){
    const state=sim.step(),after=matrix.requireObject(adaId).transform.position;
    assert.equal(segmentClear(before,after,[wall],.18),true);
    detour=Math.max(detour,Math.abs(after.z));
    before=structuredClone(after);
    if(state.log.some(entry=>entry.residentId==='ada'&&entry.event==='completed'&&
      entry.message.includes('rest'))){completed=true;break;}
  }
  assert.equal(completed,true,'Ada must complete the selected chair interaction');
  assert.ok(detour>1.15,'the observed route must clear the wall end');
  assert.equal(sim.snapshot().stations[0].objectId,chairId);
});

test('Citizens waits for the exact imported obstacle to be measured before routing',()=>{
  const matrix=world();
  const asset=registeredObstacle();
  matrix.registerAssets([asset]);
  const chairId=spawn(matrix,'chair',pose(0,0));
  const obstacleId=spawn(matrix,asset.assetId,pose(-.9,0));
  const authored=structuredClone(matrix.scene);
  assert.match(citizensFurnitureReadiness(matrix,chairId),
    new RegExp(`verified rendered GLB ${obstacleId}`));
  assert.throws(()=>createCitizensWithSelectedFurniture(matrix,
    {seed:41,objectId:chairId}),/verified rendered GLB/);
  assert.deepEqual(matrix.scene,authored,'failed readiness must leave authored objects alone');
  assert.equal(matrix.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},obstacleId),true);
  assert.equal(citizensFurnitureReadiness(matrix,chairId),'');
  const sim=createCitizensWithSelectedFurniture(matrix,{seed:41,objectId:chairId});
  const wall={id:obstacleId,cx:-.9,cz:0,halfX:.5,halfZ:.5,yawRadians:0};
  const adaId=sim.snapshot().residents.find(resident=>resident.id==='ada').objectId;
  let before=structuredClone(matrix.requireObject(adaId).transform.position);
  let observedDetour=false;
  for(let i=0;i<100;i++){
    const state=sim.step(),after=matrix.requireObject(adaId).transform.position;
    assert.equal(segmentClear(before,after,[wall],.18),true);
    observedDetour ||= Math.abs(after.z)>.5;
    before=structuredClone(after);
    if(state.log.some(entry=>entry.residentId==='ada'&&entry.event==='completed'&&
      entry.message.includes('rest'))){
      assert.equal(observedDetour,true);
      return;
    }
  }
  assert.fail('Ada did not complete a receipt-backed rest after measured GLB detour');
});

test('Citizens refuses measured GLBs whose clips can move geometry outside rest bounds',()=>{
  for(const binding of [null,{loopClip:null,selectClip:'Select'}]){
    const matrix=world();
    const asset={...registeredObstacle(),geometry:{animationClips:binding?
      [{name:'Loop',durationSeconds:1},{name:'Select',durationSeconds:1}]:
      [{name:'Loop',durationSeconds:1}]}};
    matrix.registerAssets([asset]);
    const chairId=spawn(matrix,'chair',pose(0,0));
    const obstacleId=spawn(matrix,asset.assetId,pose(-.9,0));
    if(binding){
      assert.equal(matrix.execute({requestId:'select-only-clip',op:'bind_animation',
        objectId:obstacleId,...binding}).ok,true);
    }
    assert.equal(matrix.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},obstacleId),true);
    assert.equal(matrix.renderedAssetVerified(matrix.requireObject(obstacleId)),true,
      'rendering verifies only the resting GLB bounds');
    assert.match(citizensFurnitureReadiness(matrix,chairId),/animated GLB/);
    assert.throws(()=>createCitizensWithSelectedFurniture(matrix,
      {seed:44,objectId:chairId}),/animated GLB/);
    assert.equal(matrix.scene.objects.length,2);
  }
});

test('catalog change pauses active Citizens before time, motion, or benefit',()=>{
  const matrix=world();
  const asset=registeredObstacle();
  matrix.registerAssets([asset]);
  const chairId=spawn(matrix,'chair',pose(0,0));
  const obstacleId=spawn(matrix,asset.assetId,pose(-.9,0));
  assert.equal(matrix.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},obstacleId),true);
  const sim=createCitizensWithSelectedFurniture(matrix,{seed:42,objectId:chairId});
  const moving=sim.step();
  assert.equal(moving.clockTick,1);
  const resident=structuredClone(moving.residents.find(item=>item.activity?.kind==='rest'));
  assert.ok(resident);
  const before=structuredClone(matrix.requireObject(resident.objectId).transform);
  const changed=registeredObstacle('b'.repeat(64));
  matrix.registerAssets([changed]);
  const blocked=sim.step();
  assert.equal(blocked.paused,true);
  assert.equal(blocked.clockTick,1);
  assert.deepEqual(matrix.requireObject(resident.objectId).transform,before);
  assert.equal(blocked.residents.find(item=>item.id===resident.id).needs.energy,
    resident.needs.energy);
  assert.equal(holder(blocked.stations[0]),null);
  assert.ok(blocked.log.some(entry=>entry.event==='paused'&&
    entry.message.includes('verified rendered GLB')));
  assert.equal(sim.resume().paused,true,'Run remains unavailable while unverified');
  assert.equal(matrix.verifyPhysicsAsset(changed.assetId,{x:1,y:1,z:1},obstacleId),true);
  assert.equal(sim.resume().paused,false);
  const completed=stepUntil(sim,state=>state.log.some(entry=>
    entry.event==='completed'&&entry.message.includes('rest')),120);
  assert.ok(completed.clockTick>1);
});

test('a restored Citizens world waits for browser measurement before resuming',()=>{
  const matrix=world();
  const asset=registeredObstacle();
  matrix.registerAssets([asset]);
  const chairId=spawn(matrix,'chair',pose(0,0));
  const obstacleId=spawn(matrix,asset.assetId,pose(-.9,0));
  assert.equal(matrix.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},obstacleId),true);
  const sim=createCitizensWithSelectedFurniture(matrix,{seed:43,objectId:chairId});
  sim.step();sim.pause();
  const saved=sim.exportState(),scene=structuredClone(matrix.scene);
  const recovered=world();
  recovered.registerAssets([asset]);
  assert.equal(recovered.execute({requestId:'restore-glb-world',op:'load',scene}).ok,true);
  const resumed=CitizensSimulation.restore(recovered,saved);
  const poseBefore=structuredClone(recovered.requireObject(saved.residents[0].objectId).transform);
  assert.equal(resumed.resume().paused,true);
  assert.equal(resumed.snapshot().clockTick,saved.clockTick);
  assert.deepEqual(recovered.requireObject(saved.residents[0].objectId).transform,poseBefore);
  assert.equal(recovered.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},obstacleId),true);
  assert.equal(resumed.resume().paused,false);
  assert.ok(resumed.step().clockTick>saved.clockTick);
});

test('a wall moved into the seat use lane cancels the claim without a need benefit',()=>{
  const matrix=world();
  const chairId=spawn(matrix,'chair',pose(0,0));
  const wallId=spawn(matrix,'wall',pose(4,4));
  const sim=createCitizensWithSelectedFurniture(matrix,{seed:3,objectId:chairId});
  const ready=stepUntil(sim,state=>state.residents.some(resident=>
    resident.activity?.kind==='rest'&&resident.activity.phase==='use'),80);
  const resident=ready.residents.find(item=>item.activity?.kind==='rest'&&
    item.activity.phase==='use');
  const actor=matrix.requireObject(resident.objectId).transform.position;
  const target=matrix.requireObject(chairId).transform.position;
  const dx=target.x-actor.x,dz=target.z-actor.z;
  const yaw=Math.atan2(dz,dx)*180/Math.PI+90;
  const wallPose=pose((actor.x+target.x)/2,(actor.z+target.z)/2,yaw,.5);
  assert.equal(matrix.execute({requestId:'move-wall-into-use-lane',
    op:'set_transform',objectId:wallId,transform:wallPose}).ok,true);
  const wall={id:wallId,cx:wallPose.position.x,cz:wallPose.position.z,
    halfX:.5,halfZ:.03,yawRadians:yaw*Math.PI/180};
  assert.equal(segmentClear(actor,actor,[wall],.18),true,
    'the barrier must obstruct use without engulfing the actor');
  assert.equal(segmentClear(actor,target,[wall],0),false);
  const energyBefore=resident.needs.energy;
  const logLength=ready.log.length;
  let after;
  for(let i=0;i<8;i++){
    after=sim.step();
    if(after.residents.find(item=>item.id===resident.id)?.activity===null)break;
  }
  assert.ok(after.log.slice(logLength).some(entry=>entry.residentId===resident.id&&
    entry.event==='failed'&&entry.message.includes('occluded')));
  assert.ok(!after.log.slice(logLength).some(entry=>entry.residentId===resident.id&&
    entry.event==='completed'&&entry.message.includes('rest')));
  assert.ok(after.residents.find(item=>item.id===resident.id).needs.energy<energyBefore);
  assert.notEqual(holder(after.stations.find(station=>station.id==='chair')),
    resident.id,'the failed user must release its claim for the waiter');
});

test('selected furniture readiness rejects unsupported, moving and unknown scene geometry',()=>{
  const matrix=world();
  const chairId=spawn(matrix,'chair',pose(0,0));
  const wallId=spawn(matrix,'wall',pose(4,0));
  const authored=structuredClone(matrix.scene);
  assert.match(citizensFurnitureReadiness(matrix,''),/Select an existing chair/);
  assert.match(citizensFurnitureReadiness(matrix,wallId),/registered GLB with a reviewed interaction/);
  matrix.game={active:true};
  assert.match(citizensFurnitureReadiness(matrix,chairId),/active game/);
  matrix.game=null;
  matrix.requireObject(chairId).physics={kind:'gravity-floor'};
  assert.match(citizensFurnitureReadiness(matrix,chairId),/moving or has physics/);
  delete matrix.requireObject(chairId).physics;
  matrix.requireObject(chairId).transform.position.y=2;
  assert.match(citizensFurnitureReadiness(matrix,chairId),/floor-aligned/);
  assert.throws(()=>createCitizensWithSelectedFurniture(matrix,{seed:3,objectId:chairId}),
    /floor-aligned/);
  matrix.requireObject(chairId).transform.position.y=0;
  matrix.scene.objects.push({...structuredClone(matrix.requireObject(wallId)),
    objectId:'unknown-geometry',assetId:'web:unknown'});
  assert.match(citizensFurnitureReadiness(matrix,chairId),/measured bounds/);
  assert.throws(()=>createCitizensWithSelectedFurniture(matrix,{seed:3,objectId:chairId}),
    /measured bounds/);
  matrix.scene.objects.pop();
  assert.deepEqual(matrix.scene,authored);
});

test('failed selected setup removes only its own orbs and restores the authored selection',()=>{
  const matrix=world();
  const chairId=spawn(matrix,'chair',pose(0,0));
  const earlierOrbId=spawn(matrix,'orb',pose(5,5));
  matrix.setSelection(chairId,{x:0,y:0,z:0});
  const authored=structuredClone(matrix.scene.objects);
  const execute=matrix.execute.bind(matrix);
  let unrelatedId='';
  matrix.execute=(command,options)=>{
    const result=execute(command,options);
    if(command.requestId==='citizens-11-selected-bo'){
      unrelatedId=execute({requestId:'concurrent-unrelated-orb',op:'spawn',
        assetId:'orb',anchorId:'web-floor',transform:pose(5,-5,.0,.7)},
      {recordHistory:false}).objectId;
      return {...result,ok:false,error:'injected failure'};
    }
    return result;
  };
  assert.throws(()=>createCitizensWithSelectedFurniture(matrix,{seed:11,objectId:chairId}),
    /spawn failed/);
  assert.deepEqual(matrix.scene.objects.slice(0,2),authored);
  assert.equal(matrix.selection.objectId,chairId);
  assert.equal(matrix.requireObject(earlierOrbId).assetId,'orb');
  assert.equal(matrix.requireObject(unrelatedId).assetId,'orb');
  assert.deepEqual(matrix.scene.objects.map(item=>item.objectId),
    [...authored.map(item=>item.objectId),unrelatedId]);
});

test('failed selected setup restores authored undo and redo history after complete rollback',()=>{
  const matrix=world();
  const chairId=spawn(matrix,'chair',pose(0,0));
  spawn(matrix,'block',pose(4,0));
  assert.equal(matrix.execute({requestId:'authored-undo',op:'undo'}).ok,true);
  matrix.setSelection(chairId,{x:0,y:0,z:0});
  const scene=structuredClone(matrix.scene);
  const undo=structuredClone(matrix.undo),redo=structuredClone(matrix.redo);
  const execute=matrix.execute.bind(matrix);
  matrix.execute=(command,options)=>{
    const receipt=execute(command,options);
    return command.requestId==='citizens-13-selected-bo'?{
      ...receipt,ok:false,error:'injected failure'}:receipt;
  };
  assert.throws(()=>createCitizensWithSelectedFurniture(matrix,{seed:13,objectId:chairId}),
    /spawn failed/);
  assert.deepEqual(matrix.scene,scene);
  assert.deepEqual(matrix.undo,undo);
  assert.deepEqual(matrix.redo,redo);
  assert.equal(matrix.selection.objectId,chairId);
});

test('a setup orb with a mismatched observed pose is removed on failed start',()=>{
  const matrix=world();
  const chairId=spawn(matrix,'chair',pose(0,0));
  const authored=structuredClone(matrix.scene);
  const execute=matrix.execute.bind(matrix);
  matrix.execute=(command,options)=>{
    const receipt=execute(command,options);
    if(command.requestId==='citizens-19-selected-ada')
      matrix.requireObject(receipt.objectId).transform.position.x+=.4;
    return receipt;
  };
  assert.throws(()=>createCitizensWithSelectedFurniture(matrix,{seed:19,objectId:chairId}),
    /spawn failed/);
  assert.deepEqual(matrix.scene,authored);
});

test('resized resident is incompatible with fixed navigation clearance on resume and restore',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:23});
  const saved=sim.exportState();
  const ada=matrix.requireObject(saved.residents[0].objectId);
  ada.transform.scale={x:10,y:10,z:10};
  assert.equal(sim.resume().paused,true);
  assert.throws(()=>sim.exportState(),/binding is missing or incompatible/);
  assert.throws(()=>CitizensSimulation.restore(matrix,saved),
    /resident object is missing or incompatible/);
});

test('selected furniture far from the origin keeps exploration local and replayable',()=>{
  const matrix=world();
  const chairId=spawn(matrix,'chair',pose(50,0));
  const sim=createCitizensWithSelectedFurniture(matrix,{seed:5,objectId:chairId});
  let explored=false;
  for(let i=0;i<300;i++){
    const state=sim.step();
    for(const resident of state.residents){
      if(resident.activity?.kind==='explore')
        assert.ok(resident.activity.target.x>40&&resident.activity.target.x<60);
    }
    if(state.log.some(entry=>entry.event==='completed'&&
      entry.message.includes('explore'))){explored=true;break;}
  }
  assert.equal(explored,true,'a distant resident must complete local exploration');
  const saved=sim.exportState(),scene=structuredClone(matrix.scene);
  const restoredWorld=world();
  assert.equal(restoredWorld.execute({requestId:'restore-distant-scene',
    op:'load',scene}).ok,true);
  assert.deepEqual(CitizensSimulation.restore(restoredWorld,saved).exportState(),saved);
});

test('an enclosed authored chair fails before spawning residents',()=>{
  const matrix=world();
  const chairId=spawn(matrix,'chair',pose(0,0));
  spawn(matrix,'wall',pose(0,-.8));
  spawn(matrix,'wall',pose(0,.8));
  spawn(matrix,'wall',pose(-.8,0,90));
  spawn(matrix,'wall',pose(.8,0,90));
  const authored=structuredClone(matrix.scene);
  assert.equal(citizensFurnitureReadiness(matrix,chairId),'',
    'readiness performs cheap checks; explicit start searches routes');
  assert.throws(()=>createCitizensWithSelectedFurniture(matrix,{seed:29,objectId:chairId}),
    /Citizens cannot start here:.*(route|clear|Destination|No )/i);
  assert.deepEqual(matrix.scene,authored);
});

test('movement, finite use and observed completion produce visible changing needs',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:22});
  const initial=sim.snapshot().residents.map(resident=>resident.needs);
  const startPositions=matrix.scene.objects.filter(object=>object.assetId==='orb')
    .map(object=>structuredClone(object.transform.position));
  let state,adaRest=false,boEat=false,boMealIncreased=false;
  for(let i=0;i<120;i++){
    const hungerBefore=sim.snapshot().residents.find(item=>item.id==='bo').needs.hunger;
    state=sim.step();
    for(const station of state.stations){
      assert.ok(holder(station)===null||state.residents.some(resident=>
        resident.id===holder(station)&&resident.activity?.stationId===station.id&&
        resident.activity.executionId===station.claim.executionId));
    }
    const current=state.log.filter(entry=>entry.tick===state.clockTick&&
      entry.event==='completed');
    adaRest ||= current.some(entry=>entry.residentId==='ada'&&
      entry.message.includes('rest'));
    if(current.some(entry=>entry.residentId==='bo'&&entry.message.includes('eat'))){
      boEat=true;
      boMealIncreased=state.residents.find(item=>item.id==='bo').needs.hunger>hungerBefore;
    }
    if(adaRest&&boEat)break;
  }
  const endPositions=matrix.scene.objects.filter(object=>object.assetId==='orb')
    .map(object=>object.transform.position);
  assert.notDeepEqual(endPositions,startPositions);
  assert.ok(state.log.some(entry=>entry.event==='arrived'&&entry.residentId==='ada'));
  assert.equal(adaRest,true);
  assert.equal(boEat,true);
  assert.ok(state.residents[0].needs.energy>initial[0].energy);
  assert.equal(boMealIncreased,true,'Bo gained hunger only on the observed meal tick');
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
  assert.equal(state.residents.find(resident=>resident.id==='bo').activity?.phase,'egress',
    'the chair remains claimed until Bo leaves its approach');
  assert.equal(holder(state.stations.find(station=>station.id==='chair')),'bo');
  for(let tick=0;tick<20&&holder(state.stations.find(station=>station.id==='chair'));tick++)
    state=sim.step();
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
  delete legacy.clockSpeed;
  delete legacy.actionSequence;
  delete legacy.retiredResidentIds;
  delete legacy.socialSession;
  delete legacy.socialEvents;
  delete legacy.relationships;
  delete legacy.nextSocialTick;
  stripV9Fields(legacy);
  for(const resident of legacy.residents){
    delete resident.routines;
    delete resident.lastDecision;
    delete resident.socialSessionId;
    if(resident.activity){
      delete resident.activity.executionId;
      delete resident.activity.routeRetries;
      delete resident.activity.routeGeometryId;
    }
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
    assert.equal(migrated.schemaVersion,11);
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

test('v2 checkpoints migrate to v11 without changing active claims or Matrix objects',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:31});
  sim.step();
  const saved=sim.exportState();
  saved.schemaVersion=2;
  delete saved.clockSpeed;
  delete saved.socialSession;delete saved.socialEvents;
  delete saved.relationships;delete saved.nextSocialTick;
  stripV9Fields(saved);
  for(const resident of saved.residents){
    delete resident.routines;
    delete resident.lastDecision;
    delete resident.socialSessionId;
    if(resident.activity){
      delete resident.activity.routeRetries;
      delete resident.activity.routeGeometryId;
    }
  }
  for(const station of saved.stations)delete station.interaction;
  const scene=structuredClone(matrix.scene);
  const migrated=CitizensSimulation.restore(matrix,saved).exportState();
  assert.equal(migrated.schemaVersion,11);
  assert.deepEqual(migrated.stations,saved.stations.map(station=>
    ({...station,interaction:null})));
  assert.deepEqual(migrated.relationships,[{a:'ada',b:'bo',score:50,completed:[]}]);
  assert.equal(migrated.socialSession,null);
  assert.ok(migrated.nextSocialTick>=35);
  assert.deepEqual(matrix.scene,scene);
});

test('v3 social checkpoints migrate only when visible ended receipts explain the score',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
  stepUntil(sim,state=>state.relationships[0].completed.length===1,300);
  const current=sim.exportState();
  assert.equal(current.relationships[0].score,55);
  const old=structuredClone(current);
  old.schemaVersion=3;
  delete old.clockSpeed;
  stripV9Fields(old);
  for(const station of old.stations)delete station.interaction;
  for(const relation of old.relationships)delete relation.completed;
  for(const resident of old.residents){
    delete resident.routines;
    delete resident.lastDecision;
    if(resident.activity){
      delete resident.activity.routeRetries;
      delete resident.activity.routeGeometryId;
    }
  }
  const scene=structuredClone(matrix.scene);
  const expected=structuredClone(current);
  for(const resident of expected.residents){
    resident.needs.social=50;
    resident.preferences.converse=resident.id==='ada'?1.2:1.1;
    resident.lastDecision=null;
    if(resident.activity){
      resident.activity.routeRetries=0;
      resident.activity.routeGeometryId=null;
    }
  }
  assert.deepEqual(CitizensSimulation.restore(matrix,old).exportState(),expected);
  assert.deepEqual(matrix.scene,scene);

  const inflated=structuredClone(old);
  inflated.relationships[0].score=60;
  assert.throws(()=>CitizensSimulation.restore(matrix,inflated),
    /Citizens v3 relationship history is incomplete or inconsistent/);
  const missingReceipt=structuredClone(old);
  missingReceipt.socialEvents=missingReceipt.socialEvents.filter(event=>
    event.event!=='ended');
  assert.throws(()=>CitizensSimulation.restore(matrix,missingReceipt),
    /Citizens v3 relationship history is incomplete or inconsistent/);
  const forgedScore=structuredClone(missingReceipt);
  forgedScore.relationships[0].score=99;
  assert.throws(()=>CitizensSimulation.restore(matrix,forgedScore),
    /Citizens v3 relationship history is incomplete or inconsistent/);
  assert.deepEqual(matrix.scene,scene);
});

test('social need and converse preference change the selected action',()=>{
  const scenarios=[
    {name:'socially satisfied',social:100,preference:1.2,wantsSocial:false},
    {name:'socially deprived',social:0,preference:1.2,wantsSocial:true},
    {name:'low converse preference',social:50,preference:.2,wantsSocial:false},
    {name:'high converse preference',social:50,preference:2,wantsSocial:true}
  ];
  for(const scenario of scenarios){
    const {matrix,state}=socialOpportunity();
    state.residents[0].needs.social=scenario.social;
    state.residents[0].preferences.converse=scenario.preference;
    const after=CitizensSimulation.restore(matrix,state).step();
    const ada=after.residents.find(resident=>resident.id==='ada');
    assert.equal(Boolean(after.socialSession),scenario.wantsSocial,scenario.name);
    assert.equal(after.socialEvents.some(event=>event.event==='initiated'),
      scenario.wantsSocial,scenario.name);
    if(scenario.wantsSocial){
      assert.equal(after.socialSession.initiatorId,'ada');
      assert.equal(ada.lastDecision.mode,'social');
      assert.equal(ada.lastDecision.selectedKind,'converse');
      assert.equal(ada.lastDecision.candidates.length,1);
      assert.equal(ada.lastDecision.candidates[0].kind,'converse');
      assert.equal(ada.lastDecision.candidates[0].preference,scenario.preference);
      assert.ok(ada.lastDecision.candidates[0].score>=35);
    }
    assert.equal(after.relationships[0].score,50,
      'selecting or offering conversation does not complete it');
  }
});

test('critical hunger takes precedence over even a strong social choice',()=>{
  const {matrix,state}=socialOpportunity();
  state.residents[0].needs.hunger=14;
  state.residents[0].needs.social=0;
  state.residents[0].preferences.converse=2;
  const after=CitizensSimulation.restore(matrix,state).step();
  assert.equal(after.socialSession,null);
  assert.equal(after.socialEvents.length,0);
  const ada=after.residents.find(resident=>resident.id==='ada');
  assert.equal(ada.lastDecision.mode,'needs');
  assert.equal(ada.lastDecision.selectedKind,'eat');
  assert.equal(ada.activity?.kind,'eat');
  assert.equal(ada.needs.social,0);
});

test('a socially deprived resident cannot reserve a critically hungry invitee',()=>{
  for(const [initiatorId,inviteeId] of [['ada','bo'],['bo','ada']]){
    const {matrix,state}=socialOpportunity();
    const initiator=state.residents.find(resident=>resident.id===initiatorId);
    const invitee=state.residents.find(resident=>resident.id===inviteeId);
    initiator.needs.social=0;
    invitee.needs.hunger=14;
    const after=CitizensSimulation.restore(matrix,state).step();
    const hungry=after.residents.find(resident=>resident.id===inviteeId);
    assert.equal(after.socialSession,null);
    assert.equal(after.socialEvents.length,0);
    assert.equal(hungry.socialSessionId,null);
    assert.equal(hungry.lastDecision.mode,'needs');
    assert.equal(hungry.lastDecision.selectedKind,'eat');
    assert.equal(hungry.activity?.kind,'eat');
    assert.equal(after.relationships[0].score,50);
  }
});

test('an idle resident logs one bounded wait while a social peer is busy',()=>{
  for(const longNames of [false,true]){
    const {matrix,state}=socialOpportunity();
    state.nextSocialTick=401;
    state.residents[0].needs.social=0;
    state.residents[1].needs.energy=0;
    if(longNames){
      state.residents[0].name='A'.repeat(40);
      state.residents[1].name='B'.repeat(40);
    }
    const sim=CitizensSimulation.restore(matrix,state);
    const beforeWindow=sim.step();
    assert.equal(beforeWindow.clockTick,400);
    assert.equal(beforeWindow.residents.find(item=>item.id==='bo').activity?.kind,'rest');
    for(let i=0;i<3;i++)sim.step();
    const after=sim.exportState();
    assert.equal(after.socialSession,null);
    assert.equal(after.residents.find(item=>item.id==='ada').activity,null);
    const notices=after.log.filter(entry=>entry.residentId==='ada'&&
      entry.event==='waiting'&&entry.message.includes('conversation'));
    assert.equal(notices.length,1);
    assert.equal(notices[0].tick,401);
    assert.ok(notices[0].message.length<=160);
    if(!longNames)assert.ok(notices[0].message.includes('through minute 413'));
    assert.deepEqual(CitizensSimulation.restore(matrix,after).exportState(),after);
  }
});

test('v9 restore rejects forged social choice traces without changing Matrix',()=>{
  const {matrix,state}=socialOpportunity();
  state.residents[0].needs.social=0;
  const selected=CitizensSimulation.restore(matrix,state).step();
  assert.equal(selected.residents[0].lastDecision.mode,'social');
  const scene=structuredClone(matrix.scene);
  for(const mutate of [
    invalid=>{invalid.residents[0].lastDecision.selectedKind='eat';},
    invalid=>{invalid.residents[0].lastDecision.candidates[0].score=0;},
    invalid=>{invalid.residents[0].lastDecision.candidates[0].preference=3;},
    invalid=>{invalid.residents[0].lastDecision.candidates.push(
      structuredClone(invalid.residents[0].lastDecision.candidates[0]));}
  ]){
    const invalid=structuredClone(selected);
    mutate(invalid);
    assert.throws(()=>CitizensSimulation.restore(matrix,invalid),
      /Invalid Citizens social decision trace/);
    assert.deepEqual(matrix.scene,scene);
  }
});

const socialHistoryThrough=count=>{
  const {matrix,state}=socialOpportunity();
  for(const resident of state.residents)resident.needs.social=0;
  let sim=CitizensSimulation.restore(matrix,state);
  const receipts=new Map(),original=matrix.execute.bind(matrix);
  matrix.execute=(command,options)=>{
    const receipt=original(command,options);
    if(command.op==='interact'&&command.kind==='converse')
      receipts.set(receipt.requestId,receipt);
    return receipt;
  };
  const completed=[];
  let lastSessionId='';
  for(let i=0;i<600&&completed.length<count;i++){
    const after=sim.step(),record=after.relationships[0].completed.at(-1);
    if(record&&record.sessionId!==lastSessionId){
      const receipt=receipts.get(record.requestId);
      assert.equal(receipt?.ok,true,'the relationship ledger needs a Matrix receipt');
      assert.equal(receipt.outcome.kind,'converse');
      assert.equal(receipt.outcome.sessionId,record.sessionId);
      completed.push(record);
      lastSessionId=record.sessionId;
      if(completed.length<count){
        const next=sim.exportState();
        next.nextSocialTick=next.clockTick+1;
        for(const resident of next.residents)
          resident.needs={hunger:95,energy:95,fun:95,social:0};
        sim=CitizensSimulation.restore(matrix,next);
      }
    }
  }
  assert.equal(completed.length,count,`expected ${count} observed conversations`);
  return {matrix,sim,completed};
};

test('v11 rejects an appointment receipt that reuses an ended social request sequence',()=>{
  const {matrix,sim,completed}=socialHistoryThrough(1);
  const clock=sim.snapshot().clockTick;
  sim.scheduleAppointment('ada',{
    kind:'eat',startTick:clock+1,deadlineTick:clock+60});
  const saved=stepUntil(sim,state=>appointmentOf(state).status==='completed',70);
  const socialSequence=completed[0].requestId.match(/-([0-9]+)$/)[1];
  const broken=structuredClone(saved),appointment=appointmentOf(broken);
  appointment.requestId=appointment.requestId.replace(/-[0-9]+$/,
    `-${socialSequence}`);
  assert.notEqual(appointment.requestId,appointmentOf(saved).requestId);
  const scene=structuredClone(matrix.scene);
  assert.throws(()=>CitizensSimulation.restore(matrix,broken),
    /Invalid completed Citizens appointment/);
  assert.deepEqual(matrix.scene,scene);
  assert.deepEqual(sim.exportState(),saved);
});

test('relationship ledger rejects forged scores, receipts, and event mismatches',()=>{
  const {matrix,sim}=socialHistoryThrough(2);
  const saved=sim.exportState(),scene=structuredClone(matrix.scene);
  assert.equal(saved.relationships[0].completed.length,2);
  const variants=[
    state=>{state.relationships[0].score=65;},
    state=>{state.relationships[0].completed.pop();},
    state=>{state.relationships[0].completed[0].requestId='citizens-1-social-99-1';},
    state=>{state.relationships[0].completed[0].tick++;},
    state=>{state.relationships[0].completed.reverse();},
    state=>{state.relationships[0].completed[1].sessionId=
      state.relationships[0].completed[0].sessionId;},
    state=>{state.socialEvents.find(event=>event.event==='ended').requestId=
      'citizens-1-social-99-1';}
  ];
  for(const change of variants){
    const broken=structuredClone(saved);change(broken);
    assert.throws(()=>CitizensSimulation.restore(matrix,broken),/Invalid Citizens/);
    assert.deepEqual(matrix.scene,scene);
  }
});

test('completed receipt history rolls at ten while relationship stays saturated',()=>{
  const {matrix,sim,completed}=socialHistoryThrough(11);
  const state=sim.exportState();
  assert.equal(state.relationships[0].score,100);
  assert.deepEqual(state.relationships[0].completed,completed.slice(-10));
  assert.ok(state.socialEvents.filter(event=>event.event==='ended').every(event=>
    state.relationships[0].completed.some(record=>
      `${record.sessionId}-ended-${record.tick}`===event.id&&
      record.requestId===event.requestId)));
  assert.deepEqual(CitizensSimulation.restore(matrix,state).exportState(),state);
});

test('need-driven conversations grant social benefit and relationship only on a receipt',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
  const converseReceipts=new Map(),original=matrix.execute.bind(matrix);
  matrix.execute=(command,options)=>{
    const receipt=original(command,options);
    if(command.op==='interact'&&command.kind==='converse')
      converseReceipts.set(receipt.requestId,receipt);
    return receipt;
  };
  let previous=sim.snapshot();
  const allEvents=[];
  let sawIndividualCompletion=false,sawSocialCompletionLog=false;
  for(let i=0;i<500;i++){
    const state=sim.step();
    sawIndividualCompletion||=state.log.some(entry=>entry.tick===state.clockTick&&
      entry.event==='completed'&&['rest','eat','explore'].some(kind=>
        entry.message.includes(`completed ${kind}`)));
    sawSocialCompletionLog||=state.log.some(entry=>entry.tick===state.clockTick&&
      entry.event==='completed'&&entry.message.includes('Social ended'));
    const event=state.socialEvents.at(-1)?.id!==previous.socialEvents.at(-1)?.id?
      state.socialEvents.at(-1):null;
    if(event)allEvents.push(event);
    const ended=event?.event==='ended';
    const changed=state.relationships[0].score!==previous.relationships[0].score;
    assert.equal(changed,ended,
    'relationship changes only on a matching observed social completion');
    if(event?.event==='initiated'){
      const initiator=state.residents.find(resident=>resident.id===event.initiatorId);
      assert.equal(initiator.lastDecision.mode,'social');
      assert.equal(initiator.lastDecision.tick,event.tick);
      assert.equal(initiator.lastDecision.selectedKind,'converse');
      assert.equal(initiator.lastDecision.candidates.length,1);
      assert.ok(initiator.lastDecision.candidates[0].score>=35);
    }
    if(ended){
      const receipt=converseReceipts.get(event.requestId);
      assert.equal(receipt?.ok,true);
      assert.equal(receipt.outcome.kind,'converse');
      assert.equal(receipt.outcome.sessionId,
        event.id.slice(0,-`-ended-${event.tick}`.length));
    }
    for(const resident of state.residents){
      const before=previous.residents.find(item=>item.id===resident.id);
      const decayed=Math.max(0,Math.min(100,Math.round(
        (before.needs.social-.1)*100)/100));
      assert.equal(resident.needs.social,Math.max(0,Math.min(100,
        Math.round((decayed+(ended?35:0))*100)/100)),
      'social need rises only after observed conversation');
    }
    previous=state;
  }
  assert.ok(allEvents.some(event=>event.event==='initiated'));
  assert.ok(allEvents.some(event=>['declined','timed_out'].includes(event.event)));
  assert.ok(allEvents.some(event=>event.event==='accepted'));
  const ended=allEvents.filter(event=>event.event==='ended');
  assert.ok(ended.length>=1);
  assert.equal(previous.relationships[0].score,50+5*ended.length);
  assert.deepEqual(previous.relationships[0].completed,ended.map(event=>({
    sessionId:event.id.slice(0,-`-ended-${event.tick}`.length),
    requestId:event.requestId,tick:event.tick})));
  assert.ok(ended.every(event=>event.requestId.startsWith('citizens-2-social-')));
  assert.ok(sawSocialCompletionLog);
  assert.ok(sawIndividualCompletion,
  'individual need actions continue alongside bounded social sessions');
  assert.deepEqual(sim.exportState(),previous);
});

test('declined and unanswered invitations do not grant social benefit',()=>{
  for(const [rngState,terminal] of [[1,'declined'],[0x33333333,'timed_out']]){
    const {matrix,state}=socialOpportunity();
    state.rngState=rngState;
    for(const resident of state.residents)resident.needs.social=10;
    const sim=CitizensSimulation.restore(matrix,state);
    const offered=sim.step();
    assert.equal(offered.socialSession?.phase,'offered');
    const result=stepUntil(sim,current=>current.socialEvents.at(-1)?.event===terminal,
      8);
    assert.equal(result.socialSession,null);
    assert.equal(result.relationships[0].score,50);
    assert.deepEqual(result.relationships[0].completed,[]);
    assert.ok(result.residents.every(resident=>resident.needs.social<10));
    assert.ok(!result.socialEvents.some(event=>event.event==='ended'));
  }
});

test('an accepted mid-conversation checkpoint replays one observed end after restore',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
  stepUntil(sim,state=>state.socialSession?.phase==='active'&&
    state.socialSession.travelTicks>0,300);
  assert.equal(sim.snapshot().socialSession?.phase,'active');
  assert.ok(sim.snapshot().socialSession.travelTicks>0);
  sim.pause();
  const saved=sim.exportState(),scene=structuredClone(matrix.scene);
  assert.deepEqual(sim.advance(),saved,'paused conversation does not progress');
  const restoredWorld=world();
  assert.equal(restoredWorld.execute({requestId:'load-social',op:'load',scene}).ok,true);
  const restored=CitizensSimulation.restore(restoredWorld,saved);
  assert.deepEqual(restored.exportState(),saved);
  assert.deepEqual(restored.advance(),saved,'restored pause remains effective');
  sim.resume();
  restored.resume();
  for(let i=0;i<24;i++){
    assert.deepEqual(sim.advance(),restored.advance());
    assert.deepEqual(matrix.scene,restoredWorld.scene);
  }
  const after=restored.exportState();
  assert.equal(after.socialEvents.filter(event=>event.event==='ended').length,1);
  assert.equal(after.relationships[0].score,55);
  assert.deepEqual(after.relationships[0].completed,[{
    sessionId:after.socialEvents.find(event=>event.event==='ended').id.split('-ended-')[0],
    requestId:after.socialEvents.find(event=>event.event==='ended').requestId,
    tick:after.socialEvents.find(event=>event.event==='ended').tick}]);
  assert.equal(after.socialSession,null);
  assert.ok(after.residents.every(resident=>resident.socialSessionId===null));
  for(const resident of after.residents){
    const before=saved.residents.find(item=>item.id===resident.id);
    assert.equal(resident.needs.social,Math.min(100,Math.round(
      (before.needs.social-2.4+35)*100)/100),
    'restored conversation grants exactly one social benefit');
  }
});

test('a forged converse outcome interrupts the session without granting social benefit',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
  stepUntil(sim,state=>state.socialSession?.phase==='active',300);
  assert.equal(sim.snapshot().socialSession?.phase,'active');
  const before=sim.snapshot();
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
  assert.ok(after.residents.every(resident=>resident.needs.social<=
    before.residents.find(item=>item.id===resident.id).needs.social));
});

test('authored movement and deletion cancel both participants atomically',()=>{
  for(const mutation of ['move','delete']){
    const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
    sim.resume();
    stepUntil(sim,state=>state.socialSession?.phase==='active',300);
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
    stepUntil(sim,state=>state.socialSession?.phase==='active',300);
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

test('v4 restore rejects mismatched bilateral IDs, forged social events and unknown fields',()=>{
  const matrix=world(),sim=createCitizensDemo(matrix,{seed:2});
  stepUntil(sim,state=>state.socialSession?.phase==='active',300);
  const saved=sim.exportState(),scene=structuredClone(matrix.scene);
  const variants=[
    state=>{state.residents[0].socialSessionId='other-session';},
    state=>{state.socialSession.expiresTick++;},
    state=>{state.socialSession.executionId=state.residents[0].activity?.executionId||0;},
    state=>{state.socialEvents[0].requestId='forged';},
    state=>{state.relationships[0].a='bo';},
    state=>{state.relationships[0].score=55;},
    state=>{state.socialSession.extra=true;}
  ];
  for(const change of variants){
    const broken=structuredClone(saved);change(broken);
    assert.throws(()=>CitizensSimulation.restore(matrix,broken),/Invalid Citizens/);
    assert.deepEqual(matrix.scene,scene);
  }
});

test('v4 checkpoint text accepts paired Unicode and rejects unpaired UTF-16 surrogates',()=>{
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
  invalidId.relationships=[{a:'bo',b:'\udfff',score:50,completed:[]}];
  assert.throws(()=>CitizensSimulation.restore(matrix,invalidId),/Invalid Citizens resident/);
});
