import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {MatrixBridge} from '../src/bridge.js';
import {applyPCWorld} from '../src/world_checkpoint.js';
import {storedWorld} from '../src/scene_store.js';

test('WebXR advertises a camera probe rather than hardcoding mixed as unsupported',async()=>{
  const previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
  const world=new MatrixWorld();
  const bridge=new MatrixBridge(world,()=>'',()=>{});
  const requests=[];
  bridge.request=async(path,body)=>{
    assert.equal(path,'/api/exchange');requests.push(body);
    return requests.length===1?{commands:[],capture:{captureId:'capture-1',revision:1}}:{commands:[]};
  };
  bridge.getCapture=async request=>({captureId:request.captureId,revision:request.revision,ok:true});
  await bridge.exchange(null);
  await new Promise(resolve=>setTimeout(resolve,0));
  bridge.getCaptureCapabilities=()=>({modes:['virtual','mixed'],device:'WebXR environment camera',
    mixedStatus:'available',reason:'Separate camera and virtual view',depthOcclusion:false});
  await bridge.exchange(null);
  assert.equal(requests[0].captureSupported,true);
  assert.deepEqual(requests[0].captureCapabilities.modes,['virtual']);
  assert.equal(requests[0].captureCapabilities.mixedStatus,'permission_required');
  assert.deepEqual(requests[1].captureCapabilities.modes,['virtual','mixed']);
  assert.deepEqual(requests[1].capture,{captureId:'capture-1',revision:1,ok:true});
  assert.equal(bridge.captureReceipt,null);
  }finally{globalThis.sessionStorage=previousStorage;}
});

test('explicit checkpoint sync waits for an in-flight exchange and sends the latest scene',async()=>{
  const previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
    const world=new MatrixWorld(()=> 'saved-object');
    const bridge=new MatrixBridge(world,()=>'',()=>{});
    const requests=[];
    let finishFirst;
    bridge.request=async(path,body)=>{
      assert.equal(path,'/api/exchange');requests.push(structuredClone(body));
      return requests.length===1?new Promise(resolve=>{finishFirst=resolve;}):{commands:[]};
    };
    bridge.running=true;
    const first=bridge.tick(true);
    await Promise.resolve();
    assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',
      transform:{position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}).ok,true);
    const sync=bridge.sync();
    finishFirst({commands:[]});
    await first;await sync;
    assert.equal(requests.length,2);
    assert.equal(requests[0].snapshot.scene.objects.length,0);
    assert.equal(requests[1].snapshot.scene.objects[0].objectId,'saved-object');
  }finally{globalThis.sessionStorage=previousStorage;}
});

test('guarded PC restore preserves the old world and receipts when a queued command arrives',async()=>{
  const previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
    const world=new MatrixWorld(()=> 'shared-object');
    const pose={position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
    assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose}).ok,true);
    const saved=storedWorld(world);saved.scene.objects[0].transform.position.x=1;
    const queued={requestId:'queued',op:'set_transform',objectId:'shared-object',
      transform:{...structuredClone(pose),position:{x:2,y:0,z:-2}}};
    const requests=[];
    const bridge=new MatrixBridge(world,()=>'',()=>{});
    bridge.running=true;
    bridge.request=async(path,body)=>{assert.equal(path,'/api/exchange');requests.push(body);return {commands:[queued]};};
    await assert.rejects(applyPCWorld(world,saved,()=>bridge.sync(7)),/command arrived during PC world restore/);
    assert.equal(requests[0].worldRestoreExpectedRevision,7);
    assert.equal(world.scene.objects[0].transform.position.x,0);
    assert.equal(bridge.receipts.size,0,'a skipped command must have no false receipt');
    await bridge.sync();
    assert.equal(Object.hasOwn(requests[1],'worldRestoreExpectedRevision'),false);
    assert.equal(world.scene.objects[0].transform.position.x,2);
    assert.equal(bridge.receipts.get('queued').ok,true);
    await assert.rejects(bridge.sync(undefined),/no valid scene revision/);
    assert.equal(requests.length,2,'an invalid restore revision must not exchange an unguarded snapshot');
  }finally{globalThis.sessionStorage=previousStorage;}
});

test('PC restore waits for an earlier exchange before staging and pauses periodic exchanges',async()=>{
  const previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
    const world=new MatrixWorld(()=> 'shared-object');
    const pose={position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
    assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose}).ok,true);
    const saved=storedWorld(world);saved.scene.objects[0].transform.position.x=1;
    const queued={requestId:'queued-first',op:'set_transform',objectId:'shared-object',
      transform:{...structuredClone(pose),position:{x:2,y:0,z:-2}}};
    const requests=[];let finishFirst;
    const bridge=new MatrixBridge(world,()=>'',()=>{});
    bridge.running=true;
    bridge.request=async(path,body)=>{
      assert.equal(path,'/api/exchange');requests.push(structuredClone(body));
      if(requests.length===1)return new Promise(resolve=>{finishFirst=resolve;});
      if(requests.length===2)throw Error('World changed or a command was queued');
      return {commands:[]};
    };
    const first=bridge.tick(true);
    const restoring=bridge.withExclusiveExchange(()=>applyPCWorld(world,saved,()=>bridge.sync(7)));
    assert.equal(bridge.exchangePaused,true);
    await bridge.tick(true);
    assert.equal(requests.length,1,'a periodic pump must stay paused');
    assert.equal(world.scene.objects[0].transform.position.x,0,'restore must not stage while the old exchange is active');
    finishFirst({commands:[queued]});
    await first;
    await assert.rejects(restoring,/World changed or a command was queued/);
    assert.equal(requests[1].worldRestoreExpectedRevision,7);
    assert.equal(requests[1].snapshot.scene.objects[0].transform.position.x,1);
    assert.equal(world.scene.objects[0].transform.position.x,2,'rollback preserves the command applied to the old world');
    assert.equal(bridge.receipts.get('queued-first').ok,true);
    assert.equal(bridge.exchangePaused,false);
    await bridge.tick(true);
    assert.equal(requests.length,3);
    assert.equal(requests[2].results[0].requestId,'queued-first');
    assert.equal(bridge.receipts.size,0);
  }finally{globalThis.sessionStorage=previousStorage;}
});
