import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {recordGameEvent,startGame,validSavedGame} from '../src/game.js';
import {storedWorld,restoreStoredWorld} from '../src/scene_store.js';
import {createRigidPhysics} from '../src/physics_rigid.js';

let sequence=0;
const pose=(x=0,y=0,z=0)=>({position:{x,y,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
const execute=(world,op,fields={})=>world.execute({requestId:`game-revision-${++sequence}`,
  op,...fields});
function accepted(world,op,fields={}){
  const receipt=execute(world,op,fields);
  assert.equal(receipt.ok,true,receipt.error);
  return receipt;
}
function fixture(bind=true){
  let id=0;
  const world=new MatrixWorld(()=>`game-object-${++id}`);
  const extra=accepted(world,'spawn',{assetId:'chair',anchorId:'web-floor',
    transform:pose(-4)}).objectId;
  const spare=accepted(world,'spawn',{assetId:'orb',anchorId:'web-floor',
    transform:pose(-5)}).objectId;
  const actors=[0,1,2].map(index=>accepted(world,'spawn',{
    assetId:'orb',anchorId:'web-floor',transform:pose(index,0,-2)}).objectId);
  const zone=accepted(world,'spawn',{assetId:'pedestal',anchorId:'web-floor',
    transform:pose(0,0,1)}).objectId;
  const exit=accepted(world,'spawn',{assetId:'wall',anchorId:'web-floor',
    transform:pose(3,0,1)}).objectId;
  const spec={schemaVersion:2,kind:'game',title:'Orb Course',summary:'Deliver three orbs.',
    roles:[{roleId:'orbs',kind:'pickup',assetId:'orb',count:3},
      {roleId:'zone',kind:'delivery-zone',assetId:'pedestal',count:1},
      {roleId:'exit',kind:'exit',assetId:'wall',count:1}],
    rules:[{event:'release-near',actorRoleId:'orbs',targetRoleId:'zone',
      distanceMeters:.75,scorePoints:10}],
    objectives:[{kind:'delivered-count',roleId:'orbs',targetCount:3}],
    consequences:[{kind:'unlock',roleId:'exit'}]};
  const bindings={orbs:actors,zone:[zone],exit:[exit]};
  if(bind)accepted(world,'bind_game',{spec,bindings});
  return {world,spec,bindings,actors,zone,exit,extra,spare};
}
function credit(world,objectId,targetObjectId,eventId){
  accepted(world,'set_transform',{objectId,transform:pose(0,0,1)});
  const result=recordGameEvent(world,{eventId,event:'release-near',
    objectId,targetObjectId});
  assert.equal(result?.credited,true);
}

test('game revision preserves earned ledger, score, progress, exit and object IDs',()=>{
  const {world,spec,bindings,actors,zone,exit,extra}=fixture();
  credit(world,actors[0],zone,'earned-one');
  const earned=structuredClone(world.game.state);
  const scene=structuredClone(world.scene);
  const revised={...spec,title:'Orb Course Revised',summary:'The same earned challenge.'};
  const receipt=accepted(world,'update_game',{spec:revised,bindings,
    expectedSpec:spec,expectedBindings:bindings});
  assert.equal(receipt.outcome.kind,'game-updated');
  assert.equal(receipt.outcome.deliveredCount,1);
  assert.deepEqual(world.game.state,earned);
  assert.deepEqual(world.scene,scene);
  assert.deepEqual(world.game.bindings.orbs,actors);
  assert.ok(world.scene.objects.some(item=>item.objectId===extra));
  for(const [index,id] of actors.slice(1).entries())credit(world,id,zone,`earned-${index+2}`);
  assert.equal(world.game.state.phase,'won');
  assert.deepEqual(world.game.state.unlockedObjectIds,[exit]);
  const won=structuredClone(world.game.state);
  const final={...revised,title:'Finished Course'};
  accepted(world,'update_game',{spec:final,bindings,
    expectedSpec:revised,expectedBindings:bindings});
  assert.deepEqual(world.game.state,won);
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,storedWorld(world));
  assert.equal(reopened.game.spec.title,'Finished Course');
  assert.deepEqual(reopened.game.state,won);
  assert.deepEqual(reopened.game.bindings,bindings);
  assert.equal(validSavedGame(reopened.game,reopened.scene,id=>!!reopened.asset(id)),
    reopened.game);
});

test('stale or incompatible game revisions fail atomically with clear migration boundary',()=>{
  const {world,spec,bindings,actors,zone,spare}=fixture();
  credit(world,actors[0],zone,'earned-one');
  credit(world,actors[1],zone,'earned-two');
  const before=structuredClone({scene:world.scene,game:world.game,
    undo:world.undo,redo:world.redo});
  const revised={...spec,title:'New title'};
  const attempts=[
    {spec:revised,bindings,expectedSpec:{...spec,title:'Stale'},expectedBindings:bindings},
    {spec:revised,bindings,expectedSpec:spec,
      expectedBindings:{...bindings,zone:['stale-zone']}},
    {spec:{...spec,rules:[{...spec.rules[0],distanceMeters:1}]},bindings,
      expectedSpec:spec,expectedBindings:bindings},
    {spec:{...spec,roles:[{...spec.roles[0],count:2},...spec.roles.slice(1)]},
      bindings:{...bindings,orbs:actors.slice(0,2)},expectedSpec:spec,
      expectedBindings:bindings},
    {spec:{...spec,objectives:[{...spec.objectives[0],targetCount:2}]},
      bindings,expectedSpec:spec,expectedBindings:bindings},
    {spec:revised,bindings:{...bindings,orbs:[actors[2],actors[1],spare]},
      expectedSpec:spec,expectedBindings:bindings}
  ];
  for(const attempt of attempts){
    const receipt=execute(world,'update_game',attempt);
    assert.equal(receipt.ok,false);
    assert.match(receipt.error,/changed|migrate|progress|bindings|Invalid/);
    assert.deepEqual({scene:world.scene,game:world.game,undo:world.undo,redo:world.redo},
      before);
  }
  assert.match(execute(world,'update_game',{spec:revised,bindings}).error,
    /preconditions/);
});

test('unearned game can revise roles and rules with existing live bindings',()=>{
  const {world,spec,bindings,actors}=fixture();
  const newSpec={...spec,roles:[{...spec.roles[0],count:2},...spec.roles.slice(1)],
    rules:[{...spec.rules[0],distanceMeters:1,scorePoints:5}],
    objectives:[{...spec.objectives[0],targetCount:2}]};
  accepted(world,'update_game',{spec:newSpec,
    bindings:{...bindings,orbs:actors.slice(0,2)},
    expectedSpec:spec,expectedBindings:bindings});
  assert.deepEqual(world.game.state,{phase:'playing',score:0,deliveries:[],
    objectiveProgress:{orbs:0},creditedEvents:[],unlockedObjectIds:[]});
  assert.equal(world.scene.objects.some(item=>item.objectId===actors[2]),true);
});

test('delete, clear, load and history cannot silently lose a bound game',()=>{
  const {world,bindings,actors,extra}=fixture();
  const before=structuredClone({scene:world.scene,game:world.game,
    undo:world.undo,redo:world.redo});
  for(const [op,fields] of [
    ['delete',{objectId:actors[0]}],['clear',{}],
    ['load',{scene:{...world.scene,objects:world.scene.objects.filter(item=>
      item.objectId!==actors[0])}}],['undo',{}]]){
    const receipt=execute(world,op,fields);
    assert.equal(receipt.ok,false,op);
    assert.deepEqual({scene:world.scene,game:world.game,undo:world.undo,
      redo:world.redo},before,op);
  }
  accepted(world,'delete',{objectId:extra});
  assert.deepEqual(world.game.bindings,bindings);
  accepted(world,'undo');
  assert.equal(world.scene.objects.some(item=>item.objectId===extra),true);
});

test('redo of a previously valid scene edit is refused after binding a game',()=>{
  const {world,spec,bindings,exit}=fixture(false);
  accepted(world,'delete',{objectId:exit});
  accepted(world,'undo');
  accepted(world,'bind_game',{spec,bindings});
  const before=structuredClone({scene:world.scene,game:world.game,
    undo:world.undo,redo:world.redo});
  const receipt=execute(world,'redo');
  assert.equal(receipt.ok,false);
  assert.deepEqual({scene:world.scene,game:world.game,undo:world.undo,
    redo:world.redo},before);
});

test('sensor game keeps required actor and target colliders during world edits',async()=>{
  const {world,spec,bindings,actors,zone}=fixture(false);
  world.attachRigidPhysics(await createRigidPhysics());
  const dynamic={schemaVersion:1,type:'dynamic',collider:'bounds-box',
    restitution:0,friction:.8,sensor:false};
  const sensor={...dynamic,type:'static',sensor:true};
  for(const objectId of actors)accepted(world,'set_rigid_body',{objectId,
    rigidBody:dynamic});
  accepted(world,'set_rigid_body',{objectId:zone,rigidBody:sensor});
  accepted(world,'bind_game',{spec:{...spec,rules:[{...spec.rules[0],
    event:'sensor-enter'}]},bindings});
  const before=structuredClone({scene:world.scene,game:world.game,
    undo:world.undo,redo:world.redo});
  assert.match(execute(world,'remove_rigid_body',{objectId:zone}).error,/Sensor challenge/);
  assert.match(execute(world,'set_rigid_body',{objectId:actors[0],
    rigidBody:{...dynamic,type:'static'}}).error,/Sensor challenge/);
  assert.deepEqual({scene:world.scene,game:world.game,undo:world.undo,
    redo:world.redo},before);
  world.rigidPhysics.dispose();
});

test('legacy start-game path cannot overwrite an earned active challenge',()=>{
  const {world,spec,actors,zone}=fixture();
  credit(world,actors[0],zone,'earned-one');
  const before=structuredClone({scene:world.scene,game:world.game,
    undo:world.undo,redo:world.redo});
  assert.throws(()=>startGame(world,spec),/active game/);
  assert.deepEqual({scene:world.scene,game:world.game,undo:world.undo,
    redo:world.redo},before);
});
