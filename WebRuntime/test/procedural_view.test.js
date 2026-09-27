import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {MatrixWorld} from '../src/protocol.js';
import {PROCEDURAL_BUDGET,createProceduralRecipe,generateProcedural,
  reviseProceduralRecipe} from '../src/procedural.js';
import {makeProcedural,MatrixView} from '../src/view.js';

test('reviewed procedural parts become indexed, lit and selectable Three.js meshes',()=>{
  const group=makeProcedural(createProceduralRecipe('curved-bench'));
  assert.ok(group.children.length>=2);
  for(const mesh of group.children){
    assert.ok(mesh.isMesh);
    assert.ok(mesh.userData.partId);
    assert.ok(mesh.geometry.index.count>=3);
    assert.ok(mesh.geometry.getAttribute('normal').count>0);
    assert.equal(mesh.castShadow,true);
    mesh.geometry.dispose();mesh.material.dispose();
  }
});

const pose=x=>({position:{x,y:0,z:0},rotation:{x:0,y:0,z:0},
  scale:{x:1,y:1,z:1}});
const command=(world,requestId,op,data)=>{
  const receipt=world.execute({requestId,op,...data});
  assert.equal(receipt.ok,true,receipt.error);
  return receipt;
};
const meshes=root=>root.userData.visual.children.filter(child=>child.isMesh);

test('revising one procedural instance keeps another instance meshes and materials live',()=>{
  let nextId=0;
  const world=new MatrixWorld(()=>`procedural-${++nextId}`);
  let edited=createProceduralRecipe('curved-bench',{lengthMeters:1.8});
  const other=createProceduralRecipe('curved-bench',{lengthMeters:2.4},7);
  const editedId=command(world,'create-a','create_procedural',{
    anchorId:'web-floor',transform:pose(0),procedural:edited}).objectId;
  const otherId=command(world,'create-b','create_procedural',{
    anchorId:'web-floor',transform:pose(4),procedural:other}).objectId;
  const view=Object.create(MatrixView.prototype);
  view.world=world;view.scene=new THREE.Scene();
  view.virtualFloorRoot=new THREE.Group();view.scene.add(view.virtualFloorRoot);
  view.objectRoots=new Map();view.anchorRoots=new Map();view.isAR=false;
  view.highlight=()=>{};
  view.sync();
  const otherRoot=view.objectRoots.get(otherId);
  const otherMeshes=meshes(otherRoot);
  const otherPositions=otherMeshes.map(mesh=>Array.from(
    mesh.geometry.getAttribute('position').array));
  const otherColors=otherMeshes.map(mesh=>mesh.material.color.getHex());
  let disposedGeometry=0,disposedMaterial=0;
  for(const mesh of otherMeshes){
    mesh.geometry.addEventListener('dispose',()=>disposedGeometry++);
    mesh.material.addEventListener('dispose',()=>disposedMaterial++);
  }
  for(let step=0;step<8;step++){
    const previousRoot=view.objectRoots.get(editedId);
    const previousMeshes=meshes(previousRoot);
    let oldGeometryDisposed=0,oldMaterialDisposed=0;
    for(const mesh of previousMeshes){
      mesh.geometry.addEventListener('dispose',()=>oldGeometryDisposed++);
      mesh.material.addEventListener('dispose',()=>oldMaterialDisposed++);
    }
    const revised=reviseProceduralRecipe(edited,{
      lengthMeters:step%2===0?2.2:1.8,arcDegrees:step%2===0?90:75});
    command(world,`revise-${step}`,'update_procedural',{
      objectId:editedId,expectedProcedural:edited,procedural:revised,
      expectedTransform:pose(0)});
    view.sync();
    assert.ok(view.objectRoots.get(otherId)===otherRoot,
      'an unrelated procedural root should be reused');
    assert.equal(disposedGeometry,0,'the other instance geometry stays live');
    assert.equal(disposedMaterial,0,'the other instance material stays live');
    assert.ok(meshes(otherRoot).every((mesh,index)=>mesh===otherMeshes[index]));
    assert.deepEqual(otherMeshes.map(mesh=>Array.from(
      mesh.geometry.getAttribute('position').array)),otherPositions);
    assert.deepEqual(otherMeshes.map(mesh=>mesh.material.color.getHex()),otherColors);
    assert.equal(oldGeometryDisposed,previousMeshes.length,
      'the edited instance old geometries are released');
    assert.equal(oldMaterialDisposed,previousMeshes.length,
      'the edited instance old materials are released');
    assert.notEqual(view.objectRoots.get(editedId),previousRoot);
    assert.ok(meshes(view.objectRoots.get(editedId)).every(mesh=>
      !previousMeshes.includes(mesh)));
    edited=revised;
  }
});

test('fixed procedural regeneration sample reports geometry budgets and timing',t=>{
  const samples=[
    ['curved bench',createProceduralRecipe('curved-bench',{lengthMeters:2.2,arcDegrees:90})],
    ['sloped bridge',createProceduralRecipe('bridge',{
      lengthMeters:8,widthMeters:2,riseMeters:1})]
  ];
  for(const [name,recipe] of samples){
    const measured=generateProcedural(recipe);
    for(const [key,limit] of Object.entries(PROCEDURAL_BUDGET))
      assert.ok(measured.budget[key]<=limit,`${name} exceeds ${key} budget`);
    const durations=[];
    for(let run=0;run<32;run++){
      const start=performance.now();
      const group=makeProcedural(recipe);
      const elapsed=performance.now()-start;
      if(run>=4)durations.push(elapsed);
      assert.equal(group.children.length,measured.budget.parts);
      for(const mesh of group.children){mesh.geometry.dispose();mesh.material.dispose();}
    }
    durations.sort((a,b)=>a-b);
    assert.equal(durations.length,28);
    assert.ok(durations.every(value=>Number.isFinite(value)&&value>=0));
    const median=(durations[13]+durations[14])/2;
    const p95=durations[Math.ceil(durations.length*.95)-1];
    t.diagnostic(`${name}: ${JSON.stringify(measured.budget)}; `+
      `28 measured regenerations; median ${median.toFixed(3)} ms, `+
      `p95 ${p95.toFixed(3)} ms`);
  }
});
