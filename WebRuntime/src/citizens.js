// Bounded desktop Citizens fixture. Policy and needs live here; MatrixWorld owns
// scene objects and validates every placement/move. No Agent Portal access.
import {ANCHOR_ID,MAX_OBJECTS,ROOM_ID} from './protocol.js';

const VERSION=1;
const MOVE_METRES=.28;
const ARRIVAL_METRES=.08;
const MAX_TRAVEL_TICKS=60;
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
const objectById=(world,id)=>world.scene.objects.find(object=>object.objectId===id);
const positionOf=(world,id)=>objectById(world,id)?.transform?.position;

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

function validActivity(activity){
  if(activity===null)return true;
  if(!keys(activity,['kind','stationId','phase','remainingTicks','travelTicks','target'])||
     !ACTIVITIES.includes(activity.kind)||!['travel','use'].includes(activity.phase)||
     !integer(activity.remainingTicks,0,12)||!integer(activity.travelTicks,0,MAX_TRAVEL_TICKS))return false;
  if(activity.kind==='explore')return activity.stationId===null&&
    keys(activity.target,['x','z'])&&finite(activity.target.x)&&finite(activity.target.z)&&
    Math.abs(activity.target.x)<=5&&Math.abs(activity.target.z)<=5;
  return boundedText(activity.stationId,32)&&activity.stationId.length>0&&activity.target===null;
}

function validState(world,state){
  assertWorld(world);
  if(!keys(state,['schemaVersion','world','seed','rngState','requestSequence','clockTick',
    'paused','residents','stations','log'])||state.schemaVersion!==VERSION||
    !keys(state.world,['schemaVersion','roomId'])||state.world.schemaVersion!==1||
    state.world.roomId!==world.scene.roomId||!integer(state.seed,1,0xffffffff)||
    !integer(state.rngState,0,0xffffffff)||!integer(state.requestSequence,0,1000000000)||
    !integer(state.clockTick,0,1000000000)||typeof state.paused!=='boolean'||
    !Array.isArray(state.residents)||state.residents.length<1||state.residents.length>4||
    !Array.isArray(state.stations)||state.stations.length<1||state.stations.length>8||
    !Array.isArray(state.log)||state.log.length>MAX_LOG)throw Error('Invalid Citizens state');
  const residentIds=new Set(),stationIds=new Set(),objectIds=new Set();
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
    if(object?.assetId!=='orb'||object.anchorId!==ANCHOR_ID||object.physics||object.component)
      throw Error('Citizens resident object is missing or incompatible');
    residentIds.add(resident.id);objectIds.add(resident.objectId);
  }
  for(const station of state.stations){
    if(!keys(station,['id','kind','objectId','capacity','holder'])||
       !boundedText(station.id,32)||!station.id||stationIds.has(station.id)||
       !['rest','eat'].includes(station.kind)||!boundedText(station.objectId,128)||
       objectIds.has(station.objectId)||station.capacity!==1||
       (station.holder!==null&&!residentIds.has(station.holder)))
      throw Error('Invalid Citizens station');
    const object=objectById(world,station.objectId);
    if(object?.assetId!==(station.kind==='rest'?'chair':'table')||
       object.anchorId!==ANCHOR_ID)
      throw Error('Citizens station object is missing or incompatible');
    stationIds.add(station.id);objectIds.add(station.objectId);
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
      seed,rngState:seed,requestSequence:0,clockTick:0,paused:true,
      residents:[
        {id:'ada',name:'Ada',objectId:adaId,needs:{hunger:72,energy:20,fun:62},
          preferences:{rest:1.2,eat:.85,explore:.75},activity:null,
          cooldowns:{rest:0,eat:0,explore:0},lastOutcome:''},
        {id:'bo',name:'Bo',objectId:boId,needs:{hunger:42,energy:29,fun:54},
          preferences:{rest:1.1,eat:1,explore:.75},activity:null,
          cooldowns:{rest:0,eat:0,explore:0},lastOutcome:''}
      ],stations:[
        {id:'chair',kind:'rest',objectId:chairId,capacity:1,holder:null},
        {id:'food',kind:'eat',objectId:foodId,capacity:1,holder:null}
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
    validState(world,state);
    this.world=world;
    this.state=clone(state);
  }
  static restore(world,saved){return new CitizensSimulation(world,saved);}
  snapshot(){return clone(this.state);}
  exportState(){return this.snapshot();}
  pause(){
    if(!this.state.paused){this.state.paused=true;this.log('', 'paused','Simulation paused.');}
    return this.snapshot();
  }
  resume(){
    assertWorld(this.world);
    if(this.state.paused){this.state.paused=false;this.log('','resumed','Simulation resumed.');}
    return this.snapshot();
  }
  advance(){return this.state.paused?this.snapshot():this.step();}
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
  release(resident){
    const station=this.station(resident.activity?.stationId);
    if(station?.holder===resident.id)station.holder=null;
  }
  fail(resident,reason){
    const kind=resident.activity?.kind;
    this.release(resident);
    resident.activity=null;
    if(kind)resident.cooldowns[kind]=this.state.clockTick+4;
    resident.lastOutcome=`Failed: ${reason}`;
    this.log(resident.id,'failed',`${resident.name}: ${reason}`);
  }
  requestMove(resident,target){
    const object=objectById(this.world,resident.objectId);
    if(!object||object.anchorId!==ANCHOR_ID)return {ok:false,error:'resident object is missing'};
    if(object.physics||object.component||object.behaviors?.some(behavior=>behavior.enabled&&!behavior.paused))
      return {ok:false,error:'resident transform is owned by another runtime capability'};
    const current=object.transform.position;
    const gap=distance(current,target);
    const fraction=gap>MOVE_METRES?MOVE_METRES/gap:1;
    const transform=clone(object.transform);
    transform.position.x=round(current.x+(target.x-current.x)*fraction);
    transform.position.z=round(current.z+(target.z-current.z)*fraction);
    const requestId=`citizens-${this.state.seed}-${++this.state.requestSequence}`;
    let receipt;
    try{receipt=this.world.execute({requestId,op:'set_transform',objectId:resident.objectId,
      transform},{recordHistory:false});}
    catch(error){return {ok:false,error:error.message||String(error)};}
    if(!receipt?.ok||receipt.requestId!==requestId||receipt.objectId!==resident.objectId)
      return {ok:false,error:receipt?.error||'missing or mismatched Matrix receipt'};
    return {ok:true};
  }
  requestInteraction(resident,station){
    const requestId=`citizens-${this.state.seed}-${++this.state.requestSequence}`;
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
    if(!object||object.anchorId!==ANCHOR_ID||station.holder!==resident.id)return null;
    const p=object.transform.position;
    return {x:p.x,z:p.z+(station.kind==='rest'?.62:.68)};
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
    }).filter(candidate=>candidate.score>8&&resident.cooldowns[candidate.kind]<=this.state.clockTick)
      .sort((a,b)=>b.score-a.score||ACTIVITIES.indexOf(a.kind)-ACTIVITIES.indexOf(b.kind));
    for(const candidate of scores){
      const {kind,station}=candidate;
      if(station){
        if(!positionOf(this.world,station.objectId)){
          this.log(resident.id,'blocked',`${resident.name}: ${kind} unavailable; station is missing.`);
          resident.cooldowns[kind]=this.state.clockTick+4;continue;
        }
        if(station.holder!==null){
          this.log(resident.id,'blocked',`${resident.name}: ${station.id} occupied by ${station.holder}; ${kind} score ${round(candidate.score)}.`);
          resident.cooldowns[kind]=this.state.clockTick+3;continue;
        }
        station.holder=resident.id;
      }
      const target=kind==='explore'?{
        x:round((this.nextRandom()-.5)*5),z:round(-.5-this.nextRandom()*3)
      }:null;
      resident.activity={kind,stationId:station?.id||null,phase:'travel',
        remainingTicks:kind==='rest'?7:kind==='eat'?5:1,travelTicks:0,target};
      const need=kind==='rest'?'energy':kind==='eat'?'hunger':'fun';
      this.log(resident.id,'selected',`${resident.name} chose ${kind}${station?` at ${station.id}`:''}: ${need} ${round(resident.needs[need])}, score ${round(candidate.score)} (gap ${round(candidate.deficit)}, travel ${round(candidate.travel)}m).`);
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
    try{assertWorld(this.world);}catch(error){
      this.state.paused=true;this.log('','failed',`Simulation stopped: ${error.message}`);
      return this.snapshot();
    }
    if(this.state.clockTick>=1000000000){
      this.state.paused=true;this.log('','failed','Simulation clock limit reached.');
      return this.snapshot();
    }
    this.state.clockTick++;
    for(const resident of this.state.residents){
      resident.needs.hunger=clamp(resident.needs.hunger-.45);
      resident.needs.energy=clamp(resident.needs.energy-.55);
      resident.needs.fun=clamp(resident.needs.fun-.25);
      if(!resident.activity)this.choose(resident);
      if(resident.activity)this.progress(resident);
    }
    return this.snapshot();
  }
}
