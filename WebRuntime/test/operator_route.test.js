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

test('AR requests for measured room placement use the Agent context path',()=>{
  const physicalRequests=[
    'reorganize this based on my room',
    'Move the orb to the center of this table',
    'Put an orb on my table',
    'Move this orb onto that physical table',
    'Fit this to my walls',
    'put that there',
  ];
  for(const text of physicalRequests){
    const result=routeOperatorRequest(text,{assets:[...assets,{assetId:'orb',displayName:'Orb'}],presentation:'ar'});
    assert.deepEqual(result,{destination:'agent',reason:'physical-room'},text);
  }
});

test('ordinary catalog and digital commands keep their existing route',()=>{
  const withOrb=[...assets,{assetId:'orb',displayName:'Orb'}];
  for(const text of ['move the chair 20 cm left','put a table here',
    'put an orb on the table','move the orb to the center of the table','load a chair']){
    assert.equal(routeOperatorRequest(text,{assets:withOrb,presentation:'ar'}).destination,'planner',text);
  }
  for(const text of ['reorganize this based on my room','Move the orb to the center of this table',
    'Put an orb on my table','Move this orb onto that physical table','Fit this to my walls']){
    assert.equal(routeOperatorRequest(text,{assets:withOrb,presentation:'vr'}).destination,'planner',text);
    assert.equal(routeOperatorRequest(text,{assets:withOrb,presentation:'desktop'}).destination,'planner',text);
  }
});
