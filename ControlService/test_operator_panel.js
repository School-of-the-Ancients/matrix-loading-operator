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
  querySelector(selector){const match=/^option\[value="([^"]+)"\]$/.exec(selector);
    return match?this.children.find(child=>child.tag==='option'&&child.value===match[1])||null:null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(selector==='input'&&child.tag==='input'?[child]:[]),...child.querySelectorAll(selector)]);}
}
for(const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)){const element=new Element(match[1]);element.id=match[2];}
for(const mode of ['offline-rules','openai-compatible','codex-cli']){const option=new Element('option');option.value=mode;elements.get('mode').append(option);}
for(const mode of ['virtual','mixed']){const option=new Element('option');option.value=mode;elements.get('captureMode').append(option);}
const info={mode:'codex-cli',provider:'Codex CLI',configured:true,model:null,supportsImages:false,imageSupportReason:'Select a confirmed image-capable model.',availableModes:['codex-cli','offline-rules'],
  codexPreferences:{model:null,reasoningEffort:null},codexOptions:{models:[
    {id:'model-a',displayName:'Model A',supportsImages:true,reasoningEfforts:['low','medium','high'],defaultReasoningEffort:'medium'},
    {id:'model-b',displayName:'Model B',supportsImages:false,imageSupportReason:'Model B accepts text only.',reasoningEfforts:['low'],defaultReasoningEffort:'low'}]}};
const ready={mode:'codex-cli',provider:'Codex CLI',status:'ready',phase:'ready',planId:'voice-plan',requiresApply:true,
  commands:[{op:'duplicate',objectId:'chair-1'}],summary:'Duplicate the selected chair.',transcript:'Copy this chair',assumptions:[]};
const calls=[];let rejectPreferences=false,rejectCapturedPlan=false,rejectPreview=false;
let runtimeOnline=true,stateError=null,reconnectReply={status:'needs_attention',message:'Keep Matrix open.'},reconnectHttpStatus=200,reconnectFailure=null,reconnectHold=null;
let now=Date.parse('2026-09-22T12:00:00Z');
class Clock extends Date {static now(){return now;}}
const timers=new Map(),hungPaths=new Set(),abortedPaths=[];let timerId=0;
const schedule=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,at:now+delay});return id;};
const cancel=id=>timers.delete(id);
const pollers=[],navigations=[],pageUrl='http://127.0.0.1:8789/?prefab=fixture%3Abeacon';
const location={host:'127.0.0.1:8789',search:'?prefab=fixture%3Abeacon',assign:value=>navigations.push(value),replace:value=>navigations.push(value)};
Object.defineProperty(location,'href',{get:()=>pageUrl,set:value=>navigations.push(value)});
let capture={supported:true,status:'none',voiceCaptureId:null},stateRevision=1,stateResults=[],autoReadyCapture=false,recommendCandidates=[],installedAssetIds=[],contentJobs=[];
const screenshot={captureId:'capture-1',capturedAtUtc:'2026-09-21T18:00:00Z',content:'virtual_scene'};
const captureReady={...capture,...screenshot,status:'ready',width:640,height:360,ageSeconds:2,captureDurationMs:14.012800000000001};
const pageHeading=new Element('h1');
const context=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),querySelector:selector=>selector==='h1'?pageHeading:null,querySelectorAll:()=>[]},
  console,Map,JSON,Number,Date:Clock,Error,URL,URLSearchParams,AbortController,location,setTimeout:schedule,clearTimeout:cancel,setInterval:callback=>{pollers.push(callback);return pollers.length;},clearInterval:()=>{},fetch:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):undefined;calls.push({url,method:options.method,body,headers:{...options.headers}});
    if(hungPaths.has(url))return new Promise((resolve,reject)=>{
      assert.ok(options.signal,'Hung connection requests must have a cancellation signal');
      options.signal.addEventListener('abort',()=>{abortedPaths.push(url);const error=Error('Aborted');error.name='AbortError';reject(error);},{once:true});
    });
    if(url==='/api/planner')return {ok:true,json:async()=>structuredClone(info)};
    if(url==='/api/state')return stateError?{ok:false,status:stateError.status,json:async()=>({error:stateError.message})}:{ok:true,json:async()=>({online:runtimeOnline,clientId:runtimeOnline?'runtime-session':null,revision:stateRevision,pendingCount:0,results:structuredClone(stateResults),snapshot:{scene:{roomId:'white-room-v1',objects:[]},assets:installedAssetIds.map(assetId=>({assetId,displayName:'Armchair'})),anchors:[]},voice:null,capture:structuredClone(capture)})};
    if(url==='/api/runtime/reconnect'){
      if(reconnectHold)await reconnectHold;
      if(reconnectFailure)throw Error(reconnectFailure);
      return {ok:reconnectHttpStatus>=200&&reconnectHttpStatus<300,status:reconnectHttpStatus,json:async()=>structuredClone(reconnectReply)};
    }
    if(url==='/api/scenes')return {ok:true,json:async()=>({scenes:[]})};
    if(url==='/api/content/recommend')return {ok:true,json:async()=>({candidates:structuredClone(recommendCandidates)})};
    if(url==='/api/content/install'){installedAssetIds=body.assetId==='chair-pack'?['polyhaven:chair-pack:v1:model']:[];contentJobs=[{requestId:'install-1',phase:'ready',assetIds:installedAssetIds}];return {ok:true,json:async()=>({requestId:'install-1',phase:'preparing'})};}
    if(url==='/api/content')return {ok:true,json:async()=>({jobs:structuredClone(contentJobs)})};
    if(url==='/api/planner_preferences')return {ok:!rejectPreferences,json:async()=>rejectPreferences?{error:'Unsupported model'}:{codex:body.codex}};
    if(url==='/api/capture'){
      if(body!==undefined){capture=autoReadyCapture?structuredClone(captureReady):{supported:true,status:'pending',voiceCaptureId:null};return {ok:true,json:async()=>structuredClone(capture)};}
      return {ok:!rejectPreview,json:async()=>rejectPreview?{error:'Preview authorization failed'}:{...structuredClone(capture),imageDataUrl:'data:image/png;base64,cHJldmlldw=='}};
    }
    if(url==='/api/capture/voice'){capture.voiceCaptureId=body.captureId;return {ok:true,json:async()=>structuredClone(capture)};}
    if(url==='/api/plan')return {ok:!(rejectCapturedPlan&&body.captureId),json:async()=>rejectCapturedPlan&&body.captureId?{error:'Capture is stale. Capture a fresh view.'}:body.text?.startsWith('Find a better prefab for')?{mode:body.mode,status:'review_only',requiresApply:false,commands:[],summary:'The applied result is visible.',screenshot:{...screenshot,captureId:body.captureId}}:{...structuredClone(ready),...(body.captureId?{screenshot:{...screenshot,captureId:body.captureId}}:{})}};
    throw Error('Unexpected request: '+url);
  }});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const element=id=>elements.get(id);
async function advance(ms){
  const end=now+ms;
  for(;;){const due=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].callback();await tick();}
  now=end;await tick();
}
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
  recommendCandidates=[{providerId:'polyhaven',assetId:'chair-pack',version:'v1',targetPlatform:'Android',title:'Armchair',
    prefabAssetIds:['polyhaven:chair-pack:v1:model'],installed:false}];
  element('prompt').value='Summon an armchair';const installsBefore=calls.filter(call=>call.url==='/api/content/install').length;
  await element('plan').onclick();
  assert.equal(calls.filter(call=>call.url==='/api/content/install').length,installsBefore+1,'A matching local pack installs before the placement proposal');
  assert.equal(calls.filter(call=>call.url==='/api/plan').at(-1).body.text,'Summon an armchair');
  assert.equal(calls.filter(call=>call.url==='/api/apply_plan').length,0,'Automatic pack installation does not bypass reviewed scene Apply');
  recommendCandidates=[];installedAssetIds=[];contentJobs=[];
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
  assert.match(element('captureDetails').textContent,/640 × 360.*2 seconds old.*14 ms.*no physical camera image/);
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
  autoReadyCapture=true;stateRevision=2;stateResults=[{requestId:'applied-1',ok:true,objectId:'placed-chair-1'}];
  vm.runInContext("awaitedIds=['applied-1'];awaitedProposal=true;reviewedRequest='Place a comfortable armchair'",context);
  await vm.runInContext('refresh()',context);
  assert.equal(element('reviewResult').disabled,false,'Confirmed proposal offers a visual review');
  const beforeReviewApply=calls.filter(call=>call.url==='/api/apply_plan').length;
  await element('reviewResult').onclick();
  const visualReview=calls.filter(call=>call.url==='/api/plan').at(-1);
  assert.equal(visualReview.body.captureId,'capture-1','The visual review attaches the captured result');
  assert.match(visualReview.body.text,/Place a comfortable armchair/);
  assert.match(visualReview.body.text,/placed-chair-1/);
  assert.match(visualReview.body.text,/search the supplied content catalog for a better prefab/);
  assert.equal(element('apply').disabled,true,'Image inspection alone has no Apply action');
  assert.equal(calls.filter(call=>call.url==='/api/apply_plan').length,beforeReviewApply,'Visual review never applies another edit');
  stateRevision=3;await vm.runInContext('refresh()',context);
  assert.equal(element('reviewResult').disabled,true,'A later scene revision invalidates the old result');
  element('autoReview').checked=true;stateRevision=4;stateResults=[{requestId:'auto-applied',ok:true,objectId:'auto-chair'}];
  vm.runInContext("awaitedIds=['auto-applied'];awaitedProposal=true;reviewedRequest='Place a comfortable armchair'",context);
  const beforeAutoPlans=calls.filter(call=>call.url==='/api/plan').length;
  await vm.runInContext('refresh()',context);for(let i=0;i<12;i++)await tick();
  assert.equal(calls.filter(call=>call.url==='/api/plan').length,beforeAutoPlans+1,'Virtual result review starts after confirmed Apply');
  assert.equal(calls.filter(call=>call.url==='/api/apply_plan').length,beforeReviewApply,'Automatic review never applies its own proposal');
  element('autoReview').checked=false;
  stateRevision=5;stateResults=[{requestId:'failed-1',ok:false,error:'Prefab missing'}];
  vm.runInContext("awaitedIds=['failed-1'];awaitedProposal=true",context);
  await vm.runInContext('refresh()',context);
  assert.equal(element('reviewResult').disabled,true,'A failed Apply is not eligible for result review');
  autoReadyCapture=false;stateResults=[];
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
  await reconnectChecks();
  await reconnectTimeoutChecks();
  console.log('Operator panel interaction checks passed (prefab handoff, model/effort validation, capture privacy and preview auth, explicit text/voice opt-in, stale/unsupported/error gates, no image fallback, proposal metadata, Apply gate, behavior state, explicit Quest reconnect, bounded heartbeat wait, safe Operator links).');
}

async function reconnectChecks(){
  const reconnectCalls=()=>calls.filter(call=>call.url==='/api/runtime/reconnect');
  const poll=async()=>{for(const callback of pollers)await callback();};
  assert.equal(reconnectCalls().length,0,'Page startup and ordinary requests never invoke USB reconnection');
  assert.equal(element('operatorAddress').textContent,'This Operator: 127.0.0.1:8789','The visible address identifies this service port');
  assert.equal(element('reconnectQuest').disabled,true,'A confirmed online runtime needs no reconnect');
  assert.match(html,/<button id="connect">Apply token<\/button>/,'Applying a token is not presented as connecting the Quest');
  const libraryRow=html.split('\n').find(line=>line.includes('id="reconnectQuest"'));
  assert.match(libraryRow,/<a\b(?=[^>]*href="\/content#prefabBrowser")(?![^>]*\bhidden\b)(?![^>]*\bid=)[^>]*>Content library<\/a>/,'The top-row library link is always visible without waiting for contentLibrary capability polling');
  runtimeOnline=false;capture={supported:true,status:'none',voiceCaptureId:null};element('includeCapture').checked=false;
  await poll();await poll();await element('connect').onclick();
  assert.equal(reconnectCalls().length,0,'Polling and Apply token cannot automatically run ADB');
  assert.equal(element('reconnectQuest').disabled,false);
  assert.equal(element('save').disabled,true,'Retained offline scene state cannot enable editing');

  element('token').value='reconnect-test-token';
  reconnectReply={status:'forwarded',message:'USB forwarding restored. Waiting for Matrix.'};
  let release;reconnectHold=new Promise(resolve=>{release=resolve;});
  const attempt=element('reconnectQuest').onclick();
  assert.equal(element('reconnectQuest').disabled,true,'Disable reconnect before its network response');
  assert.match(element('reconnectQuest').textContent,/Checking/);
  await element('reconnectQuest').onclick();await poll();
  assert.equal(reconnectCalls().length,1,'Repeated clicks and polling cannot start duplicate reconnect requests');
  assert.deepEqual(reconnectCalls()[0],{url:'/api/runtime/reconnect',method:'POST',body:{},headers:{Authorization:'Bearer reconnect-test-token','Content-Type':'application/json'}},'Reconnect sends an empty JSON body through the existing authenticated API helper');
  release();await attempt;await tick();reconnectHold=null;
  assert.match(element('status').textContent,/Runtime offline/,'Successful forwarding is not a runtime heartbeat');
  assert.equal(element('save').disabled,true);
  assert.equal(element('reconnectQuest').disabled,true,'Forwarding success waits for state polling');
  assert.match(element('reconnectQuest').textContent,/Waiting/);
  await element('reconnectQuest').onclick();await poll();
  assert.equal(reconnectCalls().length,1,'The heartbeat wait never repeats ADB automatically');
  now+=14999;await poll();
  assert.equal(element('reconnectQuest').disabled,true,'Keep the pending state until the bounded wait expires');
  now+=1;await poll();
  assert.equal(element('reconnectQuest').disabled,false,'A missing heartbeat offers an explicit retry after 15 seconds');
  assert.match(element('reconnectStatus').textContent,/has not checked in.*try again/);
  assert.equal(reconnectCalls().length,1,'Timeout is not an automatic reconnect attempt');

  reconnectReply={status:'online',message:'Runtime was online when checked.'};
  await element('reconnectQuest').onclick();await tick();
  assert.match(element('status').textContent,/Runtime offline/,'Even an online POST result must be confirmed by fresh state');
  assert.equal(element('save').disabled,true);
  runtimeOnline=true;await poll();
  assert.match(element('status').textContent,/CONNECTED/);
  assert.equal(element('reconnectStatus').textContent,'Matrix is connected to this Operator.');
  assert.equal(element('reconnectQuest').disabled,true);
  assert.equal(element('reconnectHelp').hidden,true);
  assert.equal(element('save').disabled,false,'A fresh heartbeat restores normal controls');
  assert.equal(element('plan').disabled,false);
  const afterConnected=reconnectCalls().length;
  await element('reconnectQuest').onclick();await poll();
  assert.equal(reconnectCalls().length,afterConnected,'The connected page cannot launch redundant reconnects');

  runtimeOnline=false;await poll();
  for(const operatorUrl of ['http://127.0.0.1:8776/','http://localhost:8776/','http://[::1]:8776/']){
    reconnectReply={status:'other_service',message:'Matrix is configured for another Operator.',operatorUrl};
    await element('reconnectQuest').onclick();
    assert.equal(element('matchingOperator').hidden,false,'Show an explicit link to the matching local service');
    assert.equal(element('matchingOperator').href,operatorUrl);
    assert.match(element('matchingOperator').textContent,/port 8776/);
    assert.equal(element('reconnectQuest').disabled,false);
  }
  assert.equal(location.href,pageUrl);
  assert.deepEqual(navigations,[],'Wrong-port discovery does not automatically navigate away from this Operator');
  const unsafeUrls=['https://127.0.0.1:8776/','http://example.com:8776/','http://127.0.0.1.evil.test:8776/','javascript:alert(1)','//127.0.0.1:8776/','http://user@localhost:8776/','http://user:secret@127.0.0.1:8776/','http://localhost:8776/content','http://localhost:8776/?token=secret','http://localhost:8776/#fragment','not a URL','http://localhost/'+ 'a'.repeat(260),null,{}];
  for(const operatorUrl of unsafeUrls){
    reconnectReply={status:'other_service',message:'Matrix uses another service.',operatorUrl};
    await element('reconnectQuest').onclick();
    assert.equal(element('matchingOperator').hidden,true,'Suppress untrusted Operator URL: '+JSON.stringify(operatorUrl));
    assert.equal(element('reconnectQuest').disabled,false,'An invalid link does not strand the retry button');
  }
  assert.deepEqual(navigations,[],'Invalid links never cause navigation');

  reconnectReply={status:'needs_attention',message:'Authorize USB debugging inside the Quest.'};
  await element('reconnectQuest').onclick();
  assert.equal(element('reconnectStatus').textContent,reconnectReply.message);
  assert.equal(element('reconnectQuest').disabled,false,'User-action requirements allow a later retry');
  reconnectHttpStatus=404;reconnectReply={error:'Unknown endpoint'};
  await element('reconnectQuest').onclick();
  assert.match(element('reconnectStatus').textContent,/needs the reconnect update.*restart.*reload/);
  assert.equal(element('reconnectQuest').disabled,false,'An old service does not leave a pending reconnect');
  reconnectHttpStatus=500;reconnectReply={error:'ADB connection failed.'};
  await element('reconnectQuest').onclick();
  assert.equal(element('reconnectStatus').textContent,'ADB connection failed.');
  assert.equal(element('reconnectQuest').disabled,false);
  reconnectHttpStatus=200;reconnectFailure='Failed to fetch';
  await element('reconnectQuest').onclick();
  assert.equal(element('reconnectStatus').textContent,'Failed to fetch');
  assert.equal(element('reconnectQuest').disabled,false,'A failed request can be retried explicitly');
  reconnectFailure=null;reconnectReply={status:'forwarded',message:'USB forwarding restored.'};
  stateError={status:503,message:'PC service temporarily unavailable'};
  await element('reconnectQuest').onclick();await tick();
  assert.equal(element('save').disabled,true,'A failed state refresh cannot prove the runtime connected');
  assert.match(element('status').textContent,/temporarily unavailable/);
  now+=15000;await poll();
  assert.equal(element('reconnectQuest').disabled,false,'A failed state poll still releases the bounded wait');
  stateError=null;runtimeOnline=true;await poll();
  assert.equal(element('save').disabled,false,'Normal polling recovers when the service and runtime return');
  const finalCount=reconnectCalls().length;await poll();await element('connect').onclick();
  assert.equal(reconnectCalls().length,finalCount,'Recovery polling and token application stay read-only');
}

async function reconnectTimeoutChecks(){
  const poll=async()=>{for(const callback of pollers)await callback();};
  const reconnectCount=()=>calls.filter(call=>call.url==='/api/runtime/reconnect').length;
  runtimeOnline=false;capture={supported:true,status:'none',voiceCaptureId:null};await poll();
  hungPaths.add('/api/state');reconnectReply={status:'forwarded',message:'USB forwarding restored.'};
  await element('reconnectQuest').onclick();
  assert.equal(vm.runInContext('reconnecting',context),false,'The POST handler finishes without waiting for a stuck state refresh');
  assert.equal(element('reconnectQuest').disabled,true);
  const waitingTimer=[...timers.values()].find(timer=>timer.at===now+15000);
  assert.ok(waitingTimer,'The heartbeat deadline has an independent timer');
  const beforeWait=reconnectCount();
  await advance(10000);
  assert.ok(abortedPaths.includes('/api/state'),'A stuck state request aborts after ten seconds');
  assert.equal(vm.runInContext('refreshing',context),false,'Aborting the poll releases the refresh guard');
  assert.equal(element('reconnectQuest').disabled,true,'The heartbeat still has five seconds left');
  const secondPoll=poll();await tick();
  await advance(5000);
  assert.equal(vm.runInContext('refreshing',context),true,'The second fetch remains pending at the heartbeat deadline');
  assert.equal(element('reconnectQuest').disabled,false,'The independent deadline unlocks retry while another state fetch hangs');
  assert.match(element('reconnectStatus').textContent,/has not checked in/);
  assert.equal(reconnectCount(),beforeWait,'No timer or abort automatically runs another reconnect');
  reconnectReply={status:'needs_attention',message:'Check the USB cable.'};await element('reconnectQuest').onclick();
  waitingTimer.callback();
  assert.equal(element('reconnectStatus').textContent,'Check the USB cable.','An expired timer cannot overwrite a newer attempt');
  hungPaths.delete('/api/state');await advance(5000);await secondPoll;
  runtimeOnline=true;await poll();
  assert.equal(element('save').disabled,false,'Fresh polling recovers after a stalled fetch is aborted');
  assert.equal(element('reconnectQuest').disabled,true);

  runtimeOnline=false;await poll();hungPaths.add('/api/runtime/reconnect');
  const stuckPost=element('reconnectQuest').onclick();await advance(29999);
  assert.equal(element('reconnectQuest').disabled,true,'The reconnect request allows the backend its bounded work time');
  await advance(1);await stuckPost;
  assert.ok(abortedPaths.includes('/api/runtime/reconnect'));
  assert.equal(element('reconnectQuest').disabled,false,'A stalled POST releases retry at thirty seconds');
  assert.match(element('reconnectStatus').textContent,/timed out.*try again/);
  hungPaths.delete('/api/runtime/reconnect');
  reconnectReply={status:'forwarded',message:'USB forwarding restored.'};
  await element('reconnectQuest').onclick();await tick();
  const confirmedTimer=[...timers.values()].find(timer=>timer.at===now+15000);
  assert.ok(confirmedTimer);
  runtimeOnline=true;await poll();
  assert.equal(timers.size,0,'Confirmed online state clears the heartbeat timer and completed request timers');
  confirmedTimer.callback();
  assert.equal(element('reconnectStatus').textContent,'Matrix is connected to this Operator.','A cleared timer cannot overwrite confirmed success');
  runtimeOnline=false;await poll();
  confirmedTimer.callback();
  assert.match(element('reconnectStatus').textContent,/Connection lost/,'A prior timer cannot overwrite a later disconnect');

  for(const path of ['/api/scenes','/api/capture']){
    hungPaths.add(path);
    capture=path==='/api/capture'?{...captureReady,captureId:'timeout-preview'}:{supported:true,status:'none'};
    const stalledPoll=poll();await tick();await advance(10000);await stalledPoll;
    assert.ok(abortedPaths.includes(path),'A stalled '+path+' request is also bounded');
    assert.equal(vm.runInContext('refreshing',context),false,'Refresh recovers after a '+path+' timeout');
    hungPaths.delete(path);
  }
  capture={supported:true,status:'none'};runtimeOnline=true;await poll();
  assert.equal(element('save').disabled,false);
  assert.equal(timers.size,0,'No timeout callbacks remain after all requests settle');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
