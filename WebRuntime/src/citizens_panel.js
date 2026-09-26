// Opt-in Citizens controls for the ordinary Matrix Web world. The simulation
// chooses intentions; MatrixWorld remains the executor and scene owner.
import {CitizensSimulation,createCitizensDemo,
  createCitizensWithSelectedFurniture} from './citizens.js';

const byId=id=>document.getElementById(id);
const intervalMs=500;
const APPOINTMENT_HORIZON=1440;
const MAX_OPEN_APPOINTMENTS=3;
const appointmentWindow=item=>({kind:item.kind,startTick:item.startTick,
  deadlineTick:item.deadlineTick});
const sameAppointmentWindow=(a,b)=>a&&b&&a.kind===b.kind&&
  a.startTick===b.startTick&&a.deadlineTick===b.deadlineTick;
const openAppointment=item=>item.status==='pending'||item.status==='active';
const appointmentNumber=item=>Number(item.id.slice('appointment-'.length));
const windowsOverlap=(a,b)=>a.startTick<=b.deadlineTick&&
  b.startTick<=a.deadlineTick;
const activeRoutine=(routine,minute)=>routine.startMinute<routine.endMinute?
  minute>=routine.startMinute&&minute<routine.endMinute:
  minute>=routine.startMinute||minute<routine.endMinute;
const activityLabel=kind=>kind==='converse'?'conversation':kind;
const decisionSummary=decision=>{
  if(!decision)return 'No decision sampled yet.';
  const selected=decision.selectedKind?
    `${activityLabel(decision.selectedKind)}${decision.selectedRoutineId?` in ${decision.selectedRoutineId}`:''}${decision.selectedAppointmentId?` for ${decision.selectedAppointmentId}`:''}`:
    'wait';
  const candidates=decision.candidates.map(candidate=>
    `${activityLabel(candidate.kind)}${candidate.routineId?`/${candidate.routineId}`:''} ${candidate.score.toFixed(1)} (need ${candidate.deficit.toFixed(0)}, preference ${candidate.preference.toFixed(2)}, travel ${candidate.travelMeters.toFixed(1)} m, window ${candidate.baseWeight.toFixed(0)}, available ${candidate.availabilityFactor.toFixed(2)})`).join('; ');
  const mode=decision.mode==='social'?'social need':decision.mode;
  return `m ${decision.tick} · ${mode} selected ${selected}${decision.roll===null?'':` · roll ${decision.roll.toFixed(3)}`} · ${candidates||'no eligible candidate'}`;
};

export class CitizensPanel {
  constructor(world,{onChange,canStart,onFeedback,canMutate=()=>'',getRecovery=()=>null,
    canRecover=()=>'',onRecover=()=>{throw Error('No recovery action is configured');},
    confirmDurableRecovery=()=>false,clearRecovery=()=>{}}){
    this.world=world;
    this.onChange=onChange;
    this.canStart=canStart;
    this.canMutate=canMutate;
    this.onFeedback=onFeedback;
    this.getRecovery=getRecovery;
    this.canRecover=canRecover;
    this.onRecover=onRecover;
    this.confirmDurableRecovery=confirmDurableRecovery;
    this.clearRecovery=clearRecovery;
    this.simulation=null;
    this.arWorld=null;
    this.boundState=null;
    this.error='';
    this.stopArmedUntil=0;
    this.recoverArmedUntil=0;
    this.recoverArmedCopy='';
    this.routineSelection=null;
    this.routineFieldKey=null;
    this.routineResidentOptions=null;
    this.routineOptions=null;
    this.routineStatus='';
    this.appointmentSelection=null;
    this.appointmentFieldKey=null;
    this.appointmentResidentOptions=null;
    this.appointmentTargetOptions=null;
    this.appointmentKindOptions=null;
    this.appointmentExpected=null;
    this.appointmentStatus='';
    byId('citizens-start').addEventListener('click',()=>this.start());
    byId('citizens-bind-selected').addEventListener('click',()=>this.start('selected'));
    byId('citizens-add-selected').addEventListener('click',()=>this.addStation());
    byId('citizens-toggle').addEventListener('click',()=>this.toggle());
    byId('citizens-step').addEventListener('click',()=>this.step());
    byId('citizens-speed').addEventListener('change',()=>this.setSpeed());
    byId('citizens-stop').addEventListener('click',()=>this.stop());
    byId('citizens-recover').addEventListener('click',()=>this.recover());
    byId('citizens-routine-resident').addEventListener('change',()=>this.selectRoutineResident());
    byId('citizens-routine-id').addEventListener('change',()=>this.selectRoutine());
    byId('citizens-routine-apply').addEventListener('click',()=>this.applyRoutine());
    byId('citizens-appointment-resident').addEventListener('change',()=>this.selectAppointmentResident());
    byId('citizens-appointment-target').addEventListener('change',()=>this.selectAppointmentTarget());
    byId('citizens-appointment-kind').addEventListener('change',()=>this.selectAppointmentKind());
    byId('citizens-appointment-start').addEventListener('input',()=>this.appointmentInputChanged());
    byId('citizens-appointment-deadline').addEventListener('input',()=>this.appointmentInputChanged());
    byId('citizens-appointment-apply').addEventListener('click',()=>this.applyAppointment());
    byId('citizens-appointment-cancel').addEventListener('click',()=>this.cancelAppointment());
    this.timer=setInterval(()=>this.tick(),intervalMs);
    this.syncFromWorld();
  }

  commit(){
    this.world.citizens=this.simulation?.snapshot()||null;
    this.boundState=this.world.citizens;
    this.render();
    return this.onChange();
  }

  resetRoutineEditor(){
    this.routineSelection=null;
    this.routineFieldKey=null;
    this.routineResidentOptions=null;
    this.routineOptions=null;
    this.routineStatus='';
  }

  resetAppointmentEditor(){
    this.appointmentSelection=null;
    this.appointmentFieldKey=null;
    this.appointmentResidentOptions=null;
    this.appointmentTargetOptions=null;
    this.appointmentKindOptions=null;
    this.appointmentExpected=null;
    this.appointmentStatus='';
  }

  syncFromWorld(){
    // A PC restore stages its candidate directly on the world until the PC
    // exchange accepts it. Do not bind to or reconcile that temporary state.
    if(this.canMutate()){this.render();return;}
    if(this.world.spatial){
      // An explicit AR world restore can replace Citizens while this paused
      // adapter exists. Rebind to that restored state instead of overwriting it.
      if(this.world.citizens!==this.boundState){
        this.simulation=null;this.arWorld=null;
        this.resetRoutineEditor();
        this.resetAppointmentEditor();
      }
      if(!this.simulation&&this.world.citizens){
        try{
          const arWorld=Object.create(this.world);
          arWorld.scene={...this.world.virtualScene.scene,
            objects:this.world.scene.objects.filter(object=>object.anchorId==='web-floor')};
          arWorld.spatial=null;
          this.simulation=CitizensSimulation.restore(arWorld,this.world.citizens);
          this.arWorld=arWorld;
          this.simulation.pause();
          this.simulation.cancelSocial('entering AR cancelled the social session');
          for(const resident of this.simulation.state.residents)
            if(resident.activity||this.simulation.waitingFor(resident))this.simulation.fail(resident,
              'entering AR cancelled the current activity or queued wait');
        }catch(error){
          this.error=`Simulation bindings need recovery: ${error.message}`;
          this.boundState=this.world.citizens;
          this.render();return;
        }
      }
      if(this.simulation){
        if(!this.arWorld){
          this.simulation.pause();
          this.simulation.cancelSocial('entering AR cancelled the social session');
          // Keep a paused virtual-room view of the live floor objects. AR edits
          // can delete those objects, so Citizens must still reconcile before
          // the next whole-world browser save.
          for(const resident of this.simulation.state.residents)
            if(resident.activity||this.simulation.waitingFor(resident))this.simulation.fail(resident,
              'entering AR cancelled the current activity or queued wait');
          this.arWorld=Object.create(this.world);
          this.arWorld.scene={...this.world.virtualScene.scene,
            objects:this.world.scene.objects.filter(object=>object.anchorId==='web-floor')};
          this.arWorld.spatial=null;
          this.simulation.world=this.arWorld;
          this.simulation.observedScene=this.arWorld.scene;
          this.simulation.reconcileWorld();
        }else{
          this.arWorld.scene.objects=this.world.scene.objects.filter(object=>
            object.anchorId==='web-floor');
          this.simulation.reconcileWorld();
        }
        this.world.citizens=this.simulation.snapshot();
        this.boundState=this.world.citizens;
      }
      this.error=this.world.citizens?
        'Citizens is paused in AR. Return to the desktop virtual room to resume.':'';
      this.render();
      return;
    }
    if(this.arWorld){
      // leaveAR carries the live virtual-floor edits back into this scene.
      if(this.simulation){
        this.simulation.world=this.world;
        this.simulation.observedScene=this.world.scene;
      }
      this.arWorld=null;
    }
    if(!this.world.citizens){
      this.resetRoutineEditor();
      this.resetAppointmentEditor();
      this.simulation=null;this.boundState=null;this.error='';this.render();return;
    }
    if(this.world.citizens!==this.boundState||!this.simulation){
      this.resetRoutineEditor();
      this.resetAppointmentEditor();
      try{
        this.simulation=CitizensSimulation.restore(this.world,this.world.citizens);
        this.boundState=this.world.citizens;
        this.error='';
      }catch(error){
        this.simulation=null;this.boundState=this.world.citizens;
        this.error=`Simulation bindings need recovery: ${error.message}`;
      }
    }else{
      try{
        const previous=this.world.citizens;
        const before=JSON.stringify(this.world.citizens);
        const next=this.simulation.reconcileWorld();
        if(JSON.stringify(next)!==before){
          this.world.citizens=next;this.boundState=next;
          const retired=next.residents.length<previous.residents.length||
            next.stations.length<previous.stations.length;
          let feedback='Citizens paused after an authored world edit. Inspect the log before resuming.';
          if(retired)feedback=next.residents.length===0?
            'Citizens retired the last actor and paused the simulation.':
            next.paused?'Citizens retired a missing actor or resource. Press Run to resume surviving residents.':
              'Citizens retired a missing actor or resource; surviving residents continue.';
          if(this.simulation.invalidBindings.size)
            feedback='Citizens needs binding recovery after a world edit. Inspect the panel.';
          this.onFeedback(feedback);
        }
        this.error=this.simulation.invalidBindings.size?
          'A Citizens object is missing or incompatible. Undo the edit, restore a valid PC world, or stop Citizens to keep the edited scene. The last valid browser save was kept.':'';
      }catch(error){
        this.simulation.pause();
        this.world.citizens=this.simulation.snapshot();
        this.boundState=this.world.citizens;
        this.error=`Simulation bindings need recovery: ${error.message}`;
      }
    }
    this.render();
  }

  start(mode='fixture'){
    const mutationBlocked=this.canMutate();
    if(mutationBlocked){this.onFeedback(mutationBlocked,true);this.render();return;}
    const blocked=this.canStart(mode);
    if(blocked){this.onFeedback(blocked,true);this.render();return;}
    const seed=Number(byId('citizens-seed').value);
    if(!Number.isSafeInteger(seed)||seed<1||seed>0xffffffff){
      this.onFeedback('Enter a whole-number Citizens seed from 1 to 4294967295.',true);return;
    }
    try{
      this.simulation=mode==='selected'?
        createCitizensWithSelectedFurniture(this.world,{
          seed,objectId:this.world.selection.objectId}):
        createCitizensDemo(this.world,{seed});
      this.error='';this.commit();
      this.onFeedback(mode==='selected'?
        'Two residents were added to the existing Matrix world and bound to the selected station. Press Run to begin.':
        'Two residents were added to this Matrix world. Press Run to begin.');
    }catch(error){this.onFeedback(`Citizens could not start: ${error.message}`,true);}
  }

  addStation(){
    const mutationBlocked=this.canMutate();
    if(mutationBlocked){this.onFeedback(mutationBlocked,true);this.render();return;}
    this.syncFromWorld();
    const blocked=this.canStart('addition');
    if(blocked||!this.simulation||this.error){
      this.onFeedback(blocked||this.error||'Start Citizens before adding a station.',true);
      this.render();return;
    }
    try{
      const station=this.simulation.addSelectedStation(this.world.selection.objectId);
      this.error='';this.commit();
      this.onFeedback(`${station.stations.at(-1).id} is available in the existing Citizens world. Press Run to continue.`);
    }catch(error){
      this.onFeedback(`Citizens could not add the selected station: ${error.message}`,true);
      this.render();
    }
  }

  toggle(){
    if(this.canMutate())return;
    this.syncFromWorld();
    if(!this.simulation||this.error)return;
    this.simulation.snapshot().paused?this.simulation.resume():this.simulation.pause();
    this.commit();
  }

  step(){
    if(this.canMutate())return;
    this.syncFromWorld();
    if(!this.simulation||this.error||!this.simulation.snapshot().paused)return;
    this.simulation.step();this.commit();
  }

  setSpeed(){
    if(this.canMutate())return;
    const speed=Number(byId('citizens-speed').value);
    this.syncFromWorld();
    if(!this.simulation||this.error||this.world.spatial)return;
    try{
      this.simulation.setClockSpeed(speed);
      this.commit();
    }catch(error){this.onFeedback(`Citizens clock speed was rejected: ${error.message}`,true);this.render();}
  }

  selectRoutineResident(){
    this.routineSelection={residentId:byId('citizens-routine-resident').value,
      routineId:null};
    this.routineFieldKey=null;
    this.routineStatus='';
    this.render();
  }

  selectRoutine(){
    this.routineSelection={residentId:byId('citizens-routine-resident').value,
      routineId:byId('citizens-routine-id').value};
    this.routineFieldKey=null;
    this.routineStatus='';
    this.render();
  }

  routineEditBlock(state,mutationBlocked,routine){
    if(mutationBlocked)return mutationBlocked;
    if(this.world.spatial)return 'Return to the desktop virtual room to edit routines.';
    if(this.error)return this.error;
    if(!state)return 'Start Citizens and pause to edit a routine.';
    if(!state.paused)return 'Pause Citizens before editing a routine.';
    if(this.simulation?.invalidBindings?.size)
      return 'Recover Citizens bindings before editing routines.';
    if(!routine)return 'This resident has no routine to edit.';
    return '';
  }

  renderRoutineEditor(state,mutationBlocked){
    const residents=state?.residents||[];
    const residentSelect=byId('citizens-routine-resident');
    const routineSelect=byId('citizens-routine-id');
    const residentOptions=JSON.stringify(residents.map(item=>[item.id,item.name]));
    if(this.routineResidentOptions!==residentOptions){
      residentSelect.replaceChildren(...residents.map(resident=>{
        const option=document.createElement('option');
        option.value=resident.id;option.textContent=resident.name;
        return option;
      }));
      this.routineResidentOptions=residentOptions;
    }
    const resident=residents.find(item=>item.id===this.routineSelection?.residentId)||
      residents[0];
    const routineOptions=JSON.stringify([resident?.id||'',
      ...(resident?.routines||[]).map(item=>[item.id,item.kind])]);
    if(this.routineOptions!==routineOptions){
      routineSelect.replaceChildren(...(resident?.routines||[]).map(routine=>{
        const option=document.createElement('option');
        option.value=routine.id;
        option.textContent=`${routine.id} · ${routine.kind}`;
        return option;
      }));
      this.routineOptions=routineOptions;
    }
    const routine=resident?.routines?.find(item=>
      item.id===this.routineSelection?.routineId)||resident?.routines?.[0];
    const fieldKey=JSON.stringify([resident?.id||'',routine?.id||'']);
    this.routineSelection=resident?{residentId:resident.id,routineId:routine?.id||null}:null;
    residentSelect.value=resident?.id||'';
    routineSelect.value=routine?.id||'';
    if(this.routineFieldKey!==fieldKey){
      byId('citizens-routine-start').value=routine?String(routine.startMinute):'';
      byId('citizens-routine-end').value=routine?String(routine.endMinute):'';
      byId('citizens-routine-priority').value=routine?.priority||'default';
      this.routineFieldKey=fieldKey;
    }
    const block=this.routineEditBlock(state,mutationBlocked,routine);
    for(const id of ['citizens-routine-resident','citizens-routine-id',
      'citizens-routine-start','citizens-routine-end','citizens-routine-priority',
      'citizens-routine-apply'])byId(id).disabled=!!block;
    byId('citizens-routine-status').textContent=block||this.routineStatus||
      `Editing ${resident.name}'s ${routine.id}. Changes apply at the next idle choice.`;
  }

  applyRoutine(){
    const mutationBlocked=this.canMutate();
    if(mutationBlocked||this.world.spatial){
      this.routineStatus=mutationBlocked||
        'Return to the desktop virtual room to edit routines.';
      this.onFeedback(this.routineStatus,true);
      this.render();return;
    }
    this.syncFromWorld();
    const state=this.simulation?.snapshot();
    const residentId=byId('citizens-routine-resident').value;
    const routineId=byId('citizens-routine-id').value;
    const resident=state?.residents?.find(item=>item.id===residentId);
    const routine=resident?.routines?.find(item=>item.id===routineId);
    const blocked=this.routineEditBlock(state,this.canMutate(),routine);
    if(blocked){
      this.routineStatus=blocked;this.onFeedback(blocked,true);this.render();return;
    }
    try{
      const minute=(id,max,label)=>{
        const raw=byId(id).value.trim();
        const value=Number(raw);
        if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||value>max)
          throw Error(`${label} must be a whole minute from 0 to ${max}`);
        return value;
      };
      const startMinute=minute('citizens-routine-start',1439,'Start');
      const endMinute=minute('citizens-routine-end',1440,'End');
      if(startMinute===endMinute)throw Error('Start and end must differ');
      const priority=byId('citizens-routine-priority').value;
      if(!['high','default','low'].includes(priority))
        throw Error('Choose a valid routine priority');
      this.simulation.editRoutine(residentId,routineId,
        {startMinute,endMinute,priority});
    }catch(error){
      this.routineStatus=`Routine was not changed: ${error.message}`;
      this.onFeedback(this.routineStatus,true);
      this.render();
      return;
    }
    this.routineFieldKey=null;
    this.routineStatus=`${resident.name}'s ${routine.id} routine updated. It applies at the next idle choice; current activity continues.`;
    try{
      const warning=this.commit();
      if(warning){
        this.routineStatus=`Routine updated in this tab, but browser saving reported: ${warning}`;
        this.render();
      }
    }catch(error){
      this.routineStatus=`Routine updated in this tab, but browser saving did not finish: ${error.message}`;
      this.onFeedback(this.routineStatus,true);
      this.render();
    }
  }

  selectAppointmentResident(){
    this.appointmentSelection={residentId:byId('citizens-appointment-resident').value,
      appointmentId:null,kind:null};
    this.appointmentExpected=null;
    this.appointmentFieldKey=null;
    this.appointmentStatus='';
    this.render();
  }

  selectAppointmentTarget(){
    const residentId=byId('citizens-appointment-resident').value;
    const appointmentId=byId('citizens-appointment-target').value||null;
    const resident=this.simulation?.snapshot().residents.find(item=>item.id===residentId);
    const appointment=resident?.appointments.find(item=>item.id===appointmentId);
    this.appointmentSelection={residentId,appointmentId,
      kind:appointment?.kind||null};
    this.appointmentExpected=appointment?appointmentWindow(appointment):null;
    this.appointmentFieldKey=null;
    this.appointmentStatus='';
    this.render();
  }

  selectAppointmentKind(){
    this.appointmentSelection={residentId:byId('citizens-appointment-resident').value,
      appointmentId:this.appointmentSelection?.appointmentId||null,
      kind:byId('citizens-appointment-kind').value};
    this.appointmentStatus='';
    this.render();
  }

  appointmentInputChanged(){
    this.appointmentStatus='';
    this.renderAppointmentEditor(this.simulation?.snapshot(),this.canMutate());
  }

  appointmentGlobalBlock(state,mutationBlocked){
    if(mutationBlocked)return mutationBlocked;
    if(this.world.spatial)return 'Return to the desktop virtual room to edit appointments.';
    if(this.error)return this.error;
    if(!state)return 'Start Citizens and pause to edit appointments.';
    if(!state.paused)return 'Pause Citizens before editing appointments.';
    if(this.simulation?.invalidBindings?.size)
      return 'Recover Citizens bindings before editing appointments.';
    return '';
  }

  appointmentEditBlock(state,mutationBlocked,resident,station,
    appointmentId,appointment,action='apply'){
    const globalBlock=this.appointmentGlobalBlock(state,mutationBlocked);
    if(globalBlock)return globalBlock;
    if(!resident)return 'No resident is available for an appointment.';
    if(appointmentId){
      if(!appointment)return 'The selected appointment is no longer saved. Choose another appointment.';
      if(appointment.status!=='pending')
        return `${appointment.id} is ${appointment.status}; only pending appointments can be changed.`;
      if(!sameAppointmentWindow(this.appointmentExpected,appointment))
        return `${appointment.id} changed since it was selected. Choose New, then select it again to review the current values.`;
    }else if(action==='cancel')return 'Choose a pending appointment to cancel.';
    if(action==='cancel')return '';
    if(!station)return 'Add a reviewed rest or eat station before scheduling this activity.';
    if(state.clockTick>=999999998)
      return 'The simulation clock cannot fit another appointment.';
    if(!appointmentId&&(resident.appointments||[]).filter(openAppointment).length>=MAX_OPEN_APPOINTMENTS)
      return `${resident.name} already has three open appointments. Revise or cancel a pending one, or wait for an outcome.`;
    return '';
  }

  appointmentConflicts(state,resident,appointmentId,kind,startTick,deadlineTick){
    if(!state||!resident||!['rest','eat'].includes(kind)||
      !Number.isSafeInteger(startTick)||!Number.isSafeInteger(deadlineTick)||
      startTick>=deadlineTick)return 'Enter a valid start and inclusive deadline to preview overlaps.';
    const draft={kind,startTick,deadlineTick};
    const own=(resident.appointments||[]).filter(item=>openAppointment(item)&&
      item.id!==appointmentId&&windowsOverlap(draft,item));
    const shared=state.residents.flatMap(other=>other.id===resident.id?[]:
      (other.appointments||[]).filter(item=>openAppointment(item)&&
        item.kind===kind&&windowsOverlap(draft,item)).map(item=>({other,item})));
    const notes=[];
    if(own.length)notes.push(`Overlaps ${own.map(item=>
      `${resident.name}'s ${item.id} (${item.kind} m ${item.startTick}–${item.deadlineTick})`).join(', ')}. The earliest deadline is considered first when idle.`);
    if(shared.length)notes.push(`Shared ${kind} station may queue with ${shared.map(({other,item})=>
      `${other.name}'s ${item.id} (m ${item.startTick}–${item.deadlineTick})`).join(', ')}.`);
    const station=state.stations.find(item=>item.kind===kind);
    if(station&&(station.claim||(station.waiters||[]).length))
      notes.push(`${station.id} is occupied or queued right now; future availability is not guaranteed.`);
    return notes.join(' ')||'No saved appointment overlaps this window. Current activities and FIFO waits may still delay it.';
  }

  renderAppointmentEditor(state,mutationBlocked){
    const residents=state?.residents||[];
    const residentSelect=byId('citizens-appointment-resident');
    const targetSelect=byId('citizens-appointment-target');
    const kindSelect=byId('citizens-appointment-kind');
    const residentOptions=JSON.stringify(residents.map(item=>[item.id,item.name]));
    if(this.appointmentResidentOptions!==residentOptions){
      residentSelect.replaceChildren(...residents.map(resident=>{
        const option=document.createElement('option');
        option.value=resident.id;option.textContent=resident.name;
        return option;
      }));
      this.appointmentResidentOptions=residentOptions;
    }
    const resident=residents.find(item=>item.id===this.appointmentSelection?.residentId)||
      residents[0];
    const appointmentId=resident&&this.appointmentSelection?.residentId===resident.id?
      this.appointmentSelection.appointmentId:null;
    const appointment=resident?.appointments?.find(item=>item.id===appointmentId);
    const targets=[['','New appointment'],...[...(resident?.appointments||[])]
      .sort((a,b)=>appointmentNumber(a)-appointmentNumber(b)).map(item=>
      [item.id,`${item.id} · ${item.kind} m ${item.startTick}–${item.deadlineTick} · ${item.status}`])];
    if(appointmentId&&!appointment)targets.push([appointmentId,
      `${appointmentId} · no longer saved`]);
    const targetOptions=JSON.stringify([resident?.id||'',targets]);
    if(this.appointmentTargetOptions!==targetOptions){
      targetSelect.replaceChildren(...targets.map(([id,label])=>{
        const option=document.createElement('option');
        option.value=id;option.textContent=label;
        return option;
      }));
      this.appointmentTargetOptions=targetOptions;
    }
    const stations=(state?.stations||[]).filter(item=>
      item.kind==='rest'||item.kind==='eat');
    const kindOptions=JSON.stringify(stations.map(item=>[item.kind,item.id]));
    if(this.appointmentKindOptions!==kindOptions){
      kindSelect.replaceChildren(...stations.map(station=>{
        const option=document.createElement('option');
        option.value=station.kind;
        option.textContent=`${station.kind} at ${station.id}`;
        return option;
      }));
      this.appointmentKindOptions=kindOptions;
    }
    const selectedKind=this.appointmentSelection?.kind||appointment?.kind;
    const station=stations.find(item=>item.kind===selectedKind)||
      stations[0];
    const fieldKey=JSON.stringify([resident?.id||'',appointmentId||'new']);
    this.appointmentSelection=resident?{
      residentId:resident.id,appointmentId:appointmentId||null,
      kind:station?.kind||null}:null;
    residentSelect.value=resident?.id||'';
    targetSelect.value=appointmentId||'';
    kindSelect.value=station?.kind||'';
    const startInput=byId('citizens-appointment-start');
    const deadlineInput=byId('citizens-appointment-deadline');
    const firstStart=(state?.clockTick??-1)+1;
    const lastStart=Math.min((state?.clockTick??-1)+APPOINTMENT_HORIZON,999999998);
    if(this.appointmentFieldKey!==fieldKey){
      const proposedStart=state?firstStart:0;
      startInput.value=appointment?String(appointment.startTick):
        state?String(proposedStart):'';
      deadlineInput.value=appointment?String(appointment.deadlineTick):
        state?String(Math.min(proposedStart+60,999999999)):'';
      this.appointmentFieldKey=fieldKey;
    }
    startInput.min=String(Math.max(0,firstStart));
    startInput.max=String(Math.max(0,lastStart));
    const typedStart=Number(startInput.value);
    const usableStart=/^\d+$/.test(startInput.value)&&
      Number.isSafeInteger(typedStart)&&typedStart>=firstStart&&
      typedStart<=lastStart?typedStart:firstStart;
    const firstDeadline=usableStart+1;
    const lastDeadline=Math.min(usableStart+APPOINTMENT_HORIZON,999999999);
    deadlineInput.min=String(Math.min(firstDeadline,999999999));
    deadlineInput.max=String(lastDeadline);
    byId('citizens-appointment-hint').textContent=state?
      `Current simulated minute ${state.clockTick}. Start at m ${firstStart}–${lastStart}; complete by m ${firstDeadline}–${lastDeadline} for the entered start. The deadline minute counts. At most three open appointments per resident; the latest three outcomes are retained.`:
      'Start and deadline use the Citizens clock, not local wall time.';
    const globalBlock=this.appointmentGlobalBlock(state,mutationBlocked);
    const block=this.appointmentEditBlock(state,mutationBlocked,resident,station,
      appointmentId,appointment);
    const cancelBlock=this.appointmentEditBlock(state,mutationBlocked,resident,station,
      appointmentId,appointment,'cancel');
    residentSelect.disabled=!!globalBlock||!residents.length;
    targetSelect.disabled=!!globalBlock||!resident;
    kindSelect.disabled=!!block||!stations.length;
    for(const id of ['citizens-appointment-start','citizens-appointment-deadline'])
      byId(id).disabled=!!block;
    byId('citizens-appointment-apply').textContent=appointmentId?
      'Apply appointment':'Schedule appointment';
    byId('citizens-appointment-cancel').disabled=!!cancelBlock;
    const openCount=(resident?.appointments||[]).filter(openAppointment).length;
    const historyCount=(resident?.appointments||[]).length-openCount;
    byId('citizens-appointment-capacity').textContent=resident?
      `${resident.name}: ${openCount}/${MAX_OPEN_APPOINTMENTS} open appointments · ${historyCount} recent outcome${historyCount===1?'':'s'} retained.`:
      'Start Citizens to see open appointments and recent outcomes.';
    const draftStart=/^\d+$/.test(startInput.value)?Number(startInput.value):NaN;
    const draftDeadline=/^\d+$/.test(deadlineInput.value)?Number(deadlineInput.value):NaN;
    const validDraft=Number.isSafeInteger(draftStart)&&draftStart>=firstStart&&
      draftStart<=lastStart&&Number.isSafeInteger(draftDeadline)&&
      draftDeadline>=draftStart+1&&draftDeadline<=
        Math.min(draftStart+APPOINTMENT_HORIZON,999999999);
    byId('citizens-appointment-apply').disabled=!!block||!validDraft;
    byId('citizens-appointment-conflicts').textContent=validDraft?
      this.appointmentConflicts(state,resident,appointmentId,station?.kind,
        draftStart,draftDeadline):
      'Enter a future start and inclusive deadline to preview overlaps.';
    byId('citizens-appointment-status').textContent=block||this.appointmentStatus||
      `${appointmentId?`Revise ${resident.name}'s ${appointmentId}`:
        `Schedule ${resident.name}`} to ${station.kind} at ${station.id}. A safe optional handoff is considered when the appointment is due.`;
  }

  applyAppointment(){
    const mutationBlocked=this.canMutate();
    if(mutationBlocked||this.world.spatial){
      this.appointmentStatus=mutationBlocked||
        'Return to the desktop virtual room to edit appointments.';
      this.onFeedback(this.appointmentStatus,true);
      this.render();return;
    }
    const previousBound=this.boundState;
    this.syncFromWorld();
    if(this.boundState!==previousBound){
      this.appointmentStatus='The world changed. Review and select the appointment again.';
      this.onFeedback(this.appointmentStatus,true);this.render();return;
    }
    const state=this.simulation?.snapshot();
    const residentId=byId('citizens-appointment-resident').value;
    const appointmentId=this.appointmentSelection?.appointmentId||null;
    const kind=byId('citizens-appointment-kind').value;
    const resident=state?.residents?.find(item=>item.id===residentId);
    const appointment=resident?.appointments.find(item=>item.id===appointmentId);
    const station=state?.stations?.find(item=>item.kind===kind);
    const selectionChanged=residentId!==this.appointmentSelection?.residentId||
      (byId('citizens-appointment-target').value||null)!==appointmentId;
    const blocked=selectionChanged?'Choose the resident and appointment again.':
      this.appointmentEditBlock(state,this.canMutate(),resident,station,
        appointmentId,appointment);
    if(blocked){
      this.appointmentStatus=blocked;this.onFeedback(blocked,true);this.render();return;
    }
    let changed;
    try{
      const wholeTick=(id,label,min,max)=>{
        const raw=byId(id).value.trim(),value=Number(raw);
        if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||
          value<min||value>max)
          throw Error(`${label} must be a whole simulated minute from ${min} to ${max}`);
        return value;
      };
      const startTick=wholeTick('citizens-appointment-start','Start',
        state.clockTick+1,Math.min(state.clockTick+APPOINTMENT_HORIZON,999999998));
      const deadlineTick=wholeTick('citizens-appointment-deadline','Deadline',
        startTick+1,Math.min(startTick+APPOINTMENT_HORIZON,999999999));
      const details={kind,startTick,deadlineTick};
      if(appointmentId){
        this.simulation.reviseAppointment(residentId,appointmentId,
          this.appointmentExpected,details);
        this.appointmentExpected=details;
        changed=appointmentId;
      }else{
        const beforeIds=new Set(resident.appointments.map(item=>item.id));
        const after=this.simulation.scheduleAppointment(residentId,details);
        changed=after.residents.find(item=>item.id===residentId)?.appointments
          .find(item=>!beforeIds.has(item.id))?.id;
      }
    }catch(error){
      this.appointmentStatus=`Appointment was not ${appointmentId?'revised':'scheduled'}: ${error.message}`;
      this.onFeedback(this.appointmentStatus,true);
      this.render();return;
    }
    this.appointmentFieldKey=null;
    this.appointmentStatus=`${appointmentId?'Revised':'Scheduled'} ${changed||'appointment'} for ${resident.name}. A safe optional handoff is considered when it is due.`;
    try{
      const warning=this.commit();
      if(warning){
        this.appointmentStatus=`Appointment ${appointmentId?'revised':'scheduled'} in this tab, but browser saving reported: ${warning}`;
        this.render();
      }
    }catch(error){
      this.appointmentStatus=`Appointment ${appointmentId?'revised':'scheduled'} in this tab, but browser saving did not finish: ${error.message}`;
      this.onFeedback(this.appointmentStatus,true);
      this.render();
    }
  }

  cancelAppointment(){
    const mutationBlocked=this.canMutate();
    if(mutationBlocked||this.world.spatial){
      this.appointmentStatus=mutationBlocked||
        'Return to the desktop virtual room to cancel appointments.';
      this.onFeedback(this.appointmentStatus,true);this.render();return;
    }
    const previousBound=this.boundState;
    this.syncFromWorld();
    if(this.boundState!==previousBound){
      this.appointmentStatus='The world changed. Review and select the appointment again.';
      this.onFeedback(this.appointmentStatus,true);this.render();return;
    }
    const state=this.simulation?.snapshot();
    const residentId=byId('citizens-appointment-resident').value;
    const appointmentId=this.appointmentSelection?.appointmentId||null;
    const resident=state?.residents.find(item=>item.id===residentId);
    const appointment=resident?.appointments.find(item=>item.id===appointmentId);
    const selectionChanged=residentId!==this.appointmentSelection?.residentId||
      (byId('citizens-appointment-target').value||null)!==appointmentId;
    const blocked=selectionChanged?'Choose the resident and appointment again.':
      this.appointmentEditBlock(state,this.canMutate(),resident,null,
        appointmentId,appointment,'cancel');
    if(blocked){
      this.appointmentStatus=blocked;this.onFeedback(blocked,true);this.render();return;
    }
    try{
      this.simulation.cancelAppointment(residentId,appointmentId,
        this.appointmentExpected);
    }catch(error){
      this.appointmentStatus=`Appointment was not cancelled: ${error.message}`;
      this.onFeedback(this.appointmentStatus,true);this.render();return;
    }
    this.appointmentFieldKey=null;
    this.appointmentStatus=`Cancelled ${appointmentId} for ${resident.name}. Its outcome remains in recent history.`;
    try{
      const warning=this.commit();
      if(warning){
        this.appointmentStatus=`Appointment cancelled in this tab, but browser saving reported: ${warning}`;
        this.render();
      }
    }catch(error){
      this.appointmentStatus=`Appointment cancelled in this tab, but browser saving did not finish: ${error.message}`;
      this.onFeedback(this.appointmentStatus,true);this.render();
    }
  }

  tick(){
    if(this.recoverArmedUntil&&performance.now()>this.recoverArmedUntil){
      this.recoverArmedUntil=0;this.recoverArmedCopy='';this.render();
    }
    if(document.hidden||!this.simulation||this.world.spatial||this.canMutate())return;
    this.syncFromWorld();
    if(!this.simulation||this.error||this.simulation.snapshot().paused)return;
    const speed=this.simulation.snapshot().clockSpeed||1;
    for(let minute=0;minute<speed;minute++)
      if(this.simulation.advance().paused)break;
    this.commit();
  }

  pauseForCheckpoint(){
    if(this.canMutate())return;
    this.syncFromWorld();
    if(this.simulation&&!this.simulation.snapshot().paused){
      this.simulation.pause();this.commit();
    }
  }

  decorate(view){
    const colors={ada:'#71c5ef',bo:'#f1a878'};
    this.simulation?.snapshot().residents.forEach((resident,index)=>{
      const visual=view.objectRoots.get(resident.objectId)?.userData?.visual;
      visual?.traverse(node=>{
        if(!node.isMesh)return;
        const color=colors[resident.id]||Object.values(colors)[index%2];
        node.material.color?.set(color);
        node.material.emissive?.set(color).multiplyScalar(.16);
      });
    });
  }

  stop(){
    if(this.canMutate())return;
    if(!this.world.citizens)return;
    if(performance.now()>this.stopArmedUntil){
      this.stopArmedUntil=performance.now()+10000;
      byId('citizens-stop').textContent='Confirm stop';
      this.onFeedback('Click Confirm stop within ten seconds to detach Citizens. Their scene objects stay in the world.');
      return;
    }
    this.stopArmedUntil=0;
    this.simulation?.cancelSocial('stopping Citizens cancelled the social session');
    this.simulation=null;this.arWorld=null;this.boundState=null;
    this.world.citizens=null;this.error='';
    this.resetRoutineEditor();
    this.resetAppointmentEditor();
    this.render();this.onChange();
    this.onFeedback('Citizens stopped. Their objects remain as ordinary scene objects.');
  }

  recover(){
    const blocked=this.canRecover();
    if(blocked||this.world.spatial){
      this.recoverArmedUntil=0;this.recoverArmedCopy='';this.render();
      this.onFeedback(blocked||'Return to the desktop virtual room before restoring Citizens.',true);
      return;
    }
    let copy;
    try{copy=this.getRecovery();}
    catch(error){
      this.recoverArmedUntil=0;this.recoverArmedCopy='';this.render();
      this.onFeedback(`Pre-deletion browser copy is unreadable: ${error.message}`,true);
      return;
    }
    if(!copy){
      this.recoverArmedUntil=0;this.recoverArmedCopy='';this.render();
      this.onFeedback('No pre-deletion browser copy is available.',true);
      return;
    }
    const signature=JSON.stringify(copy);
    const tick=Number.isSafeInteger(copy.citizens?.clockTick)?
      `minute ${copy.citizens.clockTick}`:'the saved minute';
    if(performance.now()>this.recoverArmedUntil||signature!==this.recoverArmedCopy){
      this.recoverArmedUntil=performance.now()+10000;
      this.recoverArmedCopy=signature;
      this.render();
      this.onFeedback(`Click Confirm restore within ten seconds to replace the current scene, game, and Citizens with the pre-deletion browser copy from ${tick}. The manual Save world checkpoint is untouched.`);
      return;
    }
    this.recoverArmedUntil=0;this.recoverArmedCopy='';
    try{this.onRecover(copy);}
    catch(error){
      this.render();
      this.onFeedback(`Pre-deletion world could not be restored: ${error.message}`,true);
      return;
    }
    this.simulation=null;this.boundState=null;this.error='';
    let warning;
    try{warning=this.onChange();}
    catch(error){warning=error.message||String(error);}
    if(warning!==''){
      this.render();
      this.onFeedback(`Restored the pre-deletion world in this tab, but the browser save did not complete cleanly: ${warning||'save status unavailable'}. The recovery copy was kept.`,true);
      return;
    }
    let durableConfirmed=false;
    try{durableConfirmed=this.confirmDurableRecovery();}
    catch{ /* Keep the recovery copy until the durable world can be verified. */ }
    if(!durableConfirmed){
      this.render();
      this.onFeedback('Restored the pre-deletion world in this tab, but the durable browser copy could not be verified. The recovery copy was kept.',true);
      return;
    }
    try{this.clearRecovery();}
    catch(error){
      this.render();
      this.onFeedback(`Restored and saved the pre-deletion world, but the recovery copy could not be cleared: ${error.message}`,true);
      return;
    }
    this.render();
    this.onFeedback(`Restored and saved the pre-deletion world from ${tick}. Review the scene and Citizens status. The manual Save world checkpoint is unchanged.`);
  }

  render(){
    const state=this.simulation?.snapshot();
    const navigationIssue=state&&!this.world.spatial?
      this.simulation.navigationIssue?.()||'':'';
    const residentNames=new Map((state?.residents||[]).map(resident=>
      [resident.id,resident.name]));
    const waiting=new Map();
    for(const station of state?.stations||[])
      (station.waiters||[]).forEach((waiter,index)=>waiting.set(waiter.residentId,
        {stationId:station.id,executionId:waiter.executionId,position:index+1}));
    const blocked=this.canStart('fixture');
    const selectedBlocked=this.canStart('selected');
    const additionBlocked=state?
      this.canStart('addition')||this.simulation?.stationAdditionReadiness?.(
        this.world.selection.objectId)||'':'Start Citizens before adding another station.';
    const mutationBlocked=this.canMutate();
    let recovery=null,recoveryError='';
    try{recovery=this.getRecovery();}
    catch(error){recoveryError=error.message||String(error);}
    const recoveryBlocked=this.canRecover();
    const recoveryTick=Number.isSafeInteger(recovery?.citizens?.clockTick)?
      `minute ${recovery.citizens.clockTick}`:'';
    if(!recovery||recoveryBlocked||this.world.spatial){
      this.recoverArmedUntil=0;this.recoverArmedCopy='';
    }
    byId('citizens-start').disabled=!!state||!!this.world.citizens||!!blocked||!!mutationBlocked;
    byId('citizens-bind-selected').disabled=!!state||!!this.world.citizens||
      !!selectedBlocked||!!mutationBlocked;
    byId('citizens-add-selected').disabled=!state||!!this.error||
      !!additionBlocked||!!mutationBlocked;
    byId('citizens-add-status').textContent=additionBlocked||
      'Selected complementary station is eligible. Add verifies reachability before binding.';
    byId('citizens-selection-status').textContent=state?
      `Citizens uses ${state.stations.map(station=>station.id).join(' and ')||'no remaining station'} in this world.`:
      selectedBlocked||'Selected station is ready. Use it to add two residents without replacing the scene.';
    byId('citizens-toggle').disabled=!state||state.residents.length===0||
      !!this.error||!!this.world.spatial||!!mutationBlocked||
      !!(state?.paused&&navigationIssue);
    byId('citizens-step').disabled=!state||state.residents.length===0||
      !!this.error||!state.paused||!!this.world.spatial||!!mutationBlocked||
      !!navigationIssue;
    byId('citizens-speed').disabled=!state||!!this.error||
      !!this.world.spatial||!!mutationBlocked;
    byId('citizens-speed').value=String(state?.clockSpeed||1);
    byId('citizens-stop').disabled=!this.world.citizens||!!mutationBlocked;
    byId('citizens-recover').disabled=!recovery||!!recoveryBlocked||!!this.world.spatial;
    byId('citizens-recover').textContent=performance.now()<this.recoverArmedUntil&&recovery?
      `Confirm restore ${recoveryTick}`:`Restore ${recoveryTick||'before deletion'}`;
    byId('citizens-recovery-status').textContent=recoveryError?
      `Pre-deletion browser copy is unreadable: ${recoveryError}. The manual Save world checkpoint is separate.`:
      recovery?recoveryBlocked||this.world.spatial?
        `${recoveryBlocked||'Return to the desktop virtual room to restore this copy.'} The manual Save world checkpoint is separate.`:
        `A pre-deletion browser copy from ${recoveryTick||'an earlier tick'} is available. Restoring replaces the current scene, game, and Citizens. The manual Save world checkpoint is untouched.`:
        'No pre-deletion browser copy is available. The manual Save world checkpoint is separate.';
    if(performance.now()>this.stopArmedUntil)byId('citizens-stop').textContent='Stop Citizens';
    const minute=state?.clockTick%1440;
    const day=state?Math.floor(state.clockTick/1440)+1:1;
    const time=state?`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`:'00:00';
    byId('citizens-status').textContent=this.error||(
      state?`${state.paused?'Paused':'Running'} · day ${day} ${time} · minute ${state.clockTick} · ${state.clockSpeed||1}× · seed ${state.seed}${navigationIssue?` · navigation unavailable: ${navigationIssue}`:''}`:
        this.world.citizens?'Citizens state needs recovery. Undo the edit, restore a valid PC world, or stop Citizens.':
          (blocked&&selectedBlocked?blocked:
            'No Citizens in this world. Start an empty fixture or use a selected station.'));
    byId('citizens-toggle').textContent=state?.paused?'Run':'Pause';
    const cards=[];
    const social=state?.socialSession;
    for(const resident of state?.residents||[]){
      const item=document.createElement('li');
      const queue=waiting.get(resident.id);
      const peerId=social?.initiatorId===resident.id?social?.inviteeId:social?.initiatorId;
      const peer=residentNames.get(peerId)||peerId;
      const socialAction=resident.socialSessionId&&resident.socialSessionId===social?.id?
        social.phase==='offered'?
          `${resident.id===social.initiatorId?'inviting':'invited by'} ${peer} · session ${social.id}`:
          `conversing with ${peer} · session ${social.id}`:null;
      const action=socialAction|| (queue?`waiting for ${queue.stationId} · queue #${queue.position} · execution ${queue.executionId}`:
        resident.activity?`${resident.activity.phase==='egress'?`leaving ${resident.activity.stationId}`:
          `${resident.activity.phase==='travel'?'going to':'using'} ${resident.activity.kind}`} · execution ${resident.activity.executionId}`:'choosing');
      const socialNeed=Number.isFinite(resident.needs.social)?
        ` · social ${Math.round(resident.needs.social)}`:'';
      item.textContent=`${resident.name}: ${action} · fullness ${Math.round(resident.needs.hunger)} · energy ${Math.round(resident.needs.energy)} · fun ${Math.round(resident.needs.fun)}${socialNeed}${resident.lastOutcome?` · ${resident.lastOutcome}`:''}`;
      cards.push(item);
    }
    for(const id of state?.retiredResidentIds||[]){
      const item=document.createElement('li');
      item.textContent=`${id}: retired · actor object removed from this world`;
      cards.push(item);
    }
    byId('citizens-residents').replaceChildren(...cards);
    const dayMinute=state?.clockTick%1440;
    const routines=(state?.residents||[]).map(resident=>{
      const item=document.createElement('li');
      const current=(resident.routines||[]).filter(routine=>
        activeRoutine(routine,dayMinute)).map(routine=>routine.id);
      item.textContent=`${resident.name}: active routines ${current.join(', ')||'none'} · ${decisionSummary(resident.lastDecision)}`;
      return item;
    });
    byId('citizens-routines').replaceChildren(...routines);
    this.renderRoutineEditor(state,mutationBlocked);
    this.renderAppointmentEditor(state,mutationBlocked);
    const appointments=(state?.residents||[]).flatMap(resident=>
      (resident.appointments||[]).map(appointment=>({resident,appointment})));
    const open=appointments.filter(({appointment})=>openAppointment(appointment));
    open.sort((a,b)=>a.appointment.deadlineTick-b.appointment.deadlineTick||
      a.appointment.startTick-b.appointment.startTick||
      appointmentNumber(a.appointment)-appointmentNumber(b.appointment));
    const history=appointments.filter(({appointment})=>!openAppointment(appointment));
    history.sort((a,b)=>b.appointment.resolvedTick-a.appointment.resolvedTick||
      a.resident.id.localeCompare(b.resident.id)||
      appointmentNumber(a.appointment)-appointmentNumber(b.appointment));
    const appointmentRow=({resident,appointment})=>{
      const item=document.createElement('li');
      const queue=waiting.get(resident.id);
      const status=appointment.status==='active'?
        queue?.executionId===appointment.executionId?
          `queued for ${queue.stationId} · ticket #${queue.position}`:
          resident.activity?.executionId===appointment.executionId?
            `started · ${resident.activity.phase}`:'active':
        appointment.status;
      const execution=appointment.executionId?
        ` · execution ${appointment.executionId}`:'';
      const resolved=appointment.resolvedTick!==null&&
        appointment.resolvedTick!==undefined?
          ` at m ${appointment.resolvedTick}`:'';
      const receipt=appointment.requestId?
        ` · receipt ${appointment.requestId}`:'';
      const reason=appointment.reason?` · ${appointment.reason}`:'';
      item.textContent=`${resident.name}: ${appointment.id} · ${appointment.kind} `+
        `m ${appointment.startTick}–${appointment.deadlineTick} (deadline inclusive) · `+
        `${status}${execution}${resolved}${receipt}${reason}`;
      return item;
    };
    byId('citizens-appointments').replaceChildren(...open.map(appointmentRow));
    byId('citizens-appointment-history').replaceChildren(...history.map(appointmentRow));
    const stations=(state?.stations||[]).map(station=>{
      const item=document.createElement('li');
      const claim=station.claim;
      const owner=claim?residentNames.get(claim.residentId)||claim.residentId:null;
      const queue=(station.waiters||[]).map((waiter,index)=>
        `#${index+1} ${residentNames.get(waiter.residentId)||waiter.residentId} (execution ${waiter.executionId})`);
      item.textContent=`${station.id}: ${claim?`claimed by ${owner} · execution ${claim.executionId} · expires m ${claim.expiresTick}`:'available'}${queue.length?` · waiting ${queue.join(' → ')}`:''}`;
      return item;
    });
    if(state)for(const resource of [{id:'chair',kind:'rest'},{id:'food',kind:'eat'}])
      if(!state.stations.some(station=>station.kind===resource.kind)){
        const item=document.createElement('li');
        item.textContent=`${resource.id}: missing · resource object removed; claims and waiters cleared`;
        stations.push(item);
      }
    byId('citizens-stations').replaceChildren(...stations);
    const latestSocial=state?.socialEvents?.at(-1);
    const initiator=residentNames.get(social?.initiatorId)||social?.initiatorId;
    const invitee=residentNames.get(social?.inviteeId)||social?.inviteeId;
    byId('citizens-social-status').textContent=social?
      `Session ${social.id}: ${initiator} ${social.phase==='offered'?'invited':'is conversing with'} ${invitee} · ${social.phase} · expires m ${social.expiresTick}`:
      latestSocial?`No active session · latest ${latestSocial.event} at m ${latestSocial.tick} · ${latestSocial.id}`:
        'No active social session yet.';
    const socialEvents=(state?.socialEvents||[]).slice(-6).reverse().map(entry=>{
      const item=document.createElement('li');
      const a=residentNames.get(entry.initiatorId)||entry.initiatorId;
      const b=residentNames.get(entry.inviteeId)||entry.inviteeId;
      item.textContent=`m ${entry.tick} · ${entry.event} · ${a} and ${b} · ${entry.id}${entry.requestId?` · receipt ${entry.requestId}`:''}`;
      return item;
    });
    byId('citizens-social-events').replaceChildren(...socialEvents);
    const relationships=(state?.relationships||[]).map(entry=>{
      const item=document.createElement('li');
      item.textContent=`${residentNames.get(entry.a)||entry.a} ↔ ${residentNames.get(entry.b)||entry.b}: ${entry.score}/100`;
      return item;
    });
    byId('citizens-relationships').replaceChildren(...relationships);
    const log=(state?.log||[]).slice(-6).reverse().map(entry=>{
      const item=document.createElement('li');
      item.textContent=`m ${entry.tick} · ${entry.message}`;
      return item;
    });
    byId('citizens-log').replaceChildren(...log);
  }
}
