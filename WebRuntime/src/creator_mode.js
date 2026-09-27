// Creator/Play is world state, independent of the desktop, VR, or AR view.
// Authoring pauses simulation by default. A mode switch never rewinds a world.
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===keys.slice().sort().join('|');

export function createCreatorMode(){
  return {schemaVersion:1,mode:'creator',simulation:'paused',revision:0};
}

export function validCreatorMode(value){
  return !!exact(value,['schemaVersion','mode','simulation','revision'])&&
    value.schemaVersion===1&&['creator','play'].includes(value.mode)&&
    ['paused','running'].includes(value.simulation)&&
    (value.mode==='play'||value.simulation==='paused')&&
    Number.isSafeInteger(value.revision)&&value.revision>=0;
}

// Old scene/game/Citizens checkpoints had no authoring mode. Restore them into
// paused Creator Mode without modifying their objects or earned progress.
export function restoredCreatorMode(value){
  if(value===undefined)return createCreatorMode();
  if(!validCreatorMode(value))throw Error('Invalid Creator Mode checkpoint');
  return structuredClone(value);
}

export function transitionCreatorMode(value,action,expectedRevision){
  if(!validCreatorMode(value))throw Error('Invalid Creator Mode state');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==value.revision)
    throw Error('Creator Mode changed; inspect its current revision');
  const next=structuredClone(value);
  switch(action){
    case 'enter-play':next.mode='play';next.simulation='running';break;
    case 'enter-creator':next.mode='creator';next.simulation='paused';break;
    case 'pause':
    case 'stop':
      next.simulation='paused';break;
    case 'resume':
      if(next.mode!=='play')throw Error('Enter Play/Test before resuming simulation');
      next.simulation='running';break;
    default:throw Error('Unsupported Creator Mode action');
  }
  if(next.mode===value.mode&&next.simulation===value.simulation)return next;
  if(next.revision===Number.MAX_SAFE_INTEGER)throw Error('Creator Mode revision exhausted');
  next.revision++;
  return next;
}

export const canAuthorWorld=value=>validCreatorMode(value)&&value.mode==='creator';
export const canPlayWorld=value=>validCreatorMode(value)&&value.mode==='play'&&value.simulation==='running';
