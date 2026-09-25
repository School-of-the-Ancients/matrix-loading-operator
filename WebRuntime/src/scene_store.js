// Browser-local recovery for the virtual scene. Session storage retains the
// older tab format; local storage survives closing and reopening Quest Browser.
export const TAB_SCENE_KEY='matrix-web-scene';
export const DURABLE_SCENE_KEY='matrix-web-scene-v1';

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
}
