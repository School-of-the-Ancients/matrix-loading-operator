import './style.css';
import {MatrixWorld} from './protocol.js';
import {MatrixView} from './view.js';
import {MatrixBridge} from './bridge.js';
import {VoiceRecorder} from './voice.js';

const $=id=>document.getElementById(id);
const world=new MatrixWorld();
let pendingScene=null;
try {pendingScene=JSON.parse(sessionStorage.getItem('matrix-web-scene')||'null');}
catch {sessionStorage.removeItem('matrix-web-scene');}

let proposal=null,operatorMessageUntil=0,lastOperatorReply='',lastConnectionOnline=null,modeTouched=false;
const recorder=new VoiceRecorder();let voiceStarting=false,voiceRecording=false,voiceStopRequested=false,voiceJob=null,voiceSnapshot=null;
let replyContext=null,replySource=null;
function unlockReplyAudio(){
  if(!$('speak-replies').checked)return;
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)return;
  if(!replyContext)replyContext=new AudioContextClass();
  replyContext.resume().catch(()=>{});
}
const feedback=(message,isError=false)=>{$('feedback').textContent=message;$('feedback').classList.toggle('error',isError);};
const view=new MatrixView($('view'),world,()=>{proposal=null;$('proposal').classList.add('hidden');feedback(`Selected ${world.selection.objectId||'placement point'} at ${Object.values(world.selection.position).join(', ')} m.`);},()=>$('token').value.trim(),message=>feedback(message,true),(id,position)=>{proposal=null;$('proposal').classList.add('hidden');renderScene();feedback(`Moved ${id.slice(0,8)} to ${Object.values(position).join(', ')} m. Undo and Save are available.`);},()=>{proposal=null;$('proposal').classList.add('hidden');renderScene();},beginVoice,endVoice,()=>{$('speak-replies').checked=!$('speak-replies').checked;view.setVoiceOutputEnabled($('speak-replies').checked);unlockReplyAudio();});
view.sync();
view.setVoiceOutputEnabled($('speak-replies').checked);
view.initXR($('xr-buttons')).catch(e=>feedback(e.message,true));

function renderScene(){
  view.sync();$('object-count').textContent=`${world.scene.objects.length} object${world.scene.objects.length===1?'':'s'}`;
  if(!pendingScene){
    const scene=world.spatial?{...world.virtualScene.scene,objects:world.scene.objects.filter(object=>object.anchorId==='web-floor')}:world.scene;
    sessionStorage.setItem('matrix-web-scene',JSON.stringify(scene));
  }
}
renderScene();
const bridge=new MatrixBridge(world,()=>$('token').value.trim(),event=>{
  if(event.type==='scene')renderScene();
  if(event.type==='connection'){
    $('connection').textContent=event.online?'Operator connected':event.error||'Operator unavailable';
    $('connection-dot').classList.toggle('online',event.online);
    if(!event.online)view.setOperatorStatus(`Connection lost: ${event.error||'Operator unavailable'}${lastOperatorReply?`\n\n${lastOperatorReply}`:''}`,'error');
    else if(lastConnectionOnline===false||!voiceStarting&&!voiceRecording&&!voiceJob&&performance.now()>operatorMessageUntil)view.setOperatorStatus(lastOperatorReply||'Operator connected. Aim at the panel and hold trigger, or hold either grip, to speak.');
    lastConnectionOnline=event.online;
  }
  if(event.type==='receipt'){
    const message=event.result.ok?`Applied ${event.result.requestId.slice(0,8)}${event.result.objectId?` · ${event.result.objectId.slice(0,8)}`:''}`:`Command failed: ${event.result.error}`;
    feedback(message,!event.result.ok);lastOperatorReply=lastOperatorReply?`${lastOperatorReply}\n\n${message}`:message;operatorMessageUntil=Infinity;view.setOperatorStatus(lastOperatorReply,event.result.ok?'idle':'error');
  }
});
async function refreshAssets(silent=false){
  try{
    const data=await bridge.request('/api/web/assets');world.registerAssets(data.assets||[]);
    $('asset-count').textContent=`${7+world.externalAssets.length} available`;
    if(pendingScene){
      try{world.validateScene(pendingScene);world.scene=pendingScene;pendingScene=null;renderScene();}
      catch(error){if(!silent)feedback(`Saved tab scene unavailable: ${error.message}`,true);}
    }
    if(!silent)feedback(`Catalog updated: ${world.externalAssets.length} web assets.`);
  }catch(error){if(!silent)feedback(error.message,true);}
}
bridge.start(()=>view.viewer());
view.onFrame=()=>bridge.tick();
refreshAssets(true);
bridge.request('/api/planner').then(status=>{
  if(!modeTouched&&status.configured&&status.mode==='codex-cli'&&$('mode').value==='offline-rules')$('mode').value='codex-cli';
}).catch(()=>{});
setInterval(()=>refreshAssets(true),10000);
addEventListener('beforeunload',()=>bridge.stop());

async function call(path,body,success){
  try{const data=await bridge.request(path,body);if(success)feedback(success);return data;}
  catch(error){feedback(error.message,true);return null;}
}
async function refreshScenes(){
  const data=await call('/api/scenes');if(!data)return;
  const select=$('saved-scenes'),current=select.value;select.replaceChildren(new Option('Saved scenes',''));
  for(const name of data.scenes||[])select.add(new Option(name,name));select.value=current;
}
async function propose(){
  const text=$('prompt').value.trim();if(!text){feedback('Enter a request first.',true);return;}
  unlockReplyAudio();
  lastOperatorReply='';operatorMessageUntil=0;
  $('propose').disabled=true;feedback('Planning…');
  const data=await call('/api/plan',{text,mode:$('mode').value});$('propose').disabled=false;
  if(!data)return;
  await showProposal(data);
}
const SAFE_AUTO_OPS=new Set(['spawn','duplicate','set_transform','set_behavior','remove_behavior','select']);
async function speakReply(message){
  if(!$('speak-replies').checked)return;
  const fallback=()=>{
    if(!('speechSynthesis' in window))return;
    speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(String(message).slice(0,300));
    utterance.rate=1;utterance.volume=.85;speechSynthesis.speak(utterance);
  };
  try{
    unlockReplyAudio();
    if(!replyContext)throw Error('Web Audio unavailable');
    const headers={'Content-Type':'application/json'},token=$('token').value.trim();
    if(token)headers.Authorization=`Bearer ${token}`;
    const response=await fetch('/api/voice/speak',{method:'POST',headers,body:JSON.stringify({text:String(message).slice(0,300)}),cache:'no-store'});
    if(!response.ok)throw Error(`PC speech output HTTP ${response.status}`);
    const buffer=await replyContext.decodeAudioData(await response.arrayBuffer());
    if(replyContext.state!=='running')await replyContext.resume();
    if(replyContext.state!=='running')throw Error('Browser audio is suspended');
    replySource?.stop();
    replySource=replyContext.createBufferSource();replySource.buffer=buffer;
    replySource.connect(replyContext.destination);replySource.start();
  }catch(error){console.warn('Operator voice output:',error);fallback();}
}
async function pollBlender(jobId,request){
  for(let attempt=0;attempt<600;attempt++){
    const job=await bridge.request(`/api/web/blender/${jobId}`);
    if(job.phase==='error')throw Error(job.error||'Blender asset creation failed');
    if(job.phase==='ready'){
      await refreshAssets(true);
      const asset=world.asset(job.asset.assetId);
      if(!asset)throw Error('Blender asset is ready but the browser catalog has not refreshed');
      let anchorId=world.selection.anchorId,position=structuredClone(world.selection.position);
      const measured=world.spatial&&anchorId!=='web-floor'&&world.spatial.alignmentVerified;
      if(!measured){anchorId='web-floor';position={x:0,y:0,z:-2};}
      const base={requestId:crypto.randomUUID(),op:'spawn',assetId:asset.assetId,anchorId,
        ...(measured?{placement:'surface'}:{}),
        transform:{position,rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}};
      let result=world.execute(base);
      if(!result.ok&&measured)result=world.execute({...base,requestId:crypto.randomUUID(),anchorId:'web-floor',
        placement:undefined,transform:{...base.transform,position:{x:0,y:0,z:-2}}});
      if(!result.ok)throw Error(`Blender asset was created but placement failed: ${result.error}`);
      world.setSelection(result.objectId,world.requireObject(result.objectId).transform.position,world.requireObject(result.objectId).anchorId);
      renderScene();
      const message=`Created ${asset.displayName} in Blender and imported it into ${world.spatial?'AR':'the scene'}. ${measured?'Grab it to adjust the position.':'It is an unanchored preview; grab it to move it.'}`;
      lastOperatorReply=`You: ${request}\n\nOperator: ${message}`;operatorMessageUntil=Infinity;
      view.setOperatorStatus(lastOperatorReply);feedback(message);speakReply(message);return;
    }
    const progress=`Creating in Blender: ${job.phase}…`;
    feedback(progress);view.setOperatorStatus(progress);
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  throw Error('Blender job is taking longer than expected; check the job list on the PC.');
}
async function showProposal(data){
  if(data.authoringJobId){
    proposal=null;$('proposal').classList.add('hidden');
    try{await pollBlender(data.authoringJobId,data.transcript||$('prompt').value.trim());}
    catch(error){feedback(error.message,true);view.setOperatorStatus(error.message,'error');}
    return;
  }
  proposal=data.requiresApply?data:null;
  $('proposal').classList.toggle('hidden',!proposal);
  $('proposal-summary').textContent=data.summary||data.message||data.status||'Review the exact commands.';
  $('proposal-commands').textContent=JSON.stringify(data.commands||[],null,2);
  const request=data.transcript||$('prompt').value.trim();
  lastOperatorReply=`You: ${request||'(voice request)'}\n\nOperator: ${$('proposal-summary').textContent}`;
  operatorMessageUntil=Infinity;view.setOperatorStatus(lastOperatorReply);
  speakReply($('proposal-summary').textContent);
  if(proposal&&$('auto-apply-safe').checked&&proposal.commands?.length&&proposal.commands.every(command=>SAFE_AUTO_OPS.has(command.op))){
    await applyProposal();return;
  }
  feedback(proposal?'Review the proposal, then Apply.':data.message||'No scene edits proposed.');
}
async function applyProposal(){
  if(!proposal?.planId)return;
  const data=await call('/api/apply_plan',{planId:proposal.planId},'Scene request queued for the runtime.');
  if(data){proposal=null;$('proposal').classList.add('hidden');}
}
$('propose').addEventListener('click',propose);
$('blender-request').addEventListener('click',async()=>{
  const prompt=$('prompt').value.trim();if(!prompt){feedback('Describe the object to create first.',true);return;}
  unlockReplyAudio();
  const button=$('blender-request');button.disabled=true;
  try{const job=await bridge.request('/api/web/blender',{prompt});await pollBlender(job.jobId,prompt);}
  catch(error){feedback(error.message,true);view.setOperatorStatus(error.message,'error');}
  finally{button.disabled=false;}
});
$('speak-replies').addEventListener('change',()=>{view.setVoiceOutputEnabled($('speak-replies').checked);unlockReplyAudio();});
$('prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey))propose();});
$('discard').addEventListener('click',()=>{proposal=null;$('proposal').classList.add('hidden');feedback('Proposal discarded.');});
$('apply').addEventListener('click',applyProposal);
function voiceStatus(message,isError=false){$('voice-status').textContent=message;$('xr-voice-status').textContent=message;feedback(message,isError);operatorMessageUntil=performance.now()+8000;view.setOperatorStatus(message,isError?'error':voiceRecording?'recording':'idle');}
function voiceButtons(){for(const id of ['voice-button','xr-voice']){$(id).textContent=voiceStarting||voiceRecording?'Tap to send':'Tap to speak';$(id).disabled=!!voiceJob;}}
async function beginVoice(){
  if(voiceStarting||voiceRecording||voiceJob)return;
  unlockReplyAudio();
  lastOperatorReply='';operatorMessageUntil=0;
  voiceStarting=true;voiceStopRequested=false;voiceButtons();voiceStatus('Requesting microphone…');
  try{await recorder.start();voiceRecording=true;voiceSnapshot=world.snapshot(view.viewer());voiceStatus('Recording… release the controller or tap Send.');}
  catch(error){voiceStatus(error.message,true);}
  finally{voiceStarting=false;voiceButtons();if(voiceStopRequested&&voiceRecording)endVoice();}
}
async function endVoice(){
  if(voiceStarting){voiceStopRequested=true;return;}
  if(!voiceRecording)return;
  voiceRecording=false;voiceButtons();voiceStatus('Transcribing on PC…');
  try{const audioBase64=await recorder.stop();const job=await bridge.request('/api/voice',{clientId:bridge.clientId,snapshot:voiceSnapshot,audioBase64});
    voiceJob=job.jobId;voiceButtons();await pollVoice(voiceJob);}
  catch(error){voiceStatus(error.message,true);}
  finally{voiceJob=null;voiceSnapshot=null;voiceButtons();}
}
async function pollVoice(jobId){
  for(let attempt=0;attempt<120;attempt++){
    const job=await bridge.request(`/api/voice/${jobId}`);
    if(job.phase==='error'){voiceStatus(job.error||'Voice request failed',true);return;}
    if(!['transcribing','planning'].includes(job.phase)){if(job.transcript)$('prompt').value=job.transcript;
      voiceStatus(job.transcript?`Heard: ${job.transcript}`:'Voice request finished');await showProposal(job);return;}
    voiceStatus(job.phase==='transcribing'?'Transcribing on PC…':job.progress||'Planning scene…');
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  voiceStatus('Voice request timed out; please try again.',true);
}
for(const id of ['voice-button','xr-voice']){
  const button=$(id);button.addEventListener('click',()=>voiceRecording||voiceStarting?endVoice():beginVoice());
  button.addEventListener('contextmenu',event=>event.preventDefault());
}
voiceButtons();
$('xr-exit').addEventListener('click',()=>view.renderer.xr.getSession()?.end());
for(const op of ['undo','redo','clear'])$(op).addEventListener('click',()=>call('/api/command',{op},`${op} queued.`));
$('save').addEventListener('click',async()=>{
  const name=$('save-name').value.trim();if(!name){feedback('Enter a scene name.',true);return;}
  const data=await call('/api/save',{name},`Saved ${name}.`);if(data)refreshScenes();
});
$('restore').addEventListener('click',async()=>{
  const name=$('saved-scenes').value;if(!name){feedback('Choose a saved scene.',true);return;}
  await call('/api/load',{name},`Restore of ${name} queued.`);
});
$('mode').addEventListener('change',()=>{modeTouched=true;proposal=null;$('proposal').classList.add('hidden');});
$('refresh-assets').addEventListener('click',()=>refreshAssets());
$('token').addEventListener('change',()=>{refreshAssets();loadLatestAuthoring();});
refreshScenes();

let authoringTimer=null;
let generatedAssetId='';
async function showAuthoringJob(job){
  clearTimeout(authoringTimer);
  if(job.phase==='ready'){
    generatedAssetId=job.asset.assetId;
    await refreshAssets(true);
    $('authoring-status').textContent=`Ready in ${job.elapsedMs} ms: ${job.spec.name} · ${generatedAssetId}`;
    $('place-asset').disabled=!world.asset(generatedAssetId);
    feedback(`${job.spec.name} is available. Select a point and place it.`);
  }else if(job.phase==='error'){
    generatedAssetId='';$('place-asset').disabled=true;
    $('authoring-status').textContent=`Authoring failed: ${job.error}`;
  }else{
    $('authoring-status').textContent=`${job.spec.name}: ${job.phase}…`;
    authoringTimer=setTimeout(async()=>{
      try{await showAuthoringJob(await bridge.request(`/api/web/authoring/${job.jobId}`));}
      catch(error){$('authoring-status').textContent=error.message;}
    },500);
  }
}
async function loadLatestAuthoring(){
  try{const data=await bridge.request('/api/web/authoring');if(data.jobs.length)await showAuthoringJob(data.jobs.at(-1));}
  catch{/* The service may require a token that has not been entered yet. */}
}
$('create-asset').addEventListener('click',async()=>{
  clearTimeout(authoringTimer);generatedAssetId='';$('place-asset').disabled=true;
  const button=$('create-asset');button.disabled=true;
  try{
    const job=await bridge.request('/api/web/authoring',{
      name:$('asset-name').value.trim(),brief:$('asset-brief').value.trim(),
      shape:$('asset-shape').value,palette:$('asset-palette').value,
      width:Number($('asset-width').value),height:Number($('asset-height').value),depth:Number($('asset-depth').value)
    });
    await showAuthoringJob(job);
  }catch(error){$('authoring-status').textContent=error.message;feedback(error.message,true);}
  finally{button.disabled=false;}
});
$('place-asset').addEventListener('click',async()=>{
  if(!generatedAssetId||!world.asset(generatedAssetId))return;
  const position=structuredClone(world.selection.position);
  const anchorId=world.selection.anchorId;
  if(!anchorId){feedback('Point at a measured support surface before placing this asset.',true);return;}
  const measured=world.availableAnchors().find(anchor=>anchor.anchorId===anchorId)?.source==='webxr';
  const placement=measured&&world.asset(generatedAssetId).localBounds?'surface':undefined;
  const result=await call('/api/command',{op:'spawn',assetId:generatedAssetId,anchorId,
    ...(placement?{placement}:{}),
    transform:{position,rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}},`Placement queued at ${Object.values(position).join(', ')} m.`);
  if(result)$('authoring-status').textContent=`Placement requested for ${generatedAssetId}. Wait for the runtime receipt.`;
});
loadLatestAuthoring();
