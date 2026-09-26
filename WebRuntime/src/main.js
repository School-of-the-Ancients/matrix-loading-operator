import './style.css';
import {MatrixWorld} from './protocol.js';
import {MatrixView} from './view.js';
import {MatrixBridge} from './bridge.js';
import {VoiceRecorder} from './voice.js';
import {CameraStream} from './camera_stream.js';
import {AgentClient,agentActivityLabel} from './agent_client.js';
import {captureAgentContext} from './agent_context.js';
import {loadStoredWorld,saveStoredWorld,restoreStoredWorld,restoreBestStoredWorld,storedWorld,storedBrowserWorld,
  saveCheckpoint,loadCheckpoint,loadCitizensDeletionRecovery,clearCitizensDeletionRecovery,
  WORLD_KEY} from './scene_store.js';
import {applyPCWorld} from './world_checkpoint.js';
import {loadConversation,rememberTurn,clearConversation} from './conversation.js';
import {startGame,deliverMovedObject,gameStatus,validSavedGame} from './game.js';
import {archiveAndClearRoom,archiveAndRebaseRoom,roomArchives,
  clearRoomArchives as clearStoredRoomArchives,ROOM_ARCHIVES_KEY} from './room_origin.js';
import {BlockScaleUI} from './block_scale_ui.js';
import {CitizensPanel} from './citizens_panel.js';
import {citizensFurnitureReadiness} from './citizens.js';

const $=id=>document.getElementById(id);
const world=new MatrixWorld();
const cameraStream=new CameraStream();
let scaleUI=null;
let citizensPanel=null;
let pendingWorld=loadStoredWorld(sessionStorage,localStorage);
let xrInitialized=false;

let proposal=null,gameProposal=null,operatorMessageUntil=0,lastOperatorReply='',lastConnectionOnline=null,modeTouched=false;
let conversation=loadConversation(sessionStorage);
let restoreArmedUntil=0;
let pcRestoreArmedUntil=0,pcRestoreName='';
let pcWorldBusy=false;
let roomResetArmedUntil=0;
let roomRecoveryChoice='';
let clearArchivesArmedUntil=0;
let persistenceWarning='',restoreWarning='';
let cameraBusy=false;
const recorder=new VoiceRecorder();let voiceStarting=false,voiceRecording=false,voiceStopRequested=false,voiceJob=null,voiceSnapshot=null,voiceDestination='planner',voiceAgentContext=null;
let replyContext=null,replySource=null;
let agentClient=null,agentActionBusy=false,agentVoiceStatus='';
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
const view=new MatrixView($('view'),world,()=>{discardProposal();scaleUI?.refreshTargets();citizensPanel?.render();feedback(`Selected ${world.selection.objectId||'placement point'} at ${Object.values(world.selection.position).join(', ')} m.`);},()=>$('token').value.trim(),message=>feedback(message,true),(id,position)=>{discardProposal();const delivered=deliverMovedObject(world,id);if(delivered)speakReply(delivered);renderScene();feedback(delivered||`Moved ${id.slice(0,8)} to ${Object.values(position).join(', ')} m. Undo and Save are available.`);},()=>{if(!view.isAR)cameraStream.stop();if(!view.isAR||!world.spatial?.originUnavailable){roomResetArmedUntil=0;roomRecoveryChoice='';}updateCameraControls();discardProposal();renderScene();},beginVoice,endVoice,()=>{$('speak-replies').checked=!$('speak-replies').checked;view.setVoiceOutputEnabled($('speak-replies').checked);unlockReplyAudio();},reviewView,newChat);
view.onPanelAction=panelAction;
view.onAssetReadinessChange=()=>citizensPanel?.render();
view.sync();
view.setVoiceOutputEnabled($('speak-replies').checked);
view.setConversationCount(conversation.length);
view.setOperatorGameStatus(gameStatus(world));
updateCameraControls();
$('conversation-status').textContent=`${conversation.length} recent turn${conversation.length===1?'':'s'} in this tab`;
function initXRIfReady(){
  if(xrInitialized)return;
  if(pendingWorld){$('xr-buttons').textContent='Loading saved world before XR';return;}
  xrInitialized=true;
  view.initXR($('xr-buttons')).catch(e=>feedback(e.message,true));
}
initXRIfReady();

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
  const originUnavailable=!!world.spatial?.originUnavailable;
  const resetAvailable=!!view.isAR&&originUnavailable&&view.roomAnchorRestoreFailed;
  const canRetryOrigin=originUnavailable&&(view.roomAnchorHandleAvailable||view.roomAnchorCreationFailed);
  const canConfirm=!!world.spatial&&!originUnavailable&&!world.spatial.alignmentVerified&&!world.spatial.stale&&
    world.spatial.anchors.some(anchor=>anchor.surface?.kind==='support');
  $('confirm-room').disabled=!canConfirm;
  for(const id of ['undo','redo','clear','save','restore'])$(id).disabled=originUnavailable||pcWorldBusy;
  for(const id of ['save-pc-world','restore-pc-world'])$(id).disabled=!!world.spatial||!!pendingWorld||pcWorldBusy;
  $('restore-pc-world').textContent=performance.now()<pcRestoreArmedUntil&&
    $('pc-worlds').value===pcRestoreName?'Confirm restore':'Restore world';
  view.setOperatorWorldInfo({objects:world.scene.objects.length,canConfirm,restoreArmed:performance.now()<restoreArmedUntil,
    originUnavailable,resetAvailable,canRetryOrigin,
    recoveryArmed:performance.now()<roomResetArmedUntil?roomRecoveryChoice:'',
    alignment:!world.spatial?'Virtual room':originUnavailable?'Room origin unavailable':world.spatial.alignmentVerified?'AR room aligned':
      canConfirm?'Check outlines, then confirm':'Waiting for room planes'});
  $('retry-room-origin').classList.toggle('hidden',!canRetryOrigin);
  $('reset-room-origin').classList.toggle('hidden',!resetAvailable);
  $('rebase-room-origin').classList.toggle('hidden',!resetAvailable);
  $('reset-room-origin').textContent=performance.now()<roomResetArmedUntil&&roomRecoveryChoice==='empty'?
    'Confirm archive and start empty':'Archive and start empty';
  $('rebase-room-origin').textContent=performance.now()<roomResetArmedUntil&&roomRecoveryChoice==='rebase'?
    'Confirm archive and place here':'Archive and place world here';
  $('room-origin-status').textContent=!view.isAR?'Room origin status appears in AR.':
    resetAvailable?canRetryOrigin?'Saved world hidden. Retry, place it here explicitly, or archive and start empty.':
      'Saved world hidden. Archive and place it here or start empty.':
    originUnavailable?'Waiting for a tracked room anchor; editing is paused.':
    view.roomAnchorLocated?'Room origin tracked.':'Room origin has not been tracked yet.';
  let hasArchives=false;
  try{hasArchives=roomArchives(localStorage).length>0;}
  catch{hasArchives=true;}
  $('download-room-archives').classList.toggle('hidden',!hasArchives);
  $('clear-room-archives').classList.toggle('hidden',!hasArchives);
  $('clear-room-archives').textContent=performance.now()<clearArchivesArmedUntil?
    'Confirm clear local recovery archives':'Clear local recovery archives after export';
  const status=gameStatus(world);
  $('game-status').textContent=status;view.setOperatorGameStatus(status);
  citizensPanel?.render();
  updateCameraControls();
}
function updateCameraControls(){
  const capability=cameraStream.capabilities();
  const active=cameraStream.active;
  $('enable-camera').disabled=!view.isAR||cameraBusy;
  $('enable-camera').textContent=active?'Stop environment camera':'Enable environment camera for AI review';
  $('camera-status').textContent=!view.isAR?'Enter AR to test the Quest environment camera.':
    active?`${capability.reason} Review View sends a labeled camera and virtual pair.`:
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
  citizensPanel?.syncFromWorld();
  view.sync();$('object-count').textContent=`${world.scene.objects.length} object${world.scene.objects.length===1?'':'s'}`;
  citizensPanel?.decorate(view);
  updateWorldControls();
  scaleUI?.refreshTargets();
  // applyPCWorld places a candidate on world while the PC exchange is pending.
  // No browser copy may be written until that exchange accepts or rolls back.
  if(!pendingWorld&&!pcWorldBusy){
    try{persistenceWarning=saveStoredWorld(storedBrowserWorld(world),sessionStorage,localStorage);}
    catch(error){persistenceWarning=`World save paused: ${error.message}. The previous valid browser copy was kept.`;}
    const deletionRecoveryFailed=persistenceWarning.startsWith('Citizens deletion recovery could not be preserved:');
    const durableFailed=persistenceWarning.includes('Persistent browser save failed');
    const tabOnlyFailed=persistenceWarning.startsWith('Tab world save failed:');
    view.setOperatorWarning(persistenceWarning?deletionRecoveryFailed?
      'CITIZENS RECOVERY SAVE BLOCKED · previous browser copy kept':durableFailed?
        'PERSISTENT SAVE FAILED · closing browser may lose world':tabOnlyFailed?
          'TAB COPY FAILED · durable world saved':'WORLD SAVE PAUSED · previous browser copy kept':
      restoreWarning?'Saved world rejected · new changes can save':'');
    if(persistenceWarning)feedback(deletionRecoveryFailed?persistenceWarning:durableFailed?
      'The current world changed, but durable storage failed.':tabOnlyFailed?
        'The tab recovery copy failed; the durable browser world was saved.':persistenceWarning,true);
  }
  // A deletion backup is written during saveStoredWorld, after the panel's
  // earlier render. Refresh its recovery control even if Citizens is paused.
  citizensPanel?.render();
  return persistenceWarning;
}
function confirmedDurableWorld(){
  try{
    const saved=JSON.parse(localStorage.getItem(WORLD_KEY)||'null');
    if(!Number.isSafeInteger(saved?.savedAtMs))return false;
    const {savedAtMs,...savedWorld}=saved;
    return JSON.stringify(savedWorld)===JSON.stringify(storedBrowserWorld(world));
  }catch{return false;}
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
citizensPanel=new CitizensPanel(world,{
  onChange:()=>{const warning=renderScene();void bridge.tick(true);return warning;},
  canMutate:()=>pcWorldBusy?'Wait for the current PC world save or restore to finish.':'',
  canStart:(mode='fixture')=>pendingWorld?'Finish saved-world recovery before starting Citizens.':
    world.spatial?'Citizens starts only in the desktop virtual room.':
    mode==='addition'?'':
    world.citizens?'Citizens is already in this world.':
    mode==='selected'?citizensFurnitureReadiness(world,world.selection.objectId):
    world.scene.objects.length||world.game?'Save or choose an empty world before starting this seeded scenario.':'',
  getRecovery:()=>loadCitizensDeletionRecovery(localStorage),
  canRecover:()=>pendingWorld?'Finish saved-world recovery before restoring the pre-deletion copy.':
    world.spatial?'Return to the desktop virtual room before restoring the pre-deletion copy.':
    pcWorldBusy?'Wait for the current PC world save or restore to finish.':'',
  onRecover:copy=>restoreStoredWorld(world,copy),
  confirmDurableRecovery:confirmedDurableWorld,
  clearRecovery:()=>clearCitizensDeletionRecovery(localStorage),
  onFeedback:feedback
});
scaleUI=new BlockScaleUI(world,id=>{
  const object=world.requireObject(id);
  world.setSelection(id,object.transform.position,object.anchorId);
  discardProposal();renderScene();void bridge.tick(true);
});
view.renderer.domElement.addEventListener('keydown',event=>{
  if(view.renderer.xr.isPresenting||event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;
  if(['Digit1','Digit2','Digit3','Digit4'].includes(event.code)){
    event.preventDefault();void scaleUI.viewportPreset(Number(event.code.at(-1)));
  }else if(event.code==='KeyR'){
    event.preventDefault();void scaleUI.viewportReset();
  }
});
bridge.getCaptureCapabilities=()=>cameraStream.capabilities();
function agentApprovalText(pending){
  if(!pending)return '';
  const guidance=pending.reviewable?'\nApprove only if this matches your request.':
    pending.action==='running_command'?
      '\nReview the exact command in the PC service console if one is attached; type approve or deny there. Browser approval is disabled. You can Deny or Stop here.':
      '\nApproval is unavailable here. Deny or Stop this turn.';
  return `${pending.summary||'Codex action needs PC review.'}${guidance}`;
}
function renderAgent(){
  const status=agentClient?.status,turns=status?.transcript||[],pending=status?.pendingApprovals?.[0];
  const activity=agentClient?.error?'Connection needs attention':status?agentActivityLabel(status.activity):'Not connected';
  $('agent-activity').textContent=activity;
  const access=({"read-only":"Read only", "workspace-write":"Workspace write", "danger-full-access":"Full PC access"})[status?.accessMode];
  const approvals=({reviewed:'Reviewed approvals',automatic:'Automatic approvals'})[status?.approvalMode];
  const accessLabel=access?`Codex access: ${access}${approvals?` · ${approvals}`:''}`:'';
  $('agent-access').textContent=access?`${accessLabel} (set on the PC gateway).`:'Access mode appears after connection.';
  const transcript=turns.slice(-4).map(turn=>{
    const user=turn.user.slice(0,1000),assistant=turn.assistant.slice(-2500);
    return `You: ${user}${turn.user.length>1000||turn.userTruncated?'\n[Part of request omitted from this view]':''}\n\nCodex: ${assistant||'…'}${turn.assistant.length>2500||turn.assistantTruncated?'\n[Earlier reply text omitted]':''}`;
  }).join('\n\n────────\n\n');
  const content=agentClient?.error?`Agent Portal: ${agentClient.error}\n\n${transcript}`:
    transcript||(status?'Ready. Send a message to Codex.':'Connect to start a Codex conversation.');
  $('agent-transcript').textContent=content;
  $('agent-connect').textContent=status?'Reconnect Codex':'Start or resume Codex';
  $('agent-approval').classList.toggle('hidden',!pending);
  $('agent-approval-summary').textContent=agentApprovalText(pending);
  $('agent-connect').disabled=agentActionBusy;
  $('agent-send').disabled=agentActionBusy||!status||!!agentClient.error||!!status.activeTurnId;
  $('agent-stop').disabled=agentActionBusy||!status?.activeTurnId;
  $('agent-approve').disabled=agentActionBusy||pending?.reviewable!==true;
  $('agent-deny').disabled=agentActionBusy;
  const latest=turns.at(-1);
  const inWorld=latest?`You: ${latest.user.slice(0,180)}${latest.user.length>180?'…':''}\n\nCodex: ${(latest.assistant||'…').slice(-900)}`:
    status?'Ready. Hold the trigger or grip to speak to Codex.':'Connect to Codex on the PC.';
  view.setOperatorAgentStatus({activity,content:[accessLabel,agentVoiceStatus,agentApprovalText(pending),
    agentClient?.error?`Connection: ${agentClient.error}`:'',inWorld].filter(Boolean).join('\n\n'),
    pending:!!pending,approvalReviewable:pending?.reviewable===true,
    active:!!status?.activeTurnId,connected:!!status&&!agentClient.error,
    voiceStatus:agentVoiceStatus,latestTurnId:latest?.turnId||''});
}
agentClient=new AgentClient((path,body)=>bridge.request(path,body),localStorage,renderAgent);
renderAgent();
if(agentClient.sessionId)agentClient.restore().catch(()=>{});
setInterval(()=>{if(agentClient.sessionId&&!agentClient.error&&!agentActionBusy)agentClient.poll().catch(()=>{});},800);
async function agentAction(action){
  if(agentActionBusy)return;
  agentActionBusy=true;renderAgent();
  try{await action();}
  catch(error){feedback(`Codex Agent: ${error.message}`,true);}
  finally{agentActionBusy=false;renderAgent();}
}
function sendAgent(){
  const text=$('agent-input').value.trim();
  if(!text){feedback('Enter a message for Codex first.',true);return;}
  const context=$('agent-include-context').checked?
    captureAgentContext(world,view,bridge.clientId,'text'):null;
  agentAction(async()=>{await agentClient.send(text,context);$('agent-input').value='';
    feedback(context?'Sent to Codex with Matrix spatial context.':'Sent to Codex.');});
}
function decideAgent(approve){
  const pending=agentClient.status?.pendingApprovals?.[0];
  if(!pending)return;
  if(approve&&pending.reviewable!==true){feedback('This action cannot be approved in XR. Deny or Stop it.',true);return;}
  agentAction(()=>agentClient.decide(pending.approvalId,pending.turnId,approve));
}
$('agent-connect').addEventListener('click',()=>agentAction(()=>agentClient.connect()));
$('agent-send').addEventListener('click',sendAgent);
$('agent-stop').addEventListener('click',()=>agentAction(()=>agentClient.cancel()));
$('agent-approve').addEventListener('click',()=>decideAgent(true));
$('agent-deny').addEventListener('click',()=>decideAgent(false));
$('agent-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey))sendAgent();});
$('token').addEventListener('change',()=>{if(agentClient.sessionId)agentClient.restore().catch(()=>{});});
async function refreshAssets(silent=false){
  try{
    const data=await bridge.request('/api/web/assets');
    const changed=world.registerAssets(data.assets||[]);
    view.refreshAssets(changed);
    $('asset-count').textContent=`${7+world.externalAssets.length} available`;
    if(pendingWorld){
      const restored=restoreBestStoredWorld(world,pendingWorld,localStorage);
      if(restored.state==='blocked'){
        restoreWarning=`${restored.reason}. Saved worlds remain untouched; free browser storage or export site data, then retry.`;
        feedback('World recovery is waiting for safe archive storage.',true);
        return;
      }
      pendingWorld=null;
      if(restored.state==='invalid')
        restoreWarning=`Saved browser worlds could not be restored: ${restored.rejected.map(item=>item.error).join('; ')}. Rejected copies were quarantined; the active world can now be saved.`;
      else if(restored.rejected.length)
        restoreWarning=`The newest browser world was invalid. Its raw copy was quarantined and the older ${restored.source} world was restored.`;
      renderScene();
      if(restored.rejected.length)feedback('World recovery needs attention.',true);
    }
    initXRIfReady();
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
async function refreshPCWorlds(){
  const data=await call('/api/web/worlds');if(!data)return;
  const select=$('pc-worlds'),current=select.value;
  select.replaceChildren(new Option('PC world checkpoints',''));
  for(const name of data.worlds||[])select.add(new Option(name,name));
  select.value=current;
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
  if(pcWorldBusy){feedback('Wait for the current PC world save or restore to finish.',true);return;}
  if(world.spatial?.originUnavailable){
    feedback('Recover the saved room origin before replacing a world checkpoint.',true);
    view.setOperatorWorldNotice('Save blocked: recover the room origin.','error');return;
  }
  citizensPanel?.pauseForCheckpoint();
  let value;
  try{value=storedBrowserWorld(world);}
  catch(error){feedback(`World checkpoint could not be saved: ${error.message}`,true);return;}
  const warning=saveCheckpoint(value.scene,value.game,localStorage,value.originBinding,value.originAnchorHandle,value.citizens??null);
  if(warning){feedback(warning,true);view.setOperatorWorldNotice('Browser checkpoint failed.','error');return;}
  view.setOperatorWorldNotice('Saved in browser · saving PC scene backup…','pending');
  const name=`WebWorld_${new Date().toISOString().replace(/[-:T.Z]/g,'').slice(0,14)}`;
  try{
    await bridge.request('/api/save',{name});
    view.setOperatorWorldNotice('Saved in browser · PC scene backup saved.');
    feedback(`World checkpoint saved in this browser. Scene-only PC backup: ${name}.`);refreshScenes();
  }catch(error){
    view.setOperatorWorldNotice('Saved in browser · PC scene backup failed.','error');
    feedback(`World checkpoint saved in this browser. PC scene backup failed: ${error.message}`,true);
  }
}
function restoreWorld(){
  if(pcWorldBusy){feedback('Wait for the current PC world save or restore to finish.',true);return;}
  if(world.spatial?.originUnavailable){
    feedback('Recover the saved room origin before restoring a checkpoint.',true);
    view.setOperatorWorldNotice('Restore blocked: recover the room origin.','error');return;
  }
  const checkpoint=loadCheckpoint(localStorage);
  if(!checkpoint){
    feedback('No manual world checkpoint is saved in this browser.',true);
    view.setOperatorWorldNotice('No browser checkpoint to restore.','error');return;
  }
  if(performance.now()>=restoreArmedUntil){
    restoreArmedUntil=performance.now()+10000;updateWorldControls();
    feedback('Tap Confirm Restore within ten seconds to replace the current scene.');
    view.setOperatorWorldNotice('Tap CONFIRM RESTORE within 10 seconds.','pending');return;
  }
  restoreArmedUntil=0;
  try{
    restoreStoredWorld(world,checkpoint);
    discardProposal();
    renderScene();feedback('World checkpoint restored in this browser.');
    view.setOperatorWorldNotice('Browser world checkpoint restored.');
    view.setOperatorStatus('World checkpoint restored.');
  }catch(error){
    feedback(`Checkpoint could not be restored: ${error.message}`,true);
    view.setOperatorWorldNotice('Browser checkpoint restore failed.','error');
  }
}
async function savePCWorld(){
  if(pcWorldBusy)return;
  const name=$('world-save-name').value.trim();
  if(!name){feedback('Enter a PC world checkpoint name.',true);return;}
  if(world.spatial||pendingWorld){feedback('PC world checkpoints require the ready desktop virtual room.',true);return;}
  citizensPanel?.pauseForCheckpoint();
  pcWorldBusy=true;updateWorldControls();feedback('Saving world and game progress on the PC…');
  try{
    await bridge.sync();
    if(world.spatial||pendingWorld)throw Error('The browser left the ready desktop virtual room');
    await bridge.request('/api/web/world/save',{name,world:storedWorld(world)});
    await refreshPCWorlds();$('pc-worlds').value=name;
    feedback(`PC world checkpoint saved: ${name}. Scene, game and Citizens progress are included.`);
  }catch(error){feedback(`PC world checkpoint was not saved: ${error.message}`,true);}
  finally{pcWorldBusy=false;renderScene();}
}
async function restorePCWorld(){
  if(pcWorldBusy)return;
  const name=$('pc-worlds').value;
  if(!name){feedback('Choose a PC world checkpoint.',true);return;}
  if(world.spatial||pendingWorld){feedback('Leave AR or finish browser recovery before restoring a PC world.',true);return;}
  if(performance.now()>=pcRestoreArmedUntil||pcRestoreName!==name){
    pcRestoreArmedUntil=performance.now()+10000;pcRestoreName=name;updateWorldControls();
    feedback(`Click Confirm restore within ten seconds to replace this browser world with ${name}.`);return;
  }
  pcRestoreArmedUntil=0;pcRestoreName='';updateWorldControls();
  citizensPanel?.pauseForCheckpoint();
  pcWorldBusy=true;updateWorldControls();feedback(`Checking PC world checkpoint ${name}…`);
  let restored=false,restoreError=null;
  try{
    await refreshAssets(true);
    await bridge.sync();
    const data=await bridge.request('/api/web/world/load',{name});
    if(world.spatial||pendingWorld)throw Error('The browser left the ready desktop virtual room');
    await bridge.withExclusiveExchange(()=>applyPCWorld(world,data.world,()=>bridge.sync(data.expectedRevision)));
    discardProposal();restored=true;
  }catch(error){restoreError=error;}
  finally{
    pcWorldBusy=false;
    const warning=renderScene();
    if(!restored)feedback(`PC world checkpoint could not be restored: ${restoreError.message}`,true);
    else if(warning||!confirmedDurableWorld())feedback(
      `PC world checkpoint restored in this tab, but the browser save could not be verified${warning?`: ${warning}`:'.'}`,true);
    else feedback(`PC world checkpoint restored: ${name}. Object IDs, game and Citizens progress are active.`);
  }
}
function retryRoomOrigin(){
  if(!view.retryRoomOrigin()){feedback('No room anchor can be retried in this session.',true);return;}
  roomResetArmedUntil=0;roomRecoveryChoice='';updateWorldControls();
  feedback('Retrying room anchor localization. Old world remains hidden until its saved origin is tracked.');
}
function recoverRoomOrigin(choice){
  if(!view.isAR||!world.spatial?.originUnavailable||!view.roomAnchorRestoreFailed)return;
  if(performance.now()>=roomResetArmedUntil||roomRecoveryChoice!==choice){
    roomRecoveryChoice=choice;
    roomResetArmedUntil=performance.now()+10000;updateWorldControls();
    feedback(choice==='rebase'?
      'Tap Confirm Archive and Place Here within ten seconds. This deliberately moves the old virtual world to a new physical origin after saving a local archive.':
      'Tap Confirm Archive and Start Empty within ten seconds. The old world will be archived locally; the new room starts empty.',true);
    return;
  }
  roomResetArmedUntil=0;roomRecoveryChoice='';
  try{
    const archive=choice==='rebase'?archiveAndRebaseRoom(world,localStorage):archiveAndClearRoom(world,localStorage);
    view.startNewRoomOrigin();discardProposal();renderScene();
    feedback(`Archived old world (${archive.archiveId.slice(0,8)}). ${choice==='rebase'?'It will appear at the new origin after tracking.':'The new room is empty.'} Export recovery archives from the browser panel.`);
  }catch(error){feedback(`Room reset stopped: ${error.message}. Old world remains hidden.`,true);}
}
function downloadRoomArchives(){
  try{
    const raw=localStorage.getItem(ROOM_ARCHIVES_KEY);
    if(!raw)throw Error('No room recovery archives exist');
    const blob=new Blob([raw],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='matrix-webxr-room-recovery.json';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    feedback('Prepared the room recovery archives for download. Keep the exported file before clearing browser site data.');
  }catch(error){feedback(`Could not export room archives: ${error.message}`,true);}
}
function clearExportedRoomArchives(){
  if(performance.now()>=clearArchivesArmedUntil){
    clearArchivesArmedUntil=performance.now()+10000;updateWorldControls();
    feedback('Verify your downloaded recovery file is saved. Tap Confirm Clear within ten seconds to remove local archives and free recovery slots.',true);
    return;
  }
  clearArchivesArmedUntil=0;
  try{clearStoredRoomArchives(localStorage);updateWorldControls();feedback('Local recovery archives cleared. The active world was not changed.');}
  catch(error){feedback(`Could not clear recovery archives: ${error.message}`,true);}
}
function panelAction(action){
  if(pcWorldBusy&&['undo','redo','clear'].includes(action)){
    feedback('Wait for the current PC world save or restore to finish.',true);return;
  }
  if(action==='agent-connect')agentAction(()=>agentClient.connect());
  else if(action==='agent-approve')decideAgent(true);
  else if(action==='agent-deny')decideAgent(false);
  else if(action==='agent-stop')agentAction(()=>agentClient.cancel());
  else if(action==='apply')applyProposal();
  else if(action==='discard'){discardProposal();feedback('Proposal discarded.');view.setOperatorStatus('Proposal discarded.');}
  else if(action==='confirm-room')confirmRoom();
  else if(action==='save-world')saveWorld();
  else if(action==='restore-world')restoreWorld();
  else if(action==='toggle-camera')toggleCamera();
  else if(action==='retry-room-origin')retryRoomOrigin();
  else if(action==='reset-room-origin')recoverRoomOrigin('empty');
  else if(action==='rebase-room-origin')recoverRoomOrigin('rebase');
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
$('retry-room-origin').addEventListener('click',retryRoomOrigin);
$('reset-room-origin').addEventListener('click',()=>recoverRoomOrigin('empty'));
$('rebase-room-origin').addEventListener('click',()=>recoverRoomOrigin('rebase'));
$('download-room-archives').addEventListener('click',downloadRoomArchives);
$('clear-room-archives').addEventListener('click',clearExportedRoomArchives);
$('new-chat').addEventListener('click',newChat);
$('speak-replies').addEventListener('change',()=>{view.setVoiceOutputEnabled($('speak-replies').checked);unlockReplyAudio();});
$('prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey))propose();});
$('discard').addEventListener('click',()=>{discardProposal();feedback('Proposal discarded.');});
$('apply').addEventListener('click',applyProposal);
function voiceStatus(message,isError=false,showInAgent=voiceDestination==='agent'){
  $('voice-status').textContent=message;$('xr-voice-status').textContent=message;
  feedback(message,isError);operatorMessageUntil=performance.now()+8000;
  view.setOperatorStatus(message,isError?'error':voiceRecording?'recording':'idle');
  if(showInAgent){agentVoiceStatus=message;renderAgent();}
}
function voiceButtons(){
  for(const id of ['voice-button','xr-voice']){$(id).textContent=voiceStarting||voiceRecording?'Tap to send':'Tap to speak';$(id).disabled=!!voiceJob;}
  view.setOperatorVoiceInputLabel(voiceStarting?'REQUESTING MIC':voiceRecording?'RELEASE TO SEND':voiceJob?'VOICE BUSY':'HOLD TO SPEAK');
}
async function beginVoice(){
  if(voiceStarting||voiceRecording)return;
  if(voiceJob){voiceStatus('Finish the current voice request before speaking again.',true,false);return;}
  voiceDestination=view.isOperatorAgentMode()?'agent':'planner';
  if(voiceDestination==='agent'&&(!agentClient?.status||agentClient.error)){
    voiceStatus('Reconnect to Codex first.',true);return;
  }
  if(voiceDestination==='agent'&&agentClient.status.activeTurnId){voiceStatus('Wait for Codex or stop the current turn.',true);return;}
  try{voiceAgentContext=voiceDestination==='agent'?captureAgentContext(world,view,bridge.clientId,'voice_transcript'):null;}
  catch(error){voiceStatus(`Could not capture Matrix context: ${error.message}`,true);return;}
  unlockReplyAudio();
  voiceStarting=true;voiceStopRequested=false;voiceButtons();voiceStatus('Requesting microphone…');
  try{await recorder.start();voiceRecording=true;voiceSnapshot=world.snapshot(view.viewer());voiceStatus('Recording… release the controller or tap Send.');}
  catch(error){voiceStatus(error.message,true);}
  finally{voiceStarting=false;voiceButtons();if(voiceStopRequested&&voiceRecording)endVoice();}
}
async function endVoice(){
  if(voiceStarting){voiceStopRequested=true;return;}
  if(!voiceRecording)return;
  voiceRecording=false;voiceJob='finalizing';voiceButtons();voiceStatus('Finishing recording…');
  try{const audioBase64=await recorder.stop();
    voiceStatus('Transcribing on PC…');
    if(voiceDestination==='agent'){
      voiceJob='agent-transcribe';voiceButtons();
      const transcript=await agentClient.transcribe(audioBase64);
      voiceStatus(`Heard: ${transcript}`);
      await agentClient.send(transcript,voiceAgentContext);
      voiceStatus('Sent to Codex with Matrix spatial context.');
    }else{
      voiceJob='planner-submit';voiceButtons();
      const job=await bridge.request('/api/voice',{clientId:bridge.clientId,snapshot:voiceSnapshot,audioBase64,conversation,webRuntime:true});
      voiceJob=job.jobId;voiceButtons();await pollVoice(voiceJob);
    }
  }
  catch(error){voiceStatus(error.message,true);}
  finally{voiceJob=null;voiceSnapshot=null;voiceAgentContext=null;voiceButtons();}
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
$('xr-exit').addEventListener('click',()=>view.exitXR());
for(const op of ['undo','redo','clear'])$(op).addEventListener('click',()=>call('/api/command',{op},`${op} queued.`));
$('save').addEventListener('click',async()=>{
  const name=$('save-name').value.trim();if(!name){feedback('Enter a scene name.',true);return;}
  const data=await call('/api/save',{name},`Saved ${name}.`);if(data)refreshScenes();
});
$('restore').addEventListener('click',async()=>{
  const name=$('saved-scenes').value;if(!name){feedback('Choose a saved scene.',true);return;}
  await call('/api/load',{name},`Restore of ${name} queued.`);
});
$('save-pc-world').addEventListener('click',savePCWorld);
$('restore-pc-world').addEventListener('click',restorePCWorld);
$('pc-worlds').addEventListener('change',()=>{pcRestoreArmedUntil=0;pcRestoreName='';updateWorldControls();});
$('mode').addEventListener('change',()=>{modeTouched=true;discardProposal();});
$('refresh-assets').addEventListener('click',()=>refreshAssets());
$('token').addEventListener('change',()=>refreshAssets());
refreshScenes();
refreshPCWorlds();
