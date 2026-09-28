import test from 'node:test';
import assert from 'node:assert/strict';
import {ConceptUI} from '../src/concept_ui.js';

test('a concept UI action ignores a late result or error from another session',async()=>{
  const oldSession='a'.repeat(32),newSession='b'.repeat(32);
  let rendered=0,cleared=0;
  const ui={getSession:()=>newSession,notice:'Submitting old image',noticeError:true,
    client:{sessionId:oldSession,_session(id){this.sessionId=id;}},
    _clearPreviews:()=>{cleared++;},
    render:()=>{rendered++;}};
  const result=await ConceptUI.prototype._currentResult.call(ui,oldSession,
    Promise.resolve({job:{id:'old'}}));
  assert.equal(result,null);
  assert.equal(ui.notice,'');
  assert.equal(ui.noticeError,false);
  assert.equal(ui.client.sessionId,newSession);
  assert.equal(cleared,1);
  const lateFailure=await ConceptUI.prototype._currentResult.call(ui,oldSession,
    Promise.reject(Error('Old job failed')));
  assert.equal(lateFailure,null);
  assert.equal(rendered,2);
  await assert.rejects(ConceptUI.prototype._currentResult.call(
    {...ui,getSession:()=>oldSession},oldSession,Promise.reject(Error('Current job failed'))),
  /Current job failed/);
});

test('XR gallery exposes ready versions in order with only current validated preview URLs',()=>{
  const sessionId='a'.repeat(32),prompt='A'.repeat(250);
  const ui={getSession:()=>sessionId,
    client:{sessionId,selectedConceptId:'third',providers:[
      {id:'codex-native',label:'Codex GPT Image'},
      {id:'comfyui',label:'ComfyUI'}],concepts:[
      {conceptId:'third',version:3,status:'ready',prompt,providerId:'codex-native',
        previewUrl:'/api/agent/concepts/third/preview'},
      {conceptId:'pending',version:2,status:'generating',prompt:'Still generating'},
      {conceptId:'first',version:1,status:'ready',prompt:'First design',providerId:'comfyui',
        previewUrl:'/api/agent/concepts/first/preview'},
    ]},
    previews:new Map([
      ['third',{sessionId,serverUrl:'/api/agent/concepts/third/preview',
        objectUrl:'blob:https://matrix.test/third'}],
      ['first',{sessionId,serverUrl:'/api/agent/concepts/old/preview',
        objectUrl:'blob:https://matrix.test/old'}],
    ]),previewErrors:new Map(),_providerLabel:ConceptUI.prototype._providerLabel};
  assert.deepEqual(ConceptUI.prototype.galleryForWorld.call(ui),[
    {conceptId:'first',version:1,selected:false,prompt:'First design',
      sourceLabel:'ComfyUI',previewStatus:'loading'},
    {conceptId:'third',version:3,selected:true,prompt:'A'.repeat(240),
      sourceLabel:'Codex GPT Image',previewStatus:'ready',
      previewObjectUrl:'blob:https://matrix.test/third'},
  ]);
});

test('XR gallery reports preview errors and never exposes a prior session blob URL',()=>{
  const oldSession='a'.repeat(32),newSession='b'.repeat(32),conceptId='same';
  let currentSession=oldSession;
  const ui={getSession:()=>currentSession,
    client:{sessionId:oldSession,selectedConceptId:conceptId,providers:[],concepts:[
      {conceptId,version:1,status:'ready',prompt:'Temple',
        previewUrl:'/api/agent/concepts/same/preview'}]},
    previews:new Map([[conceptId,{sessionId:oldSession,
      serverUrl:'/api/agent/concepts/same/preview',objectUrl:'blob:https://matrix.test/old'}]]),
    previewErrors:new Map(),_providerLabel:ConceptUI.prototype._providerLabel};
  assert.equal(ConceptUI.prototype.galleryForWorld.call(ui)[0].previewStatus,'ready');
  currentSession=newSession;
  assert.deepEqual(ConceptUI.prototype.galleryForWorld.call(ui),[]);
  ui.client.sessionId=newSession;
  let gallery=ConceptUI.prototype.galleryForWorld.call(ui);
  assert.equal(gallery[0].previewStatus,'loading');
  assert.equal(Object.hasOwn(gallery[0],'previewObjectUrl'),false);
  ui.previewErrors.set(conceptId,'Preview HTTP 503');
  gallery=ConceptUI.prototype.galleryForWorld.call(ui);
  assert.equal(gallery[0].previewStatus,'error');
  assert.equal(Object.hasOwn(gallery[0],'previewObjectUrl'),false);
});

test('authenticated preview completion updates the XR gallery listener',async()=>{
  const sessionId='a'.repeat(32),conceptId='b'.repeat(32);
  const previewUrl=`/api/agent/concepts/${conceptId}/preview`;
  const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
  let requestOptions=null,notifications=0;
  globalThis.window={location:{href:'https://matrix.test/web/',origin:'https://matrix.test'}};
  globalThis.fetch=async(_url,options)=>{
    requestOptions=options;
    return {ok:true,blob:async()=>new Blob(['preview'],{type:'image/png'})};
  };
  const ui={client:{sessionId},getSession:()=>sessionId,getToken:()=>'test-token',loadingPreviews:new Set(),
    previews:new Map(),previewErrors:new Map(),render:()=>{},onChange:()=>{notifications++;}};
  try{
    const result=await ConceptUI.prototype._loadPreview.call(ui,{conceptId,previewUrl});
    assert.equal(result.status,'ready');
    assert.deepEqual(requestOptions,{headers:{Authorization:'Bearer test-token'},cache:'no-store'});
    assert.equal(ui.previews.get(conceptId).sessionId,sessionId);
    assert.equal(ui.previews.get(conceptId).serverUrl,previewUrl);
    assert.match(ui.previews.get(conceptId).objectUrl,/^blob:/);
    assert.equal(notifications,1);
  }finally{
    for(const preview of ui.previews.values())URL.revokeObjectURL(preview.objectUrl);
    if(previousWindow===undefined)delete globalThis.window;
    else globalThis.window=previousWindow;
    globalThis.fetch=previousFetch;
  }
});

test('XR preview retry uses the active ready version and rejects missing or stale versions',async()=>{
  const sessionId='a'.repeat(32),otherSession='b'.repeat(32),conceptId='c'.repeat(32);
  const previewUrl=`/api/agent/concepts/${conceptId}/preview`;
  const concept={conceptId,version:4,status:'ready',prompt:'Garden',previewUrl};
  let currentSession=sessionId,loads=0;
  const ui={getSession:()=>currentSession,_session:async()=>sessionId,
    _currentResult:async(_session,pending)=>pending,
    client:{sessionId,selectedConceptId:conceptId,concepts:[concept],providers:[],
      refresh:async()=>{},byVersion:version=>version===4?concept:null},
    previews:new Map(),previewErrors:new Map([[conceptId,'Preview HTTP 503']]),
    _providerLabel:ConceptUI.prototype._providerLabel,
    galleryForWorld:ConceptUI.prototype.galleryForWorld,
    async _loadPreview(found){
      loads++;assert.equal(found,concept);
      assert.equal(this.previewErrors.has(conceptId),false);
      this.previews.set(conceptId,{sessionId,serverUrl:previewUrl,
        objectUrl:'blob:https://matrix.test/retried'});
      return {status:'ready'};
    }};
  assert.deepEqual(await ConceptUI.prototype.retryPreviewVersion.call(ui,4),
    {conceptId,version:4,selected:true,prompt:'Garden',sourceLabel:'',
      previewStatus:'ready',previewObjectUrl:'blob:https://matrix.test/retried'});
  assert.equal(loads,1);
  await assert.rejects(ConceptUI.prototype.retryPreviewVersion.call(ui,5),
    /Version 5 is unavailable or not ready/);
  await assert.rejects(ConceptUI.prototype.retryPreviewVersion.call(ui,4.5),
    /Invalid concept version/);
  currentSession=otherSession;
  await assert.rejects(ConceptUI.prototype.retryPreviewVersion.call(ui,4),
    /Codex session changed/);
  assert.equal(loads,1);
});

test('selected-design build uses the refreshed concept identity and requires a ready selection',async()=>{
  const sessionId='a'.repeat(32),oldId='b'.repeat(32),selectedId='c'.repeat(32);
  let refreshes=0;
  const ui={_session:async()=>sessionId,getSession:()=>sessionId,
    client:{selected:{conceptId:oldId,version:1},async refresh(){
      refreshes++;this.selected={conceptId:selectedId,version:2};
    }}};
  const expected=await ConceptUI.prototype.expectedBuild.call(ui,'Build this in the Matrix');
  assert.deepEqual(expected,{conceptId:selectedId,version:2});
  assert.equal(refreshes,1);
  assert.equal(await ConceptUI.prototype.expectedBuild.call(ui,'Build this bridge'),null);
  assert.equal(refreshes,1);
  ui.client.refresh=async()=>{ui.client.selected=null;};
  await assert.rejects(ConceptUI.prototype.expectedBuild.call(ui,'Build the selected design'),
    /Select a ready concept version/);
});

test('terminal build without a receipt reports an unverified world result',()=>{
  const ui={client:{builds:[{status:'failed',conceptId:'a'}],concepts:[
    {conceptId:'a',version:4}]}};
  assert.match(ConceptUI.prototype.buildStatus.call(ui),
    /No verified Matrix result from Version 4\. Inspect the world and receipts before retrying\./);
});
