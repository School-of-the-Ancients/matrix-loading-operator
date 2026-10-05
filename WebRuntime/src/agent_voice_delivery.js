// Speaking always targets the shared Agent conversation. A panel changes what
// the wearer sees, never the destination or approval policy of their speech.
export function prepareAgentVoiceRecording({agentClient,showConversation}){
  if(agentClient?.conversationStarting)
    throw Error('Wait for the new conversation to finish starting.');
  showConversation();
  if(!agentClient?.status||agentClient.error)throw Error('Connect to Codex before speaking.');
  const turnId=agentClient.status.activeTurnId??null;
  if(!turnId)agentClient.assertPermissionsApplied();
  return turnId;
}

// Stage recognized speech before any network action so a stale or failed
// delivery leaves an editable draft in the Agent input.
export async function deliverAgentVoiceTranscript({agentClient,input,transcript,context,
  resolveContext=()=>context,capturedTurnId=null,deliverWhenIdle}){
  const previous=input.value;
  const staged=previous.trim()?`${previous.trimEnd()}\n${transcript}`:transcript;
  input.value=staged;
  // If recording began idle, refresh the Portal status after transcription.
  // A text turn may have started while the microphone or PC was busy.
  const turnId=capturedTurnId||(await agentClient.restore())?.activeTurnId;
  let kind;
  if(turnId){await agentClient.steer(transcript,await resolveContext(),turnId);kind='steered';}
  else {
    agentClient.assertPermissionsApplied?.();
    kind=await deliverWhenIdle();
  }
  if(input.value===staged)input.value=previous;
  return kind;
}
