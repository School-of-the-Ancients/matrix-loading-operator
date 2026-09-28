import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixView,operatorPanel,updateControllerRayForPanel} from '../src/view.js';
import {moveGrab,sampleHeldMotion} from '../src/grab.js';
import {XRSessionController} from '../src/xr_session.js';

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

test('a stick click during a grab cannot recall the Operator panel',()=>{
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

test('WORLD panel labels the active XR mode and its exit control ends that session',async()=>{
  const drawn=[];
  const context={fillRect(){},strokeRect(){},
    fillText(value){drawn.push(String(value));},measureText(){return {width:0};}};
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel(),hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    assert.equal(hit(155,71),null,'the exit control belongs only to an active WORLD page');
    panel.setXRMode('vr');panel.toggleWorld();
    assert.equal(hit(155,71),'exit-xr');
    assert.ok(drawn.includes('EXIT VR'));
    drawn.length=0;panel.setXRMode('ar');
    assert.ok(drawn.includes('EXIT AR'));
    assert.ok(!drawn.includes('◈  OPERATOR'),'the WORLD header has no overlapping title');
    assert.equal(hit(280,71),null,'exit does not overlap adjacent CODEX control');

    const scene=new THREE.Scene(),controller=new THREE.Group();
    controller.position.y=1;scene.add(controller);
    panel.group.position.set(0,1,-1);panel.group.visible=true;scene.add(panel.group);
    const target=new THREE.Vector3((155/1024-.5)*.96,1+(1-71/768-.5)*.72,-1);
    controller.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),
      target.sub(controller.position).normalize());
    scene.updateMatrixWorld(true);
    let ended=0;
    const session={end:async()=>{ended++;}};
    const rendererXR={addEventListener(){},getSession:()=>session};
    const view=Object.create(MatrixView.prototype);
    view.grab=null;view.raycaster=new THREE.Raycaster();view.operatorPanel=panel;
    view.xrControls=new XRSessionController({},rendererXR);
    view.selectFromRay=()=>{throw Error('Exit must not select the scene');};
    view.onPanelAction=()=>{throw Error('Exit must stay in the XR session controller');};
    view.selectFromController(controller);
    await Promise.resolve();
    assert.equal(ended,1);
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('XR creation-mode selection reaches the shared Operator action handler',()=>{
  const {controller,panel}=controllerAndPanel();
  panel.mesh.updateWorldMatrix(true,false);
  const view=Object.create(MatrixView.prototype);
  view.grab=null;view.raycaster=new THREE.Raycaster();
  view.operatorPanel={...panel,hit:()=> 'creation-mode-blender'};
  view.selectFromRay=()=>{throw Error('The panel action must not select the scene');};
  let action=null;
  view.onPanelAction=next=>{action=next;};
  view.selectFromController(controller);
  assert.equal(action,'creation-mode-blender');
  assert.equal(view.operatorPanel.group.visible,true);
});

test('XR concept gallery navigation stays in the panel and version selection reaches Operator',()=>{
  const {controller,panel}=controllerAndPanel();
  panel.mesh.updateWorldMatrix(true,false);
  const view=Object.create(MatrixView.prototype);
  view.grab=null;view.raycaster=new THREE.Raycaster();
  let action='open-concepts',opened=0,next=0,selected=null;
  view.operatorPanel={...panel,hit:()=>action,
    toggleConcepts:()=>opened++,previousConcept:()=>{},nextConcept:()=>next++};
  view.selectFromRay=()=>{throw Error('Concept controls must not select a scene object');};
  view.onPanelAction=value=>{selected=value;};
  view.selectFromController(controller);
  assert.equal(opened,1);assert.equal(selected,null);
  action='concept-next';view.selectFromController(controller);
  assert.equal(next,1);assert.equal(selected,null);
  action='concept-select-2';view.selectFromController(controller);
  assert.equal(selected,'concept-select-2');
  action='concept-retry-2';view.selectFromController(controller);
  assert.equal(selected,'concept-retry-2');
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

test('a stick click between frames cannot recall the panel after grab release or cancellation',()=>{
  const {view,controller}=selectableFirefly();
  const buttons=Array.from({length:4},()=>({pressed:false}));
  const source={gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons}};
  view.renderer={xr:{isPresenting:true,getSession:()=>({inputSources:[source]})}};
  view.hasFreshXrViewer=()=>true;
  view.operatorThumbstickHeld=false;
  view.sync=()=>{};
  let recalled=0;view.toggleOperatorPanel=()=>recalled++;
  view.selectFromController(controller,source);
  buttons[3].pressed=true;
  view.releaseGrab(controller);
  view.updateOperatorShortcut();
  assert.equal(recalled,0,'release must capture a click before the next XR frame');
  buttons[3].pressed=false;view.updateOperatorShortcut();
  view.selectFromController(controller,source);
  buttons[3].pressed=true;
  view.cancelGrab(controller,source);
  view.updateOperatorShortcut();
  assert.equal(recalled,0,'cancellation must capture a click before the next XR frame');
  buttons[3].pressed=false;view.updateOperatorShortcut();
  buttons[3].pressed=true;view.updateOperatorShortcut();
  assert.equal(recalled,1,'a new click outside a grab still recalls the panel');
});

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

test('a held object uses a small outline without controller text',()=>{
  const {view,controller,root}=selectableFirefly();
  view.scene=root.parent;
  const controllerChildCount=controller.children.length;
  view.selectFromController(controller);
  assert.equal(view.heldOutline?.parent,root);
  assert.equal(view.heldOutline.material.color.getHex(),0xffd166);
  assert.equal(controller.children.length,controllerChildCount,
    'grabbing must not add a text panel to the controller');
  view.releaseGrab(controller);
  assert.equal(view.heldOutline,null);
  assert.equal(controller.children.length,controllerChildCount);
});

test('grab hand translates while the opposite hand spins and flips the held object',()=>{
  const {view,controller,root}=selectableFirefly();
  const source={handedness:'left',gamepad:{mapping:'xr-standard',axes:[0,0,1,0],
    buttons:[{},{},{},{pressed:false}]}};
  const other={handedness:'right',gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:[]}};
  const session={inputSources:[source,other]};
  view.renderer={xr:{isPresenting:true,getSession:()=>session}};
  view.xrViewer={direction:new THREE.Vector3(0,0,-1)};
  view.hasFreshXrViewer=()=>true;
  const freeController=new THREE.Group();freeController.userData.inputSource=other;
  view.controllers=[controller,freeController];
  view.selectFromController(controller,source);
  assert.equal(view.grab.inputSource,source);
  view.updateHeldGrab({},.1);
  assert.ok(Math.abs(root.position.x-.075)<1e-9,
    'grab-hand stick X retains lateral translation');
  assert.ok(root.quaternion.equals(new THREE.Quaternion()),
    'grab-hand stick does not spin the held object');
  source.gamepad.axes=[0,0,0,0];other.gamepad.axes=[0,0,1,0];
  view.updateHeldGrab({},.1);
  assert.ok(Math.abs(root.rotation.y)>0,'free-hand stick X turns the held object');
  assert.ok(Math.abs(root.position.x-.075)<1e-9,
    'free-hand stick X does not translate the held object');
  const yaw=root.quaternion.clone();
  other.gamepad.axes=[0,0,0,-1];
  view.updateHeldGrab({},.1);
  assert.ok(root.quaternion.angleTo(yaw)>0,'free-hand stick Y flips the held object');
  assert.ok(Math.abs(root.position.x-.075)<1e-9&&Math.abs(root.position.y-1)<1e-9,
    'free-hand stick Y does not translate the held object');
  const turned=root.quaternion.clone();
  other.gamepad.axes=[0,0,0,0];
  source.gamepad.axes=[0,0,0,-1];source.gamepad.buttons[3].pressed=true;
  view.updateHeldGrab({},.1);
  assert.ok(Math.abs(root.position.y-1.075)<1e-9,
    'grab-hand click and Y retain height translation');
  assert.ok(root.quaternion.equals(turned));
  controller.position.x=.5;
  view.updateHeldGrab({},.1);
  assert.ok(Math.abs(root.position.x-.575)<1e-9,
    'tracked controller movement remains available');
  const beforeInvalid=root.quaternion.clone();
  source.gamepad.axes=[0,0,NaN,0];
  assert.equal(view.updateGrabThumbstick({},.1),false);
  assert.ok(root.quaternion.equals(beforeInvalid));
  let cancelled=0,resumed=0;
  view.sync=()=>cancelled++;
  view.world.resumePhysics=()=>resumed++;
  session.inputSources=[];
  const x=root.position.x;view.updateHeldGrab({},.1);
  assert.equal(root.position.x,x);
  assert.equal(view.grab,null);
  assert.equal(cancelled,1);assert.equal(resumed,1);
});

test('either hand may grab; only a uniquely connected visible opposite hand rotates',()=>{
  const {view,controller,root}=selectableFirefly();
  const source={handedness:'right',gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:[]}};
  const opposite={handedness:'left',gamepad:{mapping:'xr-standard',axes:[0,0,1,0],buttons:[]}};
  const session={inputSources:[source,opposite]};
  const freeController=new THREE.Group();freeController.userData.inputSource=opposite;
  view.controllers=[freeController,controller];
  view.renderer={xr:{isPresenting:true,getSession:()=>session}};
  view.xrViewer={direction:new THREE.Vector3(0,0,-1)};
  view.hasFreshXrViewer=()=>true;
  view.selectFromController(controller,source);
  view.updateHeldGrab({},.1);
  assert.ok(root.quaternion.angleTo(new THREE.Quaternion())>0);
  const turned=root.quaternion.clone();
  let recalled=0;view.toggleOperatorPanel=()=>recalled++;
  view.operatorThumbstickHeld=false;
  opposite.gamepad.buttons=[{},{},{},{pressed:true}];
  view.updateOperatorShortcut();
  assert.equal(recalled,0,'free-hand stick click remains suppressed during a grab');
  freeController.visible=false;
  assert.equal(view.updateGrabRotationThumbstick({},.1),false);
  assert.ok(root.quaternion.equals(turned));
  freeController.visible=true;delete freeController.userData.inputSource;
  assert.equal(view.updateGrabRotationThumbstick({},.1),false);
  freeController.userData.inputSource=opposite;
  session.inputSources=[source,opposite,{...opposite}];
  assert.equal(view.updateGrabRotationThumbstick({},.1),false,
    'ambiguous sources must not rotate a held object');
  session.inputSources=[source];
  assert.equal(view.updateGrabRotationThumbstick({},.1),false,
    'missing opposite source must not rotate a held object');
  const wrong={handedness:'right',gamepad:{mapping:'xr-standard',axes:[0,0,1,0]}};
  freeController.userData.inputSource=wrong;session.inputSources=[source,wrong];
  assert.equal(view.updateGrabRotationThumbstick({},.1),false,
    'another right-hand source cannot rotate a right-hand grab');
  const unsupported={handedness:'left',gamepad:{mapping:'',axes:[0,0,1,0]}};
  freeController.userData.inputSource=unsupported;session.inputSources=[source,unsupported];
  assert.equal(view.updateGrabRotationThumbstick({},.1),false,
    'an unrecognized gamepad mapping cannot rotate a held object');
  assert.ok(root.quaternion.equals(turned));
  freeController.userData.inputSource=opposite;session.inputSources=[source,opposite];
  opposite.gamepad.buttons[3].pressed=false;
  let authored=null;view.commitMove=(id,transform)=>{authored={id,transform};};
  view.releaseGrab(controller);
  assert.equal(authored?.id,'firefly-1');
  assert.ok(Math.abs(authored.transform.rotation.y)>0,
    'release authors the free-hand spin on the grabbed object');
});

test('stick input outside a grab never moves or rotates the selected object',()=>{
  const {view,controller,root}=selectableFirefly();
  const source={gamepad:{mapping:'xr-standard',axes:[0,0,1,-1],buttons:[]}};
  view.renderer={xr:{isPresenting:true,getSession:()=>({inputSources:[source]})}};
  view.xrViewer={direction:new THREE.Vector3(0,0,-1)};
  view.hasFreshXrViewer=()=>true;
  const startPosition=root.position.clone(),startQuaternion=root.quaternion.clone();
  view.updateHeldGrab({},.1);
  assert.ok(root.position.equals(startPosition));
  assert.ok(root.quaternion.equals(startQuaternion));
  view.selectFromController(controller,source);
  view.releaseGrab(controller);
  const afterRelease=root.quaternion.clone();
  view.updateHeldGrab({},.1);
  assert.ok(root.position.equals(startPosition));
  assert.ok(root.quaternion.equals(afterRelease));
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

test('a missing headset pose suspends held motion and discards release',()=>{
  const {view,controller,root}=selectableFirefly();
  const source={gamepad:{mapping:'xr-standard',axes:[0,0,1,0],buttons:[]}};
  view.renderer={xr:{isPresenting:true,getSession:()=>({inputSources:[source]})}};
  view.xrViewer={direction:new THREE.Vector3(0,0,-1)};
  view.xrViewerCapturedAt=performance.now();
  view.selectFromController(controller,source);
  let rigidMoves=0,resumed=0,synced=0;
  view.moveHeldRigid=()=>rigidMoves++;
  view.world.resumePhysics=()=>resumed++;
  view.sync=()=>synced++;
  view.commitMove=()=>{throw Error('A grab without a viewer pose must not be saved');};
  view.captureXrViewer({getViewerPose:()=>null},{});
  assert.equal(view.hasFreshXrViewer(),false);
  controller.position.x=.5;
  view.updateHeldGrab({},.1);
  assert.equal(root.position.x,0);
  assert.equal(rigidMoves,0);
  view.releaseGrab(controller);
  assert.equal(root.position.x,0);
  assert.equal(view.grab,null);
  assert.equal(resumed,1);
  assert.equal(synced,1);
});

test('XR session exit cancels a held edit and restores the authored pose',t=>{
  const {view,controller,root}=selectableFirefly();
  const authored=root.position.clone();
  const source={gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:[]}};
  const xr={isPresenting:true,getSession:()=>({inputSources:[source]})};
  view.renderer={xr};view.xrViewer={direction:new THREE.Vector3(0,0,-1)};
  view.hasFreshXrViewer=()=>true;
  let paused=0,resumed=0,synced=0,notice='';
  view.world.pausePhysics=()=>paused++;
  view.world.resumePhysics=()=>resumed++;
  view.world.leaveAR=()=>{};
  view.onAssetError=message=>notice=message;
  view.commitMove=()=>{throw Error('Session exit must not author a transform');};
  view.selectFromController(controller,source);
  controller.position.x=.5;
  view.updateHeldGrab({},.1);
  assert.equal(root.position.x,.5);
  view.sync=()=>{synced++;root.position.copy(authored);};
  view.onRuntimeChange=()=>{};view.clearPlanes=()=>{};
  view.operatorPanel.setPinLabel=()=>{};view.operatorPanel.setOriginLabel=()=>{};
  view.operatorPanel.setXRMode=()=>{};
  view.controllerRays=[];view.reticle={visible:false};
  view.virtualFloorRoot={visible:true,position:{set(){}},quaternion:{identity(){}}};
  view.floor={visible:true};view.grid={visible:true};view.scene=root.parent;
  const previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{
    getElementById:()=>({style:{},textContent:''})}});
  t.after(()=>{if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);
    else delete globalThis.document;});
  xr.isPresenting=false;
  view.onSessionEnd();
  assert.equal(view.grab,null);
  assert.ok(root.position.equals(authored));
  assert.equal(paused,1);assert.equal(resumed,1);
  assert.equal(synced,2);
  assert.match(notice,/XR session ended/);
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
  const source={handedness:'left',gamepad:{mapping:'xr-standard',axes:[0,0,1,0],buttons:[]}};
  const opposite={handedness:'right',gamepad:{mapping:'xr-standard',axes:[0,0,1,0],buttons:[]}};
  view.renderer={xr:{isPresenting:true,getSession:()=>({inputSources:[source,opposite]})}};
  view.xrViewer={direction:new THREE.Vector3(0,0,-1)};
  view.hasFreshXrViewer=()=>true;
  const freeController=new THREE.Group();freeController.userData.inputSource=opposite;
  view.controllers=[controller,freeController];
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
  assert.ok(Math.abs(calls.at(-1)[2].position.x-.075)<1e-9,
    'Play keeps grab-hand translation');
  assert.ok(Math.abs(calls.at(-1)[2].rotation.y)>0,
    'Play sends the spun pose to its dynamic body');
  controller.position.x=.5;
  view.releaseGrab(controller);
  assert.deepEqual(calls.map(item=>item[0]),['begin','move','move','release','interaction']);
  assert.equal(calls.at(-1)[1].objectId,'firefly-1');
});

test('tracked Play/Test XR release passes recent throw motion but cancellation does not',()=>{
  const {view,controller}=selectableFirefly();
  const source={handedness:'left',gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:[]}};
  view.renderer={xr:{isPresenting:true,getSession:()=>({inputSources:[source]})}};
  view.hasFreshXrViewer=()=>true;
  view.world.requireObject().rigidBody={type:'dynamic'};
  view.world.creatorMode={schemaVersion:1,mode:'play',simulation:'running',revision:1};
  view.world.beginRigidGrab=()=>true;
  view.world.moveRigidGrab=()=>true;
  const releases=[];
  view.world.releaseRigidGrab=(id,motion)=>{releases.push({id,motion});
    return {objectId:id,position:{x:0,y:1,z:-2}};};
  view.onPlayInteraction=()=>{};view.sync=()=>{};
  view.selectFromController(controller,source);
  const grab=view.grab,now=performance.now();
  grab.motionSamples=[];
  sampleHeldMotion(grab,now-45);
  controller.position.x=.2;controller.rotation.y=.1;moveGrab(grab);
  sampleHeldMotion(grab,now-20);
  controller.position.x=.3;controller.rotation.y=.15;
  view.releaseGrab(controller);
  assert.equal(releases.length,1);
  assert.equal(releases[0].id,'firefly-1');
  assert.ok(Math.hypot(...Object.values(releases[0].motion.linearVelocity))>.1);
  assert.ok(Math.hypot(...Object.values(releases[0].motion.angularVelocity))>.2);
  view.selectFromController(controller,source);
  view.cancelGrab(controller,source);
  assert.equal(releases.length,2);
  assert.equal(releases[1].motion,undefined,
    'tracking loss and cancellation resume physics without a throw');
});

test('a missed tracking frame cannot turn recovery into a Play/Test throw',()=>{
  const {view,controller}=selectableFirefly();
  const source={handedness:'left',gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:[]}};
  view.renderer={xr:{isPresenting:true,getSession:()=>({inputSources:[source]})}};
  view.hasFreshXrViewer=()=>true;
  view.updateGrabThumbstick=()=>false;view.updateGrabRotationThumbstick=()=>false;
  view.world.requireObject().rigidBody={type:'dynamic'};
  view.world.creatorMode={schemaVersion:1,mode:'play',simulation:'running',revision:1};
  view.world.beginRigidGrab=()=>true;view.world.moveRigidGrab=()=>true;
  let releaseMotion='not released';
  view.world.releaseRigidGrab=(_id,motion)=>{releaseMotion=motion;
    return {position:{x:0,y:1,z:-2}};};
  view.onPlayInteraction=()=>{};
  view.selectFromController(controller,source);
  assert.ok(view.grab.motionSamples.length);
  view.updateHeldGrab(null,.016);
  assert.equal(view.grab.motionSamples.length,0,
    'one invalid XR frame must discard motion history');
  controller.position.x=.5;
  view.updateHeldGrab({},.016);
  assert.equal(view.grab.motionSamples.length,1);
  view.releaseGrab(controller);
  assert.equal(releaseMotion,undefined);
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
