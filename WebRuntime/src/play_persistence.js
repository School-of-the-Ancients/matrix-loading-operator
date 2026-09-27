import {canPlayWorld} from './creator_mode.js';
import {validSavedGame} from './game.js';
import {saveStoredWorld,storedBrowserWorld} from './scene_store.js';

export const PLAY_SAVE_INTERVAL_MS=5000;

// A Play tick may move bodies without a UI command. Save only changed dynamic
// poses at a bounded rate; explicit releases and world edits save immediately.
export function createPlayPersistence(world,tabStorage,durableStorage,
  {canSave=()=>true,now=()=>performance.now()}={}){
  let lastSavedSignature=null,lastSavedAt=-Infinity;
  const signature=envelope=>JSON.stringify({bodies:envelope.scene.objects.filter(object=>
    object.rigidBody?.type==='dynamic').map(object=>[object.objectId,object.transform]),
    rigidMotion:envelope.rigidMotion??null,gameState:envelope.game?.state??null});
  return {
    persist({periodic=false}={}){
      if(!canSave())return {attempted:false,reason:'world-unavailable'};
      if(periodic&&(!canPlayWorld(world.creatorMode)||
          world.spatial?.originUnavailable||world.spatial?.stale||
          !world.scene.objects.some(object=>object.rigidBody?.type==='dynamic')))
        return {attempted:false,reason:'simulation-inactive'};
      const time=now();
      if(periodic&&time-lastSavedAt<PLAY_SAVE_INTERVAL_MS)
        return {attempted:false,reason:'unchanged-or-throttled'};
      const envelope=storedBrowserWorld(world);
      const currentSignature=signature(envelope);
      if(periodic&&currentSignature===lastSavedSignature)
        return {attempted:false,reason:'unchanged-or-throttled'};
      if(world.game&&!validSavedGame(world.game,world.scene,id=>!!world.asset(id)))
        throw Error('Active challenge bindings are invalid; repair them before saving');
      const warning=saveStoredWorld(envelope,tabStorage,durableStorage);
      if(!warning){lastSavedAt=time;lastSavedSignature=currentSignature;}
      return {attempted:true,warning};
    }
  };
}
