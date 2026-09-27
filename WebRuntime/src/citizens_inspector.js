// A display projection of an already validated Citizens checkpoint. The host
// and visitor restore/validate the world before calling this function. It has
// no clock, world reference, side effects, or separately persisted state.
const copy=value=>structuredClone(value);
const publicDenial=reason=>
  /^(Citizen (capability|generation|construction) budget (?:is )?exhausted)$/i.test(reason)?
    reason:'Policy denied this request.';
const publicOutcome=value=>{
  if(typeof value!=='string'||!value)return '';
  // Saved outcomes are public world facts, but failure details can originate
  // in lower layers. Keep useful ordinary reasons and hide service paths or
  // credential-shaped strings from the visitor's shared explanation.
  if(/(?:[A-Za-z]:\\|\\\\|\/(?:Users|home|tmp|private)\/|bearer\s|api[_ -]?key|token|secret|password)/i
    .test(value))return 'An action failed; details are available to the owner.';
  return value;
};
const validCore=state=>state&&typeof state==='object'&&
  [12,13,14,15].includes(state.schemaVersion)&&
  Number.isSafeInteger(state.clockTick)&&state.clockTick>=0&&
  typeof state.paused==='boolean'&&Array.isArray(state.residents)&&
  Array.isArray(state.stations)&&Array.isArray(state.socialEvents)&&
  Array.isArray(state.relationships)&&
  (state.capabilityRequests===undefined||Array.isArray(state.capabilityRequests));
const activeRoutine=(routine,tick)=>{
  const minute=tick%1440;
  return routine.startMinute<routine.endMinute?
    minute>=routine.startMinute&&minute<routine.endMinute:
    minute>=routine.startMinute||minute<routine.endMinute;
};
const namesFor=state=>new Map(state.residents.map(resident=>
  [resident.id,resident.name]));

function reservationFor(state,resident){
  for(const station of state.stations){
    if(station.claim?.residentId===resident.id)
      return {stationId:station.id,objectId:station.objectId,
        kind:station.kind,mode:'claim',executionId:station.claim.executionId,
        expiresTick:station.claim.expiresTick,queuePosition:null,
        queueLength:station.waiters.length,holderId:resident.id};
    const index=station.waiters.findIndex(waiter=>
      waiter.residentId===resident.id);
    if(index>=0)return {stationId:station.id,objectId:station.objectId,
      kind:station.kind,mode:'queue',
      executionId:station.waiters[index].executionId,expiresTick:null,
      queuePosition:index+1,queueLength:station.waiters.length,
      holderId:station.claim?.residentId??null};
  }
  return null;
}

function activityFor(state,resident){
  const action=resident.activity;
  if(!action)return null;
  const station=state.stations.find(item=>item.id===action.stationId);
  return {kind:action.kind,phase:action.phase,stationId:action.stationId,
    executionId:action.executionId,remainingTicks:action.remainingTicks,
    target:station?{type:'station',stationId:station.id,
      objectId:station.objectId}:action.target?
        {type:'position',position:copy(action.target)}:null};
}

function currentSummary(state,resident,reservation,activity,names){
  if(reservation?.mode==='queue'){
    const holder=reservation.holderId?
      names.get(reservation.holderId)??reservation.holderId:null;
    return `${resident.name} is waiting for ${reservation.kind} at `+
      `${reservation.stationId} (queue position ${reservation.queuePosition})`+
      `${holder?`; ${holder} holds it`:''}.`;
  }
  if(activity){
    const phase={travel:'traveling to',use:'using',egress:'leaving'}[activity.phase]??
      activity.phase;
    const target=activity.target?.type==='station'?
      `${activity.kind} at ${activity.stationId}`:
      activity.kind==='explore'?'an exploration point':activity.kind;
    return `${resident.name} is ${phase} ${target}.`;
  }
  if(state.socialSession&&resident.socialSessionId===state.socialSession.id){
    const otherId=state.socialSession.initiatorId===resident.id?
      state.socialSession.inviteeId:state.socialSession.initiatorId;
    const other=names.get(otherId)??otherId;
    return `${resident.name} is ${state.socialSession.phase==='offered'?
      `considering a conversation with ${other}`:`conversing with ${other}`}.`;
  }
  return state.paused?`${resident.name} is idle while the world is paused.`:
    `${resident.name} has no current action or queue ticket.`;
}

function socialFor(state,resident){
  const session=state.socialSession;
  const involved=session&&
    [session.initiatorId,session.inviteeId].includes(resident.id);
  const latestEvent=[...state.socialEvents].reverse().find(event=>
    event.initiatorId===resident.id||event.inviteeId===resident.id);
  const relationship=state.relationships.find(entry=>
    entry.a===resident.id||entry.b===resident.id);
  return {session:involved?copy(session):null,
    latestEvent:latestEvent?copy(latestEvent):null,
    relationship:relationship?{otherId:relationship.a===resident.id?
      relationship.b:relationship.a,score:relationship.score}:null};
}

function latestChoiceFor(resident){
  if(!resident.lastDecision)return null;
  const decision=resident.lastDecision;
  const selected=decision.candidates.find(candidate=>
    candidate.kind===decision.selectedKind&&
    (decision.selectedRoutineId===null||
      candidate.routineId===decision.selectedRoutineId));
  const source={routine:'routine',needs:'need',appointment:'appointment',
    idle:'idle'}[decision.mode]??decision.mode;
  const why=selected?
    `At minute ${decision.tick}, the recorded ${source} choice selected `+
      `${decision.selectedKind} (score ${selected.score}; need deficit `+
      `${selected.deficit}, preference ${selected.preference}, travel `+
      `${selected.travelMeters} m, availability ${selected.availabilityFactor}). `+
      'The current activity is shown separately.':
    `At minute ${decision.tick}, the recorded choice was idle. `+
      'The current activity is shown separately.';
  return {tick:decision.tick,mode:decision.mode,
    roll:decision.roll,
    selectedKind:decision.selectedKind,
    selectedRoutineId:decision.selectedRoutineId,
    selectedAppointmentId:decision.selectedAppointmentId??null,
    candidates:decision.candidates.map(candidate=>copy(candidate)),why};
}

function capabilityFor(state,entry){
  const source=entry.request;
  const resident=state.residents.find(item=>item.id===source?.residentId);
  const known=source?.capability==='asset'&&source.action==='generate'||
    source?.capability==='procedural'&&source.action==='create';
  const record=state.generatedConstruction?.intentId===source?.intentId?
    state.generatedConstruction:state.construction?.intentId===source?.intentId?
      state.construction:null;
  const name=resident?.name??'A resident';
  const object=source?.capability==='asset'?'generated rest seat':
    source?.capability==='procedural'?'procedural rest bench':'capability';
  const status=entry.status;
  const result=record?.status;
  const phase={requested:'submitted a request',queued:'has an approved request',
    generating:'has an approved request; generation is in progress',
    registered:'has a registered GLB; Matrix placement is pending',
    spawning:'has a registered GLB; Matrix placement is in progress',
    succeeded:result==='used'?'observed Matrix creation and used the object':
      'observed Matrix creation; use has not been recorded',
    denied:'was denied by policy',failed:'has a failed request',
    unconfirmed:'has an unconfirmed request'}[status]??'has a request';
  const summary=`${name} ${phase} for a ${object}.`;
  const policy=entry.policy?{allowed:entry.policy.allowed,
    requestId:entry.policy.requestId,
    checkpointSequence:entry.policy.checkpointSequence,
    reason:entry.policy.allowed?'':publicDenial(entry.policy.reason)}:null;
  const request=known?copy(source):null;
  const work=known&&entry.work?{
    jobId:entry.work.jobId??null,assetId:entry.work.assetId??null,
    sha256:entry.work.sha256??null,
    spawnRequestId:entry.work.spawnRequestId??null,
    objectId:entry.work.objectId??null,
    interactionRequestId:entry.work.interactionRequestId??null}:null;
  // MatrixWorld receipts contain public world-validation results. The PC job
  // details are kept out of saved Citizen reasons by the hosted owner.
  const receipts=known?entry.receipts.map(receipt=>copy(receipt)):[];
  const outcome=record?{status:record.status,
    requestedTick:record.requestedTick,
    blockedStationId:record.blockedStationId,
    waitExecutionId:record.waitExecutionId,
    objectId:record.objectId??null,
    assetId:record.assetId??null,
    useRequestId:record.useRequestId??null,
    reason:publicOutcome(record.reason)}:null;
  const reason=['failed','unconfirmed'].includes(status)?
    publicOutcome(entry.reason)||'The operation failed; details are available to the owner.':'';
  return {residentId:source?.residentId??null,status,summary,
    request,policy,work,receipts,outcome,reason};
}

function legacyConstructionFor(state){
  const record=state.construction;
  if(!record||(state.capabilityRequests??[]).some(item=>
    item.request?.intentId===record.intentId))return null;
  const name=state.residents.find(item=>item.id===record.residentId)?.name??
    'A resident';
  const outcome={status:record.status,requestedTick:record.requestedTick,
    blockedStationId:record.blockedStationId,
    waitExecutionId:record.waitExecutionId,objectId:record.objectId,
    assetId:null,useRequestId:record.useRequestId,
    reason:publicOutcome(record.reason)};
  return {residentId:record.residentId,status:record.status,legacy:true,
    summary:`${name}'s older checkpoint records a procedural rest bench `+
      `(${record.status}); its exact capability journal was not stored.`,
    request:null,policy:null,
    work:{requestId:record.requestId,objectId:record.objectId,
      interactionRequestId:record.interactionRequestId,
      useRequestId:record.useRequestId},
    receipts:[],outcome,
    reason:['failed','unconfirmed'].includes(record.status)?
      publicOutcome(record.reason):''};
}

export function projectCitizensInspector(snapshot){
  if(!validCore(snapshot)||snapshot.residents.some(resident=>
    typeof resident?.id!=='string'||typeof resident.name!=='string'||
    !resident.needs||typeof resident.needs!=='object'||
    !Array.isArray(resident.routines)||
    !Array.isArray(resident.appointments)||
    resident.lastDecision!==null&&
      !Array.isArray(resident.lastDecision?.candidates))||
    snapshot.stations.some(station=>!Array.isArray(station?.waiters))||
    (snapshot.capabilityRequests??[]).some(entry=>
      !entry?.request||!Array.isArray(entry.receipts)))
    throw Error('Citizens inspector requires a validated checkpoint');
  const state=snapshot;
  const names=namesFor(state);
  const capabilities=(state.capabilityRequests??[]).map(entry=>
    capabilityFor(state,entry));
  const legacy=legacyConstructionFor(state);
  if(legacy)capabilities.push(legacy);
  const residents=state.residents.map(resident=>{
    const reservation=reservationFor(state,resident);
    const activity=activityFor(state,resident);
    const createdTarget=capabilities.find(item=>
      item.residentId===resident.id&&
      ['created','used'].includes(item.outcome?.status)&&
      activity?.target?.objectId===item.outcome.objectId);
    const summary=currentSummary(state,resident,reservation,activity,names)+
      (createdTarget?` This is the rest seat created after ${resident.name}'s `+
        `wait for ${createdTarget.outcome.blockedStationId}.`:'');
    return {id:resident.id,name:resident.name,objectId:resident.objectId,
      needs:copy(resident.needs),
      routines:resident.routines.map(routine=>({id:routine.id,
        kind:routine.kind,priority:routine.priority,
        startMinute:routine.startMinute,endMinute:routine.endMinute,
        baseWeight:routine.baseWeight,stationId:routine.stationId,
        active:activeRoutine(routine,state.clockTick)})),
      appointments:copy(resident.appointments),
      latestChoice:latestChoiceFor(resident),activity,reservation,
      social:socialFor(state,resident),
      currentSummary:summary,
      lastOutcome:publicOutcome(resident.lastOutcome),
      capabilities:capabilities.filter(item=>item.residentId===resident.id)};
  });
  return {tick:state.clockTick,paused:state.paused,residents,capabilities};
}
