import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {CitizensSimulation,createCitizensWithSelectedFurniture} from '../src/citizens.js';
import {segmentClear} from '../src/citizens_navigation.js';

const pose=(x,z,yaw=0)=>({position:{x,y:0,z},rotation:{x:0,y:yaw,z:0},
  scale:{x:1,y:1,z:1}});
const world=()=>{
  let next=0;
  return new MatrixWorld(()=>`route-object-${++next}`);
};
const spawn=(matrix,assetId,transform)=>{
  const receipt=matrix.execute({requestId:`authored-${assetId}-${matrix.scene.objects.length}`,
    op:'spawn',assetId,anchorId:'web-floor',transform});
  assert.equal(receipt.ok,true);
  return receipt.objectId;
};
const selected=()=>{
  const matrix=world();
  const chairId=spawn(matrix,'chair',pose(0,0));
  const wallId=spawn(matrix,'wall',pose(4,4));
  const sim=createCitizensWithSelectedFurniture(matrix,{seed:3,objectId:chairId});
  const first=sim.step();
  const ada=first.residents.find(resident=>resident.id==='ada');
  assert.equal(ada.activity?.kind,'rest');
  return {matrix,sim,chairId,wallId,ada};
};
const moveWall=(matrix,wallId,transform,requestId)=>{
  const receipt=matrix.execute({requestId,op:'set_transform',
    objectId:wallId,transform});
  assert.equal(receipt.ok,true);
};

test('an authored wall moved mid-travel causes a safe detour and observed rest',()=>{
  const {matrix,sim,wallId,ada}=selected();
  const beforeId=ada.activity.routeGeometryId;
  moveWall(matrix,wallId,pose(-.9,0,90),'move-wall-into-route');
  assert.notEqual(matrix.navigationGeometryIdentity({excludeObjectIds:
    sim.snapshot().residents.map(resident=>resident.objectId)}),beforeId);
  const wall={id:wallId,cx:-.9,cz:0,halfX:1,halfZ:.06,
    yawRadians:Math.PI/2};
  let previous=structuredClone(matrix.requireObject(ada.objectId).transform.position);
  let detour=0,completed=false;
  for(let tick=0;tick<100;tick++){
    const state=sim.step();
    const after=matrix.requireObject(ada.objectId).transform.position;
    assert.equal(segmentClear(previous,after,[wall],.18),true,
      'every observed move must clear the changed wall');
    detour=Math.max(detour,Math.abs(after.z));
    previous=structuredClone(after);
    if(state.log.some(entry=>entry.residentId==='ada'&&entry.event==='completed'&&
      entry.message.includes('rest'))){completed=true;break;}
  }
  assert.equal(completed,true);
  assert.ok(detour>1.1,'Ada visibly navigated around the wall end');
  assert.ok(sim.snapshot().log.some(entry=>entry.residentId==='ada'&&
    entry.event==='rerouted'&&entry.message.includes('geometry changed')));
  assert.ok(sim.snapshot().residents.find(resident=>resident.id==='ada').needs.energy>
    ada.needs.energy,'rest benefit followed the runtime interaction');
});

test('a temporarily blocked route retains its claim and replays after checkpoint restore',()=>{
  const {matrix,sim,wallId,ada}=selected();
  const position=matrix.requireObject(ada.objectId).transform.position;
  moveWall(matrix,wallId,pose(position.x,position.z),'temporarily-block-route');
  const blocked=sim.step();
  const acting=blocked.residents.find(resident=>resident.id==='ada');
  assert.equal(acting.activity?.routeRetries,1);
  assert.equal(blocked.stations[0].claim?.residentId,'ada');
  assert.ok(blocked.log.some(entry=>entry.residentId==='ada'&&
    entry.event==='rerouted'&&entry.message.includes('retry 1/3')));
  assert.ok(acting.needs.energy<ada.needs.energy,
    'a blocked route grants no benefit');
  const saved=sim.exportState(),scene=structuredClone(matrix.scene);
  const restoredWorld=world();
  assert.equal(restoredWorld.execute({requestId:'restore-mid-retry',op:'load',scene}).ok,true);
  const restored=CitizensSimulation.restore(restoredWorld,saved);
  assert.deepEqual(restored.exportState(),saved);
  assert.deepEqual(restored.step(),sim.step(),
    'the second blocked retry is deterministic across restore');
  moveWall(matrix,wallId,pose(4,4),'clear-route-original');
  moveWall(restoredWorld,wallId,pose(4,4),'clear-route-restored');
  let completed=false;
  for(let tick=0;tick<100;tick++){
    const original=sim.step(),replayed=restored.step();
    assert.deepEqual(replayed,original);
    assert.deepEqual(restoredWorld.scene,matrix.scene);
    if(original.log.some(entry=>entry.residentId==='ada'&&
      entry.event==='completed'&&entry.message.includes('rest'))){
      completed=true;break;
    }
  }
  assert.equal(completed,true);
});

test('retry log with a long Unicode obstacle ID remains checkpoint-safe',()=>{
  const longWallId='x'+'🙂'.repeat(55);
  const ids=['unicode-chair',longWallId,'unicode-ada','unicode-bo'];
  let next=0;
  const matrix=new MatrixWorld(()=>ids[next++]);
  const chairId=spawn(matrix,'chair',pose(0,0));
  const wallId=spawn(matrix,'wall',pose(4,4));
  assert.equal(wallId,longWallId);
  const sim=createCitizensWithSelectedFurniture(matrix,{seed:3,objectId:chairId});
  const first=sim.step();
  const ada=first.residents.find(resident=>resident.id==='ada');
  assert.equal(ada.activity?.kind,'rest');
  const position=matrix.requireObject(ada.objectId).transform.position;
  moveWall(matrix,wallId,pose(position.x,position.z),'unicode-block-route');
  const blocked=sim.step();
  const retry=blocked.log.findLast(entry=>entry.residentId==='ada'&&
    entry.event==='rerouted'&&entry.message.includes('retry 1/3'));
  assert.ok(retry);
  assert.ok(retry.message.length<=160);
  assert.doesNotMatch(retry.message,/[\uD800-\uDBFF]$/,
    'the last code unit must not be a dangling high surrogate');
  const saved=sim.exportState();
  assert.deepEqual(CitizensSimulation.restore(matrix,saved).exportState(),saved);
});

test('a persistently blocked route fails after three retries and releases the seat',()=>{
  const {matrix,sim,wallId,ada}=selected();
  const position=matrix.requireObject(ada.objectId).transform.position;
  moveWall(matrix,wallId,pose(position.x,position.z),'persistently-block-route');
  const energy=ada.needs.energy;
  let state;
  for(let tick=0;tick<4;tick++)state=sim.step();
  const resident=state.residents.find(item=>item.id==='ada');
  assert.equal(resident.activity,null);
  assert.ok(resident.needs.energy<energy);
  assert.notEqual(state.stations[0].claim?.residentId,'ada');
  assert.ok(state.log.some(entry=>entry.residentId==='ada'&&entry.event==='failed'&&
    entry.message.includes('after 3 retries')));
  assert.equal(state.log.some(entry=>entry.residentId==='ada'&&
    entry.event==='completed'&&entry.message.includes('rest')),false);
});

test('v4 active checkpoints migrate and v9 retry state rejects forged values',()=>{
  const {matrix,sim}=selected();
  const state=sim.exportState();
  assert.equal(state.schemaVersion,9);
  const v4=structuredClone(state);
  v4.schemaVersion=4;
  delete v4.clockSpeed;
  for(const resident of v4.residents){
    delete resident.needs.social;
    delete resident.preferences.converse;
    delete resident.routines;
    delete resident.lastDecision;
  }
  for(const resident of v4.residents)if(resident.activity){
    delete resident.activity.routeRetries;
    delete resident.activity.routeGeometryId;
  }
  for(const station of v4.stations)delete station.interaction;
  const migrated=CitizensSimulation.restore(matrix,v4).exportState();
  assert.equal(migrated.schemaVersion,9);
  assert.equal(migrated.residents.find(resident=>resident.id==='ada').activity.routeRetries,0);
  assert.equal(migrated.residents.find(resident=>resident.id==='ada').activity.routeGeometryId,null);
  for(const value of [4,-1,1.5,true]){
    const forged=structuredClone(state);
    forged.residents[0].activity.routeRetries=value;
    assert.throws(()=>CitizensSimulation.restore(matrix,forged),/Invalid Citizens resident/);
  }
  const forged=structuredClone(state);
  forged.residents[0].activity.routeGeometryId='x'.repeat(129);
  assert.throws(()=>CitizensSimulation.restore(matrix,forged),/Invalid Citizens resident/);
  delete forged.residents[0].activity.routeGeometryId;
  assert.throws(()=>CitizensSimulation.restore(matrix,forged),/Invalid Citizens resident/);
});
