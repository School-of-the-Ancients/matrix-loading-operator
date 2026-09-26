// Declarative mechanics bound to ordinary Matrix scene objects.
const floor='web-floor';
const round=value=>Math.round(value*1000)/1000;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const shape=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===fields.slice().sort().join('|');
const achieved=(objective,state)=>objective.kind==='score-at-least'?state.score>=objective.targetPoints:
  state.objectiveProgress[objective.roleId]>=objective.targetCount;
const gameV2=spec=>spec?.schemaVersion===2;
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=128&&!/[\x00-\x1f]/.test(id);
const sameData=(left,right)=>{
  if(left===right)return true;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&
    left.length===right.length&&left.every((item,index)=>sameData(item,right[index]));
  if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
  const keys=Object.keys(left);
  return keys.length===Object.keys(right).length&&
    keys.every(key=>Object.hasOwn(right,key)&&sameData(left[key],right[key]));
};

export function validateGameSpec(spec,asset=()=>true){
  const v2=gameV2(spec);
  if(!shape(spec,v2?['schemaVersion','kind','title','roles','rules','objectives','consequences','summary']:
    ['kind','title','roles','rules','objectives','summary'])||spec.kind!=='game'||
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
       !(v2?['pickup','delivery-zone','exit']:['pickup','delivery-zone']).includes(role.kind)||
       typeof role.assetId!=='string'||!asset(role.assetId)||
       !Number.isInteger(role.count)||role.count<1||role.count>6)
      throw Error('Invalid game role or unavailable asset');
    roles.set(role.roleId,role);total+=role.count;
  }
  if(total>24||![...roles.values()].some(role=>role.kind==='pickup')||
     ![...roles.values()].some(role=>role.kind==='delivery-zone'))throw Error('Game role limit exceeded or required role missing');
  if(v2){
    if(!Array.isArray(spec.consequences)||spec.consequences.length>4||
       new Set(spec.consequences.map(item=>item?.roleId)).size!==spec.consequences.length||
       !spec.consequences.every(item=>shape(item,['kind','roleId'])&&item.kind==='unlock'&&
         roles.get(item.roleId)?.kind==='exit'))throw Error('Invalid game consequence');
  }
  const rulePairs=new Set();
  for(const rule of spec.rules){
    if(!shape(rule,['event','actorRoleId','targetRoleId','distanceMeters','scorePoints'])||
       !(v2?['release-near','sensor-enter']:['release-near']).includes(rule.event)||
       roles.get(rule.actorRoleId)?.kind!=='pickup'||
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
    const v2=gameV2(game.spec);
    if(!shape(state,v2?['phase','score','deliveries','objectiveProgress','creditedEvents','unlockedObjectIds']:
      ['phase','score','deliveries','objectiveProgress'])||
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
    if(v2){
      if(!Array.isArray(state.creditedEvents)||state.creditedEvents.length!==state.deliveries.length||
         !Array.isArray(state.unlockedObjectIds)||
         new Set(state.creditedEvents.map(item=>item?.eventId)).size!==state.creditedEvents.length)return null;
      let earned=0;const prefixCounts=new Map();
      for(const [index,record] of state.creditedEvents.entries()){
        if(!shape(record,['eventId','event','objectId','targetObjectId','scorePoints'])||
           !validId(record.eventId)||record.objectId!==state.deliveries[index]||
           !validId(record.targetObjectId)||!Number.isInteger(record.scorePoints))return null;
        const actor=game.spec.roles.find(role=>role.kind==='pickup'&&
          game.bindings[role.roleId].includes(record.objectId));
        const target=game.spec.roles.find(role=>role.kind==='delivery-zone'&&
          game.bindings[role.roleId].includes(record.targetObjectId));
        if(!actor||!target||!game.spec.rules.some(rule=>rule.event===record.event&&
           rule.actorRoleId===actor.roleId&&rule.targetRoleId===target.roleId&&
           rule.scorePoints===record.scorePoints))return null;
        earned+=record.scorePoints;
        prefixCounts.set(actor.roleId,(prefixCounts.get(actor.roleId)||0)+1);
        if(index<state.creditedEvents.length-1&&game.spec.objectives.every(objective=>
          objective.kind==='score-at-least'?earned>=objective.targetPoints:
            (prefixCounts.get(objective.roleId)||0)>=objective.targetCount))return null;
      }
      if(earned!==state.score)return null;
      const won=game.spec.objectives.every(objective=>achieved(objective,state));
      const unlocked=won?game.spec.consequences.flatMap(item=>game.bindings[item.roleId]):[];
      if((state.phase==='won')!==won||
         JSON.stringify(state.unlockedObjectIds)!==JSON.stringify(unlocked))return null;
      return game;
    }
    let reachable=new Set([0]);
    const prefixCounts=new Map();
    for(const [index,id] of state.deliveries.entries()){
      const role=game.spec.roles.find(item=>item.kind==='pickup'&&game.bindings[item.roleId].includes(id));
      prefixCounts.set(role.roleId,(prefixCounts.get(role.roleId)||0)+1);
      const points=new Set(game.spec.rules.filter(rule=>rule.actorRoleId===role.roleId).map(rule=>rule.scorePoints));
      if(!points.size)return null;
      const next=new Set();
      for(const subtotal of reachable)for(const award of points)
        if(subtotal+award<=state.score)next.add(subtotal+award);
      if(index<state.deliveries.length-1)for(const subtotal of next)
        if(game.spec.objectives.every(objective=>objective.kind==='score-at-least'?
          subtotal>=objective.targetPoints:(prefixCounts.get(objective.roleId)||0)>=objective.targetCount))
          next.delete(subtotal);
      reachable=next;
      if(!reachable.size)return null;
    }
    if(!reachable.has(state.score))return null;
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
  if(world.game)throw Error('An active game must be migrated or reset explicitly');
  validateGameSpec(spec,id=>!!world.asset(id));
  const count=spec.roles.reduce((sum,role)=>sum+role.count,0);
  if(world.scene.objects.length+count>100)throw Error('The scene needs more free object slots for this game');
  if(world.spatial?.stale||world.spatial?.originUnavailable)
    throw Error('Room origin or tracking is unavailable; recover it before starting a game');
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
    const bindings={};let pickupIndex=0,zoneIndex=0,exitIndex=0;
    const zoneCount=spec.roles.filter(role=>role.kind==='delivery-zone').reduce((sum,role)=>sum+role.count,0);
    for(const role of spec.roles){
      bindings[role.roleId]=[];
      for(let index=0;index<role.count;index++){
        let x,z,size;
        if(role.kind==='exit'){
          const lateral=(exitIndex++-(role.count-1)/2)*1.1;
          x=center.x+rx*lateral-fx*1.5;z=center.z+rz*lateral-fz*1.5;size=1;
        }else if(role.kind==='delivery-zone'){
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
      objectiveProgress:Object.fromEntries(spec.objectives.filter(item=>item.kind==='delivered-count').map(objective=>[objective.roleId,0])),
      ...(gameV2(spec)?{creditedEvents:[],unlockedObjectIds:[]}: {})}};
    return world.game;
  }catch(error){
    world.scene=backup.scene;world.selection=backup.selection;world.undo=backup.undo;world.redo=backup.redo;world.game=backup.game;
    throw error;
  }
}

// Bind a creator-authored challenge to entities that already exist in the
// Matrix scene. This leaves geometry, physics bodies, IDs and unrelated content
// untouched. Rebinding an active challenge needs an explicit progress migration.
export function bindGame(world,spec,bindings){
  if(!gameV2(spec))throw Error('Existing-entity challenges require game schema 2');
  validateGameSpec(spec,id=>!!world.asset(id));
  if(world.game)throw Error('An active challenge must be migrated or reset explicitly');
  if(world.spatial?.stale||world.spatial?.originUnavailable)
    throw Error('Recover the room origin before binding a challenge');
  const candidate={spec:structuredClone(spec),bindings:structuredClone(bindings),
    state:{phase:'playing',score:0,deliveries:[],
      objectiveProgress:Object.fromEntries(spec.objectives.filter(item=>item.kind==='delivered-count')
        .map(item=>[item.roleId,0])),creditedEvents:[],unlockedObjectIds:[]}};
  if(!validSavedGame(candidate,world.scene,id=>!!world.asset(id)))
    throw Error('Challenge bindings need live, unique Matrix objects with matching roles');
  assertGameSensorBodies(world,candidate);
  world.game=candidate;
  return candidate;
}

function assertGameSensorBodies(world,candidate){
  const objects=new Map(world.scene.objects.map(item=>[item.objectId,item]));
  for(const rule of candidate.spec.rules.filter(item=>item.event==='sensor-enter')){
    if(candidate.bindings[rule.actorRoleId].some(id=>objects.get(id)?.rigidBody?.type!=='dynamic')||
       candidate.bindings[rule.targetRoleId].some(id=>objects.get(id)?.rigidBody?.sensor!==true))
      throw Error('Sensor challenge needs dynamic actors and sensor targets');
  }
}

// Scene-only Undo/Redo and low-level Matrix commands cannot silently discard a
// separate game field. Check the proposed scene while it is still staged.
export function assertCompatibleGameScene(world,scene){
  if(!world.game)return scene;
  if(!validSavedGame(world.game,scene,id=>!!world.asset(id)))
    throw Error('World edit would invalidate active game bindings or progress; migrate the game explicitly');
  assertGameSensorBodies({scene},world.game);
  return scene;
}

// Revise declarative text, objectives, consequences, or still-unearned rules
// against an observed game. Earned events cannot be reinterpreted: with credit,
// role and rule definitions remain exact, and the complete saved ledger must
// still validate under the proposed spec and bindings. An incompatible change
// needs a separate explicit progress migration, never an implicit reset.
export function updateGame(world,spec,bindings,expectedSpec,expectedBindings){
  const current=world.game;
  if(!current||!gameV2(current.spec))
    throw Error('Game revision requires an existing version-2 challenge; migrate older games explicitly');
  if(!sameData(expectedSpec,current.spec)||!sameData(expectedBindings,current.bindings))
    throw Error('Game specification or bindings changed since the revision was reviewed');
  if(!validSavedGame(current,world.scene,id=>!!world.asset(id)))
    throw Error('Current game bindings or progress are invalid; recover the world before revising');
  if(world.spatial?.stale||world.spatial?.originUnavailable)
    throw Error('Recover the room origin before revising a challenge');
  if(!gameV2(spec))throw Error('Game revision requires game schema 2');
  validateGameSpec(spec,id=>!!world.asset(id));
  const earned=current.state.creditedEvents.length>0;
  if(earned&&(!sameData(spec.roles,current.spec.roles)||
     !sameData(spec.rules,current.spec.rules)))
    throw Error('Earned game events require unchanged roles and rules; migrate progress explicitly');
  const nextState=earned?structuredClone(current.state):{
    phase:'playing',score:0,deliveries:[],
    objectiveProgress:Object.fromEntries(spec.objectives.filter(item=>item.kind==='delivered-count')
      .map(item=>[item.roleId,0])),creditedEvents:[],unlockedObjectIds:[]};
  const candidate={spec:structuredClone(spec),bindings:structuredClone(bindings),state:nextState};
  if(!validSavedGame(candidate,world.scene,id=>!!world.asset(id)))
    throw Error('Game revision conflicts with earned progress, unlocks, or live object bindings; migrate explicitly');
  assertGameSensorBodies(world,candidate);
  world.game=candidate;
  return candidate;
}

export function gameStatus(world){
  const game=world.game;
  if(!game)return 'No game running.';
  if(!validSavedGame(game,world.scene,id=>!!world.asset(id)))return `${game.spec?.title||'Game'}: bound objects are missing or progress is invalid.`;
  const progress=game.spec.objectives.map(objective=>objective.kind==='score-at-least'?
    `${game.state.score}/${objective.targetPoints} points`:
    `${game.state.objectiveProgress[objective.roleId]}/${objective.targetCount} ${objective.roleId}`).join(' · ');
  const unlocks=gameV2(game.spec)&&game.state.unlockedObjectIds.length?
    ` ${game.state.unlockedObjectIds.length} exit${game.state.unlockedObjectIds.length===1?'':'s'} unlocked.`:'';
  return `${game.spec.title}: ${game.state.phase==='won'?'complete!':'playing'} ${progress}. Score ${game.state.score}.${unlocks}`;
}

export function isGameExitUnlocked(world,objectId){
  return gameV2(world.game?.spec)&&world.game.state.unlockedObjectIds.includes(objectId);
}

// Called by the shared human/agent action path only after a real release or
// collider sensor outcome. Event IDs make persisted credits inspectable; an
// actor can be delivered once even when contacts or reconnects repeat.
export function recordGameEvent(world,{eventId,event,objectId,targetObjectId}){
  const game=world.game;
  if(!validId(eventId)||!['release-near','sensor-enter'].includes(event)||
     !validId(objectId)||!validId(targetObjectId)||
     !game||game.state.phase!=='playing'||game.state.deliveries.includes(objectId)||
     world.spatial?.stale||world.spatial?.originUnavailable)return null;
  if(gameV2(game.spec)&&game.state.creditedEvents.some(item=>item.eventId===eventId))return null;
  const actor=game.spec.roles.find(role=>role.kind==='pickup'&&game.bindings[role.roleId].includes(objectId));
  if(!actor)return null;
  const item=world.scene.objects.find(object=>object.objectId===objectId);
  if(!item||item.anchorId!==floor)return null;
  const target=world.scene.objects.find(object=>object.objectId===targetObjectId);
  if(!target||target.anchorId!==floor)return null;
  const targetRole=game.spec.roles.find(role=>role.kind==='delivery-zone'&&
    game.bindings[role.roleId].includes(targetObjectId));
  if(!targetRole)return null;
  const rule=game.spec.rules.find(rule=>rule.event===event&&rule.actorRoleId===actor.roleId&&
    rule.targetRoleId===targetRole.roleId);
  if(!rule)return null;
  const a=item.transform.position,b=target.transform.position;
  if(Math.hypot(a.x-b.x,a.z-b.z)>rule.distanceMeters||Math.abs(a.y-b.y)>1)return null;
  game.state.deliveries.push(objectId);
  game.state.score+=rule.scorePoints;
  if(gameV2(game.spec))game.state.creditedEvents.push({eventId,event,objectId,targetObjectId,
    scorePoints:rule.scorePoints});
  if(Object.hasOwn(game.state.objectiveProgress,actor.roleId))
    game.state.objectiveProgress[actor.roleId]=game.bindings[actor.roleId].filter(id=>game.state.deliveries.includes(id)).length;
  if(game.spec.objectives.every(objective=>achieved(objective,game.state))){
    game.state.phase='won';
    if(gameV2(game.spec))game.state.unlockedObjectIds=game.spec.consequences.flatMap(item=>game.bindings[item.roleId]);
  }
  return {eventId,objectId,targetObjectId,credited:true,completed:game.state.phase==='won',
    unlockedObjectIds:gameV2(game.spec)?[...game.state.unlockedObjectIds]:[],
    message:game.state.phase==='won'?`${game.spec.title} complete! Score ${game.state.score}.`:
      `Delivered ${actor.roleId}. Score ${game.state.score}.`};
}

export function deliverMovedObject(world,objectId){
  const game=world.game;
  if(!game||!game.spec?.roles)return null;
  const actor=game.spec.roles.find(role=>role.kind==='pickup'&&game.bindings[role.roleId].includes(objectId));
  if(!actor)return null;
  for(const rule of game.spec.rules.filter(rule=>rule.event==='release-near'&&rule.actorRoleId===actor.roleId)){
    for(const targetObjectId of game.bindings[rule.targetRoleId]){
      const result=recordGameEvent(world,{eventId:crypto.randomUUID(),event:'release-near',objectId,targetObjectId});
      if(result)return result.message;
    }
  }
  return null;
}
