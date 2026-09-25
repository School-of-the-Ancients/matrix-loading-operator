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
