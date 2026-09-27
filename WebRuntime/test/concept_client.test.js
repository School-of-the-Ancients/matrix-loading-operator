import test from 'node:test';
import assert from 'node:assert/strict';
import {ConceptClient} from '../src/concept_client.js';

const sessionId='a'.repeat(32),one={conceptId:'concept-one',version:1,status:'ready',
  previewUrl:'/api/agent/concepts/concept-one/preview',prompt:'forest temple'};
const two={conceptId:'concept-two',version:2,status:'ready',
  previewUrl:'/api/agent/concepts/concept-two/preview',prompt:'forest temple'};

test('durable concept jobs and selection use only the Agent session ID',async()=>{
  const calls=[];let list={jobs:[],concepts:[],selectedConceptId:null};
  const client=new ConceptClient(async(path,body)=>{
    calls.push([path,body]);
    if(path.startsWith('/api/agent/concepts?'))return list;
    if(path==='/api/agent/concepts')return {job:{id:'job-one',conceptId:one.conceptId,version:1,status:'queued'}};
    if(path==='/api/agent/concepts/variation')return {job:{id:'job-two',conceptId:two.conceptId,version:2,status:'queued'}};
    if(path==='/api/agent/concepts/select')return {selectedConceptId:body.conceptId,
      concept:{...two,designNotes:body.designNotes}};
    throw Error('unexpected path');
  });
  await client.refresh(sessionId);
  await client.generate(sessionId,'forest temple');
  assert.equal(client.activeJobs.length,1);
  list={jobs:[{id:'job-one',conceptId:one.conceptId,version:1,status:'ready'}],
    concepts:[one],selectedConceptId:null};
  await client.refresh(sessionId);
  await client.vary(sessionId,one.conceptId);
  list={jobs:[{id:'job-one',conceptId:one.conceptId,version:1,status:'ready'},
    {id:'job-two',conceptId:two.conceptId,version:2,status:'ready'}],
    concepts:[one,two],selectedConceptId:null};
  await client.refresh(sessionId);
  await client.select(sessionId,two.conceptId,'smaller wings');
  assert.equal(client.selected.version,2);
  assert.equal(client.selected.designNotes,'smaller wings');
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/concepts/variation')[0][1],
    {sessionId,sourceConceptId:'concept-one'});
  assert.deepEqual(calls.filter(([path])=>path==='/api/agent/concepts/select')[0][1],
    {sessionId,conceptId:'concept-two',designNotes:'smaller wings'});
  list={...list,selectedConceptId:two.conceptId};
  await client.refresh(sessionId);
  assert.equal(client.selected.conceptId,two.conceptId);
});

test('late image result never changes an explicit selection',async()=>{
  let response={jobs:[],concepts:[one],selectedConceptId:one.conceptId};
  const client=new ConceptClient(async()=>response);
  await client.refresh(sessionId);
  response={jobs:[],concepts:[one,two],selectedConceptId:one.conceptId};
  await client.refresh(sessionId);
  assert.equal(client.selected.conceptId,one.conceptId);
});

test('unavailable service keeps last confirmed selection and reports failure',async()=>{
  let fail=false;
  const client=new ConceptClient(async()=>{
    if(fail)throw Error('ComfyUI unavailable');
    return {jobs:[],concepts:[one],selectedConceptId:one.conceptId};
  });
  await client.refresh(sessionId);fail=true;
  await assert.rejects(client.refresh(sessionId),/ComfyUI unavailable/);
  assert.equal(client.selected.conceptId,one.conceptId);
  assert.equal(client.error,'ComfyUI unavailable');
});

test('an explicit version lookup can join an in-flight status refresh',async()=>{
  let finish,calls=0;
  const client=new ConceptClient(async()=>{calls++;
    return new Promise(resolve=>{finish=resolve;});});
  const first=client.refresh(sessionId);
  const second=client.refresh(sessionId);
  assert.equal(calls,1);
  finish({jobs:[],concepts:[one,two],selectedConceptId:null});
  await Promise.all([first,second]);
  assert.equal(client.byVersion(2)?.conceptId,two.conceptId);
});

test('server-advertised image sources choose native by default and preserve an explicit fallback',async()=>{
  const calls=[];
  let providers=[{id:'codex-native',label:'Codex GPT Image',available:true},
    {id:'comfyui',label:'ComfyUI',available:true}];
  const client=new ConceptClient(async(path,body)=>{
    calls.push([path,body]);
    if(path.startsWith('/api/agent/concepts?'))return {
      jobs:[],concepts:[one],selectedConceptId:null,providers,defaultProviderId:'codex-native'};
    if(path==='/api/agent/concepts')return {job:{id:'job-one',conceptId:one.conceptId,
      version:1,status:'queued',providerId:body.providerId}};
    if(path==='/api/agent/concepts/variation')return {job:{id:'job-two',conceptId:two.conceptId,
      version:2,status:'queued',providerId:body.providerId}};
    throw Error('unexpected path');
  });
  await client.refresh(sessionId);
  assert.equal(client.providerForRequest(),'codex-native');
  await client.generate(sessionId,'forest temple',client.providerForRequest());
  assert.equal(calls.at(-1)[1].providerId,'codex-native');
  client.selectProvider('comfyui');
  await client.refresh(sessionId);
  assert.equal(client.providerForRequest(),'comfyui');
  await client.vary(sessionId,one.conceptId,undefined,client.providerForRequest());
  assert.equal(calls.at(-1)[1].providerId,'comfyui');
  providers=[{id:'codex-native',label:'Codex GPT Image',available:true},
    {id:'comfyui',label:'ComfyUI',available:false,reason:'Workflow is unavailable'}];
  await client.refresh(sessionId);
  assert.equal(client.providerForRequest(),'codex-native');
  assert.throws(()=>client.selectProvider('comfyui'),/unavailable/);
});

test('no server-advertised image source disables submissions',async()=>{
  const client=new ConceptClient(async()=>({jobs:[],concepts:[],selectedConceptId:null,
    providers:[{id:'codex-native',label:'Codex GPT Image',available:false}],defaultProviderId:null}));
  await client.refresh(sessionId);
  assert.throws(()=>client.providerForRequest(),/No image source/);
});

test('late concept POST responses cannot write into a different Agent session',async()=>{
  const nextSessionId='b'.repeat(32);
  const cases=[
    {path:'/api/agent/concepts',action:client=>client.generate(sessionId,'forest temple'),
      response:{job:{id:'old-generate',conceptId:one.conceptId,version:1,status:'queued'}}},
    {path:'/api/agent/concepts/variation',action:client=>client.vary(sessionId,one.conceptId),
      response:{job:{id:'old-variation',conceptId:two.conceptId,version:2,status:'queued'}}},
    {path:'/api/agent/concepts/select',action:client=>client.select(sessionId,one.conceptId),
      response:{selectedConceptId:one.conceptId,concept:one}},
    {path:'/api/agent/concepts/cancel',action:client=>client.cancel(sessionId,one.conceptId),
      response:{job:{id:'old-cancel',conceptId:one.conceptId,version:1,status:'cancelled'}}},
  ];
  for(const item of cases){
    let finish;
    const client=new ConceptClient(async(path)=>{
      if(path===item.path)return new Promise(resolve=>{finish=resolve;});
      if(path.includes(`sessionId=${sessionId}`))return {
        jobs:[{id:'old-job',conceptId:one.conceptId,version:1,status:'queued'}],
        concepts:[one],selectedConceptId:one.conceptId};
      if(path.includes(`sessionId=${nextSessionId}`))return {
        jobs:[],concepts:[],selectedConceptId:null};
      throw Error(`Unexpected path: ${path}`);
    });
    await client.refresh(sessionId);
    const oldRequest=item.action(client);
    await client.refresh(nextSessionId);
    finish(item.response);
    await oldRequest;
    assert.equal(client.sessionId,nextSessionId,item.path);
    assert.deepEqual(client.jobs,[],item.path);
    assert.deepEqual(client.concepts,[],item.path);
    assert.equal(client.selectedConceptId,null,item.path);
    assert.equal(client.error,'',item.path);
  }
});

test('late concept POST errors do not appear in a different Agent session',async()=>{
  const nextSessionId='b'.repeat(32);
  let fail;
  const client=new ConceptClient(async(path)=>{
    if(path==='/api/agent/concepts')return new Promise((resolve,reject)=>{fail=reject;});
    return {jobs:[],concepts:[],selectedConceptId:null};
  });
  const oldRequest=client.generate(sessionId,'forest temple');
  await client.refresh(nextSessionId);
  fail(Error('Old session failed'));
  await assert.rejects(oldRequest,/Old session failed/);
  assert.equal(client.sessionId,nextSessionId);
  assert.equal(client.error,'');
});
