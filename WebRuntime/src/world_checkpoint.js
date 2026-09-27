import {restoreStoredWorld} from './scene_store.js';

// Stage a PC restore in memory. The current browser world stays in storage until
// the service has accepted the replacement snapshot.
export async function applyPCWorld(world,saved,sync){
  if(world.spatial)throw Error('PC world restore requires the desktop virtual room');
  // A bound object may have been deleted by an external command. That makes
  // the current Citizens state invalid for saving, but must not prevent a valid
  // PC checkpoint from repairing the world. Capture rollback state without
  // running the current-world save validator.
  if(world.agentGrab||world.rigidPhysics?.states().some(state=>state.held))
    throw Error('Release grabbed objects before restoring a PC world');
  const previous={scene:structuredClone(world.scene),game:structuredClone(world.game),
    citizens:structuredClone(world.citizens??null),selection:structuredClone(world.selection),
    originBinding:world.originBinding,originAnchorHandle:world.originAnchorHandle,
    undo:structuredClone(world.undo),redo:structuredClone(world.redo),
    creatorMode:structuredClone(world.creatorMode),rigidGravity:structuredClone(world.rigidGravity),
    controlStates:structuredClone(world.controlStates),
    rigidSnapshot:world.rigidPhysics?.snapshot()??null,
    physicsBodies:structuredClone(world.physicsBodies),
    physicsVerification:structuredClone(world.physicsVerification),
    renderedVerification:structuredClone(world.renderedVerification),
    authoredGeneration:world.authoredGeneration};
  // PC checkpoints do not carry browser AR origin provenance. A nonempty
  // restored world therefore remains ambiguous until explicitly rebound.
  try{
    restoreStoredWorld(world,saved);
    await sync();
  }
  catch(error){
    world.scene=previous.scene;world.game=previous.game;
    world.citizens=previous.citizens;
    world.creatorMode=previous.creatorMode;
    world.rigidGravity=previous.rigidGravity;
    world.controlStates=previous.controlStates;
    world.originBinding=previous.originBinding;
    world.originAnchorHandle=previous.originAnchorHandle;
    world.selection=previous.selection;world.undo=previous.undo;world.redo=previous.redo;
    world.physicsBodies=previous.physicsBodies;
    world.physicsVerification=previous.physicsVerification;
    world.renderedVerification=previous.renderedVerification;
    world.physicsSceneReference=world.scene;
    world.authoredGeneration=previous.authoredGeneration;
    if(world.rigidPhysics&&previous.rigidSnapshot){
      world.rigidPhysics.restore(previous.rigidSnapshot);
      world.rigidSceneReference=world.scene;
    }
    throw error;
  }
}
