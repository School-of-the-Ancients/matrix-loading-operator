// CHAT is the finite command parser. Requests that need creative asset or
// animation work belong to the existing CODEX Agent/Matrix capability path.
const normalize=value=>String(value||'').trim().toLowerCase()
  .replace(/[.!?]+$/,'').replace(/\s+/g,' ');
const bareReference=value=>normalize(value)
  .replace(/^(?:the|a|an|one|another) /,'')
  .replace(/^registered (?:asset )?/,'');
const savedSceneRequest=text=>{
  const match=text.match(/^(?:load|restore)(?: (?:the )?(?:scene|room))? (.+)$/i);
  return match?bareReference(match[1].replace(/^['"]|['"]$/g,'')):null;
};
const assetReference=text=>{
  const match=text.match(/^(?:(?:put|place|spawn|add|create|load|summon|make|build|generate) )(.+)$/i);
  if(!match)return null;
  return bareReference(match[1]
    .replace(/ (?:here|on (?:the )?(?:floor|table|.+))$/i,'')
    .replace(/ (?:in front of me|two metres? in front of me|two meters? in front of me)$/i,''));
};
// Physical placement needs the Agent's fresh AR room context and typed tools.
const physicalRoomRequest=request=>{
  if(!/\b(?:put|place|move|set|reorganiz\w*|arrang\w*|fit|create|build|make)\b/i.test(request))
    return false;
  const measuredTarget=/\b(?:(?:my|our|this|that)\s+(?:physical\s+)?(?:room|table|walls?|floor|support|surface)|(?:physical|measured|real)\s+(?:room|table|walls?|floor|support|surface)|room[- ]aware)\b/i;
  const pointedPlacement=/^(?:put|place|move|set)\s+(?:this|that|it)(?:\s+\S+)?\s+(?:here|there)$/i;
  return measuredTarget.test(request)||pointedPlacement.test(request);
};

export function routeOperatorRequest(text,{assets=[],savedScenes=[],presentation=null}={}){
  const request=normalize(text).replace(/^please /,'')
    .replace(/^(?:hey )?operator[,;:\s]+/,'');
  if(!request)return {destination:'planner',reason:'empty'};
  if(/\b(?:animat(?:e|ed|ion|ions|ing)?|flight|flying|fly|clip|looping|keyframe|rigging)\b/i.test(request))
    return {destination:'agent',reason:'animation'};
  if(/\b(?:glb|gltf|blender|blend file|3d model|3d asset|mesh|import|sculpt|texture)\b/i.test(request))
    return {destination:'agent',reason:'asset'};
  if(/\b(?:in front of me|ahead of me|where i am pointing)\b/i.test(request))
    return {destination:'agent',reason:'viewer-relative'};
  if(/\bregistered (?:glb|asset|model)\b/i.test(request))
    return {destination:'agent',reason:'registered-glb'};
  if(/^make .+ (?:twice|half) as (?:big|large)$/i.test(request))
    return {destination:'planner',reason:'finite-command'};
  if(/^(?:load|restore) (?:the )?(?:scene|room)\b/i.test(request))
    return {destination:'planner',reason:'saved-scene-command'};
  const saved=savedSceneRequest(request);
  if(saved&&savedScenes.some(name=>normalize(name)===saved))
    return {destination:'planner',reason:'saved-scene'};
  if(presentation==='ar'&&physicalRoomRequest(request))
    return {destination:'agent',reason:'physical-room'};
  const reference=assetReference(request);
  if(reference===null)return {destination:'planner',reason:'finite-command'};
  if(/\b(?:and|with|plus|then)\b|,|\b\d+\b/.test(reference))
    return {destination:'agent',reason:'multi-object-or-creative'};
  const matches=assets.filter(asset=>[asset.assetId,asset.displayName]
    .some(name=>bareReference(name)===reference));
  if(matches.length===1&&typeof matches[0].assetId==='string'&&
     !matches[0].assetId.startsWith('web:'))
    return {destination:'planner',reason:'catalog-command'};
  return {destination:'agent',reason:matches.some(asset=>
    asset.assetId?.startsWith('web:'))?'registered-glb':'creative-load'};
}
