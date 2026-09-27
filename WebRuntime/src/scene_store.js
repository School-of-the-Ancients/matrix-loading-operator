// Browser-local recovery. One versioned envelope contains the whole supported world.
import {validSavedGame} from './game.js';
import {CitizensSimulation} from './citizens.js';
export const TAB_SCENE_KEY='matrix-web-scene';
export const DURABLE_SCENE_KEY='matrix-web-scene-v1';
export const WORLD_KEY='matrix-web-world-v2';
export const TAB_WORLD_KEY='matrix-web-world-tab-v2';
export const CHECKPOINT_KEY='matrix-web-checkpoint-v2';
export const QUARANTINE_KEY='matrix-web-world-rejected-v2';
export const QUARANTINE_BACKUP_KEY='matrix-web-world-rejected-backup-v2';
let lastSavedAtMs=0;

const savedAt=value=>Number.isSafeInteger(value?.savedAtMs)&&
  value.savedAtMs>=0&&value.savedAtMs<Number.MAX_SAFE_INTEGER-1?value.savedAtMs:0;
const validEnvelope=value=>value&&value.scene&&typeof value.scene==='object'&&
  Object.hasOwn(value,'game')&&
  (value.version===2?!Object.hasOwn(value,'citizens'):
    value.version===3&&Object.hasOwn(value,'citizens')&&value.citizens!==null&&
      typeof value.citizens==='object'&&!Array.isArray(value.citizens));

// Citizens validates against a staged virtual scene. Neither save preflight nor
// restore preflight may replace the active Matrix scene to check object bindings.
function checkedCitizens(world,scene,state){
  const staged=Object.create(world);
  staged.scene=scene;
  staged.spatial=null;
  return CitizensSimulation.restore(staged,state).snapshot();
}

export function storedWorld(world){
  const scene=world.spatial?{...world.virtualScene.scene,
    objects:world.scene.objects.filter(object=>object.anchorId==='web-floor')}:world.scene;
  const savedScene=structuredClone(scene),game=structuredClone(world.game);
  if(world.citizens==null)return {version:2,scene:savedScene,game};
  const citizens=checkedCitizens(world,savedScene,world.citizens);
  return {version:3,scene:savedScene,game,citizens};
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
  let json;
  try{
    if(!validEnvelope(value))throw Error('Invalid world save envelope');
    const latest=loadStoredWorld(tabStorage,durableStorage);
    lastSavedAtMs=Math.max(lastSavedAtMs,savedAt(latest?.value));
    lastSavedAtMs=Math.max(Date.now(),lastSavedAtMs+1);
    json=JSON.stringify({...value,savedAtMs:lastSavedAtMs});
  }
  catch(error){return `World could not be serialized: ${error.message}. Closing Quest Browser may lose this world.`;}
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

export function quarantineStoredWorld(pending,storage,index=0){
  const key=index===0?QUARANTINE_KEY:QUARANTINE_BACKUP_KEY;
  try{
    storage.setItem(key,pending.raw);
    return storage.getItem(key)===pending.raw;
  }catch{return false;}
}

export function restoreBestStoredWorld(world,pending,storage){
  const rejected=[];
  for(const candidate of [pending,...(pending.alternates||[])]){
    try{
      restoreStoredWorld(world,candidate.value);
      return {state:'restored',source:candidate.source,rejected};
    }catch(error){
      if(!quarantineStoredWorld(candidate,storage,rejected.length))
        return {state:'blocked',reason:`Could not preserve rejected ${candidate.source} before recovery: ${error.message}`,
          rejected};
      rejected.push({source:candidate.source,error:error.message});
    }
  }
  return {state:'invalid',rejected};
}

export function restoreStoredWorld(world,value){
  if(world.spatial?.originUnavailable)
    throw Error('Saved room origin is unavailable; recover it before replacing the active world');
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
  const scene=world.spatial?{...savedScene,roomId:world.scene.roomId}:savedScene;
  world.validateScene(scene);
  if(value.game!==null&&!validSavedGame(value.game,scene,id=>!!world.asset(id)))
    throw Error('Saved game bindings or progress are invalid');
  const game=structuredClone(value.game);
  const citizens=value.version===3?checkedCitizens(world,savedScene,value.citizens):null;
  restoreStoredScene(world,savedScene);
  world.game=game;
  world.citizens=citizens;
  world.originBinding=world.spatial&&world.originBinding==='ar'?'ar':binding;
  world.originAnchorHandle=world.spatial&&world.originBinding==='ar'&&binding!=='ar'?
    world.originAnchorHandle:anchorHandle;
  world.undo=[];world.redo=[];
}

const hasSavedWorldContent=value=>value.scene.objects?.length>0||value.game!==null||
  value.citizens!=null;

export function saveCheckpoint(scene,game,storage,originBinding,originAnchorHandle,citizens=null){
  try{storage.setItem(CHECKPOINT_KEY,JSON.stringify({version:citizens==null?2:3,scene,game,
    ...(citizens==null?{}:{citizens}),
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
}
