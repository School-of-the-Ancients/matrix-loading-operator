import test from 'node:test';
import assert from 'node:assert/strict';
import {displayHeadline,displayObservation,validDisplay} from '../src/display.js';
import {MatrixView} from '../src/view.js';
import {MatrixWorld} from '../src/protocol.js';
import {storedWorld,restoreStoredWorld} from '../src/scene_store.js';

const base={schemaVersion:1,title:'Results',body:'Move the objects, then inspect the outcome.',binding:null};

test('display schema accepts data bindings and rejects executable or malformed fields',()=>{
  for(const binding of [null,{kind:'game-progress'},{kind:'gravity'},
    {kind:'rigid-body',objectId:'orb-1'},
    {kind:'object-transform',objectId:'block-1'}])
    assert.equal(validDisplay({...base,binding}),true);
  for(const display of [{...base,script:'alert(1)'},
    {...base,binding:{kind:'game-progress',script:'alert(1)'}},
    {...base,binding:{kind:'rigid-body',objectId:''}},
    {...base,binding:{kind:'object-transform',objectId:''}},
    {...base,binding:{kind:'object-transform',objectId:'block-1',ratio:2}},
    {...base,title:'\u0000bad'}])assert.equal(validDisplay(display),false);
});

test('object-transform board, entity inspection, and reopened world share current scale',()=>{
  let next=0;
  const world=new MatrixWorld(()=>`exhibit-${++next}`);
  const pose={position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},
    scale:{x:1,y:1,z:1}};
  const specimen=world.execute({requestId:'spawn-block',op:'spawn',assetId:'block',
    anchorId:'web-floor',transform:pose}).objectId;
  const board=world.execute({requestId:'spawn-board',op:'spawn',assetId:'wall',
    anchorId:'web-floor',transform:{...pose,position:{x:2,y:0,z:-2}}}).objectId;
  const display={...base,binding:{kind:'object-transform',objectId:specimen}};
  assert.equal(world.execute({requestId:'set-board',op:'set_display',
    objectId:board,expectedDisplay:null,display}).ok,true);
  const changed={position:{x:.5,y:0,z:-2},rotation:{x:0,y:30,z:0},
    scale:{x:2,y:.75,z:1.25}};
  assert.equal(world.execute({requestId:'scale-block',op:'set_transform',
    objectId:specimen,transform:changed}).ok,true);
  const reading=displayObservation(world,display);
  assert.equal(reading.source,'MatrixWorld.scene.objects');
  assert.equal(reading.status,'current');
  assert.match(reading.text,/scale \(unitless\) \(2\.000, 0\.750, 1\.250\)/);
  assert.match(reading.text,/local size \(m\) \(2\.000, 0\.750, 1\.250\)/);
  assert.equal(displayHeadline(world,display,reading),'SIZE 2 × 0.75 × 1.25 m');
  assert.doesNotMatch(reading.text,/ratio|baseline/i);
  const inspected=world.execute({requestId:'inspect-board',op:'inspect_entity',
    objectId:board});
  assert.equal(inspected.ok,true);
  assert.deepEqual(inspected.outcome.displayObservation,reading);

  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,storedWorld(world));
  assert.equal(reopened.requireObject(specimen).objectId,specimen);
  assert.deepEqual(reopened.requireObject(specimen).transform,changed);
  assert.deepEqual(reopened.requireObject(board).display,display);
  assert.deepEqual(displayObservation(reopened,display),reading);
  assert.equal(displayHeadline(reopened,display),'SIZE 2 × 0.75 × 1.25 m');
  assert.deepEqual(reopened.inspectEntity(board).displayObservation,reading);

  reopened.requireObject(specimen).transform.scale.x=1.5;
  assert.equal(displayHeadline(reopened,display),'SIZE 1.5 × 0.75 × 1.25 m');
  assert.match(displayObservation(reopened,display).text,
    /local size \(m\) \(1\.500, 0\.750, 1\.250\)/);
  reopened.scene.objects=reopened.scene.objects.filter(item=>item.objectId!==specimen);
  assert.equal(displayObservation(reopened,display).status,'unavailable');
  assert.equal(displayHeadline(reopened,display),'READING UNAVAILABLE');
});

test('procedural transform board refreshes live scale without rebuilding geometry',()=>{
  let generated=0;
  const target={objectId:'geometry-1',assetId:'matrix:procedural',
    transform:{position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},
      scale:{x:1,y:1,z:1}}};
  const display={...base,binding:{kind:'object-transform',objectId:'geometry-1'}};
  const drawn=[];
  const context={fillRect(){},strokeRect(){},fillText(value){drawn.push(String(value));},
    measureText(value){return {width:String(value).length*8};}};
  const board={canvas:{getContext:()=>context},texture:{needsUpdate:false},
    lastSignature:'',lastUpdated:-Infinity};
  const view=Object.create(MatrixView.prototype);
  view.world={scene:{objects:[target,{objectId:'board-1',display}]},
    asset:()=>({assetId:'matrix:procedural',spawnScale:1}),
    objectBounds(){generated++;throw Error('Should not generate mesh for board text');}};
  view.objectRoots=new Map([['board-1',{userData:{displayBoard:board}}]]);
  view.refreshDisplays(false,1000);
  assert.ok(drawn.some(text=>text.includes('1.000')));
  target.transform.scale.x=1.5;drawn.length=0;
  view.refreshDisplays(false,1300);
  assert.ok(drawn.some(text=>text.includes('1.500')));
  assert.equal(generated,0);
  assert.doesNotMatch(displayObservation(view.world,display).text,/local size/i);
  assert.equal(displayHeadline(view.world,display),'SCALE 1.5 × 1 × 1');
});

test('challenge board observes shared progress and unlock rather than keeping a second score',()=>{
  const world={scene:{objects:[]},asset:()=>true,game:{
    spec:{kind:'game',schemaVersion:2,title:'Delivery',summary:'Deliver one object.',
      roles:[{roleId:'items',kind:'pickup',assetId:'orb',count:1},
        {roleId:'zone',kind:'delivery-zone',assetId:'pedestal',count:1},
        {roleId:'exit',kind:'exit',assetId:'wall',count:1}],
      rules:[{event:'sensor-enter',actorRoleId:'items',targetRoleId:'zone',distanceMeters:.5,scorePoints:1}],
      objectives:[{kind:'delivered-count',roleId:'items',targetCount:1}],
      consequences:[{kind:'unlock',roleId:'exit'}]},
    bindings:{items:['orb-1'],zone:['zone-1'],exit:['exit-1']},
    state:{phase:'playing',score:0,deliveries:[],objectiveProgress:{items:0},
      creditedEvents:[],unlockedObjectIds:[]}}};
  world.scene.objects=['orb-1','zone-1','exit-1'].map((objectId,index)=>({objectId,
    assetId:['orb','pedestal','wall'][index],anchorId:'web-floor'}));
  const display={...base,binding:{kind:'game-progress'}};
  assert.match(displayObservation(world,display).text,/0\/1 items/);
  assert.equal(displayHeadline(world,display),'0/1 ITEMS');
  world.game.state={phase:'won',score:1,deliveries:['orb-1'],objectiveProgress:{items:1},
    creditedEvents:[{eventId:'sensor-1',event:'sensor-enter',objectId:'orb-1',
      targetObjectId:'zone-1',scorePoints:1}],unlockedObjectIds:['exit-1']};
  assert.match(displayObservation(world,display).text,/Exit unlocked/);
  assert.equal(displayHeadline(world,display),'1/1 ITEMS COMPLETE');
});

test('same display mechanism reads gravity and current or unavailable body state',()=>{
  const body={objectId:'orb-1',rigidBody:{type:'dynamic'}};
  const world={scene:{objects:[body]},rigidGravity:{x:0,y:-4.9,z:0},
    creatorMode:{simulation:'paused'},rigidPhysics:{state:()=>({type:'dynamic',held:false,
      position:{x:0,y:1,z:0},linearVelocity:{x:0,y:-2,z:0}})}};
  assert.match(displayObservation(world,{...base,binding:{kind:'gravity'}}).text,/-4.90/);
  assert.equal(displayHeadline(world,{...base,binding:{kind:'gravity'}}),'-4.9 m/s²');
  const display={...base,binding:{kind:'rigid-body',objectId:'orb-1'}};
  assert.match(displayObservation(world,display).text,/Paused snapshot.*2.00 m\/s/);
  assert.equal(displayHeadline(world,display),'2.00 m/s');
  world.rigidPhysics=null;
  assert.equal(displayObservation(world,display).status,'unavailable');
  assert.equal(displayHeadline(world,display),'READING UNAVAILABLE');
});

test('authored and unavailable displays keep a large truthful headline',()=>{
  const staticDisplay={...base,body:'Try 2 × 3 × 4 and inspect the model.'};
  assert.equal(displayHeadline({},staticDisplay),'Try 2 × 3 × 4 and inspect the model.');
  const gravity={...base,binding:{kind:'gravity'}};
  assert.equal(displayHeadline({},gravity),'READING UNAVAILABLE');
  assert.equal(displayHeadline({rigidGravity:{x:1,y:-4,z:0}},gravity),
    'g (1, -4, 0) m/s²');
});

test('in-world board texture refreshes from changed world state with bounded repaint rate',()=>{
  const drawn=[];
  const context={fillRect(){},strokeRect(){},fillText(value){drawn.push({text:String(value),font:this.font});},
    measureText(value){return {width:String(value).length*15};}};
  const board={canvas:{getContext:()=>context},texture:{needsUpdate:false},
    lastSignature:'',lastUpdated:-Infinity};
  const display={...base,binding:{kind:'gravity'}};
  const view=Object.create(MatrixView.prototype);
  view.world={scene:{objects:[{objectId:'board-1',display}]},
    rigidGravity:{x:0,y:-9.81,z:0}};
  view.objectRoots=new Map([['board-1',{userData:{displayBoard:board}}]]);
  view.refreshDisplays(false,1000);
  assert.equal(board.texture.needsUpdate,true);
  assert.ok(drawn.some(item=>item.text==='-9.81 m/s²'&&item.font==='bold 120px sans-serif'));
  assert.ok(drawn.some(item=>item.text.includes('Gravity: (0.00, -9.81, 0.00)')));
  view.world.rigidGravity.y=-4.9;drawn.length=0;
  view.refreshDisplays(false,1100);
  assert.equal(drawn.length,0);
  view.refreshDisplays(false,1300);
  assert.ok(drawn.some(item=>item.text==='-4.9 m/s²'&&item.font==='bold 120px sans-serif'));
});
