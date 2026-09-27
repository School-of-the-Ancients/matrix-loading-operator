import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {HostedWorld,assertHostedFixture,serviceRequest} from '../src/host_world.js';
import {createProceduralRecipe} from '../src/procedural.js';

const copy=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):
  value&&typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(key=>
      [key,canonical(value[key])])):value;
const requestSha=request=>createHash('sha256').update(
  JSON.stringify(canonical(request))).digest('hex');
const generatedBytes=readFileSync(new URL('./fixtures/static_blender_probe.glb',
  import.meta.url));
const generatedSha=createHash('sha256').update(generatedBytes).digest('hex');
const generatedAsset={assetId:`web:generated-rest-seat:${generatedSha.slice(0,12)}`,
  displayName:'Generated Rest Seat',description:'Reviewed Blender rest seat',
  spawnScale:1,sha256:generatedSha,byteLength:generatedBytes.length,
  url:`/api/web/assets/${generatedSha}.glb`,
  geometry:{bytes:generatedBytes.length,vertices:24,meshes:1,images:0,
    animationClips:[]},
  localBounds:{center:{x:0,y:.3276198312454177,z:0},
    size:{x:.6552396624908354,y:.6552396624908354,z:.5}}};
const benchCommand=(world,requestId='operator-bench-1')=>{
  const transform=copy(world.scene.objects[0].transform);
  transform.position={x:-2,y:0,z:2};
  return {requestId,op:'create_procedural',anchorId:'web-floor',transform,
    procedural:createProceduralRecipe('curved-bench')};
};

class FakeService {
  constructor(){
    this.online=false;this.snapshot=null;this.hostWorldId=null;
    this.revision=0;this.worlds=new Map();this.commands=[];this.results=[];
    this.saveCount=0;this.failSave=false;this.failExchange=false;
    this.citizenConstructionBudget=1;this.citizenRequests=[];
    this.failCitizenPolicy=false;this.badCitizenCommand=false;
    this.assets=[];this.blenderJobs=new Map();this.generatedByCitizen=new Map();
    this.spawnByCitizen=new Map();this.generationSubmissions=0;
    this.badGeneratedCommand=false;this.generatedDispatchStatus=null;
    this.request=this.request.bind(this);
  }
  async request(method,path,body){
    if(path==='/api/state')return {online:this.online,pendingCount:this.commands.length,
      snapshot:copy(this.snapshot),hostWorldId:this.hostWorldId};
    if(path==='/api/web/assets')return {assets:copy(this.assets)};
    if(path==='/api/web/worlds')return {worlds:[...this.worlds.keys()]};
    if(path==='/api/citizens/capabilities'){
      if(this.failCitizenPolicy)throw Error('policy unavailable');
      this.citizenRequests.push(copy(body));
      const journal=this.snapshot?.citizensState?.capabilityRequests;
      assert.deepEqual(body,journal?.find(item=>
        item.request.citizenRequestId===body.citizenRequestId)?.request);
      if(body.capability==='asset'&&body.action==='generate'){
        if(this.citizenConstructionBudget===0)
          return {allowed:false,requestId:null,
            reason:'Citizen capability budget exhausted',checkpointSequence:2};
        let jobId=this.generatedByCitizen.get(body.citizenRequestId);
        if(!jobId){
          jobId='d'.repeat(32);
          this.generatedByCitizen.set(body.citizenRequestId,jobId);
          this.blenderJobs.set(jobId,{jobId,phase:'queued',
            hostWorldId:'AdaBo',
            citizenRequestId:body.citizenRequestId,
            requestSha256:requestSha(body),profileId:'rest-seat-v1',
            profileRevision:'a'.repeat(64)});
          this.generationSubmissions++;
          this.citizenConstructionBudget--;
        }
        return {allowed:true,requestId:jobId,reason:'',checkpointSequence:2};
      }
      if(body.capability!=='procedural'||body.action!=='create')
        return {allowed:false,requestId:null,
          reason:'Citizen capability unavailable',checkpointSequence:2};
      if(this.citizenConstructionBudget===0||this.snapshot.scene.objects.length!==4)
        return {allowed:false,requestId:null,
          reason:'Citizen capability budget exhausted',checkpointSequence:2};
      this.citizenConstructionBudget--;
      const transform=copy(body.parameters.transform);
      if(this.badCitizenCommand)transform.position.x+=1;
      this.commands.push({requestId:'c'.repeat(32),op:'create_procedural',
        anchorId:'web-floor',transform,
        procedural:createProceduralRecipe(body.parameters.generatorId,
          body.parameters.parameters)});
      return {allowed:true,requestId:'c'.repeat(32),reason:'',checkpointSequence:2};
    }
    if(path.startsWith('/api/web/blender/')){
      const job=this.blenderJobs.get(path.split('/').at(-1));
      if(!job)throw Error('Unknown Blender job');
      return copy(job);
    }
    if(path==='/api/citizens/capabilities/dispatch'){
      const entry=this.snapshot?.citizensState?.capabilityRequests?.find(item=>
        item.request.citizenRequestId===body.citizenRequestId);
      assert.equal(entry?.status,'registered');
      assert.equal(entry.work.jobId,body.jobId);
      assert.equal(entry.work.assetId,body.assetId);
      assert.equal(entry.work.sha256,body.sha256);
      let requestId=this.spawnByCitizen.get(body.citizenRequestId);
      if(!requestId){
        requestId='e'.repeat(32);
        this.spawnByCitizen.set(body.citizenRequestId,requestId);
        if(this.generatedDispatchStatus!=='unconfirmed'){
          const pose=copy(entry.request.parameters.transform);
          if(this.badGeneratedCommand)pose.position.x+=1;
          this.commands.push({requestId,op:'spawn',assetId:body.assetId,
            anchorId:'web-floor',transform:pose});
        }
      }
      return {requestId,status:this.generatedDispatchStatus||'queued',
        assetId:body.assetId,
        roomId:'web-virtual-room-v1',sceneRevision:this.revision};
    }
    if(path==='/api/exchange'){
      if(this.failExchange)throw Error('exchange unavailable');
      if(body.worldRestoreExpectedRevision!==undefined)
        assert.equal(body.worldRestoreExpectedRevision,this.revision);
      this.results.push(...copy(body.results));
      const acknowledged=new Set(body.results.map(item=>item.requestId));
      this.commands=this.commands.filter(item=>!acknowledged.has(item.requestId));
      if(JSON.stringify(this.snapshot?.scene)!==JSON.stringify(body.snapshot.scene))
        this.revision++;
      this.snapshot=copy(body.snapshot);
      this.hostWorldId=body.hostWorldId;
      this.online=true;
      return {commands:copy(this.commands)};
    }
    if(path==='/api/web/world/load'){
      assert.equal(this.online,true);
      return {name:body.name,world:copy(this.worlds.get(body.name)),
        expectedRevision:this.revision};
    }
    if(path==='/api/web/world/save'){
      if(this.failSave)throw Error('checkpoint unavailable');
      assert.deepEqual(body.world.scene,this.snapshot.scene);
      assert.deepEqual(body.world.citizens,this.snapshot.citizensState);
      this.worlds.set(body.name,copy(body.world));
      this.saveCount++;
      return {saved:true};
    }
    throw Error(`Unexpected ${method} ${path}`);
  }
}

const generatedBytesRequest=async digest=>{
  assert.equal(digest,generatedSha);
  return new Uint8Array(generatedBytes);
};

async function generatingHost(service,assetBytes=generatedBytesRequest){
  const host=new HostedWorld({name:'AdaBo',seed:29,citizenGeneratedAsset:true,
    request:service.request,assetBytes});
  await host.start();
  await host.tick();
  assert.equal(host.simulation.snapshot().generatedConstruction.status,
    'generating');
  return host;
}

function readyGeneratedAsset(service){
  service.assets=[copy(generatedAsset)];
  service.blenderJobs.set('d'.repeat(32),{
    ...service.blenderJobs.get('d'.repeat(32)),phase:'ready',
    asset:copy(generatedAsset)});
}

test('host persists every virtual tick and resumes without downtime catch-up',async()=>{
  const service=new FakeService();
  const first=new HostedWorld({name:'AdaBo',seed:29,request:service.request});
  await first.start();
  assert.equal(first.world.snapshot().runtimeDescriptor.renderer,'none');
  const initialIds=first.simulation.snapshot().residents.map(item=>item.objectId);
  for(let i=0;i<5;i++)await first.tick();
  assert.equal(service.saveCount,6);
  assert.equal(service.worlds.get('AdaBo').citizens.clockTick,5);
  service.online=false; // The process and its lease stopped; no virtual minutes elapse.
  const resumed=new HostedWorld({name:'AdaBo',request:service.request});
  await resumed.start();
  assert.equal(resumed.simulation.snapshot().clockTick,5);
  assert.deepEqual(resumed.simulation.snapshot().residents.map(item=>item.objectId),initialIds);
  assert.equal((await resumed.tick()).clockTick,6);
  assert.equal(service.worlds.get('AdaBo').citizens.clockTick,6);
});

test('checkpoint outage stops the host before another tick',async()=>{
  const service=new FakeService();
  const host=new HostedWorld({name:'AdaBo',request:service.request});
  await host.start();
  service.failSave=true;
  await assert.rejects(host.tick(),/checkpoint unavailable/);
  assert.equal(service.worlds.get('AdaBo').citizens.clockTick,0);
  assert.equal(service.snapshot.citizensState.clockTick,1);
  await assert.rejects(host.tick(),/not ready/);
  assert.equal(service.snapshot.citizensState.clockTick,1);
});

test('exchange outage stops the host without writing an unobserved tick',async()=>{
  const service=new FakeService();
  const host=new HostedWorld({name:'AdaBo',request:service.request});
  await host.start();
  service.failExchange=true;
  await assert.rejects(host.tick(),/exchange unavailable/);
  assert.equal(service.saveCount,1);
  assert.equal(service.worlds.get('AdaBo').citizens.clockTick,0);
  await assert.rejects(host.tick(),/not ready/);
});

test('operator mutations receive explicit failure receipts, without touching the scene',async()=>{
  const service=new FakeService();
  const original=service.request;
  service.request=async(method,path,body)=>{
    if(path==='/api/exchange'&&!service.online)
      service.commands.push({requestId:'operator-spawn-1',op:'spawn',assetId:'orb'});
    return original(method,path,body);
  };
  const host=new HostedWorld({name:'AdaBo',request:service.request});
  await host.start();
  assert.equal(service.commands.length,0);
  assert.equal(service.results.length,1);
  assert.equal(service.results[0].requestId,'operator-spawn-1');
  assert.equal(service.results[0].ok,false);
  assert.deepEqual(service.snapshot.scene.objects.map(item=>item.assetId),
    ['chair','table','orb','orb']);
});

test('one procedural construction survives the next tick and exact checkpoint restart',async()=>{
  const service=new FakeService();
  const host=new HostedWorld({name:'AdaBo',request:service.request});
  await host.start();
  const residentIds=host.simulation.snapshot().residents.map(item=>item.objectId);
  const coreIds=host.world.scene.objects.map(item=>item.objectId);
  service.commands.push(benchCommand(host.world));
  await host.tick();
  const receipt=service.results.find(item=>item.requestId==='operator-bench-1');
  assert.equal(receipt.ok,true);
  assert.equal(receipt.objectId,host.world.scene.objects[4].objectId);
  assert.equal(service.worlds.get('AdaBo').scene.objects.length,5);
  assert.deepEqual(service.worlds.get('AdaBo').scene.objects.slice(0,4).map(item=>item.objectId),coreIds);
  assert.equal(service.worlds.get('AdaBo').citizens.clockTick,1);
  service.online=false;
  const resumed=new HostedWorld({name:'AdaBo',request:service.request});
  await resumed.start();
  assert.equal(resumed.simulation.snapshot().clockTick,1);
  assert.equal(resumed.world.scene.objects[4].objectId,receipt.objectId);
  assert.deepEqual(resumed.simulation.snapshot().residents.map(item=>item.objectId),residentIds);
  await resumed.tick();
  assert.equal(service.worlds.get('AdaBo').citizens.clockTick,2);
  assert.equal(service.worlds.get('AdaBo').scene.objects[4].objectId,receipt.objectId);
  assert.deepEqual(resumed.simulation.snapshot().residents.map(item=>item.objectId),residentIds);
});

test('host rejects a second construction and unrelated mutations without scene changes',async()=>{
  const service=new FakeService();
  const host=new HostedWorld({name:'AdaBo',request:service.request});
  await host.start();
  service.commands.push(benchCommand(host.world));
  await host.tick();
  const scene=copy(host.world.scene);
  service.commands.push(benchCommand(host.world,'operator-bench-2'));
  service.commands.push({requestId:'operator-spawn-2',op:'spawn',assetId:'orb'});
  await host.tick();
  assert.deepEqual(host.world.scene.objects.map(item=>item.objectId),
    scene.objects.map(item=>item.objectId));
  assert.deepEqual(host.world.scene.objects.slice(0,2),scene.objects.slice(0,2));
  assert.deepEqual(host.world.scene.objects[4],scene.objects[4]);
  assert.deepEqual(service.results.slice(-2).map(item=>[item.requestId,item.ok]),
    [['operator-bench-2',false],['operator-spawn-2',false]]);
  assert.equal(service.worlds.get('AdaBo').scene.objects.length,5);
});

test('Bo requests one reviewed bench from chair contention, uses it, and retains provenance after restart',async()=>{
  const service=new FakeService();
  const host=new HostedWorld({name:'AdaBo',seed:29,citizenConstruction:true,
    request:service.request});
  await host.start();
  const core=copy(host.world.scene.objects);
  const residents=host.simulation.snapshot().residents.map(item=>item.objectId);
  await host.tick();
  let state=host.simulation.snapshot();
  const record=state.construction;
  assert.equal(service.citizenRequests.length,1);
  assert.deepEqual(service.citizenRequests[0],state.capabilityRequests[0].request);
  assert.equal(state.capabilityRequests[0].status,'succeeded');
  assert.equal(state.capabilityRequests[0].policy.requestId,'c'.repeat(32));
  assert.equal(state.capabilityRequests[0].receipts.length,2);
  assert.equal(record.residentId,'bo');
  assert.equal(record.blockedStationId,'chair');
  assert.equal(record.requestId,'c'.repeat(32));
  assert.equal(record.status,'created');
  assert.equal(state.stations.find(item=>item.id==='citizen-bench').objectId,
    record.objectId);
  assert.deepEqual(host.world.scene.objects.slice(0,4).map(item=>[item.objectId,item.assetId]),
    core.map(item=>[item.objectId,item.assetId]));
  assert.deepEqual(host.world.scene.objects.slice(0,2),core.slice(0,2));
  assert.equal(service.results.find(item=>item.requestId===record.requestId).objectId,
    record.objectId);
  assert.deepEqual(state.capabilityRequests[0].receipts[0],
    service.results.find(item=>item.requestId===record.requestId));
  const tampered=copy(service.worlds.get('AdaBo'));
  tampered.scene.objects[4].procedural.parameters.lengthMeters+=.1;
  assert.throws(()=>assertHostedFixture(tampered),
    /differs from its reviewed capability request/);
  let use=null;
  const execute=host.world.execute.bind(host.world);
  host.world.execute=(command,options)=>{
    const receipt=execute(command,options);
    if(command.op==='interact'&&command.targetObjectId===record.objectId)
      use={command,receipt};
    return receipt;
  };
  for(let i=0;i<160&&state.construction.status!=='used';i++){
    await host.tick();state=host.simulation.snapshot();
  }
  assert.equal(state.construction.status,'used');
  assert.equal(use?.receipt.ok,true);
  assert.equal(use.command.actorObjectId,state.residents.find(item=>item.id==='bo').objectId);
  assert.equal(use.receipt.requestId,state.construction.useRequestId);
  assert.equal(use.receipt.outcome.targetObjectId,record.objectId);
  assert.deepEqual(service.worlds.get('AdaBo').citizens.construction,state.construction);
  service.online=false;
  const resumed=new HostedWorld({name:'AdaBo',citizenConstruction:true,
    request:service.request});
  await resumed.start();
  assert.deepEqual(resumed.simulation.snapshot().construction,state.construction);
  assert.deepEqual(resumed.simulation.snapshot().capabilityRequests,
    state.capabilityRequests);
  assert.deepEqual(resumed.simulation.snapshot().residents.map(item=>item.objectId),residents);
  assert.equal(resumed.world.scene.objects[4].objectId,record.objectId);
  await resumed.tick();
  assert.equal(service.citizenRequests.length,1);
});

test('generated Citizen rest seat uses one registered GLB, exact spawn and restart',async()=>{
  const service=new FakeService();
  const assetBytes=async digest=>{
    assert.equal(digest,generatedSha);
    return new Uint8Array(generatedBytes);
  };
  const host=new HostedWorld({name:'AdaBo',seed:29,citizenGeneratedAsset:true,
    request:service.request,assetBytes});
  await host.start();
  const coreIds=host.world.scene.objects.map(item=>item.objectId);
  await host.tick();
  let state=host.simulation.snapshot();
  assert.equal(state.generatedConstruction.status,'generating');
  assert.equal(state.capabilityRequests[0].request.capability,'asset');
  assert.equal(service.worlds.get('AdaBo').citizens.capabilityRequests[0]
    .status,'generating');
  assert.equal(service.generationSubmissions,1);
  assert.equal(host.world.scene.objects.length,4);
  readyGeneratedAsset(service);
  await host.tick();
  state=host.simulation.snapshot();
  assert.equal(state.generatedConstruction.status,'created');
  assert.equal(state.capabilityRequests[0].status,'succeeded');
  assert.equal(state.capabilityRequests[0].receipts.length,2);
  assert.equal(state.capabilityRequests[0].work.jobId,'d'.repeat(32));
  assert.equal(state.capabilityRequests[0].work.sha256,generatedSha);
  assert.equal(state.capabilityRequests[0].work.spawnRequestId,'e'.repeat(32));
  assert.deepEqual(host.world.scene.objects.slice(0,4).map(item=>item.objectId),
    coreIds);
  const added=host.world.scene.objects[4];
  assert.equal(added.assetId,generatedAsset.assetId);
  assert.equal(host.world.renderedAssetVerified(added),true);
  assert.equal(service.spawnByCitizen.size,1);
  assert.equal(service.results.find(item=>item.requestId==='e'.repeat(32))
    ?.objectId,added.objectId);
  for(let count=0;count<30&&state.generatedConstruction.status!=='used';count++)
    state=await host.tick();
  assert.equal(state.generatedConstruction.status,'used');
  assert.ok(state.generatedConstruction.useRequestId);
  service.online=false;
  const resumed=new HostedWorld({name:'AdaBo',citizenGeneratedAsset:true,
    request:service.request,assetBytes});
  await resumed.start();
  assert.equal(resumed.simulation.snapshot().generatedConstruction.status,'used');
  assert.equal(resumed.world.scene.objects[4].objectId,added.objectId);
  assert.equal(resumed.world.renderedAssetVerified(resumed.world.scene.objects[4]),
    true);
  await resumed.tick();
  assert.equal(service.generationSubmissions,1);
  assert.equal(service.spawnByCitizen.size,1);
  assert.equal(resumed.world.scene.objects.length,5);
});

test('generation failure records job provenance without spawning',async()=>{
  const service=new FakeService();
  const host=await generatingHost(service);
  service.blenderJobs.set('d'.repeat(32),{
    ...service.blenderJobs.get('d'.repeat(32)),
    phase:'error',error:'Blender build failed'});
  await host.tick();
  const state=host.simulation.snapshot();
  assert.equal(state.generatedConstruction.status,'failed');
  assert.equal(state.generatedConstruction.jobId,'d'.repeat(32));
  assert.equal(state.generatedConstruction.reason,
    'Blender generation failed; inspect the PC job');
  assert.equal(service.blenderJobs.get('d'.repeat(32)).error,'Blender build failed');
  assert.equal(state.capabilityRequests[0].receipts.length,0);
  assert.equal(service.worlds.get('AdaBo').scene.objects.length,4);
  assert.equal(service.spawnByCitizen.size,0);
});

test('generated capability budget denies Bo without a Blender job or Matrix edit',
  async()=>{
    const service=new FakeService();
    service.citizenConstructionBudget=0;
    const host=new HostedWorld({name:'AdaBo',seed:29,
      citizenGeneratedAsset:true,request:service.request,
      assetBytes:generatedBytesRequest});
    await host.start();
    await host.tick();
    const saved=service.worlds.get('AdaBo');
    assert.equal(saved.citizens.generatedConstruction.status,'denied');
    assert.equal(saved.citizens.capabilityRequests[0].status,'denied');
    assert.equal(saved.citizens.generatedConstruction.residentId,'bo');
    assert.match(saved.citizens.generatedConstruction.reason,/budget/);
    assert.equal(saved.scene.objects.length,4);
    assert.equal(service.generationSubmissions,0);
    assert.equal(service.spawnByCitizen.size,0);
  });

test('host refuses a ready Blender job with altered Citizen provenance',async()=>{
  const wrong={hostWorldId:'Other',citizenRequestId:'other-request',
    requestSha256:'f'.repeat(64),profileId:'another-profile',
    profileRevision:'invalid'};
  for(const [field,value] of Object.entries(wrong)){
    const service=new FakeService();
    const host=await generatingHost(service);
    readyGeneratedAsset(service);
    service.blenderJobs.get('d'.repeat(32))[field]=value;
    await assert.rejects(host.tick(),/differs from the saved Citizen request/);
    assert.equal(service.worlds.get('AdaBo').citizens.generatedConstruction
      .status,'generating');
    assert.equal(service.worlds.get('AdaBo').scene.objects.length,4);
    assert.equal(service.spawnByCitizen.size,0);
  }
});

test('registration uncertainty remains durable and cannot restart generation',async()=>{
  const service=new FakeService();
  const host=await generatingHost(service);
  service.blenderJobs.set('d'.repeat(32),{
    ...service.blenderJobs.get('d'.repeat(32)),phase:'generated',
    error:'C:\\Users\\owner\\private\\catalog write interrupted',
    sha256:generatedSha});
  await assert.rejects(host.tick(),/registration is unresolved/);
  const saved=service.worlds.get('AdaBo').citizens.generatedConstruction;
  assert.equal(saved.status,'unconfirmed');
  assert.equal(saved.jobId,'d'.repeat(32));
  assert.equal(saved.reason,'Blender registration is unresolved; inspect the PC job');
  assert.doesNotMatch(JSON.stringify(service.worlds.get('AdaBo')),/private/);
  assert.equal(service.generationSubmissions,1);
  assert.equal(service.spawnByCitizen.size,0);
  service.online=false;
  const resumed=new HostedWorld({name:'AdaBo',citizenGeneratedAsset:true,
    request:service.request,assetBytes:generatedBytesRequest});
  await assert.rejects(resumed.start(),/queued Citizen capability/);
  assert.equal(service.generationSubmissions,1);
});

test('Blender job failure keeps private diagnostics out of the visitor world',async()=>{
  const service=new FakeService();
  const host=await generatingHost(service);
  service.blenderJobs.set('d'.repeat(32),{
    ...service.blenderJobs.get('d'.repeat(32)),phase:'error',
    error:'C:\\Users\\owner\\private\\asset.glb failed'});
  await host.tick();
  const saved=service.worlds.get('AdaBo').citizens;
  assert.equal(saved.generatedConstruction.status,'failed');
  assert.equal(saved.generatedConstruction.reason,
    'Blender generation failed; inspect the PC job');
  assert.equal(saved.capabilityRequests[0].reason,
    saved.generatedConstruction.reason);
  assert.doesNotMatch(JSON.stringify(saved),/private|asset\.glb/);
  assert.match(service.blenderJobs.get('d'.repeat(32)).error,/private/);
});

test('unconfirmed dispatch records exact reserved spawn ID and never queues again',async()=>{
  const service=new FakeService();
  const host=await generatingHost(service);
  readyGeneratedAsset(service);
  service.generatedDispatchStatus='unconfirmed';
  await assert.rejects(host.tick(),/spawn outcome is unconfirmed/);
  const saved=service.worlds.get('AdaBo').citizens.generatedConstruction;
  assert.equal(saved.status,'unconfirmed');
  assert.equal(saved.spawnRequestId,'e'.repeat(32));
  assert.equal(saved.assetId,generatedAsset.assetId);
  assert.equal(service.commands.length,0);
  assert.equal(service.spawnByCitizen.size,1);
  assert.equal(service.worlds.get('AdaBo').scene.objects.length,4);
  service.online=false;
  const resumed=new HostedWorld({name:'AdaBo',citizenGeneratedAsset:true,
    request:service.request,assetBytes:generatedBytesRequest});
  await assert.rejects(resumed.start(),/queued Citizen capability/);
  assert.equal(service.generationSubmissions,1);
  assert.equal(service.spawnByCitizen.size,1);
});

test('typed spawn mismatch fails with exact receipt and leaves four core objects',async()=>{
  const service=new FakeService();
  const host=await generatingHost(service);
  readyGeneratedAsset(service);
  service.badGeneratedCommand=true;
  await host.tick();
  const state=host.simulation.snapshot();
  assert.equal(state.generatedConstruction.status,'failed');
  assert.equal(state.capabilityRequests[0].receipts[0].requestId,'e'.repeat(32));
  assert.equal(state.capabilityRequests[0].receipts[0].ok,false);
  assert.equal(host.world.scene.objects.length,4);
  assert.equal(service.worlds.get('AdaBo').scene.objects.length,4);
});

test('incorrect generated GLB bytes force a confirmed Matrix rollback',async()=>{
  const service=new FakeService();
  const assetBytes=async()=>new Uint8Array(generatedBytes.subarray(0,
    generatedBytes.length-1));
  const host=await generatingHost(service,assetBytes);
  readyGeneratedAsset(service);
  await host.tick();
  const state=host.simulation.snapshot();
  assert.equal(state.generatedConstruction.status,'failed');
  assert.deepEqual(state.capabilityRequests[0].receipts.map(item=>item.ok),
    [true,true]);
  assert.equal(state.capabilityRequests[0].receipts.at(-1).requestId,
    `${'e'.repeat(32)}-rollback`);
  assert.equal(host.world.scene.objects.length,4);
  assert.equal(service.worlds.get('AdaBo').scene.objects.length,4);
});

test('a v13 completed bench restores into v14 without inventing Matrix receipts',async()=>{
  const service=new FakeService();
  const first=new HostedWorld({name:'AdaBo',seed:29,citizenCapabilities:true,
    request:service.request});
  await first.start();
  await first.tick();
  const previous=copy(service.worlds.get('AdaBo'));
  previous.citizens.schemaVersion=13;
  delete previous.citizens.capabilityRequests;
  delete previous.citizens.generatedConstruction;
  service.worlds.set('AdaBo',previous);
  service.online=false;
  const resumed=new HostedWorld({name:'AdaBo',citizenCapabilities:true,
    request:service.request});
  await resumed.start();
  assert.equal(resumed.simulation.snapshot().schemaVersion,15);
  assert.deepEqual(resumed.simulation.snapshot().capabilityRequests,[]);
  assert.deepEqual(resumed.simulation.snapshot().construction,previous.citizens.construction);
  assert.equal(resumed.world.scene.objects[4].objectId,
    previous.scene.objects[4].objectId);
  await resumed.tick();
  assert.equal(service.citizenRequests.length,1);
});

test('a zero citizen construction budget denies Bo safely without creating an object',async()=>{
  const service=new FakeService();
  service.citizenConstructionBudget=0;
  const host=new HostedWorld({name:'AdaBo',seed:29,citizenConstruction:true,
    request:service.request});
  await host.start();
  const ids=host.simulation.snapshot().residents.map(item=>item.objectId);
  await host.tick();
  const denied=host.simulation.snapshot().construction;
  assert.equal(denied.status,'denied');
  assert.equal(host.simulation.snapshot().capabilityRequests[0].status,'denied');
  assert.equal(host.simulation.snapshot().capabilityRequests[0].policy.allowed,false);
  assert.equal(denied.residentId,'bo');
  assert.equal(denied.requestId,null);
  assert.match(denied.reason,/budget/);
  assert.equal(host.world.scene.objects.length,4);
  await host.tick();
  assert.equal(service.citizenRequests.length,1);
  assert.deepEqual(host.simulation.snapshot().residents.map(item=>item.objectId),ids);
  assert.deepEqual(service.worlds.get('AdaBo').citizens.construction,denied);
});

test('shared host path records denial for another scoped action without constructing',async()=>{
  const service=new FakeService();
  const host=new HostedWorld({name:'AdaBo',citizenCapabilities:true,
    request:service.request});
  await host.start();
  const original=copy(host.world.scene.objects);
  const entry=host.simulation.requestCapability({intentId:'bo-move-intent-1',
    residentId:'bo',capability:'move',action:'set',
    parameters:{objectId:original[0].objectId}});
  host.world.citizens=host.simulation.snapshot();
  await host.exchange();
  await host.save();
  await host.fulfillCapability(entry);
  assert.equal(host.simulation.snapshot().construction,null);
  assert.equal(host.simulation.snapshot().capabilityRequests[0].status,'denied');
  assert.deepEqual(host.world.scene.objects,original);
  assert.deepEqual(service.worlds.get('AdaBo').scene.objects,original);
  assert.deepEqual(service.citizenRequests,[entry.request]);
});

test('two sequential scoped denials retain both requests without world edits',async()=>{
  const service=new FakeService();
  const host=new HostedWorld({name:'AdaBo',citizenCapabilities:true,
    request:service.request});
  await host.start();
  const original=copy(host.world.scene.objects);
  for(const [intentId,capability] of [
    ['bo-move-intent-1','move'],['bo-physics-intent-2','physics']]){
    const entry=host.simulation.requestCapability({intentId,residentId:'bo',
      capability,action:'set',parameters:{objectId:original[0].objectId}});
    host.world.citizens=host.simulation.snapshot();
    await host.exchange();
    await host.save();
    await host.fulfillCapability(entry);
  }
  const journal=host.simulation.snapshot().capabilityRequests;
  assert.equal(journal.length,2);
  assert.deepEqual(journal.map(item=>item.status),['denied','denied']);
  assert.deepEqual(service.citizenRequests,journal.map(item=>item.request));
  assert.deepEqual(host.world.scene.objects,original);
  assert.deepEqual(service.worlds.get('AdaBo').scene.objects,original);
});

test('a later denied capability keeps the completed bench and its receipts',async()=>{
  const service=new FakeService();
  const host=new HostedWorld({name:'AdaBo',seed:29,citizenCapabilities:true,
    request:service.request});
  await host.start();
  await host.tick();
  const created=copy(host.world.scene.objects);
  const first=copy(host.simulation.snapshot().capabilityRequests[0]);
  const entry=host.simulation.requestCapability({intentId:'bo-move-intent-2',
    residentId:'bo',capability:'move',action:'set',
    parameters:{objectId:created[0].objectId}});
  host.world.citizens=host.simulation.snapshot();
  await host.exchange();
  await host.save();
  await host.fulfillCapability(entry);
  const journal=host.simulation.snapshot().capabilityRequests;
  assert.deepEqual(journal.map(item=>item.status),['succeeded','denied']);
  assert.deepEqual(journal[0],first);
  assert.deepEqual(host.world.scene.objects,created);
  assert.deepEqual(service.worlds.get('AdaBo').scene.objects,created);
});

test('host refuses a typed command that differs from the approved capability',async()=>{
  const service=new FakeService();
  service.badCitizenCommand=true;
  const host=new HostedWorld({name:'AdaBo',seed:29,citizenCapabilities:true,
    request:service.request});
  await host.start();
  await host.tick();
  const journal=host.simulation.snapshot().capabilityRequests[0];
  assert.equal(journal.status,'failed');
  assert.equal(journal.receipts.length,1);
  assert.equal(journal.receipts[0].requestId,journal.policy.requestId);
  assert.equal(journal.receipts[0].ok,false);
  assert.equal(host.world.scene.objects.length,4);
  assert.deepEqual(service.worlds.get('AdaBo').citizens.capabilityRequests[0],journal);
});

test('a long Matrix creation failure keeps its receipt and a bounded public reason',async()=>{
  const service=new FakeService();
  const host=new HostedWorld({name:'AdaBo',seed:29,citizenConstruction:true,
    request:service.request});
  await host.start();
  const error='Matrix procedural rejection: '+'.'.repeat(300);
  const execute=host.world.execute.bind(host.world);
  host.world.execute=(command,options)=>command.op==='create_procedural'
    ? {requestId:command.requestId,ok:false,error,objectId:''}
    : execute(command,options);
  await host.tick();
  const record=host.simulation.snapshot().construction;
  assert.equal(record.status,'failed');
  assert.equal(host.simulation.snapshot().capabilityRequests[0].status,'failed');
  assert.equal(host.simulation.snapshot().capabilityRequests[0].receipts.length,1);
  assert.equal(record.reason,'Matrix rejected the reviewed capability');
  assert.ok(record.reason.length<=160);
  assert.equal(record.objectId,null);
  assert.equal(host.world.scene.objects.length,4);
  assert.deepEqual(service.worlds.get('AdaBo').citizens.construction,record);
  assert.equal(service.results.find(item=>item.requestId===record.requestId).error,
    error,'the Matrix receipt keeps the full diagnostic');
  await host.tick();
  assert.equal(service.citizenRequests.length,1);
});

test('an unresolved saved intent stops restart without risking a second policy request',async()=>{
  const service=new FakeService();
  const first=new HostedWorld({name:'AdaBo',citizenConstruction:true,
    request:service.request});
  await first.start();
  service.failCitizenPolicy=true;
  await assert.rejects(first.tick(),/policy unavailable/);
  assert.equal(service.worlds.get('AdaBo').citizens.construction.status,'requested');
  assert.equal(service.worlds.get('AdaBo').scene.objects.length,4);
  service.online=false;
  const disabled=new HostedWorld({name:'AdaBo',request:service.request});
  await assert.rejects(disabled.start(),/unresolved Citizen capability request/);
  service.online=false;
  service.failCitizenPolicy=false;
  const resumed=new HostedWorld({name:'AdaBo',citizenConstruction:true,
    request:service.request});
  await assert.rejects(resumed.start(),/unresolved Citizen capability request/);
  assert.equal(service.worlds.get('AdaBo').citizens.construction.status,'requested');
  assert.equal(service.worlds.get('AdaBo').scene.objects.length,4);
  assert.equal(service.citizenRequests.length,0);
});

test('unsupported checkpoint is rejected before restore or overwrite',async()=>{
  const service=new FakeService();
  const first=new HostedWorld({name:'AdaBo',request:service.request});
  await first.start();
  const corrupted=copy(service.worlds.get('AdaBo'));
  corrupted.scene.objects[0].behaviors=[{kind:'rotate',enabled:true,paused:false,speed:1}];
  service.worlds.set('AdaBo',corrupted);
  service.online=false;
  const second=new HostedWorld({name:'AdaBo',request:service.request});
  await assert.rejects(second.start(),/two static resident markers/);
  assert.equal(service.saveCount,1);
  assert.equal(second.failed,true);
});

test('missing prior checkpoint fails before the host claims a new world',async()=>{
  const service=new FakeService();
  const first=new HostedWorld({name:'AdaBo',request:service.request});
  await first.start();
  service.online=false;
  service.worlds.clear();
  const second=new HostedWorld({name:'AdaBo',request:service.request});
  await assert.rejects(second.start(),/no durable checkpoint/);
  assert.equal(service.snapshot.citizensState.clockTick,0);
  assert.equal(second.failed,true);
});

test('case-insensitive checkpoint spelling cannot start a different hosted world',async()=>{
  const service=new FakeService();
  service.worlds.set('AdaBo',{version:3});
  const host=new HostedWorld({name:'adabo',request:service.request});
  await assert.rejects(host.start(),/conflicts with an existing checkpoint spelling/);
  assert.equal(service.online,false);
  assert.equal(service.saveCount,0);
});

test('paused checkpoint requires explicit operator choice',async()=>{
  const service=new FakeService();
  const first=new HostedWorld({name:'AdaBo',request:service.request});
  await first.start();
  const paused=copy(service.worlds.get('AdaBo'));
  paused.citizens.paused=true;
  service.worlds.set('AdaBo',paused);
  service.online=false;
  const second=new HostedWorld({name:'AdaBo',request:service.request});
  await assert.rejects(second.start(),/resume-paused/);
  assert.equal(service.saveCount,1);
  service.online=false;
  const third=new HostedWorld({name:'AdaBo',resumePaused:true,request:service.request});
  await third.start();
  assert.equal(third.simulation.snapshot().paused,false);
});

test('fixture and loopback URL reject broader execution surfaces',()=>{
  const value={version:3,scene:{schemaVersion:1,roomId:'web-virtual-room-v1',objects:[]},
    game:null,citizens:{schemaVersion:12,residents:[],stations:[]}};
  assert.throws(()=>assertHostedFixture(value),/built-in virtual scene/);
  const token='x'.repeat(24);
  for(const url of ['http://127.0.0.1:18876','https://127.0.0.1:18876',
    'https://localhost:18876','https://[::1]:18876'])
    assert.equal(typeof serviceRequest(url,token),'function');
  for(const url of ['http://127.0.0.1:8765','https://127.0.0.1:8765',
    'http://example.com:9999','https://example.com:9999',
    'https://127.0.0.1.example.com:9999','https://192.168.1.10:9999',
    'https://user:pass@localhost:9999','https://localhost:9999/path',
    'https://localhost:9999/?token=secret','https://localhost:9999/#fragment',
    'https://localhost','ftp://localhost:9999'])
    assert.throws(()=>serviceRequest(url,token),/isolated/);
});

test('owner uses a trusted loopback HTTPS service with normal TLS verification',async()=>{
  const certificate=fileURLToPath(new URL('./fixtures/loopback-test.crt',import.meta.url));
  const key=fileURLToPath(new URL('./fixtures/loopback-test.key',import.meta.url));
  const runtime=fileURLToPath(new URL('../',import.meta.url));
  const token='test-host-owner-token-0123456789';
  const seen=[];
  const server=createServer({cert:readFileSync(certificate),key:readFileSync(key)},
    (request,response)=>{
      seen.push({url:request.url,authorization:request.headers.authorization});
      response.writeHead(200,{'Content-Type':'application/json'});
      response.end('{"online":false}');
    });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url=`https://127.0.0.1:${server.address().port}`;
    const script="import {serviceRequest} from './src/host_world.js';"+
      "const result=await serviceRequest(process.argv[1],process.env.HOST_TEST_TOKEN)('GET','/api/state');"+
      "process.stdout.write(JSON.stringify(result));";
    const run=env=>promisify(execFile)(process.execPath,
      ['--input-type=module','--eval',script,url],{cwd:runtime,env});
    const env={...process.env,HOST_TEST_TOKEN:token,NODE_TLS_REJECT_UNAUTHORIZED:'1',
      NODE_EXTRA_CA_CERTS:certificate};
    const {stdout}=await run(env);
    assert.deepEqual(JSON.parse(stdout),{online:false});
    assert.deepEqual(seen,[{url:'/api/state',authorization:`Bearer ${token}`}]);
    await assert.rejects(run({...env,NODE_EXTRA_CA_CERTS:''}),/fetch failed/);
    assert.equal(seen.length,1,'untrusted TLS never reaches the authenticated route');
  }finally{
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
