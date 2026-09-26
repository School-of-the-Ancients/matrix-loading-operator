import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {applyPCWorld} from '../src/world_checkpoint.js';
import {storedWorld} from '../src/scene_store.js';
import {startGame} from '../src/game.js';
import {createCitizensDemo} from '../src/citizens.js';

const pose={position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
const spec={kind:'game',title:'Orb delivery',summary:'Deliver an orb.',
  roles:[{roleId:'pickup',kind:'pickup',assetId:'orb',count:1},
    {roleId:'zone',kind:'delivery-zone',assetId:'pedestal',count:1}],
  rules:[{event:'release-near',actorRoleId:'pickup',targetRoleId:'zone',distanceMeters:.5,scorePoints:1}],
  objectives:[{kind:'delivered-count',roleId:'pickup',targetCount:1}]};

function current(){
  const world=new MatrixWorld(()=> 'current-orb');
  assert.equal(world.execute({requestId:'current',op:'spawn',assetId:'orb',
    anchorId:'web-floor',transform:pose}).ok,true);
  world.setSelection('current-orb',pose.position,'web-floor');
  return world;
}

function saved(){
  const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  startGame(world,spec);
  world.game.state.score=1;
  world.game.state.deliveries=[world.game.bindings.pickup[0]];
  world.game.state.objectiveProgress={pickup:1};
  world.game.state.phase='won';
  return storedWorld(world);
}

test('PC restore exchanges exact IDs and game progress before replacing the displayed world',async()=>{
  const world=current(),checkpoint=saved();
  await applyPCWorld(world,checkpoint,async()=>{
    assert.deepEqual(storedWorld(world),checkpoint);
  });
  assert.deepEqual(storedWorld(world),checkpoint);
  assert.equal(world.game.state.phase,'won');
  assert.equal(world.originBinding,'unknown','a PC checkpoint has no AR provenance');
});

test('failed PC exchange leaves the prior scene, game, selection and undo state intact',async()=>{
  const world=current(),before=storedWorld(world),selection=structuredClone(world.selection),
    undo=structuredClone(world.undo),redo=structuredClone(world.redo);
  world.originBinding='ar';
  await assert.rejects(applyPCWorld(world,saved(),async()=>{throw Error('connection lost');}),
    /connection lost/);
  assert.deepEqual(storedWorld(world),before);
  assert.deepEqual(world.selection,selection);
  assert.deepEqual(world.undo,undo);
  assert.deepEqual(world.redo,redo);
  assert.equal(world.originBinding,'ar');
});

test('PC restore clears Citizens on success and rolls them back on failed exchange',async()=>{
  const world=new MatrixWorld(()=>crypto.randomUUID().replaceAll('-',''));
  const simulation=createCitizensDemo(world,{seed:43});
  simulation.step();world.citizens=simulation.snapshot();
  const before=storedWorld(world),checkpoint=saved();
  await assert.rejects(applyPCWorld(world,checkpoint,async()=>{
    assert.equal(world.citizens,null);
    throw Error('exchange rejected');
  }),/exchange rejected/);
  assert.deepEqual(storedWorld(world),before);
  await applyPCWorld(world,checkpoint,async()=>{});
  assert.equal(world.citizens,null);
  assert.deepEqual(storedWorld(world),checkpoint);
});

test('invalid PC checkpoint cannot replace a browser world',async()=>{
  const world=current(),before=storedWorld(world),missing=saved();
  missing.scene.objects[0].assetId='web:missing';
  let exchanged=false;
  await assert.rejects(applyPCWorld(world,missing,async()=>{exchanged=true;}),/Invalid scene object/);
  assert.equal(exchanged,false);
  assert.deepEqual(storedWorld(world),before);
});
