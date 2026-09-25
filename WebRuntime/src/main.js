import './style.css';
import {MatrixWorld} from './protocol.js';
import {MatrixView} from './view.js';
import {MatrixBridge} from './bridge.js';
import {VoiceRecorder} from './voice.js';
import {CameraStream} from './camera_stream.js';
import {loadStoredWorld,saveStoredWorld,restoreStoredWorld,storedWorld,quarantineStoredWorld,
  saveCheckpoint,loadCheckpoint} from './scene_store.js';
import {loadConversation,rememberTurn,clearConversation} from './conversation.js';
import {startGame,deliverMovedObject,gameStatus,validSavedGame} from './game.js';

const $=id=>document.getElementById(id);
const world=new MatrixWorld();
const cameraStream=new CameraStream();
let pendingWorld=loadStoredWorld(sessionStorage,localStorage);

let proposal=null,gameProposal=null,operatorMessageUntil=0,lastOperatorReply='',lastConnectionOnline=null,modeTouched=false;
let conversation=loadConversation(sessionStorage);
let restoreArmedUntil=0;
let persistenceWarning='',restoreWarning='';
let cameraBusy=false;
const recorder=new VoiceRecorder();let voiceStarting=false,voiceRecording=false,voiceStopRequested=false,voiceJob=null,voiceSnapshot=null;
let replyContext=null,replySource=null;
function unlockReplyAudio(){
  if(!$('speak-replies').checked)return;
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)return;
  if(!replyContext)replyContext=new AudioContextClass();
  replyContext.resume().catch(()=>{});
}
const feedback=(message,isError=false)=>{
  const warning=[restoreWarning,persistenceWarning].filter(Boolean).join('\n');
  $('feedback').textContent=[message,warning].filter(Boolean).join('\n');
  $('feedback').classList.toggle('error',isError||!!warning);
};
const view=new MatrixView($('view'),world,()=>{discardProposal();feedback(`Selected ${world.selection.objectId||'placement point'} at ${Object.values(world.selection.position).join(', ')} m.`);},()=>$('token').value.trim(),message=>feedback(message,true),(id,position)=>{discardProposal();const delivered=deliverMovedObject(world,id);if(delivered)speakReply(delivered);renderScene();feedback(delivered||`Moved ${id.slice(0,8)} to ${Object.values(position).join(', ')} m. Undo and Save are available.`);},()=>{if(!view.isAR)cameraStream.stop();updateCameraControls();discardProposal();renderScene();},beginVoice,endVoice,()=>{$('speak-replies').checked=!$('speak-replies').checked;view.setVoiceOutputEnabled($('speak-replies').checked);unlockReplyAudio();},reviewView,newChat);
view.onPanelAction=panelAction;
view.sync();
view.setVoiceOutputEnabled($('speak-replies').checked);
view.setConversationCount(conversation.length);
view.setOperatorGameStatus(gameStatus(world));
updateCameraControls();
$('conversation-status').textContent=`${conversation.length} recent turn${conversation.length===1?'':'s'} in this tab`;
view.initXR($('xr-buttons')).catch(e=>feedback(e.message,true));

function remember(user,assistant){
  conversation=rememberTurn(sessionStorage,conversation,user,assistant);
  view.setConversationCount(conversation.length);
  $('conversation-status').textContent=`${conversation.length} recent turn${conversation.length===1?'':'s'} in this tab`;
}
function newChat(){
  if(voiceJob||voiceRecording||voiceStarting||$('propose').disabled||$('blender-request').disabled||reviewBusy){
    feedback('Wait for the current Operator request to finish before starting a new conversation.');return;
  }
  conversation=clearConversation(sessionStorage);
  discardProposal();
  lastOperatorReply='';operatorMessageUntil=0;
  view.setConversationCount(0);
  $('conversation-status').textContent='0 recent turns in this tab';
  view.setOperatorStatus('New conversation. Describe what you want to build.');
  feedback('New Operator conversation started. The scene is still here.');
}

function discardProposal(){
  proposal=null;gameProposal=null;$('proposal').classList.add('hidden');
  view.setOperatorProposal(null);
}

function updateWorldControls(){
  const canConfirm=!!world.spatial&&!world.spatial.alignmentVerified&&!world.spatial.stale&&
    world.spatial.anchors.some(anchor=>anchor.surface?.kind==='support');
  $('confirm-room').disabled=!canConfirm;
  view.setOperatorWorldInfo({objects:world.scene.objects.length,canConfirm,restoreArmed:performance.now()<restoreArmedUntil,
    alignment:!world.spatial?'Virtual room':world.spatial.alignmentVerified?'AR room aligned':
      canConfirm?'Check outlines, then confirm':'Waiting for room planes'});
  const status=gameStatus(world);
  $('game-status').textContent=status;view.setOperatorGameStatus(status);
  updateCameraControls();
}
function updateCameraControls(){
  const capability=cameraStream.capabilities();
  const active=cameraStream.active;
  $('enable-camera').disabled=!view.isAR||cameraBusy;
  $('enable-camera').textContent=active?'Stop environment camera':'Enable environment camera for AI review';
  $('camera-status').textContent=!view.isAR?'Enter AR to test the Quest environment camera.':
    active?'Camera active. Review View will send a labeled camera and virtual pair.':
    capability.reason;
  view.setOperatorCameraStatus(!view.isAR?'Enter AR to test':active?'Active · review sends two labeled views':
    capability.mixedStatus==='denied'?'Permission denied':capability.mixedStatus==='error'?'Camera unavailable':'Enable to test',active);
}
async function toggleCamera(){
  if(cameraBusy)return;
  if(cameraStream.active){cameraStream.stop();updateCameraControls();feedback('Environment camera stopped. Visual review is virtual only.');return;}
  if(!view.isAR){feedback('Enter AR before testing the environment camera.',true);return;}
  cameraBusy=true;updateCameraControls();
  try{
    await cameraStream.enable();
    feedback('Environment camera available. Review View will send a labeled real camera and virtual pair.');
  }catch(error){feedback(`${error.message} Virtual-only visual review remains available.`,true);}
  finally{cameraBusy=false;updateCameraControls();bridge.tick(true);}
}

function renderScene(){
  view.sync();$('object-count').textContent=`${world.scene.objects.length} object${world.scene.objects.length===1?'':'s'}`;
  updateWorldControls();
  if(!pendingWorld){
    persistenceWarning=saveStoredWorld(storedWorld(world),sessionStorage,localStorage);
    const durableFailed=persistenceWarning.includes('Persistent browser save failed');
    view.setOperatorWarning(persistenceWarning?durableFailed?
      'PERSISTENT SAVE FAILED · closing browser may lose world':'TAB COPY FAILED · durable world saved':
      restoreWarning?'Saved world rejected · new changes can save':'');
    if(persistenceWarning)feedback(durableFailed?
      'The current world changed, but durable storage failed.':
      'The tab recovery copy failed; the durable browser world was saved.',true);
  }
}
renderScene();
const bridge=new MatrixBridge(world,()=>$('token').value.trim(),event=>{
  if(event.type==='scene'){
    if(world.game&&!validSavedGame(world.game,world.scene,id=>!!world.asset(id)))world.game=null;
    renderScene();
  }
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
bridge.getCaptureCapabilities=()=>cameraStream.capabilities();
async function refreshAssets(silent=false){
  try{
    const data=await bridge.request('/api/web/assets');world.registerAssets(data.assets||[]);
    $('asset-count').textContent=`${7+world.externalAssets.length} available`;
    if(pendingWorld){
      try{restoreStoredWorld(world,pendingWorld.value);pendingWorld=null;renderScene();}
      catch(error){
        quarantineStoredWorld(pendingWorld,localStorage);
        pendingWorld=null;
        restoreWarning=`Saved browser world could not be restored: ${error.message}. A copy was quarantined; this active world can now be saved.`;
        renderScene();
        feedback('World recovery needs attention.',true);
      }
    }
    if(!silent)feedback(`Catalog updated: ${world.externalAssets.length} web assets.`);
  }catch(error){if(!silent)feedback(error.message,true);}
}
bridge.start(()=>view.viewer(),(request,clientId)=>request.mode==='mixed'?
  view.captureCameraPair(request,clientId,cameraStream):view.captureVirtual(request,clientId));
let lastWorldControls=0;
view.onFrame=()=>{bridge.tick();if(performance.now()-lastWorldControls>500){lastWorldControls=performance.now();updateWorldControls();}};
refreshAssets(true);
bridge.request('/api/planner').then(status=>{
  if(!modeTouched&&status.configured&&status.mode==='codex-cli'&&$('mode').value==='offline-rules')$('mode').value='codex-cli';
}).catch(()=>{});
setInterval(()=>refreshAssets(true),10000);
addEventListener('beforeunload',()=>{cameraStream.stop();bridge.stop();});

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
  $('propose').disabled=true;feedback('Planning…');
  const data=await call('/api/plan',{text,mode:$('mode').value,conversation,webRuntime:true});$('propose').disabled=false;
  if(!data)return;
  await showProposal(data,text);
}
let reviewBusy=false;
async function captureAndWait(mode){
    const requested=await bridge.request('/api/capture',{mode});
    let ready=null;
    for(let attempt=0;attempt<(mode==='mixed'?110:50);attempt++){
      const state=await bridge.request('/api/state');
      const capture=state.capture;
      if(capture?.captureId!==requested.captureId)throw Error('Capture was replaced; please retry review');
      if(capture.status==='error'||capture.status==='stale')throw Error(capture.error||'Capture failed');
      if(capture.status==='ready'){ready=capture;break;}
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    if(!ready)throw Error('Rendered view capture timed out');
    return ready;
}
async function reviewView(){
  if(reviewBusy)return;
  reviewBusy=true;unlockReplyAudio();
  try{
    let mode=cameraStream.active&&view.isAR?'mixed':'virtual';
    feedback(mode==='mixed'?'Capturing environment camera and virtual view…':'Capturing the virtual view…');
    view.setOperatorStatus(mode==='mixed'?'Capturing two labeled views for visual review…':
      'Capturing virtual objects and room outlines for visual review…');
    let ready;
    try{ready=await captureAndWait(mode);}
    catch(error){
      if(mode!=='mixed')throw error;
      feedback(`Environment camera capture failed: ${error.message}. Retrying virtual-only review.`,true);
      mode='virtual';
      // The service rate-limits capture requests even after a failed mixed image.
      await new Promise(resolve=>setTimeout(resolve,2200));
      ready=await captureAndWait(mode);
    }
    feedback('Reviewing the rendered view with Codex…');view.setOperatorStatus('Reviewing the captured virtual scene…');
    const request=mode==='mixed'?
      'Review the two labeled views: a separate Quest environment-camera frame and a Three.js virtual render. They are side by side and NOT spatially calibrated or pixel aligned. Identify visible room and virtual objects qualitatively; use room-plane measurements for geometry. Propose only supported corrections.':
      'Review the current rendered virtual scene for visible scale, floor alignment, and placement problems. The image excludes physical camera pixels; use room-plane measurements for physical context. If the scene looks good, say so. Propose only supported corrections.';
    const result=await bridge.request('/api/plan',{text:request,mode:'codex-cli',captureId:ready.captureId,conversation});
    await showProposal(result,request);
  }catch(error){feedback(error.message,true);view.setOperatorStatus(`Visual review failed: ${error.message}`,'error');}
  finally{reviewBusy=false;}
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
    if(replySource){try{replySource.stop();}catch{}}
    const source=replyContext.createBufferSource();replySource=source;source.buffer=buffer;
    source.onended=()=>{if(replySource===source)replySource=null;};
    source.connect(replyContext.destination);source.start();
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
      let placementFallback='';
      if(!result.ok&&measured){
        placementFallback=result.error;
        result=world.execute({...base,requestId:crypto.randomUUID(),anchorId:'web-floor',
          placement:undefined,transform:{...base.transform,position:{x:0,y:0,z:-2}}});
      }
      if(!result.ok)throw Error(`Blender asset was created but placement failed: ${result.error}`);
      world.setSelection(result.objectId,world.requireObject(result.objectId).transform.position,world.requireObject(result.objectId).anchorId);
      renderScene();
      const message=placementFallback?
        `Created ${asset.displayName} in Blender. Measured placement failed (${placementFallback}); the object is an unanchored virtual preview.`:
        `Created ${asset.displayName} in Blender and imported it into ${world.spatial?'AR':'the scene'}. ${measured?'Grab it to adjust the position.':'It is an unanchored preview; grab it to move it.'}`;
      remember(request,message);
      lastOperatorReply=`You: ${request}\n\nOperator: ${message}`;operatorMessageUntil=Infinity;
      view.setOperatorStatus(lastOperatorReply);feedback(message);speakReply(message);return;
    }
    const progress=`Creating in Blender: ${job.phase}…`;
    feedback(progress);view.setOperatorStatus(progress);
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  throw Error('Blender job is taking longer than expected; check the job list on the PC.');
}
async function showProposal(data,requestText=''){
  if(data.authoringJobId){
    proposal=null;$('proposal').classList.add('hidden');
    try{await pollBlender(data.authoringJobId,data.transcript||requestText||$('prompt').value.trim());}
    catch(error){feedback(error.message,true);view.setOperatorStatus(error.message,'error');}
    return;
  }
  proposal=data.requiresApply&&!data.gamePlan?data:null;
  gameProposal=data.requiresApply&&data.gamePlan?{...data,worldAtProposal:JSON.stringify(storedWorld(world))}:null;
  const pending=proposal||gameProposal;
  $('proposal').classList.toggle('hidden',!pending);
  $('proposal-summary').textContent=data.summary||data.message||data.status||'Review the exact commands.';
  $('proposal-commands').textContent=gameProposal?
    JSON.stringify({roles:data.gamePlan.roles,rules:data.gamePlan.rules,objectives:data.gamePlan.objectives},null,2):
    JSON.stringify(data.commands||[],null,2);
  view.setOperatorProposal(pending?{kind:gameProposal?'game':'scene',summary:$('proposal-summary').textContent,
    commands:data.commands||[],gamePlan:data.gamePlan}:null);
  const request=data.transcript||requestText||$('prompt').value.trim();
  remember(request,$('proposal-summary').textContent);
  lastOperatorReply=`You: ${request||'(voice request)'}\n\nOperator: ${$('proposal-summary').textContent}`;
  operatorMessageUntil=Infinity;view.setOperatorStatus(lastOperatorReply);
  speakReply($('proposal-summary').textContent);
  if(proposal&&$('auto-apply-safe').checked&&proposal.commands?.length&&proposal.commands.every(command=>SAFE_AUTO_OPS.has(command.op))){
    await applyProposal();return;
  }
  feedback(pending?'Review the proposal, then Apply in the world or browser.':data.message||'No scene edits proposed.');
}
async function applyProposal(){
  if(gameProposal){
    if(JSON.stringify(storedWorld(world))!==gameProposal.worldAtProposal){feedback('The world changed. Ask Codex to plan the game again.',true);discardProposal();return;}
    try{
      const game=startGame(world,gameProposal.gamePlan,view.viewer());
      discardProposal();renderScene();
      const message=`${game.spec.title} started. Grab pickup objects and release them near the matching delivery zones.`;
      feedback(message);view.setOperatorStatus(message);speakReply(message);
    }catch(error){feedback(error.message,true);view.setOperatorStatus(error.message,'error');}
    return;
  }
  if(!proposal?.planId)return;
  const data=await call('/api/apply_plan',{planId:proposal.planId},'Scene request queued for the runtime.');
  if(data)discardProposal();
}
async function confirmRoom(){
  if($('confirm-room').disabled)return;
  const result=await call('/api/command',{op:'confirm_room'},'Room alignment confirmation queued.');
  if(result)view.setOperatorStatus('Room alignment confirmation queued. Wait for the runtime receipt.');
}
async function saveWorld(){
  const value=storedWorld(world);
  const warning=saveCheckpoint(value.scene,value.game,localStorage);
  if(warning){feedback(warning,true);return;}
  const name=`WebWorld_${new Date().toISOString().replace(/[-:T.Z]/g,'').slice(0,14)}`;
  try{await bridge.request('/api/save',{name});feedback(`World checkpoint saved in this browser. Scene-only PC backup: ${name}.`);refreshScenes();}
  catch(error){feedback(`World checkpoint saved in this browser. PC scene backup failed: ${error.message}`,true);}
}
function restoreWorld(){
  const checkpoint=loadCheckpoint(localStorage);
  if(!checkpoint){feedback('No manual world checkpoint is saved in this browser.',true);return;}
  if(performance.now()>=restoreArmedUntil){
    restoreArmedUntil=performance.now()+10000;updateWorldControls();
    feedback('Tap Confirm Restore within ten seconds to replace the current scene.');return;
  }
  restoreArmedUntil=0;
  try{
    restoreStoredWorld(world,checkpoint);
    discardProposal();
    renderScene();feedback('World checkpoint restored in this browser.');
    view.setOperatorStatus('World checkpoint restored.');
  }catch(error){feedback(`Checkpoint could not be restored: ${error.message}`,true);}
}
function panelAction(action){
  if(action==='apply')applyProposal();
  else if(action==='discard'){discardProposal();feedback('Proposal discarded.');view.setOperatorStatus('Proposal discarded.');}
  else if(action==='confirm-room')confirmRoom();
  else if(action==='save-world')saveWorld();
  else if(action==='restore-world')restoreWorld();
  else if(action==='toggle-camera')toggleCamera();
  else if(action==='undo'||action==='redo')call('/api/command',{op:action},`${action} queued.`);
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
$('review-view').addEventListener('click',reviewView);
$('enable-camera').addEventListener('click',toggleCamera);
$('confirm-room').addEventListener('click',confirmRoom);
$('new-chat').addEventListener('click',newChat);
$('speak-replies').addEventListener('change',()=>{view.setVoiceOutputEnabled($('speak-replies').checked);unlockReplyAudio();});
$('prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey))propose();});
$('discard').addEventListener('click',()=>{discardProposal();feedback('Proposal discarded.');});
$('apply').addEventListener('click',applyProposal);
function voiceStatus(message,isError=false){$('voice-status').textContent=message;$('xr-voice-status').textContent=message;feedback(message,isError);operatorMessageUntil=performance.now()+8000;view.setOperatorStatus(message,isError?'error':voiceRecording?'recording':'idle');}
function voiceButtons(){for(const id of ['voice-button','xr-voice']){$(id).textContent=voiceStarting||voiceRecording?'Tap to send':'Tap to speak';$(id).disabled=!!voiceJob;}}
async function beginVoice(){
  if(voiceStarting||voiceRecording||voiceJob)return;
  unlockReplyAudio();
  voiceStarting=true;voiceStopRequested=false;voiceButtons();voiceStatus('Requesting microphone…');
  try{await recorder.start();voiceRecording=true;voiceSnapshot=world.snapshot(view.viewer());voiceStatus('Recording… release the controller or tap Send.');}
  catch(error){voiceStatus(error.message,true);}
  finally{voiceStarting=false;voiceButtons();if(voiceStopRequested&&voiceRecording)endVoice();}
}
async function endVoice(){
  if(voiceStarting){voiceStopRequested=true;return;}
  if(!voiceRecording)return;
  voiceRecording=false;voiceButtons();voiceStatus('Transcribing on PC…');
  try{const audioBase64=await recorder.stop();const job=await bridge.request('/api/voice',{clientId:bridge.clientId,snapshot:voiceSnapshot,audioBase64,conversation,webRuntime:true});
    voiceJob=job.jobId;voiceButtons();await pollVoice(voiceJob);}
  catch(error){voiceStatus(error.message,true);}
  finally{voiceJob=null;voiceSnapshot=null;voiceButtons();}
}
async function pollVoice(jobId){
  for(let attempt=0;attempt<120;attempt++){
    const job=await bridge.request(`/api/voice/${jobId}`);
    if(job.phase==='error'){voiceStatus(job.error||'Voice request failed',true);return;}
    if(!['transcribing','planning'].includes(job.phase)){if(job.transcript)$('prompt').value=job.transcript;
      voiceStatus(job.transcript?`Heard: ${job.transcript}`:'Voice request finished');await showProposal(job,job.transcript);return;}
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
$('mode').addEventListener('change',()=>{modeTouched=true;discardProposal();});
$('refresh-assets').addEventListener('click',()=>refreshAssets());
$('token').addEventListener('change',()=>refreshAssets());
refreshScenes();
