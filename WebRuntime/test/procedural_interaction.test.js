import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCHOR_ID,MatrixWorld,PROCEDURAL_ASSET_ID,
  interactionSourceMatches,validInteractionDescriptor} from '../src/protocol.js';
import {createProceduralRecipe,reviseProceduralRecipe} from '../src/procedural.js';
import {restoreStoredWorld,storedWorld} from '../src/scene_store.js';

const pose=(x=0,z=-2)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
const descriptor=(approachZ=-.65)=>({schemaVersion:2,
  interactionId:'bench-rest',kind:'rest',
  proceduralSource:{generatorId:'curved-bench',generatorVersion:'1.0.0',
    sourceRevision:'curved-bench-v1'},
  requiredCapabilities:['static-virtual-floor','reviewed-procedural-geometry'],
  availability:['target-static','floor-aligned','generator-available'],
  approachPose:{x:0,z:approachZ},usePose:{x:0,z:.2},
  rangeMeters:1,durationTicks:7,capacity:1,effect:{need:'energy',delta:37}});
const makeWorld=()=>{
  let sequence=0;
  const world=new MatrixWorld(()=>`procedural-interaction-${++sequence}`);
  const recipe=createProceduralRecipe('curved-bench');
  const bench=world.execute({requestId:'create-bench',op:'create_procedural',
    anchorId:ANCHOR_ID,transform:pose(),procedural:recipe});
  const actor=world.execute({requestId:'create-actor',op:'spawn',assetId:'orb',
    anchorId:ANCHOR_ID,transform:pose(0,-2.65)});
  assert.equal(bench.ok,true,bench.error);
  assert.equal(actor.ok,true,actor.error);
  return {world,recipe,benchId:bench.objectId,actorId:actor.objectId};
};
const attach=(world,benchId,interaction=descriptor())=>world.execute({
  requestId:'attach-bench',op:'set_interaction',objectId:benchId,
  expectedInteraction:null,interaction});
const use=(world,benchId,actorId,interaction=descriptor(),requestId='use-bench')=>
  world.execute({requestId,op:'interact',actorObjectId:actorId,
    targetObjectId:benchId,kind:'rest',interactionId:interaction.interactionId,
    expectedInteraction:interaction});

test('reviewed procedural interaction is source-bound, receipt-backed, revisable and reopenable',()=>{
  const {world,recipe,benchId,actorId}=makeWorld();
  const bench=world.requireObject(benchId),interaction=descriptor();
  assert.equal(bench.assetId,PROCEDURAL_ASSET_ID);
  assert.equal(validInteractionDescriptor(interaction),true);
  assert.equal(interactionSourceMatches(bench,world.asset(bench.assetId),interaction),true);
  assert.equal(world.snapshot().interactionSchemaVersion,2);
  assert.equal(attach(world,benchId,interaction).ok,true);
  const first=use(world,benchId,actorId,interaction);
  assert.equal(first.ok,true,first.error);
  assert.deepEqual(first.outcome,{kind:'rest',actorObjectId:actorId,
    targetObjectId:benchId,observedDistanceMeters:.85,
    interactionId:'bench-rest',effect:{need:'energy',delta:37},
    usePoint:{x:0,z:-1.8}});
  assert.match(use(world,benchId,actorId,
    {...interaction,effect:{need:'energy',delta:38}},'stale-use').error,
  /definition changed/);
  const revision=reviseProceduralRecipe(recipe,
    {lengthMeters:2.2,arcDegrees:90});
  const updated=world.execute({requestId:'revise-bench',op:'update_procedural',
    objectId:benchId,expectedProcedural:recipe,procedural:revision});
  assert.equal(updated.ok,true,updated.error);
  assert.equal(updated.objectId,benchId);
  assert.deepEqual(world.requireObject(benchId).procedural,revision);
  assert.deepEqual(world.requireObject(benchId).interaction,interaction);
  assert.equal(use(world,benchId,actorId,interaction,'use-revised').ok,true);
  assert.equal(world.execute({requestId:'undo-revision',op:'undo'}).ok,true);
  assert.deepEqual(world.requireObject(benchId).procedural,recipe);
  assert.equal(world.execute({requestId:'redo-revision',op:'redo'}).ok,true);
  assert.deepEqual(world.requireObject(benchId).procedural,revision);
  const saved=storedWorld(world),reopened=new MatrixWorld();
  restoreStoredWorld(reopened,saved);
  assert.deepEqual(reopened.requireObject(benchId).procedural,revision);
  assert.deepEqual(reopened.requireObject(benchId).interaction,interaction);
  assert.equal(use(reopened,benchId,actorId,interaction,'use-reopened').ok,true);
});

test('procedural interaction refuses stale source, incompatible revision and blocked use',()=>{
  const {world,recipe,benchId,actorId}=makeWorld();
  const reviewed=descriptor(-.46);
  const eat={...reviewed,kind:'eat',effect:{need:'hunger',delta:37}};
  assert.equal(validInteractionDescriptor(eat),false,
    'the reviewed curved bench advertises rest only');
  assert.equal(interactionSourceMatches(world.requireObject(benchId),
    world.asset(PROCEDURAL_ASSET_ID),eat),false);
  assert.match(attach(world,benchId,eat).error,/Invalid interaction descriptor/);
  for(const invalid of [
    {...reviewed,schemaVersion:1},
    {...reviewed,assetSha256:'a'.repeat(64)},
    {...reviewed,requiredCapabilities:[...reviewed.requiredCapabilities,'shell']}
  ])assert.equal(validInteractionDescriptor(invalid),false);
  const stale={...reviewed,proceduralSource:{...reviewed.proceduralSource,
    sourceRevision:'curved-bench-v2'}};
  assert.match(attach(world,benchId,stale).error,/reviewed procedural source/);
  assert.equal(attach(world,benchId,reviewed).ok,true);
  const incompatible=reviseProceduralRecipe(recipe,
    {depthMeters:.8,arcDegrees:30});
  const refused=world.execute({requestId:'invalid-revision',op:'update_procedural',
    objectId:benchId,expectedProcedural:recipe,procedural:incompatible});
  assert.equal(refused.ok,false);
  assert.match(refused.error,/measured procedural geometry/);
  assert.deepEqual(world.requireObject(benchId).procedural,recipe);
  assert.deepEqual(world.requireObject(benchId).interaction,reviewed);
  const wall=world.execute({requestId:'use-blocker',op:'spawn',assetId:'wall',
    anchorId:ANCHOR_ID,transform:{...pose(0,-2.25),
      scale:{x:.2,y:.2,z:.2}}});
  assert.equal(wall.ok,true);
  assert.match(use(world,benchId,actorId,reviewed,'occluded').error,/occluded/);
  const saved=structuredClone(world.scene);
  saved.objects.find(item=>item.objectId===benchId).procedural.generatorVersion='9.0.0';
  assert.throws(()=>world.validateScene(saved),/generator version|unavailable/i);
});
