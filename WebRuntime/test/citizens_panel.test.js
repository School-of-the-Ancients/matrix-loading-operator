import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {MatrixWorld} from '../src/protocol.js';
import {createCitizensDemo,citizensFurnitureReadiness} from '../src/citizens.js';
import {CitizensPanel} from '../src/citizens_panel.js';
import {MatrixView} from '../src/view.js';
import {CITIZENS_DELETION_RECOVERY_KEY,WORLD_KEY,restoreStoredWorld,
  saveStoredWorld,storedBrowserWorld,storedWorld} from '../src/scene_store.js';
import {applyPCWorld} from '../src/world_checkpoint.js';

function stubDocument(){
  const previousDocument=globalThis.document;
  const elements=new Map();
  const element=()=>({textContent:'',value:'29',disabled:false,
    children:[],addEventListener(){},replaceChildren(...children){this.children=children;}});
  globalThis.document={hidden:false,
    getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
    createElement:element};
  return {elements,restore(){
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }};
}

test('panel advances a bounded visible batch and persists clock speed',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0;
    const world=new MatrixWorld(()=>`clock-panel-${++sequence}`);
    panel=new CitizensPanel(world,{onChange(){},canStart:()=>'',onFeedback(){}});
    panel.start();
    const speed=dom.elements.get('citizens-speed');
    assert.equal(speed.value,'1');
    speed.value='4';panel.setSpeed();
    assert.equal(world.citizens.clockSpeed,4);
    panel.toggle();
    const before=world.citizens.clockTick;
    panel.tick();
    assert.equal(world.citizens.clockTick,before+4);
    globalThis.document.hidden=true;
    panel.tick();
    assert.equal(world.citizens.clockTick,before+4);
    globalThis.document.hidden=false;
    panel.toggle();
    panel.step();
    assert.equal(world.citizens.clockTick,before+5);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('paused routine editor preserves a typed draft and commits one resident schedule',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0,commits=0;
    const world=new MatrixWorld(()=>`routine-panel-${++sequence}`);
    panel=new CitizensPanel(world,{onChange(){commits++;return '';},
      canStart:()=>'',onFeedback(){}});
    panel.start();clearInterval(panel.timer);
    const before=structuredClone(world.citizens);
    const scene=structuredClone(world.scene);
    const resident=dom.elements.get('citizens-routine-resident');
    const routine=dom.elements.get('citizens-routine-id');
    assert.deepEqual(resident.children.map(option=>option.value),['ada','bo']);
    resident.value='bo';panel.selectRoutineResident();
    routine.value='evening-rest';panel.selectRoutine();
    const start=dom.elements.get('citizens-routine-start');
    const end=dom.elements.get('citizens-routine-end');
    const priority=dom.elements.get('citizens-routine-priority');
    assert.equal(start.value,'1260');assert.equal(end.value,'360');
    start.value='1210';end.value='1440';priority.value='low';
    panel.render();panel.tick();
    assert.equal(start.value,'1210');assert.equal(end.value,'1440');
    assert.equal(priority.value,'low');
    panel.applyRoutine();
    assert.equal(commits,2,'start and successful edit each save once');
    assert.deepEqual(world.scene,scene);
    assert.deepEqual(world.citizens.residents[0],before.residents[0]);
    assert.deepEqual(world.citizens.residents[1].routines.find(item=>
      item.id==='evening-rest'),
    {...before.residents[1].routines.find(item=>item.id==='evening-rest'),
      startMinute:1210,endMinute:1440,priority:'low'});
    assert.equal(world.citizens.paused,true);
    assert.match(dom.elements.get('citizens-routine-status').textContent,
      /next idle choice; current activity continues/);
    const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
    assert.match(html,/id="citizens-routine-end" type="number" min="0" max="1440"/);
    assert.match(html,/id="citizens-routine-status"[^>]*role="status"/);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('routine editor rejects empty, equal, and invalid priority without a save',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0,commits=0;
    const world=new MatrixWorld(()=>`routine-invalid-${++sequence}`);
    panel=new CitizensPanel(world,{onChange(){commits++;return '';},
      canStart:()=>'',onFeedback(){}});
    panel.start();clearInterval(panel.timer);
    const before=structuredClone(world.citizens);
    const start=dom.elements.get('citizens-routine-start');
    const end=dom.elements.get('citizens-routine-end');
    start.value='';end.value='100';panel.applyRoutine();
    assert.match(dom.elements.get('citizens-routine-status').textContent,
      /Start must be a whole minute/);
    start.value='100';panel.applyRoutine();
    assert.match(dom.elements.get('citizens-routine-status').textContent,
      /Start and end must differ/);
    end.value='200';dom.elements.get('citizens-routine-priority').value='urgent';
    panel.applyRoutine();
    assert.match(dom.elements.get('citizens-routine-status').textContent,
      /valid routine priority/);
    assert.deepEqual(world.citizens,before);
    assert.equal(commits,1,'invalid submissions do not save');
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('routine controls lock while running, in AR, or during a PC world exchange',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0,commits=0,busy=false;
    const world=new MatrixWorld(()=>`routine-lock-${++sequence}`);
    panel=new CitizensPanel(world,{onChange(){commits++;return '';},
      canStart:()=>'',canMutate:()=>busy?'PC world exchange is pending.':'',
      onFeedback(){}});
    panel.start();clearInterval(panel.timer);
    assert.equal(dom.elements.get('citizens-routine-apply').disabled,false);
    panel.toggle();
    assert.equal(dom.elements.get('citizens-routine-apply').disabled,true);
    const running=structuredClone(world.citizens),runningCommits=commits;
    panel.applyRoutine();
    assert.deepEqual(world.citizens,running);
    assert.equal(commits,runningCommits);
    panel.toggle();
    busy=true;panel.render();
    assert.equal(dom.elements.get('citizens-routine-apply').disabled,true);
    const paused=structuredClone(world.citizens),pausedCommits=commits;
    panel.applyRoutine();
    assert.deepEqual(world.citizens,paused);
    assert.equal(commits,pausedCommits);
    busy=false;world.spatial={};panel.render();
    assert.equal(dom.elements.get('citizens-routine-apply').disabled,true);
    panel.applyRoutine();
    assert.deepEqual(world.citizens,paused);
    assert.equal(commits,pausedCommits);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('paused appointment form keeps its draft and schedules one reviewed activity',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0,commits=0;
    const world=new MatrixWorld(()=>`appointment-panel-${++sequence}`);
    panel=new CitizensPanel(world,{onChange(){commits++;return '';},
      canStart:()=>'',onFeedback(){}});
    panel.start();clearInterval(panel.timer);
    const beforeScene=structuredClone(world.scene);
    const kind=dom.elements.get('citizens-appointment-kind');
    assert.deepEqual(kind.children.map(option=>option.value),['rest','eat']);
    kind.value='eat';panel.selectAppointmentKind();
    const start=dom.elements.get('citizens-appointment-start');
    const deadline=dom.elements.get('citizens-appointment-deadline');
    start.value='2';deadline.value='40';
    panel.render();panel.tick();
    assert.equal(start.value,'2');assert.equal(deadline.value,'40');
    assert.match(dom.elements.get('citizens-appointment-hint').textContent,
      /Current simulated minute 0.*The deadline minute counts/);
    panel.applyAppointment();
    assert.equal(commits,2,'start and appointment each save once');
    assert.deepEqual(world.scene,beforeScene);
    assert.deepEqual(world.citizens.residents[0].appointments,[{
      id:'appointment-1',kind:'eat',startTick:2,deadlineTick:40,
      status:'pending',executionId:null,resolvedTick:null,requestId:null,reason:''}]);
    assert.deepEqual(world.citizens.residents[1].appointments,[]);
    assert.match(dom.elements.get('citizens-appointments').children[0].textContent,
      /Ada: appointment-1 · eat m 2–40 \(deadline inclusive\) · pending/);
    assert.match(dom.elements.get('citizens-appointment-status').textContent,
      /Scheduled appointment-1 for Ada/);
    const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
    assert.match(html,/id="citizens-appointment-deadline"[^>]*aria-describedby="citizens-appointment-hint"/);
    assert.match(html,/id="citizens-appointment-status"[^>]*role="status"/);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('appointment form rejects invalid ticks and locks for running, AR, and PC exchange',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0,commits=0,busy=false;
    const world=new MatrixWorld(()=>`appointment-lock-${++sequence}`);
    panel=new CitizensPanel(world,{onChange(){commits++;return '';},
      canStart:()=>'',canMutate:()=>busy?'PC world exchange is pending.':'',
      onFeedback(){}});
    panel.start();clearInterval(panel.timer);
    const before=structuredClone(world.citizens);
    const start=dom.elements.get('citizens-appointment-start');
    const deadline=dom.elements.get('citizens-appointment-deadline');
    start.value='';deadline.value='20';panel.applyAppointment();
    assert.match(dom.elements.get('citizens-appointment-status').textContent,
      /Start must be a whole simulated minute/);
    start.value='2';deadline.value='2';panel.applyAppointment();
    assert.match(dom.elements.get('citizens-appointment-status').textContent,
      /Deadline must be a whole simulated minute/);
    assert.deepEqual(world.citizens,before);
    assert.equal(commits,1);
    panel.toggle();
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,true);
    const running=structuredClone(world.citizens),runningCommits=commits;
    panel.applyAppointment();
    assert.deepEqual(world.citizens,running);
    assert.equal(commits,runningCommits);
    panel.toggle();
    busy=true;panel.render();
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,true);
    const paused=structuredClone(world.citizens),pausedCommits=commits;
    panel.applyAppointment();
    assert.deepEqual(world.citizens,paused);
    assert.equal(commits,pausedCommits);
    busy=false;world.spatial={};panel.render();
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,true);
    panel.applyAppointment();
    assert.deepEqual(world.citizens,paused);
    assert.equal(commits,pausedCommits);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('appointment inspector separates queued, started, completed receipt, and missed deadline',()=>{
  const dom=stubDocument();
  let panel;
  try{
    const world=new MatrixWorld(()=> 'unused');
    panel=new CitizensPanel(world,{onChange(){},canStart:()=>'',onFeedback(){}});
    const appointment=(id,kind,status,executionId,resolvedTick,requestId,reason,
      startTick,deadlineTick)=>({id,kind,status,executionId,resolvedTick,requestId,
        reason,startTick,deadlineTick});
    const needs={hunger:50,energy:40,fun:60,social:32};
    const state={schemaVersion:12,paused:true,clockTick:15,seed:17,
      residents:[
        {id:'ada',name:'Ada',needs,activity:null,socialSessionId:null,
          routines:[],lastDecision:{tick:15,mode:'appointment',roll:null,
            selectedKind:'rest',selectedRoutineId:null,
            selectedAppointmentId:'appointment-1',candidates:[{
              kind:'rest',routineId:null,score:8,deficit:30,preference:1,
              travelMeters:2,baseWeight:10,availabilityFactor:1}]},
          lastOutcome:'',appointments:[
            appointment('appointment-1','rest','active',11,null,null,'',2,30),
            appointment('appointment-2','eat','completed',9,12,
              'citizens-17-action-9-14','',2,20),
            appointment('appointment-3','eat','missed',null,10,null,
              'deadline passed',2,9)]},
        {id:'bo',name:'Bo',needs,activity:{kind:'eat',phase:'travel',
          executionId:12},socialSessionId:null,routines:[],lastDecision:null,
          lastOutcome:'',appointments:[
            appointment('appointment-1','eat','active',12,null,null,'',3,35)]}],
      retiredResidentIds:[],stations:[
        {id:'chair',kind:'rest',claim:null,waiters:[
          {residentId:'ada',executionId:11,enqueuedTick:5}]},
        {id:'food',kind:'eat',claim:null,waiters:[]}],
      log:[],socialSession:null,socialEvents:[],relationships:[]};
    world.citizens=state;panel.simulation={snapshot:()=>state};panel.render();
    const openRows=dom.elements.get('citizens-appointments').children
      .map(item=>item.textContent);
    const historyRows=dom.elements.get('citizens-appointment-history').children
      .map(item=>item.textContent);
    const rows=[...openRows,...historyRows];
    assert.equal(openRows.length,2);
    assert.equal(historyRows.length,2);
    assert.ok(rows.some(row=>/Ada: appointment-1.*queued for chair · ticket #1 · execution 11/.test(row)));
    assert.ok(rows.some(row=>/Bo: appointment-1.*started · travel · execution 12/.test(row)));
    assert.ok(rows.some(row=>/completed · execution 9 at m 12 · receipt citizens-17-action-9-14/.test(row)));
    assert.ok(rows.some(row=>/missed at m 10 · deadline passed/.test(row)));
    assert.ok(rows.every(row=>!row.includes('undefined')&&!row.includes('null')));
    assert.match(dom.elements.get('citizens-routines').children[0].textContent,
      /appointment selected rest for appointment-1/);
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,false,
      'terminal history does not consume an open appointment slot');
    assert.match(dom.elements.get('citizens-appointment-capacity').textContent,
      /Ada: 1\/3 open appointments · 2 recent outcomes/);
    const residentSelect=dom.elements.get('citizens-appointment-resident');
    assert.equal(residentSelect.disabled,false,'the user can still choose Bo');
    residentSelect.value='bo';panel.selectAppointmentResident();
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,false);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('paused appointment editor revises a pending ID and previews inclusive resident and shared-station overlaps',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0,commits=0;
    const world=new MatrixWorld(()=>`appointment-revision-panel-${++sequence}`);
    panel=new CitizensPanel(world,{onChange(){commits++;return '';},
      canStart:()=>'',onFeedback(){}});
    panel.start();clearInterval(panel.timer);
    const scene=structuredClone(world.scene);
    const resident=dom.elements.get('citizens-appointment-resident');
    const target=dom.elements.get('citizens-appointment-target');
    const kind=dom.elements.get('citizens-appointment-kind');
    const start=dom.elements.get('citizens-appointment-start');
    const deadline=dom.elements.get('citizens-appointment-deadline');
    const book=(activity,first,last)=>{
      kind.value=activity;panel.selectAppointmentKind();
      start.value=String(first);deadline.value=String(last);
      panel.applyAppointment();
    };
    book('rest',2,10);
    book('eat',10,20);
    resident.value='bo';panel.selectAppointmentResident();
    book('rest',5,12);
    resident.value='ada';panel.selectAppointmentResident();
    target.value='appointment-1';panel.selectAppointmentTarget();
    assert.equal(target.value,'appointment-1');
    assert.equal(kind.value,'rest');
    assert.equal(start.value,'2');assert.equal(deadline.value,'10');
    assert.match(dom.elements.get('citizens-appointment-conflicts').textContent,
      /Overlaps Ada's appointment-2 \(eat m 10–20\)/,
      'a deadline and another start at the same minute overlap inclusively');
    assert.equal(dom.elements.get('citizens-appointment-apply').textContent,
      'Apply appointment');
    assert.equal(dom.elements.get('citizens-appointment-cancel').disabled,false);
    start.value='9';deadline.value='15';
    panel.render();panel.tick();
    assert.equal(start.value,'9');assert.equal(deadline.value,'15');
    const conflicts=dom.elements.get('citizens-appointment-conflicts').textContent;
    assert.match(conflicts,/Overlaps Ada's appointment-2 \(eat m 10–20\)/);
    assert.match(conflicts,/Shared rest station may queue with Bo's appointment-1 \(m 5–12\)/);
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,false,
      'overlaps warn but do not reject');
    panel.applyAppointment();
    assert.equal(commits,5,'start, three bookings, and revision save once each');
    assert.deepEqual(world.scene,scene);
    const ada=world.citizens.residents.find(item=>item.id==='ada');
    assert.deepEqual(ada.appointments.map(item=>item.id),
      ['appointment-1','appointment-2']);
    assert.deepEqual({kind:ada.appointments[0].kind,
      startTick:ada.appointments[0].startTick,
      deadlineTick:ada.appointments[0].deadlineTick},
    {kind:'rest',startTick:9,deadlineTick:15});
    assert.match(dom.elements.get('citizens-appointment-status').textContent,
      /Revised appointment-1 for Ada/);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('three open appointments block New while pending edit and cancellation remain available',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0,commits=0,busy=false;
    const world=new MatrixWorld(()=>`appointment-capacity-panel-${++sequence}`);
    panel=new CitizensPanel(world,{onChange(){commits++;return '';},
      canStart:()=>'',canMutate:()=>busy?'PC world exchange is pending.':'',
      onFeedback(){}});
    panel.start();clearInterval(panel.timer);
    const target=dom.elements.get('citizens-appointment-target');
    const start=dom.elements.get('citizens-appointment-start');
    const deadline=dom.elements.get('citizens-appointment-deadline');
    for(const [first,last] of [[2,10],[20,30],[40,50]]){
      start.value=String(first);deadline.value=String(last);
      panel.applyAppointment();
    }
    assert.match(dom.elements.get('citizens-appointment-capacity').textContent,
      /Ada: 3\/3 open appointments · 0 recent outcomes/);
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,true);
    assert.equal(target.disabled,false,'a full resident can still choose an open entry');
    target.value='appointment-2';panel.selectAppointmentTarget();
    assert.equal(start.value,'20');assert.equal(deadline.value,'30');
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,false);
    assert.equal(dom.elements.get('citizens-appointment-cancel').disabled,false);
    const before=structuredClone(world.citizens),beforeCommits=commits;
    busy=true;panel.render();
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,true);
    assert.equal(dom.elements.get('citizens-appointment-cancel').disabled,true);
    panel.cancelAppointment();
    assert.deepEqual(world.citizens,before);
    assert.equal(commits,beforeCommits);
    busy=false;panel.render();
    panel.toggle();
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,true);
    assert.equal(dom.elements.get('citizens-appointment-cancel').disabled,true);
    panel.toggle();
    world.spatial={};panel.render();
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,true);
    assert.equal(dom.elements.get('citizens-appointment-cancel').disabled,true);
    world.spatial=null;panel.render();
    panel.cancelAppointment();
    const ada=world.citizens.residents.find(item=>item.id==='ada');
    assert.equal(ada.appointments.find(item=>item.id==='appointment-2').status,
      'cancelled');
    assert.match(dom.elements.get('citizens-appointment-history').children[0].textContent,
      /appointment-2.*cancelled.*cancelled by operator/);
    assert.match(dom.elements.get('citizens-appointment-capacity').textContent,
      /Ada: 2\/3 open appointments · 1 recent outcome retained/);
    assert.equal(target.value,'appointment-2','terminal selection stays visible');
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,true);
    assert.equal(dom.elements.get('citizens-appointment-cancel').disabled,true);
    const afterCancel=structuredClone(world.citizens),cancelCommits=commits;
    panel.applyAppointment();panel.cancelAppointment();
    assert.deepEqual(world.citizens,afterCancel);
    assert.equal(commits,cancelCommits);
    target.value='';panel.selectAppointmentTarget();
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,false);
    start.value='60';deadline.value='80';panel.applyAppointment();
    assert.equal(world.citizens.residents[0].appointmentSequence,4);
    assert.deepEqual(world.citizens.residents[0].appointments.map(item=>item.id),
      ['appointment-1','appointment-2','appointment-3','appointment-4']);
    assert.equal(world.citizens.residents[0].appointments.filter(item=>
      item.status==='pending').length,3);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('a selected appointment with changed saved fields stays visible and blocks stale edits',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0,commits=0;
    const world=new MatrixWorld(()=>`appointment-stale-panel-${++sequence}`);
    panel=new CitizensPanel(world,{onChange(){commits++;return '';},
      canStart:()=>'',onFeedback(){}});
    panel.start();clearInterval(panel.timer);
    const target=dom.elements.get('citizens-appointment-target');
    const start=dom.elements.get('citizens-appointment-start');
    const deadline=dom.elements.get('citizens-appointment-deadline');
    start.value='2';deadline.value='10';panel.applyAppointment();
    target.value='appointment-1';panel.selectAppointmentTarget();
    const expected={kind:'rest',startTick:2,deadlineTick:10};
    panel.simulation.reviseAppointment('ada','appointment-1',expected,
      {kind:'rest',startTick:4,deadlineTick:14});
    panel.commit();
    assert.equal(target.value,'appointment-1');
    assert.equal(start.value,'2');assert.equal(deadline.value,'10',
      'a stale draft is not silently overwritten');
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,true);
    assert.equal(dom.elements.get('citizens-appointment-cancel').disabled,true);
    assert.match(dom.elements.get('citizens-appointment-status').textContent,
      /changed since it was selected/);
    const before=structuredClone(world.citizens),beforeCommits=commits;
    panel.applyAppointment();panel.cancelAppointment();
    assert.deepEqual(world.citizens,before);
    assert.equal(commits,beforeCommits);
    target.value='';panel.selectAppointmentTarget();
    target.value='appointment-1';panel.selectAppointmentTarget();
    assert.equal(start.value,'4');assert.equal(deadline.value,'14');
    assert.equal(dom.elements.get('citizens-appointment-apply').disabled,false);
    assert.equal(dom.elements.get('citizens-appointment-cancel').disabled,false);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('panel enables selected authored furniture and preserves other world objects',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0;
    const world=new MatrixWorld(()=>`selected-panel-${++sequence}`);
    const transform=(x,z)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
      scale:{x:1,y:1,z:1}});
    const chair=world.execute({requestId:'chair-for-panel',op:'spawn',assetId:'chair',
      anchorId:'web-floor',transform:transform(0,-2)});
    const block=world.execute({requestId:'block-for-panel',op:'spawn',assetId:'block',
      anchorId:'web-floor',transform:transform(4,-2)});
    assert.equal(chair.ok,true);
    assert.equal(block.ok,true);
    const feedback=[];
    panel=new CitizensPanel(world,{onChange(){},
      canStart:mode=>mode==='selected'?
        citizensFurnitureReadiness(world,world.selection.objectId):
        'The fixture needs an empty world.',
      onFeedback(message){feedback.push(message);}});
    assert.equal(dom.elements.get('citizens-bind-selected').disabled,true);
    world.setSelection(chair.objectId,{x:0,y:0,z:-2});
    panel.render();
    assert.equal(dom.elements.get('citizens-bind-selected').disabled,false);
    assert.match(dom.elements.get('citizens-selection-status').textContent,/ready/i);
    panel.start('selected');
    assert.equal(world.scene.objects.length,4);
    assert.ok(world.scene.objects.some(object=>object.objectId===block.objectId));
    assert.deepEqual(world.citizens.stations.map(station=>station.objectId),
      [chair.objectId]);
    assert.equal(world.citizens.residents.length,2);
    assert.equal(dom.elements.get('citizens-bind-selected').disabled,true);
    assert.match(feedback.at(-1),/existing Matrix world/);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('panel adds a selected complementary station to paused Citizens without replacing residents',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0;
    const world=new MatrixWorld(()=>`second-panel-${++sequence}`);
    const transform=(x,z)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
      scale:{x:1,y:1,z:1}});
    const chair=world.execute({requestId:'first-panel-chair',op:'spawn',assetId:'chair',
      anchorId:'web-floor',transform:transform(0,-2)});
    const food=world.execute({requestId:'second-panel-food',op:'spawn',assetId:'table',
      anchorId:'web-floor',transform:transform(3,0)});
    assert.equal(chair.ok,true);assert.equal(food.ok,true);
    const feedback=[];
    panel=new CitizensPanel(world,{onChange(){},
      canStart:mode=>mode==='selected'?
        citizensFurnitureReadiness(world,world.selection.objectId):
        mode==='addition'?'':'The fixture needs an empty world.',
      onFeedback(message){feedback.push(message);}});
    world.setSelection(chair.objectId,{x:0,y:0,z:-2});
    panel.render();panel.start('selected');
    const residentIds=world.citizens.residents.map(resident=>resident.objectId);
    world.setSelection(food.objectId,{x:3,y:0,z:0});
    panel.render();
    assert.equal(dom.elements.get('citizens-add-selected').disabled,false);
    panel.addStation();
    assert.equal(world.citizens.stations.length,2);
    assert.deepEqual(world.citizens.stations.map(station=>station.objectId),
      [chair.objectId,food.objectId]);
    assert.deepEqual(world.citizens.residents.map(resident=>resident.objectId),residentIds);
    assert.equal(dom.elements.get('citizens-add-selected').disabled,true);
    assert.match(feedback.at(-1),/existing Citizens world/);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

async function selectedChairGlbLoad(shouldFail){
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0;
    const world=new MatrixWorld(()=>`pending-glb-${++sequence}`);
    const hash='a'.repeat(64);
    const asset={assetId:'web:pending-panel-obstacle',displayName:'Panel obstacle',
      description:'Static GLB near the selected chair',spawnScale:1,sha256:hash,
      byteLength:1024,url:`/api/web/assets/${hash}.glb`,
      localBounds:{center:{x:0,y:.5,z:0},size:{x:1,y:1,z:1}}};
    world.registerAssets([asset]);
    const pose=(x,z)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},
      scale:{x:1,y:1,z:1}});
    const chair=world.execute({requestId:'pending-chair',op:'spawn',assetId:'chair',
      anchorId:'web-floor',transform:pose(0,0)});
    const obstacle=world.execute({requestId:'pending-obstacle',op:'spawn',
      assetId:asset.assetId,anchorId:'web-floor',transform:pose(-.9,0)});
    assert.equal(chair.ok,true);assert.equal(obstacle.ok,true);
    world.setSelection(chair.objectId,{x:0,y:0,z:0});
    panel=new CitizensPanel(world,{onChange(){},
      canStart:mode=>mode==='selected'?
        citizensFurnitureReadiness(world,world.selection.objectId):'fixture disabled',
      onFeedback(){}});
    const button=dom.elements.get('citizens-bind-selected');
    assert.equal(button.disabled,true);
    assert.match(dom.elements.get('citizens-selection-status').textContent,
      /verified rendered GLB/);

    let release,refuse;
    const loading=new Promise((resolve,reject)=>{release=resolve;refuse=reject;});
    const root=new THREE.Group(),visual=new THREE.Group();root.add(visual);
    root.userData.assetLoading=true;
    const view=Object.create(MatrixView.prototype);
    view.world=world;
    view.modelCache=new Map([[asset.assetId,loading]]);
    view.objectRoots=new Map([[obstacle.objectId,root]]);
    let refreshes=0;
    view.onAssetReadinessChange=()=>{refreshes++;panel.render();};
    view.onRuntimeChange=()=>assert.fail('GLB readiness must not rebuild the scene');
    const errors=[];view.onAssetError=message=>errors.push(message);
    const completion=view.loadExternal(asset,root,visual,obstacle.objectId);
    assert.equal(button.disabled,true,'the pending GLB still blocks Citizens start');
    if(shouldFail)refuse(Error('fixture load failed'));
    else release({scene:new THREE.Group(),animations:[],measuredSize:{x:1,y:1,z:1}});
    await completion;
    assert.equal(refreshes,1,'the current GLB completion refreshes the panel once');
    assert.equal(button.disabled,shouldFail);
    assert.match(dom.elements.get('citizens-selection-status').textContent,
      shouldFail?/verified rendered GLB/:/Selected station is ready/);
    assert.equal(errors.length,shouldFail?1:0);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
}

test('selected chair becomes available as soon as its nearby GLB verifies',async()=>{
  await selectedChairGlbLoad(false);
});

test('failed nearby GLB load refreshes the panel but keeps the chair unavailable',async()=>{
  await selectedChairGlbLoad(true);
});

test('panel renders execution claims, FIFO waiters, and retired and missing bindings',()=>{
  const dom=stubDocument();
  let panel;
  try{
    const world=new MatrixWorld(()=> 'unused');
    panel=new CitizensPanel(world,{onChange(){},canStart:()=>'',onFeedback(){}});
    const resident=(id,name,executionId)=>({id,name,
      needs:{hunger:50,energy:40,fun:60},lastOutcome:'',
      activity:{kind:'rest',stationId:'chair',phase:'travel',remainingTicks:7,
        travelTicks:1,target:null,executionId}});
    const ada=resident('ada','Ada',21);
    const bo=resident('bo','Bo',22);
    bo.activity=null;
    const state={schemaVersion:2,paused:false,clockTick:4,seed:17,
      residents:[ada,bo],
      retiredResidentIds:['cy'],stations:[{id:'chair',kind:'rest',
        claim:{residentId:'ada',executionId:21,expiresTick:73},
        waiters:[{residentId:'bo',executionId:22,enqueuedTick:4}]}],log:[]};
    world.citizens=state;
    panel.simulation={snapshot:()=>state};
    panel.render();

    const residents=dom.elements.get('citizens-residents').children.map(item=>item.textContent);
    const stations=dom.elements.get('citizens-stations').children.map(item=>item.textContent);
    assert.match(residents[0],/Ada: going to rest · execution 21/);
    assert.match(residents[1],/Bo: waiting for chair · queue #1 · execution 22/);
    assert.match(residents[2],/cy: retired · actor object removed/);
    assert.match(stations[0],/chair: claimed by Ada · execution 21 · expires m 73/);
    assert.match(stations[0],/waiting #1 Bo \(execution 22\)/);
    assert.match(stations[1],/food: missing · resource object removed/);
    assert.match(dom.elements.get('citizens-status').textContent,/^Running/);

    state.residents=[];
    state.retiredResidentIds=['ada','bo','cy'];
    state.stations=[];
    state.paused=true;
    panel.render();
    assert.equal(dom.elements.get('citizens-toggle').disabled,true);
    assert.equal(dom.elements.get('citizens-step').disabled,true);
    assert.match(dom.elements.get('citizens-status').textContent,/^Paused/);
    assert.equal(dom.elements.get('citizens-residents').children.length,3);
    assert.equal(dom.elements.get('citizens-stations').children.length,2);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('panel shows offered, active, and completed social sessions with relationship score',()=>{
  const dom=stubDocument();
  let panel;
  try{
    const world=new MatrixWorld(()=> 'unused');
    panel=new CitizensPanel(world,{onChange(){},canStart:()=>'',onFeedback(){}});
    const state={schemaVersion:3,paused:true,clockTick:12,seed:17,
      residents:[{id:'ada',name:'Ada',socialSessionId:'social-17-3',activity:null,
        needs:{hunger:50,energy:40,fun:60},lastOutcome:''},
      {id:'bo',name:'Bo',socialSessionId:'social-17-3',activity:null,
        needs:{hunger:50,energy:40,fun:60},lastOutcome:''}],
      retiredResidentIds:[],stations:[],log:[],
      socialSession:{id:'social-17-3',initiatorId:'ada',inviteeId:'bo',
        phase:'offered',expiresTick:16},
      socialEvents:[{id:'social-17-3',event:'initiated',tick:12,
        initiatorId:'ada',inviteeId:'bo'}],
      relationships:[{a:'ada',b:'bo',score:1}]};
    world.citizens=state;
    panel.simulation={snapshot:()=>state};
    panel.render();
    assert.match(dom.elements.get('citizens-social-status').textContent,/Ada invited Bo · offered/);
    assert.match(dom.elements.get('citizens-residents').children[0].textContent,/Ada: inviting Bo · session social-17-3/);
    assert.match(dom.elements.get('citizens-residents').children[1].textContent,/Bo: invited by Ada · session social-17-3/);
    assert.match(dom.elements.get('citizens-social-events').children[0].textContent,/initiated · Ada and Bo/);
    assert.match(dom.elements.get('citizens-relationships').children[0].textContent,/Ada ↔ Bo: 1\/100/);

    state.socialSession.phase='active';
    state.socialSession.routeRetries=2;
    panel.render();
    assert.match(dom.elements.get('citizens-social-status').textContent,/Ada is conversing with Bo · active/);
    assert.match(dom.elements.get('citizens-social-status').textContent,
      /route retries 2\/3/);
    assert.match(dom.elements.get('citizens-residents').children[0].textContent,/conversing with Bo/);

    state.socialSession=null;
    state.residents.forEach(resident=>{resident.socialSessionId=null;});
    state.socialEvents.push({id:'social-17-3-ended-14',event:'ended',tick:14,
      initiatorId:'ada',inviteeId:'bo',requestId:'citizens-17-social-3-9'});
    state.relationships[0].score=2;
    panel.render();
    assert.match(dom.elements.get('citizens-social-status').textContent,/latest ended at m 14/);
    assert.match(dom.elements.get('citizens-relationships').children[0].textContent,/Ada ↔ Bo: 2\/100/);
    assert.match(dom.elements.get('citizens-social-events').children[0].textContent,/receipt citizens-17-social-3-9/);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('panel explains a social choice and shows both residents social needs',()=>{
  const dom=stubDocument();
  let panel;
  try{
    const world=new MatrixWorld(()=> 'unused');
    panel=new CitizensPanel(world,{onChange(){},canStart:()=>'',onFeedback(){}});
    const state={schemaVersion:9,paused:true,clockTick:12,seed:17,
      residents:[{id:'ada',name:'Ada',socialSessionId:'social-17-3',activity:null,
        needs:{hunger:50,energy:40,fun:60,social:32},lastOutcome:'',routines:[],
        lastDecision:{tick:12,mode:'social',roll:null,selectedKind:'converse',
          selectedRoutineId:null,candidates:[{kind:'converse',routineId:null,
            priority:'none',deficit:68,preference:1.2,travelMeters:1.5,
            baseWeight:0,availabilityFactor:1,score:72.6}]}},
      {id:'bo',name:'Bo',socialSessionId:'social-17-3',activity:null,
        needs:{hunger:50,energy:40,fun:60,social:75},lastOutcome:'',routines:[],
        lastDecision:null}],retiredResidentIds:[],stations:[],log:[],
      socialSession:{id:'social-17-3',initiatorId:'ada',inviteeId:'bo',
        phase:'offered',expiresTick:16},socialEvents:[],relationships:[]};
    world.citizens=state;
    panel.simulation={snapshot:()=>state};
    panel.render();

    const residents=dom.elements.get('citizens-residents').children.map(item=>item.textContent);
    assert.match(residents[0],/Ada: inviting Bo · session social-17-3/);
    assert.match(residents[0],/fun 60 · social 32/);
    assert.match(residents[1],/Bo: invited by Ada · session social-17-3/);
    assert.match(residents[1],/fun 60 · social 75/);
    const decision=dom.elements.get('citizens-routines').children[0].textContent;
    assert.match(decision,/active routines none · m 12 · social need selected conversation/);
    assert.match(decision,/conversation 72\.6 \(need 68, preference 1\.20/);
    assert.doesNotMatch(decision,/NaN|undefined/);
    const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
    assert.match(html,/<h3>Activity choices and routines<\/h3>/);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('compatible deletions keep survivors running; incompatible binding shows recovery',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0;
    const world=new MatrixWorld(()=>`citizens-${++sequence}`);
    const simulation=createCitizensDemo(world,{seed:17});
    simulation.resume();
    world.citizens=simulation.advance();
    const feedback=[];
    panel=new CitizensPanel(world,{onChange(){},canStart:()=>'',
      onFeedback(message){feedback.push(message);}});

    const actorId=world.citizens.residents.find(resident=>resident.id==='ada').objectId;
    assert.equal(world.execute({requestId:'delete-ada',op:'delete',objectId:actorId}).ok,true);
    panel.syncFromWorld();
    let state=panel.simulation.snapshot();
    assert.deepEqual(state.residents.map(resident=>resident.id),['bo']);
    assert.deepEqual(state.retiredResidentIds,['ada']);
    assert.equal(state.paused,false);
    assert.equal(panel.error,'');
    assert.match(feedback.at(-1),/surviving residents continue/);
    assert.match(dom.elements.get('citizens-status').textContent,/^Running/);
    assert.ok(dom.elements.get('citizens-residents').children.some(item=>
      item.textContent.includes('ada: retired')));
    const afterActor=state.clockTick;
    panel.tick();
    assert.equal(panel.simulation.snapshot().clockTick,afterActor+1);

    const chairId=state.stations.find(station=>station.id==='chair').objectId;
    assert.equal(world.execute({requestId:'delete-chair',op:'delete',objectId:chairId}).ok,true);
    panel.syncFromWorld();
    state=panel.simulation.snapshot();
    assert.equal(state.stations.some(station=>station.id==='chair'),false);
    assert.equal(state.paused,false);
    assert.equal(panel.error,'');
    assert.match(feedback.at(-1),/surviving residents continue/);
    assert.ok(dom.elements.get('citizens-stations').children.some(item=>
      item.textContent.includes('chair: missing')));
    const afterStation=state.clockTick;
    panel.tick();
    assert.equal(panel.simulation.snapshot().clockTick,afterStation+1);

    const foodId=state.stations.find(station=>station.id==='food').objectId;
    const scene=structuredClone(world.scene);
    scene.objects.find(object=>object.objectId===foodId).assetId='orb';
    assert.equal(world.execute({requestId:'replace-food-asset',op:'load',scene}).ok,true);
    panel.syncFromWorld();
    assert.equal(panel.simulation.snapshot().paused,true);
    assert.match(panel.error,/Undo the edit, restore a valid PC world, or stop Citizens/);
    assert.match(feedback.at(-1),/needs binding recovery/);
    assert.match(dom.elements.get('citizens-status').textContent,/missing or incompatible/);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('pre-deletion restore requires matching confirmation and validates before replacing the world',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0;
    const world=new MatrixWorld(()=>`citizens-${++sequence}`);
    const simulation=createCitizensDemo(world,{seed:17});
    world.citizens=simulation.step();
    const saved=storedBrowserWorld(world);
    const chairId=saved.citizens.stations.find(station=>station.id==='chair').objectId;
    const browserStorage=new Map([['manual','manual-world-checkpoint']]);
    const feedback=[];
    let saveWarning='';
    let durableConfirmed=true;
    panel=new CitizensPanel(world,{onChange(){panel.syncFromWorld();return saveWarning;},
      canStart:()=>'',getRecovery(){
        const recovery=browserStorage.get('recovery')||null;
        if(recovery instanceof Error)throw recovery;
        return recovery;
      },
      canRecover:()=>world.spatial?'Return to the desktop virtual room.':'',
      onRecover:copy=>restoreStoredWorld(world,copy),
      confirmDurableRecovery:()=>durableConfirmed,
      clearRecovery:()=>browserStorage.delete('recovery'),
      onFeedback(message){feedback.push(message);}});
    assert.equal(dom.elements.get('citizens-recover').disabled,true);

    assert.equal(world.execute({requestId:'delete-chair-for-recovery',op:'delete',
      objectId:chairId}).ok,true);
    panel.syncFromWorld();
    assert.equal(world.scene.objects.some(object=>object.objectId===chairId),false);
    browserStorage.set('recovery',saved);
    panel.render();
    assert.equal(dom.elements.get('citizens-recover').disabled,false);
    panel.recover();
    assert.equal(world.scene.objects.some(object=>object.objectId===chairId),false);
    assert.match(dom.elements.get('citizens-recover').textContent,/Confirm restore minute 1/);

    const invalid=structuredClone(saved);
    invalid.citizens.stations.find(station=>station.id==='chair').objectId='missing';
    browserStorage.set('recovery',invalid);
    panel.recover();
    assert.match(feedback.at(-1),/Click Confirm restore/,
      'a changed recovery copy must require a fresh confirmation');
    panel.recover();
    assert.equal(world.scene.objects.some(object=>object.objectId===chairId),false);
    assert.match(feedback.at(-1),/could not be restored/);

    browserStorage.set('recovery',new Error('copy is corrupt'));
    panel.render();
    assert.equal(dom.elements.get('citizens-recover').disabled,true);
    assert.match(dom.elements.get('citizens-recovery-status').textContent,/unreadable/);
    browserStorage.set('recovery',saved);
    panel.recover();
    assert.equal(world.scene.objects.some(object=>object.objectId===chairId),false);
    panel.recover();
    assert.equal(world.scene.objects.some(object=>object.objectId===chairId),true);
    assert.equal(world.citizens.stations.some(station=>station.id==='chair'),true);
    assert.equal(browserStorage.has('recovery'),false);
    assert.equal(browserStorage.get('manual'),'manual-world-checkpoint');
    assert.match(feedback.at(-1),/manual Save world checkpoint is unchanged/);

    browserStorage.set('recovery',storedBrowserWorld(world));
    assert.equal(world.execute({requestId:'delete-chair-again',op:'delete',
      objectId:chairId}).ok,true);
    panel.syncFromWorld();
    saveWarning='Persistent browser save failed: quota';
    panel.recover();
    panel.recover();
    assert.equal(world.scene.objects.some(object=>object.objectId===chairId),true);
    assert.equal(browserStorage.has('recovery'),true,
      'failed durable save must retain the recovery copy');
    assert.match(feedback.at(-1),/recovery copy was kept/);

    assert.equal(world.execute({requestId:'delete-chair-third-time',op:'delete',
      objectId:chairId}).ok,true);
    panel.syncFromWorld();
    saveWarning='';durableConfirmed=false;
    panel.recover();
    panel.recover();
    assert.equal(browserStorage.has('recovery'),true,
      'an unverified durable write must retain the recovery copy');
    assert.match(feedback.at(-1),/durable browser copy could not be verified/);

    world.spatial={originUnavailable:true};
    panel.render();
    assert.equal(dom.elements.get('citizens-recover').disabled,true);
    panel.recover();
    assert.match(feedback.at(-1),/Return to the desktop virtual room/);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('AR entry cancels active claims before an AR object move and does not auto-resume',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0;
    const world=new MatrixWorld(()=>`citizens-${++sequence}`);
    const simulation=createCitizensDemo(world,{seed:17});
    const active=simulation.step();
    const chair=active.stations.find(station=>station.kind==='rest');
    assert.equal(chair.claim?.residentId,'ada');
    assert.deepEqual(chair.waiters.map(waiter=>waiter.residentId),['bo']);
    world.citizens=active;
    panel=new CitizensPanel(world,{onChange(){},canStart:()=>'',onFeedback(){}});

    world.enterAR({visitDigitalWorld:false});
    panel.syncFromWorld();
    const paused=world.citizens;
    assert.equal(paused.paused,true);
    assert.equal(paused.stations.find(station=>station.kind==='rest').claim,null);
    assert.deepEqual(paused.stations.find(station=>station.kind==='rest').waiters,[]);
    assert.ok(paused.residents.every(resident=>resident.activity===null));
    assert.match(paused.residents.find(resident=>resident.id==='bo').lastOutcome,
      /entering AR cancelled the current activity or queued wait/);
    assert.ok(paused.log.some(entry=>entry.event==='failed'&&
      entry.message.includes('entering AR cancelled')));

    const transform=structuredClone(world.requireObject(chair.objectId).transform);
    transform.position.x+=1;
    assert.equal(world.execute({requestId:'ar-move-chair',op:'set_transform',
      objectId:chair.objectId,transform}).ok,true);
    world.leaveAR();
    panel.syncFromWorld();
    const returned=panel.simulation.snapshot();
    assert.equal(world.requireObject(chair.objectId).transform.position.x,1);
    assert.equal(returned.paused,true);
    assert.equal(returned.clockTick,active.clockTick);
    assert.equal(returned.stations.find(station=>station.kind==='rest').claim,null);
    assert.deepEqual(returned.stations.find(station=>station.kind==='rest').waiters,[]);
    assert.ok(returned.residents.every(resident=>resident.activity===null));
    panel.tick();
    assert.equal(panel.simulation.snapshot().clockTick,active.clockTick);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('AR visit keeps one digital Citizens world running through tracking loss and exit',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0,commits=0;
    const world=new MatrixWorld(()=>`citizens-visit-${++sequence}`);
    const simulation=createCitizensDemo(world,{seed:17});
    simulation.resume();
    world.citizens=simulation.step();
    const scene=world.scene,entry=structuredClone(world.citizens);
    const objectIds=scene.objects.map(object=>object.objectId);
    panel=new CitizensPanel(world,{onChange(){commits++;return '';},
      canStart:()=>'',onFeedback(){}});
    world.enterAR();panel.syncFromWorld();
    assert.equal(world.digitalWorldVisit,true);
    assert.equal(world.scene,scene);
    assert.deepEqual(world.citizens,entry);
    assert.equal(world.snapshot().digitalWorldVisit,true);
    assert.ok(world.snapshot().citizensObservation);
    assert.match(dom.elements.get('citizens-status').textContent,/Visiting digital world · Running/);
    panel.tick();
    assert.equal(world.citizens.clockTick,entry.clockTick+1);
    assert.equal(commits,1);
    assert.equal(world.scene,scene);
    assert.deepEqual(world.scene.objects.map(object=>object.objectId),objectIds);
    assert.ok(world.citizens.stations.some(station=>station.claim));
    assert.ok(!world.citizens.log.some(item=>item.message.includes('entering AR cancelled')));
    world.setOriginUnavailable(true);
    assert.equal(world.snapshot().readOnly,true);
    const beforeMissing=world.citizens.clockTick;
    globalThis.document.hidden=true;
    panel.tick();
    assert.equal(world.citizens.clockTick,beforeMissing+1,
      'a hidden immersive page and lost physical view origin do not stop the digital simulation');
    assert.equal(storedBrowserWorld(world).scene.roomId,entry.world.roomId);
    world.leaveAR();panel.syncFromWorld();
    assert.equal(world.digitalWorldVisit,false);
    assert.equal(world.scene,scene);
    assert.equal(world.citizens.clockTick,beforeMissing+1);
    assert.equal(world.originBinding,'virtual');
    panel.tick();
    assert.equal(world.citizens.clockTick,beforeMissing+1,
      'an ordinary hidden page still pauses its browser-local timer');
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('an accepted Citizens conversation completes once during an AR visit',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0;
    const world=new MatrixWorld(()=>`visit-social-${++sequence}`);
    const simulation=createCitizensDemo(world,{seed:2});
    let active=null;
    for(let minute=0;minute<300;minute++){
      active=simulation.step();
      if(active.socialSession?.phase==='active'&&active.socialSession.travelTicks>0)break;
    }
    assert.equal(active.socialSession?.phase,'active');
    const sessionId=active.socialSession.id,scene=world.scene;
    simulation.resume();world.citizens=simulation.snapshot();
    panel=new CitizensPanel(world,{onChange(){return '';},canStart:()=>'',onFeedback(){}});
    world.enterAR();panel.syncFromWorld();
    world.setOriginUnavailable(true);
    for(let minute=0;minute<24&&!world.citizens.socialEvents.some(event=>
      event.event==='ended'&&event.id.startsWith(sessionId));minute++)panel.tick();
    const ended=world.citizens.socialEvents.filter(event=>
      event.event==='ended'&&event.id.startsWith(sessionId));
    assert.equal(ended.length,1);
    assert.match(ended[0].requestId,/^citizens-2-social-/);
    assert.equal(world.scene,scene);
    assert.ok(!world.citizens.log.some(item=>item.message.includes('entering AR cancelled')));
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('deleting a bound resident in AR retires it before save and preserves full recovery',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0;
    const world=new MatrixWorld(()=>`citizens-${++sequence}`);
    const simulation=createCitizensDemo(world,{seed:17});
    world.citizens=simulation.step();
    const values=new Map();
    const storage={getItem:key=>values.get(key)??null,
      setItem(key,value){values.set(key,value);}};
    assert.equal(saveStoredWorld(storedBrowserWorld(world),storage,storage),'');
    const before=JSON.parse(storage.getItem(WORLD_KEY));
    panel=new CitizensPanel(world,{onChange(){},canStart:()=>'',onFeedback(){}});
    world.enterAR({visitDigitalWorld:false});panel.syncFromWorld();
    const ada=world.citizens.residents.find(resident=>resident.id==='ada');
    assert.equal(world.execute({requestId:'delete-ada-in-ar',op:'delete',
      objectId:ada.objectId}).ok,true);
    panel.syncFromWorld();
    assert.deepEqual(world.citizens.retiredResidentIds,['ada']);
    assert.deepEqual(world.citizens.residents.map(resident=>resident.id),['bo']);
    assert.equal(saveStoredWorld(storedBrowserWorld(world),storage,storage),'');
    const recovery=JSON.parse(storage.getItem(CITIZENS_DELETION_RECOVERY_KEY));
    assert.deepEqual(recovery.scene,before.scene);
    assert.deepEqual(recovery.citizens,before.citizens);
    world.leaveAR();panel.syncFromWorld();
    assert.deepEqual(panel.simulation.snapshot().residents.map(resident=>resident.id),['bo']);
    assert.equal(panel.simulation.snapshot().paused,true);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('an explicit world restore in AR replaces the paused Citizens adapter',()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0;
    const world=new MatrixWorld(()=>`citizens-${++sequence}`);
    const simulation=createCitizensDemo(world,{seed:17});
    world.citizens=simulation.step();
    const before=storedBrowserWorld(world);
    panel=new CitizensPanel(world,{onChange(){},canStart:()=>'',onFeedback(){}});
    world.enterAR({visitDigitalWorld:false});panel.syncFromWorld();
    const chair=world.citizens.stations.find(station=>station.id==='chair');
    assert.equal(world.execute({requestId:'delete-chair-in-ar',op:'delete',
      objectId:chair.objectId}).ok,true);
    panel.syncFromWorld();
    assert.equal(world.citizens.stations.length,1);
    restoreStoredWorld(world,before);
    panel.syncFromWorld();
    assert.equal(world.citizens.stations.length,2);
    assert.ok(world.citizens.paused);
    assert.equal(world.scene.objects.some(object=>object.objectId===chair.objectId),true);
    world.leaveAR();panel.syncFromWorld();
    assert.equal(panel.simulation.snapshot().stations.length,2);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});

test('pending PC restore blocks Citizens ticks and controls until a rejected exchange rolls back',async()=>{
  const dom=stubDocument();
  let panel;
  try{
    let sequence=0,busy=false,commits=0,rejectSync;
    const world=new MatrixWorld(()=>`live-${++sequence}`);
    const simulation=createCitizensDemo(world,{seed:17});
    simulation.resume();
    world.citizens=simulation.advance();
    const savedByPanel=[];
    panel=new CitizensPanel(world,{
      onChange(){commits++;savedByPanel.push(storedWorld(world));},
      canStart:()=>'',canMutate:()=>busy?'PC exchange is pending.':'',onFeedback(){}});
    panel.pauseForCheckpoint();
    const before=storedWorld(world);
    assert.equal(before.citizens.paused,true);
    assert.equal(commits,1);

    const candidateWorld=new MatrixWorld(()=>`candidate-${++sequence}`);
    const candidateSimulation=createCitizensDemo(candidateWorld,{seed:91});
    candidateSimulation.resume();
    candidateWorld.citizens=candidateSimulation.advance();
    const candidate=storedWorld(candidateWorld);
    busy=true;panel.render();
    const exchange=applyPCWorld(world,candidate,()=>new Promise((resolve,reject)=>{
      rejectSync=reject;
    }));
    assert.equal(typeof rejectSync,'function');
    assert.deepEqual(storedWorld(world),candidate,'the PC candidate is staged before sync accepts it');
    assert.equal(dom.elements.get('citizens-toggle').disabled,true);
    assert.equal(dom.elements.get('citizens-step').disabled,true);
    assert.equal(dom.elements.get('citizens-stop').disabled,true);

    panel.tick();panel.toggle();panel.step();panel.start();panel.stop();
    panel.pauseForCheckpoint();panel.syncFromWorld();
    assert.deepEqual(storedWorld(world),candidate,
      'Citizens must neither advance nor replace the staged candidate');
    assert.equal(commits,1,'no Citizens change may auto-save a staged candidate');
    assert.deepEqual(savedByPanel,[before]);

    rejectSync(Error('PC exchange rejected'));
    await assert.rejects(exchange,/PC exchange rejected/);
    assert.deepEqual(storedWorld(world),before);
    busy=false;panel.syncFromWorld();panel.tick();
    assert.deepEqual(storedWorld(world),before,
      'the rejected exchange restores paused Citizens without auto-resuming');
    assert.equal(commits,1);
  }finally{
    if(panel)clearInterval(panel.timer);
    dom.restore();
  }
});
