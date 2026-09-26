import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCHOR_ID,MatrixWorld} from '../src/protocol.js';
import {CitizensSimulation,createCitizensWithSelectedFurniture} from '../src/citizens.js';

const seatSha='a'.repeat(64);
const foodSha='b'.repeat(64);
const seatAsset={assetId:`web:second-station-seat:${seatSha.slice(0,12)}`,
  displayName:'Reviewed seat',description:'Static seat',spawnScale:1,
  sha256:seatSha,byteLength:1024,url:`/api/web/assets/${seatSha}.glb`,
  localBounds:{center:{x:0,y:.475,z:0},size:{x:.62,y:.95,z:.62}},
  geometry:{animationClips:[]}};
const foodAsset={assetId:`web:second-station-food:${foodSha.slice(0,12)}`,
  displayName:'Reviewed food table',description:'Static table',spawnScale:1,
  sha256:foodSha,byteLength:1024,url:`/api/web/assets/${foodSha}.glb`,
  localBounds:{center:{x:0,y:.4215,z:0},size:{x:1.2,y:.843,z:.8}},
  geometry:{animationClips:[]}};
const seatInteraction={schemaVersion:1,interactionId:'seat-rest',kind:'rest',
  assetSha256:seatSha,
  requiredCapabilities:['static-virtual-floor','verified-rendered-bounds'],
  availability:['target-static','floor-aligned','rendered-verified'],
  approachPose:{x:0,z:-.75},usePose:{x:0,z:-.2},rangeMeters:.8,
  durationTicks:7,capacity:1,effect:{need:'energy',delta:22}};
const foodInteraction={schemaVersion:1,interactionId:'food-eat',kind:'eat',
  assetSha256:foodSha,
  requiredCapabilities:['static-virtual-floor','verified-rendered-bounds'],
  availability:['target-static','floor-aligned','rendered-verified'],
  approachPose:{x:0,z:-.9},usePose:{x:0,z:-.28},rangeMeters:.8,
  durationTicks:5,capacity:1,effect:{need:'hunger',delta:32}};
const pose=(x,z,scale=1)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
  scale:{x:scale,y:scale,z:scale}});
const rounded=value=>Math.max(0,Math.min(100,Math.round(value*100)/100));

function setup(seed=29){
  let sequence=0;
  const world=new MatrixWorld(()=>`dual-station-${++sequence}`);
  world.registerAssets([seatAsset,foodAsset]);
  const seat=world.execute({requestId:'spawn-seat',op:'spawn',
    assetId:seatAsset.assetId,anchorId:ANCHOR_ID,transform:pose(0,-2)});
  assert.equal(seat.ok,true,seat.error);
  assert.equal(world.verifyPhysicsAsset(seatAsset.assetId,
    {x:.62,y:.95,z:.62},seat.objectId),true);
  const authored=world.execute({requestId:'author-seat',op:'set_interaction',
    objectId:seat.objectId,interaction:seatInteraction,expectedInteraction:null});
  assert.equal(authored.ok,true,authored.error);
  const simulation=createCitizensWithSelectedFurniture(world,
    {seed,objectId:seat.objectId});
  return {world,simulation,seatId:seat.objectId};
}

function spawnFood(world,{verify=true,author=true}={}){
  const food=world.execute({requestId:'spawn-food',op:'spawn',
    assetId:foodAsset.assetId,anchorId:ANCHOR_ID,transform:pose(2,0)});
  assert.equal(food.ok,true,food.error);
  if(verify)assert.equal(world.verifyPhysicsAsset(foodAsset.assetId,
    {x:1.2,y:.843,z:.8},food.objectId),true);
  if(author){
    const receipt=world.execute({requestId:'author-food',op:'set_interaction',
      objectId:food.objectId,interaction:foodInteraction,expectedInteraction:null});
    assert.equal(receipt.ok,true,receipt.error);
  }
  return food.objectId;
}

test('paused addition keeps resident IDs, active claim and FIFO waiter intact',()=>{
  const {world,simulation,seatId}=setup();
  const first=simulation.step();
  assert.equal(first.stations[0].claim?.residentId,'ada');
  assert.equal(first.stations[0].waiters[0]?.residentId,'bo');
  const foodId=spawnFood(world);
  assert.equal(simulation.resume().paused,false);
  const running=simulation.snapshot();
  assert.match(simulation.stationAdditionReadiness(foodId),/Pause Citizens/i);
  assert.throws(()=>simulation.addSelectedStation(foodId),/Pause Citizens/i);
  assert.deepEqual(simulation.snapshot(),running);
  simulation.pause();
  const before=simulation.snapshot();
  assert.equal(simulation.stationAdditionReadiness(foodId),'');
  const after=simulation.addSelectedStation(foodId);
  assert.equal(after.paused,true);
  assert.equal(after.stations.length,2);
  assert.deepEqual(after.residents,before.residents);
  assert.deepEqual(after.stations[0],{...before.stations[0],approachMode:'selected'});
  assert.deepEqual(after.stations[1],{id:'food',kind:'eat',objectId:foodId,
    capacity:1,claim:null,waiters:[],interaction:foodInteraction,
    approachMode:'selected'});
  assert.equal(world.requireObject(seatId).interaction.interactionId,'seat-rest');
  assert.equal(simulation.exportState().stations.length,2);
  assert.match(simulation.stationAdditionReadiness(foodId),/already has rest and food/i);
  assert.throws(()=>simulation.addSelectedStation(foodId),/already has rest and food/i);
});

test('same kind, unreviewed or unverified GLB, and blocked approach reject without mutation',()=>{
  const {world,simulation,seatId}=setup();
  const initial=simulation.snapshot();
  assert.match(simulation.stationAdditionReadiness(seatId),/already bound/i);
  assert.throws(()=>simulation.addSelectedStation(seatId),/already bound/i);
  assert.deepEqual(simulation.snapshot(),initial);

  const otherSeat=world.execute({requestId:'spawn-other-seat',op:'spawn',
    assetId:seatAsset.assetId,anchorId:ANCHOR_ID,transform:pose(-3,0)});
  assert.equal(otherSeat.ok,true,otherSeat.error);
  assert.equal(world.verifyPhysicsAsset(seatAsset.assetId,
    {x:.62,y:.95,z:.62},otherSeat.objectId),true);
  const reviewed=world.execute({requestId:'author-other-seat',op:'set_interaction',
    objectId:otherSeat.objectId,interaction:seatInteraction,expectedInteraction:null});
  assert.equal(reviewed.ok,true,reviewed.error);
  assert.match(simulation.stationAdditionReadiness(otherSeat.objectId),/already has a rest/i);
  assert.throws(()=>simulation.addSelectedStation(otherSeat.objectId),/already has a rest/i);
  assert.deepEqual(simulation.snapshot(),initial);

  const foodId=spawnFood(world,{verify:false,author:false});
  assert.match(simulation.stationAdditionReadiness(foodId),/reviewed interaction/i);
  assert.throws(()=>simulation.addSelectedStation(foodId),/reviewed interaction/i);
  assert.deepEqual(simulation.snapshot(),initial);
  assert.equal(world.verifyPhysicsAsset(foodAsset.assetId,
    {x:1.2,y:.843,z:.8},foodId),true);
  const authored=world.execute({requestId:'author-food',op:'set_interaction',
    objectId:foodId,interaction:foodInteraction,expectedInteraction:null});
  assert.equal(authored.ok,true,authored.error);
  world.invalidateRenderedAsset(foodId);
  assert.match(simulation.stationAdditionReadiness(foodId),/verified rendered GLB/i);
  assert.throws(()=>simulation.addSelectedStation(foodId),/verified rendered GLB/i);
  assert.deepEqual(simulation.snapshot(),initial);
  assert.equal(world.verifyPhysicsAsset(foodAsset.assetId,
    {x:1.2,y:.843,z:.8},foodId),true);
  const wall=world.execute({requestId:'block-food-approach',op:'spawn',
    assetId:'wall',anchorId:ANCHOR_ID,transform:pose(2,-.9)});
  assert.equal(wall.ok,true,wall.error);
  assert.throws(()=>simulation.addSelectedStation(foodId),/cannot reach|blocked|No reachable/i);
  assert.deepEqual(simulation.snapshot(),initial);
});

test('both reviewed stations restore and grant only their distinct observed effects',()=>{
  const {world,simulation,seatId}=setup(29);
  const foodId=spawnFood(world);
  const added=simulation.addSelectedStation(foodId);
  const scene=structuredClone(world.scene);
  const saved=simulation.exportState();
  assert.deepEqual(added.stations.map(station=>station.kind),['rest','eat']);
  assert.equal(saved.schemaVersion,7);

  let sequence=0;
  const recovered=new MatrixWorld(()=>`dual-restored-${++sequence}`);
  recovered.registerAssets([seatAsset,foodAsset]);
  const loaded=recovered.execute({requestId:'load-dual-world',op:'load',scene});
  assert.equal(loaded.ok,true,loaded.error);
  const restored=CitizensSimulation.restore(recovered,saved);
  assert.deepEqual(restored.exportState(),saved);
  assert.equal(restored.resume().paused,true,
    'restore cannot inherit renderer verification for either GLB');
  for(const [asset,bounds,id] of [
    [seatAsset,{x:.62,y:.95,z:.62},seatId],
    [foodAsset,{x:1.2,y:.843,z:.8},foodId]])
    assert.equal(recovered.verifyPhysicsAsset(asset.assetId,bounds,id),true);
  assert.equal(restored.resume().paused,false);

  const uses=[];
  const execute=recovered.execute.bind(recovered);
  let beforeStep=null;
  recovered.execute=(command,options)=>{
    const result=execute(command,options);
    if(command.op==='interact'&&[seatId,foodId].includes(command.targetObjectId)){
      const resident=beforeStep.residents.find(item=>
        item.objectId===command.actorObjectId);
      uses.push({command,result,priorNeeds:resident.needs});
    }
    return result;
  };
  for(let tick=0;tick<300&&new Set(uses.map(use=>use.command.kind)).size<2;tick++){
    beforeStep=restored.snapshot();
    const after=restored.step();
    for(const use of uses.filter(item=>item.tick===undefined)){
      use.tick=after.clockTick;
      assert.equal(use.result.ok,true,use.result.error);
      const resident=after.residents.find(item=>
        item.objectId===use.command.actorObjectId);
      const {need,delta}=use.result.outcome.effect;
      const decay=need==='energy'?.55:.45;
      assert.equal(resident.needs[need],rounded(use.priorNeeds[need]-decay+delta));
    }
  }
  assert.deepEqual(new Set(uses.map(use=>use.command.kind)),new Set(['rest','eat']));
  for(const use of uses){
    const expected=use.command.kind==='rest'?seatInteraction:foodInteraction;
    assert.equal(use.command.interactionId,expected.interactionId);
    assert.equal(use.command.targetObjectId,
      use.command.kind==='rest'?seatId:foodId);
    assert.deepEqual(use.result.outcome.effect,expected.effect);
  }
  assert.deepEqual(restored.exportState().stations.map(station=>station.objectId),
    [seatId,foodId]);
});

test('adding a built-in table preserves an in-flight selected-chair use across restore',()=>{
  let sequence=0;
  const world=new MatrixWorld(()=>`built-in-dual-${++sequence}`);
  const chair=world.execute({requestId:'spawn-built-in-chair',op:'spawn',
    assetId:'chair',anchorId:ANCHOR_ID,transform:pose(0,-2)});
  const table=world.execute({requestId:'spawn-built-in-table',op:'spawn',
    assetId:'table',anchorId:ANCHOR_ID,transform:pose(3,0)});
  assert.equal(chair.ok,true,chair.error);
  assert.equal(table.ok,true,table.error);
  const simulation=createCitizensWithSelectedFurniture(world,
    {seed:29,objectId:chair.objectId});
  let atUse=null;
  for(let tick=0;tick<15;tick++){
    const state=simulation.step();
    if(state.residents.find(resident=>resident.id==='ada')?.activity?.phase==='use'){
      atUse=state;break;
    }
  }
  assert.equal(atUse?.clockTick,5);
  const adaBefore=atUse.residents.find(resident=>resident.id==='ada');
  const claimBefore=atUse.stations[0].claim;
  assert.equal(adaBefore.activity.kind,'rest');
  assert.equal(claimBefore.residentId,'ada');
  assert.equal(simulation.snapshot().paused,true);

  simulation.addSelectedStation(table.objectId);
  const next=simulation.step();
  const ada=next.residents.find(resident=>resident.id==='ada');
  assert.equal(ada.activity?.executionId,adaBefore.activity.executionId);
  assert.equal(ada.activity?.phase,'use');
  assert.deepEqual(next.stations[0].claim,claimBefore);
  assert.ok(!next.log.some(entry=>entry.event==='failed'&&
    entry.message.includes('actor or target changed during interaction')));

  const saved=simulation.exportState();
  const scene=structuredClone(world.scene);
  let restoredSequence=0;
  const recovered=new MatrixWorld(()=>`built-in-restored-${++restoredSequence}`);
  const loaded=recovered.execute({requestId:'load-built-in-dual',op:'load',scene});
  assert.equal(loaded.ok,true,loaded.error);
  const restored=CitizensSimulation.restore(recovered,saved);
  assert.deepEqual(restored.exportState(),saved);
  let completed=null;
  for(let tick=0;tick<15;tick++){
    const state=restored.step();
    if(state.log.some(entry=>entry.residentId==='ada'&&entry.event==='completed'&&
      entry.message.includes('rest'))){completed=state;break;}
  }
  assert.ok(completed,'Ada finishes the same chair execution after restore');
  assert.equal(completed.stations[0].claim?.residentId==='ada',false);
  assert.ok(completed.residents.find(resident=>resident.id==='ada').needs.energy>
    ada.needs.energy);
  assert.ok(!completed.log.some(entry=>entry.event==='failed'&&
    entry.message.includes('actor or target changed during interaction')));
});
