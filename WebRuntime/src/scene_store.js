// Browser-local recovery. One versioned envelope contains the whole supported world.
import {validSavedGame} from './game.js';
import {CitizensSimulation} from './citizens.js';
import {listProceduralGenerators} from './procedural.js';
import {createCreatorMode,restoredCreatorMode} from './creator_mode.js';
import {validateControlStates} from './protocol.js';
import {RigidPhysics,eulerDegreesToQuaternion} from './physics_rigid.js';
export const TAB_SCENE_KEY='matrix-web-scene';
export const DURABLE_SCENE_KEY='matrix-web-scene-v1';
export const WORLD_KEY='matrix-web-world-v2';
export const TAB_WORLD_KEY='matrix-web-world-tab-v2';
export const CHECKPOINT_KEY='matrix-web-checkpoint-v2';
export const QUARANTINE_KEY='matrix-web-world-rejected-v2';
export const QUARANTINE_BACKUP_KEY='matrix-web-world-rejected-backup-v2';
export const CITIZENS_DELETION_RECOVERY_KEY='matrix-web-citizens-pre-deletion-v1';
let lastSavedAtMs=0;

const savedAt=value=>Number.isSafeInteger(value?.savedAtMs)&&
  value.savedAtMs>=0&&value.savedAtMs<Number.MAX_SAFE_INTEGER-1?value.savedAtMs:0;
const validEnvelope=value=>value&&value.scene&&typeof value.scene==='object'&&
  Object.hasOwn(value,'game')&&
  (value.version===2?!Object.hasOwn(value,'citizens'):
    value.version===3&&Object.hasOwn(value,'citizens')&&value.citizens!==null&&
      typeof value.citizens==='object'&&!Array.isArray(value.citizens));

function retiresCitizensBinding(previous,next){
  if(previous?.version!==3||next?.version!==3)return false;
  const prior=previous.citizens,current=next.citizens;
  if(!Array.isArray(prior?.residents)||!Array.isArray(current?.residents)||
    !Array.isArray(prior?.stations)||!Array.isArray(current?.stations))return false;
  const residentIds=new Set(current.residents.map(resident=>resident.id));
  const stationIds=new Set(current.stations.map(station=>station.id));
  return prior.residents.length>current.residents.length&&
      prior.residents.some(resident=>!residentIds.has(resident.id))||
    prior.stations.length>current.stations.length&&
      prior.stations.some(station=>!stationIds.has(station.id));
}

function validateCitizensRecovery(value){
  if(!validEnvelope(value)||value.version!==3)
    throw Error('Citizens deletion recovery copy is invalid');
  // The backup is always a virtual scene. Validate its Citizens bindings
  // without touching the active Matrix world or relying on a live simulation.
  CitizensSimulation.restore({scene:value.scene,spatial:null,execute(){}},value.citizens);
}

function preserveCitizensDeletionRecovery(previous,storage){
  const existing=storage.getItem(CITIZENS_DELETION_RECOVERY_KEY);
  if(existing!==null){
    const value=JSON.parse(existing);
    validateCitizensRecovery(value);
    return;
  }
  if(!previous?.raw)
    throw Error('the prior full world is unavailable');
  validateCitizensRecovery(previous.value);
  storage.setItem(CITIZENS_DELETION_RECOVERY_KEY,previous.raw);
  if(storage.getItem(CITIZENS_DELETION_RECOVERY_KEY)!==previous.raw)
    throw Error('Citizens deletion recovery write could not be verified');
}

// Citizens validates against a staged virtual scene. Neither save preflight nor
// restore preflight may replace the active Matrix scene to check object bindings.
function checkedCitizens(world,scene,state){
  const staged=Object.create(world);
  staged.scene=scene;
  staged.spatial=null;
  return CitizensSimulation.restore(staged,state).snapshot();
}

const motionVector=value=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')==='x,y,z'&&
  ['x','y','z'].every(axis=>typeof value[axis]==='number'&&
    Number.isFinite(value[axis])&&Math.abs(value[axis])<=100);
const motionRotation=value=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')==='w,x,y,z'&&
  ['x','y','z','w'].every(axis=>typeof value[axis]==='number'&&
    Number.isFinite(value[axis])&&Math.abs(value[axis])<=1.01)&&
  Math.abs(Math.hypot(value.x,value.y,value.z,value.w)-1)<.001;

function checkedRigidMotion(scene,value){
  if(value===undefined)return null; // Older whole-world envelopes have no motion.
  const dynamic=scene.objects.filter(object=>object.rigidBody?.type==='dynamic');
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).sort().join(',')!=='bodies,schemaVersion'||
     value.schemaVersion!==1||!Array.isArray(value.bodies)||
     value.bodies.length!==dynamic.length||value.bodies.length>32)
    throw Error('Invalid saved rigid motion');
  const objects=new Map(dynamic.map(object=>[object.objectId,object]));
  const seen=new Set();
  for(const body of value.bodies){
    if(!body||typeof body!=='object'||Array.isArray(body)||
       Object.keys(body).sort().join(',')!==
         'angularVelocity,linearVelocity,objectId,position,rotation,sleeping'||
       typeof body.objectId!=='string'||!objects.has(body.objectId)||
       seen.has(body.objectId)||!motionVector(body.position)||
       !motionRotation(body.rotation)||!motionVector(body.linearVelocity)||
       !motionVector(body.angularVelocity)||typeof body.sleeping!=='boolean'||
       body.sleeping&&[...Object.values(body.linearVelocity),
         ...Object.values(body.angularVelocity)].some(number=>number!==0))
      throw Error('Invalid saved rigid motion body');
    const transform=objects.get(body.objectId).transform;
    const authored=eulerDegreesToQuaternion(transform.rotation);
    const dot=Math.abs(authored.x*body.rotation.x+authored.y*body.rotation.y+
      authored.z*body.rotation.z+authored.w*body.rotation.w);
    if(['x','y','z'].some(axis=>Math.abs(transform.position[axis]-body.position[axis])>.01)||
       dot<.99999)throw Error('Saved rigid motion pose differs from its scene object');
    seen.add(body.objectId);
  }
  return structuredClone(value);
}

function capturedRigidMotion(world,scene){
  const dynamic=scene.objects.filter(object=>object.rigidBody?.type==='dynamic');
  if(!dynamic.length)return null;
  if(!world.rigidPhysics){
    if(world.pendingRigidMotion)return checkedRigidMotion(scene,world.pendingRigidMotion);
    throw Error('Rigid simulation is still loading; moving bodies cannot be saved yet');
  }
  if(world.rigidSceneReference!==world.scene)
    throw Error('Rigid simulation is out of sync with the scene');
  const ids=new Set(dynamic.map(object=>object.objectId));
  const states=world.rigidPhysics.states().filter(state=>ids.has(state.objectId));
  if(states.some(state=>state.held)||world.agentGrab)
    throw Error('Release grabbed rigid bodies before saving the world');
  const bodies=states.map(({objectId,position,rotation,linearVelocity,
    angularVelocity,sleeping})=>({objectId,position,rotation,linearVelocity,
    angularVelocity,sleeping})).sort((a,b)=>a.objectId.localeCompare(b.objectId));
  return checkedRigidMotion(scene,{schemaVersion:1,bodies});
}

export function storedWorld(world){
  const scene=world.spatial&&!world.digitalWorldVisit?{...world.virtualScene.scene,
    objects:world.scene.objects.filter(object=>object.anchorId==='web-floor')}:world.scene;
  const savedScene=structuredClone(scene),game=structuredClone(world.game);
  const rigidMotion=capturedRigidMotion(world,savedScene);
  const additions={
    ...(rigidMotion?{rigidMotion}:{}),
    ...(world.creatorMode&&JSON.stringify(world.creatorMode)!==JSON.stringify(createCreatorMode())?
      {creatorMode:structuredClone(world.creatorMode)}:{}),
    ...(world.rigidGravity&&JSON.stringify(world.rigidGravity)!==
      JSON.stringify({x:0,y:-9.81,z:0})?{rigidGravity:structuredClone(world.rigidGravity)}:{}),
    ...(savedScene.objects.some(object=>object.control)?{
      controlSchemaVersion:1,
      controlStates:validateControlStates(world.controlStates,savedScene)}:{})};
  if(world.citizens==null)return {version:2,scene:savedScene,game,...additions};
  const citizens=checkedCitizens(world,savedScene,world.citizens);
  return {version:3,scene:savedScene,game,citizens,...additions};
}

// Keep browser-only origin provenance out of PC world checkpoints, whose
// scene/game/Citizens envelope is intentionally renderer-neutral and exact.
export function storedBrowserWorld(world){
  world.markAROriginIfChanged();
  return {...storedWorld(world),originBinding:world.originBinding,
    ...(world.originBinding==='ar'&&world.originAnchorHandle?
      {originAnchorHandle:world.originAnchorHandle}:{})};
}

export function saveStoredWorld(value,tabStorage,durableStorage){
  let json,latest;
  try{
    if(!validEnvelope(value))throw Error('Invalid world save envelope');
    if(Object.hasOwn(value,'rigidMotion'))checkedRigidMotion(value.scene,value.rigidMotion);
    latest=loadStoredWorld(tabStorage,durableStorage);
    lastSavedAtMs=Math.max(lastSavedAtMs,savedAt(latest?.value));
    lastSavedAtMs=Math.max(Date.now(),lastSavedAtMs+1);
    json=JSON.stringify({...value,savedAtMs:lastSavedAtMs});
  }
  catch(error){return `World could not be serialized: ${error.message}. Closing Quest Browser may lose this world.`;}
  if(retiresCitizensBinding(latest?.value,value)){
    try{preserveCitizensDeletionRecovery(latest,durableStorage);}
    catch(error){return `Citizens deletion recovery could not be preserved: ${error.message}. Automatic browser saves were not updated.`;}
  }
  const warnings=[];
  try{durableStorage.setItem(WORLD_KEY,json);}
  catch(error){warnings.push(`Persistent browser save failed: ${error.message}. Closing Quest Browser may lose this world.`);}
  try{tabStorage.setItem(TAB_WORLD_KEY,json);}
  catch(error){warnings.push(`Tab world save failed: ${error.message}`);}
  return warnings.join('\n');
}

export function loadStoredWorld(tabStorage,durableStorage){
  let rejected=null;
  const candidates=[];
  for(const [storage,key] of [[tabStorage,TAB_WORLD_KEY],[durableStorage,WORLD_KEY]]){
    try{
      const raw=storage.getItem(key);
      if(raw){
        try{
          const value=JSON.parse(raw);
          if(validEnvelope(value))candidates.push({value,source:key,raw});
          else rejected||={value:null,source:key,raw};
        }catch{rejected||={value:null,source:key,raw};}
      }
    }catch{ /* Unavailable storage must not block the other copy. */ }
  }
  if(candidates.length){
    candidates.sort((left,right)=>savedAt(right.value)-savedAt(left.value));
    return {...candidates[0],alternates:candidates.slice(1)};
  }
  const scene=loadStoredScene(tabStorage,durableStorage);
  return scene?{value:{version:2,scene,game:null},source:'scene-only',raw:JSON.stringify(scene)}:rejected;
}

export function loadCitizensDeletionRecovery(storage){
  let raw;
  try{raw=storage.getItem(CITIZENS_DELETION_RECOVERY_KEY);}
  catch(error){throw Error(`Could not read Citizens deletion recovery: ${error.message}`);}
  if(raw===null)return null;
  let value;
  try{value=JSON.parse(raw);}
  catch{throw Error('Citizens deletion recovery copy is corrupt');}
  validateCitizensRecovery(value);
  return value;
}

export function restoreCitizensDeletionRecovery(world,storage){
  const value=loadCitizensDeletionRecovery(storage);
  if(value===null)throw Error('No Citizens deletion recovery copy is available');
  restoreStoredWorld(world,value);
  return value;
}

// Call only after the explicitly restored world has been saved durably. Until
// then the first pre-deletion copy remains available even if that save fails.
export function clearCitizensDeletionRecovery(storage){
  try{
    storage.removeItem(CITIZENS_DELETION_RECOVERY_KEY);
    if(storage.getItem(CITIZENS_DELETION_RECOVERY_KEY)!==null)
      throw Error('removal could not be verified');
    return true;
  }catch(error){throw Error(`Could not clear Citizens deletion recovery: ${error.message}`);}
}

export function quarantineStoredWorld(pending,storage,index=0){
  const key=index===0?QUARANTINE_KEY:QUARANTINE_BACKUP_KEY;
  try{
    storage.setItem(key,pending.raw);
    return storage.getItem(key)===pending.raw;
  }catch{return false;}
}

function missingExternalAssets(world,value){
  const sceneObjects=Array.isArray(value?.scene?.objects)?value.scene.objects:[];
  const gameRoles=Array.isArray(value?.game?.spec?.roles)?value.game.spec.roles:[];
  return [...new Set([...sceneObjects,...gameRoles]
    .map(item=>item?.assetId)
    .filter(id=>typeof id==='string'&&id.startsWith('web:')&&!world.asset(id)))].sort();
}

class MissingWebAssetsError extends Error {
  constructor(ids){
    super(`Saved world is waiting for catalog assets: ${ids.join(', ')}`);
    this.missingAssets=ids;
  }
}

class MissingProceduralGeneratorError extends Error {
  constructor(ids){
    super(`Saved world is waiting for reviewed procedural generators: ${ids.join(', ')}`);
    this.missingGenerators=ids;
  }
}

function requireProceduralGenerators(scene){
  const available=new Set(listProceduralGenerators().map(item=>
    `${item.generatorId}@${item.generatorVersion}:${item.sourceRevision}`));
  const missing=[...new Set((scene.objects||[]).filter(item=>item?.procedural)
    .map(item=>item.procedural).filter(recipe=>!available.has(
      `${recipe.generatorId}@${recipe.generatorVersion}:${recipe.sourceRevision}`))
    .map(recipe=>`${recipe.generatorId}@${recipe.generatorVersion}:${recipe.sourceRevision}`))];
  if(missing.length)throw new MissingProceduralGeneratorError(missing.sort());
}

function validateSavedScene(world,scene,value){
  // Use MatrixWorld's validator without changing the active world. Its normal
  // checks run in order; only an actual lookup of an absent Web asset signals
  // a recoverable catalog dependency.
  const validationWorld=Object.create(world);
  requireProceduralGenerators(scene);
  validationWorld.asset=id=>{
    const asset=world.asset(id);
    if(!asset&&typeof id==='string'&&id.startsWith('web:'))
      throw new MissingWebAssetsError(missingExternalAssets(world,value));
    return asset;
  };
  world.validateScene.call(validationWorld,scene);
}

export function restoreBestStoredWorld(world,pending,storage){
  const rejected=[];
  for(const candidate of [pending,...(pending.alternates||[])]){
    try{
      restoreStoredWorld(world,candidate.value,{waitForWebAssets:true});
      return {state:'restored',source:candidate.source,rejected};
    }catch(error){
      if(error instanceof MissingWebAssetsError)
        return {state:'waiting',source:candidate.source,
          missingAssets:error.missingAssets,reason:error.message,rejected};
      if(error instanceof MissingProceduralGeneratorError)
        return {state:'waiting',source:candidate.source,
          missingGenerators:error.missingGenerators,reason:error.message,rejected};
      if(!quarantineStoredWorld(candidate,storage,rejected.length))
        return {state:'blocked',reason:`Could not preserve rejected ${candidate.source} before recovery: ${error.message}`,
          rejected};
      rejected.push({source:candidate.source,error:error.message});
    }
  }
  return {state:'invalid',rejected};
}

export function restoreStoredWorld(world,value,{waitForWebAssets=false}={}){
  if(world.digitalWorldVisit)
    throw Error('Leave the digital world AR visit before restoring a world');
  if(world.spatial?.originUnavailable)
    throw Error('Saved room origin is unavailable; recover it before replacing the active world');
  if(world.agentGrab||world.rigidPhysics?.states().some(state=>state.held))
    throw Error('Release grabbed rigid bodies before restoring a world');
  if(!validEnvelope(value))throw Error('Invalid world save envelope');
  const binding=value.originBinding===undefined?
    (value.scene.objects?.length||value.game!==null?'unknown':'virtual'):value.originBinding;
  if(!['virtual','ar','unknown'].includes(binding))throw Error('Invalid world origin binding');
  const anchorHandle=value.originAnchorHandle??null;
  if(anchorHandle!==null&&(binding!=='ar'||typeof anchorHandle!=='string'||!anchorHandle))
    throw Error('Invalid world origin anchor handle');
  if(world.spatial&&hasSavedWorldContent(value)&&binding==='unknown')
    throw Error('Saved world has an unverified room origin; restore it in VR before rebasing');
  if(world.spatial&&binding==='ar'&&hasSavedWorldContent(value)&&
     (!anchorHandle||anchorHandle!==world.originAnchorHandle))
    throw Error('Saved world belongs to a different or unverified room origin');
  // Validate every layer before changing the active world. A Citizens snapshot
  // names scene objects, so it is checked against the saved virtual scene.
  const savedScene=structuredClone(value.scene);
  requireProceduralGenerators(savedScene);
  const scene=world.spatial?{...savedScene,roomId:world.scene.roomId}:savedScene;
  if(waitForWebAssets)validateSavedScene(world,scene,value);
  else world.validateScene(scene);
  if(value.game!==null&&!validSavedGame(value.game,scene,id=>!!world.asset(id))){
    if(waitForWebAssets){
      const missing=missingExternalAssets(world,value);
      const missingSet=new Set(missing);
      if(missing.length&&validSavedGame(value.game,scene,
        id=>!!world.asset(id)||missingSet.has(id)))
        throw new MissingWebAssetsError(missing);
    }
    throw Error('Saved game bindings or progress are invalid');
  }
  const game=structuredClone(value.game);
  const citizens=value.version===3?checkedCitizens(world,savedScene,value.citizens):null;
  const creatorMode=restoredCreatorMode(value.creatorMode);
  const gravity=value.rigidGravity??{x:0,y:-9.81,z:0};
  if(!gravity||!['x','y','z'].every(axis=>typeof gravity[axis]==='number'&&
      Number.isFinite(gravity[axis]))||
      Math.hypot(gravity.x,gravity.y,gravity.z)>30)
    throw Error('Invalid saved rigid gravity');
  if(Object.hasOwn(value,'controlSchemaVersion')&&value.controlSchemaVersion!==1||
     Object.hasOwn(value,'controlStates')&&!Object.hasOwn(value,'controlSchemaVersion')||
     Object.hasOwn(value,'controlSchemaVersion')&&!Object.hasOwn(value,'controlStates'))
    throw Error('Invalid saved control state schema');
  const controlStates=validateControlStates(value.controlStates,savedScene);
  const rigidMotion=checkedRigidMotion(savedScene,value.rigidMotion);
  let rigidSnapshot=null;
  if(world.rigidPhysics){
    // Build the candidate in a separate Rapier world before touching the active
    // scene. This also checks generated colliders and the saved motion together.
    const staged=Object.create(world);
    staged.scene=scene;staged.rigidGravity=gravity;
    staged.rigidPhysics=new RigidPhysics(gravity);
    try{
      staged.rebuildRigidPhysics({preserve:false,motion:rigidMotion});
      rigidSnapshot=staged.rigidPhysics.snapshot();
    }finally{staged.rigidPhysics.dispose();}
  }
  const previous={scene:world.scene,virtualScene:world.virtualScene?.scene,
    virtualSelection:world.virtualScene?.selection,
    selection:world.selection,game:world.game,citizens:world.citizens,
    creatorMode:world.creatorMode,rigidGravity:world.rigidGravity,
    controlStates:world.controlStates,pendingRigidMotion:world.pendingRigidMotion,
    agentGrab:world.agentGrab,
    originBinding:world.originBinding,originAnchorHandle:world.originAnchorHandle,
    undo:world.undo,redo:world.redo,authoredGeneration:world.authoredGeneration,
    rigidSceneReference:world.rigidSceneReference,
    rigidSnapshot:world.rigidPhysics?.snapshot()??null};
  try{
    restoreStoredScene(world,savedScene);
    world.game=game;
    world.citizens=citizens;
    world.creatorMode=creatorMode;
    world.rigidGravity=structuredClone(gravity);
    world.controlStates=controlStates;
    world.pendingRigidMotion=world.rigidPhysics?null:rigidMotion;
    if(rigidSnapshot){
      world.rigidPhysics.restore(rigidSnapshot);
      world.rigidSceneReference=world.scene;
      world.agentGrab=null;
    }
    world.originBinding=world.spatial&&world.originBinding==='ar'?'ar':binding;
    world.originAnchorHandle=world.spatial&&world.originBinding==='ar'&&binding!=='ar'?
      world.originAnchorHandle:anchorHandle;
    world.undo=[];world.redo=[];
  }catch(error){
    world.scene=previous.scene;
    if(world.virtualScene){
      world.virtualScene.scene=previous.virtualScene;
      world.virtualScene.selection=previous.virtualSelection;
    }
    world.selection=previous.selection;world.game=previous.game;
    world.citizens=previous.citizens;world.creatorMode=previous.creatorMode;
    world.rigidGravity=previous.rigidGravity;world.controlStates=previous.controlStates;
    world.pendingRigidMotion=previous.pendingRigidMotion;
    world.agentGrab=previous.agentGrab;
    world.originBinding=previous.originBinding;
    world.originAnchorHandle=previous.originAnchorHandle;
    world.undo=previous.undo;world.redo=previous.redo;
    world.authoredGeneration=previous.authoredGeneration;
    if(world.rigidPhysics&&previous.rigidSnapshot)
      world.rigidPhysics.restore(previous.rigidSnapshot);
    world.rigidSceneReference=previous.rigidSceneReference;
    throw error;
  }
}

const hasSavedWorldContent=value=>value.scene.objects?.length>0||value.game!==null||
  value.citizens!=null;

export function saveCheckpoint(scene,game,storage,originBinding,originAnchorHandle,
  citizens=null,creatorMode=undefined,rigidGravity=undefined,controlStates=undefined,
  rigidMotion=undefined){
  try{
    if(scene.objects.some(object=>object.rigidBody?.type==='dynamic')&&!rigidMotion)
      throw Error('Moving-body state is required for a new world checkpoint');
    storage.setItem(CHECKPOINT_KEY,JSON.stringify({version:citizens==null?2:3,scene,game,
    ...(citizens==null?{}:{citizens}),
    ...(creatorMode&&JSON.stringify(creatorMode)!==JSON.stringify(createCreatorMode())?
      {creatorMode}:{}),
    ...(rigidGravity&&JSON.stringify(rigidGravity)!==JSON.stringify({x:0,y:-9.81,z:0})?
      {rigidGravity}:{}),
    ...(scene.objects.some(object=>object.control)?{
      controlSchemaVersion:1,controlStates:validateControlStates(controlStates,scene)}:{}),
    ...(rigidMotion?{rigidMotion:checkedRigidMotion(scene,rigidMotion)}:{}),
    ...(originBinding?{originBinding}:{}),
    ...(originBinding==='ar'&&originAnchorHandle?{originAnchorHandle}:{})}));return '';}
  catch(error){return `World checkpoint could not be saved: ${error.message}`;}
}

export function loadCheckpoint(storage){
  try{
    const value=JSON.parse(storage.getItem(CHECKPOINT_KEY)||'null');
    if(validEnvelope(value))return value;
  }catch{ /* Try the legacy scene-only checkpoint. */ }
  try{
    const legacy=JSON.parse(storage.getItem('matrix-web-checkpoint-v1')||'null');
    return legacy?.scene?{version:2,scene:legacy.scene,game:null}:null;
  }catch{return null;}
}

export function loadStoredScene(tabStorage,durableStorage){
  for(const [storage,key] of [[durableStorage,DURABLE_SCENE_KEY],[tabStorage,TAB_SCENE_KEY]]){
    try{
      const raw=storage.getItem(key);
      if(raw){const scene=JSON.parse(raw);if(scene&&typeof scene==='object')return scene;}
    }catch{ /* A corrupt or unavailable store must not block the other one. */ }
  }
  return null;
}

export function saveStoredScene(scene,tabStorage,durableStorage){
  const json=JSON.stringify(scene);
  let warning='';
  try{durableStorage.setItem(DURABLE_SCENE_KEY,json);}
  catch(error){warning=`Persistent browser save failed: ${error.message}`;}
  try{tabStorage.setItem(TAB_SCENE_KEY,json);}
  catch(error){warning=warning||`Tab scene save failed: ${error.message}`;}
  return warning;
}

export function restoreStoredScene(world,scene){
  if(world.digitalWorldVisit)
    throw Error('Leave the digital world AR visit before restoring a scene');
  if(world.spatial){
    // A virtual-room save has the stable room ID. The active AR session has a
    // different temporary room ID, so validate the same objects in that frame.
    const arScene={...structuredClone(scene),roomId:world.scene.roomId};
    world.validateScene(arScene);
    world.virtualScene.scene=structuredClone(scene);
    world.scene=arScene;
  }else{
    world.validateScene(scene);
    world.scene=structuredClone(scene);
  }
  // A restored scene may no longer contain the previously selected object.
  // Keep both the active and suspended virtual-room selections valid.
  world.selection={anchorId:'web-floor',objectId:'',position:{x:0,y:0,z:-2}};
  if(world.virtualScene)world.virtualScene.selection=structuredClone(world.selection);
  world.markAuthoredSceneChange?.();
}
