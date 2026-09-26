// A display is an object component and a view of MatrixWorld state. Its text
// and bindings are data; no HTML, code, or separate experiment state is loaded.
import {gameStatus,validSavedGame} from './game.js';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===keys.slice().sort().join('|');
const plainText=(value,min,max)=>typeof value==='string'&&value.length>=min&&
  value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
const validId=value=>plainText(value,1,128);
const decimal=value=>Number.isFinite(value)?value.toFixed(2):'—';

export function validDisplay(value){
  if(!exact(value,['schemaVersion','title','body','binding'])||value.schemaVersion!==1||
     !plainText(value.title,1,80)||!plainText(value.body,0,600))return false;
  const binding=value.binding;
  return binding===null||
    exact(binding,['kind'])&&['game-progress','gravity'].includes(binding.kind)||
    exact(binding,['kind','objectId'])&&binding.kind==='rigid-body'&&validId(binding.objectId);
}

export function displayObservation(world,display){
  if(!validDisplay(display))throw Error('Invalid Matrix display');
  const binding=display.binding;
  if(binding===null)return {status:'static',source:'authored-text',text:''};
  if(binding.kind==='game-progress'){
    if(!world.game)return {status:'unavailable',source:'MatrixWorld.game',text:'No active challenge.'};
    if(!validSavedGame(world.game,world.scene,id=>!!world.asset?.(id)))
      return {status:'unavailable',source:'MatrixWorld.game',text:'Challenge bindings or progress are invalid.'};
    const exits=world.game.spec.roles.filter(role=>role.kind==='exit')
      .flatMap(role=>world.game.bindings[role.roleId]||[]);
    const unlocked=world.game.state.unlockedObjectIds||[];
    return {status:'current',source:'MatrixWorld.game',text:
      `${gameStatus(world)}${exits.length?` Exit ${unlocked.length?'unlocked':'locked'}.`:''}`};
  }
  if(binding.kind==='gravity'){
    const g=world.rigidGravity;
    if(!g||!['x','y','z'].every(axis=>Number.isFinite(g[axis])))
      return {status:'unavailable',source:'MatrixWorld.rigidGravity',text:'Gravity unavailable.'};
    return {status:'current',source:'MatrixWorld.rigidGravity',text:
      `Gravity: (${decimal(g.x)}, ${decimal(g.y)}, ${decimal(g.z)}) m/s²`};
  }
  const object=world.scene?.objects?.find(item=>item.objectId===binding.objectId);
  if(!object?.rigidBody)
    return {status:'unavailable',source:'MatrixWorld.rigidPhysics',text:'Bound body unavailable.'};
  let state=null;
  try{state=world.rigidPhysics?.state(binding.objectId)||null;}catch{ /* Not ready. */ }
  if(!state)return {status:'unavailable',source:'MatrixWorld.rigidPhysics',
    text:`${object.rigidBody.type} body configured; no live reading.`};
  const speed=Math.hypot(state.linearVelocity.x,state.linearVelocity.y,state.linearVelocity.z);
  const paused=world.creatorMode?.simulation==='paused'?'Paused snapshot. ':'Live reading. ';
  return {status:'current',source:'MatrixWorld.rigidPhysics',text:
    `${paused}${state.type} body at (${decimal(state.position.x)}, ${decimal(state.position.y)}, ${decimal(state.position.z)}) m; speed ${decimal(speed)} m/s${state.held?'; held':''}.`};
}
