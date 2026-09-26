import {restoreStoredWorld,storedWorld} from './scene_store.js';

// Stage a PC restore in memory. The current browser world stays in storage until
// the service has accepted the replacement snapshot.
export async function applyPCWorld(world,saved,sync){
  if(world.spatial)throw Error('PC world restore requires the desktop virtual room');
  const previous={world:storedWorld(world),selection:structuredClone(world.selection),
    originBinding:world.originBinding,undo:structuredClone(world.undo),redo:structuredClone(world.redo)};
  // PC checkpoints do not carry browser AR origin provenance. A nonempty
  // restored world therefore remains ambiguous until explicitly rebound.
  restoreStoredWorld(world,saved);
  try{await sync();}
  catch(error){
    world.scene=previous.world.scene;world.game=previous.world.game;
    world.originBinding=previous.originBinding;
    world.selection=previous.selection;world.undo=previous.undo;world.redo=previous.redo;
    throw error;
  }
}
