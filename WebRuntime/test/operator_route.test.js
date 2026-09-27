import test from 'node:test';
import assert from 'node:assert/strict';
import {routeOperatorRequest} from '../src/operator_route.js';

const assets=[{assetId:'chair',displayName:'Chair'},
  {assetId:'table',displayName:'Table'},
  {assetId:'web:dragon:abc123',displayName:'Ice Dragon'}];
const route=(text,savedScenes=['Demo'])=>
  routeOperatorRequest(text,{assets,savedScenes});

test('finite CHAT commands stay on its existing planner',()=>{
  for(const text of ['load a chair','put a table here','move the chair 20 cm left',
    'make it twice as big','save scene as Demo','restore Demo',
    'load the scene Demo','undo'])
    assert.equal(route(text).destination,'planner',text);
});

test('creative, imported GLB and animation requests route to CODEX Agent',()=>{
  for(const text of ['load a spaceship','create a staircase',
    'put a chair two metres in front of me',
    'make a dragon that flies around the room','load Ice Dragon',
    'animate the Ice Dragon with Flight','play the Flight clip',
    'import a GLB','create a Blender spaceship',
    'put a table here with four chairs'])
    assert.equal(route(text).destination,'agent',text);
  assert.equal(route('load Ice Dragon').reason,'registered-glb');
  assert.equal(route('Dragon’s Flight').reason,'animation');
  assert.equal(route('Operator, load the registered Ice Dragon in front of me; loop its Flight animation').destination,'agent');
  assert.equal(route('Operator, load Ice Dragon').reason,'registered-glb');
});

test('a saved-scene name is distinguished from an unknown creative load',()=>{
  assert.equal(route('load Demo').reason,'saved-scene');
  assert.equal(route('load scene Demo',[]).destination,'planner');
  assert.equal(route('load Demo',[]).destination,'agent');
});
