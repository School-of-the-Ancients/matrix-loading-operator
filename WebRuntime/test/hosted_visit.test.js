import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MatrixWorld} from '../src/protocol.js';
import {CITIZEN_BENCH_INTERACTION,CITIZEN_BENCH_TRANSFORM,
  createCitizensDemo} from '../src/citizens.js';
import {createProceduralRecipe} from '../src/procedural.js';
import {storedWorld} from '../src/scene_store.js';
import {applyHostedObservation,stageHostedObservation} from '../src/hosted_visit.js';
import {MatrixView} from '../src/view.js';

const instance='a'.repeat(32);
function fixture(){
  const owner=new MatrixWorld();
  const simulation=createCitizensDemo(owner,{seed:29});
  simulation.resume();
  owner.citizens=simulation.snapshot();
  const observe=(sequence,instanceId=instance)=>({schemaVersion:1,worldId:'AdaBo',
    instanceId,sequence,clockTick:owner.citizens.clockTick,online:true,readOnly:true,
    world:storedWorld(owner)});
  return {owner,simulation,observe};
}

function createBench(owner){
  return owner.execute({requestId:'operator-create-bench',op:'create_procedural',
    anchorId:'web-floor',procedural:createProceduralRecipe('curved-bench'),
    transform:{position:{x:-2,y:0,z:2},rotation:{x:0,y:0,z:0},
      scale:{x:1,y:1,z:1}}});
}

function citizenConstruction(owner,simulation){
  const requestId='c'.repeat(32);
  const interactionRequestId=`${requestId}-interaction`;
  const created=owner.execute({requestId,op:'create_procedural',
    anchorId:'web-floor',procedural:createProceduralRecipe('curved-bench'),
    transform:structuredClone(CITIZEN_BENCH_TRANSFORM)});
  assert.equal(created.ok,true,created.error);
  const reviewed=owner.execute({requestId:interactionRequestId,
    op:'set_interaction',objectId:created.objectId,
    interaction:structuredClone(CITIZEN_BENCH_INTERACTION),
    expectedInteraction:null});
  assert.equal(reviewed.ok,true,reviewed.error);
  owner.citizens=simulation.capabilityCompleted([created,reviewed]);
  return {objectId:created.objectId,created,reviewed};
}

function decision(allowed,requestId=null,reason=''){
  return {allowed,requestId,reason,checkpointSequence:2};
}

function legacyObservation(observation){
  const copy=structuredClone(observation);
  copy.world.citizens.schemaVersion=12;
  delete copy.world.citizens.construction;
  delete copy.world.citizens.capabilityRequests;
  return copy;
}

test('desktop and AR visitor project the same checkpointed IDs and later Citizens tick',()=>{
  const {owner,simulation,observe}=fixture();
  const visitor=new MatrixWorld();
  const first=applyHostedObservation(visitor,observe(1));
  const ids=visitor.scene.objects.map(item=>item.objectId);
  const residents=visitor.citizens.residents.map(item=>item.objectId);
  assert.deepEqual(first.state.residentIds,['ada','bo']);
  assert.equal(visitor.canVisitDigitalWorld(),true);
  assert.equal(visitor.citizens.clockTick,0);
  visitor.enterAR();
  const origin=visitor.spatial;
  visitor.setOriginUnavailable(true);
  owner.citizens=simulation.advance();
  const second=applyHostedObservation(visitor,observe(2),first.state);
  assert.equal(second.state.clockTick,1);
  assert.equal(visitor.digitalWorldVisit,true);
  assert.equal(visitor.spatial,origin,'host polling does not replace the AR view anchor');
  assert.equal(visitor.spatial.originUnavailable,true,'polling cannot claim room alignment');
  assert.deepEqual(visitor.scene.objects.map(item=>item.objectId),ids);
  assert.deepEqual(visitor.citizens.residents.map(item=>item.objectId),residents);
  assert.deepEqual(visitor.scene,owner.scene);
  visitor.leaveAR();
  assert.deepEqual(visitor.scene,owner.scene);
});

test('AR visitor accepts one procedural addition and rebuilds only on scene structure changes',()=>{
  const {owner,simulation,observe}=fixture();
  const visitor=new MatrixWorld();
  const first=applyHostedObservation(visitor,observe(1));
  const coreIds=first.state.coreIds;
  const residentBindings=first.state.bindingIds;
  visitor.enterAR();
  const origin=visitor.spatial;
  visitor.setOriginUnavailable(true);
  owner.citizens=simulation.advance();
  const receipt=createBench(owner);
  assert.equal(receipt.ok,true);
  const created=applyHostedObservation(visitor,observe(2),first.state);
  assert.equal(created.structureChanged,true);
  assert.equal(visitor.scene.objects.length,5);
  assert.equal(visitor.scene.objects.at(-1).objectId,receipt.objectId);
  assert.deepEqual(created.state.coreIds,coreIds);
  assert.deepEqual(created.state.bindingIds,residentBindings);
  assert.equal(visitor.spatial,origin);
  assert.equal(visitor.spatial.originUnavailable,true);
  assert.equal(visitor.canVisitDigitalWorld(),false,'AR tracking state remains local');
  owner.citizens=simulation.advance();
  const later=applyHostedObservation(visitor,observe(3),created.state);
  assert.equal(later.structureChanged,false);
  assert.equal(later.state.clockTick,2);
  assert.equal(visitor.scene.objects.at(-1).objectId,receipt.objectId);
  assert.equal(visitor.citizens.paused,false);
  const restarted=applyHostedObservation(visitor,observe(1,'b'.repeat(32)),later.state);
  assert.equal(restarted.structureChanged,false);
  assert.equal(visitor.scene.objects.at(-1).objectId,receipt.objectId);
  visitor.leaveAR();
  assert.deepEqual(visitor.scene,owner.scene);
});

test('v12 Operator addition remains viewable after Citizens v14 migration',()=>{
  const {owner,observe}=fixture();
  const visitor=new MatrixWorld();
  const first=applyHostedObservation(visitor,legacyObservation(observe(1)));
  const receipt=createBench(owner);
  assert.equal(receipt.ok,true);
  const created=applyHostedObservation(visitor,legacyObservation(observe(2)),first.state);
  assert.equal(created.structureChanged,true);
  assert.equal(visitor.scene.objects.at(-1).objectId,receipt.objectId);
  assert.deepEqual(created.state.bindingIds,first.state.bindingIds);
  assert.equal(visitor.citizens.construction,null);
});

test('visitor accepts one receipt-backed Citizen bench station and its later use state',()=>{
  const {owner,simulation,observe}=fixture();
  const visitor=new MatrixWorld();
  const first=applyHostedObservation(visitor,observe(1));
  visitor.enterAR();
  const anchor=visitor.spatial;
  owner.citizens=simulation.step();
  const intent=simulation.proposeConstruction();
  assert.equal(intent.residentId,'bo');
  owner.citizens=simulation.snapshot();
  const requested=applyHostedObservation(visitor,observe(2),first.state);
  assert.equal(requested.world.citizens.construction.status,'requested');
  assert.equal(requested.world.scene.objects.length,4);
  owner.citizens=simulation.capabilityDecision(decision(true,'c'.repeat(32)));
  const queued=applyHostedObservation(visitor,observe(3),requested.state);
  assert.equal(queued.world.citizens.construction.requestId,'c'.repeat(32));
  assert.equal(queued.world.citizens.capabilityRequests[0].policy.requestId,
    'c'.repeat(32));
  const {objectId:benchId}=citizenConstruction(owner,simulation);
  const created=applyHostedObservation(visitor,observe(4),queued.state);
  assert.equal(created.structureChanged,true);
  assert.equal(visitor.spatial,anchor);
  assert.equal(visitor.scene.objects.at(-1).objectId,benchId);
  assert.equal(visitor.citizens.construction.status,'created');
  assert.equal(visitor.citizens.capabilityRequests[0].status,'succeeded');
  assert.equal(visitor.citizens.capabilityRequests[0].receipts.length,2);
  assert.equal(created.state.bindingIds.length,first.state.bindingIds.length+1);
  assert.ok(first.state.bindingIds.every(binding=>created.state.bindingIds.includes(binding)));
  assert.ok(created.state.bindingIds.includes(`citizen-bench:${benchId}`));
  let usedState=null;
  for(let tick=0;tick<80;tick++){
    owner.citizens=simulation.step();
    if(owner.citizens.construction.status==='used'){
      usedState=owner.citizens;break;
    }
  }
  assert.ok(usedState,'Bo must actually reach and use the new bench');
  const used=applyHostedObservation(visitor,observe(5),created.state);
  assert.equal(used.structureChanged,false);
  assert.equal(visitor.citizens.construction.useRequestId,
    usedState.construction.useRequestId);
  assert.ok(visitor.citizens.construction.useRequestId);
  const restarted=applyHostedObservation(visitor,observe(1,'b'.repeat(32)),used.state);
  assert.equal(restarted.structureChanged,false);
  assert.equal(visitor.citizens.stations.at(-1).objectId,benchId);
});

test('v14 denied Citizen request still permits one unbound human Operator creation',()=>{
  const {owner,simulation,observe}=fixture();
  const visitor=new MatrixWorld();
  const first=applyHostedObservation(visitor,observe(1));
  owner.citizens=simulation.step();
  assert.equal(simulation.proposeConstruction().status,'requested');
  owner.citizens=simulation.snapshot();
  const requested=applyHostedObservation(visitor,observe(2),first.state);
  const receipt=createBench(owner);
  assert.equal(receipt.ok,true);
  const operatorWon=applyHostedObservation(visitor,observe(3),requested.state);
  assert.equal(operatorWon.world.citizens.construction.status,'requested');
  assert.equal(operatorWon.world.scene.objects.at(-1).objectId,receipt.objectId);
  assert.deepEqual(operatorWon.state.bindingIds,first.state.bindingIds);
  owner.citizens=simulation.capabilityDecision(
    decision(false,null,'One slot is occupied'));
  const denied=applyHostedObservation(visitor,observe(4),operatorWon.state);
  assert.equal(denied.world.scene.objects.at(-1).objectId,receipt.objectId);
  assert.equal(denied.world.citizens.construction.status,'denied');
  assert.deepEqual(denied.state.bindingIds,first.state.bindingIds);
});

test('visitor retains a v13 bench after migration to an empty v14 journal',()=>{
  const {owner,simulation,observe}=fixture();
  owner.citizens=simulation.step();
  simulation.proposeConstruction();
  simulation.capabilityDecision(decision(true,'c'.repeat(32)));
  citizenConstruction(owner,simulation);
  const legacy=observe(1);
  legacy.world.citizens.schemaVersion=13;
  delete legacy.world.citizens.capabilityRequests;
  const visitor=new MatrixWorld();
  const first=applyHostedObservation(visitor,legacy);
  owner.citizens=simulation.snapshot();
  owner.citizens.capabilityRequests=[];
  const migrated=applyHostedObservation(visitor,observe(2),first.state);
  assert.equal(migrated.world.citizens.schemaVersion,14);
  assert.deepEqual(migrated.world.citizens.capabilityRequests,[]);
  assert.equal(migrated.world.scene.objects[4].objectId,
    legacy.world.scene.objects[4].objectId);
  assert.equal(migrated.world.citizens.construction.status,'created');
});

test('visitor accepts a denied future capability without a bench intent or scene edit',()=>{
  const {owner,simulation,observe}=fixture();
  const visitor=new MatrixWorld();
  const first=applyHostedObservation(visitor,observe(1));
  const request={citizenRequestId:'bo-move-1',intentId:'bo-move-intent-1',
    residentId:'bo',capability:'move',action:'set',
    parameters:{objectId:owner.scene.objects[0].objectId},
    checkpoint:{roomId:owner.scene.roomId,clockTick:0,
      objectIds:owner.scene.objects.map(item=>item.objectId).sort()}};
  owner.citizens=simulation.snapshot();
  owner.citizens.capabilityRequests.push({request,status:'requested',
    policy:null,receipts:[],reason:''});
  const requested=applyHostedObservation(visitor,observe(2),first.state);
  assert.equal(requested.world.citizens.construction,null);
  owner.citizens.capabilityRequests[0].status='denied';
  owner.citizens.capabilityRequests[0].policy=decision(false,null,
    'Capability unavailable');
  owner.citizens.capabilityRequests[0].reason='Capability unavailable';
  const denied=applyHostedObservation(visitor,observe(3),requested.state);
  assert.equal(denied.world.citizens.capabilityRequests[0].status,'denied');
  assert.deepEqual(denied.world.scene.objects,first.world.scene.objects);
  const secondRequest={...structuredClone(request),
    citizenRequestId:'bo-physics-2',intentId:'bo-physics-intent-2',
    capability:'physics'};
  owner.citizens.capabilityRequests.push({request:secondRequest,
    status:'requested',policy:null,receipts:[],reason:''});
  const secondPending=applyHostedObservation(visitor,observe(4),denied.state);
  owner.citizens.capabilityRequests[1].status='denied';
  owner.citizens.capabilityRequests[1].policy=decision(false,null,
    'Capability unavailable');
  owner.citizens.capabilityRequests[1].reason='Capability unavailable';
  const secondDenied=applyHostedObservation(visitor,observe(5),secondPending.state);
  assert.deepEqual(secondDenied.world.citizens.capabilityRequests.map(item=>
    item.status),['denied','denied']);
  assert.deepEqual(secondDenied.world.scene.objects,first.world.scene.objects);
  const droppedFirst=observe(6);
  droppedFirst.world.citizens.capabilityRequests.shift();
  assert.throws(()=>stageHostedObservation(droppedFirst,secondDenied.state),
    /capability provenance moved backward/);
});

test('visitor rejects altered construction provenance and unrelated world edits',()=>{
  const {owner,simulation,observe}=fixture();
  const visitor=new MatrixWorld();
  const first=applyHostedObservation(visitor,observe(1));
  owner.citizens=simulation.step();
  assert.ok(simulation.proposeConstruction());
  simulation.capabilityDecision(decision(true,'c'.repeat(32)));
  citizenConstruction(owner,simulation);
  owner.citizens=simulation.snapshot();
  const created=applyHostedObservation(visitor,observe(2),first.state);
  const scene=structuredClone(visitor.scene);
  const citizens=structuredClone(visitor.citizens);

  const changedRequest=observe(3);
  changedRequest.world.citizens.construction.requestId='d'.repeat(32);
  changedRequest.world.citizens.construction.interactionRequestId=
    `${'d'.repeat(32)}-interaction`;
  assert.throws(()=>applyHostedObservation(visitor,changedRequest,created.state));

  const movedChair=observe(3);
  movedChair.world.scene.objects.find(item=>item.assetId==='chair')
    .transform.position.x+=1;
  assert.throws(()=>applyHostedObservation(visitor,movedChair,created.state),
    /identity or clock moved backward/);

  const differentStation=observe(3);
  differentStation.world.citizens.stations.at(-1).id='unrelated-station';
  assert.throws(()=>applyHostedObservation(visitor,differentStation,created.state));

  const alteredInteraction=observe(3);
  alteredInteraction.world.scene.objects.at(-1).interaction.effect.delta=99;
  assert.throws(()=>applyHostedObservation(visitor,alteredInteraction,created.state));
  const alteredRecipe=observe(3);
  alteredRecipe.world.scene.objects.at(-1).procedural.parameters.lengthMeters+=.1;
  assert.throws(()=>applyHostedObservation(visitor,alteredRecipe,created.state),
    /outside the supported Citizens fixture/);
  assert.deepEqual(visitor.scene,scene);
  assert.deepEqual(visitor.citizens,citizens);
});

test('visitor rejects a removed creation, rebound citizen, or second procedural object',()=>{
  const {owner,observe}=fixture();
  const visitor=new MatrixWorld();
  const first=applyHostedObservation(visitor,observe(1));
  assert.equal(createBench(owner).ok,true);
  const created=applyHostedObservation(visitor,observe(2),first.state);
  const scene=structuredClone(visitor.scene);
  const citizens=structuredClone(visitor.citizens);
  const removed=observe(3);
  removed.world.scene.objects.pop();
  assert.throws(()=>applyHostedObservation(visitor,removed,created.state),
    /identity or clock moved backward/);
  const rebound=observe(3);
  [rebound.world.citizens.residents[0].objectId,
    rebound.world.citizens.residents[1].objectId]=[
    rebound.world.citizens.residents[1].objectId,
    rebound.world.citizens.residents[0].objectId];
  assert.throws(()=>applyHostedObservation(visitor,rebound,created.state));
  const second=owner.execute({requestId:'operator-create-second',op:'create_procedural',
    anchorId:'web-floor',procedural:createProceduralRecipe('curved-bench'),
    transform:{position:{x:4,y:0,z:2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}});
  assert.equal(second.ok,true);
  assert.throws(()=>applyHostedObservation(visitor,observe(3),created.state),
    /outside the supported Citizens fixture/);
  assert.deepEqual(visitor.scene,scene);
  assert.deepEqual(visitor.citizens,citizens);
});

test('stale, inconsistent and changed-world observations leave the visitor intact',()=>{
  const {owner,simulation,observe}=fixture();
  const visitor=new MatrixWorld();
  const first=applyHostedObservation(visitor,observe(1));
  const original=structuredClone(visitor.scene);
  const originalCitizens=structuredClone(visitor.citizens);
  const same=applyHostedObservation(visitor,observe(1),first.state);
  assert.equal(same.changed,false);
  owner.citizens=simulation.advance();
  const stale=observe(1);
  assert.throws(()=>applyHostedObservation(visitor,stale,first.state),/stale or inconsistent/);
  const denied={...observe(2),readOnly:false};
  assert.throws(()=>applyHostedObservation(visitor,denied,first.state),/Invalid hosted/);
  const swapped=observe(2);
  swapped.world.scene.objects[0].objectId='different-chair';
  assert.throws(()=>applyHostedObservation(visitor,swapped,first.state));
  assert.deepEqual(visitor.scene,original);
  assert.deepEqual(visitor.citizens,originalCitizens);
});

test('restart may retain IDs and clock but cannot rewind a checkpointed visitor',()=>{
  const {owner,simulation,observe}=fixture();
  const visitor=new MatrixWorld();
  const first=applyHostedObservation(visitor,observe(1));
  owner.citizens=simulation.advance();
  const restarted=applyHostedObservation(visitor,observe(1,'b'.repeat(32)),first.state);
  assert.equal(restarted.state.clockTick,1);
  const rollback=observe(2,'b'.repeat(32));
  rollback.clockTick=0;
  assert.throws(()=>stageHostedObservation(rollback,restarted.state));
});

test('visitor input stays read-only and stale observations hide render roots',()=>{
  const view={readOnly:true,renderer:{xr:{isPresenting:false}}};
  MatrixView.prototype.pointerDown.call(view,{button:0});
  MatrixView.prototype.selectFromController.call(view,{});
  assert.equal(view.pointerGrab,undefined);
  const floor={visible:true},other={visible:true};
  const visibility={observationStale:false,virtualFloorRoot:floor,
    anchorRoots:new Map([['plane',other]]),isAR:false,world:{spatial:null}};
  MatrixView.prototype.setObservationStale.call(visibility,true);
  assert.equal(floor.visible,false);
  assert.equal(other.visible,false);
  MatrixView.prototype.setObservationStale.call(visibility,false);
  assert.equal(floor.visible,true);
  visibility.isAR=true;visibility.world.spatial={originUnavailable:true};
  MatrixView.prototype.setObservationStale.call(visibility,false);
  assert.equal(floor.visible,false,'a fresh poll cannot override lost AR tracking');
});

test('hosted entry contains only observation transport and no local world writer',()=>{
  const source=readFileSync(new URL('../src/hosted_main.js',import.meta.url),'utf8');
  assert.match(source,/\/api\/web\/hosted\/observe/);
  assert.doesNotMatch(source,/MatrixBridge|\/api\/exchange|localStorage|saveStoredWorld|\.advance\(/);
  assert.match(source,/credentials:'omit'/);
});
