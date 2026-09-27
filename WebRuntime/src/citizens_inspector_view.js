// DOM-only renderer for the saved Citizens inspector projection.
const inspectorNode=(tag,text='')=>{
  const node=document.createElement(tag);
  node.textContent=text;
  return node;
};
const inspectorPre=node=>{
  if((node.tagName||node.tag)?.toLowerCase()==='pre')return node;
  for(const child of node.children||[]){
    const found=inspectorPre(child);
    if(found)return found;
  }
  return null;
};
const inspectorDetailState=root=>{
  const state=new Map();
  const walk=node=>{
    if(node.inspectorKey)state.set(node.inspectorKey,{open:node.open,
      scrollTop:inspectorPre(node)?.scrollTop??0});
    for(const child of node.children||[])walk(child);
  };
  walk(root);
  return state;
};
const inspectorDetails=(key,title,contents,previous)=>{
  const details=inspectorNode('details');
  details.inspectorKey=key;
  details.open=previous.get(key)?.open??false;
  details.replaceChildren(inspectorNode('summary',title),...contents);
  return details;
};
const inspectorNumber=value=>Number.isFinite(value)?Math.round(value):'—';
const inspectorScore=value=>Number.isFinite(value)?value.toFixed(1):'—';
const inspectorKind=kind=>({rest:'rest',eat:'eat',explore:'exploration',
  converse:'conversation'})[kind]||kind||'wait';

// Both the owner panel and hosted visitor render this same read-only projection.
// Collapsible details retain their open state while new checkpoints arrive.
export function renderCitizensInspector(root,projection){
  const previous=inspectorDetailState(root);
  if(!projection){
    root.replaceChildren(inspectorNode('p','No Citizens state to inspect.'));
    return;
  }
  const names=new Map(projection.residents.map(item=>[item.id,item.name]));
  const nodes=[inspectorNode('p',`Saved Citizens minute ${projection.tick} · ${projection.paused?'paused':'running'}.`)];
  for(const resident of projection.residents){
    const card=inspectorNode('article');
    const needs=resident.needs;
    const active=resident.routines.filter(routine=>routine.active);
    const choice=resident.latestChoice;
    const scoreLine=choice?.candidates.length?
      choice.candidates.map(candidate=>`${inspectorKind(candidate.kind)} ${inspectorScore(candidate.score)}`).join(', '):
      'none recorded';
    const selected=choice?.selectedKind?
      `${inspectorKind(choice.selectedKind)}${choice.selectedRoutineId?` in ${choice.selectedRoutineId}`:''}${choice.selectedAppointmentId?` for ${choice.selectedAppointmentId}`:''}`:
      'wait';
    const choiceText=choice?
      `Latest recorded choice at minute ${choice.tick}: ${selected} (${choice.mode}). Candidate scores: ${scoreLine}.${Number.isFinite(choice.roll)?` Draw ${choice.roll.toFixed(3)}.`:''}`:
      'No choice has been sampled yet.';
    const reservation=resident.reservation;
    const reservationText=reservation?.mode==='claim'?
      `Reserves ${reservation.stationId} until minute ${reservation.expiresTick}.`:
      reservation?.mode==='queue'?
        `Waiting for ${reservation.stationId}, position ${reservation.queuePosition} of ${reservation.queueLength}${reservation.holderId?`; held by ${names.get(reservation.holderId)||reservation.holderId}`:''}.`:
        'No station reservation or queue ticket.';
    const routineText=active.length?
      `Active routine${active.length===1?'':'s'}: ${active.map(item=>item.id).join(', ')}.`:
      'No routine is active at this minute.';
    const relationship=resident.social.relationship;
    const socialText=relationship?
      `Relationship with ${names.get(relationship.otherId)||relationship.otherId}: ${relationship.score}/100.`:
      'No relationship record.';
    const latestSocial=resident.social.latestEvent;
    const socialEventText=latestSocial?
      ` Latest social event: ${latestSocial.event} at minute ${latestSocial.tick}.`:'';
    const current=inspectorNode('p',`Current activity: ${resident.currentSummary}`);
    const needLine=inspectorNode('p',`Fullness ${inspectorNumber(needs.hunger)}, energy ${inspectorNumber(needs.energy)}, fun ${inspectorNumber(needs.fun)}, social ${inspectorNumber(needs.social)}.`);
    const scheduled=inspectorNode('p',`${routineText} ${resident.appointments.filter(item=>
      item.status==='pending'||item.status==='active').length} open appointment(s).`);
    const choiceLine=inspectorNode('p',choiceText);
    const whyLine=choice?.why?inspectorNode('p',choice.why):null;
    const reservationLine=inspectorNode('p',reservationText);
    const socialLine=inspectorNode('p',socialText+socialEventText);
    const outcome=resident.lastOutcome?
      inspectorNode('p',`Latest outcome: ${resident.lastOutcome}`):null;
    const candidates=choice?.candidates.map(candidate=>inspectorNode('li',
      `${inspectorKind(candidate.kind)}: score ${inspectorScore(candidate.score)}; need gap ${inspectorNumber(candidate.deficit)}, preference ${inspectorScore(candidate.preference)}, travel ${inspectorScore(candidate.travelMeters)} m, routine weight ${inspectorNumber(candidate.baseWeight)}, availability ${inspectorScore(candidate.availabilityFactor)}.`))||[];
    const routines=resident.routines.map(routine=>inspectorNode('li',
      `${routine.id}: ${inspectorKind(routine.kind)} at ${routine.stationId||'no station'}, minutes ${routine.startMinute}–${routine.endMinute}, ${routine.priority} priority${routine.active?' (active now)':''}.`));
    const appointments=resident.appointments.map(item=>inspectorNode('li',
      `${item.kind} appointment ${item.status}, minutes ${item.startTick}–${item.deadlineTick}${item.reason?` · ${item.reason}`:''}.`));
    const scoreList=inspectorNode('ul');scoreList.replaceChildren(...candidates);
    const routineList=inspectorNode('ul');routineList.replaceChildren(...routines);
    const appointmentList=inspectorNode('ul');appointmentList.replaceChildren(...appointments);
    const why=inspectorDetails(`${resident.id}:why`,'Decision scores and schedule',[
      inspectorNode('p','These scores belong to the latest recorded choice, which may predate the current activity.'),
      scoreList,inspectorNode('p','Daily routines'),routineList,
      inspectorNode('p','Appointments'),appointmentList],previous);
    const raw=inspectorDetails(`${resident.id}:raw`,'Exact resident and activity data',[
      inspectorNode('pre',JSON.stringify({residentId:resident.id,
        objectId:resident.objectId,activity:resident.activity,
        reservation:resident.reservation,social:resident.social,
        latestChoice:resident.latestChoice},null,2))],previous);
    card.replaceChildren(inspectorNode('h4',resident.name),current,needLine,
      scheduled,choiceLine,...(whyLine?[whyLine]:[]),reservationLine,socialLine,
      ...(outcome?[outcome]:[]),why,raw);
    nodes.push(card);
  }
  nodes.push(inspectorNode('h3','Creation capability'));
  if(projection.capabilities.length===0)
    nodes.push(inspectorNode('p','No resident creation request has been submitted.'));
  for(const [index,capability] of projection.capabilities.entries()){
    const card=inspectorNode('article');
    const record=capability.outcome;
    const policy=capability.policy;
    const cause=record?
      `${names.get(capability.residentId)||'A resident'} requested another rest resource at minute ${record.requestedTick} after waiting for ${record.blockedStationId}.`:
      '';
    const decision=capability.legacy?
      'This older checkpoint has no saved policy decision or capability journal.':policy?
      policy.allowed?`Policy allowed the request at checkpoint ${policy.checkpointSequence}.`:
        `Policy denied the request: ${policy.reason}`:
      'Policy has not decided this request.';
    const result=record?.status==='used'?
      'The resident observed Matrix creation and then used the object.':
      record?.status==='created'?
        'The resident observed Matrix creation; use has not been recorded yet.':
        record?`Current outcome: ${record.status}.`:'';
    const failure=capability.reason?
      inspectorNode('p',`${capability.status==='unconfirmed'?'Unconfirmed work':'Failure'}: ${capability.reason}`):null;
    const receiptText=capability.legacy?
      'Exact Matrix receipts were not stored in this older checkpoint.':
      capability.receipts.length?
      `${capability.receipts.length} Matrix receipt(s) recorded.`:
      'No Matrix creation receipt recorded yet.';
    const raw=inspectorDetails(`capability:${index}`,
      capability.legacy?'Saved legacy IDs (receipts unavailable)':
        'Request, policy, work and Matrix receipts',[
      inspectorNode('pre',JSON.stringify({request:capability.request,
        policy:capability.policy,work:capability.work,
        receipts:capability.receipts,outcome:capability.outcome,
        reason:capability.reason},null,2))],previous);
    card.replaceChildren(inspectorNode('h4',capability.summary),
      ...(cause?[inspectorNode('p',cause)]:[]),inspectorNode('p',decision),
      inspectorNode('p',receiptText),...(result?[inspectorNode('p',result)]:[]),
      ...(failure?[failure]:[]),raw);
    nodes.push(card);
  }
  root.replaceChildren(...nodes);
  // A one-second hosted poll can replace a long JSON detail while it is being
  // read. Restore its nested scroll position after the new DOM is attached.
  const restore=node=>{
    const saved=node.inspectorKey&&previous.get(node.inspectorKey);
    if(saved){
      const pre=inspectorPre(node);
      if(pre)pre.scrollTop=saved.scrollTop;
    }
    for(const child of node.children||[])restore(child);
  };
  restore(root);
}
