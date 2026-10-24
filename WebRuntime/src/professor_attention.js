// A cue is presentation only. Resolve against the current world on every frame.
export function professorAttention(cue,{scene,runtimeId,sessionId}) {
  if (!cue || !['look','point'].includes(cue.kind) || cue.runtimeId!==runtimeId || cue.roomId!==scene?.roomId
      || !scene.objects.some(item=>item.professor?.schoolSessionId===sessionId)) return null;
  const object=scene.objects.find(item=>item.objectId===cue.objectId);
  return object && !object.professor && object.assetId===cue.assetId ? object : null;
}
