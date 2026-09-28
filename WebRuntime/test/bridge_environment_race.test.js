import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld,ROOM_ID} from '../src/protocol.js';
import {MatrixBridge} from '../src/bridge.js';

const digest='a'.repeat(64);
const asset={assetId:`panorama:race:${digest.slice(0,12)}`,displayName:'Race panorama',
  sha256:digest,byteLength:2048,width:4,height:2,format:'png',
  url:`/api/web/environments/${digest}.png`};
const panorama=yawDegrees=>({schemaVersion:1,kind:'equirectangular',
  assetId:asset.assetId,sha256:digest,yawDegrees});
const command=(requestId,op,other={})=>({requestId,op,roomId:ROOM_ID,...other});
const spawn=(world,requestId)=>world.execute({requestId,op:'spawn',assetId:'block',
  anchorId:'web-floor',transform:{position:{x:0,y:0,z:-2},
    rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}});

async function pausedPreflight(world,queued){
  const events=[],requests=[],prepared=[];
  const bridge=new MatrixBridge(world,()=>'',event=>events.push(event));
  let started,release;
  const entered=new Promise(resolve=>{started=resolve;});
  const pending=new Promise(resolve=>{release=resolve;});
  bridge.prepareEnvironment=async environment=>{
    prepared.push(environment);started();await pending;
  };
  bridge.request=async(_path,body)=>{
    requests.push(body);
    return {commands:requests.length===1?[queued]:[]};
  };
  const exchange=bridge.exchange(null);
  await entered;
  return {bridge,events,requests,prepared,exchange,release};
}

async function assertStaleReceipt(fixture,world,queued,scene,undo,redo,generation){
  fixture.release();await fixture.exchange;
  const receipt=fixture.bridge.receipts.get(queued.requestId);
  assert.equal(receipt.ok,false);
  assert.match(receipt.error,/World changed during panorama loading.*inspect/i);
  assert.deepEqual(world.scene,scene);
  assert.deepEqual(world.undo,undo);
  assert.deepEqual(world.redo,redo);
  assert.equal(world.authoredGeneration,generation);
  assert.deepEqual(fixture.events.map(event=>event.type),['receipt','connection']);
  await fixture.bridge.exchange(null);
  assert.deepEqual(fixture.requests[1].results,[receipt],
    'the failed command must be sent to the PC as one exact receipt');
}

test('delayed panorama preflight cannot undo a newer local spawn',
  {timeout:5000},async()=>{
    const previousStorage=globalThis.sessionStorage;
    globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
    try{
      const world=new MatrixWorld(()=> 'local-block');
      world.registerEnvironmentAssets([asset]);
      const first=panorama(15);
      assert.equal(world.execute(command('set-initial','set_environment',
        {expectedEnvironment:null,environment:first})).ok,true);
      assert.equal(world.execute(command('remove-initial','remove_environment',
        {expectedEnvironment:first})).ok,true);
      const queued=command('queued-undo','undo');
      const fixture=await pausedPreflight(world,queued);
      assert.deepEqual(fixture.prepared,[first]);
      assert.equal(spawn(world,'local-spawn').ok,true);
      const scene=structuredClone(world.scene),undo=structuredClone(world.undo);
      const redo=structuredClone(world.redo),generation=world.authoredGeneration;
      await assertStaleReceipt(fixture,world,queued,scene,undo,redo,generation);
      assert.equal(world.scene.objects.length,1);
    }finally{globalThis.sessionStorage=previousStorage;}
  });

test('delayed panorama preflight cannot redo a different history entry',
  {timeout:5000},async()=>{
    const previousStorage=globalThis.sessionStorage;
    globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
    try{
      const world=new MatrixWorld();world.registerEnvironmentAssets([asset]);
      const first=panorama(15),second=panorama(75);
      assert.equal(world.execute(command('set-first','set_environment',
        {expectedEnvironment:null,environment:first})).ok,true);
      assert.equal(world.execute(command('set-second','set_environment',
        {expectedEnvironment:first,environment:second})).ok,true);
      assert.equal(world.execute(command('undo-second','undo')).ok,true);
      const queued=command('queued-redo','redo');
      const fixture=await pausedPreflight(world,queued);
      assert.deepEqual(fixture.prepared,[second]);
      assert.equal(world.execute(command('local-undo','undo')).ok,true);
      const scene=structuredClone(world.scene),undo=structuredClone(world.undo);
      const redo=structuredClone(world.redo),generation=world.authoredGeneration;
      await assertStaleReceipt(fixture,world,queued,scene,undo,redo,generation);
      assert.equal(world.scene.environment,undefined);
    }finally{globalThis.sessionStorage=previousStorage;}
  });

test('delayed panorama preflight cannot load over a newer local scene',
  {timeout:5000},async()=>{
    const previousStorage=globalThis.sessionStorage;
    globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
    try{
      const world=new MatrixWorld(()=> 'local-block');
      world.registerEnvironmentAssets([asset]);
      const sceneToLoad={...structuredClone(world.scene),environment:panorama(120)};
      const queued=command('queued-load','load',{scene:sceneToLoad});
      const fixture=await pausedPreflight(world,queued);
      assert.deepEqual(fixture.prepared,[sceneToLoad.environment]);
      assert.equal(spawn(world,'local-spawn').ok,true);
      const scene=structuredClone(world.scene),undo=structuredClone(world.undo);
      const redo=structuredClone(world.redo),generation=world.authoredGeneration;
      await assertStaleReceipt(fixture,world,queued,scene,undo,redo,generation);
      assert.equal(world.scene.objects.length,1);
      assert.equal(world.scene.environment,undefined);
    }finally{globalThis.sessionStorage=previousStorage;}
  });

test('delayed panorama preflight cannot set an environment over a newer local edit',
  {timeout:5000},async()=>{
    const previousStorage=globalThis.sessionStorage;
    globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
    try{
      const world=new MatrixWorld(()=> 'local-block');
      world.registerEnvironmentAssets([asset]);
      const target=panorama(225);
      const queued=command('queued-set','set_environment',
        {expectedEnvironment:null,environment:target});
      const fixture=await pausedPreflight(world,queued);
      assert.deepEqual(fixture.prepared,[target]);
      assert.equal(spawn(world,'local-spawn').ok,true);
      const scene=structuredClone(world.scene),undo=structuredClone(world.undo);
      const redo=structuredClone(world.redo),generation=world.authoredGeneration;
      await assertStaleReceipt(fixture,world,queued,scene,undo,redo,generation);
      assert.equal(world.scene.environment,undefined);
    }finally{globalThis.sessionStorage=previousStorage;}
  });

test('panorama preflight still executes a queued load when its world stays current',
  {timeout:5000},async()=>{
    const previousStorage=globalThis.sessionStorage;
    globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
    try{
      const world=new MatrixWorld();world.registerEnvironmentAssets([asset]);
      const target=panorama(120);
      const queued=command('current-load','load',
        {scene:{...structuredClone(world.scene),environment:target}});
      const fixture=await pausedPreflight(world,queued);
      fixture.release();await fixture.exchange;
      assert.equal(fixture.bridge.receipts.get(queued.requestId).ok,true);
      assert.deepEqual(world.scene.environment,target);
    }finally{globalThis.sessionStorage=previousStorage;}
  });
