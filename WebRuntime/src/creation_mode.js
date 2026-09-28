// A per-tab preference for a selected image's eventual Matrix build.
export const CREATION_MODE_KEY='matrix-concept-creation-mode';
const MODES=new Set(['auto','procedural','blender']);

export function validCreationMode(mode){return MODES.has(mode);}

export function loadCreationMode(storage){
  const saved=storage.getItem(CREATION_MODE_KEY);
  return validCreationMode(saved)?saved:'auto';
}

export function saveCreationMode(storage,mode){
  if(!validCreationMode(mode))throw Error('Unknown concept creation mode.');
  storage.setItem(CREATION_MODE_KEY,mode);
  return mode;
}

export function creationModeFromPanelAction(action){
  const match=/^creation-mode-(auto|procedural|blender)$/.exec(action||'');
  return match?.[1]||null;
}
