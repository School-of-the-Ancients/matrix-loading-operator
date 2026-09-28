// Only explicit image/version requests enter the PC concept provider path.
// Other creative requests keep their existing Operator routing.
const clean=text=>String(text||'').trim()
  .replace(/^(?:please\s+)?(?:hey\s+)?operator[,;:\s]+/i,'')
  .replace(/^please\s+/i,'').trim();

export function parseConceptIntent(text){
  const request=clean(text);
  if(!request)return null;
  const select=request.match(/^(?:use|select|choose|pick)\s+(?:the\s+)?(?:concept\s+|image\s+)?version\s+(\d{1,3})(?:\s*[,;.]\s*(?:but\s+)?(.*)|\s*)$/i);
  if(select)return {kind:'select',version:Number(select[1]),notes:(select[2]||'').trim()};
  const variation=request.match(/^(?:(?:make|create|generate|show)\s+(?:me\s+)?(?:another|a new|one more|the next)\s+(?:version|variant|variation|image|concept)|another\s+(?:version|variant|variation))(?:[.,;:]?\s*(.*))?$/i);
  if(variation)return {kind:'vary',notes:(variation[1]||'').trim()};
  const image=request.match(/^(?:create|generate|make|show|draw)\s+(?:me\s+)?(?:an?\s+)?(?:image|concept(?:\s+image|\s+art)?|picture|visual|mockup|illustration)\s+(?:of|for|showing|depicting)\s+(.+)$/i);
  if(image)return {kind:'generate',prompt:image[1].trim()};
  return null;
}

export function isSelectedConceptBuildRequest(text){
  // A follow-up can name an already completed build while explicitly asking
  // not to create another one. Only affirmative creation language starts a
  // fresh selected-image build.
  const request=clean(text)
    .replace(/\b(?:do not|don't|never|without|no need to)\b[^.!?;,]*?(?=\b(?:but|then)\b|[.!?;,]|$)/gi,'')
    .replace(/\bbuild\s+(?:is|was|has been)\s+(?:already\s+)?(?:complete|completed|finished|done)\b/gi,'');
  const existingResultFollowup=/^(?:(?:can|could|would) you\s+)?(?:bind|review|inspect|check|verify|show|report|describe|summarize|status|explain|tell|resume|continue|play)\b/i.test(request);
  const newBuildAfterFollowup=/(?:\b(?:and|then|now|also)\s+|[;,]\s*)(?:build|construct|model|spawn|import|place|make|create|turn)\b/i.test(request);
  if(existingResultFollowup&&!newBuildAfterFollowup)return false;
  const explicit=/\b(?:selected|concept|design|reference|version)\b/i.test(request)||
    /\b(?:this|that|the)\s+image\b|\bimage\s+[0-9a-f]{32}\b/i.test(request);
  const deictic=/\b(?:this|that|it)\b(?=\s*(?:[.!?,;]|$)|\s+(?:in|into|around|here|there|at|on|for)\b)/i.test(request);
  if(!explicit&&!deictic)return false;
  if(/\b(?:build|construct|model|spawn|import)\b/i.test(request))return true;
  if(/\bplace\b/i.test(request))return explicit||
    deictic&&/\b(?:matrix|world|scene)\b/i.test(request);
  if(/\b(?:make|create|turn)\b/i.test(request))return deictic||
    explicit&&/\b(?:matrix|world|scene|blender|asset|object|geometry|around|into)\b/i.test(request);
  return /\buse\b.{0,40}\b(?:design|concept|reference|image)\b/i.test(request);
}

export async function stopPlannerConceptFallback(transcript,cancel){
  if(!parseConceptIntent(transcript)&&!isSelectedConceptBuildRequest(transcript))return false;
  // Planner voice exposes its transcript while planning. Cancel its proposal,
  // including when planning finished before the browser observed the transcript.
  try{await cancel();}catch{/* The browser still withholds the planner proposal. */}
  return true;
}

export function plannerVoiceFallbackAllowed(mode){
  return mode==='offline-rules';
}
