import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {createCitizensDemo} from '../src/citizens.js';
import {restoreStoredScene} from '../src/scene_store.js';

const pose=(x,z)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});

test('Citizens motion advertises observed actors without advancing authored generation',()=>{
  let nextId=0;
  const world=new MatrixWorld(()=>`revision-object-${++nextId}`);
  const simulation=createCitizensDemo(world,{seed:29});
  world.citizens=simulation.snapshot();
  const before=world.snapshot();
  const ids=before.citizensObservation.residentObjectIds;
  assert.deepEqual(ids,simulation.snapshot().residents.map(resident=>resident.objectId).sort());
  let moved=false;
  for(let step=0;step<10&&!moved;step++){
    simulation.step();
    world.citizens=simulation.snapshot();
    moved=ids.some(id=>JSON.stringify(before.scene.objects.find(object=>object.objectId===id).transform)!==
      JSON.stringify(world.scene.objects.find(object=>object.objectId===id).transform));
  }
  assert.equal(moved,true);
  assert.equal(world.snapshot().citizensObservation.authoredGeneration,
    before.citizensObservation.authoredGeneration);
  assert.equal(world.undo.length,0);

  const actor=world.scene.objects.find(object=>object.objectId===ids[0]);
  const edited=pose(actor.transform.position.x+.1,actor.transform.position.z);
  edited.scale=structuredClone(actor.transform.scale);
  assert.equal(world.execute({requestId:'authored-actor-drag',op:'set_transform',
    objectId:actor.objectId,transform:edited}).ok,true);
  assert.notEqual(world.snapshot().citizensObservation.authoredGeneration,
    before.citizensObservation.authoredGeneration);

  const prior=world.authoredGeneration;
  restoreStoredScene(world,structuredClone(world.scene));
  assert.notEqual(world.authoredGeneration,prior);
  world.citizens=null;
  assert.equal(world.snapshot().citizensObservation,undefined);
});
