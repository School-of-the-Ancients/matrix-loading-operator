import test from 'node:test';
import assert from 'node:assert/strict';
import {createProceduralRecipe} from '../src/procedural.js';
import {makeProcedural} from '../src/view.js';

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
