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

test('click changes grab height without recalling the Operator panel',()=>{
  const view=Object.create(MatrixView.prototype);
  const buttons=Array.from({length:4},()=>({pressed:false}));
  const source={gamepad:{mapping:'xr-standard',axes:[0,0,0,-1],buttons}};
  view.renderer={xr:{getSession:()=>({inputSources:[source]}),isPresenting:true}};
  view.operatorPanel={group:{visible:false}};view.operatorMount={kind:'head'};
  view.operatorThumbstickHeld=false;view.grab={inputSource:source};view.isAR=false;
  let recalled=0;view.toggleOperatorPanel=()=>recalled++;
  buttons[3].pressed=true;view.updateOperatorShortcut();
  assert.equal(recalled,0);
  view.grab=null;view.updateOperatorShortcut();
  assert.equal(recalled,0,'release while click remains held must not open the panel');
  buttons[3].pressed=false;view.updateOperatorShortcut();
  buttons[3].pressed=true;view.updateOperatorShortcut();
  assert.equal(recalled,1,'a fresh click outside grab still recalls the panel');
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

test('only the grabbing xr-standard source moves a held object',()=>{
  const {view,controller,root}=selectableFirefly();
  const source={gamepad:{mapping:'xr-standard',axes:[0,0,1,0],buttons:[{},{},{},{pressed:false}]}};
  const session={inputSources:[source]};
  view.renderer={xr:{isPresenting:true,getSession:()=>session}};
  view.xrViewer={direction:new THREE.Vector3(0,0,-1)};
  view.hasFreshXrViewer=()=>true;
  view.selectFromController(controller,source);
  assert.equal(view.grab.inputSource,source);
  view.updateHeldGrab({},.1);
  assert.ok(Math.abs(root.position.x-.075)<1e-9);
  source.gamepad.axes=[0,0,0,-1];source.gamepad.buttons[3].pressed=true;
  view.updateHeldGrab({},.1);
  assert.ok(Math.abs(root.position.y-1.075)<1e-9);
  assert.ok(Math.abs(root.position.z+2)<1e-9);
  source.gamepad.axes=[0,0,NaN,0];
  assert.equal(view.updateGrabThumbstick({},.1),false);
  let cancelled=0,resumed=0;
  view.sync=()=>cancelled++;
  view.world.resumePhysics=()=>resumed++;
  session.inputSources=[];
  const x=root.position.x;view.updateHeldGrab({},.1);
  assert.equal(root.position.x,x);
  assert.equal(view.grab,null);
  assert.equal(cancelled,1);assert.equal(resumed,1);
});

test('tracking or AR origin loss suspends both held pose and Play rigid updates',()=>{
  const {view,controller,root}=selectableFirefly();
  const source={gamepad:{mapping:'xr-standard',axes:[0,0,1,0],buttons:[]}};
  const session={inputSources:[source]};
  view.renderer={xr:{isPresenting:true,getSession:()=>session}};
  view.xrViewer={direction:new THREE.Vector3(0,0,-1)};
  view.hasFreshXrViewer=()=>true;
  view.selectFromController(controller,source);
  let rigidMoves=0;view.moveHeldRigid=()=>rigidMoves++;
  view.updateHeldGrab({},.1);
  assert.equal(rigidMoves,1);
  const x=root.position.x;
  controller.visible=false;controller.position.x=2;
  view.updateHeldGrab({},.1);
  assert.equal(root.position.x,x);assert.equal(rigidMoves,1);
  controller.visible=true;view.world.spatial.originUnavailable=true;
  view.updateHeldGrab({},.1);
  assert.equal(root.position.x,x);assert.equal(rigidMoves,1);
  view.world.spatial.originUnavailable=false;view.world.spatial.stale=true;
  view.updateHeldGrab({},.1);
  assert.equal(root.position.x,x);assert.equal(rigidMoves,1);
});

test('release after AR origin loss discards the held edit',()=>{
  const {view,controller}=selectableFirefly();
  let resumed=0,synced=0;
  view.world.resumePhysics=()=>resumed++;
  view.sync=()=>synced++;
  view.commitMove=()=>{throw Error('A stale AR grab must not author a transform');};
  view.selectFromController(controller);
  view.world.spatial.originUnavailable=true;
  view.releaseGrab(controller);
  assert.equal(view.grab,null);
  assert.equal(resumed,1);
  assert.equal(synced,1);
});

test('a failed Play/Test rigid move clears the held outline',()=>{
  const {view,controller,root}=selectableFirefly();
  view.scene=root.parent;
  view.selectFromController(controller);
  const grab=view.grab;grab.rigid=true;
  const outline=view.heldOutline;
  assert.ok(outline&&outline.parent===root);
  let released=0;
  view.world.moveRigidGrab=()=>{throw Error('Rigid grab lost');};
  view.world.releaseRigidGrab=()=>released++;
  view.moveHeldRigid(grab);
  assert.equal(view.grab,null);
  assert.equal(view.heldOutline,null);
  assert.equal(outline.parent,null);
  assert.equal(released,1);
});

test('Play/Test XR grab uses a dynamic body and never authors set_transform',()=>{
  const {view,controller}=selectableFirefly();
  const source={gamepad:{mapping:'xr-standard',axes:[0,0,1,0],buttons:[]}};
  view.renderer={xr:{isPresenting:true,getSession:()=>({inputSources:[source]})}};
  view.xrViewer={direction:new THREE.Vector3(0,0,-1)};
  view.hasFreshXrViewer=()=>true;
  const object=view.world.requireObject();object.rigidBody={type:'dynamic'};
  view.world.creatorMode={schemaVersion:1,mode:'play',simulation:'running',revision:1};
  const calls=[];
  view.world.beginRigidGrab=id=>{calls.push(['begin',id]);return true;};
  view.world.moveRigidGrab=(id,transform)=>{calls.push(['move',id,transform]);return true;};
  view.world.releaseRigidGrab=id=>{calls.push(['release',id]);return {position:{x:.5,y:1,z:-2}};};
  view.world.execute=()=>{throw Error('Play cannot author a scene transform');};
  view.onPlayInteraction=event=>calls.push(['interaction',event]);
  view.commitMove=()=>{throw Error('Play release must not call authored move');};
  view.selectFromController(controller,source);
  assert.equal(view.grab?.rigid,true);
  view.updateHeldGrab({},.1);
  assert.ok(Math.abs(calls.at(-1)[2].position.x-.075)<1e-9);
  controller.position.x=.5;
  view.releaseGrab(controller);
  assert.deepEqual(calls.map(item=>item[0]),['begin','move','move','release','interaction']);
  assert.equal(calls.at(-1)[1].objectId,'firefly-1');
});

test('Play/Test refuses a non-physical or paused XR grab',()=>{
  const {view,controller}=selectableFirefly();
  let error='';view.onAssetError=message=>{error=message;};
  view.world.creatorMode={schemaVersion:1,mode:'play',simulation:'running',revision:1};
  view.selectFromController(controller);
  assert.equal(view.grab,null);
  assert.match(error,/dynamic body/);
  view.world.requireObject().rigidBody={type:'dynamic'};
  view.world.creatorMode={schemaVersion:1,mode:'play',simulation:'paused',revision:2};
  view.selectFromController(controller);
  assert.equal(view.grab,null);
  assert.match(error,/running dynamic body/);
});

test('desktop click and XR trigger activate the same inspected world control',()=>{
  const {view,controller}=selectableFirefly();
  const control=view.world.requireObject();
  delete control.animation;
  control.control={schemaVersion:1,label:'Cycle size',action:{kind:'cycle-values',
    channel:'transform.scale',targetObjectId:'target-1',values:[[1,1,1],[2,3,4]]}};
  const target={objectId:'target-1',transform:{position:{x:0,y:0,z:-3},
    rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}};
  view.world.requireObject=id=>id==='firefly-1'?control:target;
  view.world.creatorMode={schemaVersion:1,mode:'play',simulation:'running',revision:3};
  view.world.inspectEntity=()=>({object:structuredClone(control),
    controlState:{index:0,revision:4},availableActions:['activate_control'],
    creatorMode:structuredClone(view.world.creatorMode)});
  const commands=[],interactions=[];
  view.world.execute=command=>{commands.push(command);return {ok:true,
    outcome:{controlState:{index:1,revision:5}}};};
  view.sync=()=>{};
  view.onPlayInteraction=event=>interactions.push(event);
  view.selectFromController(controller);
  assert.equal(view.grab,null);
  view.renderer={xr:{isPresenting:false},domElement:{setPointerCapture(){}}};
  view.rayFromPointer=()=>view.raycaster.set(new THREE.Vector3(0,1.5,0),
    new THREE.Vector3(0,-.25,-1).normalize());
  view.pointerDown({button:0,pointerId:1,clientY:200});
  assert.equal(view.pointerGrab,null);
  assert.equal(commands.length,2);
  assert.deepEqual(commands.map(command=>command.op),['activate_control','activate_control']);
  assert.deepEqual(commands[0].expectedControl,control.control);
  assert.deepEqual(commands[0].expectedControlState,{index:0,revision:4});
  assert.deepEqual(commands[0].expectedTransform,control.transform);
  assert.deepEqual(commands[0].expectedTargetTransform,target.transform);
  assert.equal(interactions.length,2);
  assert.ok(interactions.every(event=>event.kind==='control'));
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
