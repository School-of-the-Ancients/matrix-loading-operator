// Only explicit image/version requests enter the ComfyUI concept path.
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
  const request=clean(text);
  return /^(?:(?:now|okay|ok)\s+)?(?:build|make|create)\s+(?:this|that|the selected (?:concept|design|image))\b/i.test(request)||
    /^use\s+(?:this|that|the selected)\s+design\b/i.test(request);
}
