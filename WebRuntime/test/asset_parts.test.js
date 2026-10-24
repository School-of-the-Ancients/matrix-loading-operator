import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {validParts,partPosition,partForHit,selectedPart} from '../src/asset_parts.js';
import {professorAttention} from '../src/professor_attention.js';
import {updateControllerRayForPanel} from '../src/view.js';
import {ProfessorConversation} from '../src/professor_conversation.js';

const part={partId:'canvas',label:'Canvas',description:'Illustrative sail.',provenance:'authored',nodeIndex:17,primitiveIndex:2};
test('part targets follow an animated submesh through moved and rotated exhibit roots',()=>{
  const root=new THREE.Group(),node=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));
  root.add(node);node.add(mesh);node.userData.matrixNodeIndex=17;mesh.userData.matrixPrimitiveIndex=2;
  mesh.position.set(1,0,0);root.position.set(4,2,1);root.rotation.y=Math.PI/2;
  const first=partPosition(root,part);assert(first.distanceTo(new THREE.Vector3(4,2,0))<1e-8);
  node.rotation.y=Math.PI/2;const rotated=partPosition(root,part);assert(rotated.distanceTo(new THREE.Vector3(3,2,1))<1e-8);
  assert.equal(partForHit({object:mesh},{parts:[{...part,partId:'rotor',primitiveIndex:undefined,provenance:'node-name'},part]}).partId,'canvas');
  assert.equal(partPosition(root,{...part,primitiveIndex:8}),null);
  mesh.visible=false;assert.equal(partPosition(root,part),null);
});
test('part metadata is bounded and stale cues cannot silently fall back to whole-object pointing',()=>{
  assert(validParts([part]));assert(!validParts([{...part,nodeIndex:-1}]));assert(!validParts([{...part,localPoint:{x:NaN,y:0,z:0}}]));
  const asset={assetId:'asset',parts:[part],partsRevision:'a'.repeat(64)};
  const object={objectId:'object',assetId:'asset'},scene={roomId:'room',objects:[object,{professor:{schoolSessionId:'lesson'}}]};
  const context={scene,runtimeId:'runtime',sessionId:'lesson',asset:()=>asset};
  const cue={kind:'point',objectId:'object',assetId:'asset',runtimeId:'runtime',roomId:'room',partId:'canvas',partsRevision:asset.partsRevision};
  assert.equal(professorAttention(cue,context),object);
  assert.equal(professorAttention({...cue,partId:'missing'},context),null);
  assert.equal(professorAttention({...cue,partsRevision:'old'},context),null);
  const world={scene,selection:{objectId:'object'},asset:()=>asset,partSelection:{objectId:'object',assetId:'asset',partId:'canvas',partsRevision:asset.partsRevision}};
  assert.equal(selectedPart(world).partId,'canvas');asset.partsRevision='b'.repeat(64);assert.equal(selectedPart(world),null);
});
test('controller pointer stops on virtual model surfaces as well as the Operator panel',()=>{
  const controller=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));mesh.position.z=-2;
  const ray={userData:{},scale:{z:1},material:{depthTest:true}},panel={group:{visible:false},mesh:new THREE.Mesh(new THREE.PlaneGeometry(1,1))};
  const hit=updateControllerRayForPanel(ray,controller,panel,[mesh]);
  assert.equal(hit.object,mesh);assert(Math.abs(hit.distance-1.5)<1e-8);assert(Math.abs(ray.scale.z-.375)<1e-8);
  panel.group.visible=true;panel.mesh.position.z=-1;panel.mesh.renderOrder=5;
  const panelHit=updateControllerRayForPanel(ray,controller,panel,[mesh]);
  assert.equal(panelHit.object,panel.mesh);assert.equal(ray.material.depthTest,false);
});
test('the students named-part reference stays with the utterance after another part is selected',async()=>{
  let selection={objectId:'object',assetId:'asset',partId:'canvas',partsRevision:'a'.repeat(64)},record;
  const conversation=new ProfessorConversation({request:async(path,body)=>{if(body?.event)record=body.event;return {id:'lesson',mentor:{name:'Leonardo'}};},pointedPart:()=>structuredClone(selection)});
  await conversation.activate('lesson');const capture=conversation.capture();selection.partId='shaft';
  await conversation.recordInput('This is the canvas.',capture,'voice');assert.equal(record.partReference.partId,'canvas');
});
