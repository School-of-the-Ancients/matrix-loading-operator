import test from 'node:test';
import assert from 'node:assert/strict';
import {displayObservation,validDisplay} from '../src/display.js';
import {MatrixView} from '../src/view.js';

const base={schemaVersion:1,title:'Results',body:'Move the objects, then inspect the outcome.',binding:null};

test('display schema accepts data bindings and rejects executable or malformed fields',()=>{
  for(const binding of [null,{kind:'game-progress'},{kind:'gravity'},
    {kind:'rigid-body',objectId:'orb-1'}])assert.equal(validDisplay({...base,binding}),true);
  for(const display of [{...base,script:'alert(1)'},
    {...base,binding:{kind:'game-progress',script:'alert(1)'}},
    {...base,binding:{kind:'rigid-body',objectId:''}},
    {...base,title:'\u0000bad'}])assert.equal(validDisplay(display),false);
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
  world.game.state={phase:'won',score:1,deliveries:['orb-1'],objectiveProgress:{items:1},
    creditedEvents:[{eventId:'sensor-1',event:'sensor-enter',objectId:'orb-1',
      targetObjectId:'zone-1',scorePoints:1}],unlockedObjectIds:['exit-1']};
  assert.match(displayObservation(world,display).text,/Exit unlocked/);
});

test('same display mechanism reads gravity and current or unavailable body state',()=>{
  const body={objectId:'orb-1',rigidBody:{type:'dynamic'}};
  const world={scene:{objects:[body]},rigidGravity:{x:0,y:-4.9,z:0},
    creatorMode:{simulation:'paused'},rigidPhysics:{state:()=>({type:'dynamic',held:false,
      position:{x:0,y:1,z:0},linearVelocity:{x:0,y:-2,z:0}})}};
  assert.match(displayObservation(world,{...base,binding:{kind:'gravity'}}).text,/-4.90/);
  const display={...base,binding:{kind:'rigid-body',objectId:'orb-1'}};
  assert.match(displayObservation(world,display).text,/Paused snapshot.*2.00 m\/s/);
  world.rigidPhysics=null;
  assert.equal(displayObservation(world,display).status,'unavailable');
});

test('in-world board texture refreshes from changed world state with bounded repaint rate',()=>{
  const drawn=[];
  const context={fillRect(){},strokeRect(){},fillText(value){drawn.push(String(value));},
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
  assert.ok(drawn.some(text=>text.includes('-9.81')));
  view.world.rigidGravity.y=-4.9;drawn.length=0;
  view.refreshDisplays(false,1100);
  assert.equal(drawn.length,0);
  view.refreshDisplays(false,1300);
  assert.ok(drawn.some(text=>text.includes('-4.90')));
});
