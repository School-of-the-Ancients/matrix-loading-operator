import test from 'node:test';
import assert from 'node:assert/strict';
import {HostedWorld,assertHostedFixture,serviceRequest} from '../src/host_world.js';

const copy=value=>structuredClone(value);

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
  assert.throws(()=>serviceRequest('http://127.0.0.1:8765','x'.repeat(24)),/isolated/);
  assert.throws(()=>serviceRequest('http://example.com:9999','x'.repeat(24)),/isolated/);
});
