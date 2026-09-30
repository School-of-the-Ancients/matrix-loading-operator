import test from 'node:test';
import assert from 'node:assert/strict';
import {LatencyTrace,latencyRequestStage} from '../src/latency_trace.js';
import {MatrixBridge} from '../src/bridge.js';
import {MatrixWorld} from '../src/protocol.js';

test('trace bounds memory, uses local durations, and exports independent copies',()=>{
  let clock=10;const trace=new LatencyTrace({now:()=>clock,capacity:2});
  for(let i=0;i<3;i++){const finish=trace.begin('http.agent.turn');clock+=5;finish('ok');finish('failed');}
  const snapshot=trace.snapshot();
  assert.equal(snapshot.records.length,2);
  assert.deepEqual(snapshot.records.map(r=>r.durationMs),[5,5]);
  snapshot.records[0].stage='changed';
  assert.equal(trace.snapshot().records[0].stage,'http.agent.turn');
  assert.throws(()=>trace.begin('private prompt'),/Unknown/);
  const late=trace.begin('command.apply');trace.clear();late('ok');
  assert.deepEqual(trace.snapshot().records,[]);
});

test('route labels omit dynamic IDs, query strings and arbitrary caller data',()=>{
  assert.equal(latencyRequestStage('/api/agent/transcribe'),'http.agent.transcribe');
  assert.equal(latencyRequestStage('/api/voice/'+'a'.repeat(32)),'http.voice.status');
  for(const path of ['/api/agent/turn?token=secret','/api/private/scene-name','secret'])
    assert.equal(latencyRequestStage(path),'http.other');
});

test('request tracing observes success and failure without altering payloads or errors',async()=>{
  const previousStorage=globalThis.sessionStorage,previousFetch=globalThis.fetch;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
    let clock=0;const trace=new LatencyTrace({now:()=>clock});
    const bridge=new MatrixBridge(new MatrixWorld(),()=> 'private-token',()=>{});
    bridge.latencyTrace=trace;
    const response={transcript:'private transcript'};
    globalThis.fetch=async(_path,options)=>{
      assert.equal(options.headers.Authorization,'Bearer private-token');
      assert.equal(JSON.parse(options.body).audioBase64,'private audio');
      clock+=12;return {ok:true,json:async()=>response};
    };
    assert.equal(await bridge.request('/api/agent/transcribe',{audioBase64:'private audio'}),response);
    const error=Error('private failure');
    globalThis.fetch=async()=>{clock+=3;throw error;};
    await assert.rejects(bridge.request('/api/agent/transcribe',{}),e=>e===error);
    assert.deepEqual(trace.snapshot().records.map(r=>[r.outcome,r.durationMs]),[['ok',12],['failed',3]]);
    assert.equal(JSON.stringify(trace.snapshot()).includes('private'),false);
  }finally{globalThis.sessionStorage=previousStorage;globalThis.fetch=previousFetch;}
});

test('instrumented exchanges preserve command receipts and their acknowledgement',async()=>{
  const previousStorage=globalThis.sessionStorage,previousFetch=globalThis.fetch;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
  try{
    const world=new MatrixWorld(),trace=new LatencyTrace();
    const bridge=new MatrixBridge(world,()=>'',()=>{});bridge.latencyTrace=trace;
    let calls=0;
    globalThis.fetch=async(_path,options)=>{
      const body=JSON.parse(options.body);
      if(calls++)assert.equal(body.results[0].requestId,'private-request');
      return {ok:true,json:async()=>({commands:calls===1?
        [{op:'list_assets',requestId:'private-request'}]:[]})};
    };
    await bridge.exchange(null);
    assert.equal(bridge.receipts.get('private-request').ok,true);
    await bridge.exchange(null);
    assert.equal(bridge.receipts.size,0);
    assert.equal(bridge.recentReceipts.get('private-request').ok,true);
    assert.deepEqual(trace.snapshot().records.map(r=>r.stage),
      ['http.exchange','command.apply','http.exchange','receipts.acknowledged']);
    assert.equal(JSON.stringify(trace.snapshot()).includes('private-request'),false);
  }finally{globalThis.sessionStorage=previousStorage;globalThis.fetch=previousFetch;}
});
