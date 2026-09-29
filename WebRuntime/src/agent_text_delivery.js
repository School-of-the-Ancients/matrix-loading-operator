// A network acknowledgement must not erase a newer draft typed while it was pending.
export async function deliverAgentTextDraft(input, text, deliver){
  const submitted=input.value;
  const result=await deliver(text);
  if(input.value===submitted)input.value='';
  return result;
}
