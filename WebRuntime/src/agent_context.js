// One semantic snapshot at send time. The PC validates IDs against its live world.
export function captureAgentContext(world,view,clientId,inputSource){
  const selectedObjectId=world.scene.objects.some(item=>item.objectId===world.selection.objectId)?
    world.selection.objectId:null;
  const pointingTarget=view.pointingTarget();
  const anchorId=pointingTarget?.anchorId||world.scene.objects.find(item=>item.objectId===selectedObjectId)?.anchorId;
  const frames=anchorId?view.viewer()?.frames||[]:[];
  const viewerFrame=frames.find(frame=>frame.anchorId===anchorId)||null;
  return {schemaVersion:1,inputSource,clientId,roomId:world.scene.roomId,
    selectedObjectId,pointingTarget,viewerFrame};
}
