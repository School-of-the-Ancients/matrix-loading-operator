import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MatrixWorld} from '../src/protocol.js';
import {createCitizensDemo} from '../src/citizens.js';
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
