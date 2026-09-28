// A Blender job can outlive the room, scene, or XR session that requested it.
// Keep the intended destination separate from the generated catalog asset.
const copy=value=>structuredClone(value);
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?
  Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const XR_POSE_MAX_AGE_MS=1000;

function xrSession(view){return view.renderer?.xr?.getSession?.()||null;}
function spatialState(world,anchorId){
  const spatial=world.spatial;
  return {present:!!spatial,originUnavailable:!!spatial?.originUnavailable,
    stale:!!spatial?.stale,alignmentVerified:!!spatial?.alignmentVerified,
    anchor:anchorId==='web-floor'?null:
      copy(spatial?.anchors?.find(item=>item.anchorId===anchorId)||null)};
}
function currentPointingTarget(view){return copy(view.pointingTarget?.()||null);}
function currentSelectedPlacement(view){return copy(view.selectedPlacementTarget?.()||null);}
function currentSelection(world,selectedPlacement){
  const selection=copy(world.selection);
  if(selectedPlacement){selection.anchorId=selectedPlacement.anchorId;
    selection.position=copy(selectedPlacement.position);}
  return selection;
}
function poseReady(view,session,now,requiresXR){
  return !requiresXR||!!session&&!!view.xrViewer&&Number.isFinite(view.xrViewerCapturedAt)&&
    now-view.xrViewerCapturedAt>=0&&now-view.xrViewerCapturedAt<=XR_POSE_MAX_AGE_MS;
}

export function captureBlenderPlacement(world,view,{now=performance.now()}={}){
  const selectedPlacement=currentSelectedPlacement(view);
  const selection=currentSelection(world,selectedPlacement);
  const pointingTarget=currentPointingTarget(view);
  const target=selectedPlacement||pointingTarget||{anchorId:selection.anchorId,
    objectId:selection.objectId||null,position:selection.position};
  const anchorId=target.anchorId;
  const session=xrSession(view);
  const requiresXR=!!view.isAR||['vr','ar'].includes(world.runtimePresentation);
  return {sceneReference:world.scene,scene:JSON.stringify(world.scene),
    roomId:world.scene.roomId,authoredGeneration:world.authoredGeneration,
    creatorMode:copy(world.creatorMode),
    originBinding:world.originBinding,originAnchorHandle:world.originAnchorHandle,
    runtimePresentation:world.runtimePresentation,session,requiresXR,
    sessionStartedAt:view.sessionStartedAt,roomAnchor:view.roomAnchor,
    roomTrackingEpoch:view.roomTrackingEpoch,
    roomAnchorLocated:!!view.roomAnchorLocated,
    isAR:!!view.isAR,selection,selectedPlacement,pointingTarget,target:copy(target),
    spatial:spatialState(world,anchorId),poseReadyAtRequest:poseReady(view,session,now,requiresXR)};
}

export function validateBlenderPlacement(world,view,capture,{now=performance.now()}={}){
  const stale=reason=>{throw Error(`${reason}. The generated asset remains registered; choose a fresh placement target to load it.`);};
  if(!capture||world.scene!==capture.sceneReference||
      world.scene.roomId!==capture.roomId||world.authoredGeneration!==capture.authoredGeneration||
      JSON.stringify(world.scene)!==capture.scene||
      !same(world.creatorMode,capture.creatorMode))
    stale('The world changed during Blender generation');
  if(world.originBinding!==capture.originBinding||
      world.originAnchorHandle!==capture.originAnchorHandle||
      world.runtimePresentation!==capture.runtimePresentation||
      xrSession(view)!==capture.session||view.sessionStartedAt!==capture.sessionStartedAt||
      view.roomAnchor!==capture.roomAnchor||
      view.roomTrackingEpoch!==capture.roomTrackingEpoch||
      !!view.isAR!==capture.isAR)
    stale('The runtime or room origin changed during Blender generation');
  // The ray is a request-time target. Controller jitter or looking elsewhere
  // while Blender works must not move the saved point. Scene, selection, and
  // support-anchor checks below still reject a changed actual target.
  if(!same(currentSelectedPlacement(view),capture.selectedPlacement)||
      !same(currentSelection(world,currentSelectedPlacement(view)),capture.selection))
    stale('The placement selection changed during Blender generation');
  const currentSpatial=spatialState(world,capture.target.anchorId);
  if(!same(currentSpatial,capture.spatial)||currentSpatial.originUnavailable||currentSpatial.stale)
    stale('Room tracking or the placement surface changed during Blender generation');
  if(!capture.poseReadyAtRequest||!poseReady(view,capture.session,now,capture.requiresXR))
    stale('XR head tracking was unavailable or stale for this placement');
  const {anchorId,position}=capture.target;
  if(anchorId!=='web-floor'&&
      (!currentSpatial.anchor||!currentSpatial.alignmentVerified||
       !view.roomAnchorLocated||!capture.roomAnchorLocated||
       currentSpatial.anchor.surface?.kind!=='support'))
    stale('The measured placement surface is no longer ready');
  return {anchorId,position:copy(position),
    ...(anchorId==='web-floor'?{}:{placement:'surface'})};
}

export function blenderSpawnCommand(world,view,capture,asset,{now=performance.now()}={}){
  const placement=validateBlenderPlacement(world,view,capture,{now});
  return {op:'spawn',assetId:asset.assetId,
    anchorId:placement.anchorId,...(placement.placement?{placement:placement.placement}:{}),
    transform:{position:placement.position,rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}};
}

export function registeredBlenderAsset(world,job,catalog){
  const generated=job?.asset;
  const listed=catalog?.assets?.find(item=>item.assetId===generated?.assetId);
  const loaded=generated&&world.asset(generated.assetId);
  if(job?.phase!=='ready'||!generated||!listed||!loaded||
      typeof generated.sha256!=='string'||!/^[0-9a-f]{64}$/.test(generated.sha256)||
      listed.sha256!==generated.sha256||loaded.sha256!==generated.sha256)
    throw Error('Blender asset is ready, but its registered GLB digest does not match the current browser catalog');
  return loaded;
}

function servicePlacementProjection(state){
  const current=state?.snapshot;
  if(!current||!Number.isSafeInteger(state.revision)||
      !Number.isSafeInteger(state.runtimeGeneration)||typeof state.clientId!=='string')
    throw Error('The PC has no confirmed Matrix runtime for Blender placement');
  const room=current.roomContext||{};
  return {clientId:state.clientId,runtimeGeneration:state.runtimeGeneration,
    scene:stable(current.scene),selection:stable(current.selection),
    creatorMode:stable(current.creatorMode),
    roomContext:stable({mode:room.mode,state:room.state,
      alignmentVerified:room.alignmentVerified}),
    runtimeDescriptor:stable(current.runtimeDescriptor),
    digitalWorldVisit:current.digitalWorldVisit===true,readOnly:current.readOnly===true};
}

function bindServiceContext(capture,state,world,bridge){
  const projection=servicePlacementProjection(state);
  if(!state.online||projection.clientId!==bridge.clientId||
      stable(world.scene)!==projection.scene||
      stable(world.selection)!==projection.selection||
      stable(world.creatorMode)!==projection.creatorMode)
    throw Error('The PC Matrix world differs from this browser; refresh before Blender generation');
  capture.service=projection;
  return capture;
}

export async function captureBlenderRequestContext(world,view,bridge){
  await bridge.sync();
  const capture=captureBlenderPlacement(world,view);
  return bindServiceContext(capture,await bridge.request('/api/state'),world,bridge);
}

export async function bindBlenderRequestContext(world,view,bridge,capture){
  await bridge.sync();
  validateBlenderPlacement(world,view,capture);
  return bindServiceContext(capture,await bridge.request('/api/state'),world,bridge);
}

function unchangedServiceContext(capture,state,bridge){
  const projection=servicePlacementProjection(state);
  if(!capture.service||!state.online||projection.clientId!==bridge.clientId||
      !same(projection,capture.service))
    throw Error('The PC runtime or Matrix world changed during Blender generation. The generated asset remains registered; choose a fresh placement target to load it.');
  return state;
}

export async function queueBlenderPlacement(world,view,bridge,capture,asset,
  {onQueued=()=>{}}={}){
  // The asset has already been registered. Failure or an uncertain queue result
  // never retries the spawn at another location or discards its catalog entry.
  await bridge.sync();
  unchangedServiceContext(capture,await bridge.request('/api/state'),bridge);
  let requestId;
  await bridge.withExclusiveExchange(async()=>{
    const current=unchangedServiceContext(capture,
      await bridge.request('/api/state'),bridge);
    const command=blenderSpawnCommand(world,view,capture,asset);
    const queued=await bridge.request('/api/command',{commands:[command],
      expectedClientId:capture.service.clientId,
      expectedRoomId:capture.roomId,
      expectedRevision:current.revision,
      expectedRuntimeGeneration:capture.service.runtimeGeneration});
    requestId=queued?.commands?.[0]?.requestId;
    if(typeof requestId!=='string'||!requestId)
      throw Error('Matrix did not return a queued spawn ID; inspect the scene before retrying');
    const expected=stable(command);
    bridge.guardCommand(requestId,operation=>{
      const {requestId:deliveredId,...delivered}=operation;
      if(deliveredId!==requestId||stable(delivered)!==expected)
        throw Error('Queued Blender spawn differs from the reviewed request-time command');
      validateBlenderPlacement(world,view,capture);
    });
    onQueued(requestId);
  });
  void bridge.tick(true);
  const browserReceipt=await bridge.waitForReceipt(requestId);
  await bridge.sync();
  const state=await bridge.request('/api/state');
  const pcReceipt=state.results?.find(item=>item.requestId===requestId);
  if(!pcReceipt||pcReceipt.ok!==browserReceipt.ok||
      pcReceipt.objectId!==browserReceipt.objectId)
    throw Error(`Matrix spawn ${requestId} is unconfirmed on the PC; inspect its status before retrying. The generated asset remains registered.`);
  if(!pcReceipt.ok)
    throw Error(`Blender asset ${asset.displayName||asset.assetId} is registered, but Matrix rejected placement: ${pcReceipt.error}. Choose a fresh target to load it.`);
  const placed=state.snapshot?.scene?.objects?.find(item=>item.objectId===pcReceipt.objectId);
  if(state.clientId!==capture.service.clientId||
      state.runtimeGeneration!==capture.service.runtimeGeneration||
      state.snapshot?.scene?.roomId!==capture.roomId||
      state.snapshot?.assets?.find(item=>item.assetId===asset.assetId)?.sha256!==asset.sha256||
      placed?.assetId!==asset.assetId||placed?.anchorId!==capture.target.anchorId)
    throw Error(`Matrix spawn ${requestId} was acknowledged, but its live object is unconfirmed; inspect the scene before retrying.`);
  return pcReceipt;
}
