import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld,RIGID_FLOOR_ID} from '../src/protocol.js';
import {createRigidPhysics} from '../src/physics_rigid.js';

const pose=(x,z)=>({position:{x,y:3,z},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
const dynamic={schemaVersion:1,type:'dynamic',collider:'bounds-box',
  restitution:0,friction:.8,sensor:false};

test('one reserved collider covers the rendered virtual floor out to ±100 m',async()=>{
  let sequence=0;
  const world=new MatrixWorld(()=>`edge-body-${++sequence}`);
  world.attachRigidPhysics(await createRigidPhysics());
  const objects=[];
  for(const [x,z] of [[80,0],[-80,0],[0,80],[0,-80]]){
    const spawned=world.execute({requestId:`edge-spawn-${++sequence}`,op:'spawn',
      assetId:'orb',anchorId:'web-floor',transform:pose(x,z)});
    assert.equal(spawned.ok,true,spawned.error);
    const configured=world.execute({requestId:`edge-body-${++sequence}`,
      op:'set_rigid_body',objectId:spawned.objectId,rigidBody:dynamic});
    assert.equal(configured.ok,true,configured.error);
    objects.push(spawned.objectId);
  }
  const before=world.rigidPhysics.snapshot();
  assert.equal(before.bodies.length,objects.length+1,
    'the floor takes one slot rather than an incomplete tile grid');
  assert.deepEqual(before.bodies.filter(item=>item.objectId===RIGID_FLOOR_ID)
    .map(item=>item.bounds.size.x),[200]);
  world.rigidPhysics.restore(before);
  const contacts=[];
  for(let tick=0;tick<150;tick++)contacts.push(...world.advanceRigidPhysics(1/60));
  for(const objectId of objects){
    assert.ok(contacts.some(item=>item.started&&
      [item.objectIdA,item.objectIdB].includes(RIGID_FLOOR_ID)&&
      [item.objectIdA,item.objectIdB].includes(objectId)),
    `${objectId} reaches the virtual floor collider`);
    assert.ok(world.rigidPhysics.state(objectId).position.y>-.1,
      `${objectId} stays above the rendered floor`);
  }
  world.rigidPhysics.dispose();
});

test('authored worlds cannot claim the reserved floor ID or a 200 m collider',async()=>{
  const world=new MatrixWorld(()=>RIGID_FLOOR_ID);
  const attempted=world.execute({requestId:'reserved-spawn',op:'spawn',assetId:'orb',
    anchorId:'web-floor',transform:pose(0,0)});
  assert.equal(attempted.ok,false);
  assert.equal(world.scene.objects.length,0);
  assert.throws(()=>world.validateScene({...world.scene,objects:[{
    objectId:RIGID_FLOOR_ID,assetId:'orb',anchorId:'web-floor',transform:pose(0,0)}]}),
  /Invalid scene object/);
  const physics=await createRigidPhysics();
  assert.throws(()=>physics.addBody({objectId:'authored-oversized',type:'static',
    position:{x:0,y:0,z:0},bounds:{center:{x:0,y:0,z:0},
      size:{x:200,y:.12,z:200}}}),/Rigid collider/);
  physics.dispose();
});
