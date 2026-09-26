import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixView,updateControllerRayForPanel} from '../src/view.js';

function controllerAndPanel(){
  const scene=new THREE.Scene();
  const controller=new THREE.Group();controller.position.y=1;scene.add(controller);
  const ray=new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),new THREE.Vector3(0,0,-4)]),new THREE.LineBasicMaterial({transparent:true,depthTest:true}));
  controller.add(ray);
  const group=new THREE.Group();scene.add(group);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
    new THREE.MeshBasicMaterial({side:THREE.DoubleSide,transparent:true,depthTest:false}));
  mesh.position.set(0,1,-1);mesh.renderOrder=100;group.add(mesh);
  return {controller,ray,panel:{group,mesh}};
}

test('controller ray ends on the Operator panel and remains visible over it',()=>{
  const {controller,ray,panel}=controllerAndPanel();
  updateControllerRayForPanel(ray,controller,panel);
  assert.ok(Math.abs(ray.scale.z-.25)<1e-6);
  assert.equal(ray.renderOrder,101);
  assert.equal(ray.material.depthTest,false);
  controller.rotation.y=Math.PI/2;
  updateControllerRayForPanel(ray,controller,panel);
  assert.equal(ray.scale.z,1);
  assert.equal(ray.renderOrder,0);
  assert.equal(ray.material.depthTest,true);
  controller.rotation.y=0;panel.group.visible=false;
  updateControllerRayForPanel(ray,controller,panel);
  assert.equal(ray.scale.z,1);
});

test('thumbstick click recalls a pinned Operator, then hides and shows it once per press',()=>{
  const view=Object.create(MatrixView.prototype);
  const buttons=Array.from({length:4},()=>({pressed:false}));
  const session={inputSources:[{gamepad:{mapping:'xr-standard',buttons}}]};
  view.renderer={xr:{getSession:()=>session}};
  const labels=[];
  view.operatorPanel={group:{visible:true},setPinLabel:label=>labels.push(label)};
  view.operatorMount={kind:'world'};view.operatorThumbstickHeld=false;view.isAR=false;
  let positioned=0;view.positionOperatorPanel=()=>positioned++;

  const press=()=>{buttons[3].pressed=true;view.updateOperatorShortcut();};
  const release=()=>{buttons[3].pressed=false;view.updateOperatorShortcut();};
  press();
  assert.equal(view.operatorPanel.group.visible,true);
  assert.equal(view.operatorMount.kind,'head');
  assert.equal(labels.at(-1),'PIN HERE');
  assert.equal(positioned,1);
  view.updateOperatorShortcut();
  assert.equal(view.operatorPanel.group.visible,true,'holding the button does not hide the recalled panel');
  release();press();
  assert.equal(view.operatorPanel.group.visible,false);
  release();press();
  assert.equal(view.operatorPanel.group.visible,true);
  assert.equal(view.operatorMount.kind,'head');
  assert.equal(positioned,2);
});

test('unsupported XR inputs do not accidentally toggle the Operator',()=>{
  const view=Object.create(MatrixView.prototype);
  const pressed={pressed:true};
  const session={inputSources:[{gamepad:{mapping:'',buttons:[null,null,null,pressed]}}]};
  view.renderer={xr:{getSession:()=>session}};
  view.operatorPanel={group:{visible:true}};view.operatorMount={kind:'head'};
  view.operatorThumbstickHeld=false;
  view.updateOperatorShortcut();
  assert.equal(view.operatorPanel.group.visible,true);
  assert.equal(view.operatorThumbstickHeld,false);
});

test('the in-world HIDE control clears the panel without selecting the scene',()=>{
  const {controller,panel}=controllerAndPanel();
  panel.mesh.updateWorldMatrix(true,false);
  const view=Object.create(MatrixView.prototype);
  view.grab=null;view.raycaster=new THREE.Raycaster();
  view.operatorPanel={...panel,hit:()=> 'hide-panel'};
  view.selectFromRay=()=>{throw Error('The panel action must not select the scene');};
  view.onPanelAction=()=>{throw Error('HIDE must stay a local panel action');};
  view.selectFromController(controller);
  assert.equal(view.operatorPanel.group.visible,false);
});

function selectableFirefly(){
  const scene=new THREE.Scene();
  const controller=new THREE.Group();controller.position.set(0,1,0);scene.add(controller);
  const root=new THREE.Group();root.position.set(0,1,-2);root.userData.objectId='firefly-1';
  root.add(new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5)));scene.add(root);
  scene.updateMatrixWorld(true);
  const object={objectId:'firefly-1',anchorId:'web-floor',
    transform:{position:{x:0,y:1,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}},
    animation:{loopClip:'Hover',selectClip:'Glow'}};
  let glowCount=0;
  root.userData.selectAnimation=()=>glowCount++;
  const view=Object.create(MatrixView.prototype);
  view.grab=null;view.pointerGrab=null;view.raycaster=new THREE.Raycaster();
  view.operatorPanel={group:{visible:false}};
  view.objectRoots=new Map([[object.objectId,root]]);
  view.world={spatial:{stale:false,originUnavailable:false},requireObject:()=>object,setSelection(){}};
  view.highlight=()=>{};view.onSelection=()=>{};view.onAssetError=()=>{};
  return {view,controller,root,glowCount:()=>glowCount};
}

test('XR select animates a Firefly and starts a grab on the same press',()=>{
  const {view,controller,glowCount}=selectableFirefly();
  let committed=null;
  view.commitMove=(objectId,transform)=>{committed={objectId,transform};};
  view.selectFromController(controller);
  assert.equal(glowCount(),1);
  assert.equal(view.grab?.objectId,'firefly-1');
  assert.equal(view.grab?.controller,controller);
  controller.position.x=.5;
  view.releaseGrab(controller);
  assert.equal(view.grab,null);
  assert.equal(committed?.objectId,'firefly-1');
  assert.equal(committed?.transform.position.x,.5);
});

test('desktop click animates a Firefly and starts a pointer drag',()=>{
  const {view,root,glowCount}=selectableFirefly();
  view.renderer={xr:{isPresenting:false},domElement:{setPointerCapture(){}}};
  view.rayFromPointer=()=>view.raycaster.set(new THREE.Vector3(0,1.5,0),
    new THREE.Vector3(0,-.25,-1).normalize());
  view.pointerDown({button:0,pointerId:1,clientY:200});
  assert.equal(glowCount(),1);
  assert.equal(view.pointerGrab?.root,root);
});
