import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {MatrixBridge} from '../src/bridge.js';

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
