import test from 'node:test';
import assert from 'node:assert/strict';
import {blenderSpawnCommand,captureBlenderPlacement,captureBlenderRequestContext,
  queueBlenderPlacement,registeredBlenderAsset,
  validateBlenderPlacement} from '../src/blender_placement.js';

const asset={assetId:'web:new-seat:sha',displayName:'New seat',sha256:'a'.repeat(64)};
function fixture({ar=false,point=null}={}){
  const world={scene:{schemaVersion:1,roomId:'room-1',objects:[]},
    authoredGeneration:7,creatorMode:{mode:'creator',simulation:'paused',revision:1},
    originBinding:ar?'ar':'virtual',originAnchorHandle:ar?'handle-1':null,
    runtimePresentation:ar?'ar':'desktop',selection:{anchorId:ar?'support-1':'web-floor',
      objectId:'',position:{x:1,y:0,z:-2}},spatial:ar?{originUnavailable:false,stale:false,
      alignmentVerified:true,anchors:[{anchorId:'support-1',surface:{kind:'support',boundary:[[0,0],[1,0],[1,1]]}}]}:null,
    externalAssets:[asset]};
  let currentPoint=point;
  let session=null;
  const view={isAR:ar,sessionStartedAt:ar?100:undefined,
    roomAnchorLocated:ar,roomAnchor:ar?{id:'room-anchor-1'}:null,
    renderer:{xr:{getSession:()=>session}},xrViewer:null,xrViewerCapturedAt:0,
    pointingTarget:()=>currentPoint};
  return {world,view,setPoint:value=>{currentPoint=value;},setSession:value=>{session=value;}};
}

test('registered Blender asset produces one typed spawn at the request-time virtual target',()=>{
  const {world,view}=fixture();
  const capture=captureBlenderPlacement(world,view,{now:100});
  const command=blenderSpawnCommand(world,view,capture,asset,{now:500});
  assert.deepEqual(command,{op:'spawn',assetId:asset.assetId,
    anchorId:'web-floor',transform:{position:{x:1,y:0,z:-2},
      rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}});
});

test('changed scene, replacement scene, creator round trip, and changed selection cancel placement but retain the asset',()=>{
  for(const change of [
    world=>world.scene.objects.push({objectId:'new'}),
    world=>{world.scene={...world.scene};},
    world=>{world.creatorMode.revision+=2;},
    world=>{world.selection.position.x=8;}
  ]){
    const {world,view}=fixture();
    const capture=captureBlenderPlacement(world,view,{now:100});
    change(world);
    assert.throws(()=>blenderSpawnCommand(world,view,capture,asset,{now:500}),/remains registered/);
    assert.equal(world.externalAssets[0],asset);
  }
});

test('request-time pointing remains fixed as the ray moves, while XR session replacement cancels',()=>{
  const point={anchorId:'web-floor',objectId:null,position:{x:3,y:0,z:-1}};
  const f=fixture({point});
  const capture=captureBlenderPlacement(f.world,f.view,{now:100});
  f.setPoint({...point,position:{x:4,y:0,z:-1}});
  assert.deepEqual(validateBlenderPlacement(f.world,f.view,capture,{now:200}).position,
    {x:3,y:0,z:-1});
  f.setSession({id:'new-vr-session'});
  assert.throws(()=>validateBlenderPlacement(f.world,f.view,capture,{now:200}),/runtime or room origin changed/);
});

test('selected marker is the Blender destination even after hover and object selection change',()=>{
  const f=fixture({point:{anchorId:'web-floor',objectId:null,
    position:{x:8,y:0,z:0}}});
  f.world.selection.objectId='chair-1';
  let marker={anchorId:'web-floor',position:{x:.4,y:0,z:-.6},source:'raycast'};
  f.view.selectedPlacementTarget=()=>marker;
  const capture=captureBlenderPlacement(f.world,f.view,{now:100});
  assert.equal(capture.selection.objectId,'chair-1');
  assert.deepEqual(capture.selection.position,marker.position);
  assert.deepEqual(capture.target,marker);
  f.setPoint({anchorId:'web-floor',objectId:null,position:{x:5,y:0,z:1}});
  assert.deepEqual(validateBlenderPlacement(f.world,f.view,capture,{now:200}).position,
    marker.position);
  marker={...marker,position:{x:.5,y:0,z:-.6}};
  assert.throws(()=>validateBlenderPlacement(f.world,f.view,capture,{now:200}),
    /placement selection changed/);
});

test('bridge binds the projected selected point without losing object or support identity',async()=>{
  for(const ar of [false,true]){
    const {world,view}=fixture({ar});
    world.selection.objectId='chair-1';
    if(ar)world.spatial.anchors.push({anchorId:'support-2',
      surface:{kind:'support',boundary:[[0,0],[1,0],[1,1]]}});
    let marker={anchorId:ar?'support-2':'web-floor',
      position:{x:.4,y:0,z:.6},source:'raycast'};
    view.selectedPlacementTarget=()=>marker;
    const state={online:true,clientId:'client-1',revision:7,runtimeGeneration:3,
      snapshot:{scene:structuredClone(world.scene),
        selection:{...structuredClone(world.selection),anchorId:marker.anchorId,
          position:structuredClone(marker.position)},
        creatorMode:structuredClone(world.creatorMode)}};
    const bridge={clientId:'client-1',sync:async()=>{},
      request:async path=>{assert.equal(path,'/api/state');return state;}};
    const capture=await captureBlenderRequestContext(world,view,bridge);
    assert.equal(capture.selection.objectId,'chair-1');
    assert.equal(capture.selection.anchorId,marker.anchorId);
    assert.deepEqual(capture.target.position,marker.position);
    state.snapshot.selection.position.x+=.1;
    await assert.rejects(captureBlenderRequestContext(world,view,bridge),
      /PC Matrix world differs/);
    state.snapshot.selection.position.x-=.1;
    marker={...marker,position:{x:.6,y:0,z:.6}};
    await assert.rejects(captureBlenderRequestContext(world,view,bridge),
      /PC Matrix world differs/);
  }
});

test('AR measured placement requires the same tracked room surface and a fresh pose',()=>{
  const f=fixture({ar:true});
  const session={id:'ar-1'};f.setSession(session);
  f.view.xrViewer={};f.view.xrViewerCapturedAt=100;
  const capture=captureBlenderPlacement(f.world,f.view,{now:100});
  const placement=validateBlenderPlacement(f.world,f.view,capture,{now:500});
  assert.deepEqual(placement,{anchorId:'support-1',position:{x:1,y:0,z:-2},placement:'surface'});
  f.view.xrViewerCapturedAt=0;
  assert.throws(()=>validateBlenderPlacement(f.world,f.view,capture,{now:2000}),/head tracking/);
  f.view.xrViewerCapturedAt=2000;
  f.world.spatial.originUnavailable=true;
  assert.throws(()=>validateBlenderPlacement(f.world,f.view,capture,{now:2000}),/Room tracking/);
  f.world.spatial.originUnavailable=false;
  f.world.spatial.anchors[0].surface.boundary[0][0]=.5;
  assert.throws(()=>validateBlenderPlacement(f.world,f.view,capture,{now:2000}),/Room tracking/);
  f.world.spatial.anchors[0].surface.boundary[0][0]=0;
  f.view.roomTrackingEpoch=1;
  assert.throws(()=>validateBlenderPlacement(f.world,f.view,capture,{now:2000}),/runtime or room origin changed/);
});

test('measured target generates only the reviewed support-surface command',()=>{
  const f=fixture({ar:true});
  f.setSession({id:'ar-1'});f.view.xrViewer={};f.view.xrViewerCapturedAt=100;
  const capture=captureBlenderPlacement(f.world,f.view,{now:100});
  const command=blenderSpawnCommand(f.world,f.view,capture,asset,{now:500});
  assert.equal(command.anchorId,'support-1');
  assert.equal(command.placement,'surface');
  assert.equal(f.world.externalAssets[0],asset);
});

test('ready Blender job must match the refreshed catalog and loaded GLB digest',()=>{
  const sha256='a'.repeat(64);
  const generated={...asset,sha256};
  const world={asset:id=>id===asset.assetId?generated:null};
  const job={phase:'ready',asset:generated};
  assert.equal(registeredBlenderAsset(world,job,{assets:[generated]}),generated);
  assert.throws(()=>registeredBlenderAsset(world,job,{assets:[{...generated,
    sha256:'b'.repeat(64)}]}),/digest does not match/);
  assert.throws(()=>registeredBlenderAsset(world,job,{assets:[]}),/digest does not match/);
});

function queuedFixture({changeBeforeExecute=false,missingPcReceipt=false}={}){
  const {world,view}=fixture();
  const state={online:true,clientId:'client-1',revision:7,runtimeGeneration:3,
    snapshot:{scene:structuredClone(world.scene),assets:[structuredClone(asset)],
      selection:structuredClone(world.selection),
      creatorMode:structuredClone(world.creatorMode),roomContext:{mode:'white-room',state:'ready',
        alignmentVerified:false},runtimeDescriptor:{client:'matrix-web'}} ,results:[]};
  let queued=null,receipt=null,guard=null;
  const bridge={clientId:'client-1',async sync(){if(receipt){
    if(!missingPcReceipt)state.results=[receipt];
    state.snapshot.scene=structuredClone(world.scene);
    state.snapshot.selection=structuredClone(world.selection);
  }},async request(path,body){
    if(path==='/api/state')return structuredClone(state);
    assert.equal(path,'/api/command');
    assert.equal(body.expectedClientId,'client-1');
    assert.equal(body.expectedRevision,7);
    assert.equal(body.expectedRoomId,'room-1');
    assert.equal(body.expectedRuntimeGeneration,3);
    assert.equal(body.commands.length,1);
    queued={...body.commands[0],requestId:'queued-spawn-1'};
    return {commands:[queued]};
  },async withExclusiveExchange(action){return action();},
  guardCommand(id,callback){assert.equal(id,'queued-spawn-1');guard=callback;},
  async tick(){
    if(changeBeforeExecute)world.selection.position.x=9;
    try{guard(queued);
      world.scene.objects.push({objectId:'spawned-1',assetId:asset.assetId,
        anchorId:'web-floor',transform:queued.transform});
      receipt={requestId:queued.requestId,ok:true,objectId:'spawned-1',error:''};
    }catch(error){receipt={requestId:queued.requestId,ok:false,objectId:'',
      error:error.message};}
  },async waitForReceipt(id){assert.equal(id,'queued-spawn-1');return receipt;}};
  return {world,view,bridge,state,getQueued:()=>queued};
}

test('Blender placement uses a guarded service command and reports only its PC-acknowledged receipt',async()=>{
  const f=queuedFixture();
  const capture=await captureBlenderRequestContext(f.world,f.view,f.bridge);
  let queuedId='';
  const receipt=await queueBlenderPlacement(f.world,f.view,f.bridge,capture,asset,
    {onQueued:id=>{queuedId=id;}});
  assert.equal(receipt.requestId,'queued-spawn-1');
  assert.equal(queuedId,receipt.requestId);
  assert.equal(f.getQueued().op,'spawn');
  assert.equal(f.state.results[0].objectId,'spawned-1');
});

test('late target change rejects the queued spawn and retains the generated asset',async()=>{
  const f=queuedFixture({changeBeforeExecute:true});
  const capture=await captureBlenderRequestContext(f.world,f.view,f.bridge);
  await assert.rejects(queueBlenderPlacement(f.world,f.view,f.bridge,capture,asset),
    /registered, but Matrix rejected placement/);
  assert.equal(f.world.scene.objects.length,0);
  assert.equal(f.world.externalAssets[0],asset);
});

test('missing PC acknowledgement remains unconfirmed even after a browser spawn',async()=>{
  const f=queuedFixture({missingPcReceipt:true});
  const capture=await captureBlenderRequestContext(f.world,f.view,f.bridge);
  await assert.rejects(queueBlenderPlacement(f.world,f.view,f.bridge,capture,asset),
    /unconfirmed on the PC/);
  assert.equal(f.world.externalAssets[0],asset);
});

test('PC world or runtime change during Blender generation prevents any queue',async()=>{
  for(const change of [
    state=>{state.snapshot.scene.objects.push({objectId:'other'});},
    state=>{state.runtimeGeneration++;}
  ]){
    const f=queuedFixture();
    const capture=await captureBlenderRequestContext(f.world,f.view,f.bridge);
    change(f.state);
    await assert.rejects(queueBlenderPlacement(f.world,f.view,f.bridge,capture,asset),
      /PC runtime or Matrix world changed/);
    assert.equal(f.getQueued(),null);
  }
});
