import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {recordGameEvent} from '../src/game.js';
import {createRigidPhysics} from '../src/physics_rigid.js';
import {storedBrowserWorld,saveStoredWorld,loadStoredWorld,restoreStoredWorld,
  WORLD_KEY,TAB_WORLD_KEY} from '../src/scene_store.js';
import {startNewWorld,restoreWorldArchive,worldArchives,WORLD_ARCHIVES_KEY,
  WORLD_ARCHIVE_PAGE_SIZE,executeWorldSlotCommand}
  from '../src/world_slots.js';

function storage(){
  const values=new Map();
  let failOnce=null,silentOnce=null;
  return {getItem:key=>values.get(key)??null,
    setItem(key,value){
      if(failOnce===key){failOnce=null;throw Error(`Simulated ${key} failure`);}
      if(silentOnce===key){silentOnce=null;return;}
      values.set(key,String(value));
    },removeItem:key=>values.delete(key),
    failNext:key=>{failOnce=key;},silentNext:key=>{silentOnce=key;}};
}
const pose=(x=0,z=0)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
let request=0;
function accept(world,op,fields={}){
  const receipt=world.execute({requestId:`world-slot-${++request}`,op,...fields});
  assert.equal(receipt.ok,true,receipt.error);
  return receipt.objectId;
}
function completedWorld(){
  let object=0;
  const world=new MatrixWorld(()=>`slot-object-${++object}`);
  const actors=[0,1,2].map(()=>accept(world,'spawn',{
    assetId:'orb',anchorId:'web-floor',transform:pose(0,1)}));
  const zone=accept(world,'spawn',{assetId:'pedestal',anchorId:'web-floor',
    transform:pose(0,1)});
  const exit=accept(world,'spawn',{assetId:'wall',anchorId:'web-floor',
    transform:pose(2,1)});
  const extra=accept(world,'spawn',{assetId:'chair',anchorId:'web-floor',
    transform:pose(-3,1)});
  accept(world,'bind_game',{spec:{schemaVersion:2,kind:'game',title:'Orb Course',
    summary:'Deliver three orbs.',roles:[
      {roleId:'orbs',kind:'pickup',assetId:'orb',count:3},
      {roleId:'zone',kind:'delivery-zone',assetId:'pedestal',count:1},
      {roleId:'exit',kind:'exit',assetId:'wall',count:1}],
    rules:[{event:'release-near',actorRoleId:'orbs',targetRoleId:'zone',
      distanceMeters:.75,scorePoints:10}],
    objectives:[{kind:'delivered-count',roleId:'orbs',targetCount:3}],
    consequences:[{kind:'unlock',roleId:'exit'}]},
  bindings:{orbs:actors,zone:[zone],exit:[exit]}});
  for(const [index,id] of actors.entries()){
    const outcome=recordGameEvent(world,{eventId:`slot-earned-${index}`,
      event:'release-near',objectId:id,targetObjectId:zone});
    assert.equal(outcome?.credited,true);
  }
  assert.equal(world.game.state.phase,'won');
  return {world,actors,exit,extra};
}

function guardedCommand(world,op,fields={}){
  const snapshot=world.snapshot();
  return {requestId:`typed-slot-${++request}`,op,
    expectedScene:snapshot.scene,expectedGame:snapshot.game,
    expectedCreatorRevision:snapshot.creatorMode.revision,
    expectedGravity:snapshot.rigidGravity,
    expectedCitizensState:snapshot.citizensState,
    expectedCitizensGeneration:snapshot.citizensObservation?.authoredGeneration??null,
    ...fields};
}

test('world archives retain control progress outside authored scene history',()=>{
  let serial=0;
  const world=new MatrixWorld(()=>`slot-control-${++serial}`),tab=storage(),durable=storage();
  const target=accept(world,'spawn',{assetId:'block',anchorId:'web-floor',transform:pose(0,-3)});
  const panel=accept(world,'spawn',{assetId:'wall',anchorId:'web-floor',transform:pose(3,-3)});
  world.requireObject(panel).control={schemaVersion:1,label:'Change block scale',
    action:{kind:'cycle-values',channel:'transform.scale',targetObjectId:target,
      values:[[1,1,1],[2,3,4]]}};
  world.requireObject(target).transform.scale={x:2,y:3,z:4};
  world.controlStates[panel]={index:1,revision:7};
  const before=storedBrowserWorld(world);
  assert.equal(saveStoredWorld(before,tab,durable),'');
  const created=startNewWorld(world,tab,durable,'Controlled exhibit');
  assert.equal(Object.keys(world.controlStates).length,0);
  restoreWorldArchive(world,created.archived.archiveId,tab,durable,'Blank room');
  assert.deepEqual(storedBrowserWorld(world),before);
  assert.deepEqual(world.controlStates[panel],{index:1,revision:7});
  assert.deepEqual(world.requireObject(target).transform.scale,{x:2,y:3,z:4});
});

test('typed world switches preserve completed progress and return bounded receipts',()=>{
  const tab=storage(),durable=storage();
  const {world,actors,exit}=completedWorld();
  const original=storedBrowserWorld(world);
  assert.equal(world.snapshot().worldSlotSchemaVersion,1);
  assert.equal(saveStoredWorld(original,tab,durable),'');
  const created=executeWorldSlotCommand(world,guardedCommand(world,'start_new_world',
    {archiveName:'Original course'}),tab,durable);
  assert.deepEqual(Object.keys(created).sort(),['archived','kind']);
  assert.equal(created.kind,'world-created');
  assert.equal(world.scene.objects.length,0);
  const restored=executeWorldSlotCommand(world,guardedCommand(world,
    'restore_world_archive',{archiveId:created.archived.archiveId,
      archiveName:'Empty exhibit'}),tab,durable);
  assert.equal(restored.kind,'world-restored');
  assert.equal(restored.restored.archiveId,created.archived.archiveId);
  assert.deepEqual(storedBrowserWorld(world),original);
  assert.deepEqual(world.game.bindings.orbs,actors);
  assert.deepEqual(world.game.state.unlockedObjectIds,[exit]);
  assert.equal(Object.hasOwn(restored,'current'),false,
    'a full saved world must not leak into an Operator receipt');
});

test('stale typed world preconditions fail before archive or active-world mutation',()=>{
  const tab=storage(),durable=storage();
  const {world}=completedWorld();
  const before=storedBrowserWorld(world);
  assert.equal(saveStoredWorld(before,tab,durable),'');
  const base=guardedCommand(world,'start_new_world',{archiveName:'Keep course'});
  const stale=[
    [{expectedScene:{...base.expectedScene,objects:[]}},/Scene changed/],
    [{expectedGame:null},/Game progress changed/],
    [{expectedCreatorRevision:base.expectedCreatorRevision+1},/Creator Mode changed/],
    [{expectedGravity:{x:0,y:-5,z:0}},/Gravity changed/],
    [{expectedCitizensState:{paused:true}},/Citizens progress changed/],
    [{expectedCitizensGeneration:9},/Citizens scene changed/],
  ];
  for(const [changes,error] of stale){
    assert.throws(()=>executeWorldSlotCommand(world,{...base,...changes},tab,durable),error);
    assert.deepEqual(storedBrowserWorld(world),before);
    assert.equal(worldArchives(durable).length,0);
  }
  assert.throws(()=>executeWorldSlotCommand(world,
    {...base,expectedCitizensState:undefined},tab,durable),/Citizens progress changed/);
  assert.equal(durable.getItem(WORLD_ARCHIVES_KEY),null);
});

test('typed switch notices changed Citizens clock even when authored generation is stable',()=>{
  const tab=storage(),durable=storage();
  const world=new MatrixWorld();
  world.citizens={paused:false,clockMinute:5};
  const command=guardedCommand(world,'start_new_world',{archiveName:'Citizens world'});
  assert.equal(command.expectedCitizensGeneration,null);
  world.citizens={paused:false,clockMinute:6};
  assert.throws(()=>executeWorldSlotCommand(world,command,tab,durable),
    /Citizens progress changed/);
  assert.equal(world.citizens.clockMinute,6);
  assert.equal(durable.getItem(WORLD_ARCHIVES_KEY),null);
});

test('archive metadata is paged and does not expose saved worlds',()=>{
  const tab=storage(),durable=storage();
  const world=new MatrixWorld();
  const saved=storedBrowserWorld(world);
  const archives=Array.from({length:WORLD_ARCHIVE_PAGE_SIZE+3},(_,index)=>({
    schemaVersion:1,archiveId:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
    name:`Exhibit ${index}`,createdAtUtc:'2026-09-26T00:00:00.000Z',world:saved}));
  durable.setItem(WORLD_ARCHIVES_KEY,JSON.stringify(archives));
  const first=executeWorldSlotCommand(world,{op:'list_world_archives'},tab,durable);
  assert.equal(first.kind,'world-archives');
  assert.equal(first.archives.length,WORLD_ARCHIVE_PAGE_SIZE);
  assert.equal(first.nextOffset,WORLD_ARCHIVE_PAGE_SIZE);
  assert.equal(first.total,WORLD_ARCHIVE_PAGE_SIZE+3);
  assert.equal(Object.hasOwn(first.archives[0],'world'),false);
  const second=executeWorldSlotCommand(world,
    {op:'list_world_archives',offset:first.nextOffset},tab,durable);
  assert.equal(second.archives.length,3);
  assert.equal(second.nextOffset,null);
  assert.throws(()=>executeWorldSlotCommand(world,
    {op:'list_world_archives',offset:-1},tab,durable),/nonnegative integer/);
});

test('completed world archives before a fresh world and restores exact IDs and progress',()=>{
  const tab=storage(),durable=storage();
  const {world,actors,exit,extra}=completedWorld();
  const original=storedBrowserWorld(world);
  assert.equal(saveStoredWorld(original,tab,durable),'');
  const result=startNewWorld(world,tab,durable,'Orb playground');
  assert.equal(world.scene.objects.length,0);
  assert.equal(world.game,null);
  assert.equal(world.creatorMode.mode,'creator');
  assert.equal(world.creatorMode.simulation,'paused');
  assert.equal(worldArchives(durable).length,1);
  assert.deepEqual(worldArchives(durable)[0].world,original);
  const archivedId=result.archived.archiveId;
  const restored=restoreWorldArchive(world,archivedId,tab,durable,'Empty exhibit');
  assert.equal(restored.restored.archiveId,archivedId);
  assert.deepEqual(storedBrowserWorld(world),original);
  assert.deepEqual(world.game.bindings.orbs,actors);
  assert.deepEqual(world.game.state.unlockedObjectIds,[exit]);
  assert.ok(world.scene.objects.some(item=>item.objectId===extra));
  assert.equal(worldArchives(durable).length,2);
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,loadStoredWorld(storage(),durable).value);
  assert.deepEqual(storedBrowserWorld(reopened),original);
});

test('archive write and readback failures leave the completed world and browser copies intact',()=>{
  for(const kind of ['throw','silent']){
    const tab=storage(),durable=storage();
    const {world}=completedWorld();
    const before=storedBrowserWorld(world);
    assert.equal(saveStoredWorld(before,tab,durable),'');
    const oldTab=tab.getItem(TAB_WORLD_KEY),oldDurable=durable.getItem(WORLD_KEY);
    if(kind==='throw')durable.failNext(WORLD_ARCHIVES_KEY);
    else durable.silentNext(WORLD_ARCHIVES_KEY);
    assert.throws(()=>startNewWorld(world,tab,durable,'Keep this world'),/World switch stopped/);
    assert.deepEqual(storedBrowserWorld(world),before);
    assert.equal(tab.getItem(TAB_WORLD_KEY),oldTab);
    assert.equal(durable.getItem(WORLD_KEY),oldDurable);
    assert.equal(worldArchives(durable).length,0);
  }
});

test('an un-restorable live scene is never recorded as a verified archive',()=>{
  const tab=storage(),durable=storage();
  const world=new MatrixWorld(()=> 'broken-object');
  const objectId=accept(world,'spawn',{assetId:'chair',anchorId:'web-floor',
    transform:pose(0,0)});
  world.scene.objects.find(item=>item.objectId===objectId).assetId='missing-asset';
  const before=structuredClone(world.scene);
  assert.throws(()=>startNewWorld(world,tab,durable,'Broken'),/World switch stopped/);
  assert.deepEqual(world.scene,before);
  assert.equal(worldArchives(durable).length,0);
  assert.equal(durable.getItem(WORLD_KEY),null);
});

test('active-save failure rolls back world and copies while retaining the verified archive',()=>{
  const tab=storage(),durable=storage();
  const {world}=completedWorld();
  const verified=world.scene.objects[0];
  world.renderedVerification.set(verified.objectId,{object:verified,
    signature:'rendered',measuredSize:{x:1,y:1,z:1}});
  const before=storedBrowserWorld(world);
  assert.equal(saveStoredWorld(before,tab,durable),'');
  const oldTab=tab.getItem(TAB_WORLD_KEY),oldDurable=durable.getItem(WORLD_KEY);
  durable.failNext(WORLD_KEY);
  assert.throws(()=>startNewWorld(world,tab,durable,'Recoverable world'),
    /active world was restored/);
  assert.deepEqual(storedBrowserWorld(world),before);
  assert.equal(world.renderedVerification.get(verified.objectId).object,
    world.scene.objects[0],'rollback retains renderer verification identity');
  assert.equal(tab.getItem(TAB_WORLD_KEY),oldTab);
  assert.equal(durable.getItem(WORLD_KEY),oldDurable);
  assert.deepEqual(worldArchives(durable)[0].world,before);
});

test('paused Creator Mode and complete AR archival are required',()=>{
  const tab=storage(),durable=storage();
  const {world}=completedWorld();
  world.creatorMode={schemaVersion:1,mode:'play',simulation:'running',revision:1};
  assert.throws(()=>startNewWorld(world,tab,durable,'Course'),/paused Creator Mode/);
  assert.equal(worldArchives(durable).length,0);
  world.creatorMode={schemaVersion:1,mode:'creator',simulation:'paused',revision:2};
  world.enterAR();
  world.scene.objects.push({...world.scene.objects[0],objectId:'physical-object',
    anchorId:'room-plane'});
  assert.throws(()=>startNewWorld(world,tab,durable,'Course'),/physical AR objects/);
  assert.equal(worldArchives(durable).length,0);
});

test('AR virtual-floor world switches retain origin provenance and roll back safely',()=>{
  const tab=storage(),durable=storage();
  const {world}=completedWorld();
  world.enterAR();
  world.originBinding='ar';world.originAnchorHandle='saved-room-handle';
  const original=storedBrowserWorld(world);
  assert.equal(saveStoredWorld(original,tab,durable),'');
  const beforeScene=structuredClone(world.scene);
  const beforeVirtual=structuredClone(world.virtualScene);
  durable.failNext(WORLD_KEY);
  assert.throws(()=>startNewWorld(world,tab,durable,'AR playground'),
    /active world was restored/);
  assert.deepEqual(world.scene,beforeScene);
  assert.deepEqual(world.virtualScene,beforeVirtual);
  assert.deepEqual(storedBrowserWorld(world),original);
  const next=startNewWorld(world,tab,durable,'AR playground');
  assert.equal(world.scene.objects.length,0);
  assert.equal(world.originBinding,'ar');
  restoreWorldArchive(world,next.archived.archiveId,tab,durable,'AR empty world');
  assert.deepEqual(storedBrowserWorld(world),original);
});

test('failed new-world persistence restores the moving rigid solver state',async()=>{
  const tab=storage(),durable=storage();
  const world=new MatrixWorld(()=> 'moving-orb');
  world.attachRigidPhysics(await createRigidPhysics());
  try{
    const objectId=accept(world,'spawn',{assetId:'orb',anchorId:'web-floor',
      transform:{...pose(0,0),position:{x:0,y:3,z:0}}});
    accept(world,'set_rigid_body',{objectId,rigidBody:{schemaVersion:1,
      type:'dynamic',collider:'bounds-box',restitution:0,friction:.8,sensor:false}});
    for(let frame=0;frame<12;frame++)world.advanceRigidPhysics(1/60);
    const before=world.rigidPhysics.snapshot();
    const original=storedBrowserWorld(world);
    assert.equal(saveStoredWorld(original,tab,durable),'');
    durable.failNext(WORLD_KEY);
    assert.throws(()=>startNewWorld(world,tab,durable,'Moving world'),
      /active world was restored/);
    assert.deepEqual(world.rigidPhysics.snapshot(),before);
    assert.deepEqual(storedBrowserWorld(world),original);
  }finally{world.rigidPhysics.dispose();}
});
