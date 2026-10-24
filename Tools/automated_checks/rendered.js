// Development-only, bundled solely by Tools/automated_checks/build.mjs.
// Full IWER emulation is installed only inside this disposable browser context.
import {XRDevice,metaQuest3} from '../../WebRuntime/node_modules/iwer/lib/index.js';
import * as THREE from '../../WebRuntime/node_modules/three/build/three.module.js';
import {MatrixWorld} from '../../WebRuntime/src/protocol.js';
import {MatrixView} from '../../WebRuntime/src/view.js';
import {storedWorld,saveStoredWorld,loadStoredWorld,restoreStoredWorld} from '../../WebRuntime/src/scene_store.js';

const require=(condition,message)=>{if(!condition)throw Error(message);};
const device=new XRDevice(metaQuest3);
device.installRuntime({forceInstall:true});device.position.set(0,1.7,0);device.quaternion.set(0,0,0,1);
const world=new MatrixWorld(()=>'automated-check-block'),receipts=[],commands=[],actions=[],errors=[];
let revision=Number(localStorage.getItem('matrix-review-fixture-revision'))||0,frames=0;
const originalExecute=world.execute.bind(world);
world.execute=command=>{
  const executed=structuredClone(command);
  const receipt=originalExecute(command);receipts.push(structuredClone(receipt));
  commands.push({command:executed,receipt:structuredClone(receipt)});
  if(receipt.ok)revision++;
  return receipt;
};
const view=new MatrixView(document.getElementById('view'),world,()=>{},()=>'',
  error=>errors.push(error),()=>view.sync(),()=>{},()=>{},()=>{},()=>{},()=>{},()=>{},
  {developmentReview:true});
view.onFrame=()=>frames++;
view.sync();
await view.initXR(document.getElementById('entry'));
const nextFrames=async(count=4)=>{
  const target=frames+count,start=performance.now();
  while(frames<target){
    require(performance.now()-start<3000,'Emulated XR frames unavailable');
    await new Promise(resolve=>requestAnimationFrame(resolve));
  }
};
const pose=position=>{
  device.controllers.right.position.set(...position);device.controllers.right.quaternion.set(0,0,0,1);
  actions.push({action:'controller-pose',position,atFrame:frames});
};
const trigger=async(value)=>{
  device.controllers.right.updateButtonValue('trigger',value);
  await nextFrames();
  actions.push({action:value?'trigger-down':'trigger-up',atFrame:frames,
    selected:world.selection.objectId,held:view.grab?.objectId||null,scene:structuredClone(world.scene)});
};
function visualState(){
  for(const object of world.scene.objects){
    const root=view.objectRoots.get(object.objectId);
    require(root&&root.visible&&root.parent?.visible,'Missing or hidden rendered object');
    require(root.userData.assetLoading!==true&&!root.userData.proceduralError,'Asset not rendered');
    require(root.children.some(child=>child.children.length>0),'Missing rendered geometry');
    require(Math.abs(root.position.x-object.transform.position.x)<.001&&
      Math.abs(root.position.y-object.transform.position.y)<.001&&
      Math.abs(root.position.z-object.transform.position.z)<.001,'Rendered transform mismatch');
  }
  require(errors.length===0,`Production view errors: ${errors.join('; ')}`);
}
function captures(){
  visualState();
  const head=()=>['x','y','z'].map(axis=>device.position[axis]);
  const before={camera:view.camera.matrixWorld.toArray(),head:head(),
    panel:view.operatorPanel.group.visible,background:view.scene.background};
  const images=['first-person','left','right'].map(viewpoint=>{
    const {canvas,virtual}=view.renderVirtualFrame({captureId:`review-${revision}-${viewpoint}`,revision},
      'disposable-review',960,720,{profile:'developer-review',viewpoint,includeOperator:true});
    require(virtual.review.includesOperator,'Operator absent from review capture');
    return {metadata:{...virtual,mimeType:'image/png'},pngBase64:canvas.toDataURL('image/png').split(',')[1]};
  });
  require(JSON.stringify(before.camera)===JSON.stringify(view.camera.matrixWorld.toArray())&&
    JSON.stringify(before.head)===JSON.stringify(head())&&
    before.panel===view.operatorPanel.group.visible&&before.background===view.scene.background,
    'Review capture changed live view');
  return images;
}
window.matrixReview={
  ready(){return {fixture:'matrix-rendered-input-v1',input:'IWER 2.5.0 full desktop emulation',
    descriptor:world.snapshot().runtimeDescriptor,sessionActive:view.renderer.xr.isPresenting,
    secureContext:isSecureContext,userAgent:navigator.userAgent,frames};},
  async exercise(){
    require(view.renderer.xr.isPresenting,'Enter the disposable VR fixture first');await nextFrames();
    const receipt=world.execute({requestId:'rendered-spawn',op:'spawn',assetId:'block',anchorId:'web-floor',
      transform:{position:{x:0,y:.5,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}});
    require(receipt.ok,'Fixture spawn failed');view.sync();await nextFrames();
    pose([0,1,-.2]);await nextFrames();await trigger(1);
    require(view.grab?.objectId==='automated-check-block','Production selectstart did not grab the block');
    pose([.6,1.25,-.4]);await nextFrames();await trigger(0);
    require(!view.grab,'Production selectend did not release the block');
    const transform=world.requireObject('automated-check-block').transform;
    require(Math.abs(transform.position.x-.6)<.002&&Math.abs(transform.position.y-.75)<.002&&
      Math.abs(transform.position.z+2.2)<.002,'Controller movement did not commit expected transform');
    // Aim at the real painted HIDE hit target, then prove it is reachable.
    const panel=view.operatorPanel;
    const point=panel.mesh.localToWorld(new THREE.Vector3((894/1024-.5)*.96,(.5-71/768)*.72,0));
    pose([point.x,point.y,point.z+.3]);await nextFrames();await trigger(1);await trigger(0);
    require(!panel.group.visible,'Operator HIDE hit target was not reached');
    actions.push({action:'operator-hide-hit',visible:panel.group.visible,atFrame:frames});
    view.toggleOperatorPanel();await nextFrames();
    const images=captures(),saved=storedWorld(world);
    const error=saveStoredWorld(saved,sessionStorage,localStorage);require(!error,error);
    localStorage.setItem('matrix-review-fixture-revision',String(revision));
    return {scene:structuredClone(world.scene),saved,receipts,commands,actions,images,revision};
  },
  async reopen(){
    require(sessionStorage.length===0,'Reopen must use a new page without tab storage');
    const loaded=loadStoredWorld(sessionStorage,localStorage);require(loaded.value,'Durable world missing');
    restoreStoredWorld(world,loaded.value);view.sync();await nextFrames();
    visualState();
    return {scene:structuredClone(world.scene),world:storedWorld(world),images:captures()};
  },
  // Bounded failures in disposable fixtures; never available in production.
  negative(kind){
    if(kind==='missing-geometry')view.objectRoots.get('automated-check-block').clear();
    else if(kind==='wrong-render-transform')view.objectRoots.get('automated-check-block').position.x+=10;
    else if(kind==='hidden-panel')view.operatorPanel.group.visible=false;
    else throw Error('Unknown negative control');
    captures();throw Error('Negative control escaped detection');
  }
};
