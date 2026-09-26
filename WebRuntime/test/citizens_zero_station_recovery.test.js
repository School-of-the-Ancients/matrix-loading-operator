import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCHOR_ID,MatrixWorld} from '../src/protocol.js';
import {CitizensSimulation,createCitizensDemo,
  createCitizensWithSelectedFurniture} from '../src/citizens.js';
import {applyPCWorld} from '../src/world_checkpoint.js';
import {loadStoredWorld,restoreStoredWorld,saveStoredWorld,
  storedBrowserWorld,storedWorld} from '../src/scene_store.js';

const pose=(x,z,scale=1)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
  scale:{x:scale,y:scale,z:scale}});
const newWorld=prefix=>{
  let sequence=0;
  return new MatrixWorld(()=>`${prefix}-${++sequence}`);
};
const spawn=(world,requestId,assetId,transform)=>{
  const receipt=world.execute({requestId,op:'spawn',assetId,
    anchorId:ANCHOR_ID,transform});
  assert.equal(receipt.ok,true,receipt.error);
  return receipt.objectId;
};
const remove=(world,requestId,objectId)=>{
  const receipt=world.execute({requestId,op:'delete',objectId});
  assert.equal(receipt.ok,true,receipt.error);
};
const storage=()=>{
  const entries=new Map();
  return {getItem:key=>entries.get(key)??null,
    setItem:(key,value)=>entries.set(key,String(value)),
    removeItem:key=>entries.delete(key)};
};
const bounded=value=>Math.max(0,Math.min(100,Math.round(value*100)/100));
const interactionsUntil=(simulation,world,kinds,limit=300)=>{
  const receipts=[];
  const original=world.execute.bind(world);
  world.execute=(command,options)=>{
    const receipt=original(command,options);
    if(command.op==='interact')receipts.push({command,receipt});
    return receipt;
  };
  try{
    simulation.resume();
    for(let tick=0;tick<limit&&
      !kinds.every(kind=>receipts.some(item=>item.command.kind===kind));tick++){
      const before=simulation.snapshot();
      const after=simulation.step();
      for(const item of receipts.filter(item=>item.tick===undefined)){
        item.tick=after.clockTick;
        item.before=before.residents.find(resident=>
          resident.objectId===item.command.actorObjectId).needs;
        item.after=after.residents.find(resident=>
          resident.objectId===item.command.actorObjectId).needs;
      }
    }
  }finally{world.execute=original;}
  for(const kind of kinds){
    const matches=receipts.filter(item=>item.command.kind===kind&&item.receipt.ok);
    assert.ok(matches.length,`a ${kind} interaction must receive a Matrix receipt`);
    assert.equal(matches[0].receipt.requestId,matches[0].command.requestId);
    assert.equal(matches[0].receipt.outcome.kind,kind);
    assert.equal(matches[0].receipt.outcome.actorObjectId,
      matches[0].command.actorObjectId);
    assert.equal(matches[0].receipt.outcome.targetObjectId,
      matches[0].command.targetObjectId);
    const need=kind==='rest'?'energy':'hunger';
    const decay=kind==='rest'?.55:.45;
    const benefit=kind==='rest'?37:43;
    assert.equal(matches[0].after[need],
      bounded(bounded(matches[0].before[need]-decay)+benefit),
      `${kind} receipt yields the expected need change`);
  }
  return receipts;
};

test('a sole selected station can be deleted and replaced with rollback, browser save, and PC restore',async()=>{
  const world=newWorld('sole-station');
  const firstChair=spawn(world,'first-chair','chair',pose(0,-2));
  const simulation=createCitizensWithSelectedFurniture(world,
    {seed:29,objectId:firstChair});
  simulation.resume();
  const occupied=simulation.step();
  assert.equal(occupied.stations[0].claim?.residentId,'ada');
  const residentIds=occupied.residents.map(resident=>[resident.id,resident.objectId]);
  remove(world,'remove-sole-chair',firstChair);
  const empty=simulation.reconcileWorld();
  assert.equal(empty.stations.length,0);
  assert.equal(empty.clockTick,occupied.clockTick);
  assert.deepEqual(empty.residents.map(resident=>[resident.id,resident.objectId]),residentIds);
  assert.deepEqual(empty.residents.map(resident=>resident.needs),
    occupied.residents.map(resident=>resident.needs));
  assert.ok(empty.residents.every(resident=>resident.activity===null));
  assert.equal(empty.paused,false,'station deletion does not stop surviving residents');
  const paused=simulation.pause();
  assert.equal(paused.clockTick,empty.clockTick);
  assert.equal(simulation.exportState().stations.length,0);

  const invalid=spawn(world,'invalid-replacement','orb',pose(7,7));
  assert.match(simulation.stationAdditionReadiness(invalid),/chair\/table|reviewed interaction/i);
  assert.throws(()=>simulation.addSelectedStation(invalid),/chair\/table|reviewed interaction/i);
  assert.deepEqual(simulation.snapshot(),paused);

  const replacement=spawn(world,'replacement-chair','chair',pose(0,-2));
  const adaPosition=world.requireObject(residentIds[0][1]).transform.position;
  const blocker=spawn(world,'blocked-chair-approach','wall',
    pose(adaPosition.x,adaPosition.z));
  assert.throws(()=>simulation.addSelectedStation(replacement),
    /cannot reach|blocked|No reachable/i);
  assert.deepEqual(simulation.snapshot(),paused,
    'an unreachable candidate cannot partially bind a station');
  remove(world,'unblock-chair',blocker);
  const added=simulation.addSelectedStation(replacement);
  assert.equal(added.paused,true);
  assert.equal(added.clockTick,empty.clockTick);
  assert.deepEqual(added.residents.map(resident=>[resident.id,resident.objectId]),residentIds);
  assert.equal(added.stations.length,1);
  assert.deepEqual(added.stations[0],{id:'chair',kind:'rest',objectId:replacement,
    capacity:1,claim:null,waiters:[],interaction:null,approachMode:'selected'});
  assert.equal(world.scene.objects.some(object=>object.objectId===firstChair),false);
  assert.equal(world.scene.objects.some(object=>object.objectId===replacement),true);

  world.citizens=simulation.exportState();
  const browser=storedBrowserWorld(world);
  const tab=storage(),durable=storage();
  assert.equal(saveStoredWorld(browser,tab,durable),'');
  const saved=loadStoredWorld(tab,durable).value;
  assert.equal(saved.version,3);
  assert.deepEqual(saved.citizens,world.citizens);
  const browserWorld=newWorld('browser-recovered');
  restoreStoredWorld(browserWorld,saved);
  assert.deepEqual(storedWorld(browserWorld),storedWorld(world));

  const pc=storedWorld(world),pcWorld=newWorld('pc-recovered');
  let exchanged=false;
  await applyPCWorld(pcWorld,pc,async()=>{exchanged=true;});
  assert.equal(exchanged,true);
  assert.deepEqual(storedWorld(pcWorld),pc);
  const restored=CitizensSimulation.restore(pcWorld,pcWorld.citizens);
  const receipts=interactionsUntil(restored,pcWorld,['rest']);
  const rest=receipts.find(item=>item.command.kind==='rest'&&item.receipt.ok);
  assert.equal(rest.command.targetObjectId,replacement);
  assert.ok(rest.command.requestId.startsWith('citizens-29-action-'));
  assert.ok(restored.snapshot().log.some(entry=>entry.event==='completed'&&
    entry.message.includes('rest')));
  assert.ok(restored.snapshot().residents.find(resident=>resident.id==='ada')
    .needs.energy>empty.residents.find(resident=>resident.id==='ada').needs.energy);
});

test('deleting both demo stations permits two selected replacements and exact observed uses',()=>{
  const world=newWorld('two-station');
  const simulation=createCitizensDemo(world,{seed:31});
  const inFlight=simulation.step();
  const residentIds=inFlight.residents.map(resident=>[resident.id,resident.objectId]);
  const oldStationIds=inFlight.stations.map(station=>station.objectId);
  for(const [index,id] of oldStationIds.entries())
    remove(world,`remove-demo-station-${index}`,id);
  const empty=simulation.reconcileWorld();
  assert.deepEqual(empty.stations,[]);
  assert.equal(empty.clockTick,inFlight.clockTick);
  assert.deepEqual(empty.residents.map(resident=>[resident.id,resident.objectId]),residentIds);
  assert.deepEqual(empty.residents.map(resident=>resident.needs),
    inFlight.residents.map(resident=>resident.needs));
  assert.ok(empty.residents.every(resident=>resident.activity===null));
  assert.deepEqual(CitizensSimulation.restore(world,simulation.exportState()).exportState(),
    simulation.exportState());

  const chair=spawn(world,'new-demo-chair','chair',pose(0,-2));
  const table=spawn(world,'new-demo-table','table',pose(2.15,-2,.7));
  const first=simulation.addSelectedStation(chair);
  assert.deepEqual(first.stations.map(station=>station.objectId),[chair]);
  const second=simulation.addSelectedStation(table);
  assert.deepEqual(second.stations.map(station=>station.objectId),[chair,table]);
  assert.deepEqual(second.stations.map(station=>station.approachMode),
    ['selected','selected']);
  assert.equal(second.clockTick,empty.clockTick);
  assert.deepEqual(second.residents.map(resident=>[resident.id,resident.objectId]),residentIds);
  assert.equal(oldStationIds.some(id=>world.scene.objects.some(item=>item.objectId===id)),false);
  world.citizens=simulation.exportState();
  const checkpoint=storedWorld(world);
  assert.equal(checkpoint.version,3);
  const recovered=newWorld('two-station-restored');
  restoreStoredWorld(recovered,checkpoint);
  assert.deepEqual(storedWorld(recovered),checkpoint);
  const restored=CitizensSimulation.restore(recovered,recovered.citizens);
  const receipts=interactionsUntil(restored,recovered,['rest','eat']);
  for(const [kind,target] of [['rest',chair],['eat',table]]){
    const observed=receipts.find(item=>item.command.kind===kind&&item.receipt.ok);
    assert.equal(observed.command.targetObjectId,target);
  }
  assert.ok(restored.snapshot().residents.some(resident=>
    resident.needs.energy>empty.residents.find(item=>item.id===resident.id).needs.energy));
  assert.ok(restored.snapshot().log.some(entry=>entry.event==='completed'&&
    entry.message.includes('eat')));
});
