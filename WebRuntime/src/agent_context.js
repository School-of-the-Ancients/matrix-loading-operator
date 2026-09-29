// One semantic snapshot at send time. The PC validates IDs against its live world.
const finiteVector=value=>value&&['x','y','z'].every(axis=>
  Number.isFinite(value[axis])&&Math.abs(value[axis])<=10000);
const validViewerFrame=frame=>frame&&typeof frame.anchorId==='string'&&
  finiteVector(frame.position)&&finiteVector(frame.forward)&&
  frame.forward.y===0&&
  Math.hypot(frame.forward.x,frame.forward.z)>=.99&&
  Math.hypot(frame.forward.x,frame.forward.z)<=1.01;
export function captureAgentContext(world,view,clientId,inputSource){
  const presentation=world.runtimePresentation;
  if(!['desktop','vr','ar'].includes(presentation))
    throw Error('Current Matrix presentation is unavailable');
  const trackingEpoch=presentation==='ar'?view.roomTrackingEpoch:null;
  if(presentation==='ar'&&(!Number.isSafeInteger(trackingEpoch)||trackingEpoch<0))
    throw Error('Current AR tracking epoch is unavailable');
  const selected=world.scene.objects.find(item=>item.objectId===world.selection.objectId);
  const selectedObjectId=selected?.objectId||null;
  const pointingTarget=view.pointingTarget();
  // A click pins an editable destination independently of object selection.
  // Live hover remains a separate, transient observation.
  const selectedPlacement=view.selectedPlacementTarget?.()||null;
  const reported=view.viewer()?.frames;
  const frames=Array.isArray(reported)?reported.filter(validViewerFrame):[];
  // An empty world still has a virtual-floor viewpoint. A current pointing
  // hit, then an existing selection, chooses the more specific anchor frame.
  const preferred=[selectedPlacement?.anchorId,pointingTarget?.anchorId,
    selected?.anchorId,'web-floor'];
  const viewerFrame=preferred.map(anchorId=>frames.find(frame=>
    frame.anchorId===anchorId)).find(Boolean)||null;
  return {schemaVersion:3,inputSource,clientId,roomId:world.scene.roomId,
    presentation,trackingEpoch,selectedObjectId,selectedPlacement,
    pointingTarget,viewerFrame};
}
