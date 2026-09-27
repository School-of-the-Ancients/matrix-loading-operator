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
    exact(binding,['kind','objectId'])&&
      ['rigid-body','object-transform'].includes(binding.kind)&&validId(binding.objectId);
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
  if(binding.kind==='object-transform'){
    const source='MatrixWorld.scene.objects';
    if(!object)return {status:'unavailable',source,text:'Bound object unavailable.'};
    const pose=object.transform;
    if(!pose||!['position','rotation','scale'].every(part=>
       ['x','y','z'].every(axis=>Number.isFinite(pose[part]?.[axis]))))
      return {status:'unavailable',source,text:'Bound transform unavailable.'};
    const triple=(part,digits=2)=>['x','y','z'].map(axis=>pose[part][axis].toFixed(digits)).join(', ');
    let size='';
    // Catalog bounds are already available. Procedural bounds would rebuild
    // the mesh on every board repaint, so show its live scale without a size.
    const asset=world.asset?.(object.assetId);
    const bounds=asset?.localBounds,spawnScale=asset?.spawnScale??1;
    if(bounds&&Number.isFinite(spawnScale)&&spawnScale>0&&
       ['x','y','z'].every(axis=>Number.isFinite(bounds.size?.[axis])&&bounds.size[axis]>0))
      size=`; local size (m) (${['x','y','z'].map(axis=>
        (bounds.size[axis]*spawnScale*pose.scale[axis]).toFixed(3)).join(', ')})`;
    return {status:'current',source,text:
      `Position (m) (${triple('position')}); rotation (deg) (${triple('rotation')}); `+
      `scale (unitless) (${triple('scale',3)})${size}.`};
  }
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
