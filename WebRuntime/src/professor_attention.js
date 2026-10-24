// A cue is presentation only. Resolve against the current world on every frame.
export function professorAttention(cue,{scene,runtimeId,sessionId,asset=()=>null}) {
  if (!cue || !['look','point'].includes(cue.kind) || cue.runtimeId!==runtimeId || cue.roomId!==scene?.roomId
      || !scene.objects.some(item=>item.professor?.schoolSessionId===sessionId)) return null;
  const object=scene.objects.find(item=>item.objectId===cue.objectId);
  if(!object||object.professor||object.assetId!==cue.assetId)return null;
  if(cue.partId){const catalog=asset(object.assetId);
    if(catalog?.partsRevision!==cue.partsRevision||!catalog?.parts?.some(p=>p.partId===cue.partId))return null;
  }
  return object;
}
