import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixView} from '../src/view.js';
import {beginGrab} from '../src/grab.js';

const object={objectId:'block-1',assetId:'block',anchorId:'web-floor',
  transform:{position:{x:0,y:2,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}};

test('sync recreates the mesh at the current transient floor-drop height',()=>{
  const view=Object.create(MatrixView.prototype);
  const resumed=[],invalidated=[];
  view.world={scene:{objects:[structuredClone(object)]},spatial:null,
    asset:()=>({spawnScale:1}),physicsState:()=>({position:{x:0,y:1.25,z:-2}}),
    resumePhysics:id=>resumed.push(id),
    invalidatePhysicsAsset:id=>invalidated.push(id),
    selection:{objectId:''}};
  view.scene=new THREE.Scene();view.virtualFloorRoot=new THREE.Group();view.scene.add(view.virtualFloorRoot);
  const oldRoot=new THREE.Group();oldRoot.userData.objectId='block-1';
  view.objectRoots=new Map([['block-1',oldRoot]]);view.anchorRoots=new Map();view.isAR=false;
  view.grab={objectId:'block-1'};view.pointerGrab={objectId:'block-2'};
  view.highlight=()=>{};
  view.sync();
  assert.equal(view.objectRoots.get('block-1').position.y,1.25);
  assert.equal(view.world.scene.objects[0].transform.position.y,2);
  assert.deepEqual(resumed,['block-1','block-2']);
  assert.deepEqual(invalidated,['block-1']);
});

function frameView(isAR=false){
  const view=Object.create(MatrixView.prototype);
  let advanced=0,mixed=0,rendered=0;
  const root=new THREE.Group();root.userData.objectId='block-1';root.userData.behaviors=[];
  root.userData.visual=new THREE.Group();root.add(root.userData.visual);
  root.userData.mixer={update:dt=>mixed+=dt};
  view.world={scene:{objects:[structuredClone(object)]},
    advancePhysics:dt=>{advanced+=dt;},
    physicsState:()=>({position:{x:0,y:1.5,z:-2}})};
  view.objectRoots=new Map([['block-1',root]]);
  view.renderer={xr:{isPresenting:false},render:()=>rendered++};
  view.camera=new THREE.PerspectiveCamera();view.scene=new THREE.Scene();view.keys=new Set();
  view.lastFrameTime=0;view.isAR=isAR;view.grab=null;
  return {view,root,counts:()=>({advanced,mixed,rendered})};
}

test('a desktop frame steps floor physics once and keeps GLB clip playback independent',()=>{
  const {view,root,counts}=frameView();
  view.animate(1000,null);
  assert.deepEqual(counts(),{advanced:.1,mixed:.1,rendered:1});
  assert.equal(root.position.y,1.5);
  assert.equal(root.userData.visual.position.y,0);
  assert.equal(view.world.scene.objects[0].transform.position.y,2);
});

test('a paused floor drop does not overwrite pointer or XR grab movement',()=>{
  const {view,root}=frameView();
  root.position.y=.6;
  view.pointerGrab={objectId:'block-1',root};
  view.animate(1000,null);
  assert.equal(root.position.y,.6);
  view.pointerGrab=null;
  const controller=new THREE.Group();
  view.scene.add(controller,root);
  view.scene.updateMatrixWorld(true);
  view.grab={...beginGrab(controller,root),objectId:'block-1'};
  controller.position.y=.4;
  view.animate(2000,null);
  assert.ok(Math.abs(root.position.y-1)<1e-9,'controller movement stays visible while physics is paused');
  view.grab=null;
  view.animate(3000,null);
  assert.equal(root.position.y,1.5,'solver pose resumes after release');
});

test('catalog refresh clears changed GLB cache and rebuilds its rendered instance once',()=>{
  const view=Object.create(MatrixView.prototype);
  view.world={scene:{objects:[{objectId:'model-1',assetId:'web:model'}]}};
  view.modelCache=new Map([['web:model',Promise.resolve({})],['web:other',Promise.resolve({})]]);
  let rebuilds=0;view.sync=()=>{rebuilds++;};
  assert.equal(view.refreshAssets([]),false);
  assert.equal(view.refreshAssets(['web:other']),false);
  assert.equal(rebuilds,0);
  assert.equal(view.modelCache.has('web:other'),false);
  assert.equal(view.refreshAssets(['web:model']),true);
  assert.equal(view.modelCache.has('web:model'),false);
  assert.equal(rebuilds,1);
});

test('an AR frame does not step or render a floor-drop pose',()=>{
  const {view,root,counts}=frameView(true);
  root.position.y=2;
  view.animate(1000,null);
  assert.equal(counts().advanced,0);
  assert.equal(root.position.y,2);
});

test('GLB load submits measured X/Y/Z size before a model is eligible for physics',async()=>{
  const asset={assetId:'web:test',displayName:'Measured model',spawnScale:1,
    geometry:{animationClips:[]}};
  const root=new THREE.Group(),visual=new THREE.Group();root.add(visual);
  root.userData.assetLoading=true;
  const view=Object.create(MatrixView.prototype);
  view.modelCache=new Map([[asset.assetId,Promise.resolve({scene:new THREE.Group(),animations:[],
    measuredSize:{x:1,y:2,z:3}})]]);
  view.objectRoots=new Map([['model-1',root]]);
  const measured=[];const errors=[];
  view.world={scene:{objects:[{objectId:'model-1',anchorId:'web-floor'}]},
    verifyPhysicsAsset:(id,size,objectId)=>{measured.push({id,size,objectId});return false;}};
  view.onAssetError=message=>errors.push(message);
  await view.loadExternal(asset,root,visual,'model-1');
  assert.deepEqual(measured,[{id:'web:test',size:{x:1,y:2,z:3},objectId:'model-1'}]);
  assert.equal(root.userData.assetLoading,false);
  assert.ok(root.userData.model);
  assert.deepEqual(errors,[]);
});

test('a failed GLB clip instantiation revokes only that object’s physics eligibility',async()=>{
  const asset={assetId:'web:test',displayName:'Broken clip',spawnScale:1,
    geometry:{animationClips:[{name:'Flight',durationSeconds:1}]}};
  const root=new THREE.Group(),visual=new THREE.Group();root.add(visual);
  root.userData.assetLoading=true;
  const view=Object.create(MatrixView.prototype);
  view.modelCache=new Map([[asset.assetId,Promise.resolve({scene:new THREE.Group(),animations:[],
    measuredSize:{x:1,y:1,z:1}})]]);
  view.objectRoots=new Map([['bad-model',root]]);
  const verified=[],invalidated=[],errors=[];
  view.world={scene:{objects:[{objectId:'bad-model',anchorId:'web-floor'}]},
    verifyPhysicsAsset:(...args)=>verified.push(args),
    invalidatePhysicsAsset:(...args)=>invalidated.push(args)};
  view.onAssetError=message=>errors.push(message);
  await view.loadExternal(asset,root,visual,'bad-model');
  assert.deepEqual(verified,[]);
  assert.deepEqual(invalidated,[['bad-model',true]]);
  assert.match(errors[0],/animation clips differ/);
  assert.equal(root.userData.model,undefined);
});

function grabView(){
  const scene=new THREE.Scene();
  const controller=new THREE.Group();controller.position.set(0,1,0);scene.add(controller);
  const root=new THREE.Group();root.position.set(0,1,-2);root.userData.objectId='block-1';
  root.add(new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5)));scene.add(root);
  scene.updateMatrixWorld(true);
  const placed=structuredClone(object);placed.transform.position.y=1;
  const calls=[];
  const view=Object.create(MatrixView.prototype);
  view.renderer={xr:{isPresenting:false},domElement:{focus(){},setPointerCapture(){}}};
  view.raycaster=new THREE.Raycaster();view.operatorPanel={group:{visible:false}};
  view.objectRoots=new Map([['block-1',root]]);view.grab=null;view.pointerGrab=null;
  view.world={scene:{objects:[placed]},spatial:{stale:false,originUnavailable:false},
    requireObject:()=>placed,setSelection(){},
    pausePhysics:id=>calls.push(['pause',id]),resumePhysics:id=>calls.push(['resume',id])};
  view.highlight=()=>{};view.onSelection=()=>{};view.onAssetError=()=>{};
  view.rayFromPointer=()=>view.raycaster.set(new THREE.Vector3(0,1.5,0),
    new THREE.Vector3(0,-.25,-1).normalize());
  return {view,controller,calls};
}

test('XR and desktop grabs pause floor physics, then resume on unchanged release',()=>{
  const {view,controller,calls}=grabView();
  view.selectFromController(controller);
  assert.deepEqual(calls,[['pause','block-1']]);
  view.releaseGrab(controller);
  assert.deepEqual(calls,[['pause','block-1'],['resume','block-1']]);
  view.pointerDown({button:0,pointerId:1,clientY:200});
  assert.deepEqual(calls.at(-1),['pause','block-1']);
  view.pointerUp({pointerId:1});
  assert.deepEqual(calls.at(-1),['resume','block-1']);
});

test('a moved XR release uses set_transform to rebase the floor drop',()=>{
  const {view,controller,calls}=grabView();
  view.world.execute=command=>{calls.push(['execute',command.op,command.transform.position.x]);return {ok:true};};
  view.onSceneEdit=()=>{};
  view.selectFromController(controller);
  controller.position.x=.5;
  view.releaseGrab(controller);
  assert.deepEqual(calls,[['pause','block-1'],['execute','set_transform',.5]]);
});
