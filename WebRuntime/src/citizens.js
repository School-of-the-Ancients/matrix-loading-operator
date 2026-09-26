// Bounded desktop Citizens fixture. Policy and needs live here; MatrixWorld owns
// scene objects and validates every placement/move. No Agent Portal access.
import {ANCHOR_ID,INTERACTION_USE_MARGIN_METRES,MAX_OBJECTS,ROOM_ID,
  interactionWorldPoint,validInteractionDescriptor} from './protocol.js';
import {checkedMove,planPath,segmentClear} from './citizens_navigation.js';

const VERSION=7;
const INTERACTION_VERSION=6;
const ROUTE_VERSION=5;
const COMPLETION_VERSION=4;
const SOCIAL_VERSION=3;
const RESERVATION_VERSION=2;
const LEGACY_VERSION=1;
const MOVE_METRES=.28;
const ACTOR_RADIUS=.18;
const APPROACH_MARGIN=.06;
const FLOOR_TARGET_LIMIT=99.8;
const ARRIVAL_METRES=.08;
const MAX_TRAVEL_TICKS=60;
const MAX_ROUTE_RETRIES=3;
const LEASE_TICKS=MAX_TRAVEL_TICKS+12;
const MAX_WAIT_TICKS=96;
const MAX_LOG=80;
const MAX_SOCIAL_EVENTS=24;
const MAX_COMPLETED_SOCIAL=10;
const OFFER_TICKS=4;
const ACTIVE_TICKS=MAX_TRAVEL_TICKS+12;
const SOCIAL_USE_TICKS=3;
const SOCIAL_COOLDOWN_TICKS=24;
const SOCIAL_WINDOW_TICKS=12;
const NEEDS=['hunger','energy','fun'];
const ACTIVITIES=['rest','eat','explore'];
const PRIORITIES=['high','default','low'];
const CLOCK_SPEEDS=[1,4,16];
const MAX_ROUTINES=6;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,expected)=>plain(value)&&Object.keys(value).sort().join('|')===expected.slice().sort().join('|');
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const sameJson=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const validUtf16=value=>{
  for(let index=0;index<value.length;index++){
    const code=value.charCodeAt(index);
    if(code>=0xd800&&code<=0xdbff){
      const next=value.charCodeAt(++index);
      if(!(next>=0xdc00&&next<=0xdfff))return false;
    }else if(code>=0xdc00&&code<=0xdfff)return false;
  }
  return true;
};
const boundedText=(value,max)=>typeof value==='string'&&value.length<=max&&
  !/[\x00-\x1f]/.test(value)&&validUtf16(value);
const boundedPrefix=(value,max)=>{
  let end=Math.min(value.length,max);
  const last=value.charCodeAt(end-1);
  if(last>=0xd800&&last<=0xdbff)end--;
  return value.slice(0,end);
};
const clone=value=>structuredClone(value);
const round=value=>Math.round(value*100)/100;
const round6=value=>Math.round(value*1000000)/1000000;
const clamp=value=>Math.max(0,Math.min(100,round(value)));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const minuteOfDay=tick=>tick%1440;
const routineActive=(routine,tick)=>{
  const minute=minuteOfDay(tick);
  return routine.startMinute<routine.endMinute?
    minute>=routine.startMinute&&minute<routine.endMinute:
    minute>=routine.startMinute||minute<routine.endMinute;
};
const defaultRoutines=id=>[
  {id:'morning-meal',kind:'eat',priority:'default',startMinute:420,
    endMinute:600,baseWeight:id==='ada'?22:18,stationId:null},
  {id:'morning-walk',kind:'explore',priority:'default',startMinute:480,
    endMinute:660,baseWeight:id==='ada'?16:22,stationId:null},
  {id:'daytime-walk',kind:'explore',priority:'low',startMinute:660,
    endMinute:1080,baseWeight:12,stationId:null},
  {id:'evening-rest',kind:'rest',priority:'high',startMinute:1260,
    endMinute:360,baseWeight:id==='ada'?24:20,stationId:null}
];
const sameTransform=(a,b)=>a&&b&&['position','rotation','scale'].every(part=>
  ['x','y','z'].every(axis=>a[part]?.[axis]===b[part]?.[axis]));
const objectById=(world,id)=>world.scene.objects.find(object=>object.objectId===id);
const positionOf=(world,id)=>objectById(world,id)?.transform?.position;
// Runtime motion and GLB clips can move rendered geometry without changing its
// authored transform. Citizens must not route through that stale footprint.
const hasActiveTransformOwner=object=>!!(object?.physics||
  object?.component?.status==='running'||
  object?.behaviors?.some(behavior=>behavior.enabled&&!behavior.paused)||
  object?.animation?.loopClip);
const supportedResident=object=>object?.assetId==='orb'&&
  object.anchorId===ANCHOR_ID&&!object.component&&!hasActiveTransformOwner(object)&&
  Math.abs(object.transform?.position?.y)<=.05&&
  ['x','y','z'].every(axis=>object.transform?.scale?.[axis]===.7);

function navigationObstacles(world,actorObjectId=''){
  if(world.game!==null&&world.game!==undefined)
    throw Error('Pause or remove the active game before Citizens navigates');
  const obstacles=[];
  for(const object of world.scene.objects){
    if(object.objectId===actorObjectId)continue;
    const asset=world.asset?.(object.assetId);
    // The catalog footprint is measured at the GLB's rest pose. A one-clip
    // model plays automatically, and a select clip can move mesh nodes while
    // the authored object transform stays fixed. No swept bounds exist yet.
    if(asset?.url&&asset.geometry?.animationClips?.length)
      throw Error(`Navigation cannot use animated GLB ${object.objectId}`);
    if(object.anchorId!==ANCHOR_ID||hasActiveTransformOwner(object))
      throw Error(`Navigation cannot use moving or anchored object ${object.objectId}`);
    const bounds=asset?.localBounds;
    const transform=object.transform;
    const scale=asset?.spawnScale??1;
    if(!bounds||!transform||!finite(scale)||scale<=0||
      !finite(transform.position?.x)||!finite(transform.position?.y)||
      !finite(transform.position?.z)||
      !finite(transform.rotation?.y)||Math.abs(transform.rotation?.x)>0.01||
      Math.abs(transform.rotation?.z)>0.01||
      !finite(transform.scale?.x)||!finite(transform.scale?.z)||
      !finite(bounds.size?.x)||!finite(bounds.size?.z))
      throw Error(`Navigation needs upright measured bounds for ${object.objectId}`);
    if(Math.abs(transform.position.y)>.05)
      throw Error(`Navigation needs floor-aligned object ${object.objectId}`);
    const halfX=bounds.size.x*transform.scale.x*scale/2;
    const halfZ=bounds.size.z*transform.scale.z*scale/2;
    if(halfX<=0||halfZ<=0||halfX>20||halfZ>20)
      throw Error(`Navigation bounds for ${object.objectId} are unsupported`);
    // Catalog bounds are only an authored claim. An imported model must have
    // loaded and been measured for this exact scene object before routing.
    if(asset.url&&!world.renderedAssetVerified?.(object))
      throw Error(`Navigation is waiting for verified rendered GLB ${object.objectId}`);
    obstacles.push({id:object.objectId,cx:transform.position.x,
      cz:transform.position.z,halfX,halfZ,
      yawRadians:-transform.rotation.y*Math.PI/180});
  }
  return obstacles;
}

function stationApproach(world,actorObjectId,station,actorPosition=null,
  extraObstacles=[],preferredGoal=null){
  const actor=actorPosition||positionOf(world,actorObjectId);
  const object=objectById(world,station.objectId);
  if(!actor||!object)return {ok:false,reason:'Interaction actor or target is missing'};
  let obstacles;
  try{obstacles=[...navigationObstacles(world,actorObjectId),...extraObstacles];}
  catch(error){return {ok:false,reason:error.message};}
  const footprint=obstacles.find(item=>item.id===station.objectId);
  if(!footprint)return {ok:false,reason:'Interaction target has no navigation bounds'};
  if(station.interaction){
    const asset=world.asset?.(object.assetId);
    if(!asset)return {ok:false,reason:'Interaction asset is unavailable'};
    const goal=interactionWorldPoint(object,asset,station.interaction.approachPose);
    const use=interactionWorldPoint(object,asset,station.interaction.usePose);
    if(distance(goal,use)>station.interaction.rangeMeters-
       INTERACTION_USE_MARGIN_METRES+1e-9)
      return {ok:false,reason:'Authored interaction pose is outside use range'};
    const route=planPath({start:actor,goal,obstacles,actorRadius:ACTOR_RADIUS});
    return route.ok?{ok:true,target:goal,route,index:0}:
      {ok:false,reason:route.reason,code:'no_path'};
  }
  const range=station.kind==='eat'?.9:.8;
  if(preferredGoal&&distance(preferredGoal,object.transform.position)<=range-.01){
    const route=planPath({start:actor,goal:preferredGoal,obstacles,
      actorRadius:ACTOR_RADIUS});
    if(route.ok)return {ok:true,target:preferredGoal,route,index:-1};
  }
  const directions=[
    {x:0,z:footprint.halfZ+ACTOR_RADIUS+APPROACH_MARGIN},
    {x:-footprint.halfX-ACTOR_RADIUS-APPROACH_MARGIN,z:0},
    {x:footprint.halfX+ACTOR_RADIUS+APPROACH_MARGIN,z:0},
    {x:0,z:-footprint.halfZ-ACTOR_RADIUS-APPROACH_MARGIN}
  ];
  const cos=Math.cos(footprint.yawRadians),sin=Math.sin(footprint.yawRadians);
  let best=null,reason='No reachable interaction pose';
  for(const [index,offset] of directions.entries()){
    const goal={x:round6(footprint.cx+offset.x*cos-offset.z*sin),
      z:round6(footprint.cz+offset.x*sin+offset.z*cos)};
    if(distance(goal,object.transform.position)>range-.01)continue;
    const route=planPath({start:actor,goal,obstacles,actorRadius:ACTOR_RADIUS});
    if(!route.ok){reason=route.reason;continue;}
    if(!best||route.lengthMeters<best.route.lengthMeters-1e-6||
      Math.abs(route.lengthMeters-best.route.lengthMeters)<=1e-6&&index<best.index)
      best={ok:true,target:goal,route,index};
  }
  return best||{ok:false,reason,code:'no_path'};
}

function fixtureApproach(world,station){
  const point=positionOf(world,station.objectId);
  return point?{x:point.x,z:point.z+(station.kind==='rest'?.62:.68)}:null;
}

function assertWorld(world){
  if(!world||typeof world.execute!=='function'||world.scene?.schemaVersion!==1||
     world.scene.roomId!==ROOM_ID||world.spatial)
    throw Error('Citizens demo requires the ready desktop virtual room');
}

function validNeeds(needs){
  return keys(needs,NEEDS)&&NEEDS.every(key=>finite(needs[key])&&needs[key]>=0&&needs[key]<=100);
}

function validPreferences(preferences){
  return keys(preferences,ACTIVITIES)&&ACTIVITIES.every(key=>
    finite(preferences[key])&&preferences[key]>=.2&&preferences[key]<=2);
}

function validActivity(activity,version=LEGACY_VERSION){
  if(activity===null)return true;
  if(!keys(activity,['kind','stationId','phase','remainingTicks','travelTicks','target',
    ...(version>=RESERVATION_VERSION?['executionId']:[]),
    ...(version>=ROUTE_VERSION?['routeRetries','routeGeometryId']:[])])||
     !ACTIVITIES.includes(activity.kind)||!['travel','use'].includes(activity.phase)||
     !integer(activity.remainingTicks,0,12)||!integer(activity.travelTicks,0,MAX_TRAVEL_TICKS))return false;
  if(version>=ROUTE_VERSION&&(!integer(activity.routeRetries,0,MAX_ROUTE_RETRIES)||
    (activity.routeGeometryId!==null&&
      (!boundedText(activity.routeGeometryId,128)||!activity.routeGeometryId))))return false;
  const targetLimit=version>=COMPLETION_VERSION?100:5;
  if(activity.kind==='explore')return activity.stationId===null&&
    keys(activity.target,['x','z'])&&finite(activity.target.x)&&finite(activity.target.z)&&
    Math.abs(activity.target.x)<=targetLimit&&Math.abs(activity.target.z)<=targetLimit;
  return boundedText(activity.stationId,32)&&activity.stationId.length>0&&activity.target===null;
}

function validStateV1(world,state){
  assertWorld(world);
  if(!keys(state,['schemaVersion','world','seed','rngState','requestSequence','clockTick',
    'paused','residents','stations','log'])||state.schemaVersion!==LEGACY_VERSION||
    !keys(state.world,['schemaVersion','roomId'])||state.world.schemaVersion!==1||
    state.world.roomId!==world.scene.roomId||!integer(state.seed,1,0xffffffff)||
    !integer(state.rngState,0,0xffffffff)||!integer(state.requestSequence,0,1000000000)||
    !integer(state.clockTick,0,1000000000)||typeof state.paused!=='boolean'||
    !Array.isArray(state.residents)||state.residents.length<1||state.residents.length>4||
    !Array.isArray(state.stations)||state.stations.length!==2||
    !Array.isArray(state.log)||state.log.length>MAX_LOG)throw Error('Invalid Citizens state');
  const residentIds=new Set(),stationIds=new Set(),stationKinds=new Set(),objectIds=new Set();
  for(const resident of state.residents){
    if(!keys(resident,['id','name','objectId','needs','preferences','activity','cooldowns','lastOutcome'])||
       !boundedText(resident.id,32)||!resident.id||residentIds.has(resident.id)||
       !boundedText(resident.name,40)||!resident.name||!boundedText(resident.objectId,128)||
       objectIds.has(resident.objectId)||!validNeeds(resident.needs)||
       !validPreferences(resident.preferences)||!validActivity(resident.activity)||
       !keys(resident.cooldowns,ACTIVITIES)||!ACTIVITIES.every(key=>
         integer(resident.cooldowns[key],0,1000000012))||
       !boundedText(resident.lastOutcome,160))throw Error('Invalid Citizens resident');
    const object=objectById(world,resident.objectId);
    if(!supportedResident(object))
      throw Error('Citizens resident object is missing or incompatible');
    residentIds.add(resident.id);objectIds.add(resident.objectId);
  }
  for(const station of state.stations){
    if(!keys(station,['id','kind','objectId','capacity','holder'])||
       !boundedText(station.id,32)||!station.id||stationIds.has(station.id)||
       !['rest','eat'].includes(station.kind)||stationKinds.has(station.kind)||
       !boundedText(station.objectId,128)||
       objectIds.has(station.objectId)||station.capacity!==1||
       (station.holder!==null&&!residentIds.has(station.holder)))
      throw Error('Invalid Citizens station');
    const object=objectById(world,station.objectId);
    if(object?.assetId!==(station.kind==='rest'?'chair':'table')||
       object.anchorId!==ANCHOR_ID||hasActiveTransformOwner(object))
      throw Error('Citizens station object is missing or incompatible');
    stationIds.add(station.id);stationKinds.add(station.kind);objectIds.add(station.objectId);
  }
  for(const resident of state.residents){
    const action=resident.activity;
    if(action?.stationId!==null&&action){
      const station=state.stations.find(item=>item.id===action.stationId);
      if(!station||station.kind!==action.kind||station.holder!==resident.id)
        throw Error('Invalid Citizens reservation');
    }
  }
  for(const station of state.stations)if(station.holder!==null){
    const resident=state.residents.find(item=>item.id===station.holder);
    if(resident?.activity?.stationId!==station.id)
      throw Error('Invalid Citizens reservation');
  }
  const events=new Set(['selected','blocked','arrived','completed','failed','paused','resumed']);
  for(const entry of state.log)if(!keys(entry,['tick','residentId','event','message'])||
    !integer(entry.tick,0,state.clockTick)||!boundedText(entry.residentId,32)||
    (entry.residentId!==''&&!residentIds.has(entry.residentId))||
    !events.has(entry.event)||!boundedText(entry.message,160))
    throw Error('Invalid Citizens log');
}

function migrateV1(world,saved){
  validStateV1(world,saved);
  const state=clone(saved);
  state.schemaVersion=RESERVATION_VERSION;
  state.actionSequence=0;
  state.retiredResidentIds=[];
  // Resident order is stable, so a mid-action v1 checkpoint gets repeatable
  // execution IDs. The existing holder and its action migrate as one claim.
  for(const resident of state.residents)if(resident.activity)
    resident.activity.executionId=++state.actionSequence;
  state.stations=state.stations.map(station=>{
    const holder=station.holder;
    const activity=state.residents.find(resident=>resident.id===holder)?.activity;
    return {id:station.id,kind:station.kind,objectId:station.objectId,
      capacity:station.capacity,
      claim:holder===null?null:{residentId:holder,executionId:activity.executionId,
        expiresTick:state.clockTick+LEASE_TICKS},waiters:[]};
  });
  return state;
}

function validStateV2(world,state,activityVersion=RESERVATION_VERSION,
  stationVersion=RESERVATION_VERSION){
  assertWorld(world);
  if(!keys(state,['schemaVersion','world','seed','rngState','requestSequence',
    'actionSequence','clockTick','paused','residents','retiredResidentIds',
    'stations','log'])||state.schemaVersion!==RESERVATION_VERSION||
    !keys(state.world,['schemaVersion','roomId'])||state.world.schemaVersion!==1||
    state.world.roomId!==world.scene.roomId||!integer(state.seed,1,0xffffffff)||
    !integer(state.rngState,0,0xffffffff)||!integer(state.requestSequence,0,1000000000)||
    !integer(state.actionSequence,0,1000000000)||!integer(state.clockTick,0,1000000000)||
    typeof state.paused!=='boolean'||!Array.isArray(state.residents)||
    state.residents.length>4||!Array.isArray(state.retiredResidentIds)||
    state.retiredResidentIds.length>4||
    state.residents.length+state.retiredResidentIds.length>4||
    (state.residents.length===0&&!state.paused)||
    !Array.isArray(state.stations)||state.stations.length>2||
    !Array.isArray(state.log)||state.log.length>MAX_LOG)
    throw Error('Invalid Citizens state');
  const residentIds=new Set(),retiredIds=new Set(),stationIds=new Set();
  const stationKinds=new Set(),objectIds=new Set(),executionIds=new Set();
  for(const retiredId of state.retiredResidentIds){
    if(!boundedText(retiredId,32)||!retiredId||retiredIds.has(retiredId))
      throw Error('Invalid Citizens retired resident');
    retiredIds.add(retiredId);
  }
  for(const resident of state.residents){
    const action=resident?.activity;
    if(!keys(resident,['id','name','objectId','needs','preferences','activity',
      'cooldowns','lastOutcome'])||!boundedText(resident.id,32)||!resident.id||
      residentIds.has(resident.id)||retiredIds.has(resident.id)||
      !boundedText(resident.name,40)||!resident.name||
      !boundedText(resident.objectId,128)||objectIds.has(resident.objectId)||
      !validNeeds(resident.needs)||!validPreferences(resident.preferences)||
      !validActivity(action,activityVersion)||!keys(resident.cooldowns,ACTIVITIES)||
      !ACTIVITIES.every(key=>integer(resident.cooldowns[key],0,1000000012))||
      !boundedText(resident.lastOutcome,160))throw Error('Invalid Citizens resident');
    if(action){
      if(!integer(action.executionId,1,state.actionSequence)||
        executionIds.has(action.executionId))throw Error('Invalid Citizens execution');
      executionIds.add(action.executionId);
    }
    const object=objectById(world,resident.objectId);
    if(!supportedResident(object))
      throw Error('Citizens resident object is missing or incompatible');
    residentIds.add(resident.id);objectIds.add(resident.objectId);
  }
  const waitingIds=new Set();
  for(const station of state.stations){
    const selectedApproach=stationVersion>=INTERACTION_VERSION&&station.approachMode!==undefined;
    if(!keys(station,['id','kind','objectId','capacity','claim','waiters',
      ...(stationVersion>=INTERACTION_VERSION?['interaction']:[]),
      ...(selectedApproach?['approachMode']:[])])||
      (selectedApproach&&station.approachMode!=='selected')||
      !boundedText(station.id,32)||!station.id||stationIds.has(station.id)||
      !['rest','eat'].includes(station.kind)||stationKinds.has(station.kind)||
      !boundedText(station.objectId,128)||objectIds.has(station.objectId)||
      station.capacity!==1||!Array.isArray(station.waiters)||
      station.waiters.length>4)throw Error('Invalid Citizens station');
    const object=objectById(world,station.objectId);
    const builtIn=object?.assetId===(station.kind==='rest'?'chair':'table');
    const authored=stationVersion>=INTERACTION_VERSION&&station.interaction!==null&&
      object?.assetId?.startsWith('web:')&&
      validInteractionDescriptor(station.interaction)&&
      sameJson(station.interaction,object?.interaction)&&
      station.interaction.kind===station.kind&&
      (!world.asset||world.asset(object.assetId)?.sha256===
        station.interaction.assetSha256);
    if((stationVersion>=INTERACTION_VERSION&&builtIn&&station.interaction!==null)||
      (!builtIn&&!authored)||
      object.anchorId!==ANCHOR_ID||hasActiveTransformOwner(object))
      throw Error('Citizens station object is missing or incompatible');
    stationIds.add(station.id);stationKinds.add(station.kind);
    objectIds.add(station.objectId);
    if(station.claim!==null){
      const claim=station.claim;
      const resident=state.residents.find(item=>item.id===claim?.residentId);
      if(!keys(claim,['residentId','executionId','expiresTick'])||
        !resident||!integer(claim.executionId,1,state.actionSequence)||
        !integer(claim.expiresTick,state.clockTick+1,state.clockTick+LEASE_TICKS)||
        resident.activity?.kind!==station.kind||
        resident.activity.stationId!==station.id||
        resident.activity.executionId!==claim.executionId)
        throw Error('Invalid Citizens reservation');
    }
    let previousTick=-1,previousExecution=0;
    for(const waiter of station.waiters){
      const resident=state.residents.find(item=>item.id===waiter?.residentId);
      if(!keys(waiter,['residentId','executionId','enqueuedTick'])||
        !resident||resident.activity!==null||waitingIds.has(waiter.residentId)||
        !integer(waiter.executionId,1,state.actionSequence)||
        executionIds.has(waiter.executionId)||
        !integer(waiter.enqueuedTick,0,state.clockTick)||
        state.clockTick-waiter.enqueuedTick>=MAX_WAIT_TICKS||
        waiter.enqueuedTick<previousTick||
        (waiter.enqueuedTick===previousTick&&waiter.executionId<=previousExecution))
        throw Error('Invalid Citizens waiter');
      waitingIds.add(waiter.residentId);
      executionIds.add(waiter.executionId);
      previousTick=waiter.enqueuedTick;
      previousExecution=waiter.executionId;
    }
  }
  for(const resident of state.residents){
    const action=resident.activity;
    if(action?.stationId!==null&&action){
      const station=state.stations.find(item=>item.id===action.stationId);
      if(!station||station.kind!==action.kind||
        station.claim?.residentId!==resident.id||
        station.claim.executionId!==action.executionId)
        throw Error('Invalid Citizens reservation');
    }
  }
  const events=new Set(['selected','blocked','arrived','completed','failed',
    'paused','resumed','waiting','released','retired','expired',
    ...(activityVersion>=ROUTE_VERSION?['rerouted']:[])]);
  for(const entry of state.log)if(!keys(entry,['tick','residentId','event','message'])||
    !integer(entry.tick,0,state.clockTick)||!boundedText(entry.residentId,32)||
    (entry.residentId!==''&&!residentIds.has(entry.residentId)&&
      !retiredIds.has(entry.residentId))||!events.has(entry.event)||
    !boundedText(entry.message,160))throw Error('Invalid Citizens log');
}

function migrateV2(world,saved){
  validStateV2(world,saved);
  const state=clone(saved);
  state.schemaVersion=SOCIAL_VERSION;
  state.socialSession=null;
  state.socialEvents=[];
  state.nextSocialTick=Math.max(35,state.clockTick+SOCIAL_COOLDOWN_TICKS);
  state.relationships=[];
  const residents=[...state.residents].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  for(let i=0;i<residents.length;i++)for(let j=i+1;j<residents.length;j++)
    state.relationships.push({a:residents[i].id,b:residents[j].id,score:50});
  for(const resident of state.residents)resident.socialSessionId=null;
  return state;
}

function validStateV3(world,state,activityVersion=SOCIAL_VERSION,
  stationVersion=SOCIAL_VERSION){
  if(!keys(state,['schemaVersion','world','seed','rngState','requestSequence',
    'actionSequence','clockTick','paused','residents','retiredResidentIds',
    'stations','log','socialSession','socialEvents','relationships','nextSocialTick'])||
    state.schemaVersion!==SOCIAL_VERSION||
    !integer(state.nextSocialTick,0,1000000100)||
    !Array.isArray(state.socialEvents)||state.socialEvents.length>MAX_SOCIAL_EVENTS||
    !Array.isArray(state.relationships)||state.relationships.length>6)
    throw Error('Invalid Citizens social state');
  // Preserve the exact v2 checks for claims, waiters, bindings, and activity.
  const v2=clone(state);
  v2.schemaVersion=RESERVATION_VERSION;
  delete v2.socialSession;delete v2.socialEvents;
  delete v2.relationships;delete v2.nextSocialTick;
  for(const resident of v2.residents){
    if(!keys(resident,['id','name','objectId','needs','preferences','activity',
      'cooldowns','lastOutcome','socialSessionId']))
      throw Error('Invalid Citizens social resident');
    delete resident.socialSessionId;
  }
  validStateV2(world,v2,activityVersion,stationVersion);
  const ids=new Set([...state.residents.map(resident=>resident.id),
    ...state.retiredResidentIds]);
  const relationshipPairs=new Set();
  let previousPair='';
  for(const relation of state.relationships){
    if(!keys(relation,['a','b','score'])||!ids.has(relation.a)||
      !ids.has(relation.b)||relation.a>=relation.b||
      !finite(relation.score)||relation.score<0||relation.score>100)
      throw Error('Invalid Citizens relationship');
    const pair=`${relation.a}\u0000${relation.b}`;
    if(pair<=previousPair||relationshipPairs.has(pair))
      throw Error('Invalid Citizens relationship order');
    previousPair=pair;relationshipPairs.add(pair);
  }
  const eventIds=new Set();
  let previousTick=-1;
  const events=new Set(['initiated','accepted','declined','timed_out','ended','interrupted']);
  for(const entry of state.socialEvents){
    const match=typeof entry?.id==='string'?entry.id.match(
      /^social-([0-9]+)-([0-9]+)-(initiated|accepted|declined|timed_out|ended|interrupted)-([0-9]+)$/):null;
    if(!keys(entry,['id','event','tick','initiatorId','inviteeId','requestId'])||
      !events.has(entry.event)||!integer(entry.tick,0,state.clockTick)||
      entry.tick<previousTick||!ids.has(entry.initiatorId)||
      !ids.has(entry.inviteeId)||entry.initiatorId===entry.inviteeId||
      !boundedText(entry.id,96)||!match||Number(match[1])!==state.seed||
      !integer(Number(match[2]),1,state.actionSequence)||
      entry.id!==`social-${state.seed}-${Number(match[2])}-${entry.event}-${entry.tick}`||
      eventIds.has(entry.id)||!boundedText(entry.requestId,128)||
      (entry.event!=='ended'&&entry.requestId!==''))
      throw Error('Invalid Citizens social event');
    if(entry.event==='ended'){
      const request=entry.requestId.match(/^citizens-([0-9]+)-social-([0-9]+)-([0-9]+)$/);
      if(!match||!request||Number(match[1])!==state.seed||
        match[1]!==request[1]||match[2]!==request[2]||
        !integer(Number(request[3]),1,state.requestSequence)||
        entry.requestId!==`citizens-${state.seed}-social-${Number(match[2])}-${Number(request[3])}`)
        throw Error('Invalid Citizens social receipt reference');
    }
    eventIds.add(entry.id);previousTick=entry.tick;
  }
  const session=state.socialSession;
  if(session===null){
    if(state.residents.some(resident=>resident.socialSessionId!==null))
      throw Error('Invalid Citizens social participant');
    return;
  }
  if(!keys(session,['id','executionId','initiatorId','inviteeId','phase',
    'startedTick','expiresTick','acceptedTick','travelTicks','remainingTicks'])||
    !integer(session.executionId,1,state.actionSequence)||
    session.id!==`social-${state.seed}-${session.executionId}`||
    !['offered','active'].includes(session.phase)||
    !integer(session.startedTick,0,state.clockTick)||
    !integer(session.expiresTick,state.clockTick+1,1000000100)||
    !integer(session.travelTicks,0,MAX_TRAVEL_TICKS)||
    !integer(session.remainingTicks,0,SOCIAL_USE_TICKS)||
    session.initiatorId===session.inviteeId)
    throw Error('Invalid Citizens social session');
  const participants=[session.initiatorId,session.inviteeId].map(id=>
    state.residents.find(resident=>resident.id===id));
  if(participants.some(resident=>!resident||resident.socialSessionId!==session.id||
    resident.activity||state.stations.some(station=>station.waiters.some(waiter=>
      waiter.residentId===resident.id)))||
    state.residents.some(resident=>!participants.includes(resident)&&
      resident.socialSessionId!==null)||
    state.residents.some(resident=>resident.activity?.executionId===session.executionId)||
    state.stations.some(station=>station.waiters.some(waiter=>
      waiter.executionId===session.executionId)))
    throw Error('Invalid Citizens social participant');
  if(session.phase==='offered'){
    if(session.acceptedTick!==null||session.expiresTick!==session.startedTick+OFFER_TICKS||
      session.travelTicks!==0||session.remainingTicks!==SOCIAL_USE_TICKS)
      throw Error('Invalid Citizens social offer');
  }else if(!integer(session.acceptedTick,session.startedTick+1,
      Math.min(state.clockTick,session.startedTick+OFFER_TICKS-1))||
    session.expiresTick!==session.acceptedTick+ACTIVE_TICKS||
    session.travelTicks>state.clockTick-session.acceptedTick)
    throw Error('Invalid Citizens social acceptance');
}

function socialCompletionFromEvent(state,event){
  const match=event.id.match(/^social-([0-9]+)-([0-9]+)-ended-([0-9]+)$/);
  return {sessionId:`social-${state.seed}-${Number(match[2])}`,
    requestId:event.requestId,tick:event.tick};
}

function migrateV3(world,saved){
  validStateV3(world,saved);
  const state=clone(saved);
  const relations=new Map(state.relationships.map(relation=>
    [`${relation.a}\u0000${relation.b}`,relation]));
  for(const relation of state.relationships)relation.completed=[];
  for(const event of state.socialEvents){
    if(event.event!=='ended')continue;
    const [a,b]=[event.initiatorId,event.inviteeId].sort();
    const relation=relations.get(`${a}\u0000${b}`);
    if(!relation||relation.completed.length>=MAX_COMPLETED_SOCIAL)
      throw Error('Citizens v3 relationship history is incomplete or inconsistent');
    relation.completed.push(socialCompletionFromEvent(state,event));
  }
  for(const relation of state.relationships)
    if(relation.score!==Math.min(100,50+5*relation.completed.length))
      throw Error('Citizens v3 relationship history is incomplete or inconsistent');
  state.schemaVersion=COMPLETION_VERSION;
  validStateV4(world,state);
  return state;
}

function validStateV4(world,state,activityVersion=COMPLETION_VERSION,
  stationVersion=COMPLETION_VERSION){
  if(!state||state.schemaVersion!==COMPLETION_VERSION||!Array.isArray(state.relationships))
    throw Error('Invalid Citizens completed social state');
  const v3=clone(state);
  v3.schemaVersion=SOCIAL_VERSION;
  for(const relation of v3.relationships)if(relation&&typeof relation==='object')
    delete relation.completed;
  validStateV3(world,v3,activityVersion,stationVersion);
  const bySession=new Map(),requestIds=new Set();
  for(const relation of state.relationships){
    if(!keys(relation,['a','b','score','completed'])||
      !Array.isArray(relation.completed)||relation.completed.length>MAX_COMPLETED_SOCIAL||
      relation.score!==Math.min(100,50+5*relation.completed.length))
      throw Error('Invalid Citizens completed relationship');
    let lastTick=-1,lastExecution=0,lastRequest=0;
    for(const record of relation.completed){
      const session=typeof record?.sessionId==='string'?
        record.sessionId.match(/^social-([0-9]+)-([0-9]+)$/):null;
      const request=typeof record?.requestId==='string'?
        record.requestId.match(/^citizens-([0-9]+)-social-([0-9]+)-([0-9]+)$/):null;
      const execution=Number(session?.[2]),sequence=Number(request?.[3]);
      if(!keys(record,['sessionId','requestId','tick'])||
        !boundedText(record.sessionId,32)||!boundedText(record.requestId,128)||
        !session||!request||!integer(execution,1,state.actionSequence)||
        !integer(sequence,1,state.requestSequence)||
        record.sessionId!==`social-${state.seed}-${execution}`||
        record.requestId!==`citizens-${state.seed}-social-${execution}-${sequence}`||
        !integer(record.tick,1,state.clockTick)||record.tick<=lastTick||
        execution<=lastExecution||sequence<=lastRequest||
        record.sessionId===state.socialSession?.id||
        bySession.has(record.sessionId)||requestIds.has(record.requestId))
        throw Error('Invalid Citizens completed social receipt');
      bySession.set(record.sessionId,{relation,record});
      requestIds.add(record.requestId);
      lastTick=record.tick;lastExecution=execution;lastRequest=sequence;
    }
  }
  for(const event of state.socialEvents){
    if(event.event!=='ended')continue;
    const completion=socialCompletionFromEvent(state,event);
    const match=bySession.get(completion.sessionId);
    const [a,b]=[event.initiatorId,event.inviteeId].sort();
    if(!match||match.relation.a!==a||match.relation.b!==b||
      match.record.requestId!==completion.requestId||
      match.record.tick!==completion.tick)
      throw Error('Invalid Citizens completed social event');
  }
}

function migrateV4(world,saved){
  validStateV4(world,saved);
  const state=clone(saved);
  state.schemaVersion=ROUTE_VERSION;
  for(const resident of state.residents)if(resident.activity){
    resident.activity.routeRetries=0;
    resident.activity.routeGeometryId=null;
  }
  validStateV5(world,state);
  return state;
}

function validStateV5(world,state,stationVersion=ROUTE_VERSION){
  if(!state||state.schemaVersion!==ROUTE_VERSION)
    throw Error('Invalid Citizens route recovery state');
  const v4=clone(state);
  v4.schemaVersion=COMPLETION_VERSION;
  validStateV4(world,v4,ROUTE_VERSION,stationVersion);
}

function migrateV5(world,saved){
  validStateV5(world,saved);
  const state=clone(saved);
  state.schemaVersion=INTERACTION_VERSION;
  for(const station of state.stations)station.interaction=null;
  validStateV6(world,state);
  return state;
}

function validStateV6(world,state){
  if(!state||state.schemaVersion!==INTERACTION_VERSION)
    throw Error('Invalid Citizens interaction state');
  const v5=clone(state);
  v5.schemaVersion=ROUTE_VERSION;
  validStateV5(world,v5,INTERACTION_VERSION);
}

function migrateV6(world,saved){
  validStateV6(world,saved);
  const state=clone(saved);
  state.schemaVersion=VERSION;
  state.clockSpeed=1;
  for(const resident of state.residents){
    resident.routines=defaultRoutines(resident.id);
    resident.lastDecision=null;
  }
  validStateV7(world,state);
  return state;
}

function validStateV7(world,state){
  if(!keys(state,['schemaVersion','world','seed','rngState','requestSequence',
    'actionSequence','clockTick','paused','clockSpeed','residents',
    'retiredResidentIds','stations','log','socialSession','socialEvents',
    'relationships','nextSocialTick'])||state.schemaVersion!==VERSION||
    !CLOCK_SPEEDS.includes(state.clockSpeed))
    throw Error('Invalid Citizens virtual-day state');
  const v6=clone(state);
  v6.schemaVersion=INTERACTION_VERSION;
  delete v6.clockSpeed;
  for(const resident of v6.residents){
    if(!keys(resident,['id','name','objectId','needs','preferences','activity',
      'cooldowns','lastOutcome','socialSessionId','routines','lastDecision']))
      throw Error('Invalid Citizens routine resident');
    delete resident.routines;delete resident.lastDecision;
  }
  validStateV6(world,v6);
  for(const resident of state.residents){
    if(!Array.isArray(resident.routines)||resident.routines.length>MAX_ROUTINES)
      throw Error('Invalid Citizens routines');
    const routineIds=new Set();
    for(const routine of resident.routines){
      if(!keys(routine,['id','kind','priority','startMinute','endMinute',
        'baseWeight','stationId'])||!boundedText(routine.id,32)||!routine.id||
        routineIds.has(routine.id)||!ACTIVITIES.includes(routine.kind)||
        !PRIORITIES.includes(routine.priority)||
        !integer(routine.startMinute,0,1439)||
        !integer(routine.endMinute,0,1440)||
        routine.startMinute===routine.endMinute||
        !finite(routine.baseWeight)||routine.baseWeight<0||routine.baseWeight>100||
        (routine.stationId!==null&&
          (!boundedText(routine.stationId,32)||!routine.stationId||
            !state.stations.some(station=>station.id===routine.stationId&&
              station.kind===routine.kind)))||
        (routine.kind==='explore'&&routine.stationId!==null))
        throw Error('Invalid Citizens routine');
      routineIds.add(routine.id);
    }
    const decision=resident.lastDecision;
    if(decision===null)continue;
    if(!keys(decision,['tick','mode','roll','selectedKind',
      'selectedRoutineId','candidates'])||
      !integer(decision.tick,0,state.clockTick)||
      !['routine','needs','idle'].includes(decision.mode)||
      (decision.roll!==null&&
        (!finite(decision.roll)||decision.roll<0||decision.roll>=1))||
      (decision.selectedKind!==null&&
        !ACTIVITIES.includes(decision.selectedKind))||
      (decision.selectedRoutineId!==null&&
        (!boundedText(decision.selectedRoutineId,32)||
          !routineIds.has(decision.selectedRoutineId)))||
      !Array.isArray(decision.candidates)||
      decision.candidates.length>MAX_ROUTINES)
      throw Error('Invalid Citizens decision trace');
    for(const candidate of decision.candidates){
      const routine=candidate?.routineId===null?null:
        resident.routines.find(item=>item.id===candidate?.routineId);
      if(!keys(candidate,['kind','routineId','priority','deficit',
        'preference','travelMeters','baseWeight','availabilityFactor','score'])||
        !ACTIVITIES.includes(candidate.kind)||
        !['high','default','low','none'].includes(candidate.priority)||
        (candidate.routineId!==null&&
          (!routine||routine.kind!==candidate.kind||
            routine.priority!==candidate.priority))||
        !finite(candidate.deficit)||candidate.deficit<0||candidate.deficit>100||
        !finite(candidate.preference)||candidate.preference<.2||
          candidate.preference>2||
        !finite(candidate.travelMeters)||candidate.travelMeters<0||
          candidate.travelMeters>1000||
        !finite(candidate.baseWeight)||candidate.baseWeight<0||
          candidate.baseWeight>100||
        !finite(candidate.availabilityFactor)||
          candidate.availabilityFactor<0||candidate.availabilityFactor>1||
        !finite(candidate.score)||candidate.score<0||candidate.score>300)
        throw Error('Invalid Citizens decision candidate');
    }
    if(decision.mode==='routine'){
      if(decision.selectedKind===null||decision.selectedRoutineId===null||
        decision.candidates.some(candidate=>candidate.routineId===null)||
        !decision.candidates.some(candidate=>
          candidate.kind===decision.selectedKind&&
          candidate.routineId===decision.selectedRoutineId&&candidate.score>0))
        throw Error('Invalid Citizens routine decision');
    }else if(decision.selectedRoutineId!==null||decision.roll!==null||
      decision.candidates.some(candidate=>
        candidate.routineId!==null||candidate.priority!=='none')||
      (decision.mode==='idle'&&decision.selectedKind!==null)||
      (decision.mode==='needs'&&
        (decision.selectedKind===null||!decision.candidates.some(candidate=>
          candidate.kind===decision.selectedKind&&candidate.score>0))))
      throw Error('Invalid Citizens needs decision');
  }
}

function pose(x,z,scale=1){
  return {position:{x,y:0,z},rotation:{x:0,y:0,z:0},scale:{x:scale,y:scale,z:scale}};
}

function initialState(world,seed,adaId,boId,stations){
  return {schemaVersion:VERSION,world:{schemaVersion:1,roomId:world.scene.roomId},
    seed,rngState:seed,requestSequence:0,actionSequence:0,clockTick:0,paused:true,
    clockSpeed:1,
    retiredResidentIds:[],socialSession:null,socialEvents:[],
    relationships:[{a:'ada',b:'bo',score:50,completed:[]}],nextSocialTick:35,
    residents:[
      {id:'ada',name:'Ada',objectId:adaId,needs:{hunger:72,energy:20,fun:62},
        preferences:{rest:1.2,eat:.85,explore:.75},activity:null,
        cooldowns:{rest:0,eat:0,explore:0},lastOutcome:'',socialSessionId:null,
        routines:defaultRoutines('ada'),lastDecision:null},
      {id:'bo',name:'Bo',objectId:boId,needs:{hunger:42,energy:29,fun:54},
        preferences:{rest:1.1,eat:1,explore:.75},activity:null,
        cooldowns:{rest:0,eat:0,explore:0},lastOutcome:'',socialSessionId:null,
        routines:defaultRoutines('bo'),lastDecision:null}
    ],stations,log:[]};
}

function selectedStation(world,objectId){
  assertWorld(world);
  if(!objectId)throw Error('Select an existing chair or table first');
  const object=objectById(world,objectId);
  if(!object)throw Error('The selected furniture is no longer in the world');
  const asset=world.asset?.(object.assetId);
  const builtIn=['chair','table'].includes(object.assetId);
  const authored=object.assetId.startsWith('web:')&&
    validInteractionDescriptor(object.interaction)&&
    asset?.sha256===object.interaction.assetSha256;
  if((!builtIn&&!authored)||object.anchorId!==ANCHOR_ID)
    throw Error('Select a built-in chair/table or a registered GLB with a reviewed interaction');
  if(hasActiveTransformOwner(object))
    throw Error('Selected furniture is moving or has physics');
  navigationObstacles(world);
  const kind=authored?object.interaction.kind:object.assetId==='chair'?'rest':'eat';
  return {id:kind==='rest'?'chair':'food',kind,objectId,capacity:1,
    claim:null,waiters:[],interaction:authored?clone(object.interaction):null};
}

function selectedFurnitureSetup(world,objectId,{checkRoutes=true}={}){
  assertWorld(world);
  if(world.citizens!==null&&world.citizens!==undefined)
    throw Error('Citizens is already active in this world');
  if(world.game!==null&&world.game!==undefined)
    throw Error('Finish or remove the active game before starting Citizens');
  if(world.scene.objects.length+2>MAX_OBJECTS)
    throw Error('Citizens needs two free Matrix scene slots');
  const station=selectedStation(world,objectId);
  const object=objectById(world,objectId);
  // Panel rendering calls readiness frequently. Route searches belong to the
  // explicit start operation, which repeats every check before mutating.
  if(!checkRoutes)return {station,positions:null};
  const candidates=[[-1.8,0],[1.8,0],[-1.8,-1.4],[1.8,-1.4],
    [0,-2],[0,2],[-2.8,0],[2.8,0],[-2,-2],[2,-2],
    [-2,2],[2,2],[-3.5,-2],[3.5,-2],[0,-3.5],[0,3.5]];
  const positions=[],planned=[];
  let lastReason='No clear resident spawn and route to selected furniture';
  for(const [dx,dz] of candidates){
    const point={x:round6(object.transform.position.x+dx),
      z:round6(object.transform.position.z+dz)};
    const approach=stationApproach(world,'',station,point,planned);
    if(!approach.ok){lastReason=approach.reason;continue;}
    positions.push(point);
    planned.push({id:`citizens-planned-${positions.length}`,cx:point.x,cz:point.z,
      halfX:.175,halfZ:.175,yawRadians:0});
    if(positions.length===2)return {station,positions};
  }
  throw Error(`Citizens cannot start here: ${lastReason}`);
}

export function citizensFurnitureReadiness(world,objectId){
  try{selectedFurnitureSetup(world,objectId,{checkRoutes:false});return '';}
  catch(error){return error.message||String(error);}
}

export function createCitizensWithSelectedFurniture(world,{seed=1,objectId}={}){
  if(!integer(seed,1,0xffffffff))throw Error('Invalid Citizens seed');
  const {station,positions}=selectedFurnitureSetup(world,objectId);
  const sceneBefore=clone(world.scene);
  const before=clone(world.scene.objects),originalIds=new Set(before.map(item=>item.objectId));
  const undoBefore=clone(world.undo),redoBefore=clone(world.redo);
  const created=new Set();
  const selection=clone(world.selection);
  const restoreSelection=()=>world.setSelection(selection.objectId,selection.position,
    selection.anchorId);
  const authoredUnchanged=()=>before.every((item,index)=>
    JSON.stringify(world.scene.objects[index])===JSON.stringify(item));
  const spawn=(label,point)=>{
    const requestId=`citizens-${seed}-selected-${label}`;
    const transform=pose(point.x,point.z,.7);
    const priorIds=new Set(world.scene.objects.map(item=>item.objectId));
    let receipt,added=[],expected=[];
    try{receipt=world.execute({requestId,op:'spawn',assetId:'orb',
      anchorId:ANCHOR_ID,transform},{recordHistory:false});}
    finally{
      added=world.scene.objects.filter(item=>!priorIds.has(item.objectId));
      expected=added.filter(item=>item.assetId==='orb'&&
        item.anchorId===ANCHOR_ID&&sameTransform(item.transform,transform));
      // A command may add the requested orb and then return a bad receipt or
      // alter its transform. Retain its ID for rollback even when validation
      // below rejects it. Do not claim unrelated additions from a wrapper.
      if(receipt?.objectId&&added.some(item=>item.objectId===receipt.objectId))
        created.add(receipt.objectId);
      if(expected.length===1)created.add(expected[0].objectId);
      if(added.length===1)created.add(added[0].objectId);
    }
    if(!receipt?.ok||receipt.requestId!==requestId||!receipt.objectId||
      originalIds.has(receipt.objectId)||added.length!==1||expected.length!==1||
      receipt.objectId!==expected[0].objectId||
      !authoredUnchanged())
      throw Error(`Citizens ${label} spawn failed: ${receipt?.error||'missing runtime receipt or changed authored object'}`);
    return receipt.objectId;
  };
  try{
    const adaId=spawn('ada',positions[0]);
    const boId=spawn('bo',positions[1]);
    if(world.scene.objects.length!==before.length+2||!authoredUnchanged())
      throw Error('Citizens setup changed authored objects');
    const simulation=new CitizensSimulation(world,
      initialState(world,seed,adaId,boId,[station]));
    restoreSelection();
    return simulation;
  }catch(error){
    const failures=[];
    for(const objectId of [...created].reverse()){
      const object=objectById(world,objectId);
      if(!object||originalIds.has(objectId)||object.assetId!=='orb')continue;
      try{
        const receipt=world.execute({requestId:`citizens-${seed}-rollback-${objectId}`,
          op:'delete',objectId},{recordHistory:false});
        if(!receipt?.ok||objectById(world,objectId))failures.push(objectId);
      }catch(rollbackError){failures.push(objectId);}
    }
    try{restoreSelection();}catch(selectionError){failures.push('selection');}
    if(!authoredUnchanged())failures.push('authored scene');
    const sceneRestored=JSON.stringify(world.scene)===JSON.stringify(sceneBefore);
    if(!sceneRestored)failures.push('scene');
    if(!failures.length){
      world.undo=undoBefore;
      world.redo=redoBefore;
    }
    if(failures.length)throw Error(`${error.message}; rollback incomplete for ${failures.join(', ')}`);
    throw error;
  }
}

export function createCitizensDemo(world,{seed=1}={}){
  assertWorld(world);
  if(!integer(seed,1,0xffffffff))throw Error('Invalid Citizens seed');
  if(world.scene.objects.length+4>MAX_OBJECTS)throw Error('Citizens demo needs four free scene slots');
  const placed=[];
  const spawn=(label,assetId,transform)=>{
    const requestId=`citizens-${seed}-setup-${label}`;
    const receipt=world.execute({requestId,op:'spawn',assetId,anchorId:ANCHOR_ID,
      transform},{recordHistory:false});
    if(!receipt?.ok||receipt.requestId!==requestId||!receipt.objectId||
       !objectById(world,receipt.objectId))throw Error(`Citizens ${label} spawn failed: ${receipt?.error||'missing runtime receipt'}`);
    placed.push(receipt.objectId);
    return receipt.objectId;
  };
  try{
    const chairId=spawn('chair','chair',pose(0,-2));
    const foodId=spawn('food','table',pose(2.15,-2,.7));
    const adaId=spawn('ada','orb',pose(-2.2,-.9,.7));
    const boId=spawn('bo','orb',pose(2.3,-.85,.7));
    const state=initialState(world,seed,adaId,boId,[
      {id:'chair',kind:'rest',objectId:chairId,capacity:1,claim:null,waiters:[],interaction:null},
      {id:'food',kind:'eat',objectId:foodId,capacity:1,claim:null,waiters:[],interaction:null}
    ]);
    return new CitizensSimulation(world,state);
  }catch(error){
    for(const objectId of placed.reverse())world.execute({
      requestId:`citizens-${seed}-rollback-${objectId}`,op:'delete',objectId
    },{recordHistory:false});
    throw error;
  }
}

export class CitizensSimulation {
  constructor(world,state){
    let current=state;
    if(current?.schemaVersion===LEGACY_VERSION)current=migrateV1(world,current);
    if(current?.schemaVersion===RESERVATION_VERSION)current=migrateV2(world,current);
    if(current?.schemaVersion===SOCIAL_VERSION)current=migrateV3(world,current);
    if(current?.schemaVersion===COMPLETION_VERSION)current=migrateV4(world,current);
    if(current?.schemaVersion===ROUTE_VERSION)current=migrateV5(world,current);
    if(current?.schemaVersion===INTERACTION_VERSION)current=migrateV6(world,current);
    validStateV7(world,current);
    this.world=world;
    this.state=clone(current);
    // Runtime-only baseline: the serialized scene supplies it again on restore.
    this.observedScene=world.scene;
    this.observedTransforms=new Map([...current.residents,...current.stations].map(bound=>
      [bound.objectId,clone(objectById(world,bound.objectId).transform)]));
    this.invalidBindings=new Set();
    this.navigationBlockedReason='';
  }
  static restore(world,saved){return new CitizensSimulation(world,saved);}
  snapshot(){return clone(this.state);}
  setClockSpeed(value){
    if(!CLOCK_SPEEDS.includes(value))throw Error('Citizens speed must be 1, 4, or 16');
    this.state.clockSpeed=value;
    return this.snapshot();
  }
  additionalStation(objectId,{checkRoutes=false}={}){
    assertWorld(this.world);
    if(!this.state.paused)throw Error('Pause Citizens before adding a station');
    if(this.invalidBindings.size)throw Error('Recover the existing Citizens bindings first');
    if(this.state.residents.length===0)throw Error('No residents remain to use a station');
    if(this.state.stations.length>=2)
      throw Error('Citizens already has rest and food stations');
    const station=selectedStation(this.world,objectId);
    if(this.state.stations.some(bound=>bound.objectId===station.objectId))
      throw Error('That station is already bound to Citizens');
    if(this.state.stations.some(bound=>bound.kind===station.kind))
      throw Error(`Citizens already has a ${station.kind} station; select the other kind`);
    if(checkRoutes){
      if(this.world.scene!==this.observedScene)
        throw Error('The scene changed; review Citizens bindings before adding a station');
      validStateV7(this.world,this.state);
      for(const bound of [...this.state.residents,...this.state.stations]){
        const object=objectById(this.world,bound.objectId);
        if(!object||!sameTransform(object.transform,
          this.observedTransforms.get(bound.objectId)))
          throw Error('A Citizens object moved or disappeared; review bindings first');
      }
      for(const resident of this.state.residents){
        const route=stationApproach(this.world,resident.objectId,station);
        if(!route.ok)
          throw Error(`${resident.name} cannot reach the selected ${station.kind} station: ${route.reason}`);
      }
    }
    return station;
  }
  stationAdditionReadiness(objectId){
    try{this.additionalStation(objectId);return '';}
    catch(error){return error.message||String(error);}
  }
  addSelectedStation(objectId){
    const station=this.additionalStation(objectId,{checkRoutes:true});
    const previous=this.snapshot();
    try{
      // Legacy two-station worlds are the built-in seeded fixture. Mark both
      // selected stations so adding one does not change an in-flight goal.
      this.state.stations[0].approachMode='selected';
      station.approachMode='selected';
      this.state.stations.push(station);
      this.observedTransforms.set(station.objectId,
        clone(objectById(this.world,station.objectId).transform));
      this.log('','selected',`Reviewed ${station.id} station added to the shared world.`);
      validStateV7(this.world,this.state);
      return this.snapshot();
    }catch(error){
      this.state=previous;
      this.observedTransforms.delete(station.objectId);
      throw error;
    }
  }
  exportState(){
    this.reconcileWorld();
    if(this.invalidBindings.size)throw Error('Citizens binding is missing or incompatible');
    validStateV7(this.world,this.state);
    return this.snapshot();
  }
  reconcileWorld(){this.reconcileBindings();return this.snapshot();}
  reconcileBindings(){
    try{assertWorld(this.world);}catch(error){
      if(!this.invalidBindings.has('world')){
        this.cancelSocial('the virtual room became unavailable');
        for(const resident of this.state.residents)if(resident.activity||this.waitingFor(resident))
          this.fail(resident,'the virtual room became unavailable');
        this.log('','failed',`Simulation stopped: ${error.message}`);
      }
      this.invalidBindings.add('world');this.state.paused=true;
      return true;
    }
    this.invalidBindings.delete('world');
    const replaced=this.world.scene!==this.observedScene;
    this.observedScene=this.world.scene;
    if(replaced){
      this.cancelSocial('the scene was replaced');
      for(const resident of this.state.residents)if(resident.activity||this.waitingFor(resident))
        this.fail(resident,'the scene was replaced');
      this.state.paused=true;
      this.log('','paused','Scene replacement cancelled all Citizens claims; review before resuming.');
    }
    let interrupted=replaced;
    for(const [kind,bound] of [
      ...this.state.residents.map(resident=>['resident',resident]),
      ...this.state.stations.map(station=>['station',station])]){
      const object=objectById(this.world,bound.objectId);
      if(!object){
        if(kind==='resident')this.retireResident(bound);
        else this.retireStation(bound);
        this.invalidBindings.delete(bound.objectId);
        this.observedTransforms.delete(bound.objectId);
        continue;
      }
      const compatible=kind==='resident'
        ?supportedResident(object)
        :(bound.interaction?
          object.assetId.startsWith('web:')&&
          sameJson(object.interaction,bound.interaction)&&
          this.world.asset?.(object.assetId)?.sha256===bound.interaction.assetSha256:
          object.assetId===(bound.kind==='rest'?'chair':'table'))&&
          object.anchorId===ANCHOR_ID&&!hasActiveTransformOwner(object);
      if(!compatible){
        if(!this.invalidBindings.has(bound.objectId)){
          this.interruptBinding(kind,bound,`${bound.name||bound.id} is missing or incompatible`);
          interrupted=true;
        }
        this.invalidBindings.add(bound.objectId);
        continue;
      }
      if(this.invalidBindings.delete(bound.objectId)){
        this.observedTransforms.set(bound.objectId,clone(object.transform));
        continue;
      }
      if(!sameTransform(object.transform,this.observedTransforms.get(bound.objectId))){
        this.interruptBinding(kind,bound,`${bound.name||bound.id} was moved externally`);
        interrupted=true;
      }
      this.observedTransforms.set(bound.objectId,clone(object.transform));
    }
    if(interrupted)this.state.paused=true;
    return interrupted||this.invalidBindings.size>0;
  }
  retireResident(resident){
    if(resident.socialSessionId)this.cancelSocial('a resident object was deleted');
    if(resident.activity||this.waitingFor(resident))
      this.fail(resident,'resident object was deleted');
    this.state.residents=this.state.residents.filter(item=>item.id!==resident.id);
    this.state.retiredResidentIds.push(resident.id);
    this.log(resident.id,'retired',
      `${resident.name} was removed after object deletion; surviving residents continue.`);
    if(this.state.residents.length===0){
      this.state.paused=true;
      this.log('','paused','Simulation paused because no residents remain.');
    }
  }
  retireStation(station){
    const affected=new Set([
      ...(station.claim?[station.claim.residentId]:[]),
      ...station.waiters.map(waiter=>waiter.residentId)]);
    for(const id of affected){
      const resident=this.state.residents.find(item=>item.id===id);
      if(resident)this.fail(resident,`${station.id} was deleted`);
    }
    for(const resident of this.state.residents){
      resident.routines=resident.routines.filter(routine=>
        routine.stationId!==station.id);
      resident.lastDecision=null;
    }
    this.state.stations=this.state.stations.filter(item=>item.id!==station.id);
    this.log('','retired',`${station.id} was removed after object deletion; surviving residents continue.`);
  }
  interruptBinding(kind,bound,reason){
    if(kind==='resident'&&bound.socialSessionId)this.cancelSocial(reason);
    const affected=kind==='resident'?[bound]:
      this.state.residents.filter(resident=>resident.activity?.stationId===bound.id||
        bound.waiters.some(waiter=>waiter.residentId===resident.id));
    let cancelled=false;
    for(const resident of affected)if(resident.activity||this.waitingFor(resident)){
      this.fail(resident,reason);cancelled=true;
    }
    if(!cancelled)this.log(kind==='resident'?bound.id:'','failed',
      `${reason}; simulation paused.`);
    this.state.paused=true;
  }
  pause(){
    if(!this.state.paused){this.state.paused=true;this.log('', 'paused','Simulation paused.');}
    return this.snapshot();
  }
  navigationIssue(){
    try{navigationObstacles(this.world);return '';}
    catch(error){return error.message||String(error);}
  }
  pauseForNavigation(reason){
    if(this.navigationBlockedReason===reason&&this.state.paused)return;
    this.cancelSocial(`navigation unavailable: ${reason}`);
    for(const resident of this.state.residents)
      if(resident.activity||this.waitingFor(resident))
        this.fail(resident,`navigation unavailable: ${reason}`);
    this.state.paused=true;
    this.navigationBlockedReason=reason;
    this.log('','paused',`Navigation unavailable: ${reason}. Verify the scene before resuming.`);
  }
  resume(){
    if(this.reconcileBindings())return this.snapshot();
    if(this.state.residents.length===0)return this.snapshot();
    const reason=this.navigationIssue();
    if(reason){this.pauseForNavigation(reason);return this.snapshot();}
    this.navigationBlockedReason='';
    if(this.state.paused){this.state.paused=false;this.log('','resumed','Simulation resumed.');}
    return this.snapshot();
  }
  advance(){return this.state.paused?this.reconcileWorld():this.step();}
  nextRandom(){
    // Xorshift32: deterministic and serializable; seed zero is disallowed.
    let value=this.state.rngState>>>0;
    value^=value<<13;value^=value>>>17;value^=value<<5;
    this.state.rngState=value>>>0;
    return this.state.rngState/0x100000000;
  }
  log(residentId,event,message){
    this.state.log.push({tick:this.state.clockTick,residentId,event,
      message:boundedPrefix(message,160)});
    if(this.state.log.length>MAX_LOG)this.state.log.shift();
  }
  socialEvent(session,event,requestId=''){
    const tick=this.state.clockTick;
    this.state.socialEvents.push({id:`${session.id}-${event}-${tick}`,event,tick,
      initiatorId:session.initiatorId,inviteeId:session.inviteeId,requestId});
    if(this.state.socialEvents.length>MAX_SOCIAL_EVENTS)this.state.socialEvents.shift();
  }
  finishSocial(event,reason,requestId=''){
    const session=this.state.socialSession;
    if(!session)return false;
    this.socialEvent(session,event,requestId);
    for(const id of [session.initiatorId,session.inviteeId]){
      const resident=this.state.residents.find(item=>item.id===id);
      if(resident){resident.socialSessionId=null;resident.lastOutcome=
        `${event==='ended'?'Completed':'Social '+event}: ${reason}`.slice(0,160);}
    }
    this.state.socialSession=null;
    this.state.nextSocialTick=Math.min(1000000100,
      this.state.clockTick+SOCIAL_COOLDOWN_TICKS);
    this.log(session.initiatorId,event==='ended'?'completed':'failed',
      `Social ${event}: ${reason}`);
    return true;
  }
  cancelSocial(reason='session cancelled'){
    this.finishSocial('interrupted',reason);
    return this.snapshot();
  }
  socialParticipants(session){
    const initiator=this.state.residents.find(item=>item.id===session.initiatorId);
    const invitee=this.state.residents.find(item=>item.id===session.inviteeId);
    if(!initiator||!invitee||initiator.socialSessionId!==session.id||
      invitee.socialSessionId!==session.id||initiator.activity||invitee.activity||
      this.waitingFor(initiator)||this.waitingFor(invitee))return null;
    return {initiator,invitee};
  }
  eligibleForSocial(resident){
    const object=objectById(this.world,resident.objectId);
    return !resident.activity&&!resident.socialSessionId&&!this.waitingFor(resident)&&
      supportedResident(object)&&!this.invalidBindings.has(resident.objectId);
  }
  beginSocial(){
    if(this.state.socialSession||this.state.clockTick<this.state.nextSocialTick||
      this.state.residents.length<2)return false;
    const ready=this.state.residents.filter(resident=>this.eligibleForSocial(resident))
      .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    if(ready.length<2){
      if(this.state.clockTick>=this.state.nextSocialTick+SOCIAL_WINDOW_TICKS)
        this.state.nextSocialTick=this.state.clockTick+SOCIAL_COOLDOWN_TICKS;
      return false;
    }
    const executionId=this.nextExecutionId();
    if(executionId===null)return false;
    const [initiator,invitee]=ready;
    const id=`social-${this.state.seed}-${executionId}`;
    const session={id,executionId,initiatorId:initiator.id,inviteeId:invitee.id,
      phase:'offered',startedTick:this.state.clockTick,
      expiresTick:this.state.clockTick+OFFER_TICKS,acceptedTick:null,
      travelTicks:0,remainingTicks:SOCIAL_USE_TICKS};
    initiator.socialSessionId=id;invitee.socialSessionId=id;
    this.state.socialSession=session;
    this.socialEvent(session,'initiated');
    this.log(initiator.id,'selected',
      `${initiator.name} invited ${invitee.name} to converse in session ${id}.`);
    return true;
  }
  progressSocial(){
    const session=this.state.socialSession;
    if(!session)return false;
    const pair=this.socialParticipants(session);
    if(!pair){this.finishSocial('interrupted','participant availability changed');return true;}
    if(this.state.clockTick>=session.expiresTick){
      this.finishSocial('timed_out','the invitation or conversation expired');
      return true;
    }
    if(session.phase==='offered'){
      if(this.state.clockTick!==session.startedTick+1)return true;
      // A single seeded response roll is serialized through rngState. The
      // unanswered branch reaches its explicit offer deadline on later ticks.
      const response=this.nextRandom();
      if(response<.25){
        this.finishSocial('declined',`${pair.invitee.name} declined the invitation`);
      }else if(response<.65){
        session.phase='active';
        session.acceptedTick=this.state.clockTick;
        session.expiresTick=this.state.clockTick+ACTIVE_TICKS;
        this.socialEvent(session,'accepted');
        this.log(pair.invitee.id,'selected',
          `${pair.invitee.name} accepted ${pair.initiator.name}'s invitation.`);
      }
      return true;
    }
    const actor=positionOf(this.world,pair.initiator.objectId);
    const target=positionOf(this.world,pair.invitee.objectId);
    if(!actor||!target){this.finishSocial('interrupted','a participant is missing');return true;}
    const approach=stationApproach(this.world,pair.initiator.objectId,
      {objectId:pair.invitee.objectId,kind:'converse'});
    if(!approach.ok){
      this.finishSocial('interrupted',`conversation path unavailable: ${approach.reason}`);
      return true;
    }
    const goal=approach.target;
    if(distance(actor,goal)>ARRIVAL_METRES){
      if(session.travelTicks>=MAX_TRAVEL_TICKS){
        this.finishSocial('timed_out','conversation travel exceeded its limit');return true;
      }
      const receipt=this.requestMove(pair.initiator,goal,session.executionId,'social');
      if(!receipt.ok){
        this.finishSocial('interrupted',`movement rejected: ${receipt.error}`);return true;
      }
      session.travelTicks++;
      return true;
    }
    if(distance(actor,target)>.8){
      this.finishSocial('interrupted','participants separated before conversation');
      return true;
    }
    if(--session.remainingTicks>0)return true;
    const receipt=this.requestSocialInteraction(pair.initiator,pair.invitee,session);
    if(!receipt.ok){
      this.finishSocial('interrupted',`conversation rejected: ${receipt.error}`);
      return true;
    }
    const [a,b]=[pair.initiator.id,pair.invitee.id].sort();
    let relation=this.state.relationships.find(item=>item.a===a&&item.b===b);
    if(!relation){
      relation={a,b,score:50,completed:[]};this.state.relationships.push(relation);
      this.state.relationships.sort((left,right)=>
        left.a<right.a?-1:left.a>right.a?1:left.b<right.b?-1:left.b>right.b?1:0);
    }
    relation.completed.push({sessionId:session.id,requestId:receipt.requestId,
      tick:this.state.clockTick});
    if(relation.completed.length>MAX_COMPLETED_SOCIAL)relation.completed.shift();
    relation.score=Math.min(100,50+5*relation.completed.length);
    pair.initiator.needs.fun=clamp(pair.initiator.needs.fun+12);
    pair.invitee.needs.fun=clamp(pair.invitee.needs.fun+12);
    this.finishSocial('ended',`${pair.initiator.name} and ${pair.invitee.name} conversed`,
      receipt.requestId);
    return true;
  }
  station(id){return this.state.stations.find(station=>station.id===id);}
  waitingFor(resident){
    for(const station of this.state.stations){
      const entry=station.waiters.find(waiter=>waiter.residentId===resident.id);
      if(entry)return {station,entry};
    }
    return null;
  }
  release(resident){
    for(const station of this.state.stations){
      if(station.claim?.residentId===resident.id){
        station.claim=null;
        this.log(resident.id,'released',`${resident.name} released ${station.id}.`);
      }
      station.waiters=station.waiters.filter(waiter=>waiter.residentId!==resident.id);
    }
  }
  fail(resident,reason){
    const kind=resident.activity?.kind||this.waitingFor(resident)?.station.kind;
    this.release(resident);
    resident.activity=null;
    if(kind)resident.cooldowns[kind]=this.state.clockTick+4;
    resident.lastOutcome=`Failed: ${reason}`;
    this.log(resident.id,'failed',`${resident.name}: ${reason}`);
  }
  routeGeometryId(){
    return this.world.navigationGeometryIdentity({
      excludeObjectIds:this.state.residents.map(resident=>resident.objectId)
    });
  }
  retryRoute(resident,reason){
    const action=resident.activity;
    if(action.routeRetries>=MAX_ROUTE_RETRIES){
      this.fail(resident,`route unavailable after ${MAX_ROUTE_RETRIES} retries: ${reason}`);
      return;
    }
    action.routeRetries++;
    this.log(resident.id,'rerouted',
      `${resident.name}: route unavailable; retry ${action.routeRetries}/${MAX_ROUTE_RETRIES}: ${reason}`);
  }
  requestMove(resident,target,executionId=resident.activity?.executionId,domain='action'){
    const object=objectById(this.world,resident.objectId);
    if(!object||object.anchorId!==ANCHOR_ID)
      return {ok:false,error:'resident object is missing'};
    if(object.component||hasActiveTransformOwner(object))
      return {ok:false,error:'resident transform is owned by another runtime capability'};
    if(!supportedResident(object))
      return {ok:false,error:'resident object has unsupported size/height'};
    const current=object.transform.position;
    let obstacles;
    try{obstacles=navigationObstacles(this.world,resident.objectId);}
    catch(error){return {ok:false,error:error.message};}
    const route=planPath({start:current,goal:target,obstacles,
      actorRadius:ACTOR_RADIUS});
    if(!route.ok)return {ok:false,code:route.code,error:`${route.code}: ${route.reason}`};
    const waypoint=route.waypoints[0]||target;
    const gap=distance(current,waypoint);
    const fraction=gap>MOVE_METRES-.00001?(MOVE_METRES-.00001)/gap:1;
    const transform=clone(object.transform);
    transform.position.x=round6(current.x+(waypoint.x-current.x)*fraction);
    transform.position.z=round6(current.z+(waypoint.z-current.z)*fraction);
    const swept=checkedMove({from:current,to:transform.position,obstacles,
      actorRadius:ACTOR_RADIUS});
    if(!swept.ok)return {ok:false,code:swept.code,error:`${swept.code}: ${swept.reason}`};
    const requestId=`citizens-${this.state.seed}-${domain}-${executionId}-${++this.state.requestSequence}`;
    let receipt;
    try{receipt=this.world.execute({requestId,op:'set_transform',objectId:resident.objectId,
      transform},{recordHistory:false});}
    catch(error){return {ok:false,error:error.message||String(error)};}
    if(!receipt?.ok||receipt.requestId!==requestId||receipt.objectId!==resident.objectId)
      return {ok:false,error:receipt?.error||'missing or mismatched Matrix receipt'};
    const observed=objectById(this.world,resident.objectId);
    if(!observed||!sameTransform(observed.transform,transform))
      return {ok:false,error:'Matrix movement receipt did not match the observed pose'};
    this.observedTransforms.set(resident.objectId,clone(observed.transform));
    return {ok:true};
  }
  requestInteraction(resident,station){
    const actor=positionOf(this.world,resident.objectId);
    const targetObject=objectById(this.world,station.objectId);
    const target=station.interaction&&targetObject?
      interactionWorldPoint(targetObject,this.world.asset(targetObject.assetId),
        station.interaction.usePose):positionOf(this.world,station.objectId);
    let obstacles;
    try{obstacles=navigationObstacles(this.world,resident.objectId);}
    catch(error){return {ok:false,error:error.message};}
    const clear=actor&&planPath({start:actor,goal:actor,obstacles,
      actorRadius:ACTOR_RADIUS});
    if(!clear?.ok)return {ok:false,error:clear?.reason||'Interaction actor is missing'};
    if(!target||!segmentClear(actor,target,
      obstacles.filter(item=>item.id!==station.objectId),0))
      return {ok:false,error:'Interaction use point is occluded or missing'};
    const requestId=`citizens-${this.state.seed}-action-${resident.activity.executionId}-${++this.state.requestSequence}`;
    let receipt;
    try{receipt=this.world.execute({requestId,op:'interact',
      actorObjectId:resident.objectId,targetObjectId:station.objectId,kind:station.kind,
      ...(station.interaction?{interactionId:station.interaction.interactionId,
        expectedInteraction:clone(station.interaction)}:{})},
    {recordHistory:false});}
    catch(error){return {ok:false,error:error.message||String(error)};}
    const outcome=receipt?.outcome;
    if(!receipt?.ok||receipt.requestId!==requestId||receipt.objectId!==resident.objectId||
       outcome?.kind!==station.kind||outcome.actorObjectId!==resident.objectId||
       outcome.targetObjectId!==station.objectId||
       !finite(outcome.observedDistanceMeters)||outcome.observedDistanceMeters<0||
       outcome.observedDistanceMeters>(station.interaction?.rangeMeters??
         (station.kind==='rest'?.8:.9))+.001||
       (station.interaction&&(
         outcome.interactionId!==station.interaction.interactionId||
         !sameJson(outcome.effect,station.interaction.effect)||
         !finite(outcome.usePoint?.x)||!finite(outcome.usePoint?.z)||
         distance(outcome.usePoint,target)>.001)))
      return {ok:false,error:receipt?.error||'missing or mismatched interaction outcome'};
    return {ok:true,effect:station.interaction?.effect??null};
  }
  requestSocialInteraction(initiator,invitee,session){
    const actor=positionOf(this.world,initiator.objectId);
    let obstacles;
    try{obstacles=navigationObstacles(this.world,initiator.objectId);}
    catch(error){return {ok:false,error:error.message};}
    const clear=actor&&planPath({start:actor,goal:actor,obstacles,
      actorRadius:ACTOR_RADIUS});
    if(!clear?.ok)return {ok:false,error:clear?.reason||'Conversation actor is missing'};
    const requestId=`citizens-${this.state.seed}-social-${session.executionId}-${++this.state.requestSequence}`;
    let receipt;
    try{receipt=this.world.execute({requestId,op:'interact',
      actorObjectId:initiator.objectId,targetObjectId:invitee.objectId,
      kind:'converse',sessionId:session.id},{recordHistory:false});}
    catch(error){return {ok:false,error:error.message||String(error)};}
    const outcome=receipt?.outcome;
    if(!receipt?.ok||receipt.requestId!==requestId||
      receipt.objectId!==initiator.objectId||outcome?.kind!=='converse'||
      outcome.actorObjectId!==initiator.objectId||
      outcome.targetObjectId!==invitee.objectId||outcome.sessionId!==session.id||
      !finite(outcome.observedDistanceMeters)||outcome.observedDistanceMeters<0||
      outcome.observedDistanceMeters>.8)
      return {ok:false,error:receipt?.error||'missing or mismatched conversation outcome'};
    return {ok:true,requestId};
  }
  targetFor(resident){
    const action=resident.activity;
    if(action.kind==='explore')return {ok:true,target:action.target};
    const station=this.station(action.stationId);
    const object=station&&objectById(this.world,station.objectId);
    if(!object||object.anchorId!==ANCHOR_ID||
      station.claim?.residentId!==resident.id||
      station.claim.executionId!==action.executionId)
      return {ok:false,reason:'Interaction target is missing or claim changed'};
    return stationApproach(this.world,resident.objectId,station,null,[],
      !station.interaction&&!station.approachMode&&this.state.stations.length===2?
        fixtureApproach(this.world,station):null);
  }
  nextExecutionId(){
    if(this.state.actionSequence>=1000000000){
      this.state.paused=true;
      this.log('','failed','Citizens execution ID limit reached.');
      return null;
    }
    return ++this.state.actionSequence;
  }
  beginActivity(resident,kind,station,executionId,description){
    let target=null;
    if(kind==='explore'){
      const actor=positionOf(this.world,resident.objectId);
      let obstacles;
      try{obstacles=navigationObstacles(this.world,resident.objectId);}
      catch(error){
        this.log(resident.id,'blocked',`${resident.name}: explore unavailable; ${error.message}.`);
        resident.cooldowns.explore=this.state.clockTick+4;
        return false;
      }
      let reason='No reachable exploration point';
      for(let attempt=0;attempt<4;attempt++){
        const candidate={
          x:round(Math.max(-FLOOR_TARGET_LIMIT,Math.min(FLOOR_TARGET_LIMIT,
            actor.x+(this.nextRandom()-.5)*5))),
          z:round(Math.max(-FLOOR_TARGET_LIMIT,Math.min(FLOOR_TARGET_LIMIT,
            actor.z-.5-this.nextRandom()*3)))};
        const route=planPath({start:actor,goal:candidate,obstacles,
          actorRadius:ACTOR_RADIUS});
        if(route.ok){target=candidate;break;}
        reason=route.reason;
      }
      if(!target){
        this.log(resident.id,'blocked',`${resident.name}: explore unavailable; ${reason}.`);
        resident.cooldowns.explore=this.state.clockTick+4;
        return false;
      }
    }
    resident.activity={kind,stationId:station?.id||null,phase:'travel',
      remainingTicks:station?.interaction?.durationTicks??
        (kind==='rest'?7:kind==='eat'?5:1),travelTicks:0,target,
      executionId,routeRetries:0,routeGeometryId:this.routeGeometryId()};
    this.log(resident.id,'selected',`${resident.name} chose ${kind}${station?` at ${station.id}`:''}: ${description}`);
    return true;
  }
  progressWaiting(resident,station,entry){
    if(this.state.clockTick-entry.enqueuedTick>=MAX_WAIT_TICKS){
      this.fail(resident,`wait for ${station.id} timed out`);
      this.log(resident.id,'expired',`${resident.name}'s wait for ${station.id} expired.`);
      return;
    }
    // The head owns the next free turn. A previous holder cannot reacquire
    // merely because it appears earlier in the resident processing array.
    if(station.claim||station.waiters[0]!==entry)return;
    station.waiters.shift();
    station.claim={residentId:resident.id,executionId:entry.executionId,
      expiresTick:this.state.clockTick+LEASE_TICKS};
    this.beginActivity(resident,station.kind,station,entry.executionId,
      `FIFO turn after waiting since minute ${entry.enqueuedTick}; execution ${entry.executionId}.`);
  }
  expireClaims(){
    for(const station of this.state.stations){
      const claim=station.claim;
      if(!claim||this.state.clockTick<claim.expiresTick)continue;
      const resident=this.state.residents.find(item=>item.id===claim.residentId);
      if(resident)this.fail(resident,`lease for ${station.id} expired`);
      else station.claim=null;
      this.log(claim.residentId,'expired',`${station.id} lease for execution ${claim.executionId} expired.`);
    }
  }
  decisionCandidate(resident,actor,kind,routine=null,{legacyJitter=false}={}){
    const station=routine?.stationId?
      this.state.stations.find(item=>item.id===routine.stationId):
      this.state.stations.find(item=>item.kind===kind);
    const need=kind==='rest'?'energy':kind==='eat'?'hunger':'fun';
    const deficit=100-resident.needs[need];
    const preference=resident.preferences[kind];
    const target=station?positionOf(this.world,station.objectId):null;
    let travel=target?distance(actor,target):2;
    let unavailable='';
    if(kind!=='explore'){
      if(!station||!target)unavailable='station is missing';
      else{
        const approach=stationApproach(this.world,resident.objectId,station,null,[],
          !station.interaction&&!station.approachMode&&this.state.stations.length===2?
            fixtureApproach(this.world,station):null);
        if(!approach.ok)unavailable=approach.reason;
        else travel=approach.route.lengthMeters;
      }
    }
    const availabilityFactor=unavailable?0:
      routine&&station&&(station.claim||station.waiters.length)? .6:1;
    const baseWeight=routine?.baseWeight??0;
    const jitter=legacyJitter?this.nextRandom()*2:0;
    const score=unavailable||routine&&deficit<5?0:
      Math.max(0,round((deficit*preference+baseWeight-travel*2+jitter)*
        availabilityFactor));
    return {kind,station,routine,score,deficit,travel,unavailable,
      trace:{kind,routineId:routine?.id??null,priority:routine?.priority??'none',
        deficit:round(deficit),preference,travelMeters:round(Math.min(1000,travel)),
        baseWeight,availabilityFactor,score}};
  }
  recordDecision(resident,mode,candidates,selected=null,roll=null){
    resident.lastDecision={tick:this.state.clockTick,mode,roll,
      selectedKind:selected?.kind??null,selectedRoutineId:selected?.routine?.id??null,
      candidates:candidates.map(candidate=>candidate.trace)};
  }
  attemptChoice(resident,candidate){
    const {kind,station}=candidate;
    if(candidate.unavailable){
      this.log(resident.id,'blocked',
        `${resident.name}: ${kind} unavailable; ${candidate.unavailable}.`);
      resident.cooldowns[kind]=this.state.clockTick+4;
      return false;
    }
    if(station&&(station.claim||station.waiters.length)){
      const executionId=this.nextExecutionId();
      if(executionId===null)return false;
      station.waiters.push({residentId:resident.id,executionId,
        enqueuedTick:this.state.clockTick});
      this.log(resident.id,'blocked',
        `${resident.name}: ${station.id} occupied by ${station.claim?.residentId||'an earlier waiter'}; ${kind} score ${candidate.score}.`);
      this.log(resident.id,'waiting',
        `${resident.name} queued for ${station.id} as execution ${executionId}.`);
      return true;
    }
    const executionId=this.nextExecutionId();
    if(executionId===null)return false;
    if(station)station.claim={residentId:resident.id,executionId,
      expiresTick:this.state.clockTick+LEASE_TICKS};
    const need=kind==='rest'?'energy':kind==='eat'?'hunger':'fun';
    if(!this.beginActivity(resident,kind,station,executionId,
      `${need} ${round(resident.needs[need])}, score ${candidate.score} `+
      `(gap ${round(candidate.deficit)}, travel ${round(candidate.travel)}m`+
      `${candidate.routine?`, routine ${candidate.routine.id}`:''}); execution ${executionId}.`)){
      if(station)station.claim=null;
      return false;
    }
    return true;
  }
  choose(resident){
    const actor=positionOf(this.world,resident.objectId);
    if(!actor){this.fail(resident,'resident object is missing');this.state.paused=true;return;}
    // Critical hunger can override an optional time block at the next idle
    // decision. Finite in-flight actions and social sessions still complete.
    if(resident.needs.hunger<=15){
      const urgent=this.decisionCandidate(resident,actor,'eat');
      if(urgent.station&&!urgent.unavailable){
        urgent.score=Math.max(1,urgent.score);
        urgent.trace.score=urgent.score;
      }
      if(urgent.station&&!urgent.unavailable&&
        this.attemptChoice(resident,urgent)){
        this.recordDecision(resident,'needs',[urgent],urgent);
        return;
      }
    }
    const active=resident.routines.filter(routine=>
      routineActive(routine,this.state.clockTick));
    const scheduled=active.map(routine=>this.decisionCandidate(resident,actor,
      routine.kind,routine));
    for(const priority of PRIORITIES){
      const candidates=scheduled.filter(candidate=>
        candidate.routine.priority===priority&&candidate.score>0&&
        resident.cooldowns[candidate.kind]<=this.state.clockTick);
      if(!candidates.length)continue;
      const total=candidates.reduce((sum,item)=>sum+item.score,0);
      const roll=candidates.length>1?this.nextRandom():null;
      let selected=candidates[0];
      if(roll!==null){
        let threshold=roll*total;
        for(const candidate of candidates){
          threshold-=candidate.score;
          if(threshold<0){selected=candidate;break;}
        }
      }
      const remaining=candidates.filter(item=>item!==selected)
        .sort((a,b)=>b.score-a.score||
          a.routine.id.localeCompare(b.routine.id));
      for(const candidate of [selected,...remaining]){
        if(this.attemptChoice(resident,candidate)){
          this.recordDecision(resident,'routine',scheduled,candidate,roll);
          return;
        }
      }
    }
    // Outside a usable routine window, retain the earlier need-driven fixture
    // behavior and its seed-stable jitter.
    const needs=ACTIVITIES.map(kind=>this.decisionCandidate(resident,actor,
      kind,null,{legacyJitter:true}));
    const ranked=needs.filter(candidate=>candidate.score>8&&
      resident.cooldowns[candidate.kind]<=this.state.clockTick)
      .sort((a,b)=>b.score-a.score||
        ACTIVITIES.indexOf(a.kind)-ACTIVITIES.indexOf(b.kind));
    for(const candidate of ranked){
      if(this.attemptChoice(resident,candidate)){
        this.recordDecision(resident,'needs',needs,candidate);
        return;
      }
    }
    this.recordDecision(resident,'idle',needs);
  }
  progress(resident){
    const action=resident.activity;
    if(!action)return;
    if(action.phase==='travel'){
      const geometryId=this.routeGeometryId();
      if(action.routeGeometryId!==null&&action.routeGeometryId!==geometryId)
        this.log(resident.id,'rerouted',
          `${resident.name}: navigation geometry changed; replanning ${action.kind} route.`);
      action.routeGeometryId=geometryId;
    }
    const resolved=this.targetFor(resident);
    if(!resolved.ok){
      if(action.phase==='travel'&&resolved.code==='no_path')
        this.retryRoute(resident,resolved.reason);
      else this.fail(resident,resolved.reason);
      return;
    }
    const target=resolved.target;
    if(action.phase==='travel'){
      if(action.travelTicks>=MAX_TRAVEL_TICKS){this.fail(resident,'travel timed out');return;}
      const receipt=this.requestMove(resident,target);
      if(!receipt.ok){
        if(['no_path','start_blocked','goal_blocked','obstacle'].includes(receipt.code))
          this.retryRoute(resident,receipt.error);
        else this.fail(resident,`movement rejected: ${receipt.error}`);
        return;
      }
      action.travelTicks++;
      const arrived=distance(positionOf(this.world,resident.objectId),target)<=ARRIVAL_METRES;
      if(arrived){
        action.phase='use';
        this.log(resident.id,'arrived',`${resident.name} reached ${action.stationId||'an exploration point'}.`);
      }
      return;
    }
    const actor=positionOf(this.world,resident.objectId);
    if(!actor||distance(actor,target)>.3){
      this.fail(resident,'actor or target changed during interaction');return;
    }
    if(--action.remainingTicks>0)return;
    // Matrix validates actual actor/target proximity and advertises the finite
    // station interaction. Only its matching outcome grants a need benefit.
    const station=this.station(action.stationId);
    const receipt=station?this.requestInteraction(resident,station):this.requestMove(resident,target);
    if(!receipt.ok){this.fail(resident,`completion rejected: ${receipt.error}`);return;}
    const kind=action.kind;
    if(station?.interaction){
      const {need,delta}=receipt.effect;
      resident.needs[need]=clamp(resident.needs[need]+delta);
    }else{
      if(kind==='rest')resident.needs.energy=clamp(resident.needs.energy+37);
      if(kind==='eat')resident.needs.hunger=clamp(resident.needs.hunger+43);
    }
    if(kind==='explore')resident.needs.fun=clamp(resident.needs.fun+27);
    this.release(resident);
    resident.activity=null;
    resident.cooldowns[kind]=this.state.clockTick+6;
    resident.lastOutcome=`Completed ${kind} at minute ${this.state.clockTick}`;
    this.log(resident.id,'completed',`${resident.name} completed ${kind}; observed outcome updated needs.`);
  }
  step(){
    if(this.reconcileBindings())return this.snapshot();
    if(this.state.residents.length===0){this.state.paused=true;return this.snapshot();}
    const reason=this.navigationIssue();
    if(reason){this.pauseForNavigation(reason);return this.snapshot();}
    this.navigationBlockedReason='';
    if(this.state.clockTick>=1000000000){
      this.state.paused=true;this.log('','failed','Simulation clock limit reached.');
      return this.snapshot();
    }
    this.state.clockTick++;
    this.expireClaims();
    for(const resident of this.state.residents){
      resident.needs.hunger=clamp(resident.needs.hunger-.45);
      resident.needs.energy=clamp(resident.needs.energy-.55);
      resident.needs.fun=clamp(resident.needs.fun-.25);
    }
    const socialParticipants=new Set(this.state.socialSession?
      [this.state.socialSession.initiatorId,this.state.socialSession.inviteeId]:[]);
    if(this.state.socialSession)this.progressSocial();
    if(!socialParticipants.size&&this.beginSocial()){
      socialParticipants.add(this.state.socialSession.initiatorId);
      socialParticipants.add(this.state.socialSession.inviteeId);
    }
    const waitingWindow=this.state.residents.length>=2&&
      this.state.clockTick>=this.state.nextSocialTick&&
      this.state.clockTick<this.state.nextSocialTick+SOCIAL_WINDOW_TICKS;
    for(const resident of this.state.residents){
      if(socialParticipants.has(resident.id)||resident.socialSessionId)continue;
      if(!resident.activity){
        const waiting=this.waitingFor(resident);
        if(waiting)this.progressWaiting(resident,waiting.station,waiting.entry);
        else if(!(waitingWindow&&this.eligibleForSocial(resident)))this.choose(resident);
      }
      if(resident.activity)this.progress(resident);
    }
    return this.snapshot();
  }
}
