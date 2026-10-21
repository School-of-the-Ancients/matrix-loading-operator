// A network acknowledgement must not erase a newer draft typed while it was pending.
export async function deliverAgentTextDraft(input, text, deliver){
  const submitted=input.value;
  const result=await deliver(text);
  if(input.value===submitted)input.value='';
  return result;
}

// Navigation may stage a request, but never replaces another unsent draft or
// delivers it. The advanced Planner retains its original input and history.
export function stageAgentTextDraft(input,text){
  if(!input.value.trim()){input.value=text;return 'copied';}
  return input.value.trim()===text.trim()?'same':'retained';
}
