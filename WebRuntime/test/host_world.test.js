import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {HostedWorld,assertHostedFixture,serviceRequest} from '../src/host_world.js';
import {createProceduralRecipe} from '../src/procedural.js';

const copy=value=>structuredClone(value);
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
    this.request=this.request.bind(this);
  }
  async request(method,path,body){
    if(path==='/api/state')return {online:this.online,pendingCount:this.commands.length,
      snapshot:copy(this.snapshot),hostWorldId:this.hostWorldId};
    if(path==='/api/web/worlds')return {worlds:[...this.worlds.keys()]};
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
