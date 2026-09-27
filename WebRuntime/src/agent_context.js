// One semantic snapshot at send time. The PC validates IDs against its live world.
const finiteVector=value=>value&&['x','y','z'].every(axis=>
  Number.isFinite(value[axis])&&Math.abs(value[axis])<=10000);
const validViewerFrame=frame=>frame&&typeof frame.anchorId==='string'&&
  finiteVector(frame.position)&&finiteVector(frame.forward)&&
  frame.forward.y===0&&
  Math.hypot(frame.forward.x,frame.forward.z)>=.99&&
  Math.hypot(frame.forward.x,frame.forward.z)<=1.01;
export function captureAgentContext(world,view,clientId,inputSource){
  const selected=world.scene.objects.find(item=>item.objectId===world.selection.objectId);
  const selectedObjectId=selected?.objectId||null;
  const pointingTarget=view.pointingTarget();
  const reported=view.viewer()?.frames;
  const frames=Array.isArray(reported)?reported.filter(validViewerFrame):[];
  // An empty world still has a virtual-floor viewpoint. A current pointing
  // hit, then an existing selection, chooses the more specific anchor frame.
  const preferred=[pointingTarget?.anchorId,selected?.anchorId,'web-floor'];
  const viewerFrame=preferred.map(anchorId=>frames.find(frame=>
    frame.anchorId===anchorId)).find(Boolean)||null;
  return {schemaVersion:1,inputSource,clientId,roomId:world.scene.roomId,
    selectedObjectId,pointingTarget,viewerFrame};
}
