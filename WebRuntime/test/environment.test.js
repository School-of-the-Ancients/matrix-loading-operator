import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {MatrixWorld,ROOM_ID} from '../src/protocol.js';
import {MatrixView} from '../src/view.js';
import {MatrixBridge} from '../src/bridge.js';
import {refreshAssetCatalogs} from '../src/catalog_refresh.js';
import {storedWorld,storedBrowserWorld,restoreStoredWorld,
  restoreBestStoredWorld,restoreBestStoredWorldWithEnvironment} from '../src/scene_store.js';
import {applyPCWorld} from '../src/world_checkpoint.js';
import {startNewWorld,restoreWorldArchive,worldArchives} from '../src/world_slots.js';

const sha='a'.repeat(64);
const asset=(digest=sha,name='sunset')=>({
  assetId:`panorama:${name}:${digest.slice(0,12)}`,displayName:name,
  sha256:digest,byteLength:2048,width:4,height:2,format:'png',
  url:`/api/web/environments/${digest}.png`});
const environment=(entry=asset(),yawDegrees=0)=>({schemaVersion:1,
  kind:'equirectangular',assetId:entry.assetId,sha256:entry.sha256,yawDegrees});
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,
  setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
const command=(requestId,op,rest={})=>({requestId,op,roomId:ROOM_ID,...rest});

test('panorama actions preserve objects, guard stale state, and survive browser and PC restore',async()=>{
  const world=new MatrixWorld(()=> 'kept-object');
  const entry=asset();world.registerEnvironmentAssets([entry]);
  assert.equal(world.execute({requestId:'spawn-kept',op:'spawn',assetId:'block',
    anchorId:'web-floor',transform:{position:{x:0,y:0,z:-2},
      rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}).ok,true);
  const objects=structuredClone(world.scene.objects);
  const first=environment(entry,35);
  const applied=world.execute(command('set-sunset','set_environment',
    {expectedEnvironment:null,environment:first}));
  assert.equal(applied.ok,true,applied.error);
  assert.deepEqual(applied.outcome,{kind:'environment-set',environment:first,
    previousEnvironment:null});
  assert.deepEqual(world.scene.objects,objects);
  assert.equal(world.snapshot().environmentSchemaVersion,1);
  assert.deepEqual(world.snapshot().environmentAssets,[entry]);
  assert.deepEqual(world.execute(command('read-sunset','get_environment')).outcome,
    {kind:'environment-status',environment:first});
  const stale=world.execute(command('stale-sunset','remove_environment',
    {expectedEnvironment:null}));
  assert.equal(stale.ok,false);
  assert.deepEqual(world.scene.environment,first);
  assert.equal(world.execute({requestId:'undo-sunset',op:'undo'}).ok,true);
  assert.equal(world.scene.environment,undefined);
  assert.equal(world.execute({requestId:'redo-sunset',op:'redo'}).ok,true);
  assert.deepEqual(world.scene.environment,first);
  const saved=storedBrowserWorld(world),reopened=new MatrixWorld();
  reopened.registerEnvironmentAssets([entry]);
  restoreStoredWorld(reopened,saved);
  assert.deepEqual(reopened.scene.environment,first);
  assert.deepEqual(reopened.scene.objects,objects);
  const pc=new MatrixWorld();pc.registerEnvironmentAssets([entry]);
  await applyPCWorld(pc,storedWorld(world),async()=>{});
  assert.deepEqual(pc.scene.environment,first);
  const removed=world.execute(command('remove-sunset','remove_environment',
    {expectedEnvironment:first}));
  assert.equal(removed.ok,true,removed.error);
  assert.deepEqual(removed.outcome,{kind:'environment-removed',environment:null,
    previousEnvironment:first});
  assert.deepEqual(world.scene.objects,objects);
});

test('missing panorama blocks restore without replacing the active scene',()=>{
  const source=new MatrixWorld(()=> 'source-block');
  source.registerEnvironmentAssets([asset()]);
  assert.equal(source.execute(command('set-source','set_environment',
    {expectedEnvironment:null,environment:environment()})).ok,true);
  const saved=storedBrowserWorld(source);
  const active=new MatrixWorld(()=> 'active-block');
  assert.equal(active.execute({requestId:'keep-active',op:'spawn',assetId:'block',
    anchorId:'web-floor',transform:{position:{x:0,y:0,z:-2},
      rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}).ok,true);
  const before=structuredClone(active.scene);
  const result=restoreBestStoredWorld(active,{value:saved,source:'saved',
    raw:JSON.stringify(saved),alternates:[]},storage());
  assert.equal(result.state,'waiting');
  assert.deepEqual(result.missingAssets,[asset().assetId]);
  assert.deepEqual(active.scene,before);
  assert.throws(()=>restoreStoredWorld(active,saved),/not registered/);
  assert.deepEqual(active.scene,before);
});

test('a failed panorama catalog leaves GLB-only browser recovery available',async()=>{
  const digest='b'.repeat(64);
  const model={assetId:`web:legacy:${digest.slice(0,12)}`,displayName:'Legacy prop',
    description:'Saved GLB prop',spawnScale:1,sha256:digest,byteLength:1024,
    url:`/api/web/assets/${digest}.glb`,
    localBounds:{center:{x:0,y:.5,z:0},size:{x:1,y:1,z:1}},
    geometry:{animationClips:[]}};
  const source=new MatrixWorld(()=> 'legacy-object');source.registerAssets([model]);
  assert.equal(source.execute({requestId:'saved-glb',op:'spawn',assetId:model.assetId,
    anchorId:'web-floor',transform:{position:{x:0,y:0,z:-2},
      rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}).ok,true);
  const saved=storedBrowserWorld(source),world=new MatrixWorld();
  const {environmentError}=await refreshAssetCatalogs(world,async path=>{
    if(path==='/api/web/assets')return {assets:[model]};
    throw Error('panorama manifest is corrupt');
  });
  assert.match(environmentError.message,/corrupt/);
  const restored=await restoreBestStoredWorldWithEnvironment(world,
    {value:saved,source:'saved',raw:JSON.stringify(saved),alternates:[]},
    storage(),async()=>{throw Error('No panorama preflight was expected');});
  assert.equal(restored.state,'restored');
  assert.deepEqual(world.scene.objects,source.scene.objects);
});

test('invalid newest save is quarantined before checking its panorama bytes',async()=>{
  const older=new MatrixWorld(()=> 'older-object');
  assert.equal(older.execute({requestId:'older-scene',op:'spawn',assetId:'block',
    anchorId:'web-floor',transform:{position:{x:0,y:0,z:-2},
      rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}).ok,true);
  const oldSaved=storedBrowserWorld(older),newSaved=storedBrowserWorld(new MatrixWorld());
  newSaved.scene.environment=environment();newSaved.scene.objects=[{}];
  const pending={value:newSaved,source:'newest',raw:JSON.stringify(newSaved),
    alternates:[{value:oldSaved,source:'older',raw:JSON.stringify(oldSaved)}]};
  const world=new MatrixWorld(),durable=storage();
  let preflights=0;
  const result=await restoreBestStoredWorldWithEnvironment(world,pending,durable,
    async()=>{preflights++;throw Error('missing PNG');});
  assert.equal(result.state,'restored');
  assert.equal(result.source,'older');
  assert.equal(result.rejected.length,1);
  assert.equal(preflights,0);
  assert.deepEqual(world.scene.objects,older.scene.objects);
});

test('panorama persists in a world archive and leaves a new world empty',()=>{
  const world=new MatrixWorld();world.registerEnvironmentAssets([asset()]);
  assert.equal(world.execute(command('set-archive','set_environment',
    {expectedEnvironment:null,environment:environment(asset(),120)})).ok,true);
  const tab=storage(),durable=storage();
  const created=startNewWorld(world,tab,durable,'Old sky');
  assert.equal(world.scene.environment,undefined);
  assert.equal(worldArchives(durable)[0].world.scene.environment.yawDegrees,120);
  restoreWorldArchive(world,created.archived.archiveId,tab,durable,'New sky');
  assert.equal(world.scene.environment.yawDegrees,120);
});

test('AR hides the panorama without changing its saved descriptor or VR yaw',()=>{
  const world=new MatrixWorld();world.registerEnvironmentAssets([asset()]);
  world.scene.environment=environment(asset(),90);
  const view=Object.create(MatrixView.prototype);
  view.world=world;view.scene=new THREE.Scene();
  view.neutralBackground=new THREE.Color(0x0a1b29);
  const texture=new THREE.Texture();
  texture.image={width:4,height:2};
  view.environmentTextures=new Map([[sha,texture]]);
  view.onAssetError=message=>{throw Error(message);};
  view.isAR=false;view.syncEnvironment();
  assert.equal(view.scene.background,texture);
  assert.equal(view.scene.backgroundRotation.y,Math.PI/2);
  view.isAR=true;view.syncEnvironment();
  assert.equal(view.scene.background,null);
  assert.deepEqual(world.scene.environment,environment(asset(),90));
  world.enterAR({visitDigitalWorld:false});
  const rejected=world.execute({requestId:'ar-panorama-edit',op:'remove_environment',
    roomId:world.scene.roomId,expectedEnvironment:environment(asset(),90)});
  assert.equal(rejected.ok,false);
  assert.match(rejected.error,/Leave AR/);
  world.leaveAR();
  assert.deepEqual(world.scene.environment,environment(asset(),90));
  view.isAR=false;view.syncEnvironment();
  assert.equal(view.scene.background,texture);
  texture.dispose();
});

test('AR clear preserves the hidden panorama through save and desktop return',()=>{
  const world=new MatrixWorld();world.registerEnvironmentAssets([asset()]);
  const current=environment(asset(),90);
  assert.equal(world.execute(command('set-before-ar','set_environment',
    {expectedEnvironment:null,environment:current})).ok,true);
  assert.equal(world.execute({requestId:'spawn-before-ar',op:'spawn',assetId:'block',
    anchorId:'web-floor',transform:{position:{x:0,y:0,z:-2},
      rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}).ok,true);
  world.enterAR({visitDigitalWorld:false});
  const cleared=world.execute({requestId:'clear-in-ar',op:'clear'});
  assert.equal(cleared.ok,true,cleared.error);
  assert.equal(world.scene.objects.length,0);
  assert.deepEqual(world.scene.environment,current);
  assert.equal(storedBrowserWorld(world).scene.objects.length,0);
  assert.deepEqual(storedBrowserWorld(world).scene.environment,current);
  assert.equal(world.execute({requestId:'undo-clear-in-ar',op:'undo'}).ok,true);
  assert.deepEqual(storedBrowserWorld(world).scene.environment,current);
  assert.equal(world.execute({requestId:'redo-clear-in-ar',op:'redo'}).ok,true);
  assert.deepEqual(storedBrowserWorld(world).scene.environment,current);
  world.leaveAR();
  assert.deepEqual(world.scene.environment,current);
  assert.equal(world.execute({requestId:'clear-on-desktop',op:'clear'}).ok,true);
  assert.equal(world.scene.environment,undefined);
});

test('AR scene load cannot indirectly change the saved panorama',()=>{
  const world=new MatrixWorld();world.registerEnvironmentAssets([asset()]);
  const current=environment(asset(),90);
  assert.equal(world.execute(command('set-before-load','set_environment',
    {expectedEnvironment:null,environment:current})).ok,true);
  world.enterAR({visitDigitalWorld:false});
  const withoutPanorama=structuredClone(world.scene);
  delete withoutPanorama.environment;
  const result=world.execute({requestId:'load-without-panorama-in-ar',op:'load',
    scene:withoutPanorama});
  assert.equal(result.ok,false);
  assert.match(result.error,/Leave AR to edit the panorama/);
  assert.deepEqual(world.scene.environment,current);
  assert.deepEqual(storedBrowserWorld(world).scene.environment,current);
});

test('a mismatched cached panorama reports one render failure during repeated syncs',async()=>{
  const world=new MatrixWorld();world.registerEnvironmentAssets([asset()]);
  world.scene.environment=environment();
  const view=Object.create(MatrixView.prototype),errors=[];
  view.world=world;view.scene=new THREE.Scene();view.isAR=false;
  view.neutralBackground=new THREE.Color(0x0a1b29);
  const texture=new THREE.Texture();texture.image={width:8,height:4};
  view.environmentTextures=new Map([[sha,texture]]);
  view.environmentFailures=new Map();view.onAssetError=message=>errors.push(message);
  for(let i=0;i<5;i++)view.syncEnvironment();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(errors.length,1);
  assert.match(errors[0],/Cached panorama dimensions differ/);
  view.syncEnvironment();
  assert.equal(errors.length,1);
  assert.equal(view.scene.background,view.neutralBackground);
  texture.dispose();
});

test('bearer fetch verifies panorama bytes and dimensions before a texture is cached',async()=>{
  const bytes=new TextEncoder().encode('verified panorama bytes '.repeat(3));
  const digest=createHash('sha256').update(bytes).digest('hex');
  const entry={...asset(digest,'verified'),byteLength:bytes.length};
  const world=new MatrixWorld();world.registerEnvironmentAssets([entry]);
  const view=Object.create(MatrixView.prototype);
  view.world=world;view.scene=new THREE.Scene();view.getToken=()=> 'owner-token';
  view.environmentTextures=new Map();view.environmentLoads=new Map();
  view.environmentFailures=new Map();
  const oldFetch=globalThis.fetch,oldBitmap=globalThis.createImageBitmap;
  let sentHeaders=null,closed=0;
  try{
    globalThis.fetch=async(_url,options)=>{sentHeaders=options.headers;
      const copy=new Uint8Array(bytes);copy[0]^=1;
      return new Response(copy);};
    globalThis.createImageBitmap=async()=>({width:4,height:2,close(){closed++;}});
    await assert.rejects(view.prepareEnvironment(environment(entry)),/checksum/);
    assert.equal(view.environmentTextures.size,0);
    globalThis.fetch=async(_url,options)=>{sentHeaders=options.headers;
      return new Response(bytes);};
    const texture=await view.prepareEnvironment(environment(entry));
    assert.equal(sentHeaders.Authorization,'Bearer owner-token');
    assert.equal(texture.mapping,THREE.EquirectangularReflectionMapping);
    assert.equal(texture.colorSpace,THREE.SRGBColorSpace);
    texture.dispose();texture.image.close();
    assert.equal(closed,1);
  }finally{globalThis.fetch=oldFetch;globalThis.createImageBitmap=oldBitmap;}
});

test('panorama preflight caps response bytes and aborts a stalled download',async()=>{
  const bytes=new TextEncoder().encode('bounded panorama bytes '.repeat(3));
  const digest=createHash('sha256').update(bytes).digest('hex');
  const entry={...asset(digest,'bounded'),byteLength:bytes.length};
  const world=new MatrixWorld();world.registerEnvironmentAssets([entry]);
  const view=Object.create(MatrixView.prototype);
  view.world=world;view.getToken=()=>'';view.scene=new THREE.Scene();
  view.environmentTextures=new Map();view.environmentLoads=new Map();
  view.environmentFailures=new Map();view.environmentLoadTimeoutMs=20;
  const oldFetch=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(new Uint8Array(bytes.length+1));
    await assert.rejects(view.prepareEnvironment(environment(entry)),/exceeds/);
    let aborted=false;
    globalThis.fetch=async(_url,{signal})=>new Promise((_,reject)=>{
      signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true});
    });
    await assert.rejects(view.prepareEnvironment(environment(entry)),/timed out/);
    assert.equal(aborted,true);
    assert.equal(view.environmentLoads.size,0);
  }finally{globalThis.fetch=oldFetch;}
});

test('a panorama decode finishing after its deadline closes the unused bitmap',async()=>{
  const bytes=new TextEncoder().encode('decoded panorama bytes '.repeat(3));
  const digest=createHash('sha256').update(bytes).digest('hex');
  const entry={...asset(digest,'decoded'),byteLength:bytes.length};
  const world=new MatrixWorld();world.registerEnvironmentAssets([entry]);
  const view=Object.create(MatrixView.prototype);
  view.world=world;view.getToken=()=>'';view.scene=new THREE.Scene();
  view.environmentTextures=new Map();view.environmentLoads=new Map();
  view.environmentFailures=new Map();view.environmentLoadTimeoutMs=100;
  const oldFetch=globalThis.fetch,oldBitmap=globalThis.createImageBitmap;
  let finishDecode=null,closed=0;
  try{
    globalThis.fetch=async()=>new Response(bytes);
    globalThis.createImageBitmap=()=>new Promise(resolve=>{finishDecode=resolve;});
    const loading=view.prepareEnvironment(environment(entry));
    for(let i=0;i<20&&!finishDecode;i++)
      await new Promise(resolve=>setTimeout(resolve,2));
    assert.equal(typeof finishDecode,'function');
    await assert.rejects(loading,/timed out/);
    finishDecode({width:4,height:2,close(){closed++;}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(closed,1);
    assert.equal(view.environmentTextures.size,0);
  }finally{globalThis.fetch=oldFetch;globalThis.createImageBitmap=oldBitmap;}
});

test('bridge rejects an unavailable panorama before success receipt or world mutation',async()=>{
  const oldStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
    const world=new MatrixWorld(),entry=asset();world.registerEnvironmentAssets([entry]);
    const bridge=new MatrixBridge(world,()=>'',()=>{});
    bridge.prepareEnvironment=async()=>{throw Error('checksum mismatch');};
    bridge.request=async()=>({commands:[command('set-queued','set_environment',
      {expectedEnvironment:null,environment:environment(entry)})]});
    await bridge.exchange(null);
    assert.equal(bridge.receipts.get('set-queued').ok,false);
    assert.match(bridge.receipts.get('set-queued').error,/checksum mismatch/);
    assert.equal(world.scene.environment,undefined);
  }finally{globalThis.sessionStorage=oldStorage;}
});
