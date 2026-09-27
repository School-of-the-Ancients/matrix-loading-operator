import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {createRigidPhysics} from '../src/physics_rigid.js';
import {transitionCreatorMode} from '../src/creator_mode.js';
import {createPlayPersistence,PLAY_SAVE_INTERVAL_MS} from '../src/play_persistence.js';
import {loadStoredWorld,restoreStoredWorld} from '../src/scene_store.js';

const pose=(x,y,z=0)=>({position:{x,y,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
const storage=()=>{
  const values=new Map();let writes=0;
  return {getItem:key=>values.get(key)??null,
    setItem:(key,value)=>{writes++;values.set(key,value);},
    removeItem:key=>values.delete(key),get writes(){return writes;}};
};
async function dynamicWorld(y=2){
  const world=new MatrixWorld(()=> 'saved-block');
  world.attachRigidPhysics(await createRigidPhysics());
  const spawn=world.execute({requestId:'spawn',op:'spawn',assetId:'block',
    anchorId:'web-floor',transform:pose(0,y)});
  assert.equal(spawn.ok,true,spawn.error);
  const body=world.execute({requestId:'body',op:'set_rigid_body',
    objectId:spawn.objectId,rigidBody:{schemaVersion:1,type:'dynamic',
      collider:'bounds-box',restitution:0,friction:.8,sensor:false}});
  assert.equal(body.ok,true,body.error);
  return world;
}

test('a non-scoring Play release is saved and reopens at its released pose',async()=>{
  const current=await dynamicWorld(.5),tab=storage(),durable=storage();
  let time=0,allowed=true;
  const persistence=createPlayPersistence(current,tab,durable,
    {now:()=>time,canSave:()=>allowed});
  assert.deepEqual(persistence.persist(),{attempted:true,warning:''});
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-play',0);
  assert.equal(current.beginRigidGrab('saved-block'),true);
  current.moveRigidGrab('saved-block',pose(2,.5));
  assert.equal(current.releaseRigidGrab('saved-block').held,false);
  time=100;
  assert.deepEqual(persistence.persist(),{attempted:true,warning:''});
  const recovered=new MatrixWorld(()=> 'different-id');
  restoreStoredWorld(recovered,loadStoredWorld(tab,durable).value);
  assert.equal(recovered.requireObject('saved-block').transform.position.x,2);
  assert.equal(recovered.creatorMode.mode,'play');
  allowed=false;
  current.beginRigidGrab('saved-block');
  current.moveRigidGrab('saved-block',pose(3,.5));
  current.releaseRigidGrab('saved-block');
  assert.equal(persistence.persist().attempted,false,
    'a staged PC restore must keep the previous browser copy');
  assert.equal(loadStoredWorld(tab,durable).value.scene.objects[0].transform.position.x,2);
  current.rigidPhysics.dispose();
});

test('passive rigid motion saves on a bounded Play interval and skips unchanged states',async()=>{
  const current=await dynamicWorld(),tab=storage(),durable=storage();
  let time=0;
  const persistence=createPlayPersistence(current,tab,durable,{now:()=>time});
  persistence.persist();
  current.creatorMode=transitionCreatorMode(current.creatorMode,'enter-play',0);
  for(let tick=0;tick<30;tick++)current.advanceRigidPhysics(1/60);
  const liveY=current.requireObject('saved-block').transform.position.y;
  assert.ok(liveY<2);
  time=PLAY_SAVE_INTERVAL_MS-1;
  assert.equal(persistence.persist({periodic:true}).attempted,false);
  assert.equal(loadStoredWorld(tab,durable).value.scene.objects[0].transform.position.y,2);
  time=PLAY_SAVE_INTERVAL_MS;
  assert.deepEqual(persistence.persist({periodic:true}),{attempted:true,warning:''});
  assert.equal(loadStoredWorld(tab,durable).value.scene.objects[0].transform.position.y,liveY);
  const writes=durable.writes;
  time+=PLAY_SAVE_INTERVAL_MS;
  assert.equal(persistence.persist({periodic:true}).attempted,false);
  assert.equal(durable.writes,writes,'unchanged settled state should not rewrite storage');
  current.rigidPhysics.dispose();
});
