import test from 'node:test';
import assert from 'node:assert/strict';
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
    panel.render();
    assert.match(dom.elements.get('citizens-social-status').textContent,/Ada is conversing with Bo · active/);
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

    world.enterAR();
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
    world.enterAR();panel.syncFromWorld();
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
    world.enterAR();panel.syncFromWorld();
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
