import test from 'node:test';
import assert from 'node:assert/strict';
import {createCitizensDemo} from '../src/citizens.js';
import {CITIZENS_SAVE_KEY,makeCitizensWorld,saveCitizensCheckpoint,
  loadCitizensCheckpoint} from '../src/citizens_store.js';

const memoryStore=()=>{
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
};

test('same seed creates stable Matrix object identities for a fresh scenario',()=>{
  const left=makeCitizensWorld(29),right=makeCitizensWorld(29);
  const first=createCitizensDemo(left,{seed:29}),second=createCitizensDemo(right,{seed:29});
  assert.deepEqual(left.scene,right.scene);
  assert.deepEqual(first.snapshot(),second.snapshot());
});

test('isolated Citizens save resumes scene and simulation together',()=>{
  const storage=memoryStore(),world=makeCitizensWorld(43);
  const simulation=createCitizensDemo(world,{seed:43});
  for(let index=0;index<16;index++)simulation.step();
  saveCitizensCheckpoint(storage,world,simulation);
  assert.ok(storage.getItem(CITIZENS_SAVE_KEY));
  assert.equal(storage.getItem('matrix-web-world-v2'),null);
  const reopened=loadCitizensCheckpoint(storage);
  assert.deepEqual(reopened.world.scene,world.scene);
  assert.deepEqual(reopened.simulation.exportState(),simulation.exportState());
  reopened.simulation.step();
  assert.equal(reopened.simulation.snapshot().clockTick,17);
});

test('corrupt resident reference is rejected without touching another active world',()=>{
  const storage=memoryStore(),world=makeCitizensWorld(7),simulation=createCitizensDemo(world,{seed:7});
  saveCitizensCheckpoint(storage,world,simulation);
  const before=structuredClone(world.scene);
  const value=JSON.parse(storage.getItem(CITIZENS_SAVE_KEY));
  value.simulation.residents[0].objectId='missing';
  storage.setItem(CITIZENS_SAVE_KEY,JSON.stringify(value));
  assert.throws(()=>loadCitizensCheckpoint(storage),/missing or incompatible/);
  assert.deepEqual(world.scene,before);
});
