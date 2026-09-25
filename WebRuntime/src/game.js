// Declarative mechanics bound to ordinary Matrix scene objects.
const floor='web-floor';
const round=value=>Math.round(value*1000)/1000;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const shape=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===fields.slice().sort().join('|');
const achieved=(objective,state)=>objective.kind==='score-at-least'?state.score>=objective.targetPoints:
  state.objectiveProgress[objective.roleId]>=objective.targetCount;

export function validateGameSpec(spec,asset=()=>true){
  if(!shape(spec,['kind','title','roles','rules','objectives','summary'])||spec.kind!=='game'||
     typeof spec.title!=='string'||!spec.title.trim()||spec.title.length>64||
     typeof spec.summary!=='string'||!spec.summary.trim()||spec.summary.length>500||
     !Array.isArray(spec.roles)||spec.roles.length<2||spec.roles.length>8||
     !Array.isArray(spec.rules)||spec.rules.length<1||spec.rules.length>8||
     !Array.isArray(spec.objectives)||spec.objectives.length<1||spec.objectives.length>8)
    throw Error('Invalid game specification');
  const roles=new Map();let total=0;
  for(const role of spec.roles){
    if(!shape(role,['roleId','kind','assetId','count'])||typeof role.roleId!=='string'||
       !/^[a-z][a-z0-9-]{0,31}$/.test(role.roleId)||roles.has(role.roleId)||
       !['pickup','delivery-zone'].includes(role.kind)||typeof role.assetId!=='string'||!asset(role.assetId)||
       !Number.isInteger(role.count)||role.count<1||role.count>6)
      throw Error('Invalid game role or unavailable asset');
    roles.set(role.roleId,role);total+=role.count;
  }
  if(total>24||![...roles.values()].some(role=>role.kind==='pickup')||
     ![...roles.values()].some(role=>role.kind==='delivery-zone'))throw Error('Game role limit exceeded or required role missing');
  const rulePairs=new Set();
  for(const rule of spec.rules){
    if(!shape(rule,['event','actorRoleId','targetRoleId','distanceMeters','scorePoints'])||
       rule.event!=='release-near'||roles.get(rule.actorRoleId)?.kind!=='pickup'||
       roles.get(rule.targetRoleId)?.kind!=='delivery-zone'||!finite(rule.distanceMeters)||
       rule.distanceMeters<.25||rule.distanceMeters>1||!Number.isInteger(rule.scorePoints)||
       rule.scorePoints<1||rule.scorePoints>1000)throw Error('Invalid game rule');
    const pair=`${rule.actorRoleId}|${rule.targetRoleId}`;
    if(rulePairs.has(pair))throw Error('Duplicate game rule for actor and target roles');
    rulePairs.add(pair);
  }
  const maxScore=[...roles.values()].filter(role=>role.kind==='pickup').reduce((sum,role)=>
    sum+role.count*Math.max(0,...spec.rules.filter(rule=>rule.actorRoleId===role.roleId).map(rule=>rule.scorePoints)),0);
  let scoreObjectives=0;
  for(const objective of spec.objectives){
    if(objective?.kind==='score-at-least'){
      if(!shape(objective,['kind','targetPoints'])||!Number.isInteger(objective.targetPoints)||
         objective.targetPoints<1||objective.targetPoints>maxScore||++scoreObjectives>1)
        throw Error('Invalid game objective');
    }else if(!shape(objective,['kind','roleId','targetCount'])||objective.kind!=='delivered-count'||
       roles.get(objective.roleId)?.kind!=='pickup'||!Number.isInteger(objective.targetCount)||
       objective.targetCount<1||objective.targetCount>roles.get(objective.roleId).count||
       !spec.rules.some(rule=>rule.actorRoleId===objective.roleId))throw Error('Invalid game objective');
  }
  return spec;
}

export function validSavedGame(game,scene,asset=()=>true){
  try{
    if(!shape(game,['spec','bindings','state']))return null;
    validateGameSpec(game.spec,asset);
    if(!game.bindings||typeof game.bindings!=='object'||Array.isArray(game.bindings)||
       Object.keys(game.bindings).length!==game.spec.roles.length)return null;
    const objects=new Map(scene.objects.map(object=>[object.objectId,object])),bound=new Set();
    for(const role of game.spec.roles){
      const ids=game.bindings[role.roleId];
      if(!Array.isArray(ids)||ids.length!==role.count)return null;
      for(const id of ids){
        const object=objects.get(id);
        if(typeof id!=='string'||bound.has(id)||!object||object.assetId!==role.assetId||object.anchorId!==floor)return null;
        bound.add(id);
      }
    }
    const state=game.state;
    if(!shape(state,['phase','score','deliveries','objectiveProgress'])||
       !['playing','won'].includes(state.phase)||!Number.isSafeInteger(state.score)||state.score<0||
       !Array.isArray(state.deliveries)||new Set(state.deliveries).size!==state.deliveries.length||
       !state.deliveries.every(id=>game.spec.roles.some(role=>role.kind==='pickup'&&game.bindings[role.roleId].includes(id)))||
       !state.objectiveProgress||typeof state.objectiveProgress!=='object'||
       Array.isArray(state.objectiveProgress))return null;
    for(const objective of game.spec.objectives.filter(item=>item.kind==='delivered-count')){
      const delivered=game.bindings[objective.roleId].filter(id=>state.deliveries.includes(id)).length;
      if(state.objectiveProgress[objective.roleId]!==delivered)return null;
    }
    const deliveredRoles=[...new Set(game.spec.objectives.filter(item=>item.kind==='delivered-count').map(item=>item.roleId))];
    if(Object.keys(state.objectiveProgress).sort().join('|')!==deliveredRoles.sort().join('|'))return null;
    let minimum=0,maximum=0;
    for(const id of state.deliveries){
      const role=game.spec.roles.find(item=>item.kind==='pickup'&&game.bindings[item.roleId].includes(id));
      const points=game.spec.rules.filter(rule=>rule.actorRoleId===role.roleId).map(rule=>rule.scorePoints);
      if(!points.length)return null;
      minimum+=Math.min(...points);maximum+=Math.max(...points);
    }
    if(state.score<minimum||state.score>maximum)return null;
    const won=game.spec.objectives.every(objective=>achieved(objective,state));
    if((state.phase==='won')!==won)return null;
    return game;
  }catch{return null;}
}

function scaleFor(asset,metres){
  const size=asset.localBounds?.size;
  if(!size)return 1;
  const largest=Math.max(size.x,size.y,size.z)*(asset.spawnScale||1);
  return Math.max(.05,Math.min(3,round(metres/largest)));
}

export function startGame(world,spec,viewer=null){
  validateGameSpec(spec,id=>!!world.asset(id));
  const count=spec.roles.reduce((sum,role)=>sum+role.count,0);
  if(world.scene.objects.length+count>100)throw Error('The scene needs more free object slots for this game');
  if(world.spatial?.stale)throw Error('Room tracking is stale; recover alignment before starting a game');
  const frame=viewer?.frames?.find(item=>item.anchorId===floor);
  const forward=frame?.forward&&finite(frame.forward.x)&&finite(frame.forward.z)?frame.forward:{x:0,z:-1};
  const length=Math.hypot(forward.x,forward.z)||1;
  const fx=forward.x/length,fz=forward.z/length,rx=-fz,rz=fx;
  const selected=world.selection.anchorId===floor&&['x','z'].every(axis=>finite(world.selection.position[axis]));
  const head=frame?.position&&['x','z'].every(axis=>finite(frame.position[axis]))?frame.position:{x:0,z:0};
  const center=selected?world.selection.position:{x:head.x+fx*1.6,z:head.z+fz*1.6};
  const backup={scene:structuredClone(world.scene),selection:structuredClone(world.selection),
    undo:structuredClone(world.undo),redo:structuredClone(world.redo),game:structuredClone(world.game)};
  const spawn=(assetId,x,z,size)=>{
    const scale=scaleFor(world.asset(assetId),size);
    const result=world.execute({requestId:crypto.randomUUID(),op:'spawn',assetId,anchorId:floor,
      transform:{position:{x:round(x),y:0,z:round(z)},rotation:{x:0,y:0,z:0},
        scale:{x:scale,y:scale,z:scale}}});
    if(!result.ok)throw Error(`Game placement failed: ${result.error}`);
    return result.objectId;
  };
  try{
    const bindings={};let pickupIndex=0,zoneIndex=0;
    const zoneCount=spec.roles.filter(role=>role.kind==='delivery-zone').reduce((sum,role)=>sum+role.count,0);
    for(const role of spec.roles){
      bindings[role.roleId]=[];
      for(let index=0;index<role.count;index++){
        let x,z,size;
        if(role.kind==='delivery-zone'){
          const lateral=(zoneIndex++-(zoneCount-1)/2)*1.4;
          x=center.x+rx*lateral;z=center.z+rz*lateral;size=.7;
        }else{
          const lateral=(pickupIndex%5-2)*.55,depth=1.1+Math.floor(pickupIndex/5)*.55;
          pickupIndex++;x=center.x+rx*lateral+fx*depth;z=center.z+rz*lateral+fz*depth;size=.3;
        }
        bindings[role.roleId].push(spawn(role.assetId,x,z,size));
      }
    }
    world.game={spec:structuredClone(spec),bindings,state:{phase:'playing',score:0,deliveries:[],
      objectiveProgress:Object.fromEntries(spec.objectives.filter(item=>item.kind==='delivered-count').map(objective=>[objective.roleId,0]))}};
    return world.game;
  }catch(error){
    world.scene=backup.scene;world.selection=backup.selection;world.undo=backup.undo;world.redo=backup.redo;world.game=backup.game;
    throw error;
  }
}

export function gameStatus(world){
  const game=world.game;
  if(!game)return 'No game running.';
  if(!validSavedGame(game,world.scene,id=>!!world.asset(id)))return `${game.spec?.title||'Game'}: bound objects are missing or progress is invalid.`;
  const progress=game.spec.objectives.map(objective=>objective.kind==='score-at-least'?
    `${game.state.score}/${objective.targetPoints} points`:
    `${game.state.objectiveProgress[objective.roleId]}/${objective.targetCount} ${objective.roleId}`).join(' · ');
  return `${game.spec.title}: ${game.state.phase==='won'?'complete!':'playing'} ${progress}. Score ${game.state.score}.`;
}

export function deliverMovedObject(world,objectId){
  const game=world.game;
  if(!game||game.state.phase!=='playing'||game.state.deliveries.includes(objectId)||world.spatial?.stale)return null;
  const actor=game.spec.roles.find(role=>role.kind==='pickup'&&game.bindings[role.roleId].includes(objectId));
  if(!actor)return null;
  const item=world.scene.objects.find(object=>object.objectId===objectId);
  if(!item||item.anchorId!==floor)return null;
  for(const rule of game.spec.rules.filter(rule=>rule.actorRoleId===actor.roleId)){
    for(const targetId of game.bindings[rule.targetRoleId]){
      const target=world.scene.objects.find(object=>object.objectId===targetId);
      if(!target||target.anchorId!==floor)continue;
      const a=item.transform.position,b=target.transform.position;
      if(Math.hypot(a.x-b.x,a.z-b.z)>rule.distanceMeters||Math.abs(a.y-b.y)>1)continue;
      game.state.deliveries.push(objectId);
      game.state.score+=rule.scorePoints;
      if(Object.hasOwn(game.state.objectiveProgress,actor.roleId))
        game.state.objectiveProgress[actor.roleId]=game.bindings[actor.roleId].filter(id=>game.state.deliveries.includes(id)).length;
      if(game.spec.objectives.every(objective=>achieved(objective,game.state)))game.state.phase='won';
      return game.state.phase==='won'?`${game.spec.title} complete! Score ${game.state.score}.`:
        `Delivered ${actor.roleId}. Score ${game.state.score}.`;
    }
  }
  return null;
}
