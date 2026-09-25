import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {loadStoredScene,saveStoredScene,restoreStoredScene,TAB_SCENE_KEY,DURABLE_SCENE_KEY} from '../src/scene_store.js';

function storage(){
  const values=new Map();
  return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
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
