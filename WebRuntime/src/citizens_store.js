// The desktop fixture has one atomic, versioned browser save. Its key is
// separate from the normal /web/ world and from the PC scene store.
import {MatrixWorld} from './protocol.js';
import {storedWorld,restoreStoredWorld} from './scene_store.js';
import {CitizensSimulation} from './citizens.js';

export const CITIZENS_SAVE_KEY='matrix-citizens-desktop-v1';
const MAX_SAVE_CHARS=256*1024;

export function makeCitizensWorld(seed){
  if(!Number.isSafeInteger(seed)||seed<1||seed>0xffffffff)
    throw Error('Seed must be an integer from 1 to 4294967295');
  let sequence=0;
  let world;
  world=new MatrixWorld(()=>{
    let id;
    do{id=`citizens-${seed}-${++sequence}`;}
    while(world.scene.objects.some(object=>object.objectId===id));
    return id;
  });
  return world;
}

export function saveCitizensCheckpoint(storage,world,simulation){
  const state=simulation.exportState();
  const value={version:1,world:{...storedWorld(world),originBinding:'virtual'},simulation:state};
  const raw=JSON.stringify(value);
  if(raw.length>MAX_SAVE_CHARS)throw Error('Citizens checkpoint exceeds the local save limit');
  storage.setItem(CITIZENS_SAVE_KEY,raw);
  return value;
}

export function loadCitizensCheckpoint(storage){
  const raw=storage.getItem(CITIZENS_SAVE_KEY);
  if(raw===null)return null;
  if(raw.length>MAX_SAVE_CHARS)throw Error('Citizens checkpoint exceeds the local save limit');
  let value;
  try{value=JSON.parse(raw);}catch{throw Error('Citizens checkpoint is not valid JSON');}
  if(!value||value.version!==1||!value.world||!value.simulation)
    throw Error('Unsupported Citizens checkpoint');
  // Build and validate both layers before the UI replaces its active world.
  // An invalid save remains untouched for inspection or explicit reset.
  const world=makeCitizensWorld(value.simulation.seed);
  restoreStoredWorld(world,value.world);
  const simulation=CitizensSimulation.restore(world,value.simulation);
  return {world,simulation};
}
