const KEY='matrix-professor-voices-v1';
export function readVoiceChoices(storage){
  try{const value=JSON.parse(storage.getItem(KEY)||'{}');
    return value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(
      Object.entries(value).filter(([key,id])=>key.length<=160&&typeof id==='string'&&id.length<=80)):{};
  }catch{return {};}
}
export function saveVoiceChoice(storage,choices,teacherId,voiceId){
  const next={...choices};
  if(voiceId)next[teacherId]=voiceId;else delete next[teacherId];
  storage.setItem(KEY,JSON.stringify(next));return next;
}
