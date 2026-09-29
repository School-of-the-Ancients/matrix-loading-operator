// Stage recognized speech before any network action so a stale or failed
// delivery leaves an editable draft in the Agent input.
export async function deliverAgentVoiceTranscript({agentClient,input,transcript,context,
  capturedTurnId=null,deliverWhenIdle}){
  const previous=input.value;
  const staged=previous.trim()?`${previous.trimEnd()}\n${transcript}`:transcript;
  input.value=staged;
  // If recording began idle, refresh the Portal status after transcription.
  // A text turn may have started while the microphone or PC was busy.
  const turnId=capturedTurnId||(await agentClient.restore())?.activeTurnId;
  let kind;
  if(turnId){await agentClient.steer(transcript,context,turnId);kind='steered';}
  else kind=await deliverWhenIdle();
  if(input.value===staged)input.value=previous;
  return kind;
}
