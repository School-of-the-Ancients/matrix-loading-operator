import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {componentFrame,validatePackage} from '../src/components.js';
import {storedWorld,restoreStoredWorld,saveStoredWorld,loadStoredWorld} from '../src/scene_store.js';

const c=n=>({op:'const',value:n});
const t={op:'time'};
const ref=(op,path)=>({op,path});
const mul=(...args)=>({op:'mul',args});
const add=(...args)=>({op:'add',args});
const sin=arg=>({op:'sin',arg});
const cos=arg=>({op:'cos',arg});
const orbitPulse={schemaVersion:1,name:'Orbit and pulse',outputs:{
  'position.x':add(ref('target','position.x'),mul(c(2),cos(t))),
  'position.z':add(ref('target','position.z'),mul(c(2),sin(t))),
  'scale.x':mul(ref('self','scale.x'),add(c(1),mul(c(.2),sin(t)))),
  'scale.y':mul(ref('self','scale.y'),add(c(1),mul(c(.2),sin(t)))),
  'scale.z':mul(ref('self','scale.z'),add(c(1),mul(c(.2),sin(t))))}};
const pose=(x=0,z=0)=>({position:{x,y:0,z},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}});
const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};};

test('generic component graph orbits another object while pulsing without a named orbit command',()=>{
  validatePackage(orbitPulse);
  let index=0;const world=new MatrixWorld(()=>`object-${++index}`);
  for(const assetId of ['table','orb'])assert.equal(world.execute({requestId:`spawn-${assetId}`,op:'spawn',assetId,
    anchorId:'web-floor',transform:pose()}).ok,true);
  assert.equal(world.execute({requestId:'attach',op:'attach_component',objectId:'object-2',
    targetObjectId:'object-1',componentId:'webcomp:orbit-pulse:0123456789ab',package:orbitPulse}).ok,true);
  const orb=world.scene.objects[1],table=world.scene.objects[0];
  const atStart=componentFrame(orb.component,orb.transform,table.transform,orb.component.startedAtMs);
  assert.equal(atStart.position.x,2);assert.equal(atStart.position.z,0);assert.equal(atStart.scale.x,1);
  const atQuarter=componentFrame(orb.component,orb.transform,table.transform,
    orb.component.startedAtMs+Math.PI*500);
  assert.ok(Math.abs(atQuarter.position.x)<.002);
  assert.ok(Math.abs(atQuarter.position.z-2)<.002);
  assert.ok(Math.abs(atQuarter.scale.y-1.2)<.002);
  const tab=storage(),durable=storage();
  assert.equal(saveStoredWorld(storedWorld(world),tab,durable),'');
  const restored=new MatrixWorld();restoreStoredWorld(restored,loadStoredWorld(storage(),durable).value);
  assert.deepEqual(restored.scene,world.scene);
  assert.equal(restored.scene.objects[1].component.status,'running');
  assert.equal(world.execute({requestId:'stop',op:'stop_component',objectId:'object-2'}).ok,true);
  assert.equal(componentFrame(orb.component,orb.transform,table.transform,Date.now()),null);
  assert.equal(world.execute({requestId:'remove',op:'remove_component',objectId:'object-2'}).ok,true);
  assert.equal(world.scene.objects[1].component,undefined);
  assert.equal(world.execute({requestId:'undo',op:'undo'}).ok,true);
  assert.equal(world.scene.objects[1].component.status,'stopped');
});

test('component budgets, unsupported capabilities and missing target fail closed',()=>{
  assert.throws(()=>validatePackage({schemaVersion:1,name:'Unsafe',outputs:{'position.x':{op:'eval',source:'fetch(secret)'}}}),
    /Invalid component expression/);
  assert.throws(()=>validatePackage({schemaVersion:1,name:'Loop',outputs:{'position.x':
    Array.from({length:10}).reduce(arg=>sin(arg),t)}}),/budget exceeded/);
  let index=0;const world=new MatrixWorld(()=>`o-${++index}`);
  for(const assetId of ['table','orb'])world.execute({requestId:assetId,op:'spawn',assetId,anchorId:'web-floor',transform:pose()});
  const attach={requestId:'attach',op:'attach_component',objectId:'o-2',targetObjectId:'o-1',
    componentId:'webcomp:orbit-pulse:0123456789ab',package:orbitPulse};
  assert.equal(world.execute(attach).ok,true);
  assert.throws(()=>componentFrame(world.scene.objects[1].component,world.scene.objects[1].transform,null,Date.now()),
    /target is unavailable/);
  assert.equal(world.execute({requestId:'delete',op:'delete',objectId:'o-1'}).ok,true);
  assert.equal(world.scene.objects[0].component.status,'failed');
  assert.equal(world.scene.objects[0].component.error,'Component target was deleted');
  world.validateScene(world.scene);
});
