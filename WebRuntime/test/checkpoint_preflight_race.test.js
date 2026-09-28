import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld,ROOM_ID} from '../src/protocol.js';
import {MatrixBridge} from '../src/bridge.js';
import {storedWorld} from '../src/scene_store.js';
import {applyBrowserCheckpoint} from '../src/world_checkpoint.js';

const sha='a'.repeat(64);
const panorama={assetId:`panorama:race:${sha.slice(0,12)}`,displayName:'Race test',
  sha256:sha,byteLength:2048,width:4,height:2,format:'png',
  url:`/api/web/environments/${sha}.png`};
const pose=x=>({position:{x,y:0,z:-2},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});

function populatedWorld(id){
  const world=new MatrixWorld(()=>id);
  world.registerEnvironmentAssets([panorama]);
  const result=world.execute({requestId:`spawn-${id}`,op:'spawn',assetId:'block',
    anchorId:'web-floor',transform:pose(0)});
  assert.equal(result.ok,true,result.error);
  return world;
}

function panoramaCheckpoint(){
  const saved=populatedWorld('checkpoint-object');
  const result=saved.execute({requestId:'set-checkpoint-panorama',op:'set_environment',
    roomId:ROOM_ID,expectedEnvironment:null,
    environment:{schemaVersion:1,kind:'equirectangular',assetId:panorama.assetId,
      sha256:sha,yawDegrees:45}});
  assert.equal(result.ok,true,result.error);
  return storedWorld(saved);
}

function withSessionStorage(action){
  const previous=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  return Promise.resolve().then(action).finally(()=>{globalThis.sessionStorage=previous;});
}

test('browser checkpoint refuses to overwrite a successful command from an in-flight exchange',
  ()=>withSessionStorage(async()=>{
    const world=populatedWorld('active-object'),bridge=new MatrixBridge(world,()=>'',()=>{});
    bridge.running=true;
    let deliver;
    bridge.request=async()=>new Promise(resolve=>{deliver=resolve;});
    const exchanging=bridge.tick(true);
    const restoring=applyBrowserCheckpoint(world,panoramaCheckpoint(),bridge,async()=>{
      assert.fail('preflight must not run after the world changed');
    });
    assert.equal(bridge.exchangePaused,true);
    deliver({commands:[{requestId:'edit-during-exchange',op:'set_transform',
      objectId:'active-object',transform:pose(3)}]});
    await exchanging;
    await assert.rejects(restoring,/World changed while checkpoint restore was being prepared/);
    assert.equal(bridge.receipts.get('edit-during-exchange').ok,true);
    assert.equal(world.scene.objects[0].transform.position.x,3);
    assert.equal(world.scene.environment,undefined);
    assert.equal(bridge.exchangePaused,false);
  }));

test('browser checkpoint refuses to overwrite a direct view edit during panorama preflight',
  ()=>withSessionStorage(async()=>{
    const world=populatedWorld('active-object'),bridge=new MatrixBridge(world,()=>'',()=>{});
    bridge.running=true;
    let started,finish;
    const preflightStarted=new Promise(resolve=>{started=resolve;});
    const preflightDone=new Promise(resolve=>{finish=resolve;});
    const restoring=applyBrowserCheckpoint(world,panoramaCheckpoint(),bridge,async()=>{
      started();await preflightDone;
    });
    await preflightStarted;
    assert.equal(bridge.exchangePaused,true);
    const edit=world.execute({requestId:'view-move',op:'set_transform',
      objectId:'active-object',transform:pose(4)});
    assert.equal(edit.ok,true,edit.error);
    finish();
    await assert.rejects(restoring,/World changed while checkpoint restore was being prepared/);
    assert.equal(world.scene.objects[0].transform.position.x,4);
    assert.equal(bridge.exchangePaused,false);
  }));

test('successful browser restore rejects the first queued old-world command',
  ()=>withSessionStorage(async()=>{
    const world=populatedWorld('active-object'),bridge=new MatrixBridge(world,()=>'',()=>{});
    bridge.running=true;
    let preflights=0,exchanges=0;
    bridge.request=async()=>({commands:++exchanges===1?[{
      requestId:'queued-old-world-spawn',op:'spawn',assetId:'block',
      anchorId:'web-floor',transform:pose(7)}]:[]});
    await applyBrowserCheckpoint(world,panoramaCheckpoint(),bridge,async()=>{preflights++;});
    assert.equal(preflights,1);
    assert.equal(world.scene.objects[0].objectId,'checkpoint-object');
    assert.equal(world.scene.environment.yawDegrees,45);
    assert.equal(bridge.rejectPendingOnNextExchange,true);
    await bridge.tick(true);
    assert.equal(bridge.receipts.get('queued-old-world-spawn').ok,false);
    assert.match(bridge.receipts.get('queued-old-world-spawn').error,/saved-world recovery/);
    assert.equal(world.scene.objects.length,1);
  }));

test('offline browser restore remains available and detects same-content scene replacement',
  ()=>withSessionStorage(async()=>{
    const world=populatedWorld('active-object'),bridge=new MatrixBridge(world,()=>'',()=>{});
    let finish,started;
    const preflightStarted=new Promise(resolve=>{started=resolve;});
    const preflightDone=new Promise(resolve=>{finish=resolve;});
    const restoring=applyBrowserCheckpoint(world,panoramaCheckpoint(),bridge,async()=>{
      started();await preflightDone;
    });
    await preflightStarted;
    world.scene=structuredClone(world.scene);
    finish();
    await assert.rejects(restoring,/World changed while checkpoint restore was being prepared/);
    assert.equal(world.scene.objects[0].objectId,'active-object');
    await applyBrowserCheckpoint(world,panoramaCheckpoint(),bridge,async()=>{});
    assert.equal(world.scene.objects[0].objectId,'checkpoint-object');
  }));
