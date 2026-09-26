import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {startGame,deliverMovedObject,gameStatus,validateGameSpec,validSavedGame} from '../src/game.js';

const plan={kind:'game',title:'Orb Courier',summary:'Carry three orbs to the station.',
  roles:[{roleId:'orbs',kind:'pickup',assetId:'orb',count:3},
    {roleId:'station',kind:'delivery-zone',assetId:'pedestal',count:1}],
  rules:[{event:'release-near',actorRoleId:'orbs',targetRoleId:'station',distanceMeters:.55,scorePoints:10}],
  objectives:[{kind:'delivered-count',roleId:'orbs',targetCount:3}]};
const viewer={frames:[{anchorId:'web-floor',position:{x:0,y:1.7,z:0},forward:{x:0,y:0,z:-1}}]};
const world=()=>{let next=0;return new MatrixWorld(()=>`game-${++next}`);};
function moveTo(world,objectId,targetId){
  const object=world.requireObject(objectId),target=world.requireObject(targetId);
  const transform=structuredClone(object.transform);
  transform.position={...target.transform.position,x:target.transform.position.x+.1};
  assert.equal(world.execute({requestId:`move-${objectId}`,op:'set_transform',objectId,transform}).ok,true);
}

test('role instances bind to Matrix objects and release-near advances score and win state',()=>{
  const current=world(),game=startGame(current,plan,viewer);
  assert.equal(current.scene.schemaVersion,1);
  assert.equal(current.scene.objects.length,4);
  assert.deepEqual(game.bindings.orbs,['game-1','game-2','game-3']);
  assert.equal(game.bindings.station[0],'game-4');
  assert.equal(validSavedGame(game,current.scene),game);
  for(const [index,id] of game.bindings.orbs.entries()){
    moveTo(current,id,game.bindings.station[0]);
    assert.ok(deliverMovedObject(current,id));
    assert.equal(deliverMovedObject(current,id),null);
    assert.equal(game.state.score,(index+1)*10);
    assert.equal(game.state.objectiveProgress.orbs,index+1);
  }
  assert.equal(game.state.phase,'won');
  assert.match(gameStatus(current),/complete!/);
  assert.equal(validSavedGame(game,current.scene),game);
});

test('rules distinguish matching delivery zones with the same mechanics',()=>{
  const spec={...plan,roles:[
    {roleId:'red',kind:'pickup',assetId:'orb',count:1},
    {roleId:'blue',kind:'pickup',assetId:'block',count:1},
    {roleId:'red-zone',kind:'delivery-zone',assetId:'pedestal',count:1},
    {roleId:'blue-zone',kind:'delivery-zone',assetId:'table',count:1}],
    rules:[
      {event:'release-near',actorRoleId:'red',targetRoleId:'red-zone',distanceMeters:.5,scorePoints:5},
      {event:'release-near',actorRoleId:'blue',targetRoleId:'blue-zone',distanceMeters:.5,scorePoints:7}],
    objectives:[
      {kind:'delivered-count',roleId:'red',targetCount:1},
      {kind:'delivered-count',roleId:'blue',targetCount:1}]};
  const current=world(),game=startGame(current,spec,viewer);
  moveTo(current,game.bindings.red[0],game.bindings['blue-zone'][0]);
  assert.equal(deliverMovedObject(current,game.bindings.red[0]),null);
  moveTo(current,game.bindings.red[0],game.bindings['red-zone'][0]);
  assert.ok(deliverMovedObject(current,game.bindings.red[0]));
  assert.equal(game.state.phase,'playing');
  moveTo(current,game.bindings.blue[0],game.bindings['blue-zone'][0]);
  assert.ok(deliverMovedObject(current,game.bindings.blue[0]));
  assert.equal(game.state.phase,'won');
  assert.equal(game.state.score,12);
});

test('score threshold wins once without requiring a delivered-count objective',()=>{
  const spec={...plan,objectives:[{kind:'score-at-least',targetPoints:20}]};
  const current=world(),game=startGame(current,spec,viewer);
  assert.deepEqual(game.state.objectiveProgress,{});
  assert.match(gameStatus(current),/0\/20 points/);
  for(const id of game.bindings.orbs.slice(0,2)){
    moveTo(current,id,game.bindings.station[0]);
    assert.ok(deliverMovedObject(current,id));
  }
  assert.equal(game.state.phase,'won');
  assert.equal(game.state.score,20);
  assert.equal(deliverMovedObject(current,game.bindings.orbs[0]),null);
  assert.equal(validSavedGame(structuredClone(game),current.scene)?.state.phase,'won');
  assert.match(gameStatus(current),/complete! 20\/20 points/);
});

test('score objectives reject impossible thresholds and inconsistent saved progress',()=>{
  const spec={...plan,objectives:[{kind:'score-at-least',targetPoints:31}]};
  assert.throws(()=>validateGameSpec(spec),/Invalid game objective/);
  assert.throws(()=>validateGameSpec({...spec,objectives:[{kind:'score-at-least',targetPoints:20},
    {kind:'score-at-least',targetPoints:25}]}),/Invalid game objective/);
  assert.throws(()=>validateGameSpec({...plan,rules:[{...plan.rules[0],scorePoints:1},
    {...plan.rules[0],scorePoints:10}],objectives:[{kind:'score-at-least',targetPoints:10}]}),
    /Duplicate game rule/);
  const current=world(),game=startGame(current,{...spec,objectives:[{kind:'score-at-least',targetPoints:10}]},viewer);
  moveTo(current,game.bindings.orbs[0],game.bindings.station[0]);
  deliverMovedObject(current,game.bindings.orbs[0]);
  const altered=structuredClone(game);
  altered.state.score=100;
  assert.equal(validSavedGame(altered,current.scene),null);
  altered.state.score=10;
  altered.state.phase='playing';
  assert.equal(validSavedGame(altered,current.scene),null);
  altered.state.phase='won';
  altered.state.objectiveProgress=[];
  assert.equal(validSavedGame(altered,current.scene),null);
});

test('saved scores must equal a possible combination of rule awards',()=>{
  const spec={...plan,roles:[
    {roleId:'orbs',kind:'pickup',assetId:'orb',count:1},
    {roleId:'near',kind:'delivery-zone',assetId:'pedestal',count:1},
    {roleId:'far',kind:'delivery-zone',assetId:'table',count:1}],
    rules:[
      {event:'release-near',actorRoleId:'orbs',targetRoleId:'near',distanceMeters:.5,scorePoints:2},
      {event:'release-near',actorRoleId:'orbs',targetRoleId:'far',distanceMeters:.5,scorePoints:4}],
    objectives:[{kind:'score-at-least',targetPoints:3}]};
  const current=world(),game=startGame(current,spec,viewer);
  moveTo(current,game.bindings.orbs[0],game.bindings.near[0]);
  assert.ok(deliverMovedObject(current,game.bindings.orbs[0]));
  assert.equal(validSavedGame(game,current.scene),game);
  const altered=structuredClone(game);
  altered.state.score=3;altered.state.phase='won';
  assert.equal(validSavedGame(altered,current.scene),null);
  altered.state.score=4;
  assert.equal(validSavedGame(altered,current.scene),altered);
});

test('saved progress cannot contain repeated or post-win deliveries',()=>{
  const spec={...plan,objectives:[{kind:'delivered-count',roleId:'orbs',targetCount:1}]};
  const current=world(),game=startGame(current,spec,viewer);
  moveTo(current,game.bindings.orbs[0],game.bindings.station[0]);
  assert.ok(deliverMovedObject(current,game.bindings.orbs[0]));
  moveTo(current,game.bindings.orbs[1],game.bindings.station[0]);
  assert.equal(deliverMovedObject(current,game.bindings.orbs[1]),null);
  const altered=structuredClone(game);
  altered.state.deliveries.push(game.bindings.orbs[1]);
  altered.state.score=20;altered.state.objectiveProgress.orbs=2;
  assert.equal(validSavedGame(altered,current.scene),null);
  altered.state.deliveries=[game.bindings.orbs[0],game.bindings.orbs[0]];
  altered.state.objectiveProgress.orbs=1;
  assert.equal(validSavedGame(altered,current.scene),null);
});

test('invalid or unsupported plans leave the world intact',()=>{
  const current=world(),before=structuredClone(current.scene);
  assert.throws(()=>startGame(current,{...plan,roles:[{...plan.roles[0],assetId:'invented'},plan.roles[1]]},viewer),/unavailable/);
  assert.throws(()=>validateGameSpec({...plan,kind:'unsupported'}),/Invalid game/);
  assert.throws(()=>validateGameSpec({...plan,rules:[{...plan.rules[0],targetRoleId:'orbs'}]}),/Invalid game rule/);
  assert.deepEqual(current.scene,before);
  assert.equal(current.game,null);
});
