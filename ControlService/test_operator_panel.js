// Dependency-free panel interaction regressions. Network responses are fixtures;
// this is not browser, headset microphone, or live-model evidence.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const elements=new Map();
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this._value='';this.disabled=false;this.hidden=false;this.checked=false;this.textContent='';}
  set id(value){this._id=value;elements.set(value,this);} get id(){return this._id;}
  set value(value){this._value=value??'';} get value(){return this._value;}
  set src(value){this._src=value;if(this.onload)this.onload();} get src(){return this._src;}
  get options(){return this.children;}
  append(...values){this.children.push(...values);}
  replaceChildren(...values){this.children=[...values];}
  setAttribute(){} scrollIntoView(){}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(selector==='input'&&child.tag==='input'?[child]:[]),...child.querySelectorAll(selector)]);}
}
for(const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)){const element=new Element(match[1]);element.id=match[2];}
for(const mode of ['offline-rules','openai-compatible','codex-cli']){const option=new Element('option');option.value=mode;elements.get('mode').append(option);}
const info={mode:'codex-cli',provider:'Codex CLI',configured:true,model:null,supportsImages:false,imageSupportReason:'Select a confirmed image-capable model.',availableModes:['codex-cli','offline-rules'],
  codexPreferences:{model:null,reasoningEffort:null},codexOptions:{models:[
    {id:'model-a',displayName:'Model A',supportsImages:true,reasoningEfforts:['low','medium','high'],defaultReasoningEffort:'medium'},
    {id:'model-b',displayName:'Model B',supportsImages:false,imageSupportReason:'Model B accepts text only.',reasoningEfforts:['low'],defaultReasoningEffort:'low'}]}};
const ready={mode:'codex-cli',provider:'Codex CLI',status:'ready',phase:'ready',planId:'voice-plan',requiresApply:true,
  commands:[{op:'duplicate',objectId:'chair-1'}],summary:'Duplicate the selected chair.',transcript:'Copy this chair',assumptions:[]};
const calls=[];let rejectPreferences=false,rejectCapturedPlan=false,rejectPreview=false;
let capture={supported:true,status:'none',voiceCaptureId:null};
const screenshot={captureId:'capture-1',capturedAtUtc:'2026-09-21T18:00:00Z',content:'virtual_scene'};
const captureReady={...capture,...screenshot,status:'ready',width:640,height:360,ageSeconds:2,captureDurationMs:14.012800000000001};
const pageHeading=new Element('h1');
const context=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),querySelector:selector=>selector==='h1'?pageHeading:null,querySelectorAll:()=>[]},
  console,Map,JSON,Number,Date,Error,URLSearchParams,location:{search:'?prefab=fixture%3Abeacon'},setInterval:()=>0,clearInterval:()=>{},fetch:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):undefined;calls.push({url,body,headers:options.headers});
    if(url==='/api/planner')return {ok:true,json:async()=>structuredClone(info)};
    if(url==='/api/state')return {ok:true,json:async()=>({online:true,pendingCount:0,snapshot:{scene:{roomId:'white-room-v1',objects:[]},assets:[],anchors:[]},voice:null,capture:structuredClone(capture)})};
    if(url==='/api/scenes')return {ok:true,json:async()=>({scenes:[]})};
    if(url==='/api/planner_preferences')return {ok:!rejectPreferences,json:async()=>rejectPreferences?{error:'Unsupported model'}:{codex:body.codex}};
    if(url==='/api/capture'){
      if(body!==undefined){capture={supported:true,status:'pending',voiceCaptureId:null};return {ok:true,json:async()=>structuredClone(capture)};}
      return {ok:!rejectPreview,json:async()=>rejectPreview?{error:'Preview authorization failed'}:{...structuredClone(capture),imageDataUrl:'data:image/png;base64,cHJldmlldw=='}};
    }
    if(url==='/api/capture/voice'){capture.voiceCaptureId=body.captureId;return {ok:true,json:async()=>structuredClone(capture)};}
    if(url==='/api/plan')return {ok:!(rejectCapturedPlan&&body.captureId),json:async()=>rejectCapturedPlan&&body.captureId?{error:'Capture is stale. Capture a fresh view.'}:{...structuredClone(ready),...(body.captureId?{screenshot:{...screenshot,captureId:body.captureId}}:{})}};
    throw Error('Unexpected request: '+url);
  }});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const element=id=>elements.get(id);
async function run(){
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);await tick();await tick();
  assert.equal(element('codexSettings').hidden,false);
  assert.equal(element('codexReasoning').disabled,true,'Unknown CLI default must not invent supported reasoning');
  assert.equal(element('includeCapture').checked,false,'Image inclusion starts unchecked');
  assert.equal(calls.some(call=>call.url==='/api/capture'),false,'Polling state never requests a capture automatically');
  assert.match(element('prefabSelectionStatus').textContent,/not available/,'Unknown handoff IDs cannot become available props');
  assert.equal(element('prompt').value,'','Unknown prefab does not populate a request');
  context.testPrefab={assetId:'fixture:beacon',displayName:'Fixture Beacon'};
  vm.runInContext('latest.snapshot.assets=[testPrefab];latest.online=false;applyPrefabSelection()',context);
  assert.match(element('prefabSelectionStatus').textContent,/Reconnect/);
  assert.equal(element('prompt').value,'','Retained offline catalog cannot populate a request');
  element('prompt').value='Keep my existing request';
  vm.runInContext("latest.online=true;options('asset',latest.snapshot.assets,'assetId');applyPrefabSelection()",context);
  assert.equal(element('asset').value,'fixture:beacon');
  assert.equal(element('prompt').value,'Keep my existing request','Choosing a prefab preserves user-entered text');
  element('prompt').value='';
  vm.runInContext('prefabSelectionApplied=false;busy=true;applyPrefabSelection()',context);
  assert.equal(element('prompt').value,'','Handoff waits for an active request to finish');
  vm.runInContext('busy=false;applyPrefabSelection()',context);
  assert.match(element('prompt').value,/Fixture Beacon.*fixture:beacon/);
  assert.match(element('prefabSelectionStatus').textContent,/Nothing has been placed/);
  element('asset').value='another-prop';element('prompt').value='A later edit';
  vm.runInContext('applyPrefabSelection()',context);
  assert.equal(element('asset').value,'another-prop','Polling never overwrites a later selection');
  assert.equal(element('prompt').value,'A later edit');
  vm.runInContext('prefabSelectionApplied=false;latest.online=false;applyPrefabSelection()',context);
  element('asset').value='manually-chosen-prop';element('asset').onchange();
  vm.runInContext('latest.online=true;applyPrefabSelection()',context);
  assert.equal(element('asset').value,'manually-chosen-prop','A manual choice while a handoff is deferred survives reconnection');
  assert.equal(element('prefabSelectionStatus').hidden,true);
  assert.equal(calls.some(call=>['/api/plan','/api/apply_plan','/api/command'].includes(call.url)),false,'Prefab handoff never invokes AI or mutates a scene');
  element('prompt').value='';
  assert.match(element('captureSupport').textContent,/confirmed image-capable/);
  element('codexModel').value='model-a';element('codexModel').onchange();await tick();
  assert.equal(element('codexReasoning').disabled,false);
  assert.deepEqual(element('codexReasoning').options.map(option=>option.value),['','low','medium','high']);
  element('codexReasoning').value='high';await element('codexReasoning').onchange();
  assert.deepEqual(calls.filter(call=>call.url==='/api/planner_preferences').at(-1).body,
                   {codex:{model:'model-a',reasoningEffort:'high'}});
  element('codexModel').value='model-b';element('codexModel').onchange();await tick();
  assert.equal(element('codexReasoning').value,'','Switching model clears incompatible reasoning');
  assert.deepEqual(element('codexReasoning').options.map(option=>option.value),['','low']);
  assert.equal(calls.some(call=>call.url==='/api/apply_plan'||call.url==='/api/command'),false,'Changing preferences cannot edit the runtime');
  rejectPreferences=true;element('codexModel').value='model-a';element('codexModel').onchange();await tick();
  assert.equal(element('codexModel').value,'model-b','Rejected preference restores confirmed settings');
  assert.match(element('codexSettingsStatus').textContent,/not changed/);rejectPreferences=false;
  element('prompt').value='Make another chair';await element('plan').onclick();
  assert.deepEqual(calls.find(call=>call.url==='/api/plan').body,
                   {text:'Make another chair',mode:'codex-cli',codex:{model:'model-b',reasoningEffort:null}});
  context.testVoice=ready;vm.runInContext('latest.voice=testVoice;renderVoice(latest.voice);controls();',context);
  assert.equal(element('reviewVoice').disabled,false);assert.match(element('voiceTranscript').textContent,/Copy this chair/);
  element('reviewVoice').onclick();assert.equal(element('proposalSummary').textContent,ready.summary);
  assert.equal(element('apply').disabled,false,'Review uses existing Apply gate');
  vm.runInContext("latest.voice.phase='applied';renderVoice(latest.voice);controls();",context);
  assert.equal(element('reviewVoice').disabled,true);

  element('codexModel').value='model-a';element('codexModel').onchange();await tick();
  element('token').value='panel-test-token';
  await element('captureScene').onclick();
  assert.equal(element('captureScene').disabled,true,'A pending capture cannot be requested twice');
  assert.equal(element('includeCapture').disabled,true);
  assert.match(element('captureStatus').textContent,/Capturing/);
  assert.equal(calls.filter(call=>call.url==='/api/capture'&&call.body===undefined).length,0,'Pending captures do not download an image');
  capture=structuredClone(captureReady);await vm.runInContext('refresh()',context);
  assert.equal(element('capturePreview').hidden,false);
  assert.equal(element('includeCapture').checked,false,'A completed capture never opts in automatically');
  assert.equal(element('includeCapture').disabled,false);
  assert.match(element('captureDetails').textContent,/640 × 360.*2 seconds old.*14 ms.*no physical passthrough/);
  const previewCalls=()=>calls.filter(call=>call.url==='/api/capture'&&call.body===undefined);
  assert.equal(previewCalls().at(-1).headers.Authorization,'Bearer panel-test-token','Image fetch uses the existing authenticated API helper');
  capture.ageSeconds=3;await vm.runInContext('refresh()',context);
  assert.equal(previewCalls().length,1,'State polling does not repeatedly download the same preview');
  await element('plan').onclick();
  assert.equal(calls.filter(call=>call.url==='/api/plan').at(-1).body.captureId,undefined);
  assert.match(element('proposalScreenshot').textContent,/No image included/);
  element('includeCapture').checked=true;element('includeCapture').onchange();
  await element('plan').onclick();
  assert.equal(calls.filter(call=>call.url==='/api/plan').at(-1).body.captureId,'capture-1');
  assert.match(element('proposalScreenshot').textContent,/Image included.*2026-09-21/);
  assert.equal(JSON.parse(element('proposal').textContent).screenshot.captureId,'capture-1');
  capture.status='stale';await vm.runInContext('refresh()',context);
  assert.equal(element('apply').disabled,false,'Preview expiry does not invalidate an already reviewed server proposal');
  capture.status='ready';await vm.runInContext('refresh()',context);
  rejectCapturedPlan=true;const beforeRejectedPlan=calls.filter(call=>call.url==='/api/plan').length;
  await element('plan').onclick();
  assert.equal(calls.filter(call=>call.url==='/api/plan').length,beforeRejectedPlan+1,'Rejected images do not retry silently as text');
  assert.match(element('proposalState').textContent,/No proposal created.*stale/);rejectCapturedPlan=false;
  capture.status='stale';await vm.runInContext('refresh()',context);
  assert.equal(element('capturePreview').hidden,false,'A stale preview remains visible for review');
  assert.equal(element('plan').disabled,true,'Stale image inclusion blocks planning');
  assert.equal(element('includeCapture').disabled,false,'A stale selection can still be unchecked');
  const beforeStalePlan=calls.filter(call=>call.url==='/api/plan').length;await element('plan').onclick();
  assert.equal(calls.filter(call=>call.url==='/api/plan').length,beforeStalePlan,'The click handler also rejects stale image requests');
  element('includeCapture').checked=false;element('includeCapture').onchange();await element('plan').onclick();
  assert.equal(calls.filter(call=>call.url==='/api/plan').at(-1).body.captureId,undefined,'Unchecking explicitly restores text-only requests');

  capture=structuredClone(captureReady);await vm.runInContext('refresh()',context);
  element('includeCapture').checked=true;element('includeCapture').onchange();
  capture.captureId='capture-2';await vm.runInContext('refresh()',context);
  assert.equal(element('includeCapture').checked,false,'Replacing the preview clears previous consent');
  await element('voiceCapture').onclick();
  assert.deepEqual(calls.filter(call=>call.url==='/api/capture/voice').at(-1).body,{captureId:'capture-2'});
  assert.match(element('voiceCaptureStatus').textContent,/next headset voice request only/);
  assert.equal(element('includeCapture').checked,false,'Voice opt-in never changes typed opt-in');
  await element('voiceCapture').onclick();
  assert.deepEqual(calls.filter(call=>call.url==='/api/capture/voice').at(-1).body,{captureId:null});
  context.testVoice={...ready,phase:'ready',screenshot};vm.runInContext('latest.voice=testVoice;renderVoice(latest.voice);controls();',context);
  assert.match(element('voiceScreenshot').textContent,/Image included/);
  element('reviewVoice').onclick();assert.match(element('proposalScreenshot').textContent,/Image included/);
  context.imageReview={mode:'codex-cli',status:'review_only',phase:'review_only',requiresApply:false,commands:[],summary:'The chair is partly hidden behind the table.',screenshot};
  vm.runInContext('showProposal(imageReview);controls();',context);
  assert.equal(element('proposalSummary').textContent,context.imageReview.summary);
  assert.equal(element('proposalState').textContent,'Image review complete — no changes proposed.');
  assert.equal(element('apply').disabled,true,'Image observations never become executable proposals');
  vm.runInContext('latest.voice=imageReview;renderVoice(latest.voice);controls();',context);
  assert.equal(element('reviewVoice').disabled,false,'A voice image assessment remains readable without an Apply action');
  assert.match(element('voiceStatus').textContent,/Image review complete/);
  element('reviewVoice').onclick();assert.equal(element('proposalSummary').textContent,context.imageReview.summary);
  assert.equal(element('apply').disabled,true);
  context.clarification={mode:'codex-cli',status:'needs_clarification',requiresApply:false,commands:[],summary:'Which chair do you mean?'};
  vm.runInContext('showProposal(clarification);controls();',context);
  assert.match(element('proposalState').textContent,/More detail needed/,'Text-only clarification wording remains unchanged');
  element('codexModel').value='model-b';element('codexModel').onchange();await tick();
  assert.equal(element('includeCapture').disabled,true);
  assert.equal(element('voiceCapture').disabled,true);
  assert.match(element('captureSupport').textContent,/Model B accepts text only/);
  element('codexModel').value='model-a';element('codexModel').onchange();await tick();
  rejectPreview=true;capture.captureId='capture-3';await vm.runInContext('refresh()',context);
  assert.equal(element('capturePreview').hidden,true);
  assert.equal(element('includeCapture').disabled,true,'A failed preview fetch cannot be included');
  assert.match(element('captureStatus').textContent,/authorization failed/);rejectPreview=false;
  capture={supported:true,status:'error',error:'Headset capture timed out.'};await vm.runInContext('refresh()',context);
  assert.match(element('captureStatus').textContent,/Capture failed.*timed out/);
  assert.equal(element('captureScene').disabled,false,'Capture failures allow a retry');
  element('mode').value='offline-rules';element('mode').onchange();
  assert.equal(element('codexSettings').hidden,true);assert.equal(element('apply').disabled,true);
  capture=structuredClone(captureReady);await vm.runInContext('refresh()',context);
  assert.equal(element('includeCapture').disabled,true,'Offline typed requests cannot opt in to an image');
  assert.equal(element('voiceCapture').disabled,false,'Headset voice uses the saved Codex model even when typed mode is offline');
  vm.runInContext('renderBehaviors()',context);
  assert.match(element('behaviorStatus').textContent,/needs the behavior update/);
  context.behaviorObject={objectId:'orb-1',assetId:'orb',behaviors:[
    {kind:'rotate',axis:'y',speedDegreesPerSecond:20,enabled:true,paused:false},
    {kind:'bob',amplitudeMeters:.05,frequencyHz:.5,enabled:true,paused:true}]};
  element('object').value='orb-1';
  vm.runInContext("latest.snapshot.behaviorKinds=['rotate','bob'];latest.snapshot.scene.objects=[behaviorObject];renderBehaviors();",context);
  assert.match(element('behaviorStatus').textContent,/Rotate Y.*20.*running/);
  assert.match(element('behaviorStatus').textContent,/Bob.*5 cm.*paused/);
  vm.runInContext('behaviorObject.behaviors=[];renderBehaviors()',context);
  assert.match(element('behaviorStatus').textContent,/No animations/);
  info.mode='openai-compatible';info.model='model-a';info.availableModes=['openai-compatible','offline-rules'];info.supportsImages=true;
  await vm.runInContext('plannerStatus()',context);
  capture=structuredClone(captureReady);await vm.runInContext('refresh()',context);
  assert.equal(element('includeCapture').disabled,false,'The configured API provider can still receive explicitly selected images');
  assert.equal(element('voiceCapture').disabled,true,'A matching local Codex model does not configure headset voice for an API provider');
  assert.match(element('voiceCaptureStatus').textContent,/Codex is not configured/);
  element('mode').value='offline-rules';element('mode').onchange();
  assert.equal(element('voiceCapture').disabled,true,'Offline typed mode does not enable an unconfigured Codex voice provider');
  console.log('Operator panel interaction checks passed (prefab handoff, model/effort validation, capture privacy and preview auth, explicit text/voice opt-in, stale/unsupported/error gates, no image fallback, proposal metadata, Apply gate, behavior state).');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
