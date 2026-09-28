import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConceptIntent,isSelectedConceptBuildRequest,
  stopPlannerConceptFallback,plannerVoiceFallbackAllowed} from '../src/concept_intent.js';

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

test('a planner voice transcript with image or selected-design intent cancels its proposal',async()=>{
  const cancelled=[];
  for(const transcript of ['Create an image of a glowing bridge',
    'Make another version','Use version 2','Build this in the Matrix']){
    assert.equal(await stopPlannerConceptFallback(transcript,async()=>cancelled.push(transcript)),true);
  }
  assert.equal(cancelled.length,4);
  assert.equal(await stopPlannerConceptFallback('Build this bridge',async()=>cancelled.push('wrong')),false);
  assert.equal(cancelled.length,4);
  assert.equal(await stopPlannerConceptFallback('Make another version',async()=>{throw Error('Already ready');}),true);
});

test('Agent connection failure only permits explicit Offline commands voice fallback',()=>{
  assert.equal(plannerVoiceFallbackAllowed('codex-cli'),false);
  assert.equal(plannerVoiceFallbackAllowed('offline-rules'),true);
  assert.equal(plannerVoiceFallbackAllowed(undefined),false);
});

test('concept parsing leaves ordinary build and world requests alone',()=>{
  for(const text of ['make another chair','make a staircase','create a Blender spaceship',
    'build this in the Matrix','use this design','make a picture frame'])
    assert.equal(parseConceptIntent(text),null,text);
  for(const text of ['Now build this in the Matrix','Make this in Blender',
    'Create this around what is already here','Use this design',
    'Build version 2 in the Matrix','Build the selected image'])
    assert.equal(isSelectedConceptBuildRequest(text),true,text);
  for(const text of ['Use version 2','Build this bridge','Build an image viewer',
    'Create a concept bridge','Make another chair'])
    assert.equal(isSelectedConceptBuildRequest(text),false,text);
});

test('reviewing or binding a completed selected build does not create another build',async()=>{
  const followups=[
    'Bind Lantern Beacon on the existing selected Version 4 Blender build. The build is already completed; do not build or spawn a second bridge.',
    'Review the selected Version 4 build status; do not spawn a duplicate.',
    'The selected Version 4 Blender build is already completed. Do not spawn another copy.',
    'Do not build this in the Matrix.',
  ];
  for(const request of followups){
    assert.equal(isSelectedConceptBuildRequest(request),false,request);
    assert.equal(await stopPlannerConceptFallback(request,async()=>{
      throw Error('Planner should remain available');
    }),false,request);
  }
  for(const request of [
    'Build the selected Version 4 concept in Blender and bind its animation.',
    'Review the selected design, then build this in Blender.',
    'Build this selected concept. Do not spawn a second copy.',
  ])assert.equal(isSelectedConceptBuildRequest(request),true,request);
});
