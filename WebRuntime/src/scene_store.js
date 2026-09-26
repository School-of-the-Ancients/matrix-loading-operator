// Browser-local recovery. One versioned envelope contains scene and game.
import {validSavedGame} from './game.js';
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
const validEnvelope=value=>value?.version===2&&value.scene&&typeof value.scene==='object'&&
  Object.hasOwn(value,'game');

export function storedWorld(world){
  const scene=world.spatial?{...world.virtualScene.scene,
    objects:world.scene.objects.filter(object=>object.anchorId==='web-floor')}:world.scene;
  return {version:2,scene:structuredClone(scene),game:structuredClone(world.game)};
}

// Keep browser-only origin provenance out of PC world checkpoints, whose
// scene/game envelope is intentionally renderer-neutral and exact.
export function storedBrowserWorld(world){
  return {...storedWorld(world),originBinding:world.originBinding};
}

export function saveStoredWorld(value,tabStorage,durableStorage){
  let json;
  try{
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
  if(!value||value.version!==2||!value.scene||typeof value.scene!=='object'||
     !Object.hasOwn(value,'game'))throw Error('Invalid world save envelope');
  const binding=value.originBinding===undefined?
    (value.scene.objects?.length||value.game!==null?'unknown':'virtual'):value.originBinding;
  if(!['virtual','ar','unknown'].includes(binding))throw Error('Invalid world origin binding');
  // Validate both halves before changing the active world.
  const scene=world.spatial?{...structuredClone(value.scene),roomId:world.scene.roomId}:value.scene;
  world.validateScene(scene);
  if(value.game!==null&&!validSavedGame(value.game,scene,id=>!!world.asset(id)))
    throw Error('Saved game bindings or progress are invalid');
  restoreStoredScene(world,value.scene);
  world.game=structuredClone(value.game);
  world.originBinding=world.spatial&&world.originBinding==='ar'?'ar':binding;
  world.undo=[];world.redo=[];
}

export function saveCheckpoint(scene,game,storage,originBinding){
  try{storage.setItem(CHECKPOINT_KEY,JSON.stringify({version:2,scene,game,
    ...(originBinding?{originBinding}:{})}));return '';}
  catch(error){return `World checkpoint could not be saved: ${error.message}`;}
}

export function loadCheckpoint(storage){
  try{
    const value=JSON.parse(storage.getItem(CHECKPOINT_KEY)||'null');
    if(value&&value.version===2&&value.scene&&Object.hasOwn(value,'game'))return value;
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
