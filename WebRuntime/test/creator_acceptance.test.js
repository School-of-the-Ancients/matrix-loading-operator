import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {createProceduralRecipe,reviseProceduralRecipe} from '../src/procedural.js';
import {createRigidPhysics} from '../src/physics_rigid.js';
import {transitionCreatorMode} from '../src/creator_mode.js';
import {deliverMovedObject,gameStatus,isGameExitUnlocked} from '../src/game.js';
import {displayObservation} from '../src/display.js';
import {storedWorld,restoreStoredWorld,saveStoredWorld,loadStoredWorld} from '../src/scene_store.js';

let request=0,object=0;
const pose=(x=0,y=0,z=0)=>({position:{x,y,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
const rigid=(type,collider='bounds-box',sensor=false)=>({schemaVersion:1,type,
  collider,restitution:0,friction:.8,sensor});
const display=(title,body,binding)=>({schemaVersion:1,title,body,binding});
const world=()=>new MatrixWorld(()=>`acceptance-${++object}`);
function apply(world,op,data={}){
  const receipt=world.execute({requestId:`acceptance-request-${++request}`,op,...data});
  assert.equal(receipt.ok,true,`${op}: ${receipt.error}`);
  return receipt.objectId||receipt;
}
const spawn=(world,assetId,transform)=>apply(world,'spawn',
  {assetId,anchorId:'web-floor',transform});
function bindDelivery(world,{title,actors,zone,exit,event='release-near'}){
  const actorAsset=world.requireObject(actors[0]).assetId;
  apply(world,'bind_game',{spec:{schemaVersion:2,kind:'game',title,
    summary:'Use the live objects and observe the exit unlock.',
    roles:[{roleId:'items',kind:'pickup',assetId:actorAsset,count:actors.length},
      {roleId:'zone',kind:'delivery-zone',assetId:world.requireObject(zone).assetId,count:1},
      {roleId:'exit',kind:'exit',assetId:world.requireObject(exit).assetId,count:1}],
    rules:[{event,actorRoleId:'items',targetRoleId:'zone',
      distanceMeters:1,scorePoints:5}],
    objectives:[{kind:'delivered-count',roleId:'items',targetCount:actors.length}],
    consequences:[{kind:'unlock',roleId:'exit'}]},
  bindings:{items:actors,zone:[zone],exit:[exit]}});
}
function store(){
  const map=new Map();
  return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),
    removeItem:key=>map.delete(key)};
}
function switchMode(world,action){
  world.creatorMode=transitionCreatorMode(world.creatorMode,action,world.creatorMode.revision);
}

test('Operator physics playground fixture creates, plays, revises and reopens the same world',async()=>{
  const current=world();current.attachRigidPhysics(await createRigidPhysics());
  const recipe=createProceduralRecipe('bridge',{lengthMeters:5,widthMeters:1.5,
    deckHeightMeters:1,riseMeters:1,railings:false,supports:false});
  const ramp=apply(current,'create_procedural',{anchorId:'web-floor',transform:pose(-3,0,0),
    procedural:recipe});
  apply(current,'set_rigid_body',{objectId:ramp,rigidBody:rigid('static','procedural-mesh')});
  const actors=[
    spawn(current,'block',pose(-4,2,0)),
    spawn(current,'block',pose(-4,3.1,0)),
    spawn(current,'block',pose(-3,4.2,0))
  ];
  for(const id of actors)apply(current,'set_rigid_body',{objectId:id,
    rigidBody:rigid('dynamic')});
  const zone=spawn(current,'pedestal',pose(3,0,0));
  apply(current,'set_rigid_body',{objectId:zone,rigidBody:rigid('static','bounds-box',true)});
  const exit=spawn(current,'wall',pose(5,0,0));
  const board=spawn(current,'wall',pose(0,0,-3));
  const questBoard=display('Physics Playground','Deliver all three blocks to the receptacle.',
    {kind:'game-progress'});
  apply(current,'set_display',{objectId:board,display:questBoard,expectedDisplay:null});
  bindDelivery(current,{title:'Playground Challenge',actors,zone,exit});
  switchMode(current,'enter-play');
  const contacts=[];
  for(let tick=0;tick<160;tick++)contacts.push(...current.advanceRigidPhysics(1/60));
  const contacted=(a,b)=>contacts.some(item=>item.started&&
    [item.objectIdA,item.objectIdB].includes(a)&&
    [item.objectIdA,item.objectIdB].includes(b));
  assert.ok(actors.some(id=>contacted(id,ramp)),'blocks contact generated ramp mesh');
  assert.ok(actors.some((a,i)=>actors.slice(i+1).some(b=>contacted(a,b))),
    'two dynamic bodies collide with one another');
  assert.match(displayObservation(current,questBoard).text,/0\/3 items/);
  assert.equal(isGameExitUnlocked(current,exit),false);
  for(const [index,id] of actors.entries()){
    for(let cycle=0;cycle<2;cycle++){
      assert.equal(current.beginRigidGrab(id),true);
      current.moveRigidGrab(id,pose(3,2+cycle,0));
      assert.equal(current.releaseRigidGrab(id).held,false);
      const released=current.rigidPhysics.state(id).position.y;
      for(let tick=0;tick<8;tick++)current.advanceRigidPhysics(1/60);
      assert.ok(current.rigidPhysics.state(id).position.y<released,
        'released object resumes physics');
    }
    assert.equal(current.beginRigidGrab(id),true);
    current.moveRigidGrab(id,pose(3,.8,0));
    current.releaseRigidGrab(id);
    current.advanceRigidPhysics(1/60);
    assert.ok(deliverMovedObject(current,id),`object ${index} earns progress`);
    assert.equal(deliverMovedObject(current,id),null,'duplicate credit is rejected');
  }
  assert.equal(current.game.state.objectiveProgress.items,3);
  assert.equal(current.game.state.score,15);
  assert.equal(current.game.state.creditedEvents.length,3);
  assert.equal(isGameExitUnlocked(current,exit),true);
  assert.match(displayObservation(current,questBoard).text,/Exit unlocked/);
  switchMode(current,'enter-creator');
  const revised=reviseProceduralRecipe(recipe,{riseMeters:1.4,widthMeters:2});
  apply(current,'update_procedural',{objectId:ramp,expectedProcedural:recipe,
    procedural:revised,expectedTransform:pose(-3,0,0)});
  apply(current,'set_gravity',{gravity:{x:0,y:-4,z:0}});
  const revisedBoard=display('Revised Playground','The slope and gravity changed.',
    {kind:'game-progress'});
  apply(current,'set_display',{objectId:board,expectedDisplay:questBoard,
    display:revisedBoard});
  assert.equal(current.requireObject(ramp).objectId,ramp);
  assert.deepEqual(current.game.bindings.items,actors);
  assert.equal(current.game.state.objectiveProgress.items,3);
  const tab=store(),durable=store();
  assert.equal(saveStoredWorld(storedWorld(current),tab,durable),'');
  const recovered=loadStoredWorld(tab,durable);
  const reopened=world();restoreStoredWorld(reopened,recovered.value);
  reopened.attachRigidPhysics(await createRigidPhysics());
  assert.deepEqual(reopened.requireObject(ramp).procedural,revised);
  assert.deepEqual(reopened.rigidGravity,{x:0,y:-4,z:0});
  assert.equal(reopened.requireObject(board).display.title,'Revised Playground');
  assert.equal(reopened.game.state.objectiveProgress.items,3);
  assert.equal(isGameExitUnlocked(reopened,exit),true);
  assert.match(gameStatus(reopened),/complete/);
  assert.equal(reopened.requireObject(actors[0]).objectId,actors[0]);
  switchMode(reopened,'enter-play');
  reopened.advanceRigidPhysics(1/60);
  switchMode(reopened,'enter-creator');
  current.rigidPhysics.dispose();reopened.rigidPhysics.dispose();
});

test('gravity classroom exhibit uses the same creation, action, observation and save path',async()=>{
  const current=world();current.attachRigidPhysics(await createRigidPhysics());
  const bench=apply(current,'create_procedural',{anchorId:'web-floor',transform:pose(0,0,-2),
    procedural:createProceduralRecipe('curved-bench')});
  const specimens=[spawn(current,'orb',pose(-1,2,1)),spawn(current,'orb',pose(1,2,1))];
  for(const id of specimens)apply(current,'set_rigid_body',{objectId:id,
    rigidBody:rigid('dynamic')});
  const zone=spawn(current,'pedestal',pose(0,0,3));
  const exit=spawn(current,'wall',pose(4,0,3));
  const gravityBoard=spawn(current,'wall',pose(-3,0,0));
  const gravityDisplay=display('Gravity Lab','Observe the current field.',{kind:'gravity'});
  apply(current,'set_display',{objectId:gravityBoard,display:gravityDisplay,
    expectedDisplay:null});
  const statusBoard=spawn(current,'wall',pose(3,0,0));
  const bodyDisplay=display('Specimen State','Observe one specimen.',
    {kind:'rigid-body',objectId:specimens[0]});
  apply(current,'set_display',{objectId:statusBoard,display:bodyDisplay,
    expectedDisplay:null});
  bindDelivery(current,{title:'Gravity Lab Exhibit',actors:specimens,zone,exit});
  assert.match(displayObservation(current,gravityDisplay).text,/-9.81/);
  switchMode(current,'enter-play');
  for(const id of specimens){
    assert.equal(current.beginRigidGrab(id),true);
    current.moveRigidGrab(id,pose(0,.8,3));
    current.releaseRigidGrab(id);
    current.advanceRigidPhysics(1/60);
    assert.ok(deliverMovedObject(current,id));
  }
  assert.equal(isGameExitUnlocked(current,exit),true);
  assert.match(displayObservation(current,bodyDisplay).text,/Live reading/);
  switchMode(current,'enter-creator');
  apply(current,'set_gravity',{gravity:{x:0,y:-2,z:0}});
  assert.match(displayObservation(current,gravityDisplay).text,/-2.00/);
  const saved=storedWorld(current),reopened=world();
  restoreStoredWorld(reopened,saved);
  assert.equal(reopened.requireObject(bench).objectId,bench);
  assert.deepEqual(reopened.game.bindings.items,specimens);
  assert.equal(reopened.game.state.objectiveProgress.items,2);
  assert.equal(isGameExitUnlocked(reopened,exit),true);
  assert.match(displayObservation(reopened,gravityDisplay).text,/-2.00/);
  current.rigidPhysics.dispose();
});
