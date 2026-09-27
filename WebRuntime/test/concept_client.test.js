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
