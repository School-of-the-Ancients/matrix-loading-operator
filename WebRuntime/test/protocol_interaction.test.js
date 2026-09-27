import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCHOR_ID,MatrixWorld,interactionWorldPoint,
  validInteractionDescriptor} from '../src/protocol.js';

const pose=(x=0,z=-2)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
const sha='d'.repeat(64);
const asset={assetId:`web:authored-seat:${sha.slice(0,12)}`,
  displayName:'Authored seat',description:'Static registered furniture',
  spawnScale:1,sha256:sha,byteLength:1024,url:`/api/web/assets/${sha}.glb`,
  localBounds:{center:{x:0,y:.5,z:0},size:{x:1,y:1,z:1}},
  geometry:{animationClips:[]}};
const interaction=()=>({schemaVersion:1,interactionId:'seat-rest',kind:'rest',
  assetSha256:sha,requiredCapabilities:['static-virtual-floor','verified-rendered-bounds'],
  availability:['target-static','floor-aligned','rendered-verified'],
  approachPose:{x:0,z:.78},usePose:{x:0,z:.35},rangeMeters:.6,
  durationTicks:7,capacity:1,effect:{need:'energy',delta:31}});
const command=(requestId,op,fields={})=>({requestId,op,
  ...(op==='set_interaction'&&!Object.hasOwn(fields,'expectedInteraction')?
    {expectedInteraction:null}:{}),...fields});
function scene(){
  let sequence=0;
  const world=new MatrixWorld(()=>`authored-${++sequence}`);
  world.registerAssets([asset]);
  const target=world.execute(command('spawn-seat','spawn',
    {assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose()}));
  const actor=world.execute(command('spawn-actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0,-1.22)}));
  assert.equal(target.ok,true);assert.equal(actor.ok,true);
  return {world,targetId:target.objectId,actorId:actor.objectId};
}
function verify(world,targetId){
  assert.equal(world.verifyPhysicsAsset(asset.assetId,{x:1,y:1,z:1},targetId),true);
  assert.equal(world.renderedAssetVerified(world.requireObject(targetId)),true);
}

test('authored interaction descriptor has exact bounded v1 semantics',()=>{
  const value=interaction();
  assert.equal(validInteractionDescriptor(value),true);
  for(const invalid of [
    {...value,schemaVersion:2},
    {...value,interactionId:'not allowed'},
    {...value,assetSha256:'e'.repeat(63)},
    {...value,requiredCapabilities:[...value.requiredCapabilities,'shell']},
    {...value,availability:[...value.availability].reverse()},
    {...value,approachPose:{x:0,z:.78,y:0}},
    {...value,rangeMeters:2.1},
    {...value,durationTicks:13},
    {...value,capacity:2},
    {...value,effect:{need:'hunger',delta:31}},
    {...value,effect:{need:'energy',delta:51}},
    {...value,executor:'arbitrary'}
  ])assert.equal(validInteractionDescriptor(invalid),false);
});

test('authored GLB interaction needs renderer verification and yields only an observed matching outcome',()=>{
  const {world,targetId,actorId}=scene();
  const descriptor=interaction();
  let useSequence=0;
  const use=extra=>world.execute(command(`use-${++useSequence}`,'interact',{
    actorObjectId:actorId,targetObjectId:targetId,kind:'rest',
    interactionId:descriptor.interactionId,expectedInteraction:descriptor,...extra}));
  assert.match(use().error,/not advertised/);
  assert.match(world.execute(command('attach-pending','set_interaction',
    {objectId:targetId,interaction:descriptor})).error,/verified rendered GLB/);
  verify(world,targetId);
  const beforeHistory=world.undo.length;
  const attached=world.execute(command('attach','set_interaction',
    {objectId:targetId,interaction:descriptor}));
  assert.equal(attached.ok,true);
  assert.equal(world.undo.length,beforeHistory+1);
  assert.deepEqual(world.requireObject(targetId).interaction,descriptor);
  assert.equal(world.snapshot().interactionSchemaVersion,1);
  assert.equal(world.snapshot().assets.find(item=>item.assetId===asset.assetId).sha256,sha);
  assert.match(use({interactionId:'other'}).error,/definition changed/);
  assert.match(use({expectedInteraction:{...descriptor,effect:{need:'energy',delta:32}}}).error,
    /definition changed/);
  const outcome=use();
  assert.equal(outcome.ok,true);
  assert.deepEqual(outcome.outcome,{kind:'rest',actorObjectId:actorId,
    targetObjectId:targetId,observedDistanceMeters:.43,
    interactionId:'seat-rest',effect:{need:'energy',delta:31},
    usePoint:{x:0,z:-1.65}});
  assert.equal(world.undo.length,beforeHistory+1,
    'finite use must not add an authored Undo entry');
});

test('authored GLB interaction validates measured poses and current static clearance',()=>{
  const {world,targetId,actorId}=scene();
  verify(world,targetId);
  for(const [index,invalid] of [
    {...interaction(),approachPose:{x:0,z:.70}},
    {...interaction(),usePose:{x:0,z:.6}},
    {...interaction(),rangeMeters:.3},
    {...interaction(),usePose:{x:0,z:.18}},
    {...interaction(),assetSha256:'e'.repeat(64)}
  ].entries()){
    const refused=world.execute(command(`bad-${index}`,'set_interaction',
      {objectId:targetId,interaction:invalid}));
    assert.equal(refused.ok,false);
    assert.equal(Object.hasOwn(world.requireObject(targetId),'interaction'),false);
  }
  assert.equal(world.execute(command('attach','set_interaction',
    {objectId:targetId,interaction:interaction()})).ok,true);
  const use=requestId=>world.execute(command(requestId,'interact',{
    actorObjectId:actorId,targetObjectId:targetId,kind:'rest',
    interactionId:'seat-rest',expectedInteraction:interaction()}));
  const wall=world.execute(command('wall','spawn',
    {assetId:'wall',anchorId:ANCHOR_ID,transform:{...pose(0,-1.44),
      scale:{x:.2,y:.2,z:.2}}}));
  assert.equal(wall.ok,true);
  assert.match(use('blocked-use').error,/use point is occluded/);
  assert.equal(world.execute(command('move-wall','set_transform',
    {objectId:wall.objectId,transform:pose(3,-1.44)})).ok,true);
  assert.equal(use('clear-use').ok,true);
  assert.equal(world.execute(command('move-actor','set_transform',
    {objectId:actorId,transform:pose(.35,-1.4)}),{recordHistory:false}).ok,true);
  assert.match(use('wrong-approach').error,/advertised approach pose/);
  assert.match(world.execute(command('enable-behavior','set_behavior',{
    objectId:targetId,behavior:{kind:'rotate',enabled:true,paused:false,
      axis:'y',speedDegreesPerSecond:30,amplitudeMeters:0,frequencyHz:.5}})).error,
    /Remove the authored interaction/);
  assert.equal(world.execute(command('restore-actor','set_transform',
    {objectId:actorId,transform:pose(0,-1.22)}),{recordHistory:false}).ok,true);
  assert.equal(use('still-static').ok,true);
});

test('object-local authored poses rotate and scale with the GLB transform',()=>{
  const object={transform:{position:{x:2,y:0,z:-3},rotation:{x:0,y:90,z:0},
    scale:{x:2,y:1,z:1}}};
  const stretched={...asset,spawnScale:.5};
  assert.deepEqual(interactionWorldPoint(object,stretched,{x:.5,z:1}),
    {x:2.5,z:-3.5});
});

test('a rotated rectangular wall blocks the visible Three.js use line',()=>{
  let sequence=0;
  const world=new MatrixWorld(()=>`yaw-object-${++sequence}`);
  const chair=world.execute(command('yaw-chair','spawn',
    {assetId:'chair',anchorId:ANCHOR_ID,transform:pose(.5,0)}));
  const actor=world.execute(command('yaw-actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(.5,-.7)}));
  assert.equal(chair.ok,true);assert.equal(actor.ok,true);
  const use=requestId=>world.execute(command(requestId,'interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  assert.equal(use('clear-before-wall').ok,true);
  const rotated=pose(0,0);rotated.rotation.y=45;
  assert.equal(world.execute(command('diagonal-wall','spawn',
    {assetId:'wall',anchorId:ANCHOR_ID,transform:rotated})).ok,true);
  assert.match(use('visible-diagonal-blocker').error,/occluded/);
});

test('interaction binding survives scene load but must reverify its GLB before use',()=>{
  const {world,targetId,actorId}=scene();
  verify(world,targetId);
  assert.equal(world.execute(command('attach','set_interaction',
    {objectId:targetId,interaction:interaction()})).ok,true);
  const saved=structuredClone(world.scene);
  const malformed=structuredClone(saved);
  malformed.objects[0].interaction=null;
  assert.match(world.execute(command('bad-load','load',{scene:malformed})).error,
    /Invalid interaction descriptor/);
  assert.deepEqual(world.scene,saved);
  assert.equal(world.execute(command('clear','clear')).ok,true);
  assert.equal(world.execute(command('load','load',{scene:saved})).ok,true);
  assert.deepEqual(world.requireObject(targetId).interaction,interaction());
  const use=requestId=>world.execute(command(requestId,'interact',{
    actorObjectId:actorId,targetObjectId:targetId,kind:'rest',
    interactionId:'seat-rest',expectedInteraction:interaction()}));
  assert.match(use('pending').error,/verified rendered GLB/);
  verify(world,targetId);
  assert.equal(use('verified').ok,true);
  assert.equal(world.execute(command('remove','remove_interaction',
    {objectId:targetId,expectedInteraction:interaction()})).ok,true);
  assert.equal(Object.hasOwn(world.requireObject(targetId),'interaction'),false);
  assert.match(use('removed').error,/not advertised/);
});

test('catalog identity changes refuse a saved interaction without a matching GLB',()=>{
  const {world,targetId}=scene();
  verify(world,targetId);
  assert.equal(world.execute(command('attach','set_interaction',
    {objectId:targetId,interaction:interaction()})).ok,true);
  const saved=structuredClone(world.scene);
  const changedSha='e'.repeat(64);
  world.registerAssets([{...asset,sha256:changedSha,
    url:`/api/web/assets/${changedSha}.glb`}]);
  assert.throws(()=>world.validateScene(saved),/current registered virtual-floor GLB/);
  assert.equal(world.renderedAssetVerified(world.requireObject(targetId)),false);
  assert.equal(world.execute(command('remove-stale','remove_interaction',
    {objectId:targetId,expectedInteraction:interaction()})).ok,true,
    'stale descriptor remains removable');
});

test('a queued removal cannot delete a later reviewed definition',()=>{
  const {world,targetId}=scene();
  verify(world,targetId);
  const first=interaction();
  assert.equal(world.execute(command('first-definition','set_interaction',
    {objectId:targetId,interaction:first})).ok,true);
  const later={...first,effect:{need:'energy',delta:32}};
  assert.equal(world.execute(command('later-definition','set_interaction',
    {objectId:targetId,interaction:later,expectedInteraction:first})).ok,true);
  const staleSet=world.execute(command('stale-replace','set_interaction',
    {objectId:targetId,expectedInteraction:first,
      interaction:{...later,effect:{need:'energy',delta:33}}}));
  assert.equal(staleSet.ok,false);
  assert.match(staleSet.error,/definition changed/);
  const stale=world.execute(command('stale-remove','remove_interaction',
    {objectId:targetId,expectedInteraction:first}));
  assert.equal(stale.ok,false);
  assert.match(stale.error,/definition changed/);
  assert.deepEqual(world.requireObject(targetId).interaction,later);
  assert.equal(world.execute(command('current-remove','remove_interaction',
    {objectId:targetId,expectedInteraction:later})).ok,true);
});

test('a queued definition cannot attach after its target moved locally',()=>{
  const {world,targetId}=scene();
  verify(world,targetId);
  const observed=structuredClone(world.requireObject(targetId).transform);
  assert.equal(world.execute(command('local-move','set_transform',
    {objectId:targetId,transform:pose(.5,-2)})).ok,true);
  const stale=world.execute(command('stale-attach','set_interaction',
    {objectId:targetId,expectedTransform:observed,interaction:interaction()}));
  assert.equal(stale.ok,false);
  assert.match(stale.error,/transform changed since command was queued/);
  assert.equal(Object.hasOwn(world.requireObject(targetId),'interaction'),false);
});

test('a bound station refuses a later animation binding',()=>{
  const {world,targetId}=scene();
  verify(world,targetId);
  assert.equal(world.execute(command('station-definition','set_interaction',
    {objectId:targetId,interaction:interaction()})).ok,true);
  world.registerAssets([{...asset,geometry:{animationClips:[
    {name:'Later clip',durationSeconds:1}]}}]);
  const receipt=world.execute(command('later-animation','bind_animation',
    {objectId:targetId,loopClip:'Later clip',selectClip:null}));
  assert.equal(receipt.ok,false);
  assert.match(receipt.error,/Remove the authored interaction/);
  assert.equal(Object.hasOwn(world.requireObject(targetId),'animation'),false);
});

test('saved GLB interaction waits for its catalog and object-level renderer evidence',()=>{
  const {world,targetId}=scene();
  verify(world,targetId);
  assert.equal(world.execute(command('attach','set_interaction',
    {objectId:targetId,interaction:interaction()})).ok,true);
  const saved=structuredClone(world.scene);
  const fresh=new MatrixWorld();
  const prior=structuredClone(fresh.scene);
  assert.match(fresh.execute(command('missing-catalog','load',{scene:saved})).error,
    /Invalid scene object/);
  assert.deepEqual(fresh.scene,prior);
  fresh.registerAssets([asset]);
  assert.equal(fresh.execute(command('catalog-ready','load',{scene:saved})).ok,true);
  assert.equal(fresh.renderedAssetVerified(fresh.requireObject(targetId)),false);
  assert.equal(fresh.execute(command('remove-pending','remove_interaction',
    {objectId:targetId,expectedInteraction:interaction()})).ok,true);
});

test('moving a bound static GLB recomputes its use point from the observed transform',()=>{
  const {world,targetId,actorId}=scene();
  verify(world,targetId);
  assert.equal(world.execute(command('attach','set_interaction',
    {objectId:targetId,interaction:interaction()})).ok,true);
  const shifted=pose(2,-2);
  shifted.rotation.y=90;
  assert.equal(world.execute(command('shift','set_transform',
    {objectId:targetId,transform:shifted})).ok,true);
  const use=requestId=>world.execute(command(requestId,'interact',{
    actorObjectId:actorId,targetObjectId:targetId,kind:'rest',
    interactionId:'seat-rest',expectedInteraction:interaction()}));
  assert.match(use('old-place').error,/out of interaction range/);
  assert.equal(world.execute(command('walk-to-new-approach','set_transform',
    {objectId:actorId,transform:pose(2.78,-2)}),{recordHistory:false}).ok,true);
  const receipt=use('new-place');
  assert.equal(receipt.ok,true);
  assert.deepEqual(receipt.outcome.usePoint,{x:2.35,z:-2});
  assert.equal(receipt.outcome.observedDistanceMeters,.43);
  assert.equal(world.renderedAssetVerified(world.requireObject(targetId)),true,
    'a static pose edit does not change the already measured local GLB');
  const impossible=pose(99.9,-2);
  assert.match(world.execute(command('off-floor','set_transform',
    {objectId:targetId,transform:impossible})).error,/unreachable/);
  assert.deepEqual(world.requireObject(targetId).transform,shifted);
});
