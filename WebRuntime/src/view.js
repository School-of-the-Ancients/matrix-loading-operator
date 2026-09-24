import * as THREE from 'three';
import {ARButton} from 'three/addons/webxr/ARButton.js';
import {VRButton} from 'three/addons/webxr/VRButton.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const wood=()=>new THREE.MeshStandardMaterial({color:0xa56f45,roughness:.78});
const metal=()=>new THREE.MeshStandardMaterial({color:0x738995,roughness:.45,metalness:.45});
const stone=()=>new THREE.MeshStandardMaterial({color:0x9ca8a6,roughness:.9});
function box(group,w,h,d,x,y,z,material){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
function cylinder(group,r,h,x,y,z,material){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,24),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
function makeAsset(id){
  const group=new THREE.Group(); const w=wood(),m=metal(),s=stone();
  if(id==='chair'){
    box(group,.58,.08,.58,0,.45,0,w);box(group,.58,.48,.07,0,.69,.26,w);
    for(const x of [-.23,.23])for(const z of [-.23,.23])box(group,.075,.43,.075,x,.215,z,w);
  } else if(id==='table'){
    box(group,1.5,.09,.9,0,.72,0,w);
    for(const x of [-.64,.64])for(const z of [-.34,.34])box(group,.09,.68,.09,x,.34,z,w);
  } else if(id==='wall')box(group,2,2,.12,0,1,0,s);
  else if(id==='pedestal'){box(group,.6,.12,.6,0,.94,0,s);box(group,.4,.88,.4,0,.5,0,s);box(group,.58,.08,.58,0,.04,0,s);}
  else if(id==='block')box(group,1,1,1,0,.5,0,m);
  else if(id==='orb'){
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(.25,32,20),new THREE.MeshStandardMaterial({color:0x4cd8ef,emissive:0x12647d,roughness:.22,metalness:.2}));mesh.position.y=.25;group.add(mesh);
  } else if(id==='column'){cylinder(group,.25,1.8,0,1,0,s);cylinder(group,.32,.1,0,.05,0,s);cylinder(group,.32,.1,0,1.95,0,s);}
  else throw Error(`Unknown asset: ${id}`);
  return group;
}
function disposeGroup(root){root.traverse(node=>{if(node.geometry&&!node.userData.cachedGeometry)node.geometry.dispose();if(node.material){const materials=Array.isArray(node.material)?node.material:[node.material];for(const material of materials)material.dispose();}});}
const v3=v=>new THREE.Vector3(v.x,v.y,v.z);
const plain=v=>({x:Number(v.x.toFixed(3)),y:Number(v.y.toFixed(3)),z:Number(v.z.toFixed(3))});

export class MatrixView {
  constructor(container,world,onSelection,getToken=()=>'',onAssetError=()=>{}){
    this.world=world;this.onSelection=onSelection;this.getToken=getToken;this.onAssetError=onAssetError;
    this.container=container;this.objectRoots=new Map();this.hitSource=null;this.reticleVisible=false;
    this.modelCache=new Map();
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x0a1b29);
    this.camera=new THREE.PerspectiveCamera(65,1,.02,300);this.camera.position.set(0,1.7,3.7);this.camera.lookAt(0,.8,-1.3);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.xr.enabled=true;
    this.renderer.shadowMap.enabled=true;this.renderer.outputColorSpace=THREE.SRGBColorSpace;container.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xb8e7ff,0x2b3c43,2.1));
    const sun=new THREE.DirectionalLight(0xffe9cc,2.4);sun.position.set(-2,6,4);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);this.scene.add(sun);
    this.floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x163149,roughness:1}));this.floor.rotation.x=-Math.PI/2;this.floor.receiveShadow=true;this.scene.add(this.floor);
    this.grid=new THREE.GridHelper(200,200,0x2e8499,0x24506a);this.grid.position.y=.002;this.scene.add(this.grid);
    this.reticle=new THREE.Mesh(new THREE.RingGeometry(.06,.075,32),new THREE.MeshBasicMaterial({color:0x5ef7d7,side:THREE.DoubleSide}));this.reticle.rotation.x=-Math.PI/2;this.reticle.visible=false;this.scene.add(this.reticle);
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    this.controller=this.renderer.xr.getController(0);this.scene.add(this.controller);this.controller.addEventListener('select',()=>this.selectFromController());
    this.renderer.xr.addEventListener('sessionstart',()=>this.onSessionStart());
    this.renderer.xr.addEventListener('sessionend',()=>this.onSessionEnd());
    this.renderer.domElement.addEventListener('pointerup',e=>this.selectFromPointer(e));
    this.resize=()=>{this.camera.aspect=container.clientWidth/container.clientHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(container.clientWidth,container.clientHeight);};
    addEventListener('resize',this.resize);this.resize();
    this.renderer.setAnimationLoop((time,frame)=>this.animate(time,frame));
  }
  async initXR(buttons){
    if(!navigator.xr){buttons.textContent='WebXR unavailable in this browser';return;}
    const [ar,vr]=await Promise.all(['immersive-ar','immersive-vr'].map(mode=>navigator.xr.isSessionSupported(mode).catch(()=>false)));
    if(ar){const button=ARButton.createButton(this.renderer,{optionalFeatures:['hit-test','anchors','local-floor']});button.textContent='Enter AR';buttons.append(button);}
    if(vr){const button=VRButton.createButton(this.renderer);button.textContent='Enter VR';buttons.append(button);}
    if(!ar&&!vr)buttons.textContent='XR requires a compatible headset browser';
  }
  async onSessionStart(){
    const session=this.renderer.xr.getSession();this.isAR=session.environmentBlendMode==='alpha-blend';
    this.floor.visible=!this.isAR;this.grid.visible=!this.isAR;this.scene.background=this.isAR?null:new THREE.Color(0x0a1b29);
    document.getElementById('view-label').textContent=this.isAR?'WEBXR AR · SESSION-LOCAL PLACEMENT':'WEBXR VR · VIRTUAL ROOM';
    if(this.isAR){try{const viewer=await session.requestReferenceSpace('viewer');this.hitSource=await session.requestHitTestSource({space:viewer});}catch{this.hitSource=null;}}
  }
  onSessionEnd(){this.hitSource?.cancel();this.hitSource=null;this.reticle.visible=false;this.isAR=false;this.floor.visible=true;this.grid.visible=true;this.scene.background=new THREE.Color(0x0a1b29);document.getElementById('view-label').textContent='DESKTOP · VIRTUAL ROOM';}
  sync(){
    for(const root of this.objectRoots.values()){this.scene.remove(root);disposeGroup(root);}
    this.objectRoots.clear();
    for(const object of this.world.scene.objects){
      const root=new THREE.Group();root.userData.objectId=object.objectId;root.position.copy(v3(object.transform.position));
      root.rotation.set(...['x','y','z'].map(k=>THREE.MathUtils.degToRad(object.transform.rotation[k])),'XYZ');
      root.scale.copy(v3(object.transform.scale));
      const asset=this.world.asset(object.assetId);
      const visual=asset.url?new THREE.Group():makeAsset(object.assetId);
      if(asset.url){
        const placeholder=new THREE.Mesh(new THREE.BoxGeometry(.35,.35,.35),new THREE.MeshBasicMaterial({color:0x5ee3cf,wireframe:true}));placeholder.position.y=.175;visual.add(placeholder);
      }
      visual.userData.objectId=object.objectId;root.add(visual);root.userData.visual=visual;root.userData.behaviors=object.behaviors||[];
      this.scene.add(root);this.objectRoots.set(object.objectId,root);
      if(asset.url)this.loadExternal(asset,root,visual,object.objectId);
    }
    this.highlight();
  }
  async loadExternal(asset,root,visual,objectId){
    try{
      let pending=this.modelCache.get(asset.assetId);
      if(!pending){
        if(this.modelCache.size>=24)throw Error('Web runtime has reached its 24-model cache limit');
        const loader=new GLTFLoader();const token=this.getToken();if(token)loader.setRequestHeader({Authorization:`Bearer ${token}`});
        pending=loader.loadAsync(asset.url).then(gltf=>{
          const scene=gltf.scene;
          const bounds=new THREE.Box3().setFromObject(scene);const size=bounds.getSize(new THREE.Vector3());
          if(!['x','y','z'].every(k=>Number.isFinite(size[k])&&size[k]>=0&&size[k]<=20)||size.lengthSq()===0)throw Error('GLB needs finite rendered bounds of 0–20 metres on each axis');
          const center=bounds.getCenter(new THREE.Vector3());scene.position.sub(new THREE.Vector3(center.x,bounds.min.y,center.z));
          scene.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
          return scene;
        });
        this.modelCache.set(asset.assetId,pending);
      }
      const source=await pending;
      if(this.objectRoots.get(objectId)!==root)return;
      const model=source.clone(true);
      model.traverse(node=>{if(node.isMesh){node.userData.cachedGeometry=true;node.material=Array.isArray(node.material)?node.material.map(material=>material.clone()):node.material.clone();}});
      for(const child of [...visual.children]){visual.remove(child);disposeGroup(child);}
      visual.add(model);
    }catch(error){this.modelCache.delete(asset.assetId);this.onAssetError(`${asset.displayName}: ${error.message}`);}
  }
  highlight(){
    for(const [id,root] of this.objectRoots){
      root.traverse(node=>{if(node.isMesh&&node.material?.emissive){node.material.emissiveIntensity=id===this.world.selection.objectId?2.2:1;}});
    }
  }
  selectFromPointer(event){
    if(this.renderer.xr.isPresenting||event.button!==0)return;
    const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);this.selectFromRay();
  }
  selectFromController(){
    this.controller.updateMatrixWorld(true);const origin=new THREE.Vector3().setFromMatrixPosition(this.controller.matrixWorld);
    const direction=new THREE.Vector3(0,0,-1).applyQuaternion(this.controller.getWorldQuaternion(new THREE.Quaternion()));
    this.raycaster.set(origin,direction);this.selectFromRay();
  }
  selectFromRay(){
    const roots=[...this.objectRoots.values()];const hits=this.raycaster.intersectObjects(roots,true);
    if(hits.length){let node=hits[0].object;while(node&&!node.userData.objectId)node=node.parent;
      const id=node?.userData.objectId;if(id){const object=this.world.requireObject(id);this.world.setSelection(id,object.transform.position);this.highlight();this.onSelection();return;}}
    if(this.isAR&&this.reticleVisible){this.world.setSelection('',plain(this.reticle.position));this.highlight();this.onSelection();return;}
    const floorHit=this.raycaster.intersectObject(this.floor)[0];
    if(floorHit){const position=plain(floorHit.point);if(['x','y','z'].every(k=>Math.abs(position[k])<=100)){this.world.setSelection('',position);this.highlight();this.onSelection();}}
  }
  viewer(){
    const camera=this.renderer.xr.isPresenting?this.renderer.xr.getCamera():this.camera;
    const position=camera.getWorldPosition(new THREE.Vector3());const direction=new THREE.Vector3(0,0,-1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const horizontal=direction.clone().setY(0);if(horizontal.length()<.01)horizontal.set(0,0,-1);horizontal.normalize();
    return {frames:[{anchorId:'web-floor',position:plain(position),forward:plain(horizontal),lookDirection:plain(direction.normalize())}]};
  }
  animate(time,frame){
    if(this.hitSource&&frame){const hits=frame.getHitTestResults(this.hitSource);const ref=this.renderer.xr.getReferenceSpace();const pose=hits[0]?.getPose(ref);
      this.reticleVisible=!!pose;this.reticle.visible=!!pose;if(pose){this.reticle.position.setFromMatrixPosition(new THREE.Matrix4().fromArray(pose.transform.matrix));}}
    for(const root of this.objectRoots.values()){
      const visual=root.userData.visual;visual.position.y=0;visual.rotation.set(0,0,0);
      for(const behavior of root.userData.behaviors){if(!behavior.enabled)continue;const t=behavior.paused?0:time/1000;
        if(behavior.kind==='bob')visual.position.y+=(1-Math.cos(2*Math.PI*behavior.frequencyHz*t))*.5*behavior.amplitudeMeters;
        if(behavior.kind==='rotate')visual.rotation[behavior.axis]+=THREE.MathUtils.degToRad(behavior.speedDegreesPerSecond*t);
      }
    }
    this.renderer.render(this.scene,this.camera);
  }
}
