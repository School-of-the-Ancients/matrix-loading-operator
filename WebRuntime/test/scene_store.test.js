import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {loadStoredScene,saveStoredScene,restoreStoredScene,saveCheckpoint,loadCheckpoint,
  storedWorld,storedBrowserWorld,saveStoredWorld,loadStoredWorld,restoreStoredWorld,restoreBestStoredWorld,
  quarantineStoredWorld,loadCitizensDeletionRecovery,restoreCitizensDeletionRecovery,
  clearCitizensDeletionRecovery,
  TAB_SCENE_KEY,DURABLE_SCENE_KEY,WORLD_KEY,TAB_WORLD_KEY,
  QUARANTINE_KEY,QUARANTINE_BACKUP_KEY,CITIZENS_DELETION_RECOVERY_KEY} from '../src/scene_store.js';
import {CitizensSimulation,createCitizensDemo} from '../src/citizens.js';
import {startGame,deliverMovedObject} from '../src/game.js';
import {rememberTurn,clearConversation} from '../src/conversation.js';

function storage(){
  const values=new Map();
  return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
const pose={position:{x:1,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};

test('closing the tab restores the same virtual objects from durable browser storage',()=>{
  const tab=storage(),durable=storage();
  const original=new MatrixWorld(()=> 'chair-one');
  assert.equal(original.execute({requestId:'spawn',op:'spawn',assetId:'chair',anchorId:'web-floor',transform:pose}).ok,true);
  assert.equal(saveStoredScene(original.scene,tab,durable),'');
  assert.ok(durable.getItem(DURABLE_SCENE_KEY));
  const reopened=new MatrixWorld();
  restoreStoredScene(reopened,loadStoredScene(storage(),durable));
  assert.deepEqual(reopened.scene,original.scene);
});

test('legacy tab storage migrates and can restore while AR is already open',()=>{
  const tab=storage(),durable=storage();
  const original=new MatrixWorld(()=> 'orb-one');
  original.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  tab.setItem(TAB_SCENE_KEY,JSON.stringify(original.scene));
  durable.setItem(DURABLE_SCENE_KEY,'{bad json');
  const scene=loadStoredScene(tab,durable);
  const reopened=new MatrixWorld();
  reopened.enterAR();
  restoreStoredScene(reopened,scene);
  assert.equal(reopened.scene.objects.length,1);
  assert.equal(reopened.scene.roomId.startsWith('webxr-session-'),true);
  reopened.leaveAR();
  assert.deepEqual(reopened.scene,original.scene);
  assert.equal(saveStoredScene(reopened.scene,tab,durable),'');
  assert.deepEqual(JSON.parse(durable.getItem(DURABLE_SCENE_KEY)),original.scene);
});

test('manual checkpoint restores virtual-floor objects in an AR session',()=>{
  const durable=storage();const world=new MatrixWorld(()=> 'checkpoint-object');
  world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  assert.equal(saveCheckpoint(world.scene,null,durable),'');
  world.enterAR();world.execute({requestId:'clear',op:'clear'});
  const checkpoint=loadCheckpoint(durable);
  restoreStoredScene(world,checkpoint.scene);
  assert.equal(world.scene.objects[0].objectId,'checkpoint-object');
});

test('version 2 saves and restores scene, bindings, score and win progress together',()=>{
  const tab=storage(),durable=storage(),original=new MatrixWorld(()=>crypto.randomUUID());
  const spec={kind:'game',title:'Orb Courier',summary:'Deliver two orbs.',
    roles:[{roleId:'orbs',kind:'pickup',assetId:'orb',count:2},
      {roleId:'zone',kind:'delivery-zone',assetId:'pedestal',count:1}],
    rules:[{event:'release-near',actorRoleId:'orbs',targetRoleId:'zone',distanceMeters:.6,scorePoints:4}],
    objectives:[{kind:'delivered-count',roleId:'orbs',targetCount:2},
      {kind:'score-at-least',targetPoints:8}]};
  startGame(original,spec);
  const game=original.game,target=original.requireObject(game.bindings.zone[0]);
  const id=game.bindings.orbs[0],transform=structuredClone(original.requireObject(id).transform);
  transform.position=structuredClone(target.transform.position);
  original.execute({requestId:'move',op:'set_transform',objectId:id,transform});
  assert.ok(deliverMovedObject(original,id));
  assert.equal(saveStoredWorld(storedWorld(original),tab,durable),'');
  assert.equal(JSON.parse(durable.getItem(WORLD_KEY)).version,2);
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,loadStoredWorld(storage(),durable).value);
  assert.deepEqual(reopened.scene,original.scene);
  assert.deepEqual(reopened.game,original.game);
  assert.equal(reopened.game.state.score,4);
  assert.equal(reopened.game.state.phase,'playing');
  const next=reopened.game.bindings.orbs[1],nextTransform=structuredClone(reopened.requireObject(next).transform);
  nextTransform.position=structuredClone(reopened.requireObject(reopened.game.bindings.zone[0]).transform.position);
  reopened.execute({requestId:'move-after-reload',op:'set_transform',objectId:next,transform:nextTransform});
  assert.ok(deliverMovedObject(reopened,next));
  assert.equal(reopened.game.state.score,8);
  assert.equal(reopened.game.state.phase,'won');
});

test('Citizens and scene restore together from a v3 browser world and manual checkpoint',()=>{
  const tab=storage(),durable=storage(),manual=storage();
  const original=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(original,{seed:29});
  for(let tick=0;tick<12;tick++)simulation.step();
  original.citizens=simulation.snapshot();
  const snapshot=storedWorld(original);
  assert.deepEqual(Object.keys(snapshot),['version','scene','game','citizens']);
  assert.equal(snapshot.version,3);
  assert.equal(saveStoredWorld(storedBrowserWorld(original),tab,durable),'');
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,loadStoredWorld(storage(),durable).value);
  assert.deepEqual(storedWorld(reopened),snapshot);
  assert.equal(reopened.citizens.clockTick,12);
  assert.equal(saveCheckpoint(snapshot.scene,snapshot.game,manual,'virtual',null,
    snapshot.citizens),'');
  const checkpoint=loadCheckpoint(manual);
  assert.equal(checkpoint.version,3);
  assert.deepEqual(checkpoint.citizens,snapshot.citizens);
  const manuallyRestored=new MatrixWorld();
  restoreStoredWorld(manuallyRestored,checkpoint);
  assert.deepEqual(storedWorld(manuallyRestored),snapshot);
});

test('v1 Citizens browser checkpoints migrate an in-flight reservation to v9',()=>{
  const original=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(original,{seed:17});
  simulation.step();original.citizens=simulation.snapshot();
  const legacy=storedWorld(original),state=legacy.citizens;
  state.schemaVersion=1;
  delete state.clockSpeed;
  delete state.actionSequence;delete state.retiredResidentIds;
  delete state.socialSession;delete state.socialEvents;
  delete state.relationships;delete state.nextSocialTick;
  for(const resident of state.residents){
    delete resident.needs.social;
    delete resident.preferences.converse;
    delete resident.socialSessionId;
    delete resident.routines;
    delete resident.lastDecision;
  }
  for(const resident of state.residents)if(resident.activity){
    delete resident.activity.executionId;
    delete resident.activity.routeRetries;
    delete resident.activity.routeGeometryId;
  }
  state.stations=state.stations.map(station=>({id:station.id,kind:station.kind,
    objectId:station.objectId,capacity:station.capacity,
    holder:station.claim?.residentId??null}));
  state.log=state.log.filter(entry=>['selected','blocked','arrived','completed',
    'failed','paused','resumed'].includes(entry.event));
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,legacy);
  assert.equal(reopened.citizens.schemaVersion,9);
  assert.equal(reopened.citizens.residents.find(resident=>resident.id==='ada')
    .activity.executionId,reopened.citizens.stations.find(station=>station.kind==='rest')
    .claim.executionId);
  const tab=storage(),durable=storage();
  assert.equal(saveStoredWorld(storedWorld(reopened),tab,durable),'');
  const again=new MatrixWorld();
  restoreStoredWorld(again,loadStoredWorld(storage(),durable).value);
  assert.deepEqual(storedWorld(again),storedWorld(reopened));
});

test('v2 Citizens browser checkpoints migrate without changing in-flight claims',()=>{
  const original=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(original,{seed:17});
  simulation.step();original.citizens=simulation.snapshot();
  const previous=storedWorld(original),state=previous.citizens;
  state.schemaVersion=2;
  delete state.clockSpeed;
  delete state.socialSession;delete state.socialEvents;
  delete state.relationships;delete state.nextSocialTick;
  for(const resident of state.residents){
    delete resident.needs.social;
    delete resident.preferences.converse;
    delete resident.socialSessionId;
    delete resident.routines;
    delete resident.lastDecision;
  }
  for(const resident of state.residents)if(resident.activity){
    delete resident.activity.routeRetries;
    delete resident.activity.routeGeometryId;
  }
  for(const station of state.stations)delete station.interaction;
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,previous);
  assert.equal(reopened.citizens.schemaVersion,9);
  assert.deepEqual(reopened.citizens.stations,state.stations.map(station=>
    ({...station,interaction:null})));
  assert.equal(reopened.citizens.residents[0].activity.executionId,
    state.residents[0].activity.executionId);
  assert.deepEqual(reopened.citizens.relationships,[{a:'ada',b:'bo',score:50,completed:[]}]);
});

test('the first Citizens deletion preserves the complete prior browser world for explicit recovery',()=>{
  const tab=storage(),durable=storage();
  const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(world,{seed:31});
  simulation.step();world.citizens=simulation.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  const before=durable.getItem(WORLD_KEY);
  const ada=world.citizens.residents.find(resident=>resident.id==='ada');
  assert.equal(world.execute({requestId:'delete-ada',op:'delete',
    objectId:ada.objectId}).ok,true);
  simulation.step();world.citizens=simulation.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  assert.equal(durable.getItem(CITIZENS_DELETION_RECOVERY_KEY),before);
  assert.deepEqual(loadCitizensDeletionRecovery(durable),JSON.parse(before));
  assert.deepEqual(world.citizens.retiredResidentIds,['ada']);
  assert.equal(JSON.parse(durable.getItem(WORLD_KEY)).citizens.residents.length,1);

  // Ordinary progress and a second deletion may update auto-saves, but never
  // replace the first pre-deletion recovery copy.
  simulation.step();world.citizens=simulation.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  const chair=world.citizens.stations.find(station=>station.kind==='rest');
  assert.equal(world.execute({requestId:'delete-chair',op:'delete',
    objectId:chair.objectId}).ok,true);
  simulation.step();world.citizens=simulation.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  assert.equal(durable.getItem(CITIZENS_DELETION_RECOVERY_KEY),before);
  assert.equal(world.citizens.stations.length,1);

  const restored=restoreCitizensDeletionRecovery(world,durable);
  assert.deepEqual(restored,JSON.parse(before));
  assert.equal(world.citizens.residents.length,2);
  assert.equal(world.citizens.stations.length,2);
  assert.ok(world.scene.objects.some(object=>object.objectId===ada.objectId));
  assert.deepEqual(storedWorld(world).scene,JSON.parse(before).scene);
});

test('explicit recovery plus durable commit rearms backup for a later deletion',()=>{
  const tab=storage(),durable=storage();
  const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(world,{seed:31});
  simulation.step();world.citizens=simulation.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  const firstBefore=durable.getItem(WORLD_KEY);
  const ada=world.citizens.residents.find(resident=>resident.id==='ada');
  assert.equal(world.execute({requestId:'delete-ada',op:'delete',
    objectId:ada.objectId}).ok,true);
  simulation.step();world.citizens=simulation.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  assert.equal(durable.getItem(CITIZENS_DELETION_RECOVERY_KEY),firstBefore);

  restoreCitizensDeletionRecovery(world,durable);
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'',
    'the explicit restore must be durably committed before clearing backup');
  assert.equal(clearCitizensDeletionRecovery(durable),true);
  assert.equal(loadCitizensDeletionRecovery(durable),null);
  const resumed=CitizensSimulation.restore(world,world.citizens);
  resumed.step();world.citizens=resumed.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  const secondBefore=durable.getItem(WORLD_KEY);
  assert.notEqual(secondBefore,firstBefore);
  const chair=world.citizens.stations.find(station=>station.kind==='rest');
  assert.equal(world.execute({requestId:'delete-chair',op:'delete',
    objectId:chair.objectId}).ok,true);
  resumed.step();world.citizens=resumed.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  assert.equal(durable.getItem(CITIZENS_DELETION_RECOVERY_KEY),secondBefore);
});

test('failed durable commit after explicit recovery retains its first backup',()=>{
  const tab=storage(),durable=storage();
  const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(world,{seed:31});
  simulation.step();world.citizens=simulation.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  const firstBefore=durable.getItem(WORLD_KEY);
  const ada=world.citizens.residents.find(resident=>resident.id==='ada');
  assert.equal(world.execute({requestId:'delete-ada',op:'delete',
    objectId:ada.objectId}).ok,true);
  simulation.step();world.citizens=simulation.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  restoreCitizensDeletionRecovery(world,durable);
  const noCommit={getItem:key=>durable.getItem(key),setItem:(key,value)=>{
    if(key===WORLD_KEY)throw Error('quota exceeded');
    durable.setItem(key,value);
  }};
  assert.match(saveStoredWorld(storedBrowserWorld(world),tab,noCommit),
    /Persistent browser save failed/);
  assert.equal(durable.getItem(CITIZENS_DELETION_RECOVERY_KEY),firstBefore,
    'a failed durable commit must keep explicit recovery available');
});

test('failed Citizens recovery write blocks both auto-saves and preserves the older world',()=>{
  const tab=storage(),durable=storage();
  const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(world,{seed:31});
  simulation.step();world.citizens=simulation.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  const oldDurable=durable.getItem(WORLD_KEY),oldTab=tab.getItem(TAB_WORLD_KEY);
  const ada=world.citizens.residents.find(resident=>resident.id==='ada');
  assert.equal(world.execute({requestId:'delete-ada',op:'delete',
    objectId:ada.objectId}).ok,true);
  simulation.step();world.citizens=simulation.snapshot();
  const noBackup={getItem:key=>durable.getItem(key),setItem:(key,value)=>{
    if(key===CITIZENS_DELETION_RECOVERY_KEY)throw Error('quota exceeded');
    durable.setItem(key,value);
  }};
  const warning=saveStoredWorld(storedBrowserWorld(world),tab,noBackup);
  assert.match(warning,/Citizens deletion recovery could not be preserved/);
  assert.match(warning,/Automatic browser saves were not updated/);
  assert.equal(durable.getItem(WORLD_KEY),oldDurable);
  assert.equal(tab.getItem(TAB_WORLD_KEY),oldTab);
  assert.equal(durable.getItem(CITIZENS_DELETION_RECOVERY_KEY),null);
});

test('a silent recovery write failure also blocks both browser copies',()=>{
  const tab=storage(),durable=storage();
  const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(world,{seed:31});
  simulation.step();world.citizens=simulation.snapshot();
  assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
  const oldDurable=durable.getItem(WORLD_KEY),oldTab=tab.getItem(TAB_WORLD_KEY);
  const chair=world.citizens.stations.find(station=>station.kind==='rest');
  assert.equal(world.execute({requestId:'delete-chair',op:'delete',
    objectId:chair.objectId}).ok,true);
  simulation.step();world.citizens=simulation.snapshot();
  const noWrite={getItem:key=>durable.getItem(key),setItem:(key,value)=>{
    if(key!==CITIZENS_DELETION_RECOVERY_KEY)durable.setItem(key,value);
  }};
  assert.match(saveStoredWorld(storedBrowserWorld(world),tab,noWrite),
    /recovery write could not be verified/);
  assert.equal(durable.getItem(WORLD_KEY),oldDurable);
  assert.equal(tab.getItem(TAB_WORLD_KEY),oldTab);
});

test('scene clear and scene load retire bindings through the same recovery gate',()=>{
  for(const op of ['clear','load']){
    const tab=storage(),durable=storage();
    const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
    const simulation=createCitizensDemo(world,{seed:31});
    simulation.step();world.citizens=simulation.snapshot();
    assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
    const before=durable.getItem(WORLD_KEY);
    const command={requestId:`${op}-citizens`,op,
      ...(op==='load'?{scene:new MatrixWorld().scene}:{})};
    assert.equal(world.execute(command).ok,true);
    simulation.reconcileWorld();world.citizens=simulation.snapshot();
    assert.equal(world.citizens.residents.length,0);
    assert.equal(world.citizens.stations.length,0);
    assert.equal(saveStoredWorld(storedBrowserWorld(world),tab,durable),'');
    assert.equal(durable.getItem(CITIZENS_DELETION_RECOVERY_KEY),before);
  }
});

test('Citizens deletion recovery load reports corruption and restore rejects invalid bindings',()=>{
  const durable=storage(),world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  assert.equal(loadCitizensDeletionRecovery(durable),null);
  durable.setItem(CITIZENS_DELETION_RECOVERY_KEY,'{bad');
  assert.throws(()=>loadCitizensDeletionRecovery(durable),/corrupt/);
  const simulation=createCitizensDemo(world,{seed:19});
  simulation.step();world.citizens=simulation.snapshot();
  const bad=storedBrowserWorld(world);
  bad.citizens.residents[0].objectId='missing-resident';
  durable.setItem(CITIZENS_DELETION_RECOVERY_KEY,JSON.stringify(bad));
  const current=new MatrixWorld();
  const before=storedWorld(current);
  assert.throws(()=>restoreCitizensDeletionRecovery(current,durable),/missing or incompatible/);
  assert.deepEqual(storedWorld(current),before,
    'rejected recovery must leave the active world unchanged');
});

test('invalid v3 Citizens bindings reject restore before changing the active world',()=>{
  const current=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(current,{seed:17});
  simulation.step();current.citizens=simulation.snapshot();
  const before=storedWorld(current),selection=structuredClone(current.selection),
    undo=structuredClone(current.undo),redo=structuredClone(current.redo);
  const bad=structuredClone(before);
  bad.citizens.residents[0].objectId='missing-resident';
  assert.throws(()=>restoreStoredWorld(current,bad),/missing or incompatible/);
  assert.deepEqual(storedWorld(current),before);
  assert.deepEqual(current.selection,selection);
  assert.deepEqual(current.undo,undo);
  assert.deepEqual(current.redo,redo);
  const missingSceneObject=structuredClone(before);
  missingSceneObject.scene.objects=missingSceneObject.scene.objects.filter(object=>
    object.objectId!==before.citizens.stations[0].objectId);
  assert.throws(()=>restoreStoredWorld(current,missingSceneObject),/missing or incompatible/);
  assert.deepEqual(storedWorld(current),before);
});

test('v2 restore clears active Citizens and v3 cannot silently save invalid bindings',()=>{
  const tab=storage(),durable=storage();
  const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(world,{seed:19});
  world.citizens=simulation.snapshot();
  assert.equal(saveStoredWorld(storedWorld(world),tab,durable),'');
  const validCopy=durable.getItem(WORLD_KEY);
  const residentId=world.citizens.residents[0].objectId;
  world.scene.objects=world.scene.objects.filter(object=>object.objectId!==residentId);
  assert.throws(()=>storedWorld(world),/missing or incompatible/);
  assert.equal(durable.getItem(WORLD_KEY),validCopy);
  const legacy=new MatrixWorld();
  restoreStoredWorld(world,storedWorld(legacy));
  assert.equal(world.citizens,null);
  assert.deepEqual(Object.keys(storedWorld(world)),['version','scene','game']);
  assert.equal(storedWorld(world).version,2);
  assert.equal(saveCheckpoint(world.scene,world.game,tab),'');
  assert.equal(loadCheckpoint(tab).version,2);
});

test('animated GLB physics saves authored state but needs a new verified run after restart or AR',()=>{
  const tab=storage(),durable=storage(),sha='f'.repeat(64);
  const asset={assetId:`web:restored-drop:${sha.slice(0,12)}`,displayName:'Animated drop',
    description:'Imported animated GLB',spawnScale:1,sha256:sha,byteLength:1024,
    url:`/api/web/assets/${sha}.glb`,geometry:{animationClips:[
      {name:'Flight',durationSeconds:1},{name:'Frost Burst',durationSeconds:1}]}};
  const transform={position:{x:0,y:2,z:-2},rotation:{x:0,y:0,z:0},
    scale:{x:1,y:1,z:1}};
  const animation={loopClip:'Flight',selectClip:'Frost Burst'};
  const physics={schemaVersion:1,kind:'gravity-floor',collider:'rendered-bounds-box',
    restitution:0};
  const measuredSize={x:1,y:1,z:1},objectId='restored-drop';
  const setPhysics=(world,requestId)=>world.execute({requestId,op:'set_physics',
    objectId,physics});
  const original=new MatrixWorld(()=>objectId);
  original.registerAssets([asset]);
  assert.equal(original.execute({requestId:'spawn',op:'spawn',assetId:asset.assetId,
    anchorId:'web-floor',transform}).ok,true);
  assert.equal(original.execute({requestId:'animate',op:'bind_animation',objectId,
    ...animation}).ok,true);
  assert.equal(original.verifyPhysicsAsset(asset.assetId,measuredSize,objectId),true);
  assert.equal(setPhysics(original,'first-run').ok,true);
  for(let frame=0;frame<90;frame++)original.advancePhysics(1/60);
  assert.equal(original.physicsState(objectId).status,'settled');
  assert.equal(original.physicsState(objectId).position.y,0);
  assert.equal(original.scene.objects[0].transform.position.y,2);

  assert.equal(saveStoredWorld(storedWorld(original),tab,durable),'');
  const saved=JSON.parse(durable.getItem(WORLD_KEY));
  assert.equal(saved.scene.objects[0].objectId,objectId);
  assert.deepEqual(saved.scene.objects[0].animation,animation);
  assert.deepEqual(saved.scene.objects[0].physics,physics);
  assert.equal(saved.scene.objects[0].transform.position.y,2);
  assert.equal(Object.hasOwn(saved,'physicsStates'),false);

  const reopened=new MatrixWorld();
  reopened.registerAssets([asset]); // Startup registers the catalog before restoring its objects.
  const restored=restoreBestStoredWorld(reopened,loadStoredWorld(storage(),durable),durable);
  assert.equal(restored.state,'restored');
  assert.deepEqual(reopened.scene,saved.scene);
  assert.deepEqual(reopened.snapshot().physicsStates,[]);
  assert.match(setPhysics(reopened,'before-verification').error,/verified/);
  reopened.advancePhysics(1);
  assert.equal(reopened.physicsState(objectId),null);
  assert.equal(reopened.scene.objects[0].transform.position.y,2);

  assert.equal(reopened.verifyPhysicsAsset(asset.assetId,measuredSize,objectId),true);
  assert.equal(setPhysics(reopened,'second-run').ok,true);
  assert.equal(reopened.physicsState(objectId).executionId,'second-run');
  for(let frame=0;frame<90;frame++)reopened.advancePhysics(1/60);
  assert.equal(reopened.physicsState(objectId).status,'settled');

  reopened.enterAR();
  assert.deepEqual(reopened.snapshot().physicsStates,[]);
  assert.match(setPhysics(reopened,'in-ar').error,/white room/);
  reopened.leaveAR();
  assert.deepEqual(reopened.scene.objects[0].animation,animation);
  assert.deepEqual(reopened.scene.objects[0].physics,physics);
  assert.equal(reopened.physicsState(objectId),null);
  assert.match(setPhysics(reopened,'after-ar').error,/verified/);
});

test('scene-only saves migrate without replacing Matrix object IDs',()=>{
  const tab=storage(),durable=storage(),original=new MatrixWorld(()=> 'kept-id');
  original.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  durable.setItem(DURABLE_SCENE_KEY,JSON.stringify(original.scene));
  const pending=loadStoredWorld(tab,durable);
  assert.equal(pending.value.version,2);
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,pending.value);
  assert.equal(reopened.scene.objects[0].objectId,'kept-id');
  assert.equal(reopened.game,null);
  assert.equal(saveStoredWorld(storedWorld(reopened),tab,durable),'');
  assert.ok(durable.getItem(WORLD_KEY));
});

test('dual-GLB Citizens world waits for both catalog entries and restores the exact saved state',()=>{
  const tab=storage(),durable=storage();
  let sequence=0;
  const original=new MatrixWorld(()=>`recovery-object-${++sequence}`);
  const simulation=createCitizensDemo(original,{seed:29});
  simulation.step();
  const assets=[
    {kind:'rest',name:'recovery-seat',sha256:'a'.repeat(64),
      bounds:{center:{x:0,y:.475,z:0},size:{x:.62,y:.95,z:.62}},
      approachZ:-.75,useZ:-.2,need:'energy',delta:22,durationTicks:7},
    {kind:'eat',name:'recovery-food',sha256:'b'.repeat(64),
      bounds:{center:{x:0,y:.4275,z:0},size:{x:1.2,y:.855,z:.8}},
      approachZ:-.9,useZ:-.28,need:'hunger',delta:32,durationTicks:5}
  ].map(item=>({
    ...item,asset:{assetId:`web:${item.name}:${item.sha256.slice(0,12)}`,
      displayName:item.name,description:'Static reviewed fixture',spawnScale:1,
      sha256:item.sha256,byteLength:1024,url:`/api/web/assets/${item.sha256}.glb`,
      localBounds:item.bounds,geometry:{animationClips:[]}}
  }));
  original.registerAssets(assets.map(item=>item.asset));
  const state=simulation.snapshot();
  for(const item of assets){
    const station=state.stations.find(candidate=>candidate.kind===item.kind);
    const object=original.requireObject(station.objectId);
    const interaction={schemaVersion:1,interactionId:`${item.name}-${item.kind}`,
      kind:item.kind,assetSha256:item.sha256,
      requiredCapabilities:['static-virtual-floor','verified-rendered-bounds'],
      availability:['target-static','floor-aligned','rendered-verified'],
      approachPose:{x:0,z:item.approachZ},usePose:{x:0,z:item.useZ},
      rangeMeters:.8,durationTicks:item.durationTicks,capacity:1,
      effect:{need:item.need,delta:item.delta}};
    object.assetId=item.asset.assetId;
    object.interaction=interaction;
    station.interaction=interaction;
  }
  original.citizens=state;
  const expected=storedWorld(original);
  assert.equal(saveStoredWorld(storedBrowserWorld(original),tab,durable),'');
  const browserCopy=durable.getItem(WORLD_KEY);
  const pending=loadStoredWorld(storage(),durable);
  const reopened=new MatrixWorld();
  const before=storedWorld(reopened);
  let result=restoreBestStoredWorld(reopened,pending,durable);
  assert.equal(result.state,'waiting');
  assert.deepEqual(result.missingAssets,assets.map(item=>item.asset.assetId).sort());
  assert.deepEqual(result.rejected,[]);
  assert.deepEqual(storedWorld(reopened),before);
  assert.equal(durable.getItem(WORLD_KEY),browserCopy);
  assert.equal(durable.getItem(QUARANTINE_KEY),null);

  reopened.registerAssets([assets[0].asset]);
  result=restoreBestStoredWorld(reopened,pending,durable);
  assert.equal(result.state,'waiting');
  assert.deepEqual(result.missingAssets,[assets[1].asset.assetId]);
  assert.deepEqual(storedWorld(reopened),before);
  reopened.registerAssets(assets.map(item=>item.asset));
  result=restoreBestStoredWorld(reopened,pending,durable);
  assert.equal(result.state,'restored');
  assert.deepEqual(storedWorld(reopened),expected);
  assert.equal(reopened.citizens.clockTick,1);
  assert.equal(durable.getItem(WORLD_KEY),browserCopy);
  assert.equal(durable.getItem(QUARANTINE_KEY),null);
});

test('newer asset-dependent browser save waits instead of restoring an older valid tab copy',()=>{
  const tab=storage(),durable=storage();
  const older=new MatrixWorld(()=> 'older-orb');
  assert.equal(older.execute({requestId:'older',op:'spawn',assetId:'orb',
    anchorId:'web-floor',transform:pose}).ok,true);
  assert.equal(saveStoredWorld(storedBrowserWorld(older),tab,durable),'');
  const olderCopy=tab.getItem(TAB_WORLD_KEY);
  const sha256='c'.repeat(64);
  const asset={assetId:`web:recovery-newer:${sha256.slice(0,12)}`,
    displayName:'Newer prop',description:'Static fixture',spawnScale:1,sha256,
    byteLength:1024,url:`/api/web/assets/${sha256}.glb`,
    localBounds:{center:{x:0,y:.5,z:0},size:{x:1,y:1,z:1}},
    geometry:{animationClips:[]}};
  const newer=new MatrixWorld(()=> 'newer-prop');
  newer.registerAssets([asset]);
  assert.equal(newer.execute({requestId:'newer',op:'spawn',assetId:asset.assetId,
    anchorId:'web-floor',transform:pose}).ok,true);
  const newest={...storedBrowserWorld(newer),
    savedAtMs:JSON.parse(olderCopy).savedAtMs+1};
  const newestCopy=JSON.stringify(newest);
  durable.setItem(WORLD_KEY,newestCopy);
  const pending=loadStoredWorld(tab,durable);
  assert.equal(pending.source,WORLD_KEY);
  const reopened=new MatrixWorld();
  const before=storedWorld(reopened);
  const waiting=restoreBestStoredWorld(reopened,pending,durable);
  assert.equal(waiting.state,'waiting');
  assert.deepEqual(waiting.missingAssets,[asset.assetId]);
  assert.deepEqual(waiting.rejected,[]);
  assert.deepEqual(storedWorld(reopened),before);
  assert.equal(tab.getItem(TAB_WORLD_KEY),olderCopy);
  assert.equal(durable.getItem(WORLD_KEY),newestCopy);
  assert.equal(durable.getItem(QUARANTINE_KEY),null);
  assert.throws(()=>restoreStoredWorld(reopened,pending.value),/Invalid scene object/);
  assert.deepEqual(storedWorld(reopened),before);
  reopened.registerAssets([asset]);
  assert.equal(restoreBestStoredWorld(reopened,pending,durable).state,'restored');
  assert.deepEqual(reopened.scene,newer.scene);
  assert.notDeepEqual(reopened.scene,older.scene);
});

test('a saved game referencing a Web pickup waits for its scene asset and restores its bindings',()=>{
  const tab=storage(),durable=storage(),sha256='d'.repeat(64);
  const asset={assetId:`web:recovery-game:${sha256.slice(0,12)}`,
    displayName:'Game pickup',description:'Static fixture',spawnScale:1,sha256,
    byteLength:1024,url:`/api/web/assets/${sha256}.glb`,
    localBounds:{center:{x:0,y:.5,z:0},size:{x:1,y:1,z:1}},
    geometry:{animationClips:[]}};
  const original=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  original.registerAssets([asset]);
  startGame(original,{kind:'game',title:'Recovered pickup',summary:'Return one pickup.',
    roles:[{roleId:'pickup',kind:'pickup',assetId:asset.assetId,count:1},
      {roleId:'zone',kind:'delivery-zone',assetId:'pedestal',count:1}],
    rules:[{event:'release-near',actorRoleId:'pickup',targetRoleId:'zone',
      distanceMeters:.6,scorePoints:1}],
    objectives:[{kind:'delivered-count',roleId:'pickup',targetCount:1}]});
  const expected=storedWorld(original);
  assert.equal(saveStoredWorld(storedBrowserWorld(original),tab,durable),'');
  const pending=loadStoredWorld(storage(),durable);
  const reopened=new MatrixWorld();
  assert.deepEqual(restoreBestStoredWorld(reopened,pending,durable).missingAssets,
    [asset.assetId]);
  assert.equal(durable.getItem(QUARANTINE_KEY),null);
  reopened.registerAssets([asset]);
  assert.equal(restoreBestStoredWorld(reopened,pending,durable).state,'restored');
  assert.deepEqual(storedWorld(reopened),expected);
  assert.deepEqual(reopened.game.bindings,original.game.bindings);
});

test('a game-only missing Web role with no matching scene object is invalid, not waiting',()=>{
  const tab=storage(),durable=storage();
  const older=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  startGame(older,{kind:'game',title:'Older game',summary:'Return one orb.',
    roles:[{roleId:'pickup',kind:'pickup',assetId:'orb',count:1},
      {roleId:'zone',kind:'delivery-zone',assetId:'pedestal',count:1}],
    rules:[{event:'release-near',actorRoleId:'pickup',targetRoleId:'zone',
      distanceMeters:.6,scorePoints:1}],
    objectives:[{kind:'delivered-count',roleId:'pickup',targetCount:1}]});
  assert.equal(saveStoredWorld(storedBrowserWorld(older),tab,durable),'');
  const olderCopy=tab.getItem(TAB_WORLD_KEY);
  const newer=structuredClone(JSON.parse(olderCopy));
  newer.savedAtMs++;
  newer.game.spec.roles[0].assetId='web:unplaced-game-role';
  const raw=JSON.stringify(newer);
  durable.setItem(WORLD_KEY,raw);
  const reopened=new MatrixWorld();
  const result=restoreBestStoredWorld(reopened,loadStoredWorld(tab,durable),durable);
  assert.equal(result.state,'restored');
  assert.equal(result.source,TAB_WORLD_KEY);
  assert.equal(result.rejected.length,1);
  assert.deepEqual(storedWorld(reopened),storedWorld(older));
  assert.equal(durable.getItem(QUARANTINE_KEY),raw);
});

test('an absent Web asset does not hide envelope, origin, room or earlier object corruption',()=>{
  for(const [label,corrupt] of [
    ['envelope',value=>{delete value.game;}],
    ['origin',value=>{value.originBinding='unsupported-origin';}],
    ['room',value=>{value.scene.roomId='another-room';}],
    ['object',value=>{value.scene.objects[0].objectId='';}],
    ['transform',value=>{value.scene.objects[0].transform.position.x=101;}],
    ['later transform',value=>{value.scene.objects.push({objectId:'bad-later',assetId:'orb',
      anchorId:'web-floor',transform:{...pose,position:{...pose.position,x:101}}});}]
  ]){
    const tab=storage(),durable=storage();
    const older=new MatrixWorld(()=> 'older-valid-orb');
    assert.equal(older.execute({requestId:'older',op:'spawn',assetId:'orb',
      anchorId:'web-floor',transform:pose}).ok,true);
    assert.equal(saveStoredWorld(storedBrowserWorld(older),tab,durable),'');
    const olderRaw=tab.getItem(TAB_WORLD_KEY);
    const newer=structuredClone(JSON.parse(olderRaw));
    newer.scene.objects=[{objectId:'missing-web-object',assetId:'web:temporarily-absent',
      anchorId:'web-floor',transform:structuredClone(pose)}];
    corrupt(newer);
    const raw=JSON.stringify(newer);
    const pending={value:newer,source:WORLD_KEY,raw,alternates:[
      {value:JSON.parse(olderRaw),source:TAB_WORLD_KEY,raw:olderRaw}]};
    const reopened=new MatrixWorld();
    const result=restoreBestStoredWorld(reopened,pending,durable);
    assert.equal(result.state,'restored',label);
    assert.equal(result.source,TAB_WORLD_KEY,label);
    assert.equal(result.rejected.length,1,label);
    assert.deepEqual(reopened.scene,older.scene,label);
    assert.equal(durable.getItem(QUARANTINE_KEY),raw,label);
  }
});

test('invalid saved world can be quarantined and subsequent edits persist',()=>{
  const tab=storage(),durable=storage(),current=new MatrixWorld();
  const invalid={version:2,scene:{schemaVersion:1,roomId:'web-virtual-room-v1',
    objects:[{objectId:'bad-transform',assetId:'orb',anchorId:'web-floor',
      transform:{...pose,position:{...pose.position,x:101}}}]},game:null};
  durable.setItem(WORLD_KEY,JSON.stringify(invalid));
  const pending=loadStoredWorld(tab,durable);
  assert.throws(()=>restoreStoredWorld(current,pending.value),/Invalid scene object/);
  quarantineStoredWorld(pending,durable);
  assert.ok(durable.getItem(QUARANTINE_KEY));
  assert.equal(saveStoredWorld(storedWorld(current),tab,durable),'');
  assert.deepEqual(loadStoredWorld(tab,durable).value.scene,current.scene);
});

test('durable storage failure remains explicit while tab recovery still works',()=>{
  const tab=storage(),failing={setItem(){throw Error('quota exceeded');}};
  const warning=saveStoredWorld(storedWorld(new MatrixWorld()),tab,failing);
  assert.match(warning,/Closing Quest Browser may lose this world/);
  assert.equal(loadStoredWorld(tab,storage()).value.version,2);
});

test('reload prefers the newer tab world after a durable write fails',()=>{
  const tab=storage(),durable=storage(),world=new MatrixWorld(()=>crypto.randomUUID());
  world.execute({requestId:'first',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  assert.equal(saveStoredWorld(storedWorld(world),tab,durable),'');
  world.execute({requestId:'second',op:'spawn',assetId:'chair',anchorId:'web-floor',transform:pose});
  const failing={getItem:key=>durable.getItem(key),setItem(){throw Error('quota exceeded');}};
  assert.match(saveStoredWorld(storedWorld(world),tab,failing),/Persistent browser save failed/);
  assert.equal(loadStoredWorld(tab,durable).source,TAB_WORLD_KEY);
  assert.equal(loadStoredWorld(tab,durable).value.scene.objects.length,2);
  assert.equal(loadStoredWorld(storage(),durable).value.scene.objects.length,1);
});

test('reload prefers the newer durable world after a tab write fails',()=>{
  const tab=storage(),durable=storage(),world=new MatrixWorld(()=>crypto.randomUUID());
  world.execute({requestId:'first',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  assert.equal(saveStoredWorld(storedWorld(world),tab,durable),'');
  world.execute({requestId:'second',op:'spawn',assetId:'chair',anchorId:'web-floor',transform:pose});
  const failing={getItem:key=>tab.getItem(key),setItem(){throw Error('tab quota exceeded');}};
  assert.match(saveStoredWorld(storedWorld(world),failing,durable),/Tab world save failed/);
  const pending=loadStoredWorld(tab,durable);
  assert.equal(pending.source,WORLD_KEY);
  assert.equal(pending.value.scene.objects.length,2);
  assert.equal(loadStoredWorld(tab,storage()).value.scene.objects.length,1);
});

test('malformed tab envelope falls back to the durable world',()=>{
  const tab=storage(),durable=storage(),world=new MatrixWorld();
  assert.equal(saveStoredWorld(storedWorld(world),tab,durable),'');
  tab.setItem(TAB_WORLD_KEY,JSON.stringify({version:2,scene:null,game:null,savedAtMs:Date.now()+1000}));
  assert.equal(loadStoredWorld(tab,durable).source,WORLD_KEY);
});

test('both failed browser writes report both missing copies',()=>{
  const failing={getItem(){return null;},setItem(){throw Error('storage unavailable');}};
  const warning=saveStoredWorld(storedWorld(new MatrixWorld()),failing,failing);
  assert.match(warning,/Persistent browser save failed/);
  assert.match(warning,/Tab world save failed/);
});

test('an invalid newest world is quarantined before restoring the older valid copy',()=>{
  const tab=storage(),durable=storage(),original=new MatrixWorld(()=> 'kept-object');
  original.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  assert.equal(saveStoredWorld(storedWorld(original),tab,durable),'');
  const newest=JSON.parse(durable.getItem(WORLD_KEY));
  newest.savedAtMs++;
  newest.scene.objects[0].transform.position.x=101;
  const raw=JSON.stringify(newest);
  durable.setItem(WORLD_KEY,raw);
  const pending=loadStoredWorld(tab,durable);
  assert.equal(pending.source,WORLD_KEY);
  const reopened=new MatrixWorld();
  const result=restoreBestStoredWorld(reopened,pending,durable);
  assert.equal(result.state,'restored');
  assert.equal(result.source,TAB_WORLD_KEY);
  assert.equal(result.rejected.length,1);
  assert.deepEqual(reopened.scene,original.scene);
  assert.equal(durable.getItem(QUARANTINE_KEY),raw);
  assert.equal(saveStoredWorld(storedWorld(reopened),tab,durable),'');
  assert.equal(durable.getItem(QUARANTINE_KEY),raw,'new saves do not overwrite the rejected raw copy');
});

test('failed quarantine blocks recovery before either browser copy is overwritten',()=>{
  const tab=storage(),durable=storage(),world=new MatrixWorld();
  assert.equal(saveStoredWorld(storedWorld(world),tab,durable),'');
  const invalid=JSON.parse(durable.getItem(WORLD_KEY));
  invalid.savedAtMs++;
  invalid.scene.objects=[{objectId:'bad-transform',assetId:'orb',anchorId:'web-floor',
    transform:{...pose,position:{...pose.position,x:101}}}];
  durable.setItem(WORLD_KEY,JSON.stringify(invalid));
  const before=durable.getItem(WORLD_KEY);
  const noSpace={getItem:key=>durable.getItem(key),setItem(){throw Error('quota exceeded');}};
  const result=restoreBestStoredWorld(new MatrixWorld(),loadStoredWorld(tab,durable),noSpace);
  assert.equal(result.state,'blocked');
  assert.equal(durable.getItem(WORLD_KEY),before);
  assert.equal(durable.getItem(QUARANTINE_KEY),null);
});

test('two invalid browser worlds get separate recovery copies',()=>{
  const tab=storage(),durable=storage(),base=storedWorld(new MatrixWorld());
  const invalid=objectId=>({...base,scene:{...base.scene,objects:[
    {objectId,assetId:'orb',anchorId:'web-floor',
      transform:{...pose,position:{...pose.position,x:101}}}]}});
  tab.setItem(TAB_WORLD_KEY,JSON.stringify({...invalid('corrupt-old'),savedAtMs:1}));
  durable.setItem(WORLD_KEY,JSON.stringify({...invalid('corrupt-new'),savedAtMs:2}));
  const result=restoreBestStoredWorld(new MatrixWorld(),loadStoredWorld(tab,durable),durable);
  assert.equal(result.state,'invalid');
  assert.equal(result.rejected.length,2);
  assert.equal(JSON.parse(durable.getItem(QUARANTINE_KEY)).scene.objects[0].objectId,'corrupt-new');
  assert.equal(JSON.parse(durable.getItem(QUARANTINE_BACKUP_KEY)).scene.objects[0].objectId,'corrupt-old');
});

test('checkpoint restore clears selection missing from the restored scene, including after leaving AR',()=>{
  const world=new MatrixWorld(()=> 'later-object');
  const checkpoint=storedWorld(world);
  world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  world.setSelection('later-object',pose.position);
  world.enterAR();
  restoreStoredWorld(world,checkpoint);
  assert.equal(world.selection.objectId,'');
  assert.equal(world.selection.anchorId,'web-floor');
  world.leaveAR();
  assert.equal(world.selection.objectId,'');
  assert.equal(world.snapshot().scene.objects.length,0);
});

test('New Chat clears only conversation state',()=>{
  const tab=storage(),current=new MatrixWorld(()=> 'kept-id');
  current.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  const before=storedWorld(current);
  const history=rememberTurn(tab,[],'Create an orb','Done');
  assert.equal(history.length,1);
  assert.deepEqual(clearConversation(tab),[]);
  assert.deepEqual(storedWorld(current),before);
});
