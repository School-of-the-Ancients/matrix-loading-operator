import {restoreStoredWorld} from './scene_store.js';

// Stage a PC restore in memory. The current browser world stays in storage until
// the service has accepted the replacement snapshot.
export async function applyPCWorld(world,saved,sync){
  if(world.spatial)throw Error('PC world restore requires the desktop virtual room');
  // A bound object may have been deleted by an external command. That makes
  // the current Citizens state invalid for saving, but must not prevent a valid
  // PC checkpoint from repairing the world. Capture rollback state without
  // running the current-world save validator.
  const previous={scene:structuredClone(world.scene),game:structuredClone(world.game),
    citizens:structuredClone(world.citizens??null),selection:structuredClone(world.selection),
    originBinding:world.originBinding,originAnchorHandle:world.originAnchorHandle,
    undo:structuredClone(world.undo),redo:structuredClone(world.redo)};
  // PC checkpoints do not carry browser AR origin provenance. A nonempty
  // restored world therefore remains ambiguous until explicitly rebound.
  restoreStoredWorld(world,saved);
  try{await sync();}
  catch(error){
    world.scene=previous.scene;world.game=previous.game;
    world.citizens=previous.citizens;
    world.originBinding=previous.originBinding;
    world.originAnchorHandle=previous.originAnchorHandle;
    world.selection=previous.selection;world.undo=previous.undo;world.redo=previous.redo;
    throw error;
  }
}
