import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePanoramaIntent,parseConceptIntent,isSelectedConceptBuildRequest,
  stopPlannerConceptFallback,plannerVoiceFallbackAllowed} from '../src/concept_intent.js';

test('panorama language routes generation and explicit version actions separately',async()=>{
  assert.equal(parsePanoramaIntent('Operator, make the world a sunset alien desert'),null,
    'ambiguous world creation still reaches the Agent');
  assert.deepEqual(parsePanoramaIntent('Change the sky to a stormy mountain panorama'),
    {kind:'generate',prompt:'stormy mountain'});
  assert.deepEqual(parsePanoramaIntent('Create a panorama of a moonlit forest with distant mountains'),
    {kind:'generate',prompt:'a moonlit forest with distant mountains'});
  for(const request of ['Create a sci-fi panorama',
    'Codex, create a sci-fi panorama',
    'Hey Codex, please create a sci-fi panorama.',
    'Codex, can you create a sci-fi panorama?',
    'Create a sci-fi panorama in VR'])
    assert.deepEqual(parsePanoramaIntent(request),
      {kind:'generate',prompt:'sci-fi'},request);
  assert.deepEqual(parsePanoramaIntent('Make me a dreamy space panorama'),
    {kind:'generate',prompt:'dreamy space'});
  assert.deepEqual(parsePanoramaIntent('Create a sci-fi panorama and set it as my background'),
    {kind:'generate',prompt:'sci-fi',deferredApply:true});
  for(const request of ['Create a panorama','Codex, create a panorama.',
    'Generate a 360 panorama','Can you make a panorama in VR?'])
    assert.deepEqual(parsePanoramaIntent(request),{kind:'describe'},request);
  assert.deepEqual(parsePanoramaIntent('Generate three cyberpunk skyline panoramas and use version 2'),
    {kind:'generateMany',count:3,prompt:'cyberpunk skyline',requestedVersion:2});
  assert.deepEqual(parsePanoramaIntent('Use panorama version 2'),
    {kind:'select',version:2});
  assert.deepEqual(parsePanoramaIntent('Apply panorama version 2'),
    {kind:'applyVersion',version:2});
  assert.deepEqual(parsePanoramaIntent('Apply selected panorama'),{kind:'apply'});
  assert.deepEqual(parsePanoramaIntent('Create a panorama of a moonlit forest and set it as my background'),
    {kind:'generate',prompt:'a moonlit forest',deferredApply:true});
  for(const named of ['Load a panorama of Azimuth B','Change the background to Azimuth B',
    'Set the world background to Azimuth B','Make the world into a medieval castle',
    'Create a sci-fi panorama bridge','Create a panorama gallery in the world',
    'Make the world a sci-fi desert in VR'])
    assert.equal(parsePanoramaIntent(named),null,named);
  assert.equal(parsePanoramaIntent('Make a physics playground'),null);
  assert.equal(parseConceptIntent('Create a panorama of a moonlit forest'),null);
  assert.equal(await stopPlannerConceptFallback('Create a panorama of a moonlit forest',
    async()=>{}),true);
  let cancelled=false;
  assert.equal(await stopPlannerConceptFallback('Codex, create a sci-fi panorama',
    async()=>{cancelled=true;}),true);
  assert.equal(cancelled,true);
});

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
    'Build version 2 in the Matrix','Build the selected image',
    'Build not only the selected concept but also a bridge',
    'Build not just the selected concept but also a bridge',
    'Build v2', 'Do not use v1; build v2',
    'The bridge is not yet built; build the selected concept now'])
    assert.equal(isSelectedConceptBuildRequest(text),true,text);
  for(const text of ['Use version 2','Build this bridge','Build an image viewer',
    'Create a concept bridge','Make another chair',
    'Build a bridge, not the selected concept',
    'Build this, not the selected concept',
    'Build selected concept, not selected concept',
    'Build selected concept, not just yet',
    'Build selected concept, not now',
    'Build selected concept, not today',
    'Build selected concept, not now; build a bridge',
    'Build this, not just yet; then build a bridge',
    'Build renderer v2'])
    assert.equal(isSelectedConceptBuildRequest(text),false,text);
});

test('reviewing or binding a completed selected build does not create another build',async()=>{
  const followups=[
    'Bind Lantern Beacon on the existing selected Version 4 Blender build. The build is already completed; do not build or spawn a second bridge.',
    'Review the selected Version 4 build status; do not spawn a duplicate.',
    'The selected Version 4 Blender build is already completed. Do not spawn another copy.',
    'Do not build this in the Matrix.',
    'Check the existing selected Version 4 Blender build that is already completed. This is a read-only status follow-up. Do not build, create, spawn, register, bind, save, restore, or change any file or world object. Use read-only Matrix scene and concept status tools only to report the five current object IDs, the Beacon loop binding, and the earlier failed follow-up record separately. Stop if any write approval is proposed.',
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
    'Do not use the old asset, but build the selected Version 4 concept in Blender.',
    'Do not spawn the old bridge, then build the selected Version 4 concept.',
  ])assert.equal(isSelectedConceptBuildRequest(request),true,request);
});
