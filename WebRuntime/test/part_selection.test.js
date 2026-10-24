import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixView} from '../src/view.js';
import {selectedPart} from '../src/asset_parts.js';
import {ProfessorConversation} from '../src/professor_conversation.js';

function setup(){
  const parts=['canvas','shaft'].map((partId,nodeIndex)=>({partId,nodeIndex,label:partId,description:'',provenance:'authored'}));
  const asset={assetId:'exhibit',parts,partsRevision:'a'.repeat(64)};
  const object={objectId:'object',assetId:asset.assetId,transform:{position:{x:0,y:0,z:-2}},anchorId:'web-floor'};
  const root=new THREE.Group();root.userData.objectId=object.objectId;
  for(const part of parts){const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5));
    mesh.userData.matrixNodeIndex=part.nodeIndex;mesh.position.set(part.nodeIndex,0,-2);root.add(mesh);}
  const source={gamepad:{mapping:'xr-standard',buttons:Array.from({length:6},()=>({pressed:false}))}};
  const controller=new THREE.Group();controller.userData.inputSource=source;
  const view=Object.create(MatrixView.prototype);
  Object.assign(view,{world:{scene:{roomId:'room',objects:[object]},selection:{objectId:'editing-something-else'},
    asset:()=>asset,requireObject:()=>object,setSelection(id){this.selection.objectId=id;}},
    controllers:[controller],controllerRays:[{userData:{},scale:{z:1},material:{}}],
    objectRoots:new Map([[object.objectId,root]]),renderer:{xr:{getSession:()=>({inputSources:[source]})}},
    operatorPanel:{group:{visible:false},mesh:new THREE.Mesh()},raycaster:new THREE.Raycaster(),
    highlight(){},onSelection(){}});
  return {view,source,controller,asset};
}

test('A/X pins only on a button edge; moving the pointer and grabbing do not retarget speech',async()=>{
  const {view,source,controller}=setup();const worldBefore=JSON.stringify(view.world.scene);
  view.hoveredPart={partId:'shaft'};view.updatePartSelectionButtons();
  assert.equal(selectedPart(view.world),null,'hover alone does not select');
  source.gamepad.buttons[4].pressed=true;view.updatePartSelectionButtons();
  assert.equal(selectedPart(view.world).partId,'canvas');
  assert.equal(view.world.selection.objectId,'editing-something-else','teaching selection does not change edit selection');
  controller.position.x=1;view.hoveredPart={partId:'shaft'};view.updatePartSelectionButtons();
  assert.equal(selectedPart(view.world).partId,'canvas','held button cannot choose the next part');
  view.raycaster.set(new THREE.Vector3(1,0,0),new THREE.Vector3(0,0,-1));view.selectFromRay();
  assert.equal(selectedPart(view.world).partId,'canvas','ordinary trigger/edit selection does not rewrite the pin');
  let recorded;
  const conversation=new ProfessorConversation({pointedPart:()=>structuredClone(selectedPart(view.world)),
    request:async(path,body)=>{if(body?.event)recorded=body.event;return {id:'lesson',mentor:{name:'Leonardo'}};}});
  await conversation.activate('lesson');const capture=conversation.capture();
  source.gamepad.buttons[4].pressed=false;view.updatePartSelectionButtons();
  source.gamepad.buttons[4].pressed=true;view.updatePartSelectionButtons();
  assert.equal(selectedPart(view.world).partId,'shaft');
  await conversation.recordInput('This is the canvas.',capture,'voice');
  assert.equal(recorded.partReference.partId,'canvas','an in-flight utterance keeps its captured explicit selection');
  assert.equal(JSON.stringify(view.world.scene),worldBefore,'A/X never moves the exhibit or changes its clip');
  source.gamepad.buttons[5].pressed=true;view.updatePartSelectionButtons();
  assert.equal(selectedPart(view.world),null);
});

test('part buttons ignore overlays and grabs without replaying a held press on return',()=>{
  const {view,source}=setup();view.professorOpen=true;source.gamepad.buttons[4].pressed=true;
  view.updatePartSelectionButtons();view.professorOpen=false;view.updatePartSelectionButtons();
  assert.equal(selectedPart(view.world),null);
  source.gamepad.buttons[4].pressed=false;view.updatePartSelectionButtons();
  view.grab={};source.gamepad.buttons[4].pressed=true;view.updatePartSelectionButtons();
  view.grab=null;view.updatePartSelectionButtons();assert.equal(selectedPart(view.world),null);
  source.gamepad.buttons[4].pressed=false;view.updatePartSelectionButtons();
  source.gamepad.buttons[4].pressed=true;view.updatePartSelectionButtons();assert(selectedPart(view.world));
  view.world.scene.objects=[];assert.equal(selectedPart(view.world),null,'removed targets invalidate the pin');
});

test('the pressed hands ray wins even when the other hand previews a different part',()=>{
  const {view,source,controller}=setup();
  const other=new THREE.Group();other.position.x=1;
  const otherSource={gamepad:{mapping:'xr-standard',buttons:Array.from({length:6},()=>({pressed:false}))}};
  other.userData.inputSource=otherSource;
  view.controllers=[other,controller];view.controllerRays.unshift({userData:{},scale:{z:1},material:{}});
  view.renderer.xr.getSession=()=>({inputSources:[otherSource,source]});
  view.hoveredPart={partId:'shaft'};source.gamepad.buttons[4].pressed=true;
  view.updatePartSelectionButtons();assert.equal(selectedPart(view.world).partId,'canvas');
  source.gamepad.buttons[4].pressed=false;view.updatePartSelectionButtons();
  otherSource.gamepad.buttons[4].pressed=true;view.updatePartSelectionButtons();
  assert.equal(selectedPart(view.world).partId,'shaft');
});
