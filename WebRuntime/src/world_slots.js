import {validSavedGame} from './game.js';
import {MatrixWorld} from './protocol.js';
import {storedBrowserWorld,restoreStoredWorld,saveStoredWorld,
  WORLD_KEY,TAB_WORLD_KEY} from './scene_store.js';

// Ordinary world switching is separate from lost-AR-origin recovery archives.
// This collection never evicts an older world to make room for another one.
export const WORLD_ARCHIVES_KEY='matrix-web-world-archives-v1';
export const WORLD_ARCHIVE_PAGE_SIZE=32;
const archiveName=value=>{
  if(typeof value!=='string'||!value.trim()||value.trim().length>80||
     /[\x00-\x1f]/.test(value))throw Error('Enter an archive name up to 80 characters');
  return value.trim();
};
const validEnvelope=value=>value&&typeof value==='object'&&
  (value.version===2||value.version===3)&&value.scene&&
  typeof value.scene==='object'&&Object.hasOwn(value,'game')&&
  Array.isArray(value.scene.objects)&&
  (value.version===2?!Object.hasOwn(value,'citizens'):
    value.citizens&&typeof value.citizens==='object');

export function worldArchives(storage){
  const raw=storage.getItem(WORLD_ARCHIVES_KEY);
  if(raw===null)return [];
  let archives;
  try{archives=JSON.parse(raw);}
  catch{throw Error('World archive index is invalid; preserve browser data for recovery');}
  const ids=new Set();
  if(!Array.isArray(archives)||!archives.every(item=>{
    if(item?.schemaVersion!==1||typeof item.archiveId!=='string'||
       !/^[0-9a-f-]{36}$/i.test(item.archiveId)||ids.has(item.archiveId)||
       typeof item.name!=='string'||!item.name.trim()||item.name.length>80||
       typeof item.createdAtUtc!=='string'||!validEnvelope(item.world))return false;
    ids.add(item.archiveId);return true;
  }))throw Error('World archive index is invalid; preserve browser data for recovery');
  return archives;
}

export function worldArchiveSummaries(storage){
  return worldArchives(storage).map(({archiveId,name,createdAtUtc,world})=>({
    archiveId,name,createdAtUtc,objectCount:world.scene.objects.length,
    gameTitle:world.game?.spec?.title||''}));
}

const sameJson=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

export function assertWorldSlotPreconditions(world,command){
  for(const field of ['expectedScene','expectedGame','expectedCreatorRevision',
    'expectedGravity','expectedCitizensState','expectedCitizensGeneration'])
    if(!Object.hasOwn(command,field))
      throw Error(`World switch requires ${field} from the inspected browser snapshot`);
  if(command.expectedCreatorRevision!==world.creatorMode?.revision)
    throw Error('Creator Mode changed since the world switch was queued');
  if(!sameJson(command.expectedScene,world.scene))
    throw Error('Scene changed since the world switch was queued');
  if(!sameJson(command.expectedGame,world.game))
    throw Error('Game progress changed since the world switch was queued');
  if(!sameJson(command.expectedGravity,world.rigidGravity))
    throw Error('Gravity changed since the world switch was queued');
  if(!sameJson(command.expectedCitizensState,world.citizens??null))
    throw Error('Citizens progress changed since the world switch was queued');
  const generation=world.snapshot().citizensObservation?.authoredGeneration??null;
  if(command.expectedCitizensGeneration!==generation)
    throw Error('Citizens scene changed since the world switch was queued');
}

// The Operator receives bounded metadata only. Full world copies stay in the
// browser's verified archive store and are never returned in a receipt.
export function executeWorldSlotCommand(world,command,tabStorage,durableStorage){
  if(command.op==='list_world_archives'){
    const offset=command.offset??0;
    if(!Number.isSafeInteger(offset)||offset<0)
      throw Error('World archive offset must be a nonnegative integer');
    const archives=worldArchiveSummaries(durableStorage);
    const page=archives.slice(offset,offset+WORLD_ARCHIVE_PAGE_SIZE).map(item=>({
      archiveId:item.archiveId,
      name:item.name,
      createdAtUtc:item.createdAtUtc,
      objectCount:item.objectCount,
      gameTitle:typeof item.gameTitle==='string'?item.gameTitle.slice(0,80):''}));
    return {kind:'world-archives',archives:page,offset,total:archives.length,
      nextOffset:offset+page.length<archives.length?offset+page.length:null};
  }
  if(command.op!=='start_new_world'&&command.op!=='restore_world_archive')
    throw Error('Unknown browser world slot operation');
  assertWorldSlotPreconditions(world,command);
  const result=command.op==='start_new_world'?
    startNewWorld(world,tabStorage,durableStorage,command.archiveName):
    restoreWorldArchive(world,command.archiveId,tabStorage,durableStorage,
      command.archiveName);
  return {kind:command.op==='start_new_world'?'world-created':'world-restored',
    archived:result.archived,...(result.restored?{restored:result.restored}:{})};
}

function requireSafeSwitch(world){
  if(world.digitalWorldVisit)
    throw Error('Leave the digital world AR visit before switching worlds');
  if(world.pendingRigidMotion&&!world.rigidPhysics)
    throw Error('Wait for rigid simulation to restore before switching worlds');
  if(world.creatorMode?.mode!=='creator'||world.creatorMode.simulation!=='paused')
    throw Error('Return to paused Creator Mode before switching worlds');
  if(world.spatial?.originUnavailable||world.spatial?.stale)
    throw Error('Recover the room origin or tracking before switching worlds');
  if(world.spatial&&world.scene.objects.some(item=>item.anchorId!=='web-floor'))
    throw Error('Session-only physical AR objects cannot be archived as a world');
  if(world.agentGrab||world.rigidPhysics?.states().some(state=>state.held))
    throw Error('Release grabbed objects before switching worlds');
  if(world.game&&!validSavedGame(world.game,world.scene,id=>!!world.asset(id)))
    throw Error('Repair the active game before archiving or switching worlds');
}

function runtimeCopy(world){
  // Clone related fields together: renderedVerification.object must retain its
  // identity relationship with the matching object in scene after rollback.
  const state=structuredClone({scene:world.scene,game:world.game,
    citizens:world.citizens??null,selection:world.selection,
    virtualScene:world.virtualScene,
    originBinding:world.originBinding,originAnchorHandle:world.originAnchorHandle,
    arEntryContent:world.arEntryContent,undo:world.undo,
    redo:world.redo,creatorMode:world.creatorMode,
    controlStates:world.controlStates,
    rigidGravity:world.rigidGravity,
    pendingRigidMotion:world.pendingRigidMotion,
    physicsBodies:world.physicsBodies,
    physicsVerification:world.physicsVerification,
    renderedVerification:world.renderedVerification,
    authoredGeneration:world.authoredGeneration});
  return {...state,rigidSnapshot:world.rigidPhysics?.snapshot()??null};
}

function restoreRuntime(world,copy){
  for(const key of ['scene','game','citizens','selection','virtualScene','originBinding',
    'originAnchorHandle','arEntryContent','undo','redo','creatorMode','controlStates','rigidGravity',
    'pendingRigidMotion',
    'physicsBodies','physicsVerification','renderedVerification','authoredGeneration'])
    world[key]=copy[key];
  world.physicsSceneReference=world.scene;
  if(world.rigidPhysics&&copy.rigidSnapshot){
    world.rigidPhysics.restore(copy.rigidSnapshot);
    world.rigidSceneReference=world.scene;
  }
}

function restoreStorage(storage,key,raw){
  if(raw===null)storage.removeItem(key);
  else storage.setItem(key,raw);
  if(storage.getItem(key)!==raw)throw Error(`${key} could not be rolled back`);
}

function verifiedActiveCopy(storage,key,expected){
  let value;
  try{value=JSON.parse(storage.getItem(key));}
  catch{throw Error(`${key} could not be read after switching`);}
  if(!Number.isSafeInteger(value?.savedAtMs))
    throw Error(`${key} did not contain a verified world save`);
  const {savedAtMs,...saved}=value;
  if(JSON.stringify(saved)!==expected)
    throw Error(`${key} did not retain the selected world`);
}

function appendArchive(world,storage,name){
  const archives=worldArchives(storage);
  const archiveId=crypto.randomUUID();
  if(archives.some(item=>item.archiveId===archiveId))
    throw Error('World archive ID collision; retry switching worlds');
  const snapshot=storedBrowserWorld(world);
  const staged=new MatrixWorld();
  staged.externalAssets=world.externalAssets;
  staged.environmentAssets=world.environmentAssets;
  restoreStoredWorld(staged,snapshot);
  const archive={schemaVersion:1,archiveId,name:archiveName(name),
    createdAtUtc:new Date().toISOString(),world:snapshot};
  const serialized=JSON.stringify([...archives,archive]);
  storage.setItem(WORLD_ARCHIVES_KEY,serialized);
  if(storage.getItem(WORLD_ARCHIVES_KEY)!==serialized)
    throw Error('Full-world archive could not be verified');
  return archive;
}

function switchWorld(world,next,tabStorage,durableStorage,name){
  requireSafeSwitch(world);
  const before=runtimeCopy(world);
  const oldTab=tabStorage.getItem(TAB_WORLD_KEY);
  const oldDurable=durableStorage.getItem(WORLD_KEY);
  let archive=null;
  try{
    archive=appendArchive(world,durableStorage,name);
    restoreStoredWorld(world,next);
    world.resetAROriginBaseline?.();
    const selected=storedBrowserWorld(world);
    const warning=saveStoredWorld(selected,tabStorage,durableStorage);
    if(warning)throw Error(warning);
    const expected=JSON.stringify(selected);
    verifiedActiveCopy(durableStorage,WORLD_KEY,expected);
    verifiedActiveCopy(tabStorage,TAB_WORLD_KEY,expected);
    return {archived:{archiveId:archive.archiveId,name:archive.name},
      current:structuredClone(selected)};
  }catch(error){
    const rollback=[];
    try{restoreRuntime(world,before);}
    catch(failure){rollback.push(`runtime rollback failed: ${failure.message}`);}
    try{restoreStorage(tabStorage,TAB_WORLD_KEY,oldTab);}
    catch(failure){rollback.push(failure.message);}
    try{restoreStorage(durableStorage,WORLD_KEY,oldDurable);}
    catch(failure){rollback.push(failure.message);}
    throw Error(`World switch stopped: ${error.message}. ${rollback.length?
      `Recovery needs attention (${rollback.join('; ')}).`:
      'The active world was restored.'}${archive?
      ` A verified archive remains as ${archive.name}.`:''}`);
  }
}

export function startNewWorld(world,tabStorage,durableStorage,name){
  if(world.digitalWorldVisit)
    throw Error('Leave the digital world AR visit before switching worlds');
  const source=world.spatial?world.virtualScene?.scene:world.scene;
  if(!source)throw Error('The virtual world is unavailable');
  const empty={version:2,scene:{schemaVersion:source.schemaVersion,
    roomId:source.roomId,objects:[]},game:null,
    originBinding:world.spatial?'ar':'virtual',
    ...(world.spatial&&world.originAnchorHandle?
      {originAnchorHandle:world.originAnchorHandle}:{})};
  return switchWorld(world,empty,tabStorage,durableStorage,name);
}

export function restoreWorldArchive(world,archiveId,tabStorage,durableStorage,name){
  const target=worldArchives(durableStorage).find(item=>item.archiveId===archiveId);
  if(!target)throw Error('Choose an existing world archive');
  return {...switchWorld(world,target.world,tabStorage,durableStorage,name),
    restored:{archiveId:target.archiveId,name:target.name}};
}
