import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {surfaceFromHit,surfacePosition,selectedSurface} from '../src/surface_selection.js';
import {MatrixView} from '../src/view.js';
import {ProfessorConversation} from '../src/professor_conversation.js';

test('an unnamed mesh pins the exact hit and follows its animation and root transform',()=>{
  const root=new THREE.Group(),node=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry());
  root.add(node);node.add(mesh);node.userData.matrixNodeIndex=4;mesh.userData.matrixPrimitiveIndex=0;
  root.position.set(3,0,-2);mesh.position.set(0,1,0);root.updateMatrixWorld(true);
  const point=mesh.localToWorld(new THREE.Vector3(.2,.1,.5));
  const object={objectId:'object',assetId:'asset'},surface=surfaceFromHit({object:mesh,point},root,object);
  assert(surfacePosition(root,surface).distanceTo(point)<1e-8);
  node.rotation.y=Math.PI/2;root.position.x+=2;root.updateMatrixWorld(true);
  assert(surfacePosition(root,surface).distanceTo(mesh.localToWorld(new THREE.Vector3(.2,.1,.5)))<1e-8);
  const world={scene:{objects:[object]},surfaceSelection:surface};assert(selectedSurface(world));
  world.scene.objects=[];assert.equal(selectedSurface(world),null);
});

test('A/X selects a point on a procedural object without named parts and B/Y clears it',()=>{
  const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry());root.add(mesh);root.position.z=-2;root.userData.objectId='object';
  const object={objectId:'object',assetId:'block'},source={gamepad:{mapping:'xr-standard',buttons:Array.from({length:6},()=>({pressed:false}))}};
  const controller=new THREE.Group();controller.userData.inputSource=source;
  const view=Object.create(MatrixView.prototype);
  Object.assign(view,{world:{scene:{objects:[object]},asset:()=>({})},controllers:[controller],controllerRays:[{userData:{},scale:{z:1},material:{}}],
    renderer:{xr:{getSession:()=>({inputSources:[source]})}},objectRoots:new Map([['object',root]]),operatorPanel:{group:{visible:false},mesh:new THREE.Mesh()}});
  source.gamepad.buttons[4].pressed=true;view.updatePartSelectionButtons();
  const surface=selectedSurface(view.world);assert(surface);assert.equal(surface.nodeIndex,null);
  assert(surfacePosition(root,surface).distanceTo(new THREE.Vector3(0,0,-1.5))<1e-8);
  assert.equal(view.world.partSelection,null);
  source.gamepad.buttons[5].pressed=true;view.updatePartSelectionButtons();assert.equal(selectedSurface(view.world),null);
});

test('the image is sent with its captured utterance but never stored inside transcript events',async()=>{
  const calls=[],surface={selectionId:crypto.randomUUID(),objectId:'object',assetId:'asset',nodeIndex:null,primitiveIndex:null,localPoint:{x:0,y:0,z:0}};
  const image={selectionId:surface.selectionId,mimeType:'image/jpeg',width:1,height:1,dataBase64:'test-data'};
  const conversation=new ProfessorConversation({observation:()=>({surfaceReference:structuredClone(surface),visual:image}),
    request:async(path,body)=>{calls.push({path,body});return {id:'lesson',revision:1,mentor:{name:'Leonardo'},conversation:{events:[]}};}});
  await conversation.activate('lesson');const capture=conversation.capture();surface.localPoint.x=1;
  await conversation.ask('What is this?',capture,'voice');
  const event=calls.find(c=>c.body?.event).body.event;
  assert.equal(event.surfaceReference.localPoint.x,0);assert.equal(event.visual,undefined);
  assert.equal(calls.find(c=>c.path.endsWith('/spoken-message')).body.visual,image);
});
