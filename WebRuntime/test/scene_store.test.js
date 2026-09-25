import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {loadStoredScene,saveStoredScene,restoreStoredScene,saveCheckpoint,loadCheckpoint,
  storedWorld,saveStoredWorld,loadStoredWorld,restoreStoredWorld,quarantineStoredWorld,
  TAB_SCENE_KEY,DURABLE_SCENE_KEY,WORLD_KEY,TAB_WORLD_KEY,QUARANTINE_KEY} from '../src/scene_store.js';
import {startGame,deliverMovedObject} from '../src/game.js';
import {rememberTurn,clearConversation} from '../src/conversation.js';

function storage(){
  const values=new Map();
  return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
const pose={position:{x:1,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};

test('closing the tab restores the same virtual objects from durable browser storage',()=>{
  const tab=storage(),durable=storage();
  const original=new MatrixWorld(()=> 'chair-one');
  assert.equal(original.execute({requestId:'spawn',op:'spawn',assetId:'chair',anchorId:'web-floor',transform:pose}).ok,true);
  assert.equal(saveStoredScene(original.scene,tab,durable),'');
  assert.ok(durable.getItem(DURABLE_SCENE_KEY));
  const reopened=new MatrixWorld();
  restoreStoredScene(reopened,loadStoredScene(storage(),durable));
  assert.deepEqual(reopened.scene,original.scene);
});

test('legacy tab storage migrates and can restore while AR is already open',()=>{
  const tab=storage(),durable=storage();
  const original=new MatrixWorld(()=> 'orb-one');
  original.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  tab.setItem(TAB_SCENE_KEY,JSON.stringify(original.scene));
  durable.setItem(DURABLE_SCENE_KEY,'{bad json');
  const scene=loadStoredScene(tab,durable);
  const reopened=new MatrixWorld();
  reopened.enterAR();
  restoreStoredScene(reopened,scene);
  assert.equal(reopened.scene.objects.length,1);
  assert.equal(reopened.scene.roomId.startsWith('webxr-session-'),true);
  reopened.leaveAR();
  assert.deepEqual(reopened.scene,original.scene);
  assert.equal(saveStoredScene(reopened.scene,tab,durable),'');
  assert.deepEqual(JSON.parse(durable.getItem(DURABLE_SCENE_KEY)),original.scene);
});

test('manual checkpoint restores virtual-floor objects in an AR session',()=>{
  const durable=storage();const world=new MatrixWorld(()=> 'checkpoint-object');
  world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  assert.equal(saveCheckpoint(world.scene,null,durable),'');
  world.enterAR();world.execute({requestId:'clear',op:'clear'});
  const checkpoint=loadCheckpoint(durable);
  restoreStoredScene(world,checkpoint.scene);
  assert.equal(world.scene.objects[0].objectId,'checkpoint-object');
});

test('version 2 saves and restores scene, bindings, score and win progress together',()=>{
  const tab=storage(),durable=storage(),original=new MatrixWorld(()=>crypto.randomUUID());
  const spec={kind:'game',title:'Orb Courier',summary:'Deliver two orbs.',
    roles:[{roleId:'orbs',kind:'pickup',assetId:'orb',count:2},
      {roleId:'zone',kind:'delivery-zone',assetId:'pedestal',count:1}],
    rules:[{event:'release-near',actorRoleId:'orbs',targetRoleId:'zone',distanceMeters:.6,scorePoints:4}],
    objectives:[{kind:'delivered-count',roleId:'orbs',targetCount:2}]};
  startGame(original,spec);
  const game=original.game,target=original.requireObject(game.bindings.zone[0]);
  const id=game.bindings.orbs[0],transform=structuredClone(original.requireObject(id).transform);
  transform.position=structuredClone(target.transform.position);
  original.execute({requestId:'move',op:'set_transform',objectId:id,transform});
  assert.ok(deliverMovedObject(original,id));
  assert.equal(saveStoredWorld(storedWorld(original),tab,durable),'');
  assert.equal(JSON.parse(durable.getItem(WORLD_KEY)).version,2);
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,loadStoredWorld(storage(),durable).value);
  assert.deepEqual(reopened.scene,original.scene);
  assert.deepEqual(reopened.game,original.game);
  assert.equal(reopened.game.state.score,4);
});

test('scene-only saves migrate without replacing Matrix object IDs',()=>{
  const tab=storage(),durable=storage(),original=new MatrixWorld(()=> 'kept-id');
  original.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  durable.setItem(DURABLE_SCENE_KEY,JSON.stringify(original.scene));
  const pending=loadStoredWorld(tab,durable);
  assert.equal(pending.value.version,2);
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,pending.value);
  assert.equal(reopened.scene.objects[0].objectId,'kept-id');
  assert.equal(reopened.game,null);
  assert.equal(saveStoredWorld(storedWorld(reopened),tab,durable),'');
  assert.ok(durable.getItem(WORLD_KEY));
});

test('invalid saved world can be quarantined and subsequent edits persist',()=>{
  const tab=storage(),durable=storage(),current=new MatrixWorld();
  const invalid={version:2,scene:{schemaVersion:1,roomId:'web-virtual-room-v1',
    objects:[{objectId:'missing-asset',assetId:'web:absent',anchorId:'web-floor',transform:pose}]},game:null};
  durable.setItem(WORLD_KEY,JSON.stringify(invalid));
  const pending=loadStoredWorld(tab,durable);
  assert.throws(()=>restoreStoredWorld(current,pending.value),/Invalid scene object/);
  quarantineStoredWorld(pending,durable);
  assert.ok(durable.getItem(QUARANTINE_KEY));
  assert.equal(saveStoredWorld(storedWorld(current),tab,durable),'');
  assert.deepEqual(loadStoredWorld(tab,durable).value.scene,current.scene);
});

test('durable storage failure remains explicit while tab recovery still works',()=>{
  const tab=storage(),failing={setItem(){throw Error('quota exceeded');}};
  const warning=saveStoredWorld(storedWorld(new MatrixWorld()),tab,failing);
  assert.match(warning,/Closing Quest Browser may lose this world/);
  assert.equal(loadStoredWorld(tab,storage()).value.version,2);
});

test('reload prefers the newer tab world after a durable write fails',()=>{
  const tab=storage(),durable=storage(),world=new MatrixWorld(()=>crypto.randomUUID());
  world.execute({requestId:'first',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  assert.equal(saveStoredWorld(storedWorld(world),tab,durable),'');
  world.execute({requestId:'second',op:'spawn',assetId:'chair',anchorId:'web-floor',transform:pose});
  const failing={getItem:key=>durable.getItem(key),setItem(){throw Error('quota exceeded');}};
  assert.match(saveStoredWorld(storedWorld(world),tab,failing),/Persistent browser save failed/);
  assert.equal(loadStoredWorld(tab,durable).source,TAB_WORLD_KEY);
  assert.equal(loadStoredWorld(tab,durable).value.scene.objects.length,2);
  assert.equal(loadStoredWorld(storage(),durable).value.scene.objects.length,1);
});

test('checkpoint restore clears selection missing from the restored scene, including after leaving AR',()=>{
  const world=new MatrixWorld(()=> 'later-object');
  const checkpoint=storedWorld(world);
  world.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  world.setSelection('later-object',pose.position);
  world.enterAR();
  restoreStoredWorld(world,checkpoint);
  assert.equal(world.selection.objectId,'');
  assert.equal(world.selection.anchorId,'web-floor');
  world.leaveAR();
  assert.equal(world.selection.objectId,'');
  assert.equal(world.snapshot().scene.objects.length,0);
});

test('New Chat clears only conversation state',()=>{
  const tab=storage(),current=new MatrixWorld(()=> 'kept-id');
  current.execute({requestId:'spawn',op:'spawn',assetId:'orb',anchorId:'web-floor',transform:pose});
  const before=storedWorld(current);
  const history=rememberTurn(tab,[],'Create an orb','Done');
  assert.equal(history.length,1);
  assert.deepEqual(clearConversation(tab),[]);
  assert.deepEqual(storedWorld(current),before);
});
