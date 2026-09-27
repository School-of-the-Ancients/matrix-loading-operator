// One PC process owns the Citizens clock. A visitor never advances this world.
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {MatrixWorld} from './protocol.js';
import {CitizensSimulation,createCitizensDemo} from './citizens.js';
import {restoreStoredWorld,storedWorld} from './scene_store.js';

const WORLD_NAME=/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const READ_ONLY_ERROR='This hosted Citizens world accepts observation only';
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')===expected.slice().sort().join(',');
const fail=message=>{throw Error(message);};

export function assertHostedFixture(value){
  if(!keys(value,['version','scene','game','citizens'])||value.version!==3||value.game!==null)
    fail('Hosted world needs the exact version 3 Citizens envelope');
  const scene=value.scene;
  if(!keys(scene,['schemaVersion','roomId','objects'])||scene.schemaVersion!==1||
     scene.roomId!=='web-virtual-room-v1'||!Array.isArray(scene.objects)||
     scene.objects.length!==4)fail('Hosted world needs the built-in virtual scene');
  const assets=scene.objects.map(object=>object.assetId).sort();
  if(assets.join(',')!=='chair,orb,orb,table'||
     scene.objects.some(object=>!keys(object,['objectId','assetId','anchorId','transform'])||
       object.anchorId!=='web-floor'))
    fail('Hosted world supports only two static resident markers and two stations');
  const citizens=value.citizens;
  if(citizens?.schemaVersion!==12||citizens.clockSpeed!==1||
     !Array.isArray(citizens.residents)||
     !Array.isArray(citizens.stations)||
     citizens.residents.map(item=>item.id).sort().join(',')!=='ada,bo'||
     citizens.stations.map(item=>item.id).sort().join(',')!=='chair,food')
    fail('Hosted world needs the built-in Ada and Bo Citizens state');
  const byId=new Map(scene.objects.map(object=>[object.objectId,object]));
  if(citizens.residents.some(item=>byId.get(item.objectId)?.assetId!=='orb')||
     citizens.stations.some(item=>byId.get(item.objectId)?.assetId!==
       (item.id==='chair'?'chair':'table')))
    fail('Hosted Citizens bindings do not match the built-in scene');
  return value;
}

function checkedBaseUrl(raw){
  const url=new URL(raw);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||
     !url.port||url.port==='8765'||url.pathname!=='/'||url.search||url.hash||
     url.username||url.password)
    fail('Use an explicit isolated loopback HTTP port other than 8765');
  return url.origin;
}

export function serviceRequest(baseUrl,token){
  const base=checkedBaseUrl(baseUrl);
  if(typeof token!=='string'||token.length<24)
    fail('SANDBOX_TOKEN must be at least 24 characters');
  return async(method,path,body)=>{
    const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,
      ...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
    const data=await response.json();
    if(!response.ok)fail(`${method} ${path}: ${response.status} ${data.error||'request failed'}`);
    return data;
  };
}

export class HostedWorld {
  constructor({name,seed=29,resumePaused=false,request,clientId=randomUUID()}={}){
    if(typeof name!=='string'||!WORLD_NAME.test(name)||
       /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name))
      fail('Invalid hosted world name');
    if(!Number.isSafeInteger(seed)||seed<1||seed>0xffffffff)
      fail('Hosted world seed must be a positive 32-bit integer');
    if(typeof request!=='function')fail('Hosted world needs a service request function');
    this.name=name;this.seed=seed;this.resumePaused=resumePaused;
    this.request=request;this.clientId=clientId;
    this.world=new MatrixWorld();
    this.world.runtimePresentation='host';
    this.simulation=null;
    this.results=new Map();
    this.started=false;this.busy=false;this.failed=false;
  }

  async exchange(expectedRevision){
    // Results stay in memory until an exchange succeeds. Any ambiguous network
    // outcome aborts the process; a later process restores the last checkpoint.
    for(let round=0;round<8;round++){
      const results=[...this.results.values()];
      const body={clientId:this.clientId,hostWorldId:this.name,
        snapshot:this.world.snapshot(null),results,captureSupported:false,
        ...(expectedRevision===undefined?{}:{worldRestoreExpectedRevision:expectedRevision})};
      const response=await this.request('POST','/api/exchange',body);
      this.results.clear();
      expectedRevision=undefined;
      if(!Array.isArray(response.commands))fail('Service exchange omitted commands');
      for(const command of response.commands){
        if(typeof command?.requestId!=='string'||!command.requestId)
          fail('Service returned an invalid command');
        this.results.set(command.requestId,{requestId:command.requestId,ok:false,
          error:READ_ONLY_ERROR,objectId:''});
      }
      if(!this.results.size)return;
    }
    fail('Hosted world could not drain operator commands');
  }

  async save(){
    const world=assertHostedFixture(storedWorld(this.world));
    await this.request('POST','/api/web/world/save',{name:this.name,world});
  }

  async start(){
    if(this.started||this.failed)fail('Hosted world cannot start twice');
    try{
      const status=await this.request('GET','/api/state');
      if(status.online||status.pendingCount!==0)
        fail('Service already has an active runtime or pending commands');
      if(status.snapshot!==null&&
         (status.snapshot?.runtimeDescriptor?.client!=='matrix-world-host'||
          status.hostWorldId!==this.name))
        fail('Service contains a different prior runtime; use a dedicated service');
      const listing=await this.request('GET','/api/web/worlds');
      if(!Array.isArray(listing.worlds))fail('Service omitted world checkpoint list');
      if(listing.worlds.some(item=>typeof item==='string'&&
          item.toLowerCase()===this.name.toLowerCase()&&item!==this.name))
        fail('Hosted world name conflicts with an existing checkpoint spelling');
      const exists=listing.worlds.includes(this.name);
      if(status.snapshot!==null&&!exists)
        fail('Prior hosted runtime has no durable checkpoint; inspect before restarting');
      await this.exchange();
      if(exists){
        const loaded=await this.request('POST','/api/web/world/load',{name:this.name});
        assertHostedFixture(loaded.world);
        if(!Number.isSafeInteger(loaded.expectedRevision))
          fail('Service world load omitted expected revision');
        restoreStoredWorld(this.world,loaded.world);
        this.simulation=CitizensSimulation.restore(this.world,this.world.citizens);
        if(this.simulation.snapshot().paused){
          if(!this.resumePaused)fail('Checkpoint is paused; pass --resume-paused after inspection');
          this.simulation.resume();
          if(this.simulation.snapshot().paused)fail('Citizens could not safely resume');
        }
        this.world.citizens=this.simulation.snapshot();
        await this.exchange(loaded.expectedRevision);
      }else{
        this.simulation=createCitizensDemo(this.world,{seed:this.seed});
        this.simulation.resume();
        if(this.simulation.snapshot().paused)fail('Citizens could not safely start');
        this.world.citizens=this.simulation.snapshot();
        await this.exchange();
      }
      await this.save();
      this.started=true;
      return this.simulation.snapshot();
    }catch(error){this.failed=true;throw error;}
  }

  async tick(){
    if(!this.started||this.busy||this.failed)
      fail('Hosted world is not ready for a serial tick');
    this.busy=true;
    try{
      if(this.simulation.snapshot().paused)fail('Citizens world paused; inspect its checkpoint');
      const before=this.simulation.snapshot().clockTick;
      this.world.citizens=this.simulation.advance();
      if(this.world.citizens.clockTick!==before+1)
        fail('Citizens tick did not advance exactly once');
      await this.exchange();
      await this.save();
      if(this.simulation.snapshot().paused)
        fail('Citizens paused after the tick; checkpoint saved for inspection');
      return this.simulation.snapshot();
    }catch(error){this.failed=true;throw error;}
    finally{this.busy=false;}
  }

  async run({ticks=Infinity,intervalMs=500,signal}={}){
    if(!(ticks===Infinity||Number.isSafeInteger(ticks)&&ticks>=0)||
       !Number.isSafeInteger(intervalMs)||intervalMs<100)
      fail('Invalid tick count or interval');
    if(!this.started)await this.start();
    for(let count=0;count<ticks&&!signal?.aborted;count++){
      await this.tick();
      if(count+1<ticks&&!signal?.aborted){
        try{await delay(intervalMs,undefined,{signal});}
        catch(error){if(error?.name!=='AbortError')throw error;}
      }
    }
    return this.simulation.snapshot();
  }
}

function cliOptions(args){
  const options={ticks:Infinity,resumePaused:false};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--resume-paused'){options.resumePaused=true;continue;}
    if(!['--url','--name','--seed','--ticks'].includes(arg)||!args[i+1])
      fail(`Unknown or incomplete argument: ${arg}`);
    options[arg.slice(2)]=args[++i];
  }
  if(!options.url||!options.name)fail('Usage: node src/host_world.js --url http://127.0.0.1:PORT --name NAME [--seed N] [--ticks N] [--resume-paused]');
  options.seed=options.seed===undefined?29:Number(options.seed);
  options.ticks=options.ticks===Infinity?Infinity:Number(options.ticks);
  return options;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{
    const options=cliOptions(process.argv.slice(2));
    const request=serviceRequest(options.url,process.env.SANDBOX_TOKEN);
    const host=new HostedWorld({...options,request});
    const stop=new AbortController();
    process.once('SIGINT',()=>stop.abort());
    process.once('SIGTERM',()=>stop.abort());
    const final=await host.run({ticks:options.ticks,signal:stop.signal});
    console.log(`Hosted ${options.name} at Citizens tick ${final.clockTick}; saved PC checkpoint.`);
  }catch(error){
    if(error?.name!=='AbortError')console.error(`World host stopped: ${error.message}`);
    process.exitCode=1;
  }
}
