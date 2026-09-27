import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {createProceduralRecipe,generateProcedural,
  reviseProceduralRecipe} from '../src/procedural.js';
import {createRigidPhysics} from '../src/physics_rigid.js';
import {restoreStoredWorld,storedWorld} from '../src/scene_store.js';

const pose=x=>({position:{x,y:0,z:0},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
const execute=(world,requestId,op,data={})=>{
  const receipt=world.execute({requestId,op,...data});
  assert.equal(receipt.ok,true,receipt.error);
  return receipt;
};

test('staircase edits keep object IDs, independent recipes and saved source',()=>{
  let nextId=0;
  const world=new MatrixWorld(()=>`staircase-${++nextId}`);
  const firstRecipe=createProceduralRecipe('staircase');
  const otherRecipe=createProceduralRecipe('staircase',{stepCount:4,widthMeters:2},7);
  const firstId=execute(world,'create-first','create_procedural',{
    anchorId:'web-floor',transform:pose(0),procedural:firstRecipe}).objectId;
  const otherId=execute(world,'create-other','create_procedural',{
    anchorId:'web-floor',transform:pose(4),procedural:otherRecipe}).objectId;
  const wider=reviseProceduralRecipe(firstRecipe,
    {stepCount:8,widthMeters:1.8,treadDepthMeters:.4});
  execute(world,'revise-first','update_procedural',{objectId:firstId,
    expectedProcedural:firstRecipe,expectedTransform:pose(0),procedural:wider});
  assert.equal(world.requireObject(firstId).objectId,firstId);
  assert.deepEqual(world.requireObject(otherId).procedural,otherRecipe);
  const before=structuredClone(world.scene),history=world.undo.length;
  const fractional=world.execute({requestId:'invalid-steps',op:'update_procedural',
    objectId:firstId,expectedProcedural:wider,expectedTransform:pose(0),
    procedural:{...wider,parameters:{...wider.parameters,stepCount:5.5}}});
  assert.equal(fractional.ok,false);
  assert.match(fractional.error,/Invalid procedural parameter/);
  assert.deepEqual(world.scene,before);
  assert.equal(world.undo.length,history);
  execute(world,'undo-stairs','undo');
  assert.deepEqual(world.requireObject(firstId).procedural,firstRecipe);
  execute(world,'redo-stairs','redo');
  assert.deepEqual(world.requireObject(firstId).procedural,wider);
  const reopened=new MatrixWorld();
  restoreStoredWorld(reopened,storedWorld(world));
  assert.deepEqual(reopened.requireObject(firstId).procedural,wider);
  assert.deepEqual(reopened.requireObject(otherId).procedural,otherRecipe);
  assert.equal(generateProcedural(reopened.requireObject(firstId).procedural)
    .parts.map(part=>part.partId).at(-1),'step-08');
});

test('static staircase mesh contacts at actual low and high tread heights',async()=>{
  const physics=await createRigidPhysics();
  try{
    const generated=generateProcedural(createProceduralRecipe('staircase',
      {stepCount:6,treadDepthMeters:.5,stepRiseMeters:.25}));
    physics.addBody({objectId:'stairs',type:'static',
      position:{x:0,y:0,z:0},bounds:generated.localBounds,
      meshes:generated.parts.map(part=>({partId:part.partId,
        positions:part.geometry.positions,indices:part.geometry.indices}))});
    for(const [id,x] of [['low',-1.25],['high',1.25]])
      physics.addBody({objectId:id,type:'dynamic',
        position:{x,y:3.2,z:0},
        bounds:{center:{x:0,y:0,z:0},size:{x:.12,y:.12,z:.12}}});
    const firstContact=new Map();
    for(let frame=0;frame<180&&firstContact.size<2;frame++){
      for(const event of physics.step(1/60).contacts){
        if(!event.started)continue;
        const actor=event.objectIdA==='stairs'?event.objectIdB:
          event.objectIdB==='stairs'?event.objectIdA:null;
        if(actor&&!firstContact.has(actor)){
          firstContact.set(actor,{height:physics.state(actor).position.y,
            partId:event.objectIdA==='stairs'?event.partIdA:event.partIdB});
        }
      }
    }
    assert.equal(firstContact.get('low')?.partId,'step-01');
    assert.equal(firstContact.get('high')?.partId,'step-06');
    assert.ok(firstContact.get('high').height-firstContact.get('low').height>1,
      'separate tread contacts must not come from one bounds-box proxy');
  }finally{physics.dispose();}
});
