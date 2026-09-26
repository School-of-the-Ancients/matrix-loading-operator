import test from 'node:test';
import assert from 'node:assert/strict';
import {BlockScaleClient,confirmedScaleEvent,matchingScaleEvidence,scaleEvidence,scaleIntent,
  uniformScaleFactors} from '../src/block_scale.js';
import {BlockScaleUI} from '../src/block_scale_ui.js';
import {MatrixWorld} from '../src/protocol.js';
import {loadStoredWorld,restoreStoredWorld,saveStoredWorld,storedWorld} from '../src/scene_store.js';

const transform={position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
const storage=()=>{const entries=new Map();return {getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value)};};

test('HTML factors and a selected Three.js uniform preset produce the same typed intent',()=>{
  const html=scaleIntent('configure','block-1',{x:2,y:2,z:2});
  const three=scaleIntent('configure','block-1',uniformScaleFactors(2));
  assert.deepEqual(three,html);
  assert.deepEqual(scaleIntent('reset','block-1',null,'configure-1'),
    {kind:'block-scale',version:1,action:'reset',objectId:'block-1',baselineRequestId:'configure-1'});
  for(const invalid of [{x:'2',y:2,z:2},{x:0,y:2,z:2},{x:2,y:2,z:Infinity},{x:2,y:2}])
    assert.throws(()=>scaleIntent('configure','block-1',invalid),/factors/);
});

test('limited desktop client pairs in memory, proposes once, and never calls owner Apply',async()=>{
  const world=new MatrixWorld(()=> 'block-1');
  assert.equal(world.execute({requestId:'spawn-1',op:'spawn',assetId:'block',anchorId:'web-floor',transform}).ok,true);
  const calls=[];let status='ready';
  const request=async(path,body,token)=>{
    calls.push({path,body,token});
    if(path==='/api/v1/discovery')return {protocolVersion:'1',capabilities:{'experiment.block-scale.v1':{version:1}}};
    if(path==='/api/v1/sessions')return {protocolVersion:'1',clientToken:'client-secret',sessionId:'pair-1',runtimeSessionId:'runtime-1'};
    if(path==='/api/v1/scene')return {protocolVersion:'1',sessionId:'pair-1',runtimeSessionId:'runtime-1',revision:7,snapshot:world.snapshot()};
    if(path==='/api/v1/requests')return {protocolVersion:'1',sessionId:'pair-1',runtimeSessionId:'runtime-1',
      requestId:body.requestId,status:'ready',proposal:{commands:[{op:'set_transform'}]}};
    if(path==='/api/v1/requests/configure-1')return {protocolVersion:'1',sessionId:'pair-1',runtimeSessionId:'runtime-1',
      requestId:'configure-1',status,experiment:{observationState:status==='succeeded'?'confirmed':'not-confirmed',
        observation:status==='succeeded'?{physicalMeasurement:false}:null,
        expectedTransform:{...transform,scale:{x:2,y:3,z:4}}},
      experimentEvent:status==='succeeded'?{schemaVersion:1,type:'experiment.block-scale.observed',
        source:'acknowledged-runtime-transform',requestId:'configure-1',roomId:world.scene.roomId,
        objectId:'block-1',assetId:'block',anchorId:'web-floor',action:'configure',
        revision:8,relativeFactors:{x:2,y:3,z:4},localDimensionsMeters:{x:2,y:3,z:4},
        boundingVolumeCubicMeters:24,dimensionSource:'catalog-local-bounds',
        physicalMeasurement:false,mathematicalVolumeRatio:24}:undefined};
    throw Error(`Unexpected ${path}`);
  };
  const client=new BlockScaleClient(request,()=> 'configure-1');
  await client.discovery();await client.pair('one-use-code');
  await client.propose(scaleIntent('configure','block-1',{x:2,y:3,z:4}));
  assert.equal(client.currentId,'configure-1');
  assert.equal(calls.at(-1).body.expected.revision,7);
  assert.equal(calls.at(-1).token,'client-secret');
  assert.ok(calls.every(call=>!call.path.includes('/operator/')&&!call.path.includes('/apply')));
  await assert.rejects(client.pair('another-one-use-code'),error=>
    error.message.includes('configure-1')&&error.message.includes('/clients')&&
    error.message.includes('before reloading'));
  assert.equal(client.currentId,'configure-1','a re-pair attempt must retain the request ID');
  assert.equal(client.session.clientToken,'client-secret','the original pairing must remain usable');
  assert.equal(calls.filter(call=>call.path==='/api/v1/sessions').length,1,
    'no second pairing code may be claimed while a request is unresolved');
  assert.equal((await client.outcome()).status,'ready');
  assert.equal(calls.at(-1).token,'client-secret');
  status='succeeded';
  const result=await client.outcome();
  assert.equal(result.experimentEvent.mathematicalVolumeRatio,24);
  assert.equal(client.baselineFor('block-1'),'configure-1');
  assert.equal(client.currentId,null);
  assert.ok(calls.every(call=>!call.path.includes('/operator/')&&!call.path.includes('/apply')));
  await client.pair('another-one-use-code');
  assert.equal(calls.filter(call=>call.path==='/api/v1/sessions').length,2,
    'pairing is available again only after the original request reaches a terminal outcome');
});

test('only a confirmed receipt yields an event, and saved block identity preserves historical evidence',()=>{
  const world=new MatrixWorld(()=> 'block-1');
  const updated={...structuredClone(transform),scale:{x:2,y:3,z:4}};
  assert.equal(world.execute({requestId:'spawn-1',op:'spawn',assetId:'block',anchorId:'web-floor',transform:updated}).ok,true);
  const outcome={status:'succeeded',requestId:'configure-1',experiment:{observationState:'confirmed',
    observation:{physicalMeasurement:false},expectedTransform:updated},
    observed:{snapshot:{scene:structuredClone(world.scene)}},experimentEvent:{schemaVersion:1,
      type:'experiment.block-scale.observed',requestId:'configure-1',roomId:world.scene.roomId,
      objectId:'block-1',assetId:'block',anchorId:'web-floor',
      source:'acknowledged-runtime-transform',physicalMeasurement:false,
      revision:8,action:'configure',relativeFactors:{x:2,y:3,z:4},
      localDimensionsMeters:{x:2,y:3,z:4},boundingVolumeCubicMeters:24,
      dimensionSource:'catalog-local-bounds',mathematicalVolumeRatio:24}};
  assert.equal(confirmedScaleEvent(outcome)?.mathematicalVolumeRatio,24);
  assert.equal(confirmedScaleEvent({...outcome,experiment:{...outcome.experiment,observationState:'unconfirmed'}}),null);
  const evidence=scaleEvidence(outcome);
  assert.equal(matchingScaleEvidence(world,evidence),true);
  const tab=storage(),durable=storage();
  assert.equal(saveStoredWorld(storedWorld(world),tab,durable),'');
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,loadStoredWorld(storage(),durable).value);
  assert.equal(reopened.scene.objects[0].objectId,'block-1');
  assert.equal(matchingScaleEvidence(reopened,evidence),true);
  const reordered={...evidence,transform:{scale:updated.scale,rotation:updated.rotation,position:updated.position}};
  assert.equal(matchingScaleEvidence(reopened,reordered),true);
  reopened.scene.objects[0].transform.scale.x=3;
  assert.equal(matchingScaleEvidence(reopened,evidence),false);
  assert.equal(matchingScaleEvidence(world,{...evidence,event:{...evidence.event,physicalMeasurement:true}}),false);
  assert.equal(matchingScaleEvidence(world,{...evidence,event:{...evidence.event,anchorId:'other'}}),false);
  const malformed={...evidence,event:{...evidence.event,relativeFactors:undefined}};
  assert.equal(matchingScaleEvidence(world,malformed),false);
});

test('scale evidence stores the acknowledged transform, including accepted rounding',()=>{
  const world=new MatrixWorld(()=> 'block-1');
  const observed={...structuredClone(transform),scale:{x:2.000001,y:3,z:4}};
  const proposed={...structuredClone(transform),scale:{x:2,y:3,z:4}};
  assert.equal(world.execute({requestId:'spawn-1',op:'spawn',assetId:'block',
    anchorId:'web-floor',transform:observed}).ok,true);
  const event={schemaVersion:1,type:'experiment.block-scale.observed',
    requestId:'configure-1',roomId:world.scene.roomId,objectId:'block-1',
    assetId:'block',anchorId:'web-floor',source:'acknowledged-runtime-transform',
    physicalMeasurement:false,revision:8,action:'configure',
    relativeFactors:{x:2.000001,y:3,z:4},
    localDimensionsMeters:{x:2.000001,y:3,z:4},
    boundingVolumeCubicMeters:24.000012,dimensionSource:'catalog-local-bounds',
    mathematicalVolumeRatio:24.000012};
  const outcome={status:'succeeded',requestId:'configure-1',
    experiment:{observationState:'confirmed',observation:{physicalMeasurement:false},
      expectedTransform:proposed},
    observed:{snapshot:{scene:structuredClone(world.scene)}},experimentEvent:event};
  const evidence=scaleEvidence(outcome);
  assert.deepEqual(evidence.transform,observed);
  assert.equal(matchingScaleEvidence(world,evidence),true);
  assert.equal(scaleEvidence({...outcome,observed:null}),null);
});

test('corrupt saved scale evidence cannot abort Block Scale Lab construction',async()=>{
  const world=new MatrixWorld(()=> 'block-1');
  assert.equal(world.execute({requestId:'spawn-1',op:'spawn',assetId:'block',anchorId:'web-floor',transform}).ok,true);
  const corrupt={version:1,roomId:world.scene.roomId,objectId:'block-1',transform,
    event:{schemaVersion:1,type:'experiment.block-scale.observed',roomId:world.scene.roomId,
      objectId:'block-1',assetId:'block',anchorId:'web-floor',action:'configure',revision:8,
      source:'acknowledged-runtime-transform',physicalMeasurement:false,
      mathematicalVolumeRatio:24,dimensionSource:'catalog-local-bounds',
      localDimensionsMeters:{x:2,y:3,z:4},boundingVolumeCubicMeters:24}};
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',disabled:false,textContent:'',title:'',
      classList:{toggle(){},contains(){return false;}},addEventListener(){},replaceChildren(){},add(){}});
    return elements.get(id);
  };
  const previous={document:globalThis.document,Option:globalThis.Option,
    addEventListener:globalThis.addEventListener};
  try{
    globalThis.document={getElementById:element};
    globalThis.Option=class{constructor(label,value){this.label=label;this.value=value;}};
    globalThis.addEventListener=()=>{};
    const client={currentId:null,baselineFor:()=>null,discovery:async()=>({pairingAvailable:false,
      pairingReason:'Client pairing unavailable.'})};
    assert.doesNotThrow(()=>new BlockScaleUI(world,()=>{},
      {getItem:()=>JSON.stringify(corrupt),setItem(){}},client));
    assert.match(element('scale-observation').textContent,/No matching confirmed scale observation/);
    await Promise.resolve();
  }finally{
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined)delete globalThis[key];else globalThis[key]=value;
    }
  }
});
