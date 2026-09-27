import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld,PROCEDURAL_ASSET_ID} from '../src/protocol.js';
import {createProceduralRecipe,reviseProceduralRecipe} from '../src/procedural.js';
import {createRigidPhysics} from '../src/physics_rigid.js';
import {transitionCreatorMode} from '../src/creator_mode.js';
import {recordGameEvent,isGameExitUnlocked,validSavedGame} from '../src/game.js';
import {storedWorld,storedBrowserWorld,saveStoredWorld,loadStoredWorld,
  restoreStoredWorld,restoreBestStoredWorld} from '../src/scene_store.js';

const rigid=(type,collider='bounds-box',sensor=false)=>({schemaVersion:1,type,
  collider,restitution:0,friction:.8,sensor});
const pose=(x=0,y=0,z=0)=>({position:{x,y,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
let sequence=0;
const command=(world,op,data={})=>{
  const result=world.execute({requestId:`creator-${++sequence}`,op,...data});
  assert.equal(result.ok,true,result.error);
  return result;
};
const world=()=>{
  let id=0;
  return new MatrixWorld(()=>`created-${++id}`);
};

test('reviewed procedural recipes stay editable with stable IDs through Undo and reload',()=>{
  const current=world();
  const recipe=createProceduralRecipe('bridge',{riseMeters:1});
  const first=command(current,'create_procedural',{anchorId:'web-floor',transform:pose(),
    procedural:recipe}).objectId;
  const original=structuredClone(current.requireObject(first));
  const wider=reviseProceduralRecipe(recipe,{widthMeters:2});
  command(current,'update_procedural',{objectId:first,procedural:wider,
    expectedProcedural:recipe,expectedTransform:pose()});
  assert.equal(current.requireObject(first).procedural.parameters.widthMeters,2);
  const rejected=current.execute({requestId:'stale-procedural',op:'update_procedural',
    objectId:first,procedural:recipe,expectedProcedural:recipe,expectedTransform:pose()});
  assert.equal(rejected.ok,false);
  assert.deepEqual(current.requireObject(first).procedural,wider);
  command(current,'undo');
  assert.deepEqual(current.requireObject(first),original);
  command(current,'redo');
  assert.deepEqual(current.requireObject(first).procedural,wider);
  const second=command(current,'create_procedural',{anchorId:'web-floor',
    transform:pose(4,0,0),procedural:recipe}).objectId;
  assert.notEqual(second,first);
  const saved=storedWorld(current),reopened=world();
  restoreStoredWorld(reopened,saved);
  assert.equal(reopened.requireObject(first).objectId,first);
  assert.deepEqual(reopened.requireObject(second).procedural,recipe);
  const taller=reviseProceduralRecipe(wider,{riseMeters:1.3});
  command(reopened,'update_procedural',{objectId:first,procedural:taller,
    expectedProcedural:wider,expectedTransform:pose()});
  assert.deepEqual(reopened.requireObject(second).procedural,recipe);
  assert.equal(reopened.requireObject(first).assetId,PROCEDURAL_ASSET_ID);
});

test('missing generator version waits without replacing the live world or save',()=>{
  const current=world();
  command(current,'spawn',{assetId:'block',anchorId:'web-floor',transform:pose()});
  const prior=structuredClone(current.scene);
  const saved=storedWorld(current);
  saved.scene.objects.push({objectId:'saved-bridge',assetId:PROCEDURAL_ASSET_ID,
    anchorId:'web-floor',transform:pose(),procedural:{
      ...createProceduralRecipe('bridge'),generatorVersion:'9.0.0'}});
  const raw=JSON.stringify(saved),writes=[];
  const storage={setItem:(key,value)=>writes.push([key,value])};
  const result=restoreBestStoredWorld(current,{value:saved,source:'durable',raw},storage);
  assert.equal(result.state,'waiting');
  assert.match(result.reason,/reviewed procedural generators/);
  assert.deepEqual(current.scene,prior);
  assert.deepEqual(writes,[]);
});

test('a world-space display is a guarded editable component of the saved entity',()=>{
  const current=world();
  const board=command(current,'spawn',{assetId:'wall',anchorId:'web-floor',
    transform:pose(2,0,0)}).objectId;
  const display={schemaVersion:1,title:'Physics challenge',
    body:'Deliver all objects to the receptacle.',binding:{kind:'game-progress'}};
  command(current,'set_display',{objectId:board,display,expectedDisplay:null});
  assert.deepEqual(current.requireObject(board).display,display);
  const stale=current.execute({requestId:'stale-display',op:'set_display',objectId:board,
    display:{...display,title:'Stale'},expectedDisplay:null});
  assert.equal(stale.ok,false);
  const saved=storedWorld(current),reopened=world();
  restoreStoredWorld(reopened,saved);
  assert.deepEqual(reopened.requireObject(board).display,display);
  const revised={...display,title:'Revised challenge'};
  command(reopened,'set_display',{objectId:board,display:revised,expectedDisplay:display});
  assert.deepEqual(reopened.requireObject(board).display,revised);
  command(reopened,'remove_display',{objectId:board,expectedDisplay:revised});
  assert.equal(reopened.requireObject(board).display,undefined);
  command(reopened,'undo');
  assert.deepEqual(reopened.requireObject(board).display,revised);
});

test('rejected rigid scale keeps the authored scene, solver, and browser save valid',async()=>{
  const current=world(),engine=await createRigidPhysics();
  try{
    current.attachRigidPhysics(engine);
    const wall=command(current,'spawn',{assetId:'wall',anchorId:'web-floor',
      transform:pose()}).objectId;
    command(current,'set_rigid_body',{objectId:wall,rigidBody:rigid('static')});
    const sceneBefore=structuredClone(current.scene),solverBefore=engine.snapshot();
    const historyBefore=current.undo.length;
    const rejected=current.execute({requestId:'oversized-rigid-wall',op:'set_transform',
      objectId:wall,transform:{...pose(),scale:{x:20,y:20,z:20}}});
    assert.equal(rejected.ok,false);
    assert.match(rejected.error,/Rigid collider exceeds the supported size/);
    assert.deepEqual(current.scene,sceneBefore,
      'a failed receipt must not commit the oversized authored transform');
    assert.deepEqual(engine.snapshot(),solverBefore,
      'the live collider must still match the authored object');
    assert.equal(current.undo.length,historyBefore);
    const values=new Map(),storage={getItem:key=>values.get(key)??null,
      setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
    assert.equal(saveStoredWorld(storedBrowserWorld(current),storage,storage),'');
    const reopened=world();
    restoreStoredWorld(reopened,loadStoredWorld(storage,storage).value);
    const restoredEngine=await createRigidPhysics();
    try{
      reopened.attachRigidPhysics(restoredEngine);
      assert.deepEqual(reopened.scene,sceneBefore);
      assert.equal(restoredEngine.state(wall).type,'static');
      assert.equal(restoredEngine.snapshot().bodies.find(body=>body.objectId===wall)
        .bounds.size.x,2);
    }finally{restoredEngine.dispose();}
  }finally{engine.dispose();}
});

test('rejected ramp revision keeps its original recipe and collision mesh',async()=>{
  const current=world(),engine=await createRigidPhysics();
  try{
    current.attachRigidPhysics(engine);
    const original=createProceduralRecipe('bridge',{lengthMeters:6,
      railings:false,supports:false});
    const scaled={...pose(),scale:{x:2,y:2,z:2}};
    const bridge=command(current,'create_procedural',{anchorId:'web-floor',
      transform:scaled,procedural:original}).objectId;
    command(current,'set_rigid_body',{objectId:bridge,
      rigidBody:rigid('static','procedural-mesh')});
    const sceneBefore=structuredClone(current.scene),solverBefore=engine.snapshot();
    const revised=reviseProceduralRecipe(original,{lengthMeters:12});
    const rejected=current.execute({requestId:'oversized-ramp-revision',
      op:'update_procedural',objectId:bridge,expectedProcedural:original,
      procedural:revised});
    assert.equal(rejected.ok,false);
    assert.match(rejected.error,/Rigid collider exceeds the supported size/);
    assert.deepEqual(current.scene,sceneBefore);
    assert.deepEqual(engine.snapshot(),solverBefore);
    const reopened=world();
    restoreStoredWorld(reopened,storedWorld(current));
    assert.deepEqual(reopened.requireObject(bridge).procedural,original);
    const reopenedEngine=await createRigidPhysics();
    try{
      reopened.attachRigidPhysics(reopenedEngine);
      assert.equal(reopenedEngine.snapshot().bodies.find(body=>
        body.objectId===bridge).bounds.size.x,12);
    }finally{reopenedEngine.dispose();}
  }finally{engine.dispose();}
});

test('a solver rebuild failure rolls back editor mutations and history together',async()=>{
  const current=world(),engine=await createRigidPhysics();
  try{
    current.attachRigidPhysics(engine);
    const wall=command(current,'spawn',{assetId:'wall',anchorId:'web-floor',
      transform:pose()}).objectId;
    const block=command(current,'spawn',{assetId:'block',anchorId:'web-floor',
      transform:pose(3,0,0)}).objectId;
    command(current,'set_rigid_body',{objectId:wall,rigidBody:rigid('static')});
    current.renderedVerification.set(wall,{object:current.requireObject(wall),
      signature:'observed',measuredSize:{x:2,y:2,z:.12}});
    let attempt=0;
    const rejectsWithoutMutation=(op,data={})=>{
      const before=structuredClone({scene:current.scene,selection:current.selection,
        undo:current.undo,redo:current.redo});
      const solverBefore=engine.snapshot();
      const restore=engine.restore;
      engine.restore=()=>{throw Error('Injected solver rebuild failure');};
      let result;
      try{result=current.execute({requestId:`rejected-rebuild-${++attempt}`,op,...data});}
      finally{engine.restore=restore;}
      assert.equal(result.ok,false,`${op} must report its failed rebuild`);
      assert.match(result.error,/Injected solver rebuild failure/);
      assert.deepEqual({scene:current.scene,selection:current.selection,
        undo:current.undo,redo:current.redo},before);
      assert.deepEqual(engine.snapshot(),solverBefore);
      assert.equal(current.renderedVerification.get(wall)?.object,
        current.scene.objects.find(item=>item.objectId===wall),
        'rendered verification must follow the restored scene object');
      assert.equal(current.rigidSceneReference,current.scene);
    };
    rejectsWithoutMutation('set_rigid_body',{objectId:block,
      rigidBody:rigid('dynamic')});
    rejectsWithoutMutation('remove_rigid_body',{objectId:wall});
    rejectsWithoutMutation('duplicate',{objectId:wall});
    rejectsWithoutMutation('create_procedural',{anchorId:'web-floor',
      transform:pose(5,0,0),procedural:createProceduralRecipe('bridge')});
    rejectsWithoutMutation('delete',{objectId:wall});
    rejectsWithoutMutation('clear');
    rejectsWithoutMutation('load',{scene:{...current.scene,objects:[]}});
    rejectsWithoutMutation('undo');
    command(current,'undo');
    // Undo itself succeeds, so its inverse now exercises the redo transaction.
    current.renderedVerification.set(wall,{object:current.requireObject(wall),
      signature:'observed',measuredSize:{x:2,y:2,z:.12}});
    rejectsWithoutMutation('redo');
    const beforeGravity=structuredClone(current.rigidGravity);
    const setGravity=engine.setGravity;
    engine.setGravity=()=>{throw Error('Injected gravity failure');};
    let gravityResult;
    try{gravityResult=current.execute({requestId:'rejected-gravity',
      op:'set_gravity',gravity:{x:0,y:-4,z:0}});}
    finally{engine.setGravity=setGravity;}
    assert.equal(gravityResult.ok,false);
    assert.deepEqual(current.rigidGravity,beforeGravity);
    assert.deepEqual(engine.world.gravity,beforeGravity);
  }finally{engine.dispose();}
});

test('MatrixWorld runs real ramp collision and repeated grabs while preserving saved gravity',async()=>{
  const current=world();
  current.attachRigidPhysics(await createRigidPhysics());
  const bridge=command(current,'create_procedural',{anchorId:'web-floor',
    transform:pose(),procedural:createProceduralRecipe('bridge',{
      riseMeters:1,railings:false,supports:false})}).objectId;
  command(current,'set_rigid_body',{objectId:bridge,
    rigidBody:rigid('static','procedural-mesh')});
  const block=command(current,'spawn',{assetId:'block',anchorId:'web-floor',
    transform:pose(-1,3,0)}).objectId;
  command(current,'set_rigid_body',{objectId:block,rigidBody:rigid('dynamic')});
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-play',0);
  let contacts=[];
  for(let tick=0;tick<180;tick++)contacts.push(...current.advanceRigidPhysics(1/60));
  assert.ok(contacts.some(item=>[item.objectIdA,item.objectIdB].includes(bridge)&&
    [item.objectIdA,item.objectIdB].includes(block)));
  assert.ok(current.requireObject(block).transform.position.y<3);
  for(let cycle=0;cycle<2;cycle++){
    assert.equal(current.beginRigidGrab(block),true);
    current.moveRigidGrab(block,pose(0,3+cycle,0));
    assert.equal(current.releaseRigidGrab(block)?.objectId,block);
    const releasedY=current.rigidPhysics.state(block).position.y;
    for(let tick=0;tick<30;tick++)current.advanceRigidPhysics(1/60);
    assert.ok(current.rigidPhysics.state(block).position.y<releasedY);
  }
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-creator',1);
  command(current,'set_gravity',{gravity:{x:0,y:-4,z:0}});
  const saved=storedWorld(current),reopened=world();
  restoreStoredWorld(reopened,saved);
  reopened.attachRigidPhysics(await createRigidPhysics());
  assert.deepEqual(reopened.rigidGravity,{x:0,y:-4,z:0});
  assert.equal(reopened.requireObject(block).objectId,block);
  assert.equal(reopened.rigidPhysics.state(block).type,'dynamic');
  current.rigidPhysics.dispose();reopened.rigidPhysics.dispose();
});

test('existing objects bind a real challenge, dedupe credit, unlock exit, and survive edits',async()=>{
  const current=world();current.attachRigidPhysics(await createRigidPhysics());
  const items=[];
  for(let index=0;index<3;index++){
    const id=command(current,'spawn',{assetId:'block',anchorId:'web-floor',
      transform:pose(index,1,-2)}).objectId;
    command(current,'set_rigid_body',{objectId:id,rigidBody:rigid('dynamic')});
    items.push(id);
  }
  const zone=command(current,'spawn',{assetId:'pedestal',anchorId:'web-floor',
    transform:pose(0,0,1)}).objectId;
  command(current,'set_rigid_body',{objectId:zone,rigidBody:rigid('static','bounds-box',true)});
  const exit=command(current,'spawn',{assetId:'wall',anchorId:'web-floor',
    transform:pose(3,0,1)}).objectId;
  const spec={schemaVersion:2,kind:'game',title:'Delivery Challenge',
    summary:'Deliver three objects to unlock the exit.',roles:[
      {roleId:'cargo',kind:'pickup',assetId:'block',count:3},
      {roleId:'receptacle',kind:'delivery-zone',assetId:'pedestal',count:1},
      {roleId:'exit',kind:'exit',assetId:'wall',count:1}],
    rules:[{event:'sensor-enter',actorRoleId:'cargo',targetRoleId:'receptacle',
      distanceMeters:1,scorePoints:10}],
    objectives:[{kind:'delivered-count',roleId:'cargo',targetCount:3}],
    consequences:[{kind:'unlock',roleId:'exit'}]};
  command(current,'bind_game',{spec,bindings:{cargo:items,receptacle:[zone],exit:[exit]}});
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-play',0);
  assert.equal(current.execute({requestId:'illegal-play-edit',op:'set_gravity',
    gravity:{x:0,y:-2,z:0}}).ok,false);
  for(const [index,id] of items.entries()){
    current.beginRigidGrab(id);
    current.moveRigidGrab(id,pose(0,.4,1));
    current.releaseRigidGrab(id);
    current.advanceRigidPhysics(1/60);
    const receipt=recordGameEvent(current,{eventId:`sensor-${index}`,
      event:'sensor-enter',objectId:id,targetObjectId:zone});
    assert.equal(receipt?.credited,true);
    assert.equal(recordGameEvent(current,{eventId:`sensor-${index}`,
      event:'sensor-enter',objectId:id,targetObjectId:zone}),null);
  }
  assert.equal(current.game.state.phase,'won');
  assert.equal(current.game.state.score,30);
  assert.equal(isGameExitUnlocked(current,exit),true);
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-creator',1);
  command(current,'set_gravity',{gravity:{x:0,y:-5,z:0}});
  assert.equal(current.game.state.objectiveProgress.cargo,3);
  const saved=storedWorld(current),reopened=world();
  restoreStoredWorld(reopened,saved);
  assert.equal(validSavedGame(reopened.game,reopened.scene,id=>!!reopened.asset(id)),
    reopened.game);
  assert.equal(isGameExitUnlocked(reopened,exit),true);
  assert.deepEqual(reopened.game.bindings.cargo,items);
  current.rigidPhysics.dispose();
});
