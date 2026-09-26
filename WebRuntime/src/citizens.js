// Bounded desktop Citizens fixture. Policy and needs live here; MatrixWorld owns
// scene objects and validates every placement/move. No Agent Portal access.
import {ANCHOR_ID,MAX_OBJECTS,ROOM_ID} from './protocol.js';

const VERSION=2;
const LEGACY_VERSION=1;
const MOVE_METRES=.28;
const ARRIVAL_METRES=.08;
const MAX_TRAVEL_TICKS=60;
const LEASE_TICKS=MAX_TRAVEL_TICKS+12;
const MAX_WAIT_TICKS=96;
const MAX_LOG=80;
const NEEDS=['hunger','energy','fun'];
const ACTIVITIES=['rest','eat','explore'];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,expected)=>plain(value)&&Object.keys(value).sort().join('|')===expected.slice().sort().join('|');
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const boundedText=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\x00-\x1f]/.test(value);
const clone=value=>structuredClone(value);
const round=value=>Math.round(value*100)/100;
const clamp=value=>Math.max(0,Math.min(100,round(value)));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const sameTransform=(a,b)=>a&&b&&['position','rotation','scale'].every(part=>
  ['x','y','z'].every(axis=>a[part]?.[axis]===b[part]?.[axis]));
const objectById=(world,id)=>world.scene.objects.find(object=>object.objectId===id);
const positionOf=(world,id)=>objectById(world,id)?.transform?.position;
// Running components and behaviors can move the rendered object without
// changing its authored transform. Citizens must not navigate to that stale pose.
const hasActiveTransformOwner=object=>!!(object?.physics||
  object?.component?.status==='running'||
  object?.behaviors?.some(behavior=>behavior.enabled&&!behavior.paused));

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
    ...(version===VERSION?['executionId']:[])])||
     !ACTIVITIES.includes(activity.kind)||!['travel','use'].includes(activity.phase)||
     !integer(activity.remainingTicks,0,12)||!integer(activity.travelTicks,0,MAX_TRAVEL_TICKS))return false;
  if(activity.kind==='explore')return activity.stationId===null&&
    keys(activity.target,['x','z'])&&finite(activity.target.x)&&finite(activity.target.z)&&
    Math.abs(activity.target.x)<=5&&Math.abs(activity.target.z)<=5;
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
    if(object?.assetId!=='orb'||object.anchorId!==ANCHOR_ID||object.component||
       hasActiveTransformOwner(object))
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
  state.schemaVersion=VERSION;
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

function validStateV2(world,state){
  assertWorld(world);
  if(!keys(state,['schemaVersion','world','seed','rngState','requestSequence',
    'actionSequence','clockTick','paused','residents','retiredResidentIds',
    'stations','log'])||state.schemaVersion!==VERSION||
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
      !validActivity(action,VERSION)||!keys(resident.cooldowns,ACTIVITIES)||
      !ACTIVITIES.every(key=>integer(resident.cooldowns[key],0,1000000012))||
      !boundedText(resident.lastOutcome,160))throw Error('Invalid Citizens resident');
    if(action){
      if(!integer(action.executionId,1,state.actionSequence)||
        executionIds.has(action.executionId))throw Error('Invalid Citizens execution');
      executionIds.add(action.executionId);
    }
    const object=objectById(world,resident.objectId);
    if(object?.assetId!=='orb'||object.anchorId!==ANCHOR_ID||object.component||
      hasActiveTransformOwner(object))
      throw Error('Citizens resident object is missing or incompatible');
    residentIds.add(resident.id);objectIds.add(resident.objectId);
  }
  const waitingIds=new Set();
  for(const station of state.stations){
    if(!keys(station,['id','kind','objectId','capacity','claim','waiters'])||
      !boundedText(station.id,32)||!station.id||stationIds.has(station.id)||
      !['rest','eat'].includes(station.kind)||stationKinds.has(station.kind)||
      !boundedText(station.objectId,128)||objectIds.has(station.objectId)||
      station.capacity!==1||!Array.isArray(station.waiters)||
      station.waiters.length>4)throw Error('Invalid Citizens station');
    const object=objectById(world,station.objectId);
    if(object?.assetId!==(station.kind==='rest'?'chair':'table')||
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
    'paused','resumed','waiting','released','retired','expired']);
  for(const entry of state.log)if(!keys(entry,['tick','residentId','event','message'])||
    !integer(entry.tick,0,state.clockTick)||!boundedText(entry.residentId,32)||
    (entry.residentId!==''&&!residentIds.has(entry.residentId)&&
      !retiredIds.has(entry.residentId))||!events.has(entry.event)||
    !boundedText(entry.message,160))throw Error('Invalid Citizens log');
}

function pose(x,z,scale=1){
  return {position:{x,y:0,z},rotation:{x:0,y:0,z:0},scale:{x:scale,y:scale,z:scale}};
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
    const state={schemaVersion:VERSION,world:{schemaVersion:1,roomId:world.scene.roomId},
      seed,rngState:seed,requestSequence:0,actionSequence:0,clockTick:0,paused:true,
      retiredResidentIds:[],
      residents:[
        {id:'ada',name:'Ada',objectId:adaId,needs:{hunger:72,energy:20,fun:62},
          preferences:{rest:1.2,eat:.85,explore:.75},activity:null,
          cooldowns:{rest:0,eat:0,explore:0},lastOutcome:''},
        {id:'bo',name:'Bo',objectId:boId,needs:{hunger:42,energy:29,fun:54},
          preferences:{rest:1.1,eat:1,explore:.75},activity:null,
          cooldowns:{rest:0,eat:0,explore:0},lastOutcome:''}
      ],stations:[
        {id:'chair',kind:'rest',objectId:chairId,capacity:1,claim:null,waiters:[]},
        {id:'food',kind:'eat',objectId:foodId,capacity:1,claim:null,waiters:[]}
      ],log:[]};
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
    const current=state?.schemaVersion===LEGACY_VERSION?migrateV1(world,state):state;
    validStateV2(world,current);
    this.world=world;
    this.state=clone(current);
    // Runtime-only baseline: the serialized scene supplies it again on restore.
    this.observedScene=world.scene;
    this.observedTransforms=new Map([...current.residents,...current.stations].map(bound=>
      [bound.objectId,clone(objectById(world,bound.objectId).transform)]));
    this.invalidBindings=new Set();
  }
  static restore(world,saved){return new CitizensSimulation(world,saved);}
  snapshot(){return clone(this.state);}
  exportState(){
    this.reconcileWorld();
    if(this.invalidBindings.size)throw Error('Citizens binding is missing or incompatible');
    validStateV2(this.world,this.state);
    return this.snapshot();
  }
  reconcileWorld(){this.reconcileBindings();return this.snapshot();}
  reconcileBindings(){
    try{assertWorld(this.world);}catch(error){
      if(!this.invalidBindings.has('world')){
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
        ?object.assetId==='orb'&&object.anchorId===ANCHOR_ID&&!object.component&&
          !hasActiveTransformOwner(object)
        :object.assetId===(bound.kind==='rest'?'chair':'table')&&
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
    this.state.stations=this.state.stations.filter(item=>item.id!==station.id);
    this.log('','retired',`${station.id} was removed after object deletion; surviving residents continue.`);
  }
  interruptBinding(kind,bound,reason){
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
  resume(){
    if(this.reconcileBindings())return this.snapshot();
    if(this.state.residents.length===0)return this.snapshot();
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
    this.state.log.push({tick:this.state.clockTick,residentId,event,message:message.slice(0,160)});
    if(this.state.log.length>MAX_LOG)this.state.log.shift();
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
  requestMove(resident,target){
    const object=objectById(this.world,resident.objectId);
    if(!object||object.anchorId!==ANCHOR_ID)return {ok:false,error:'resident object is missing'};
    if(object.component||hasActiveTransformOwner(object))
      return {ok:false,error:'resident transform is owned by another runtime capability'};
    const current=object.transform.position;
    const gap=distance(current,target);
    const fraction=gap>MOVE_METRES?MOVE_METRES/gap:1;
    const transform=clone(object.transform);
    transform.position.x=round(current.x+(target.x-current.x)*fraction);
    transform.position.z=round(current.z+(target.z-current.z)*fraction);
    const requestId=`citizens-${this.state.seed}-action-${resident.activity.executionId}-${++this.state.requestSequence}`;
    let receipt;
    try{receipt=this.world.execute({requestId,op:'set_transform',objectId:resident.objectId,
      transform},{recordHistory:false});}
    catch(error){return {ok:false,error:error.message||String(error)};}
    if(!receipt?.ok||receipt.requestId!==requestId||receipt.objectId!==resident.objectId)
      return {ok:false,error:receipt?.error||'missing or mismatched Matrix receipt'};
    const observed=objectById(this.world,resident.objectId);
    if(!observed)return {ok:false,error:'resident object is missing after movement'};
    this.observedTransforms.set(resident.objectId,clone(observed.transform));
    return {ok:true};
  }
  requestInteraction(resident,station){
    const requestId=`citizens-${this.state.seed}-action-${resident.activity.executionId}-${++this.state.requestSequence}`;
    let receipt;
    try{receipt=this.world.execute({requestId,op:'interact',
      actorObjectId:resident.objectId,targetObjectId:station.objectId,kind:station.kind},
    {recordHistory:false});}
    catch(error){return {ok:false,error:error.message||String(error)};}
    const outcome=receipt?.outcome;
    if(!receipt?.ok||receipt.requestId!==requestId||receipt.objectId!==resident.objectId||
       outcome?.kind!==station.kind||outcome.actorObjectId!==resident.objectId||
       outcome.targetObjectId!==station.objectId||
       !finite(outcome.observedDistanceMeters)||outcome.observedDistanceMeters<0||
       outcome.observedDistanceMeters>(station.kind==='rest'?.8:.9))
      return {ok:false,error:receipt?.error||'missing or mismatched interaction outcome'};
    return {ok:true};
  }
  targetFor(resident){
    const action=resident.activity;
    if(action.kind==='explore')return action.target;
    const station=this.station(action.stationId);
    const object=station&&objectById(this.world,station.objectId);
    if(!object||object.anchorId!==ANCHOR_ID||
      station.claim?.residentId!==resident.id||
      station.claim.executionId!==action.executionId)return null;
    const p=object.transform.position;
    return {x:p.x,z:p.z+(station.kind==='rest'?.62:.68)};
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
    const target=kind==='explore'?{
      x:round((this.nextRandom()-.5)*5),z:round(-.5-this.nextRandom()*3)
    }:null;
    resident.activity={kind,stationId:station?.id||null,phase:'travel',
      remainingTicks:kind==='rest'?7:kind==='eat'?5:1,travelTicks:0,target,
      executionId};
    this.log(resident.id,'selected',`${resident.name} chose ${kind}${station?` at ${station.id}`:''}: ${description}`);
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
  choose(resident){
    const actor=positionOf(this.world,resident.objectId);
    if(!actor){this.fail(resident,'resident object is missing');this.state.paused=true;return;}
    const scores=ACTIVITIES.map(kind=>{
      const station=this.state.stations.find(item=>item.kind===kind);
      const target=station?positionOf(this.world,station.objectId):null;
      const deficit=kind==='rest'?100-resident.needs.energy:
        kind==='eat'?100-resident.needs.hunger:100-resident.needs.fun;
      const travel=target?distance(actor,target):2;
      const score=deficit*resident.preferences[kind]-travel*2+this.nextRandom()*2;
      return {kind,station,score,deficit,travel};
    }).filter(candidate=>(candidate.kind==='explore'||candidate.station)&&
      candidate.score>8&&resident.cooldowns[candidate.kind]<=this.state.clockTick)
      .sort((a,b)=>b.score-a.score||ACTIVITIES.indexOf(a.kind)-ACTIVITIES.indexOf(b.kind));
    for(const candidate of scores){
      const {kind,station}=candidate;
      if(station){
        if(!positionOf(this.world,station.objectId)){
          this.log(resident.id,'blocked',`${resident.name}: ${kind} unavailable; station is missing.`);
          resident.cooldowns[kind]=this.state.clockTick+4;continue;
        }
        if(station.claim||station.waiters.length){
          const executionId=this.nextExecutionId();
          if(executionId===null)return;
          station.waiters.push({residentId:resident.id,executionId,
            enqueuedTick:this.state.clockTick});
          this.log(resident.id,'blocked',`${resident.name}: ${station.id} occupied by ${station.claim?.residentId||'an earlier waiter'}; ${kind} score ${round(candidate.score)}.`);
          this.log(resident.id,'waiting',
            `${resident.name} queued for ${station.id} as execution ${executionId}.`);
          return;
        }
      }
      const executionId=this.nextExecutionId();
      if(executionId===null)return;
      if(station)station.claim={residentId:resident.id,executionId,
        expiresTick:this.state.clockTick+LEASE_TICKS};
      const need=kind==='rest'?'energy':kind==='eat'?'hunger':'fun';
      this.beginActivity(resident,kind,station,executionId,
        `${need} ${round(resident.needs[need])}, score ${round(candidate.score)} (gap ${round(candidate.deficit)}, travel ${round(candidate.travel)}m); execution ${executionId}.`);
      return;
    }
  }
  progress(resident){
    const action=resident.activity;
    if(!action)return;
    const target=this.targetFor(resident);
    if(!target){this.fail(resident,'interaction target is missing or unavailable');return;}
    if(action.phase==='travel'){
      if(action.travelTicks>=MAX_TRAVEL_TICKS){this.fail(resident,'travel timed out');return;}
      const receipt=this.requestMove(resident,target);
      if(!receipt.ok){this.fail(resident,`movement rejected: ${receipt.error}`);return;}
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
    if(kind==='rest')resident.needs.energy=clamp(resident.needs.energy+37);
    if(kind==='eat')resident.needs.hunger=clamp(resident.needs.hunger+43);
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
      if(!resident.activity){
        const waiting=this.waitingFor(resident);
        if(waiting)this.progressWaiting(resident,waiting.station,waiting.entry);
        else this.choose(resident);
      }
      if(resident.activity)this.progress(resident);
    }
    return this.snapshot();
  }
}
