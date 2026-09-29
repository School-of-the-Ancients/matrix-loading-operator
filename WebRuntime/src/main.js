import './style.css';
import {MatrixWorld} from './protocol.js';
import {MatrixView} from './view.js';
import {MatrixBridge} from './bridge.js';
import {VoiceRecorder} from './voice.js';
import {CameraStream,bindCameraPageLifecycle} from './camera_stream.js';
import {bindXRPageLifecycle} from './xr_session.js';
import {AgentClient,agentActivityLabel} from './agent_client.js';
import {deliverAgentVoiceTranscript} from './agent_voice_delivery.js';
import {deliverAgentTextDraft} from './agent_text_delivery.js';
import {ConceptUI} from './concept_ui.js';
import {PanoramaUI} from './panorama_ui.js';
import {loadCreationMode,saveCreationMode,creationModeFromPanelAction} from './creation_mode.js';
import {parsePanoramaIntent,parseConceptIntent,isSelectedConceptBuildRequest,
  stopPlannerConceptFallback,plannerVoiceFallbackAllowed} from './concept_intent.js';
import {validEnvironmentAsset,sameEnvironment} from './environment.js';
import {captureAgentContext,verifyAgentContextAtDelivery} from './agent_context.js';
import {bindBlenderRequestContext,captureBlenderPlacement,
  captureBlenderRequestContext,queueBlenderPlacement,
  registeredBlenderAsset} from './blender_placement.js';
import {routeOperatorRequest} from './operator_route.js';
import {loadStoredWorld,restoreStoredWorld,restoreBestStoredWorldWithEnvironment,storedWorld,storedBrowserWorld,
  saveCheckpoint,loadCheckpoint,loadCitizensDeletionRecovery,clearCitizensDeletionRecovery,
  WORLD_KEY} from './scene_store.js';
import {applyPCWorld,applyBrowserCheckpoint,captureWorldRestoreGuard} from './world_checkpoint.js';
import {startNewWorld,restoreWorldArchive,worldArchives,worldArchiveSummaries,
  executeWorldSlotCommand} from './world_slots.js';
import {refreshAssetCatalogs} from './catalog_refresh.js';
import {loadConversation,rememberTurn,clearConversation} from './conversation.js';
import {startGame,deliverMovedObject,recordGameEvent,gameStatus} from './game.js';
import {transitionCreatorMode,canPlayWorld} from './creator_mode.js';
import {createRigidPhysics} from './physics_rigid.js';
import {createPlayPersistence,PLAY_SAVE_INTERVAL_MS} from './play_persistence.js';
import {archiveAndClearRoom,archiveAndRebaseRoom,roomArchives,
  clearRoomArchives as clearStoredRoomArchives,ROOM_ARCHIVES_KEY} from './room_origin.js';
import {BlockScaleUI} from './block_scale_ui.js';
import {CitizensPanel} from './citizens_panel.js';
import {citizensFurnitureReadiness} from './citizens.js';
import {initializePanelSections,revealPanelSection,revealAgentAttention} from './panel_sections.js';

const $=id=>document.getElementById(id);
initializePanelSections($('world-operator-panel'),sessionStorage);
const sidebarToggle=$('toggle-sidebar');
sidebarToggle.addEventListener('click',()=>{
  const expanded=sidebarToggle.getAttribute('aria-expanded')==='true';
  sidebarToggle.setAttribute('aria-expanded',String(!expanded));
  sidebarToggle.textContent=expanded?'Show controls':'Hide controls';
});
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
let worldSwitchBusy=false,newWorldArmedUntil=0,archiveRestoreArmedUntil=0;
let archiveRestoreId='',selectedArchiveId='',archiveListSignature='',archiveStatusError='';
const playPersistence=createPlayPersistence(world,sessionStorage,localStorage,
  {canSave:()=>!pendingWorld&&!pcWorldBusy&&!worldSwitchBusy,now:()=>performance.now()});
let roomResetArmedUntil=0;
let roomRecoveryChoice='';
let clearArchivesArmedUntil=0;
let persistenceWarning='',restoreWarning='';
let cameraBusy=false;
const recorder=new VoiceRecorder();let voiceStarting=false,voiceRecording=false,voiceStopRequested=false,voiceJob=null,voiceSnapshot=null,voiceDestination='planner',voiceAgentContext=null,voiceBlenderPlacement=null;
let replyContext=null,replySource=null;
let agentClient=null,conceptUI=null,panoramaUI=null,agentActionBusy=false,agentVoiceStatus='',voiceSteerTurnId=null,agentAttentionKey='';
let creationMode=loadCreationMode(sessionStorage);
const pendingBlenderReceiptIds=new Set();
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
const view=new MatrixView($('view'),world,()=>{discardProposal();scaleUI?.refreshTargets();citizensPanel?.render();feedback(`Selected ${world.selection.objectId||'placement point'} at ${Object.values(world.selection.position).join(', ')} m.`);},()=>$('token').value.trim(),message=>feedback(message,true),(id,position)=>{discardProposal();const delivered=deliverMovedObject(world,id);if(delivered)speakReply(delivered);renderScene();feedback(delivered||`Moved ${id.slice(0,8)} to ${Object.values(position).join(', ')} m. Undo and Save are available.`);},()=>{if(!view.isAR){cameraStream.stop();bridge.cancelCapture();}if(!view.isAR||!world.spatial?.originUnavailable){roomResetArmedUntil=0;roomRecoveryChoice='';}updateCameraControls();discardProposal();renderScene();},beginVoice,endVoice,()=>{$('speak-replies').checked=!$('speak-replies').checked;view.setVoiceOutputEnabled($('speak-replies').checked);unlockReplyAudio();},reviewView,newChat);
view.onPanelAction=panelAction;
view.onSelectedPointChange=()=>{
  updateSelectedPointEditor();
  if(view.selectedPlacementTarget())$('agent-include-context').checked=true;
  void bridge.tick(true);
};
view.onXRHidden=()=>{cameraStream.stop();bridge.cancelCapture();updateCameraControls();};
bindCameraPageLifecycle(cameraStream,document,window,()=>{bridge.cancelCapture();updateCameraControls();});
bindXRPageLifecycle(()=>view.xrControls,document,window);
view.xrEntryBlocker=()=>pendingWorld||pcWorldBusy||worldSwitchBusy?
  'Finish world recovery or checkpoint restore before entering XR.':'';
function setConceptCreationMode(mode){
  creationMode=saveCreationMode(sessionStorage,mode);
  $('concept-creation-mode').value=creationMode;
  view.setOperatorCreationMode(creationMode);
}
$('concept-creation-mode').addEventListener('change',event=>{
  try{setConceptCreationMode(event.target.value);}
  catch(error){feedback(error.message,true);$('concept-creation-mode').value=creationMode;}
});
setConceptCreationMode(creationMode);
view.onAssetReadinessChange=()=>citizensPanel?.render();
view.onPlayInteraction=({kind,objectId,receipt})=>{
  if(!canPlayWorld(world.creatorMode))return;
  if(kind==='control'){
    const label=world.requireObject(objectId).control?.label||'World control';
    const state=receipt?.outcome?.controlState;
    updateWorldControls();
    persistCurrentWorld({errorPrefix:'World control save paused'});
    feedback(`${label}: setting ${(state?.index??0)+1} applied. The bound display and Agent state are current.${receipt?.outcome?.creatorHistoryCleared?' Earlier Creator Undo history was cleared to preserve Play progress.':''}`);
    return;
  }
  if(kind!=='release')return;
  const delivered=deliverMovedObject(world,objectId);
  if(delivered){refreshGameProgress();feedback(delivered);speakReply(delivered);}
  else persistCurrentWorld({errorPrefix:'Play release save paused'});
};
view.onPhysicsContacts=contacts=>{
  if(!canPlayWorld(world.creatorMode)||!world.game)return;
  let outcome=null;
  for(const contact of contacts){
    if(!contact.started)continue;
    for(const [objectId,targetObjectId] of [[contact.objectIdA,contact.objectIdB],
      [contact.objectIdB,contact.objectIdA]]){
      const target=world.scene.objects.find(item=>item.objectId===targetObjectId);
      if(!target?.rigidBody?.sensor)continue;
      outcome=recordGameEvent(world,{eventId:crypto.randomUUID(),event:'sensor-enter',
        objectId,targetObjectId})||outcome;
    }
  }
  if(outcome){refreshGameProgress();feedback(outcome.message);speakReply(outcome.message);}
};
view.sync();
view.setVoiceOutputEnabled($('speak-replies').checked);
view.setConversationCount(conversation.length);
view.setOperatorGameStatus(gameStatus(world));
view.setOperatorCreatorMode(world.creatorMode);
createRigidPhysics().then(engine=>{
  world.attachRigidPhysics(engine);
  view.sync();
  void bridge.tick(true);
}).catch(error=>feedback(`Rigid simulation unavailable: ${error.message}`,true));
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
  const creator=world.creatorMode;
  const environment=world.scene.environment;
  const environmentAsset=environment&&world.environmentAsset(environment.assetId);
  const environmentLabel=environment?
    `${environmentAsset?.displayName||environment.assetId} · yaw ${environment.yawDegrees}°`:
    'No panorama selected';
  $('environment-status').textContent=environment?
    `Panorama: ${environmentLabel}${view.isAR?' · hidden in AR to preserve passthrough':''}`:
    'Panorama: none. Desktop and VR use the neutral background.';
  panoramaUI?.updateAvailability();
  $('creator-mode-status').textContent=`${creator.mode==='creator'?'Creator Mode':'Play/Test Mode'} · simulation ${creator.simulation} · revision ${creator.revision}`;
  $('enter-play').disabled=!!pendingWorld||world.digitalWorldVisit||creator.mode==='play';
  $('enter-creator').disabled=!!pendingWorld||world.digitalWorldVisit||creator.mode==='creator';
  $('stop-play').disabled=!!pendingWorld||world.digitalWorldVisit||creator.mode!=='play'||creator.simulation==='paused';
  $('resume-play').disabled=!!pendingWorld||world.digitalWorldVisit||creator.mode!=='play'||creator.simulation==='running';
  view.setOperatorCreatorMode(creator);
  const originUnavailable=!!world.spatial?.originUnavailable;
  const resetAvailable=!!view.isAR&&!world.digitalWorldVisit&&originUnavailable&&view.roomAnchorRestoreFailed;
  const canRetryOrigin=originUnavailable&&(view.roomAnchorHandleAvailable||view.roomAnchorCreationFailed);
  const canConfirm=!!world.spatial&&!world.digitalWorldVisit&&!originUnavailable&&
    world.originFresh()&&world.planeFresh()&&
    !world.spatial.alignmentVerified&&!world.spatial.layoutReviewPending&&
    !world.spatial.stale&&
    world.spatial.anchors.some(anchor=>anchor.surface?.kind==='support');
  const canPlaceLayout=!!view.isAR&&!world.digitalWorldVisit&&!originUnavailable&&
    !world.spatial?.stale&&world.originFresh()&&view.roomAnchorLocated&&
    view.roomAnchorPersistent&&world.originBinding==='ar'&&!!world.originAnchorHandle&&
    creator.mode==='creator'&&creator.simulation==='paused'&&!pendingWorld&&
    !pcWorldBusy&&!worldSwitchBusy;
  $('confirm-room').disabled=!canConfirm;
  for(const id of ['undo','redo','clear','save','restore'])
    $(id).disabled=(world.digitalWorldVisit||originUnavailable)||!!pendingWorld||pcWorldBusy||worldSwitchBusy||
      (creator.mode==='play'&&id!=='save');
  $('save-pc-world').disabled=!!world.spatial||!!pendingWorld||pcWorldBusy||worldSwitchBusy||
    creator.simulation==='running';
  $('restore-pc-world').disabled=!!world.spatial||!!pendingWorld||pcWorldBusy||worldSwitchBusy||
    creator.mode!=='creator';
  $('apply').disabled=!!pendingWorld||pcWorldBusy||worldSwitchBusy;
  $('restore-pc-world').textContent=performance.now()<pcRestoreArmedUntil&&
    $('pc-worlds').value===pcRestoreName?'Confirm restore':'Restore world';
  let archives=[];
  try{archives=worldArchiveSummaries(localStorage);archiveStatusError='';}
  catch(error){archiveStatusError=error.message;}
  const archiveSignature=JSON.stringify(archives);
  if(archiveSignature!==archiveListSignature){
    archiveListSignature=archiveSignature;
    if(!archives.some(item=>item.archiveId===selectedArchiveId))
      selectedArchiveId=archives.at(-1)?.archiveId||'';
    $('world-archives').replaceChildren(new Option(archiveStatusError||
      (archives.length?'Choose an archived world':'No archived worlds'),''),
      ...archives.map(item=>new Option(`${item.name} · ${item.objectCount} objects`,item.archiveId)));
    $('world-archives').value=selectedArchiveId;
  }
  const archiveReady=creator.mode==='creator'&&creator.simulation==='paused'&&
    !world.digitalWorldVisit&&!originUnavailable&&!world.spatial?.stale&&!pendingWorld&&!pcWorldBusy&&
    !worldSwitchBusy&&!archiveStatusError;
  $('new-world').disabled=!archiveReady;
  $('restore-archive').disabled=!archiveReady||!selectedArchiveId;
  $('world-archives').disabled=!archiveReady||!archives.length;
  $('new-world').textContent=performance.now()<newWorldArmedUntil?
    'Confirm new world':'Archive + new world';
  $('restore-archive').textContent=performance.now()<archiveRestoreArmedUntil&&
    selectedArchiveId===archiveRestoreId?'Confirm restore':'Restore archive';
  const archiveIndex=archives.findIndex(item=>item.archiveId===selectedArchiveId);
  const selectedArchive=archives[archiveIndex];
  view.setOperatorWorldInfo({objects:world.scene.objects.length,canConfirm,restoreArmed:performance.now()<restoreArmedUntil,
    canPlaceLayout,arLayoutOffset:world.arLayoutOffset,
    layoutReviewPending:!!world.spatial?.layoutReviewPending,
    environmentLabel:environment?`Panorama: ${environmentLabel}${view.isAR?' · AR hidden':''}`:
      'Panorama: none',
    originUnavailable,resetAvailable,canRetryOrigin,
    recoveryArmed:performance.now()<roomResetArmedUntil?roomRecoveryChoice:'',
    archiveCount:archives.length,archiveIndex:Math.max(0,archiveIndex),
    archiveReady,
    archiveName:selectedArchive?.name||'',archiveDetails:selectedArchive?
      `${selectedArchive.objectCount} objects${selectedArchive.gameTitle?` · ${selectedArchive.gameTitle}`:''}`:'',
    newWorldArmed:performance.now()<newWorldArmedUntil,
    archiveRestoreArmed:performance.now()<archiveRestoreArmedUntil&&
      selectedArchiveId===archiveRestoreId,
    alignment:!world.spatial?'Virtual room':world.digitalWorldVisit?
      originUnavailable?'AR visit view unavailable':view.roomAnchorLocated?'Digital world overlay anchored':'Digital world preview':
      originUnavailable?'Room origin unavailable':world.spatial.layoutReviewPending?'Digital layout review required':
      world.spatial.alignmentVerified?'Room outlines confirmed':
      canConfirm?'Check outlines, then confirm':'Waiting for room planes'});
  $('retry-room-origin').classList.toggle('hidden',!canRetryOrigin);
  $('reset-room-origin').classList.toggle('hidden',!resetAvailable);
  $('rebase-room-origin').classList.toggle('hidden',!resetAvailable);
  $('reset-room-origin').textContent=performance.now()<roomResetArmedUntil&&roomRecoveryChoice==='empty'?
    'Confirm archive and start empty':'Archive and start empty';
  $('rebase-room-origin').textContent=performance.now()<roomResetArmedUntil&&roomRecoveryChoice==='rebase'?
    'Confirm archive and place here':'Archive and place world here';
  $('room-origin-status').textContent=!view.isAR?'Room origin status appears in AR.':
    world.digitalWorldVisit?(originUnavailable?'AR overlay hidden until its view anchor tracks again. Citizens continues in the digital world.':'Visiting the live digital world. Room tracking places its view only.'):
    resetAvailable?canRetryOrigin?'Saved world hidden. Retry, place it here explicitly, or archive and start empty.':
      'Saved world hidden. Archive and place it here or start empty.':
    originUnavailable?'Waiting for a tracked room anchor; editing is paused.':
    world.spatial?.layoutReviewPending?'Review the digital layout and physical clearance in the headset before confirming room outlines.':
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
  updateSelectedPointEditor();
}
function updateSelectedPointEditor(){
  const point=view.selectedPlacementTarget();
  const label=point?.anchorId==='web-floor'?'virtual floor':
    world.spatial?.anchors.find(anchor=>anchor.anchorId===point?.anchorId)?.displayName||
    point?.anchorId||'';
  $('target-point-status').textContent=point?
    `${label} · ${point.source} point · Y 0 m`:
    view.selectedPoint?'Selected point is stale. Aim and select again.':
      'Aim at a support surface and click or press trigger to pin a point.';
  for(const axis of ['x','z']){
    const input=$(`target-point-${axis}`);
    input.disabled=!point;
    if(document.activeElement!==input)input.value=point?String(point.position[axis]):'';
  }
  $('target-point-set').disabled=!point;
  $('target-point-clear').disabled=!view.selectedPoint;
}
function updateCameraControls(){
  const capability=cameraStream.capabilities();
  const active=cameraStream.active;
  $('enable-camera').disabled=!view.isAR||cameraBusy;
  $('enable-camera').textContent=active?'Stop environment camera':'Enable environment camera for AI review';
  $('review-view').textContent=active&&view.isAR?
    'Share camera + virtual view with Codex':'Share virtual view with Codex';
  $('camera-status').textContent=!view.isAR?'Enter AR to test the Quest environment camera.':
    active?`${capability.reason} Share View sends one labeled camera and virtual image to Codex.`:
    capability.reason;
  view.setOperatorCameraStatus(!view.isAR?'Enter AR to test':active?'Active · SEND VIEW shares camera + virtual image with CODEX':
    capability.mixedStatus==='denied'?'Permission denied':capability.mixedStatus==='error'?'Camera unavailable':'Enable to test',active);
}
async function toggleCamera(){
  if(cameraBusy)return;
  if(cameraStream.active){cameraStream.stop();bridge.cancelCapture();updateCameraControls();feedback('Environment camera stopped. Visual review is virtual only.');return;}
  if(!view.isAR){feedback('Enter AR before testing the environment camera.',true);return;}
  cameraBusy=true;updateCameraControls();
  try{
    await cameraStream.enable();
    feedback('Environment camera available. SEND VIEW will share one labeled camera and virtual image with CODEX.');
  }catch(error){feedback(!view.isAR?'AR ended. Camera stopped; virtual-only review remains available.':
    `${error.message} Virtual-only visual review remains available.`,true);}
  finally{cameraBusy=false;updateCameraControls();bridge.tick(true);}
}

function showPersistenceStatus(){
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
function persistCurrentWorld({periodic=false,quiet=false,errorPrefix='World save paused'}={}){
  // applyPCWorld places a candidate on world while the PC exchange is pending.
  // No browser copy may be written until that exchange accepts or rolls back.
  if(pendingWorld||pcWorldBusy||worldSwitchBusy)return false;
  try{
    const outcome=playPersistence.persist({periodic});
    if(!outcome.attempted)return false;
    persistenceWarning=outcome.warning;
  }catch(error){
    persistenceWarning=`${errorPrefix}: ${error.message}. The previous valid browser copy was kept.`;
  }
  if(!quiet)showPersistenceStatus();
  return true;
}
function renderScene(){
  citizensPanel?.syncFromWorld();
  view.sync();$('object-count').textContent=`${world.scene.objects.length} object${world.scene.objects.length===1?'':'s'}`;
  citizensPanel?.decorate(view);
  updateWorldControls();
  scaleUI?.refreshTargets();
  persistCurrentWorld();
  // A deletion backup is written during saveStoredWorld, after the panel's
  // earlier render. Refresh its recovery control even if Citizens is paused.
  citizensPanel?.render();
  return persistenceWarning;
}
function refreshGameProgress(){
  view.refreshGamePresentation();
  updateWorldControls();
  persistCurrentWorld({errorPrefix:'World progress save paused'});
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
    if(pendingBlenderReceiptIds.has(event.result.requestId)){
      feedback(`Blender spawn ${event.result.requestId} has a browser receipt; checking the PC acknowledgement.`,
        !event.result.ok);
      return;
    }
    const outcome=event.result.outcome;
    const message=event.result.ok?
      outcome?.gameEvent?.message||
        (outcome?.kind==='world-archives'?
          `Found ${outcome.total} browser world archive${outcome.total===1?'':'s'}.`:
        outcome?.kind==='world-created'?
          `New world ready; archived ${outcome.archived.name}.`:
        outcome?.kind==='world-restored'?
          `Restored ${outcome.restored.name}; archived the prior world as ${outcome.archived.name}.`:
        (outcome?.kind==='entity-inspection'?
          `Inspected ${event.result.objectId.slice(0,8)} · ${outcome.availableActions.join(', ')||'read only'}`:
          `Applied ${event.result.requestId.slice(0,8)}${event.result.objectId?` · ${event.result.objectId.slice(0,8)}`:''}`)):
      `Command failed: ${event.result.error}`;
    feedback(message,!event.result.ok);lastOperatorReply=lastOperatorReply?`${lastOperatorReply}\n\n${message}`:message;operatorMessageUntil=Infinity;view.setOperatorStatus(lastOperatorReply,event.result.ok?'idle':'error');
  }
});
bridge.prepareEnvironment=environment=>view.prepareEnvironment(environment);
bridge.onWorldSlotCommand=async command=>{
  if(command.op==='list_world_archives')
    return executeWorldSlotCommand(world,command,sessionStorage,localStorage);
  const blocker=worldSwitchBlocker({fromAgent:true});
  if(blocker)throw Error(blocker);
  if(command.op==='restore_world_archive'){
    const target=worldArchives(localStorage).find(item=>
      item.archiveId===command.archiveId);
    if(target?.world?.scene?.environment)
      await view.prepareEnvironment(target.world.scene.environment);
  }
  // This command is executing inside the exchange, so it cannot wait for an
  // exclusive exchange. The archive transaction itself is synchronous.
  worldSwitchBusy=true;
  let outcome;
  try{
    outcome=executeWorldSlotCommand(world,command,sessionStorage,localStorage);
  }finally{worldSwitchBusy=false;}
  // Presentation failures must not turn a committed switch into a failed
  // receipt. The bridge's scene event will also refresh the world view.
  try{
    selectedArchiveId=outcome.archived.archiveId;
    newWorldArmedUntil=0;archiveRestoreArmedUntil=0;archiveRestoreId='';
    view.setOperatorWorldNotice(outcome.kind==='world-restored'?
      `Restored ${outcome.restored.name}; prior world archived.`:
      `New world ready; archived ${outcome.archived.name}.`);
    updateWorldControls();
  }catch(error){console.warn('World switch presentation refresh failed',error);}
  return outcome;
};
// A saved world needs its catalog before it can be the authoritative browser
// snapshot. Do not exchange an empty startup scene while recovery is pending.
bridge.exchangePaused=!!pendingWorld;
bridge.rejectPendingOnNextExchange=!!pendingWorld;
citizensPanel=new CitizensPanel(world,{
  onChange:()=>{const warning=renderScene();void bridge.tick(true);return warning;},
  canMutate:()=>pendingWorld?'Finish saved-world recovery before changing Citizens.':
    pcWorldBusy?'Wait for the current PC world save or restore to finish.':'',
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
    const user=turn.user.length>1000?
      `${turn.user.slice(0,520)}\n[Earlier request text omitted]\n${turn.user.slice(-440)}`:
      turn.user;
    const assistant=turn.assistant.slice(-2500);
    return `You: ${user}${turn.user.length>1000||turn.userTruncated?'\n[Part of request omitted from this view]':''}\n\nCodex: ${assistant||'…'}${turn.assistant.length>2500||turn.assistantTruncated?'\n[Earlier reply text omitted]':''}`;
  }).join('\n\n────────\n\n');
  const content=agentClient?.error?`Agent Portal: ${agentClient.error}\n\n${transcript}`:
    transcript||(status?'Ready. Send a message to Codex.':'Connect to start a Codex conversation.');
  $('agent-transcript').textContent=content;
  $('agent-connect').textContent=status?'Reconnect Codex':'Start or resume Codex';
  $('agent-approval').classList.toggle('hidden',!pending);
  $('agent-approval-summary').textContent=agentApprovalText(pending);
  agentAttentionKey=revealAgentAttention($('section-agent'),agentAttentionKey,
    status?.activeTurnId,pending);
  $('agent-connect').disabled=agentActionBusy;
  const sendLabel=status?.activeTurnId?'Add to current turn':'Send to Codex';
  if($('agent-send').textContent!==sendLabel)$('agent-send').textContent=sendLabel;
  const sendHint=status?.activeTurnId?
    'Add an instruction while Codex works. It stays in this turn; earlier world changes are not undone.':
    'Send starts a turn in this Codex conversation.';
  if($('agent-send-hint').textContent!==sendHint)$('agent-send-hint').textContent=sendHint;
  $('agent-send').disabled=agentActionBusy||!status||!!agentClient.error;
  $('agent-stop').disabled=agentActionBusy||!status?.activeTurnId;
  $('agent-approve').disabled=agentActionBusy||pending?.reviewable!==true;
  $('agent-deny').disabled=agentActionBusy;
  const latest=turns.at(-1);
  const inWorldUser=latest?.user.length>180?
    `${latest.user.slice(0,75)}… ${latest.user.slice(-95)}`:latest?.user;
  const inWorld=latest?`You: ${inWorldUser}\n\nCodex: ${(latest.assistant||'…').slice(-900)}`:
    status?'Ready. Hold the trigger or grip to speak to Codex.':'Connect to Codex on the PC.';
  const conceptStatus=conceptUI?.statusForWorld()||'';
  const panoramaStatus=panoramaUI?.statusForWorld()||'';
  view.setOperatorAgentStatus({activity,content:[accessLabel,conceptStatus,panoramaStatus,agentVoiceStatus,agentApprovalText(pending),
    status?.activeTurnId?'Hold to add an instruction to this turn, or choose Stop. Earlier world edits remain.':'',
    agentClient?.error?`Connection: ${agentClient.error}`:'',inWorld].filter(Boolean).join('\n\n'),
    pending:!!pending,approvalReviewable:pending?.reviewable===true,
    active:!!status?.activeTurnId,connected:!!status&&!agentClient.error,
    voiceStatus:agentVoiceStatus,latestTurnId:latest?.turnId||''});
  view.setOperatorConceptGallery(conceptUI?.galleryForWorld()||[]);
  view.setOperatorPanoramaGallery(panoramaUI?.galleryForWorld()||[]);
  panoramaUI?.render();
}
agentClient=new AgentClient((path,body)=>bridge.request(path,body),localStorage,renderAgent);
conceptUI=new ConceptUI({request:(path,body)=>bridge.request(path,body),
  ensureSession:async()=>{
    if(!agentClient.status||agentClient.error)await agentClient.connect();
    return agentClient.sessionId;
  },getSession:()=>agentClient.sessionId,getToken:()=>$('token').value.trim(),onChange:renderAgent});
conceptUI.bind();
function panoramaActionBlocker(){
  if(pendingWorld)return 'Finish saved-world recovery before applying a panorama.';
  if(pcWorldBusy||worldSwitchBusy)return 'Wait for the current world save or restore.';
  if(view.isAR||world.spatial)return 'Leave AR to apply a panorama; passthrough stays visible there.';
  if(world.digitalWorldVisit)return 'Return to the editable digital world to apply a panorama.';
  if(world.scene.roomId!=='web-virtual-room-v1')return 'Open the editable virtual world to apply a panorama.';
  if(world.creatorMode.mode!=='creator'||world.creatorMode.simulation!=='paused')
    return 'Pause Play/Test and return to Creator Mode before applying a panorama.';
  if(world.agentGrab)return 'Release the held object before applying a panorama.';
  return '';
}
async function waitForPanoramaStatus(requestId,target,objectIds){
  if(!/^[0-9a-f]{32}$/.test(requestId||''))throw Error('Panorama action returned no valid request ID.');
  for(let attempt=0;attempt<70;attempt++){
    await bridge.tick(true);
    const result=await bridge.request(`/api/agent/environments/actions/${requestId}`);
    if(result?.requestId!==requestId)throw Error(`Panorama receipt ${requestId} changed; inspect the world.`);
    if(result.status==='succeeded'){
      if(!sameEnvironment(world.scene.environment??null,target)||
        JSON.stringify(world.scene.objects.map(item=>item.objectId))!==JSON.stringify(objectIds))
        throw Error(`Panorama receipt ${requestId} succeeded but the local world changed; inspect it before another action.`);
      renderScene();
      return result;
    }
    if(result.status==='failed')throw Error(`Panorama request ${requestId} failed: ${result.error||'inspect the exact receipt'}`);
    if(result.status==='unconfirmed')throw Error(`Panorama request ${requestId} is unconfirmed; inspect its status and the world before retrying.`);
    if(result.status!=='queued')throw Error(`Panorama request ${requestId} has an unknown status; inspect it before retrying.`);
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  throw Error(`Panorama request ${requestId} has no confirmed result yet; inspect its status before retrying.`);
}
async function changeWorldPanorama(action,asset=null,yawDegrees=0){
  const blocker=panoramaActionBlocker();if(blocker)throw Error(blocker);
  let target=null;
  const generation=world.authoredGeneration;
  if(action==='set'){
    if(!validEnvironmentAsset(asset))throw Error('Generated panorama registration is invalid.');
    await refreshAssets(true,{strict:true});
    const loaded=world.environmentAsset(asset.assetId);
    if(!loaded||loaded.sha256!==asset.sha256)
      throw Error('Registered panorama is missing from the refreshed browser catalog.');
    target={schemaVersion:1,kind:'equirectangular',assetId:asset.assetId,
      sha256:asset.sha256,yawDegrees};
    await view.prepareEnvironment(target);
  }
  if(world.authoredGeneration!==generation||panoramaActionBlocker())
    throw Error('World changed while preparing the panorama; inspect it before applying.');
  await bridge.sync();
  const state=await bridge.request('/api/state');
  if(!state?.online||state.clientId!==bridge.clientId||
    state.snapshot?.scene?.roomId!==world.scene.roomId||
    !sameEnvironment(state.snapshot.scene.environment??null,world.scene.environment??null)||
    panoramaActionBlocker())
    throw Error('Connected world changed; inspect its current scene before applying a panorama.');
  const objectIds=world.scene.objects.map(item=>item.objectId);
  const queued=await bridge.request('/api/agent/environments/action',{
    action,room_id:world.scene.roomId,scene_revision:state.revision,
    ...(action==='set'?{asset_id:asset.assetId,yaw_degrees:yawDegrees}:{})});
  if(!queued?.requestId)throw Error('Panorama action has no request ID; inspect the world before retrying.');
  return waitForPanoramaStatus(queued.requestId,target,objectIds);
}
panoramaUI=new PanoramaUI({client:conceptUI.client,
  ensureSession:async()=>{
    if(!agentClient.status||agentClient.error)await agentClient.connect();
    return agentClient.sessionId;
  },getSession:()=>agentClient.sessionId,getToken:()=>$('token').value.trim(),
  canApply:panoramaActionBlocker,removeAvailable:()=>!!world.scene.environment,
  apply:(asset,yaw)=>changeWorldPanorama('set',asset,yaw),
  remove:()=>changeWorldPanorama('remove'),onChange:renderAgent});
panoramaUI.bind();
renderAgent();
if(agentClient.sessionId)agentClient.restore().then(()=>conceptUI.refresh()).catch(()=>{});
setInterval(()=>{if(agentClient.sessionId&&!agentClient.error&&!agentActionBusy)agentClient.poll().catch(()=>{});},800);
setInterval(()=>{if(agentClient.sessionId&&!conceptUI.busy)
  conceptUI.refresh().then(()=>panoramaUI.advanceQueue()).catch(()=>{});},2400);
async function agentAction(action){
  if(agentActionBusy)return;
  agentActionBusy=true;renderAgent();
  try{await action();}
  catch(error){feedback(`Codex Agent: ${error.message}`,true);}
  finally{agentActionBusy=false;renderAgent();}
}
async function currentAgentContextForSend(captured){
  await bridge.sync();
  return verifyAgentContextAtDelivery(captured,
    captureAgentContext(world,view,bridge.clientId,captured.inputSource));
}
function sendAgent(){
  const text=$('agent-input').value.trim();
  if(!text){feedback('Enter a message for Codex first.',true);return;}
  if(agentClient.status?.activeTurnId){
    const turnId=agentClient.status.activeTurnId;
    agentAction(async()=>{
      const context=$('agent-include-context').checked?
        captureAgentContext(world,view,bridge.clientId,'text'):null;
      await deliverAgentTextDraft($('agent-input'),text,submitted=>
        agentClient.steer(submitted,context,turnId));
      feedback('Added to the current Codex turn. Check Matrix receipts before repeating an action.');
    });
    return;
  }
  if(parsePanoramaIntent(text)){
    agentAction(async()=>{const message=await deliverAgentTextDraft($('agent-input'),text,
      submitted=>panoramaUI.handleText(submitted));
      feedback(message);view.setOperatorStatus(message);});
    return;
  }
  if(parseConceptIntent(text)){
    agentAction(async()=>{const message=await deliverAgentTextDraft($('agent-input'),text,
      submitted=>conceptUI.handleText(submitted));
      feedback(message);view.setOperatorStatus(message);});
    return;
  }
  agentAction(async()=>{
    const withContext=await deliverAgentTextDraft($('agent-input'),text,async submitted=>{
      const expectedConcept=await conceptUI.expectedBuild(submitted);
      const includeContext=Boolean($('agent-include-context').checked||expectedConcept);
      if(includeContext)await bridge.sync();
      const context=includeContext?
        captureAgentContext(world,view,bridge.clientId,'text'):null;
      await agentClient.send(submitted,context,expectedConcept,creationMode);
      return !!context;
    });
    feedback(withContext?'Sent to Codex with Matrix spatial context.':'Sent to Codex.');});
}
function decideAgent(approve){
  const pending=agentClient.status?.pendingApprovals?.[0];
  if(!pending)return;
  if(approve&&pending.reviewable!==true){feedback('This action cannot be approved in XR. Deny or Stop it.',true);return;}
  agentAction(()=>agentClient.decide(pending.approvalId,pending.turnId,approve));
}
$('agent-connect').addEventListener('click',()=>agentAction(async()=>{
  await agentClient.connect();await conceptUI.refresh();}));
$('agent-send').addEventListener('click',sendAgent);
$('agent-stop').addEventListener('click',()=>agentAction(()=>agentClient.cancel()));
$('agent-approve').addEventListener('click',()=>decideAgent(true));
$('agent-deny').addEventListener('click',()=>decideAgent(false));
$('agent-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey))sendAgent();});
$('token').addEventListener('change',()=>{if(agentClient.sessionId)agentClient.restore().catch(()=>{});});
async function refreshAssets(silent=false,{strict=false}={}){
  try{
    const {data,environmentError}=await refreshAssetCatalogs(world,
      path=>bridge.request(path),changed=>view.refreshAssets(changed));
    view.syncEnvironment();
    $('asset-count').textContent=`${7+world.externalAssets.length} objects · ${world.environmentAssets.length} panoramas`;
    if(pendingWorld){
      const restored=await restoreBestStoredWorldWithEnvironment(world,pendingWorld,
        localStorage,environment=>{
          if(environmentError)throw Error(`Panorama catalog unavailable: ${environmentError.message}`);
          return view.prepareEnvironment(environment);
        });
      if(restored.state==='waiting'){
        const dependencies=restored.missingAssets||restored.missingGenerators||[];
        const missing=dependencies.slice(0,3).join(', ');
        const more=dependencies.length>3?
          ` and ${dependencies.length-3} more`:'';
        restoreWarning=restored.reason?.startsWith('Saved panorama could not be verified:')?
          `${restored.reason}. Browser copies remain untouched. Restore the registered image and choose Refresh assets.`:
          restored.missingGenerators?
          `Saved world needs reviewed generator source ${missing}${more}. Browser copies remain untouched. Restore that code version and reload.`:
          `Saved world is waiting for registered assets or panoramas: ${missing}${more}. Browser copies remain untouched. Restore the catalog and choose Refresh assets.`;
        view.setOperatorWarning(restored.missingGenerators?
          'SAVED WORLD WAITING FOR GENERATOR SOURCE':
          restored.reason?.startsWith('Saved panorama could not be verified:')?
            'SAVED WORLD WAITING FOR PANORAMA':'SAVED WORLD WAITING FOR WEB ASSETS');
        updateWorldControls();
        feedback('World recovery is waiting for required assets.',true);
        return;
      }
      if(restored.state==='blocked'){
        restoreWarning=`${restored.reason}. Saved worlds remain untouched; free browser storage or export site data, then retry.`;
        view.setOperatorWarning('SAVED WORLD RECOVERY BLOCKED');
        updateWorldControls();
        feedback('World recovery is waiting for safe archive storage.',true);
        return;
      }
      pendingWorld=null;
      bridge.exchangePaused=false;
      restoreWarning='';
      if(restored.state==='invalid')
        restoreWarning=`Saved browser worlds could not be restored: ${restored.rejected.map(item=>item.error).join('; ')}. Rejected copies were quarantined; the active world can now be saved.`;
      else if(restored.rejected.length)
        restoreWarning=`The newest browser world was invalid. Its raw copy was quarantined and the older ${restored.source} world was restored.`;
      renderScene();
      void bridge.tick(true);
      if(restored.rejected.length)feedback('World recovery needs attention.',true);
    }
    initXRIfReady();
    if(!silent)feedback(environmentError?
      `Object catalog updated; panorama catalog unavailable: ${environmentError.message}`:
      `Catalog updated: ${world.externalAssets.length} web assets.`,!!environmentError);
    return data;
  }catch(error){
    if(pendingWorld){
      restoreWarning=`Saved world is waiting for the asset catalogs: ${error.message}. Browser copies remain untouched; Refresh assets will retry.`;
      view.setOperatorWarning('SAVED WORLD WAITING FOR WEB ASSET CATALOG');
      updateWorldControls();
      feedback('World recovery is waiting for the asset catalog.',true);
    }else if(!silent)feedback(error.message,true);
    if(strict)throw error;
    return null;
  }
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
setInterval(()=>persistCurrentWorld({periodic:true,
  errorPrefix:'Play simulation save paused'}),PLAY_SAVE_INTERVAL_MS);
addEventListener('beforeunload',()=>{
  if(canPlayWorld(world.creatorMode)&&world.scene.objects.some(object=>
    object.rigidBody?.type==='dynamic'))persistCurrentWorld({quiet:true});
  conceptUI?.destroy();panoramaUI?.destroy();cameraStream.stop();bridge.stop();
});

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
function operatorRoute(text){
  if(parsePanoramaIntent(text))return {destination:'panorama',reason:'generated-panorama'};
  if(parseConceptIntent(text))return {destination:'concept',reason:'image-concept'};
  if(isSelectedConceptBuildRequest(text))
    return {destination:'agent',reason:'selected-concept-build'};
  return routeOperatorRequest(text,{assets:world.snapshot().assets,
    savedScenes:[...$('saved-scenes').options].map(option=>option.value).filter(Boolean),
    presentation:world.runtimePresentation});
}
async function sendToAgentFromChat(text,context){
  view.showOperatorAgentMode();
  if(!agentClient.status||agentClient.error)await agentClient.connect();
  if(agentClient.status?.activeTurnId)throw Error('Wait for the current CODEX turn or stop it first.');
  const expectedConcept=await conceptUI.expectedBuild(text);
  const currentContext=await currentAgentContextForSend(context);
  if(/\b(?:in front of me|ahead of me|where i am pointing)\b/i.test(text)&&!currentContext.viewerFrame)
    throw Error('Current viewer tracking is unavailable. Restore tracking, then send this spatial request again.');
  await agentClient.send(text,currentContext,expectedConcept,creationMode);
  const message='Sent this request to CODEX with the current Matrix context. Review its tools and Matrix receipts in the CODEX panel.';
  feedback(message);view.setOperatorStatus(message);
}
async function propose(){
  const text=$('prompt').value.trim();if(!text){feedback('Enter a request first.',true);return;}
  const route=operatorRoute(text);
  if(route.destination==='panorama'){
    $('propose').disabled=true;
    try{const message=await panoramaUI.handleText(text);
      feedback(message);view.setOperatorStatus(message);}
    catch(error){feedback(`Panorama: ${error.message}`,true);
      view.setOperatorStatus(`Panorama: ${error.message}`,'error');}
    finally{$('propose').disabled=false;}
    return;
  }
  if(route.destination==='concept'){
    $('propose').disabled=true;
    try{const message=await conceptUI.handleText(text);
      feedback(message);view.setOperatorStatus(message);}
    catch(error){feedback(`Image concept: ${error.message}`,true);
      view.setOperatorStatus(`Image concept: ${error.message}`,'error');}
    finally{$('propose').disabled=false;}
    return;
  }
  if(pendingWorld){feedback('Finish saved-world recovery before planning scene changes.',true);return;}
  if(route.destination==='agent'){
    const context=captureAgentContext(world,view,bridge.clientId,'text');
    $('propose').disabled=true;
    try{await sendToAgentFromChat(text,context);}
    catch(error){feedback(`CODEX route: ${error.message}`,true);
      view.setOperatorStatus(`CODEX route: ${error.message}`,'error');}
    finally{$('propose').disabled=false;}
    return;
  }
  let blenderPlacement;
  try{blenderPlacement=await captureBlenderRequestContext(world,view,bridge);}
  catch(error){feedback(error.message,true);view.setOperatorStatus(error.message,'error');return;}
  unlockReplyAudio();
  $('propose').disabled=true;feedback('Planning…');
  const data=await call('/api/plan',{text,mode:$('mode').value,conversation,webRuntime:true});$('propose').disabled=false;
  if(!data)return;
  await showProposal(data,text,blenderPlacement);
}
let reviewBusy=false;
async function captureAndWait(mode){
    const requested=await bridge.request('/api/capture',{mode});
    const deadline=performance.now()+(mode==='mixed'?44000:20000);
    while(performance.now()<deadline){
      let state;
      try{state=await bridge.request('/api/state',undefined,
        {timeoutMs:Math.max(1,Math.min(3000,Math.ceil(deadline-performance.now())))});}
      catch(error){if(error?.name!=='TimeoutError')throw error;continue;}
      const capture=state.capture;
      if(capture?.captureId!==requested.captureId)throw Error('Capture was replaced; please retry review');
      if(capture.status==='error'||capture.status==='stale')throw Error(capture.error||'Capture failed');
      if(capture.status==='ready')return capture;
      await new Promise(resolve=>setTimeout(resolve,Math.min(400,Math.max(0,deadline-performance.now()))));
    }
    throw Error('Rendered view capture timed out');
}
async function reviewView(){
  if(reviewBusy)return;
  reviewBusy=true;unlockReplyAudio();
  try{
    if(pendingWorld)throw Error('Finish saved-world recovery before sharing a view.');
    view.showOperatorAgentMode();
    if(!agentClient.status||agentClient.error)await agentClient.connect();
    if(agentClient.status?.activeTurnId)throw Error('Wait for the current CODEX turn or stop it first.');
    let mode=cameraStream.active&&view.isAR?'mixed':'virtual';
    feedback(mode==='mixed'?'Capturing environment camera and virtual view for CODEX…':
      'Capturing a virtual-only view for CODEX; no physical camera pixels…');
    view.setOperatorStatus(mode==='mixed'?'Capturing two labeled views to share with CODEX…':
      'Capturing a virtual-only view to share with CODEX…');
    let ready;
    try{ready=await captureAndWait(mode);}
    catch(error){
      if(mode!=='mixed')throw error;
      feedback(`Environment camera capture failed: ${error.message}. Retrying with a virtual-only image; no physical pixels will be shared.`,true);
      mode='virtual';
      // The service rate-limits capture requests even after a failed mixed image.
      await new Promise(resolve=>setTimeout(resolve,2200));
      ready=await captureAndWait(mode);
    }
    const physical=ready.source==='webxr_camera_pair'&&ready.mode==='mixed'&&
      ready.includesPhysicalCamera===true&&ready.includesPassthrough===false&&
      ready.layout?.calibrated===false;
    const virtual=ready.source==='webxr_virtual_center_eye'&&ready.mode==='virtual'&&
      ready.includesPhysicalCamera===false&&ready.includesPassthrough===false;
    if((mode==='mixed'&&!physical)||(mode==='virtual'&&!virtual))
      throw Error('The captured image source did not match the selected review mode. Capture again.');
    const context=captureAgentContext(world,view,bridge.clientId,'text');
    const request=physical?
      'Review the one image I explicitly shared. Its left panel is an uncalibrated environment-camera frame and its right panel is a Matrix virtual render. Identify visible physical details and virtual objects separately. The panels are not pixel aligned; use measured room planes, not camera pixels, for spatial constraints. Do not change the world.':
      'Review the one virtual-only Matrix image I explicitly shared. It contains virtual objects and may show room outlines, but no physical camera pixels. Describe the visible virtual composition without claiming to see my physical room. Use measured room planes for physical constraints. Do not change the world.';
    view.setOperatorStatus(physical?'Sharing one labeled physical-camera and virtual image with CODEX…':
      'Sharing one virtual-only image with CODEX; no physical pixels…');
    await agentClient.send(request,context,null,'auto',ready.captureId);
    const message=physical?'Shared one labeled camera + virtual image with CODEX. The views are not calibrated.':
      'Shared one virtual-only image with CODEX. No physical room pixels were included.';
    feedback(message);view.setOperatorStatus(message);
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
async function pollBlender(jobId,request,blenderPlacement){
  for(let attempt=0;attempt<600;attempt++){
    const job=await bridge.request(`/api/web/blender/${jobId}`);
    if(job.phase==='error')throw Error(job.error||'Blender asset creation failed');
    if(job.phase==='ready'){
      let asset,result;
      try{
        const catalog=await refreshAssets(true,{strict:true});
        asset=registeredBlenderAsset(world,job,catalog);
        if(!blenderPlacement||pendingWorld||pcWorldBusy||worldSwitchBusy)
          throw Error('Request-time world context is unavailable; choose a fresh placement target');
        result=await queueBlenderPlacement(world,view,bridge,blenderPlacement,asset,
          {onQueued:id=>pendingBlenderReceiptIds.add(id)});
      }catch(error){
        throw Error(`Blender job ${jobId} registered ${job.asset?.assetId||'an asset'}, but placement was not confirmed: ${error.message}`);
      }
      pendingBlenderReceiptIds.delete(result.requestId);
      world.setSelection(result.objectId,world.requireObject(result.objectId).transform.position,
        world.requireObject(result.objectId).anchorId);
      renderScene();
      void bridge.tick(true);
      const message=`Created ${asset.displayName} in Blender and loaded it at the requested ${world.spatial?'AR':'virtual'} target. PC-confirmed Matrix spawn receipt ${result.requestId}${result.objectId?` · object ${result.objectId}`:''}.`;
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
async function showProposal(data,requestText='',blenderPlacement=null){
  if(data.authoringJobId){
    proposal=null;$('proposal').classList.add('hidden');
    try{await pollBlender(data.authoringJobId,data.transcript||requestText||$('prompt').value.trim(),blenderPlacement);}
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
  if(pending)revealPanelSection($('section-planner'));
  feedback(pending?'Review the proposal, then Apply in the world or browser.':data.message||'No scene edits proposed.');
}
async function applyProposal(){
  if(world.digitalWorldVisit){feedback('Leave the AR visit before editing the digital world.',true);return;}
  if(pendingWorld||pcWorldBusy||worldSwitchBusy){feedback('Finish world recovery or switching before applying a proposal.',true);return;}
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
  if(world.spatial?.layoutReviewPending){
    feedback('Review the digital layout and its physical clearance in the headset first.',true);return;
  }
  const result=await call('/api/command',{op:'confirm_room'},'Measured room outline confirmation queued.');
  if(result)view.setOperatorStatus('Measured room outline confirmation queued. Wait for the runtime receipt.');
}
async function saveWorld(){
  if(world.digitalWorldVisit){feedback('Leave the AR visit before making a manual checkpoint. Browser progress continues to save.',true);return;}
  if(pendingWorld||worldSwitchBusy){feedback('Finish world recovery or switching before saving a checkpoint.',true);return;}
  if(pcWorldBusy){feedback('Wait for the current PC world save or restore to finish.',true);return;}
  if(world.spatial?.originUnavailable){
    feedback('Recover the saved room origin before replacing a world checkpoint.',true);
    view.setOperatorWorldNotice('Save blocked: recover the room origin.','error');return;
  }
  citizensPanel?.pauseForCheckpoint();
  let value;
  try{value=storedBrowserWorld(world);}
  catch(error){feedback(`World checkpoint could not be saved: ${error.message}`,true);return;}
  const warning=saveCheckpoint(value.scene,value.game,localStorage,value.originBinding,
    value.originAnchorHandle,value.citizens??null,value.creatorMode,value.rigidGravity,
    value.controlStates,value.rigidMotion,value.arLayoutOffset);
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
async function restoreWorld(){
  if(world.digitalWorldVisit){feedback('Leave the AR visit before restoring a world.',true);return;}
  if(world.creatorMode.mode!=='creator'){
    feedback('Return to Creator Mode before restoring a browser checkpoint.',true);return;
  }
  if(pendingWorld||worldSwitchBusy){feedback('Finish world recovery or switching before restoring a checkpoint.',true);return;}
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
  citizensPanel?.pauseForCheckpoint();
  worldSwitchBusy=true;updateWorldControls();
  let restored=false;
  try{
    await applyBrowserCheckpoint(world,checkpoint,bridge,
      environment=>view.prepareEnvironment(environment),()=>{
        if(view.grab||view.pointerGrab)
          throw Error('Release the held object before restoring a checkpoint');
      });
    discardProposal();
    restored=true;
    view.setOperatorWorldNotice('Browser world checkpoint restored.');
    view.setOperatorStatus('World checkpoint restored.');
  }catch(error){
    feedback(`Checkpoint could not be restored: ${error.message}`,true);
    view.setOperatorWorldNotice('Browser checkpoint restore failed.','error');
  }finally{
    worldSwitchBusy=false;
    renderScene();
    if(restored)feedback('World checkpoint restored in this browser.');
  }
}
async function savePCWorld(){
  if(pcWorldBusy||worldSwitchBusy)return;
  if(world.creatorMode.simulation==='running'){
    feedback('Pause Play/Test before saving a PC world checkpoint.',true);return;
  }
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
  if(pcWorldBusy||worldSwitchBusy)return;
  if(view.xrControls?.busy){feedback('Wait for the XR session to finish starting or stopping before restoring a PC world.',true);return;}
  if(world.creatorMode.mode!=='creator'){
    feedback('Return to Creator Mode before restoring a PC world.',true);return;
  }
  const name=$('pc-worlds').value;
  if(!name){feedback('Choose a PC world checkpoint.',true);return;}
  if(world.spatial||pendingWorld){feedback('Leave AR or finish browser recovery before restoring a PC world.',true);return;}
  if(performance.now()>=pcRestoreArmedUntil||pcRestoreName!==name){
    pcRestoreArmedUntil=performance.now()+10000;pcRestoreName=name;updateWorldControls();
    feedback(`Click Confirm restore within ten seconds to replace this browser world with ${name}.`);return;
  }
  pcRestoreArmedUntil=0;pcRestoreName='';updateWorldControls();
  citizensPanel?.pauseForCheckpoint();
  const unchanged=captureWorldRestoreGuard(world);
  pcWorldBusy=true;updateWorldControls();feedback(`Checking PC world checkpoint ${name}…`);
  let restored=false,restoreError=null;
  try{
    await refreshAssets(true);
    unchanged();
    await bridge.sync();
    unchanged();
    const data=await bridge.request('/api/web/world/load',{name});
    await bridge.withExclusiveExchange(async syncExclusive=>{
      unchanged();
      if(world.spatial||pendingWorld)throw Error('The browser left the ready desktop virtual room');
      if(data.world?.scene?.environment)
        await view.prepareEnvironment(data.world.scene.environment);
      unchanged();
      if(view.grab||view.pointerGrab)
        throw Error('Release the held object before restoring a PC world');
      // applyPCWorld stages the candidate while the guarded PC exchange is
      // pending. Keep direct pointer/controller edits off that staged world.
      const wasReadOnly=view.readOnly;
      view.readOnly=true;
      try{await applyPCWorld(world,data.world,()=>syncExclusive(data.expectedRevision));}
      finally{view.readOnly=wasReadOnly;}
    });
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
function worldSwitchBlocker({fromAgent=false}={}){
  if(world.digitalWorldVisit)return 'Leave the AR visit before switching digital worlds.';
  if(pendingWorld||pcWorldBusy||worldSwitchBusy)return 'Finish the current world recovery or checkpoint first.';
  if(world.creatorMode.mode!=='creator'||world.creatorMode.simulation!=='paused')
    return 'Return to paused Creator Mode before switching worlds.';
  if(world.spatial?.originUnavailable||world.spatial?.stale)
    return 'Recover the room origin or tracking before switching worlds.';
  if(view.grab||view.pointerGrab||world.agentGrab||
     world.rigidPhysics?.states().some(state=>state.held))
    return 'Release grabbed objects before switching worlds.';
  if(voiceRecording||voiceStarting||reviewBusy||agentActionBusy||proposal||gameProposal||
     (!fromAgent&&(voiceJob||agentClient?.status?.activeTurnId)))
    return 'Finish the current Operator request or proposal before switching worlds.';
  if(archiveStatusError)return archiveStatusError;
  return '';
}
const worldArchiveName=()=>{
  const entered=$('world-archive-name').value.trim();
  if(entered)return entered;
  const title=(world.game?.spec?.title||'Matrix world').slice(0,44);
  return `${title} · ${new Date().toISOString().slice(0,19).replace('T',' ')}`;
};
async function switchBrowserWorld(action,preflight=async()=>{}){
  const blocker=worldSwitchBlocker();
  if(blocker){feedback(blocker,true);view.setOperatorWorldNotice(blocker,'error');return;}
  citizensPanel?.pauseForCheckpoint();
  const unchanged=captureWorldRestoreGuard(world);
  worldSwitchBusy=true;updateWorldControls();
  let switched=false;
  try{
    const result=await bridge.withExclusiveExchange(async()=>{
      unchanged();
      await preflight();
      unchanged();
      if(view.grab||view.pointerGrab)
        throw Error('Release the held object before switching worlds');
      const switched=action();
      // Any PC command queued against the prior world needs fresh inspection.
      bridge.rejectPendingOnNextExchange=true;
      return switched;
    });
    switched=true;
    selectedArchiveId=result.archived.archiveId;
    discardProposal();
    view.setOperatorWorldNotice(result.restored?
      `Restored ${result.restored.name}; prior world archived.`:
      `New world ready; archived ${result.archived.name}.`);
    feedback(result.restored?
      `Restored ${result.restored.name}. The world it replaced is archived as ${result.archived.name}.`:
      `New world ready. The previous scene, game and progress are archived as ${result.archived.name}.`);
  }catch(error){
    feedback(error.message,true);
    view.setOperatorWorldNotice(error.message,'error');
  }finally{
    worldSwitchBusy=false;
    renderScene();
    if(switched)void bridge.tick(true);
  }
}
async function beginNewWorld(){
  const blocker=worldSwitchBlocker();
  if(blocker){feedback(blocker,true);return;}
  if(performance.now()>=newWorldArmedUntil){
    newWorldArmedUntil=performance.now()+10000;archiveRestoreArmedUntil=0;
    updateWorldControls();
    feedback('Confirm within ten seconds. The complete current world will be archived and a separate empty world will open.');
    view.setOperatorWorldNotice('Confirm archive + new world within 10 seconds.','pending');
    return;
  }
  newWorldArmedUntil=0;
  await switchBrowserWorld(()=>startNewWorld(world,sessionStorage,localStorage,
    worldArchiveName()));
}
async function restoreSelectedArchive(){
  const blocker=worldSwitchBlocker();
  if(blocker){feedback(blocker,true);return;}
  const archiveId=selectedArchiveId;
  if(!archiveId){feedback('Choose an archived world first.',true);return;}
  if(performance.now()>=archiveRestoreArmedUntil||archiveRestoreId!==archiveId){
    archiveRestoreArmedUntil=performance.now()+10000;archiveRestoreId=archiveId;
    newWorldArmedUntil=0;updateWorldControls();
    feedback('Confirm within ten seconds to restore the selected world. The current world will be archived first.');
    view.setOperatorWorldNotice('Confirm archived world restore within 10 seconds.','pending');
    return;
  }
  archiveRestoreArmedUntil=0;archiveRestoreId='';
  await switchBrowserWorld(()=>restoreWorldArchive(world,archiveId,
    sessionStorage,localStorage,worldArchiveName()),async()=>{
    const target=worldArchives(localStorage).find(item=>item.archiveId===archiveId);
    if(!target)throw Error('Selected world archive no longer exists');
    const environment=target.world.scene.environment;
    if(environment)await view.prepareEnvironment(environment);
    const current=worldArchives(localStorage).find(item=>item.archiveId===archiveId);
    if(JSON.stringify(current?.world)!==JSON.stringify(target.world))
      throw Error('Selected world archive changed during restore preparation');
  });
}
function selectAdjacentArchive(direction){
  let archives;
  try{archives=worldArchiveSummaries(localStorage);}
  catch(error){feedback(error.message,true);return;}
  if(!archives.length){feedback('No archived world is available.',true);return;}
  const current=archives.findIndex(item=>item.archiveId===selectedArchiveId);
  selectedArchiveId=archives[(current+direction+archives.length)%archives.length].archiveId;
  $('world-archives').value=selectedArchiveId;
  archiveRestoreArmedUntil=0;archiveRestoreId='';updateWorldControls();
}
function retryRoomOrigin(){
  if(!view.retryRoomOrigin()){feedback('No room anchor can be retried in this session.',true);return;}
  roomResetArmedUntil=0;roomRecoveryChoice='';updateWorldControls();
  feedback('Retrying room anchor localization. Old world remains hidden until its saved origin is tracked.');
}
function recoverRoomOrigin(choice){
  if(world.digitalWorldVisit){feedback('The AR view origin cannot archive or replace the digital world.',true);return;}
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
function changeCreatorMode(action){
  if(world.digitalWorldVisit){feedback('Leave the AR visit before changing the digital world mode.',true);return;}
  if(pendingWorld||pcWorldBusy||worldSwitchBusy){feedback('Finish world recovery or switching before changing modes.',true);return;}
  if(action==='enter-play'&&world.scene.objects.some(item=>item.rigidBody)&&
     !world.rigidPhysics){feedback('Wait for rigid physics to load before playing.',true);return;}
  try{
    for(const state of world.rigidPhysics?.states()||[])
      if(state.held)world.releaseRigidGrab(state.objectId);
    const command={'enter-play':'enter-play','enter-creator':'enter-creator',
      'stop-play':'stop','resume-play':'resume'}[action];
    world.creatorMode=transitionCreatorMode(world.creatorMode,command,
      world.creatorMode.revision);
    renderScene();
    void bridge.tick(true);
    feedback(`${world.creatorMode.mode==='creator'?'Creator Mode':'Play/Test Mode'} · simulation ${world.creatorMode.simulation}. World and progress retained.`);
  }catch(error){feedback(error.message,true);}
}

function panelAction(action){
  if(/^layout-(forward|back|left|right|turn-left|turn-right)$/.test(action)){
    if(pendingWorld||pcWorldBusy||worldSwitchBusy||bridge.inFlight||
       bridge.receiptWaiters.size||bridge.commandGuards.size||
       agentClient?.status?.activeTurnId||agentClient?.status?.pendingApprovals?.length||
       agentActionBusy||voiceJob||proposal||gameProposal||pendingBlenderReceiptIds.size){
      feedback('Finish the active Operator turn or world exchange before placing the digital layout.',true);return;
    }
    try{
      const offset=view.adjustARLayout(action);
      discardProposal();
      bridge.rejectPendingOnNextExchange=
        'Digital layout moved before this command ran; inspect the room and retry';
      void bridge.tick(true);
      const message=`Digital layout x ${offset.x.toFixed(2)} m, z ${offset.z.toFixed(2)} m, yaw ${offset.yawDegrees}°. Check object clearance and room outlines before measured edits.`;
      const durable=confirmedDurableWorld();
      feedback(durable?message:
        `${message} Browser save was not verified; keep this tab open and inspect the save warning.`,
      !durable);
    }catch(error){feedback(error.message,true);}
    return;
  }
  if(action==='confirm-layout'){
    try{
      view.confirmARLayoutReview();
      feedback('Digital layout review recorded for this AR session. Check room outlines, then confirm them separately to enable measured edits.');
    }catch(error){feedback(error.message,true);}
    return;
  }
  const panoramaRetry=/^panorama-retry-([1-9]\d*)$/.exec(action);
  if(panoramaRetry){
    agentAction(()=>panoramaUI._run(()=>panoramaUI.retryPreviewVersion(Number(panoramaRetry[1]))));
    return;
  }
  const panoramaSelect=/^panorama-select-([1-9]\d*)$/.exec(action);
  if(panoramaSelect){
    agentAction(()=>panoramaUI._run(()=>panoramaUI.selectVersion(Number(panoramaSelect[1]))));
    return;
  }
  const panoramaApply=/^panorama-apply-([1-9]\d*)$/.exec(action);
  if(panoramaApply){
    const chosen=panoramaUI.client.selectedPanorama;
    const expected={conceptId:chosen?.conceptId,version:Number(panoramaApply[1])};
    agentAction(()=>panoramaUI._run(()=>panoramaUI.applySelected(expected)));
    return;
  }
  const conceptRetry=/^concept-retry-([1-9]\d*)$/.exec(action);
  if(conceptRetry){
    const version=Number(conceptRetry[1]);
    if(!Number.isSafeInteger(version)){feedback('Invalid concept version.',true);return;}
    agentAction(()=>conceptUI._run(()=>conceptUI.retryPreviewVersion(version)));
    return;
  }
  const conceptSelection=/^concept-select-([1-9]\d*)$/.exec(action);
  if(conceptSelection){
    const version=Number(conceptSelection[1]);
    if(!Number.isSafeInteger(version)){feedback('Invalid concept version.',true);return;}
    agentAction(async()=>{
      const selected=await conceptUI._run(()=>conceptUI.selectVersion(version));
      if(selected)feedback(`Image Version ${version} selected for the next explicit build.`);
    });
    return;
  }
  const selectedMode=creationModeFromPanelAction(action);
  if(selectedMode){setConceptCreationMode(selectedMode);return;}
  if(['enter-play','enter-creator','stop-play','resume-play'].includes(action)){
    changeCreatorMode(action);return;
  }
  if((pendingWorld||worldSwitchBusy)&&['apply','save-world','restore-world',
    'undo','redo','clear'].includes(action)){
    feedback('Finish saved-world recovery before changing the world.',true);return;
  }
  if(pcWorldBusy&&['apply','undo','redo','clear'].includes(action)){
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
  else if(action==='new-world')void beginNewWorld();
  else if(action==='restore-archive')void restoreSelectedArchive();
  else if(action==='archive-prev')selectAdjacentArchive(-1);
  else if(action==='archive-next')selectAdjacentArchive(1);
  else if(action==='toggle-camera')toggleCamera();
  else if(action==='retry-room-origin')retryRoomOrigin();
  else if(action==='reset-room-origin')recoverRoomOrigin('empty');
  else if(action==='rebase-room-origin')recoverRoomOrigin('rebase');
  else if(action==='undo'||action==='redo')call('/api/command',{op:action},`${action} queued.`);
}
$('propose').addEventListener('click',propose);
$('blender-request').addEventListener('click',async()=>{
  if(pendingWorld){feedback('Finish saved-world recovery before creating and placing an asset.',true);return;}
  const prompt=$('prompt').value.trim();if(!prompt){feedback('Describe the object to create first.',true);return;}
  unlockReplyAudio();
  const button=$('blender-request');button.disabled=true;
  try{const blenderPlacement=await captureBlenderRequestContext(world,view,bridge);
    const job=await bridge.request('/api/web/blender',{prompt});
    await pollBlender(job.jobId,prompt,blenderPlacement);}
  catch(error){feedback(error.message,true);view.setOperatorStatus(error.message,'error');}
  finally{button.disabled=false;}
});
$('review-view').addEventListener('click',reviewView);
$('enable-camera').addEventListener('click',toggleCamera);
$('confirm-room').addEventListener('click',confirmRoom);
$('target-point-set').addEventListener('click',()=>{
  try{
    const x=$('target-point-x').value.trim(),z=$('target-point-z').value.trim();
    if(!x||!z)throw Error('Enter both X and Z coordinates');
    const point=view.editSelectedPoint(Number(x),Number(z));
    feedback(`Destination marker moved on ${point.anchorId}. The point is advisory until the current room and object footprint are checked.`);
    updateSelectedPointEditor();
  }catch(error){feedback(error.message,true);updateSelectedPointEditor();}
});
$('target-point-clear').addEventListener('click',()=>{
  view.clearSelectedPoint();feedback('Destination marker cleared.');
});
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
  voiceSteerTurnId=voiceDestination==='agent'?agentClient.status.activeTurnId:null;
  try{voiceBlenderPlacement=voiceDestination==='planner'?captureBlenderPlacement(world,view):null;}
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
  let voiceTranscriptStaged=false;
  try{const audioBase64=await recorder.stop();
    voiceAgentContext=captureAgentContext(world,view,bridge.clientId,'voice_transcript');
    voiceStatus('Transcribing on PC…');
    if(voiceDestination==='agent'){
      voiceJob='agent-transcribe';voiceButtons();
      const transcript=await agentClient.transcribe(audioBase64);
      voiceStatus(`Heard: ${transcript}`);
      voiceTranscriptStaged=true;
      const delivered=await deliverAgentVoiceTranscript({agentClient,input:$('agent-input'),
        transcript,context:voiceAgentContext,capturedTurnId:voiceSteerTurnId,
        resolveContext:()=>currentAgentContextForSend(voiceAgentContext),
        deliverWhenIdle:async()=>{
          if(parsePanoramaIntent(transcript)){
            const message=await panoramaUI.handleText(transcript);
            voiceStatus(message);return 'handled';
          }
          if(parseConceptIntent(transcript)){
            const message=await conceptUI.handleText(transcript);
            voiceStatus(message);return 'handled';
          }
          const expectedConcept=await conceptUI.expectedBuild(transcript);
          const currentContext=await currentAgentContextForSend(voiceAgentContext);
          if(/\b(?:in front of me|ahead of me|where i am pointing)\b/i.test(transcript)&&
              !currentContext.viewerFrame)
            throw Error('Current viewer tracking is unavailable. Restore tracking, then say the spatial request again.');
          await agentClient.send(transcript,currentContext,expectedConcept,creationMode);
          return 'sent';
        }});
      if(delivered==='steered')voiceStatus('Added to the current Codex turn.');
      else if(delivered==='sent')voiceStatus('Sent to Codex with Matrix spatial context.');
    }else{
      if(!agentClient.status||agentClient.error){
        try{await agentClient.connect();await conceptUI.refresh();}
        catch(error){
          if(!plannerVoiceFallbackAllowed($('mode').value))
            throw Error(`Codex connection failed. Reconnect Codex before speaking: ${error.message}`);
        }
      }
      if(agentClient.status&&!agentClient.error){
        voiceJob='agent-transcribe';voiceButtons();
        const transcript=await agentClient.transcribe(audioBase64);
        voiceStatus(`Heard: ${transcript}`);
        if(parsePanoramaIntent(transcript)){
          $('prompt').value=transcript;
          const message=await panoramaUI.handleText(transcript);
          voiceStatus(message);return;
        }
        if(parseConceptIntent(transcript)){
          $('prompt').value=transcript;
          const message=await conceptUI.handleText(transcript);
          voiceStatus(message);return;
        }
        if(pendingWorld)throw Error('Finish saved-world recovery before planning scene changes.');
        if(operatorRoute(transcript).destination==='agent'){
          $('prompt').value=transcript;
          await sendToAgentFromChat(transcript,voiceAgentContext);
          voiceStatus('Creative request routed to CODEX with Matrix spatial context.');
          return;
        }
      }
      if(pendingWorld)throw Error('Finish saved-world recovery before planning scene changes.');
      voiceBlenderPlacement=await bindBlenderRequestContext(world,view,bridge,voiceBlenderPlacement);
      voiceJob='planner-submit';voiceButtons();
      const job=await bridge.request('/api/voice',{clientId:bridge.clientId,snapshot:voiceSnapshot,audioBase64,conversation,webRuntime:true});
      voiceJob=job.jobId;voiceButtons();await pollVoice(voiceJob);
    }
  }
  catch(error){voiceStatus(voiceTranscriptStaged?
    `${error.message} Transcript kept in the Codex Agent input; inspect before retrying.`:
    error.message,true);}
  finally{voiceJob=null;voiceSnapshot=null;voiceAgentContext=null;voiceBlenderPlacement=null;
    voiceSteerTurnId=null;voiceButtons();}
}
async function pollVoice(jobId){
  for(let attempt=0;attempt<120;attempt++){
    const job=await bridge.request(`/api/voice/${jobId}`);
    if(job.transcript&&await stopPlannerConceptFallback(job.transcript,()=>
      bridge.request('/api/voice/cancel',{clientId:bridge.clientId,jobId}))){
      $('prompt').value=job.transcript;
      voiceStatus('Panorama, image, or selected design requests need Codex. Reconnect Codex and speak again; no generation or build was started.',true);
      return;
    }
    if(job.phase==='error'){voiceStatus(job.error||'Voice request failed',true);return;}
    if(!['transcribing','planning'].includes(job.phase)){if(job.transcript)$('prompt').value=job.transcript;
      voiceStatus(job.transcript?`Heard: ${job.transcript}`:'Voice request finished');await showProposal(job,job.transcript,voiceBlenderPlacement);return;}
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
$('new-world').addEventListener('click',()=>void beginNewWorld());
$('restore-archive').addEventListener('click',()=>void restoreSelectedArchive());
$('world-archives').addEventListener('change',()=>{
  selectedArchiveId=$('world-archives').value;
  archiveRestoreArmedUntil=0;archiveRestoreId='';updateWorldControls();
});
$('mode').addEventListener('change',()=>{modeTouched=true;discardProposal();});
for(const action of ['enter-play','enter-creator','stop-play','resume-play'])
  $(action).addEventListener('click',()=>changeCreatorMode(action));
$('refresh-assets').addEventListener('click',()=>refreshAssets());
$('token').addEventListener('change',()=>{
  refreshAssets();
  refreshScenes();
  refreshPCWorlds();
});
refreshScenes();
refreshPCWorlds();
