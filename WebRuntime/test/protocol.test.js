import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld,ROOM_ID,ANCHOR_ID,ASSETS} from '../src/protocol.js';

const pose=(x=0,y=0,z=-2)=>({position:{x,y,z},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}});
const command=(requestId,op,extra={})=>({requestId,op,...extra});

test('web runtime emits the existing Matrix schema and catalog',()=>{
  const world=new MatrixWorld(()=> 'object-1');
  const snapshot=world.snapshot();
  assert.equal(snapshot.scene.schemaVersion,1);
  assert.equal(snapshot.scene.roomId,ROOM_ID);
  assert.equal(snapshot.anchors[0].anchorId,ANCHOR_ID);
  assert.deepEqual(snapshot.behaviorKinds,['rotate','bob']);
  assert.equal(snapshot.roomContext.mode,'white-room');
  assert.deepEqual(ASSETS.map(a=>a.assetId),['chair','table','wall','pedestal','block','orb','column']);
});

test('spawn, transform, behavior, undo and restore preserve stable identity',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const created=world.execute(command('1','spawn',{assetId:'table',anchorId:ANCHOR_ID,transform:pose()}));
  assert.equal(created.ok,true);assert.equal(created.objectId,'object-1');
  assert.equal(world.execute(command('2','set_transform',{objectId:'object-1',transform:pose(1,0,-2)})).ok,true);
  const behavior={kind:'rotate',enabled:true,paused:false,axis:'y',speedDegreesPerSecond:30,amplitudeMeters:.05,frequencyHz:.5};
  assert.equal(world.execute(command('3','set_behavior',{objectId:'object-1',behavior})).ok,true);
  const saved=structuredClone(world.scene);
  assert.equal(world.execute(command('4','clear')).ok,true);
  assert.equal(world.scene.objects.length,0);
  assert.equal(world.execute(command('5','load',{scene:saved})).ok,true);
  assert.deepEqual(world.scene,saved);
  assert.equal(world.execute(command('6','undo')).ok,true);
  assert.equal(world.scene.objects.length,0);
  assert.equal(world.execute(command('7','redo')).ok,true);
  assert.equal(world.scene.objects[0].objectId,'object-1');
});

test('local observed movement validates and receipts without filling authored Undo history',()=>{
  const world=new MatrixWorld(()=> 'resident-1');
  const spawn=world.execute(command('spawn-1','spawn',{assetId:'orb',anchorId:ANCHOR_ID,transform:pose()}));
  assert.equal(spawn.ok,true);
  const beforeUndo=world.undo.length;
  const moved=world.execute(command('move-1','set_transform',
    {objectId:spawn.objectId,transform:pose(.25,0,-2)}),{recordHistory:false});
  assert.deepEqual({requestId:moved.requestId,ok:moved.ok,objectId:moved.objectId},
    {requestId:'move-1',ok:true,objectId:'resident-1'});
  assert.equal(world.requireObject(spawn.objectId).transform.position.x,.25);
  assert.equal(world.undo.length,beforeUndo);
  const rejected=world.execute(command('move-2','set_transform',
    {objectId:spawn.objectId,transform:pose(101,0,-2)}),{recordHistory:false});
  assert.equal(rejected.ok,false);
  assert.equal(world.requireObject(spawn.objectId).transform.position.x,.25);
  assert.equal(world.undo.length,beforeUndo);
});

test('queued resident edits reject a changed pose before mutating any targeted operation',()=>{
  const world=new MatrixWorld(()=> 'resident-1');
  assert.equal(world.execute(command('spawn','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose()})).ok,true);
  const expectedTransform=structuredClone(world.requireObject('resident-1').transform);
  assert.equal(world.execute(command('simulation-move','set_transform',
    {objectId:'resident-1',transform:pose(.25)}),{recordHistory:false}).ok,true);
  const scene=structuredClone(world.scene),selection=structuredClone(world.selection);
  const undo=structuredClone(world.undo),redo=structuredClone(world.redo);
  const generation=world.authoredGeneration;
  const behavior={kind:'rotate',enabled:true,paused:false,axis:'y',
    speedDegreesPerSecond:30,amplitudeMeters:0,frequencyHz:.5};
  const packageDefinition={schemaVersion:1,name:'Drift',outputs:{
    'position.x':{op:'const',value:0}}};
  for(const [op,payload] of [
    ['set_transform',{transform:pose(1)}],['set_behavior',{behavior}],
    ['remove_behavior',{behaviorKind:'all'}],
    ['attach_component',{componentId:'webcomp:drift:0123456789ab',
      targetObjectId:'station-1',package:packageDefinition}],
    ['stop_component',{}],['remove_component',{}],
    ['bind_animation',{loopClip:null,selectClip:null}],
    ['set_physics',{physics:{schemaVersion:1,kind:'gravity-floor',
      collider:'rendered-bounds-box',restitution:0}}],['remove_physics',{}],
    ['delete',{}],['duplicate',{}],['select',{}]
  ]){
    const result=world.execute(command(`stale-${op}`,op,
      {objectId:'resident-1',expectedTransform,...payload}));
    assert.equal(result.ok,false,op);
    assert.match(result.error,/transform changed since command was queued/,op);
    assert.deepEqual(world.scene,scene,op);
    assert.deepEqual(world.selection,selection,op);
    assert.deepEqual(world.undo,undo,op);
    assert.deepEqual(world.redo,redo,op);
    assert.equal(world.authoredGeneration,generation,op);
  }
  assert.equal(world.execute(command('fresh-select','select',
    {objectId:'resident-1',expectedTransform:pose(.25)})).ok,true);
});

test('expectedTransform accepts only the exact finite target-operation shape',()=>{
  const world=new MatrixWorld(()=> 'resident-1');
  assert.equal(world.execute(command('spawn','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose()})).ok,true);
  const scene=structuredClone(world.scene);
  for(const expectedTransform of [null,
    {...pose(),extra:1},
    {...pose(),position:{...pose().position,extra:1}},
    {...pose(),position:{x:NaN,y:0,z:-2}}]){
    const rejected=world.execute(command('invalid-shape','set_transform',
      {objectId:'resident-1',expectedTransform,transform:pose(1)}));
    assert.equal(rejected.ok,false);
    assert.match(rejected.error,/Invalid expectedTransform/);
    assert.deepEqual(world.scene,scene);
  }
  const unsupported=world.execute(command('unsupported','clear',
    {expectedTransform:pose()}));
  assert.equal(unsupported.ok,false);
  assert.match(unsupported.error,/Invalid expectedTransform/);
  assert.deepEqual(world.scene,scene);
});

test('expectedTargetTransform is an exact finite attach_component-only precondition',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const host=world.execute(command('host','spawn',
    {assetId:'block',anchorId:ANCHOR_ID,transform:pose(4)}));
  const target=world.execute(command('target','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose()}));
  const attach={objectId:host.objectId,targetObjectId:target.objectId,
    componentId:'webcomp:drift:0123456789ab',
    package:{schemaVersion:1,name:'Drift',outputs:{
      'position.x':{op:'const',value:0}}}};
  const scene=structuredClone(world.scene);
  for(const expectedTargetTransform of [null,{...pose(),extra:1},
    {...pose(),position:{...pose().position,extra:1}},
    {...pose(),position:{x:Infinity,y:0,z:-2}}]){
    const result=world.execute(command('invalid-target-pose','attach_component',
      {...attach,expectedTargetTransform}));
    assert.equal(result.ok,false);
    assert.match(result.error,/Invalid expectedTargetTransform/);
    assert.deepEqual(world.scene,scene);
  }
  const unsupported=world.execute(command('wrong-op','set_transform',
    {objectId:host.objectId,transform:pose(5),expectedTargetTransform:pose()}));
  assert.equal(unsupported.ok,false);
  assert.match(unsupported.error,/Invalid expectedTargetTransform/);
  assert.deepEqual(world.scene,scene);
  assert.equal(world.execute(command('current-target-pose','attach_component',
    {...attach,expectedTargetTransform:pose()})).ok,true);
});

test('a resident with an active transform owner is omitted from Citizens observation',()=>{
  const world=new MatrixWorld(()=> 'resident-1');
  assert.equal(world.execute(command('spawn','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose()}),{recordHistory:false}).ok,true);
  world.citizens={residents:[{objectId:'resident-1'}]};
  const before=world.snapshot();
  assert.deepEqual(before.citizensObservation.residentObjectIds,['resident-1']);
  const behavior={kind:'rotate',enabled:true,paused:false,axis:'y',
    speedDegreesPerSecond:30,amplitudeMeters:0,frequencyHz:.5};
  assert.equal(world.execute(command('operator-behavior','set_behavior',
    {objectId:'resident-1',behavior})).ok,true);
  const after=world.snapshot();
  assert.equal(after.citizensObservation,undefined);
  assert.deepEqual(after.scene.objects[0].behaviors,[behavior]);
  assert.notEqual(world.authoredGeneration,before.citizensObservation.authoredGeneration);
  assert.equal(world.execute(command('pause-behavior','set_behavior',
    {objectId:'resident-1',behavior:{...behavior,paused:true}})).ok,true);
  assert.deepEqual(world.snapshot().citizensObservation.residentObjectIds,['resident-1']);
});

test('an unrecorded mutation invalidates stale redo history',()=>{
  const world=new MatrixWorld(()=> 'resident-1');
  const spawn=world.execute(command('spawn','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0)}));
  assert.equal(spawn.ok,true);
  assert.equal(world.execute(command('author-move','set_transform',
    {objectId:spawn.objectId,transform:pose(1)})).ok,true);
  assert.equal(world.execute(command('undo','undo')).ok,true);
  assert.equal(world.redo.length,1);
  const move=world.execute(command('simulation-move','set_transform',
    {objectId:spawn.objectId,transform:pose(2)}),{recordHistory:false});
  assert.equal(move.ok,true);
  assert.equal(world.requireObject(spawn.objectId).transform.position.x,2);
  assert.equal(world.redo.length,0);
  assert.match(world.execute(command('redo','redo')).error,/History is empty/);
  assert.equal(world.requireObject(spawn.objectId).transform.position.x,2);
});

test('an advertised finite interaction returns an in-range observed outcome',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const chair=world.execute(command('spawn-chair','spawn',
    {assetId:'chair',anchorId:ANCHOR_ID,transform:pose(0,0,-2)}));
  const actor=world.execute(command('spawn-actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0,0,-1.4)}));
  assert.equal(chair.ok,true);assert.equal(actor.ok,true);
  assert.deepEqual(world.snapshot().assets.find(asset=>asset.assetId==='chair').interactions,
    [{kind:'rest',rangeMeters:.8}]);
  const beforeUndo=world.undo.length;
  const outcome=world.execute(command('rest-1','interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  assert.equal(outcome.ok,true);
  assert.deepEqual(outcome.outcome,{kind:'rest',actorObjectId:actor.objectId,
    targetObjectId:chair.objectId,observedDistanceMeters:.6});
  assert.equal(world.undo.length,beforeUndo);
  assert.equal(world.execute(command('eat-1','interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'eat'})).ok,false);
  assert.equal(world.execute(command('move-away','set_transform',
    {objectId:actor.objectId,transform:pose(3,0,-1.4)}),{recordHistory:false}).ok,true);
  const rejected=world.execute(command('rest-2','interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  assert.match(rejected.error,/out of interaction range/);
  assert.equal(rejected.outcome,undefined);
});

test('an inserted wall blocks an otherwise in-range interaction until it moves away',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const chair=world.execute(command('chair','spawn',
    {assetId:'chair',anchorId:ANCHOR_ID,transform:pose(0,0,-2)}));
  const actor=world.execute(command('actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0,0,-1.4)}));
  assert.equal(chair.ok,true);assert.equal(actor.ok,true);
  const wallTransform=pose(0,0,-1.7);
  wallTransform.scale={x:.5,y:.5,z:.5};
  const wall=world.execute(command('wall','spawn',
    {assetId:'wall',anchorId:ANCHOR_ID,transform:wallTransform}));
  assert.equal(wall.ok,true);
  const interact=requestId=>world.execute(command(requestId,'interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  const blocked=interact('blocked-rest');
  assert.equal(blocked.ok,false);
  assert.match(blocked.error,/use point is occluded/);
  assert.equal(blocked.outcome,undefined);
  const shifted=structuredClone(wallTransform);
  shifted.position.x=3;
  assert.equal(world.execute(command('move-wall','set_transform',
    {objectId:wall.objectId,transform:shifted})).ok,true);
  const clear=interact('clear-rest');
  assert.equal(clear.ok,true);
  assert.equal(clear.outcome.targetObjectId,chair.objectId);
});

test('a remote rotating block does not block interaction, but a nearby one is uncertain',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const chair=world.execute(command('chair','spawn',
    {assetId:'chair',anchorId:ANCHOR_ID,transform:pose(0,0,-2)}));
  const actor=world.execute(command('actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0,0,-1.4)}));
  const block=world.execute(command('block','spawn',
    {assetId:'block',anchorId:ANCHOR_ID,transform:pose(50,0,50)}));
  assert.equal(block.ok,true);
  const rotate={kind:'rotate',enabled:true,paused:false,axis:'y',
    speedDegreesPerSecond:30,amplitudeMeters:0,frequencyHz:.5};
  assert.equal(world.execute(command('rotate-block','set_behavior',
    {objectId:block.objectId,behavior:rotate})).ok,true);
  const use=requestId=>world.execute(command(requestId,'interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  assert.equal(use('remote-rotating-block').ok,true);
  assert.equal(world.execute(command('move-rotating-block','set_transform',
    {objectId:block.objectId,transform:pose(0,0,-1.7)})).ok,true);
  assert.match(use('near-rotating-block').error,/clearance is unavailable/);
});

test('a remote unmeasured GLB does not block interaction, but a nearby one does',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const sha='a'.repeat(64);
  const asset={assetId:'web:unmeasured-glb',displayName:'Unmeasured GLB',
    description:'Validated on load without catalog bounds.',spawnScale:1,
    sha256:sha,byteLength:1024,url:`/api/web/assets/${sha}.glb`};
  world.registerAssets([asset]);
  const chair=world.execute(command('chair','spawn',
    {assetId:'chair',anchorId:ANCHOR_ID,transform:pose(0,0,-2)}));
  const actor=world.execute(command('actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0,0,-1.4)}));
  const glb=world.execute(command('glb','spawn',
    {assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose(50,0,50)}));
  assert.equal(glb.ok,true);
  const use=requestId=>world.execute(command(requestId,'interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  assert.equal(use('remote-unmeasured-glb').ok,true);
  assert.equal(world.execute(command('move-unmeasured-glb','set_transform',
    {objectId:glb.objectId,transform:pose(0,0,-1.7)})).ok,true);
  assert.match(use('near-unmeasured-glb').error,/clearance is unavailable/);
});

test('a GLB with an off-center export pivot blocks at its recentered rendered pose',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const sha='b'.repeat(64);
  const asset={assetId:'web:off-center-glb',displayName:'Offset GLB',
    description:'The browser recenters this model at its object transform.',
    spawnScale:1,localBounds:{center:{x:10,y:.5,z:0},
      size:{x:.4,y:1,z:.2}},sha256:sha,byteLength:1024,
    url:`/api/web/assets/${sha}.glb`};
  world.registerAssets([asset]);
  const chair=world.execute(command('chair','spawn',
    {assetId:'chair',anchorId:ANCHOR_ID,transform:pose(0,0,-2)}));
  const actor=world.execute(command('actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0,0,-1.4)}));
  const glb=world.execute(command('offset-glb','spawn',
    {assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose(0,0,-1.7)}));
  assert.equal(glb.ok,true);
  const blocked=world.execute(command('rest-by-offset-glb','interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  assert.equal(blocked.ok,false);
  assert.match(blocked.error,/use point is occluded/);
  assert.equal(blocked.outcome,undefined);
});

test('a bound looping GLB is uncertain near use but irrelevant when remote',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const sha='c'.repeat(64);
  const asset={assetId:'web:looping-glb',displayName:'Looping GLB',
    description:'Animated geometry with measured static bounds.',spawnScale:1,
    localBounds:{center:{x:0,y:.5,z:0},size:{x:.5,y:1,z:.2}},
    geometry:{animationClips:[{name:'Loop',durationSeconds:1}]},
    sha256:sha,byteLength:1024,url:`/api/web/assets/${sha}.glb`};
  world.registerAssets([asset]);
  const chair=world.execute(command('chair','spawn',
    {assetId:'chair',anchorId:ANCHOR_ID,transform:pose(0,0,-2)}));
  const actor=world.execute(command('actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0,0,-1.4)}));
  const glb=world.execute(command('looping-glb','spawn',
    {assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose(50,0,50)}));
  assert.equal(world.execute(command('bind-loop','bind_animation',
    {objectId:glb.objectId,loopClip:'Loop',selectClip:null})).ok,true);
  const use=requestId=>world.execute(command(requestId,'interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  assert.equal(use('remote-looping-glb').ok,true);
  assert.equal(world.execute(command('move-looping-glb','set_transform',
    {objectId:glb.objectId,transform:pose(0,0,-1.7)})).ok,true);
  assert.match(use('near-looping-glb').error,/clearance is unavailable/);
});

test('an unmeasured looping GLB is uncertain near use but irrelevant when remote',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const sha='d'.repeat(64);
  const asset={assetId:'web:unmeasured-looping-glb',displayName:'Unmeasured looping GLB',
    description:'Animated geometry without saved bounds.',spawnScale:1,
    geometry:{animationClips:[{name:'Idle',durationSeconds:1}]},
    sha256:sha,byteLength:1024,url:`/api/web/assets/${sha}.glb`};
  world.registerAssets([asset]);
  const chair=world.execute(command('chair','spawn',
    {assetId:'chair',anchorId:ANCHOR_ID,transform:pose(0,0,-2)}));
  const actor=world.execute(command('actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0,0,-1.4)}));
  const glb=world.execute(command('looping-glb','spawn',
    {assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose(50,0,50)}));
  assert.equal(world.execute(command('bind-loop','bind_animation',
    {objectId:glb.objectId,loopClip:'Idle',selectClip:null})).ok,true);
  const use=requestId=>world.execute(command(requestId,'interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  assert.equal(use('remote-unmeasured-loop').ok,true);
  assert.equal(world.execute(command('move-unmeasured-loop','set_transform',
    {objectId:glb.objectId,transform:pose(0,0,-1.7)})).ok,true);
  assert.match(use('near-unmeasured-loop').error,/clearance is unavailable/);
});

test('active actor or target transform owner cannot produce a finite use receipt',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const chair=world.execute(command('chair','spawn',
    {assetId:'chair',anchorId:ANCHOR_ID,transform:pose(0,0,-2)}));
  const actor=world.execute(command('actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0,0,-1.4)}));
  const use=requestId=>world.execute(command(requestId,'interact',
    {actorObjectId:actor.objectId,targetObjectId:chair.objectId,kind:'rest'}));
  const rotate={kind:'rotate',enabled:true,paused:false,axis:'y',
    speedDegreesPerSecond:30,amplitudeMeters:0,frequencyHz:.5};
  assert.equal(world.execute(command('move-chair','set_behavior',
    {objectId:chair.objectId,behavior:rotate})).ok,true);
  assert.match(use('active-chair').error,/another transform owner/);
  assert.equal(world.execute(command('pause-chair','set_behavior',
    {objectId:chair.objectId,behavior:{...rotate,paused:true}})).ok,true);
  assert.equal(use('paused-chair').ok,true);
  const packageDefinition={schemaVersion:1,name:'Move chair',
    outputs:{'position.x':{op:'const',value:10}}};
  assert.equal(world.execute(command('attach-chair','attach_component',
    {objectId:chair.objectId,componentId:'webcomp:test:012345abcdef',
      targetObjectId:actor.objectId,package:packageDefinition})).ok,true);
  assert.match(use('component-chair').error,/another transform owner/);
  assert.equal(world.execute(command('stop-chair','stop_component',
    {objectId:chair.objectId})).ok,true);
  assert.equal(world.execute(command('move-actor','set_behavior',
    {objectId:actor.objectId,behavior:rotate})).ok,true);
  assert.match(use('active-actor').error,/another transform owner/);
  assert.equal(world.execute(command('pause-actor','set_behavior',
    {objectId:actor.objectId,behavior:{...rotate,paused:true}})).ok,true);
  assert.equal(use('paused-actor-and-chair').ok,true);
});

test('converse requires a bounded session ID and an observed in-range resident pair',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  const actor=world.execute(command('spawn-actor','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(0,0,-2)}));
  const invitee=world.execute(command('spawn-invitee','spawn',
    {assetId:'orb',anchorId:ANCHOR_ID,transform:pose(.6,0,-2)}));
  assert.equal(actor.ok,true);assert.equal(invitee.ok,true);
  assert.deepEqual(world.snapshot().assets.find(asset=>asset.assetId==='orb').interactions,
    [{kind:'converse',rangeMeters:.8}]);
  const converse=extra=>world.execute(command('converse','interact',
    {actorObjectId:actor.objectId,targetObjectId:invitee.objectId,kind:'converse',...extra}));
  for(const sessionId of [undefined,'','x'.repeat(129),'bad\nID']){
    const rejected=converse({sessionId});
    assert.equal(rejected.ok,false);
    assert.match(rejected.error,/Invalid social sessionId/);
    assert.equal(rejected.outcome,undefined);
  }
  const receipt=converse({sessionId:'social-29-7'});
  assert.equal(receipt.ok,true);
  assert.deepEqual(receipt.outcome,{kind:'converse',actorObjectId:actor.objectId,
    targetObjectId:invitee.objectId,observedDistanceMeters:.6,sessionId:'social-29-7'});
  assert.equal(world.execute(command('move-invitee','set_transform',
    {objectId:invitee.objectId,transform:pose(1.2,0,-2)}),{recordHistory:false}).ok,true);
  const distant=converse({sessionId:'social-29-8'});
  assert.equal(distant.ok,false);
  assert.match(distant.error,/out of interaction range/);
  assert.equal(distant.outcome,undefined);
});

test('bad geometry bounds and incompatible saved scenes fail without mutation',()=>{
  const world=new MatrixWorld(()=> 'object-1');
  const original=structuredClone(world.scene);
  assert.equal(world.execute(command('1','spawn',{assetId:'unknown',anchorId:ANCHOR_ID,transform:pose()})).ok,false);
  assert.equal(world.execute(command('2','spawn',{assetId:'orb',anchorId:ANCHOR_ID,transform:pose(101,0,0)})).ok,false);
  assert.equal(world.execute(command('3','load',{scene:{...original,roomId:'another-room'}})).ok,false);
  assert.deepEqual(world.scene,original);
  assert.equal(world.undo.length,0);
});

test('selection and duplicate use acknowledged IDs and never alter another object',()=>{
  let n=0;const world=new MatrixWorld(()=>`object-${++n}`);
  world.execute(command('1','spawn',{assetId:'chair',anchorId:ANCHOR_ID,transform:pose()}));
  const copied=world.execute(command('2','duplicate',{objectId:'object-1'}));
  assert.equal(copied.objectId,'object-2');
  assert.equal(world.scene.objects[0].transform.position.x,0);
  assert.equal(world.scene.objects[1].transform.position.x,.3);
  assert.equal(world.execute(command('3','select',{objectId:'object-2'})).ok,true);
  assert.equal(world.snapshot().selection.objectId,'object-2');
});

test('registered GLB appears in live catalog and restores with its immutable ID',()=>{
  const world=new MatrixWorld(()=> 'web-object-1');
  const sha='a'.repeat(64);
  const asset={assetId:`web:glass-arch:${sha.slice(0,12)}`,displayName:'Glass Arch',description:'A Blender-made arch.',spawnScale:.5,
    localBounds:{center:{x:0,y:1,z:0},size:{x:2,y:2,z:1}},
    sha256:sha,byteLength:1024,url:`/api/web/assets/${sha}.glb`};
  world.registerAssets([asset]);
  assert.equal(world.snapshot().assets.at(-1).assetId,asset.assetId);
  assert.equal(world.snapshot().assets.at(-1).spawnScale,.5);
  assert.deepEqual(world.snapshot().assets.at(-1).localBounds,asset.localBounds);
  assert.equal(world.execute(command('1','spawn',{assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose()})).ok,true);
  const saved=structuredClone(world.scene);
  world.execute(command('2','clear'));
  assert.equal(world.execute(command('3','load',{scene:saved})).ok,true);
  assert.equal(world.scene.objects[0].assetId,asset.assetId);
  assert.throws(()=>world.registerAssets([{...asset,url:'https://another.example/model.glb'}]),/Invalid web asset/);
  assert.throws(()=>world.registerAssets([{...asset,geometry:{animationClips:[
    {name:'Flight',durationSeconds:1},{name:'Flight',durationSeconds:1}]}}]),/animation metadata/);
  const unicode='🐉'.repeat(40);
  world.registerAssets([{...asset,geometry:{animationClips:[{name:unicode,durationSeconds:1}]}}]);
  assert.equal(world.asset(asset.assetId).geometry.animationClips[0].name,unicode);
});

test('GLB animation binding is validated, persisted, undoable, and removable',()=>{
  const world=new MatrixWorld(()=> 'dragon-1');
  const sha='b'.repeat(64);
  const asset={assetId:`web:dragon:${sha.slice(0,12)}`,displayName:'Dragon',description:'Animated GLB',
    spawnScale:1,sha256:sha,byteLength:2048,url:`/api/web/assets/${sha}.glb`,
    geometry:{animationClips:[{name:'Flight',durationSeconds:1},{name:'Roar',durationSeconds:.5}]}};
  world.registerAssets([asset]);
  assert.equal(world.snapshot().animationSchemaVersion,1);
  assert.deepEqual(world.snapshot().assets.at(-1).animationClips,['Flight','Roar']);
  assert.equal(world.execute(command('1','spawn',{assetId:asset.assetId,anchorId:ANCHOR_ID,transform:pose()})).ok,true);
  const binding={loopClip:'Flight',selectClip:'Roar'};
  assert.equal(world.execute(command('2','bind_animation',{objectId:'dragon-1',...binding})).ok,true);
  assert.deepEqual(world.scene.objects[0].animation,binding);
  const saved=structuredClone(world.scene);
  assert.equal(world.execute(command('3','bind_animation',{objectId:'dragon-1',loopClip:'Missing',selectClip:null})).ok,false);
  assert.deepEqual(world.scene,saved);
  assert.equal(world.execute(command('4','undo')).ok,true);
  assert.equal(world.scene.objects[0].animation,undefined);
  assert.equal(world.execute(command('5','redo')).ok,true);
  assert.deepEqual(world.scene.objects[0].animation,binding);
  assert.equal(world.execute(command('6','clear')).ok,true);
  assert.equal(world.execute(command('7','load',{scene:saved})).ok,true);
  assert.deepEqual(world.scene.objects[0].animation,binding);
  assert.equal(world.execute(command('8','bind_animation',{objectId:'dragon-1',loopClip:null,selectClip:null})).ok,true);
  assert.equal(world.scene.objects[0].animation,undefined);
  const bad=structuredClone(saved);bad.objects[0].animation.selectClip='Unknown';
  assert.equal(world.execute(command('9','load',{scene:bad})).ok,false);
});
