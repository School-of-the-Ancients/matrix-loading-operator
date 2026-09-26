import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {CitizensSimulation,createCitizensDemo} from '../src/citizens.js';

const world=()=>{
  let sequence=0;
  return new MatrixWorld(()=>`citizen-object-${++sequence}`);
};

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
  assert.equal(first.stations.find(station=>station.id==='chair').holder,'ada');
  assert.equal(first.residents[0].activity.kind,'rest');
  assert.equal(first.residents[1].activity.kind,'eat');
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
  for(let i=0;i<40;i++){
    state=sim.step();
    for(const station of state.stations){
      assert.ok(station.holder===null||state.residents.some(resident=>
        resident.id===station.holder&&resident.activity?.stationId===station.id));
    }
    if(state.log.some(entry=>entry.event==='completed'&&entry.residentId==='ada')&&
       state.log.some(entry=>entry.event==='completed'&&entry.residentId==='bo'))break;
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
  assert.equal(state.stations.find(station=>station.id==='chair').holder,null);
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
  assert.equal(saved.stations.find(station=>station.id==='chair').holder,'ada');
  assert.equal(saved.residents[0].activity.phase,'use');
  const savedScene=structuredClone(a.scene);
  const restoredWorld=world();
  assert.equal(restoredWorld.execute({requestId:'load',op:'load',scene:savedScene}).ok,true);
  const restored=CitizensSimulation.restore(restoredWorld,saved);
  assert.deepEqual(restored.exportState(),saved);
  assert.equal(restoredWorld.scene.objects.length,4);
  for(let i=0;i<18;i++){
    assert.deepEqual(first.step(),restored.step());
    assert.deepEqual(a.scene,restoredWorld.scene);
  }
  assert.equal(restored.snapshot().log.filter(entry=>entry.event==='completed'&&
    entry.residentId==='ada'&&entry.message.includes('rest')).length,1,
  'a restored in-progress rest must grant its outcome once');
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
  assert.equal(failed.stations.find(station=>station.id==='chair').holder,null);
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
  assert.notEqual(state.stations.find(station=>station.id==='chair').holder,'ada');
});

test('removing a reserved station cancels the activity and invalidates restore',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:31});
  sim.step();
  const before=sim.snapshot();
  assert.equal(before.stations.find(station=>station.id==='chair').holder,'ada');
  const beforeEnergy=before.residents[0].needs.energy;
  const chairId=before.stations.find(station=>station.id==='chair').objectId;
  assert.equal(matrix.execute({requestId:'remove-chair',op:'delete',objectId:chairId}).ok,true);
  const after=sim.step();
  assert.equal(after.stations.find(station=>station.id==='chair').holder,null);
  assert.equal(after.residents[0].activity,null);
  assert.ok(after.residents[0].needs.energy<beforeEnergy);
  assert.ok(after.log.some(entry=>entry.event==='failed'&&entry.message.includes('target')));
  const scene=structuredClone(matrix.scene);
  assert.throws(()=>CitizensSimulation.restore(matrix,before),/missing or incompatible/);
  assert.deepEqual(matrix.scene,scene,'rejected restore must not change the world');
});

test('restore rejects corrupt reservation and wrong room without changing Matrix scene',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:4});
  sim.step();
  const before=structuredClone(matrix.scene);
  const broken=sim.exportState();
  broken.stations.find(station=>station.id==='chair').holder='bo';
  assert.throws(()=>CitizensSimulation.restore(matrix,broken),/reservation/);
  const wrongRoom=sim.exportState();
  wrongRoom.world.roomId='elsewhere';
  assert.throws(()=>CitizensSimulation.restore(matrix,wrongRoom),/Invalid Citizens state/);
  assert.deepEqual(matrix.scene,before);
  assert.equal(matrix.scene.objects.length,4);
});

test('restore rejects a checkpoint missing a required activity station',()=>{
  const matrix=world();
  const sim=createCitizensDemo(matrix,{seed:29});
  const saved=sim.exportState();
  saved.stations=saved.stations.filter(station=>station.kind!=='rest');
  const before=structuredClone(matrix.scene);
  assert.throws(()=>CitizensSimulation.restore(matrix,saved),/Invalid Citizens state/);
  assert.deepEqual(matrix.scene,before);
});
