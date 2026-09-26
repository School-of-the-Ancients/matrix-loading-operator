import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {MatrixBridge} from '../src/bridge.js';
import {createCitizensDemo} from '../src/citizens.js';
import {applyPCWorld} from '../src/world_checkpoint.js';
import {storedWorld} from '../src/scene_store.js';

test('an Operator command delivered after Citizens motion gets a failed receipt without mutation',async()=>{
  const previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
    let nextId=0;
    const world=new MatrixWorld(()=>`citizen-object-${++nextId}`);
    const simulation=createCitizensDemo(world,{seed:31});
    world.citizens=simulation.snapshot();
    const residentId=simulation.snapshot().residents[0].objectId;
    const expectedTransform=structuredClone(world.requireObject(residentId).transform);
    const desired=structuredClone(expectedTransform);
    desired.position.x+=1;
    const queued={requestId:'delayed-resident-edit',op:'set_transform',
      objectId:residentId,expectedTransform,transform:desired};
    const events=[];
    const bridge=new MatrixBridge(world,()=>'',event=>events.push(event));
    let deliver;
    bridge.request=async()=>new Promise(resolve=>{deliver=resolve;});
    const exchange=bridge.exchange(null);
    let moved=false;
    for(let step=0;step<10&&!moved;step++){
      simulation.step();world.citizens=simulation.snapshot();
      moved=JSON.stringify(world.requireObject(residentId).transform)!==
        JSON.stringify(expectedTransform);
    }
    assert.equal(moved,true,'the resident must actually move before delivery');
    const scene=structuredClone(world.scene),selection=structuredClone(world.selection);
    const undo=structuredClone(world.undo),generation=world.authoredGeneration;
    deliver({commands:[queued]});
    await exchange;
    const receipt=bridge.receipts.get(queued.requestId);
    assert.equal(receipt.ok,false);
    assert.match(receipt.error,/transform changed since command was queued/);
    assert.equal(events.some(event=>event.type==='receipt'&&event.result===receipt),true);
    assert.deepEqual(world.scene,scene);
    assert.deepEqual(world.selection,selection);
    assert.deepEqual(world.undo,undo);
    assert.equal(world.authoredGeneration,generation);
  }finally{globalThis.sessionStorage=previousStorage;}
});

test('a delayed component attachment cannot take over a resident after Citizens motion',async()=>{
  const previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
    let nextId=0;
    const world=new MatrixWorld(()=>`citizen-object-${++nextId}`);
    const simulation=createCitizensDemo(world,{seed:37});
    world.citizens=simulation.snapshot();
    const residentId=simulation.snapshot().residents[0].objectId;
    const targetObjectId=simulation.snapshot().stations[0].objectId;
    const expectedTransform=structuredClone(world.requireObject(residentId).transform);
    const queued={requestId:'delayed-attachment',op:'attach_component',
      objectId:residentId,targetObjectId,expectedTransform,
      componentId:'webcomp:drift:0123456789ab',
      package:{schemaVersion:1,name:'Drift',outputs:{
        'position.x':{op:'const',value:0}}}};
    const bridge=new MatrixBridge(world,()=>'',()=>{});
    let deliver;
    bridge.request=async(_path,body)=>{
      assert.deepEqual(body.snapshot.scene.objects.find(item=>item.objectId===residentId).transform,
        expectedTransform);
      return new Promise(resolve=>{deliver=resolve;});
    };
    const exchange=bridge.exchange(null);
    let moved=false;
    for(let step=0;step<10&&!moved;step++){
      simulation.step();world.citizens=simulation.snapshot();
      moved=JSON.stringify(world.requireObject(residentId).transform)!==
        JSON.stringify(expectedTransform);
    }
    assert.equal(moved,true,'the resident must actually move before delivery');
    const scene=structuredClone(world.scene),undo=structuredClone(world.undo);
    const generation=world.authoredGeneration;
    deliver({commands:[queued]});
    await exchange;
    const receipt=bridge.receipts.get(queued.requestId);
    assert.equal(receipt.ok,false);
    assert.match(receipt.error,/transform changed since command was queued/);
    assert.deepEqual(world.scene,scene);
    assert.deepEqual(world.undo,undo);
    assert.equal(world.authoredGeneration,generation);
    assert.equal(world.requireObject(residentId).component,undefined);
    const fresh={...queued,requestId:'fresh-attachment',
      expectedTransform:structuredClone(world.requireObject(residentId).transform)};
    assert.equal(world.execute(fresh).ok,true,'a current guarded attachment remains valid');
  }finally{globalThis.sessionStorage=previousStorage;}
});

test('a delayed static-host attachment cannot bind a resident target after Citizens motion',async()=>{
  const previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
    let nextId=0;
    const world=new MatrixWorld(()=>`citizen-object-${++nextId}`);
    const simulation=createCitizensDemo(world,{seed:43});
    const host=world.execute({requestId:'static-host',op:'spawn',assetId:'block',
      anchorId:'web-floor',transform:{position:{x:4,y:0,z:-2},
        rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}},{recordHistory:false});
    assert.equal(host.ok,true);
    world.citizens=simulation.snapshot();
    const residentId=simulation.snapshot().residents[0].objectId;
    const expectedTargetTransform=structuredClone(world.requireObject(residentId).transform);
    const hostTransform=structuredClone(world.requireObject(host.objectId).transform);
    const queued={requestId:'delayed-target-attachment',op:'attach_component',
      objectId:host.objectId,targetObjectId:residentId,expectedTargetTransform,
      componentId:'webcomp:drift:0123456789ab',
      package:{schemaVersion:1,name:'Drift',outputs:{
        'position.x':{op:'const',value:0}}}};
    const bridge=new MatrixBridge(world,()=>'',()=>{});
    let deliver;
    bridge.request=async(_path,body)=>{
      assert.deepEqual(body.snapshot.scene.objects.find(item=>item.objectId===residentId).transform,
        expectedTargetTransform);
      return new Promise(resolve=>{deliver=resolve;});
    };
    const exchange=bridge.exchange(null);
    let moved=false;
    for(let step=0;step<10&&!moved;step++){
      simulation.step();world.citizens=simulation.snapshot();
      moved=JSON.stringify(world.requireObject(residentId).transform)!==
        JSON.stringify(expectedTargetTransform);
    }
    assert.equal(moved,true,'the target resident must move before delivery');
    assert.deepEqual(world.requireObject(host.objectId).transform,hostTransform,
      'the component host must stay still');
    const scene=structuredClone(world.scene),undo=structuredClone(world.undo);
    const generation=world.authoredGeneration;
    deliver({commands:[queued]});
    await exchange;
    const receipt=bridge.receipts.get(queued.requestId);
    assert.equal(receipt.ok,false);
    assert.match(receipt.error,/target transform changed since command was queued/);
    assert.deepEqual(world.scene,scene);
    assert.deepEqual(world.undo,undo);
    assert.equal(world.authoredGeneration,generation);
    assert.equal(world.requireObject(host.objectId).component,undefined);
    const fresh={...queued,requestId:'fresh-target-attachment',
      expectedTargetTransform:structuredClone(world.requireObject(residentId).transform)};
    assert.equal(world.execute(fresh).ok,true,'a current guarded target remains valid');
  }finally{globalThis.sessionStorage=previousStorage;}
});

test('a failed resident edit skips later batch commands even when their pose guard matches',async()=>{
  const previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
    let nextId=0;
    const world=new MatrixWorld(()=>`citizen-object-${++nextId}`);
    const simulation=createCitizensDemo(world,{seed:47});
    const host=world.execute({requestId:'static-host',op:'spawn',assetId:'block',
      anchorId:'web-floor',transform:{position:{x:4,y:0,z:-2},
        rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}},{recordHistory:false});
    assert.equal(host.ok,true);
    world.citizens=simulation.snapshot();
    const residentId=simulation.snapshot().residents[0].objectId;
    const originalPose=structuredClone(world.requireObject(residentId).transform);
    const bridge=new MatrixBridge(world,()=>'',()=>{});
    let deliver;
    bridge.request=async()=>new Promise(resolve=>{deliver=resolve;});
    const exchange=bridge.exchange(null);
    let moved=false;
    for(let step=0;step<10&&!moved;step++){
      simulation.step();world.citizens=simulation.snapshot();
      moved=JSON.stringify(world.requireObject(residentId).transform)!==
        JSON.stringify(originalPose);
    }
    assert.equal(moved,true);
    const observedPose=structuredClone(world.requireObject(residentId).transform);
    const first={requestId:'stale-move',op:'set_transform',objectId:residentId,
      expectedTransform:originalPose,transform:observedPose};
    const attach={requestId:'dependent-attach',op:'attach_component',
      objectId:host.objectId,targetObjectId:residentId,
      expectedTargetTransform:observedPose,requiresSuccessOf:first.requestId,
      componentId:'webcomp:drift:0123456789ab',
      package:{schemaVersion:1,name:'Drift',outputs:{
        'position.x':{op:'const',value:0}}}};
    const behavior={requestId:'dependent-behavior',op:'set_behavior',
      objectId:host.objectId,requiresSuccessOf:attach.requestId,
      behavior:{kind:'rotate',enabled:true,paused:false,axis:'y',
        speedDegreesPerSecond:30,amplitudeMeters:0,frequencyHz:.5}};
    const scene=structuredClone(world.scene),selection=structuredClone(world.selection);
    const undo=structuredClone(world.undo),generation=world.authoredGeneration;
    deliver({commands:[first,attach,behavior]});
    await exchange;
    assert.match(bridge.receipts.get(first.requestId).error,
      /transform changed since command was queued/);
    for(const requestId of [attach.requestId,behavior.requestId]){
      const receipt=bridge.receipts.get(requestId);
      assert.equal(receipt.ok,false);
      assert.match(receipt.error,/Skipped because prerequisite command/);
    }
    assert.deepEqual(world.scene,scene);
    assert.deepEqual(world.selection,selection);
    assert.deepEqual(world.undo,undo);
    assert.equal(world.authoredGeneration,generation);
    assert.equal(world.requireObject(host.objectId).component,undefined);
    const {requiresSuccessOf,...independentAttach}=attach;
    assert.equal(world.execute({...independentAttach,requestId:'independent-attach'}).ok,true,
      'the matching target pose alone would have allowed this attachment');
  }finally{globalThis.sessionStorage=previousStorage;}
});

test('bridge validates batch dependencies and accepts a sent predecessor receipt',async()=>{
  const previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
    const world=new MatrixWorld(()=> 'object-1');
    const pose=x=>({position:{x,y:0,z:-2},rotation:{x:0,y:0,z:0},
      scale:{x:1,y:1,z:1}});
    assert.equal(world.execute({requestId:'spawn',op:'spawn',assetId:'orb',
      anchorId:'web-floor',transform:pose(0)}).ok,true);
    const bridge=new MatrixBridge(world,()=>'',()=>{});
    let calls=0;
    bridge.request=async()=>++calls===1?{commands:[
      {requestId:'move-first',op:'set_transform',objectId:'object-1',transform:pose(1)}
    ]}:{commands:[
      {requestId:'select-second',op:'select',objectId:'object-1',
        requiresSuccessOf:'move-first'},
      {requestId:'bad-dependency',op:'delete',objectId:'object-1',
        requiresSuccessOf:42},
      {requestId:'missing-dependency',op:'delete',objectId:'object-1',
        requiresSuccessOf:'unknown-request'}
    ]};
    await bridge.exchange(null);
    assert.equal(bridge.receipts.get('move-first').ok,true);
    await bridge.exchange(null);
    assert.equal(bridge.receipts.get('select-second').ok,true);
    assert.match(bridge.receipts.get('bad-dependency').error,/Invalid requiresSuccessOf/);
    assert.match(bridge.receipts.get('missing-dependency').error,
      /Skipped because prerequisite command/);
    assert.equal(world.scene.objects.length,1);
    assert.equal(world.scene.objects[0].transform.position.x,1);
    assert.equal(world.selection.objectId,'object-1');
  }finally{globalThis.sessionStorage=previousStorage;}
});

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

test('startup recovery rejects old pending commands once, then accepts new commands',async()=>{
  const previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=> 'returning-client',setItem:()=>{}};
  try{
    let nextId=0;
    const world=new MatrixWorld(()=>`recovery-object-${++nextId}`);
    const pose={position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
    const old={requestId:'old-pending-spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose};
    assert.equal(world.execute(old).ok,true,'saved world already contains the old spawn');
    const savedScene=structuredClone(world.scene),savedUndo=structuredClone(world.undo);
    const fresh={...old,requestId:'new-spawn',assetId:'block'};
    const events=[],requests=[];
    const bridge=new MatrixBridge(world,()=>'',event=>events.push(event));
    bridge.running=true;
    bridge.exchangePaused=true;
    bridge.rejectPendingOnNextExchange=true;
    bridge.request=async(path,body)=>{
      assert.equal(path,'/api/exchange');requests.push(structuredClone(body));
      if(requests.length===1)throw Error('temporary connection failure');
      if(requests.length===2)return {commands:[old]};
      if(requests.length===3)return {commands:[fresh]};
      return {commands:[]};
    };
    await bridge.tick(true);
    assert.equal(requests.length,0,'no snapshot is exchanged before recovery finishes');
    bridge.exchangePaused=false;
    await bridge.tick(true);
    assert.equal(bridge.rejectPendingOnNextExchange,true,
      'a failed exchange must not consume the recovery guard');
    await bridge.tick(true);
    assert.equal(bridge.rejectPendingOnNextExchange,false);
    assert.deepEqual(world.scene,savedScene,'the old spawn is not replayed');
    assert.deepEqual(world.undo,savedUndo);
    const rejected=bridge.receipts.get(old.requestId);
    assert.equal(rejected.ok,false);
    assert.match(rejected.error,/outcome unknown after saved-world recovery/);
    assert.equal(events.some(event=>event.type==='receipt'&&event.result===rejected),true);
    assert.equal(events.some(event=>event.type==='scene'),false);
    await bridge.tick(true);
    assert.deepEqual(requests[2].results,[rejected],'the failed receipt is sent to clear the old queue');
    assert.equal(bridge.receipts.has(old.requestId),false);
    assert.equal(world.scene.objects.length,2,'a new command executes after the guarded exchange');
    assert.equal(world.scene.objects[1].assetId,'block');
    assert.equal(bridge.receipts.get(fresh.requestId).ok,true);
  }finally{globalThis.sessionStorage=previousStorage;}
});
