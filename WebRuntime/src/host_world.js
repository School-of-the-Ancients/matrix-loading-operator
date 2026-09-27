// One PC process owns the Citizens clock. A visitor never advances this world.
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MatrixWorld} from './protocol.js';
import {CITIZEN_BENCH_INTERACTION,CitizensSimulation,createCitizensDemo,
  citizenGeneratedRestInteraction} from './citizens.js';
import {createProceduralRecipe,normalizeProceduralRecipe} from './procedural.js';
import {restoreStoredWorld,storedWorld} from './scene_store.js';

const WORLD_NAME=/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const UNSUPPORTED_COMMAND='This hosted Citizens world accepts only a reviewed creation command';
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')===expected.slice().sort().join(',');
const sameTransform=(a,b)=>a&&b&&['position','rotation','scale'].every(part=>
  ['x','y','z'].every(axis=>a[part]?.[axis]===b[part]?.[axis]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=message=>{throw Error(message);};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonicalJson=value=>JSON.stringify(value,(_,item)=>
  item&&typeof item==='object'&&!Array.isArray(item)?
    Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):
    item);

export function assertHostedFixture(value){
  if(!keys(value,['version','scene','game','citizens'])||value.version!==3||value.game!==null)
    fail('Hosted world needs the exact version 3 Citizens envelope');
  const scene=value.scene;
  if(!keys(scene,['schemaVersion','roomId','objects'])||scene.schemaVersion!==1||
     scene.roomId!=='web-virtual-room-v1'||!Array.isArray(scene.objects)||
     ![4,5].includes(scene.objects.length))
    fail('Hosted world needs the built-in virtual scene and at most one construction');
  const citizens=value.citizens;
  if(![12,13,14,15].includes(citizens?.schemaVersion)||citizens.clockSpeed!==1||
     !Array.isArray(citizens.residents)||
     !Array.isArray(citizens.stations)||
     citizens.residents.map(item=>item.id).sort().join(',')!=='ada,bo'||
     !['chair,food','chair,citizen-bench,food'].includes(
       citizens.stations.map(item=>item.id).sort().join(',')))
    fail('Hosted world needs the built-in Ada and Bo Citizens state');
  const bench=citizens.stations.find(item=>item.id==='citizen-bench');
  const construction=citizens.schemaVersion>=13?citizens.construction:null;
  const generated=citizens.schemaVersion===15?citizens.generatedConstruction:null;
  const generatedCreated=generated&&['created','used'].includes(generated.status);
  const journal=citizens.schemaVersion>=14?citizens.capabilityRequests:null;
  const matches=Array.isArray(journal)?journal.filter(item=>
    item.request?.intentId===construction?.intentId):[];
  const capability=matches[0];
  // A v13 checkpoint migrates to v14 with an empty journal. Historical
  // construction receipts were not stored, so do not invent them on restore.
  if(citizens.schemaVersion>=14&&(!Array.isArray(journal)||journal.length>4||
     matches.length>1||journal.filter(item=>
       ['requested','queued','generating','registered','spawning'].includes(
         item.status)).length>1))
    fail('Hosted Citizen capability journal and construction disagree');
  if((bench&&citizens.schemaVersion<13)||
     (bench&&!generatedCreated&&
       (!construction||!['created','used'].includes(construction.status)))||
     (!bench&&(generatedCreated||construction&&
       ['created','used'].includes(construction.status))))
    fail('Hosted construction station and resident provenance disagree');
  const byId=new Map(scene.objects.map(object=>[object.objectId,object]));
  const coreStations=citizens.stations.filter(item=>item.id!=='citizen-bench');
  const core=new Set([...citizens.residents,...coreStations].map(item=>item.objectId));
  if(byId.size!==scene.objects.length||core.size!==4||
     [...core].some(id=>!keys(byId.get(id),['objectId','assetId','anchorId','transform'])||
       byId.get(id).anchorId!=='web-floor'))
    fail('Hosted world supports only two static resident markers and two stations');
  if(citizens.residents.some(item=>byId.get(item.objectId)?.assetId!=='orb')||
     coreStations.some(item=>byId.get(item.objectId)?.assetId!==
       (item.id==='chair'?'chair':'table')))
    fail('Hosted Citizens bindings do not match the built-in scene');
  const additions=scene.objects.filter(object=>!core.has(object.objectId));
  if(additions.length>1||additions.some(object=>{
    if(object.anchorId!=='web-floor')return true;
    if(object.assetId==='matrix:procedural'){
      if(!keys(object,['objectId','assetId','anchorId','transform','procedural',
        ...(bench?['interaction']:[])]))return true;
      normalizeProceduralRecipe(object.procedural);
      return Boolean(generatedCreated);
    }
    if(!generated||object.assetId!==generated.assetId)return true;
    if(generatedCreated)return !keys(object,
      ['objectId','assetId','anchorId','transform','interaction']);
    return generated.status!=='spawning'||!keys(object,
      ['objectId','assetId','anchorId','transform']);
  }))
    fail('Hosted world supports one reviewed Citizen addition');
  if(bench){
    const object=additions[0];
    if(generatedCreated){
      const entry=journal.find(item=>item.request?.intentId===generated.intentId);
      if(!object||object.objectId!==bench.objectId||
         object.objectId!==generated.objectId||
         object.assetId!==generated.assetId||
         !/^[0-9a-f]{64}$/.test(generated.sha256)||
         !same(object.interaction,
           citizenGeneratedRestInteraction(generated.sha256))||
         !sameTransform(object.transform,
           entry?.request?.parameters?.transform)||
         entry?.work?.objectId!==object.objectId||
         entry?.work?.sha256!==generated.sha256)
        fail('Hosted generated seat differs from its reviewed capability request');
    }else if(!object||object.objectId!==bench.objectId||
       object.objectId!==construction.objectId||
       object.procedural.generatorId!=='curved-bench'||
       (capability&&!same(object.procedural,createProceduralRecipe(
         capability.request.parameters.generatorId,
         capability.request.parameters.parameters)))||
       !same(object.interaction,capability?.request?.parameters?.interaction??
         CITIZEN_BENCH_INTERACTION)||
       (capability&&!sameTransform(object.transform,
         capability.request.parameters.transform)))
      fail('Hosted bench differs from its reviewed capability request');
  }
  if(generated?.status==='spawning'&&additions.length){
    const entry=journal.find(item=>item.request?.intentId===generated.intentId);
    if(!sameTransform(additions[0].transform,
      entry?.request?.parameters?.transform))
      fail('Hosted spawning GLB differs from its approved pose');
  }
  return value;
}

function checkedBaseUrl(raw){
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol)||
     !['127.0.0.1','localhost','[::1]'].includes(url.hostname)||
     !url.port||url.port==='8765'||url.pathname!=='/'||url.search||url.hash||
     url.username||url.password)
    fail('Use an explicit isolated loopback HTTP or HTTPS port other than 8765');
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

export function serviceAssetBytes(baseUrl,token){
  const base=checkedBaseUrl(baseUrl);
  if(typeof token!=='string'||token.length<24)
    fail('SANDBOX_TOKEN must be at least 24 characters');
  return async digest=>{
    if(!/^[0-9a-f]{64}$/.test(digest))fail('Invalid hosted GLB digest');
    const response=await fetch(`${base}/api/web/assets/${digest}.glb`,{
      headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
    if(!response.ok)fail(`Registered GLB fetch failed: HTTP ${response.status}`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length<20||bytes.length>16*1024*1024||sha256(bytes)!==digest)
      fail('Registered GLB bytes differ from their catalog digest');
    return bytes;
  };
}

export class HostedWorld {
  constructor({name,seed=29,resumePaused=false,citizenConstruction=false,
    citizenCapabilities=citizenConstruction,
    citizenGeneratedAsset=false,request,assetBytes,clientId=randomUUID()}={}){
    if(typeof name!=='string'||!WORLD_NAME.test(name)||
       /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name))
      fail('Invalid hosted world name');
    if(!Number.isSafeInteger(seed)||seed<1||seed>0xffffffff)
      fail('Hosted world seed must be a positive 32-bit integer');
    if(typeof request!=='function')fail('Hosted world needs a service request function');
    if(citizenCapabilities&&citizenGeneratedAsset)
      fail('Choose one autonomous Citizen capability demonstration');
    this.name=name;this.seed=seed;this.resumePaused=resumePaused;
    this.citizenCapabilities=citizenCapabilities;
    this.citizenGeneratedAsset=citizenGeneratedAsset;
    this.request=request;this.clientId=clientId;
    this.assetBytes=assetBytes;
    this.world=new MatrixWorld();
    this.world.runtimePresentation='host';
    this.simulation=null;
    this.results=new Map();
    this.started=false;this.busy=false;this.failed=false;
    this.activeCapability=null;
  }

  async refreshAssetCatalog(){
    const catalog=await this.request('GET','/api/web/assets');
    if(!keys(catalog,['assets'])||!Array.isArray(catalog.assets))
      fail('Service omitted the registered GLB catalog');
    this.world.registerAssets(catalog.assets);
    return catalog.assets;
  }

  async verifyHostedGlb(objectId,assetId,digest){
    const object=this.world.scene.objects.find(item=>item.objectId===objectId);
    const asset=this.world.asset(assetId);
    if(!object||object.assetId!==assetId||object.anchorId!=='web-floor'||
       !asset||asset.sha256!==digest||asset.url!==`/api/web/assets/${digest}.glb`||
       !asset.localBounds||asset.geometry?.images!==0||
       asset.geometry?.animationClips?.length||typeof this.assetBytes!=='function')
      fail('Generated GLB is not an eligible registered static asset');
    const bytes=await this.assetBytes(digest);
    if(!(bytes instanceof Uint8Array)||bytes.length<20||
       bytes.length>16*1024*1024||sha256(bytes)!==digest)
      fail('Generated GLB bytes differ from the registered digest');
    const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    const gltf=await new GLTFLoader().parseAsync(buffer,'');
    if(gltf.animations.length!==0)
      fail('Generated rest asset has animation');
    const measured=new THREE.Box3().setFromObject(gltf.scene)
      .getSize(new THREE.Vector3());
    const size={x:measured.x,y:measured.y,z:measured.z};
    if(!Object.values(size).every(value=>Number.isFinite(value)&&value>0&&value<=20)||
       !this.world.verifyPhysicsAsset(assetId,size,objectId)||
       !this.world.renderedAssetVerified(object))
      fail('Generated GLB geometry differs from its registered bounds');
    return size;
  }

  async exchange(expectedRevision,{saveBeforeCommands=false,
    deferResults=false}={}){
    // Results stay in memory until an exchange succeeds. Any ambiguous network
    // outcome aborts the process; a later process restores the last checkpoint.
    const observed=[];
    for(let round=0;round<8;round++){
      const results=[...this.results.values()];
      const body={clientId:this.clientId,hostWorldId:this.name,
        snapshot:this.world.snapshot(null),results,captureSupported:false,
        ...(expectedRevision===undefined?{}:{worldRestoreExpectedRevision:expectedRevision})};
      const response=await this.request('POST','/api/exchange',body);
      this.results.clear();
      expectedRevision=undefined;
      if(!Array.isArray(response.commands))fail('Service exchange omitted commands');
      if(saveBeforeCommands&&response.commands.some(item=>
        item?.requestId===this.activeCapability?.requestId)){
        // Save the issued Matrix request ID before the host executes it. A
        // crash after this point restores an unresolved command, never an
        // apparently unissued request that may be submitted again.
        await this.save();
        saveBeforeCommands=false;
      }
      for(const command of response.commands){
        if(typeof command?.requestId!=='string'||!command.requestId)
          fail('Service returned an invalid command');
        const canCreate=this.started&&this.simulation&&
          command.op==='create_procedural'&&
          keys(command,['requestId','op','anchorId','transform','procedural'])&&
          this.world.scene.objects.length===4&&
          (!this.activeCapability||
            command.requestId===this.activeCapability.requestId&&
            this.activeCapability.request.capability==='procedural'&&
            this.activeCapability.request.action==='create'&&
            same(command.procedural,createProceduralRecipe(
              this.activeCapability.request.parameters.generatorId,
              this.activeCapability.request.parameters.parameters))&&
            sameTransform(command.transform,
              this.activeCapability.request.parameters.transform));
        const canSpawn=this.started&&this.simulation&&
          command.op==='spawn'&&this.world.scene.objects.length===4&&
          keys(command,['requestId','op','assetId','anchorId','transform'])&&
          command.anchorId==='web-floor'&&
          this.activeCapability?.request.capability==='asset'&&
          this.activeCapability.request.action==='generate'&&
          command.requestId===this.activeCapability.requestId&&
          command.assetId===this.activeCapability.assetId&&
          this.world.asset(command.assetId)?.sha256===this.activeCapability.sha256&&
          sameTransform(command.transform,
            this.activeCapability.request.parameters.transform);
        const result=canCreate||canSpawn?
          this.world.execute(command,{recordHistory:false}):
          {requestId:command.requestId,ok:false,error:UNSUPPORTED_COMMAND,objectId:''};
        if(result.ok)assertHostedFixture(storedWorld(this.world));
        this.results.set(command.requestId,result);
        observed.push(result);
      }
      if(deferResults)return observed;
      if(!this.results.size)return observed;
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
      // The checkpoint validator requires referenced Web GLBs in the live
      // headless runtime catalog before it will load the saved world.
      await this.refreshAssetCatalog();
      await this.exchange();
      if(exists){
        const loaded=await this.request('POST','/api/web/world/load',{name:this.name});
        assertHostedFixture(loaded.world);
        if(!Number.isSafeInteger(loaded.expectedRevision))
          fail('Service world load omitted expected revision');
        restoreStoredWorld(this.world,loaded.world);
        const generated=this.world.citizens?.generatedConstruction;
        if(generated&&['created','used'].includes(generated.status))
          await this.verifyHostedGlb(generated.objectId,generated.assetId,
            generated.sha256);
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
      const state=this.simulation.snapshot();
      if(state.capabilityRequests?.some(item=>item.status==='queued'||
          item.status==='spawning'||item.status==='unconfirmed'))
        fail('Checkpoint has a queued Citizen capability; inspect its Matrix receipt');
      if(state.capabilityRequests?.some(item=>item.status==='requested'&&
          item.request.capability!=='asset'))
        fail('Checkpoint has an unresolved Citizen capability request; inspect policy and Matrix status');
      if(!this.citizenGeneratedAsset&&state.capabilityRequests?.some(item=>
          item.request.capability==='asset'&&
          ['requested','generating','registered'].includes(item.status)))
        fail('Generated Citizen capability needs --citizen-generated-asset to resume');
      if(state.construction?.status==='queued')
        fail('Checkpoint has a queued Citizen construction; inspect its Matrix receipt');
      if(state.construction?.status==='requested')
        fail('Checkpoint has an unresolved Citizen construction request; inspect policy and Matrix status');
      await this.save();
      this.started=true;
      if(this.citizenGeneratedAsset)await this.progressGeneratedCapability();
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
      if(this.citizenCapabilities)this.simulation.proposeConstruction();
      if(this.citizenGeneratedAsset)this.simulation.proposeGeneratedConstruction();
      const pending=this.citizenCapabilities||this.citizenGeneratedAsset?
        this.simulation.pendingCapabilityRequest():null;
      this.world.citizens=this.simulation.snapshot();
      await this.exchange();
      await this.save();
      if(pending&&pending.request.capability==='asset')
        await this.fulfillGeneratedCapability(pending);
      else if(pending)await this.fulfillCapability(pending);
      if(this.citizenGeneratedAsset)await this.progressGeneratedCapability();
      if(this.simulation.snapshot().paused)
        fail('Citizens paused after the tick; checkpoint saved for inspection');
      return this.simulation.snapshot();
    }catch(error){this.failed=true;throw error;}
    finally{this.busy=false;}
  }

  async fulfillGeneratedCapability(entry){
    const request=entry.request;
    if(!keys(request,['citizenRequestId','intentId','residentId','capability',
      'action','parameters','checkpoint'])||request.capability!=='asset'||
      request.action!=='generate'||
      !keys(request.parameters,['profileId','transform'])||
      request.parameters.profileId!=='rest-seat-v1')
      fail('Generated Citizen capability request has no reviewed saved envelope');
    const decision=await this.request('POST','/api/citizens/capabilities',request);
    if(!keys(decision,['allowed','requestId','reason','checkpointSequence'])||
       !Number.isSafeInteger(decision.checkpointSequence)||
       decision.checkpointSequence<0||typeof decision.reason!=='string'||
       decision.allowed!==true&&decision.allowed!==false||
       (decision.allowed&&(!/^[0-9a-f]{32}$/.test(decision.requestId)||
         decision.reason!==''))||
       (!decision.allowed&&(decision.requestId!==null||!decision.reason)))
      fail('Generated Citizen policy returned an invalid decision');
    this.world.citizens=this.simulation.capabilityDecision(decision);
    await this.exchange();
    await this.save();
  }

  async progressGeneratedCapability(){
    const entry=this.simulation.snapshot().capabilityRequests?.find(item=>
      item.request.capability==='asset'&&item.request.action==='generate');
    if(!entry||['succeeded','denied','failed'].includes(entry.status))return;
    if(entry.status==='requested'){
      await this.fulfillGeneratedCapability(entry);
      return this.progressGeneratedCapability();
    }
    if(entry.status==='generating'){
      const jobId=entry.work.jobId;
      if(!/^[0-9a-f]{32}$/.test(jobId))
        fail('Generated Citizen capability lost its Blender job ID');
      const job=await this.request('GET',`/api/web/blender/${jobId}`);
      if(job.jobId!==jobId||job.hostWorldId!==this.name||
         job.citizenRequestId!==entry.request.citizenRequestId||
         job.requestSha256!==sha256(canonicalJson(entry.request))||
         job.profileId!=='rest-seat-v1'||
         !/^[0-9a-f]{64}$/.test(job.profileRevision))
        fail('Blender job differs from the saved Citizen request');
      if(['queued','designing','building','generated','registered']
        .includes(job.phase)&&!job.error)return;
      if(['generated','registered'].includes(job.phase)&&job.error){
        this.world.citizens=this.simulation.generatedCapabilityFailed(
          `Blender registration is unresolved: ${job.error}`.slice(0,160),
          {unconfirmed:true});
        await this.exchange();
        await this.save();
        fail('Blender registration is unresolved; inspect before continuing');
      }
      if(job.phase==='unconfirmed'){
        this.world.citizens=this.simulation.generatedCapabilityFailed(
          'Blender job outcome is unconfirmed; inspect before continuing',
          {unconfirmed:true});
        await this.exchange();
        await this.save();
        fail('Blender job outcome is unconfirmed; inspect before continuing');
      }
      if(job.phase==='error'){
        this.world.citizens=this.simulation.generatedCapabilityFailed(
          String(job.error||'Blender generation failed').slice(0,160));
        await this.exchange();
        await this.save();
        return;
      }
      if(job.phase!=='ready'||!job.asset||
         !/^web:[a-z0-9-]+:[0-9a-f]{12}$/.test(job.asset.assetId)||
         !/^[0-9a-f]{64}$/.test(job.asset.sha256)){
        this.world.citizens=this.simulation.generatedCapabilityFailed(
          'Blender job did not confirm a registered GLB');
        await this.exchange();
        await this.save();
        return;
      }
      const catalog=await this.refreshAssetCatalog();
      const asset=catalog.find(item=>item.assetId===job.asset.assetId);
      if(!asset||asset.sha256!==job.asset.sha256||
         !same(asset,job.asset)){
        this.world.citizens=this.simulation.generatedCapabilityFailed(
          'Blender job asset differs from the registered catalog');
        await this.exchange();
        await this.save();
        return;
      }
      this.world.citizens=this.simulation.generatedAssetRegistered({
        jobId,assetId:asset.assetId,sha256:asset.sha256});
      await this.exchange();
      await this.save();
    }
    const registered=this.simulation.snapshot().capabilityRequests?.find(item=>
      item.request.citizenRequestId===entry.request.citizenRequestId);
    if(registered?.status==='registered')
      await this.dispatchGeneratedAsset(registered);
  }

  async dispatchGeneratedAsset(entry){
    const {request,work}=entry;
    if(this.world.scene.objects.length!==4||
       this.world.asset(work.assetId)?.sha256!==work.sha256)
      fail('Generated asset spawn has no exact four-object Matrix world');
    const dispatched=await this.request('POST','/api/citizens/capabilities/dispatch',{
      citizenRequestId:request.citizenRequestId,jobId:work.jobId,
      assetId:work.assetId,sha256:work.sha256});
    if(!/^[0-9a-f]{32}$/.test(dispatched?.requestId)||
       !['queued','unconfirmed','failed','succeeded']
         .includes(dispatched.status)||
       dispatched.assetId!==work.assetId||
       dispatched.roomId!==this.world.scene.roomId)
      fail('Generated asset spawn was not queued by the typed Matrix path');
    this.world.citizens=this.simulation.generatedSpawnQueued(dispatched.requestId);
    if(dispatched.status!=='queued'){
      const status=await this.request('GET','/api/state');
      if(status.pendingCount!==0||!same(status.snapshot?.scene,this.world.scene))
        fail('Generated Matrix spawn outcome is ambiguous; inspect the runtime');
      this.world.citizens=this.simulation.generatedCapabilityFailed(
        `Generated Matrix spawn ${dispatched.status} lacks a saved Citizen receipt`,
        {unconfirmed:true});
      await this.exchange();
      await this.save();
      fail('Generated Matrix spawn outcome is unconfirmed; inspect before continuing');
    }
    this.activeCapability={request,requestId:dispatched.requestId,
      assetId:work.assetId,sha256:work.sha256};
    let results;
    try{results=await this.exchange(undefined,{saveBeforeCommands:true,
      deferResults:true});}
    finally{this.activeCapability=null;}
    const matched=results.filter(item=>item.requestId===dispatched.requestId);
    if(matched.length!==1)
      fail('Generated asset spawn has no exact Matrix receipt');
    const spawn=matched[0];
    if(!spawn.ok){
      if(this.world.scene.objects.length!==4)
        fail('Failed generated asset spawn changed the hosted scene');
      this.world.citizens=this.simulation.generatedCapabilityFailed(
        String(spawn.error||'Matrix rejected the generated asset').slice(0,160),
        {receipts:[spawn]});
      await this.exchange();
      await this.save();
      return;
    }
    const object=this.world.scene.objects.find(item=>item.objectId===spawn.objectId);
    if(!object||object.assetId!==work.assetId||object.anchorId!=='web-floor'||
       !sameTransform(object.transform,request.parameters.transform))
      fail('Matrix spawn receipt differs from the registered Citizen asset');
    let interaction=null;
    try{
      await this.verifyHostedGlb(spawn.objectId,work.assetId,work.sha256);
      interaction=this.world.execute({requestId:`${dispatched.requestId}-interaction`,
        op:'set_interaction',objectId:spawn.objectId,
        interaction:citizenGeneratedRestInteraction(work.sha256),
        expectedInteraction:null},{recordHistory:false});
      if(!interaction?.ok||
         interaction.requestId!==`${dispatched.requestId}-interaction`||
         interaction.objectId!==spawn.objectId)
        throw Error(interaction?.error||'Matrix did not confirm generated rest interaction');
      this.world.citizens=this.simulation.generatedCapabilityCompleted([spawn,interaction]);
    }catch(error){
      const rollback=this.world.execute({requestId:`${dispatched.requestId}-rollback`,
        op:'delete',objectId:spawn.objectId},{recordHistory:false});
      if(!rollback?.ok||this.world.scene.objects.some(item=>
        item.objectId===spawn.objectId))
        fail('Generated asset failed and Matrix rollback was not confirmed');
      this.world.citizens=this.simulation.generatedCapabilityFailed(
        String(error?.message||'Generated asset interaction failed').slice(0,160),
        {receipts:[spawn,...(interaction?[interaction]:[]),rollback]});
    }
    await this.exchange();
    await this.save();
  }

  async fulfillCapability(entry){
    const request=entry.request;
    if(!keys(request,['citizenRequestId','intentId','residentId','capability',
      'action','parameters','checkpoint']))
      fail('Citizen capability request has no exact saved envelope');
    const decision=await this.request('POST','/api/citizens/capabilities',request);
    if(!keys(decision,['allowed','requestId','reason','checkpointSequence'])||
       !Number.isSafeInteger(decision.checkpointSequence)||
       decision.checkpointSequence<0||typeof decision.reason!=='string'||
       decision.allowed!==true&&decision.allowed!==false||
       (decision.allowed&&(!/^[0-9a-f]{32}$/.test(decision.requestId)||
         decision.reason!==''))||
       (!decision.allowed&&(decision.requestId!==null||!decision.reason)))
      fail('Citizen capability policy returned an invalid decision');
    this.world.citizens=this.simulation.capabilityDecision(decision);
    if(!decision.allowed){
      await this.exchange();
      await this.save();
      return;
    }
    // Only a reviewed adapter can reach this dispatch. The resident never
    // receives the owner token or a Matrix command surface.
    if(request.capability!=='procedural'||request.action!=='create')
      fail('Citizen capability adapter is unavailable');
    this.activeCapability={request,requestId:decision.requestId};
    let results;
    try{results=await this.exchange();}
    finally{this.activeCapability=null;}
    const matched=results.filter(item=>item.requestId===decision.requestId);
    if(matched.length!==1)fail('Citizen capability has no exact Matrix receipt');
    const creation=matched[0];
    if(!creation.ok){
      if(this.world.scene.objects.length!==4)
        fail('Failed Matrix capability changed the hosted scene');
      this.world.citizens=this.simulation.capabilityFailed([creation],
        String(creation.error||'Matrix rejected the capability').slice(0,160));
      await this.exchange();
      await this.save();
      return;
    }
    const object=this.world.scene.objects.find(item=>item.objectId===creation.objectId);
    const parameters=request.parameters;
    if(!object||object.assetId!=='matrix:procedural'||
       !same(object.procedural,createProceduralRecipe(
         parameters.generatorId,parameters.parameters))||
       !sameTransform(object.transform,parameters.transform))
      fail('Matrix creation receipt does not match the saved capability request');
    const interaction=this.world.execute({requestId:`${decision.requestId}-interaction`,
      op:'set_interaction',objectId:creation.objectId,
      interaction:structuredClone(parameters.interaction),
      expectedInteraction:null},{recordHistory:false});
    try{
      if(!interaction?.ok||interaction.requestId!==`${decision.requestId}-interaction`||
         interaction.objectId!==creation.objectId)
        throw Error(interaction?.error||'Matrix did not confirm the reviewed interaction');
      this.world.citizens=this.simulation.capabilityCompleted([creation,interaction]);
    }catch(error){
      const rollback=this.world.execute({requestId:`${decision.requestId}-rollback`,
        op:'delete',objectId:creation.objectId},{recordHistory:false});
      if(!rollback?.ok||this.world.scene.objects.some(item=>item.objectId===creation.objectId))
        fail('Citizen capability failed and Matrix rollback was not confirmed');
      this.world.citizens=this.simulation.capabilityFailed(
        [creation,interaction,rollback],
        String(error?.message||'Matrix interaction failed').slice(0,160));
    }
    await this.exchange();
    await this.save();
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
  const options={ticks:Infinity,intervalMs:500,resumePaused:false,
    citizenConstruction:false,citizenGeneratedAsset:false};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--resume-paused'){options.resumePaused=true;continue;}
    if(arg==='--citizen-construction'||arg==='--citizen-capabilities'){
      options.citizenCapabilities=true;continue;
    }
    if(arg==='--citizen-generated-asset'){
      options.citizenGeneratedAsset=true;continue;
    }
    if(!['--url','--name','--seed','--ticks','--interval-ms'].includes(arg)||!args[i+1])
      fail(`Unknown or incomplete argument: ${arg}`);
    if(arg==='--interval-ms')options.intervalMs=Number(args[++i]);
    else options[arg.slice(2)]=args[++i];
  }
  if(!options.url||!options.name)fail('Usage: node src/host_world.js --url http(s)://127.0.0.1:PORT --name NAME [--seed N] [--ticks N] [--interval-ms N] [--citizen-capabilities | --citizen-generated-asset] [--resume-paused]');
  options.seed=options.seed===undefined?29:Number(options.seed);
  options.ticks=options.ticks===Infinity?Infinity:Number(options.ticks);
  return options;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{
    const options=cliOptions(process.argv.slice(2));
    const request=serviceRequest(options.url,process.env.SANDBOX_TOKEN);
    const assetBytes=serviceAssetBytes(options.url,process.env.SANDBOX_TOKEN);
    const host=new HostedWorld({...options,request,assetBytes});
    const stop=new AbortController();
    process.once('SIGINT',()=>stop.abort());
    process.once('SIGTERM',()=>stop.abort());
    const final=await host.run({ticks:options.ticks,
      intervalMs:options.intervalMs,signal:stop.signal});
    console.log(`Hosted ${options.name} at Citizens tick ${final.clockTick}; saved PC checkpoint.`);
  }catch(error){
    if(error?.name!=='AbortError')console.error(`World host stopped: ${error.message}`);
    process.exitCode=1;
  }
}
