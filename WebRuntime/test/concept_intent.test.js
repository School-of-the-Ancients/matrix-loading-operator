import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConceptIntent,isSelectedConceptBuildRequest} from '../src/concept_intent.js';

test('explicit concept generation, variation and version selection are recognized',()=>{
  assert.deepEqual(parseConceptIntent('Operator, create an image of a futuristic forest temple.'),
    {kind:'generate',prompt:'a futuristic forest temple.'});
  assert.deepEqual(parseConceptIntent('Make another version.'),{kind:'vary',notes:''});
  assert.deepEqual(parseConceptIntent('Another version, make it different.'),
    {kind:'vary',notes:'make it different.'});
  assert.deepEqual(parseConceptIntent('Use version 2.'),{kind:'select',version:2,notes:''});
  assert.deepEqual(parseConceptIntent('Use version 2, but make the wings smaller.'),
    {kind:'select',version:2,notes:'make the wings smaller.'});
});

test('concept parsing leaves ordinary build and world requests alone',()=>{
  for(const text of ['make another chair','make a staircase','create a Blender spaceship',
    'build this in the Matrix','use this design','make a picture frame'])
    assert.equal(parseConceptIntent(text),null,text);
  for(const text of ['Now build this in the Matrix','Make this in Blender',
    'Create this around what is already here','Use this design'])
    assert.equal(isSelectedConceptBuildRequest(text),true,text);
  assert.equal(isSelectedConceptBuildRequest('Use version 2'),false);
});
