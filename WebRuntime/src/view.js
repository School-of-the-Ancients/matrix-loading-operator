import * as THREE from 'three';
import {ARButton} from 'three/addons/webxr/ARButton.js';
import {VRButton} from 'three/addons/webxr/VRButton.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {beginGrab,moveGrab,finishGrab,beginPointerGrab,movePointerGrab,movePointerGrabVertical,finishPointerGrab,moveDesktopCamera} from './grab.js';
import {viewerPose,planeData,insideBoundary,matchPlaneAnchor,samePlaneShape,measuredFloorHeight} from './spatial.js';
import {ROOM_ANCHOR_KEY,hasWorldToProtect} from './room_origin.js';

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
export function validateRenderedFootprint(asset,size){
  const bounds=asset.localBounds;
  if(bounds&&(size.x>bounds.size.x+.005||size.z>bounds.size.z+.005))
    throw Error('GLB rendered footprint exceeds its registered bounds; remeasure and register the asset');
}
function disposeGroup(root){root.traverse(node=>{if(node.geometry&&!node.userData.cachedGeometry)node.geometry.dispose();if(node.material){const materials=Array.isArray(node.material)?node.material:[node.material];for(const material of materials){if(node.userData.ownedTexture)material.map?.dispose();material.dispose();}}});}
function planeLabel(label){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#102936';ctx.fillRect(0,0,512,96);ctx.strokeStyle='#5ef7d7';ctx.lineWidth=4;ctx.strokeRect(2,2,508,92);
  ctx.fillStyle='#e9ffff';ctx.font='bold 38px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label.slice(0,24),256,48);
  const texture=new THREE.CanvasTexture(canvas);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false}));
  sprite.userData.ownedTexture=true;sprite.scale.set(.7,.13,1);sprite.position.set(0,.075,0);return sprite;
}
function operatorPanel(){
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=768;
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(.96,.72),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
  mesh.renderOrder=100;mesh.userData.operatorVoice=true;
  const group=new THREE.Group();group.add(mesh);group.visible=false;
  let message='Aim here, hold trigger, and ask for a scene.',tone='idle',page=0,mode='chat',proposal=null;
  let agent={activity:'Not connected',content:'Connect to Codex on the PC.',pending:false,approvalReviewable:false,active:false,connected:false};
  let pinLabel='PIN TO WALL',voiceLabel='VOICE ON',originLabel='ROOM ORIGIN UNKNOWN',conversationCount=0;
  let gameStatus='No game running.',worldInfo={objects:0,canConfirm:false,alignment:'No room scan'},worldWarning='';
  let cameraStatus='Camera not tested',cameraActive=false;
  let buttons=[];
  const paint=()=>{
    const ctx=canvas.getContext('2d');ctx.fillStyle='#071923';ctx.fillRect(0,0,1024,768);
    ctx.strokeStyle=tone==='error'?'#ffad8d':'#55e9d2';ctx.lineWidth=9;ctx.strokeRect(10,10,1004,748);
    ctx.fillStyle='#75f4df';ctx.font='bold 51px sans-serif';ctx.fillText('◈  OPERATOR',55,90);
    buttons=[];
    const button=(id,label,x,y,w,h,active=false)=>{
      ctx.fillStyle=active?'#53dcc5':'#245568';ctx.fillRect(x,y,w,h);
      ctx.fillStyle=active?'#062b34':'#e9f9fa';ctx.font=`bold ${label.length>15?21:25}px sans-serif`;
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x+w/2,y+h/2);ctx.textAlign='left';ctx.textBaseline='alphabetic';
      buttons.push({id,x,y,w,h});
    };
    button('toggle-agent',mode==='agent'?'CHAT':'CODEX',414,35,118,72,mode==='agent');
    button('toggle-world',mode==='world'?'CHAT':'WORLD',544,35,210,72);
    button(proposal&&mode!=='proposal'?'open-proposal':'review-view',proposal&&mode!=='proposal'?'PROPOSAL':'REVIEW VIEW',766,35,210,72);
    ctx.fillStyle='#8bb8c2';ctx.font='bold 21px sans-serif';ctx.fillText(originLabel,55,123);
    if(mode==='world'){
      ctx.fillStyle='#dff7f8';ctx.font='29px sans-serif';
      ctx.fillText(`${worldInfo.objects} scene objects · ${worldInfo.alignment}`,55,180);
      ctx.font='25px sans-serif';
      const label=gameStatus.length>70?gameStatus.slice(0,67)+'…':gameStatus;
      ctx.fillText(label,55,235);
      ctx.fillStyle='#8bb8c2';ctx.fillText(`Conversation: ${conversationCount} recent turn${conversationCount===1?'':'s'}`,55,290);
      if(worldInfo.originUnavailable&&worldInfo.canRetryOrigin)
        button('retry-room-origin','RETRY SAVED ROOM ORIGIN',55,328,914,76,true);
      else if(worldInfo.canConfirm)button('confirm-room','OUTLINES ALIGN — ENABLE EDITING',55,328,914,76,true);
      else {ctx.fillStyle='#8bb8c2';ctx.font='24px sans-serif';ctx.fillText(
        worldInfo.originUnavailable?worldInfo.resetAvailable?'Old world hidden. Choose a new room deliberately.':'Waiting for a tracked room anchor.':
        worldInfo.alignment==='AR room aligned'?'Room confirmed; measured editing enabled.':
        'Room confirmation appears when AR support planes are detected.',55,380);}
      ctx.fillStyle='#8bb8c2';ctx.font='21px sans-serif';
      ctx.fillText(`Camera: ${cameraStatus.slice(0,75)}`,55,424);
      if(worldInfo.originUnavailable){
        ctx.fillStyle='#8bb8c2';ctx.font='22px sans-serif';
        ctx.fillText('SAVE / RESTORE / EDIT LOCKED UNTIL ORIGIN RECOVERS',55,485);
      }else{
        button('save-world','SAVE WORLD',55,440,285,76);
        button('restore-world',worldInfo.restoreArmed?'CONFIRM RESTORE':'RESTORE SAVED',370,440,285,76);
        button('undo','UNDO',685,440,285,76);
      }
      if(worldInfo.resetAvailable){
        button('rebase-room-origin',worldInfo.recoveryArmed==='rebase'?'CONFIRM PLACE HERE':'ARCHIVE + PLACE HERE',55,535,440,76);
        button('reset-room-origin',worldInfo.recoveryArmed==='empty'?'CONFIRM START EMPTY':'ARCHIVE + START EMPTY',525,535,445,76);
      }else{
        button('redo','REDO',55,535,285,76);
        button('new-chat','NEW CHAT',370,535,285,76);
        button('toggle-camera',cameraActive?'STOP CAMERA':'ENABLE CAMERA',685,535,285,76);
      }
    }else{
      const content=mode==='agent'?`CODEX AGENT · ${agent.activity}\n\n${agent.content}`:mode==='proposal'&&proposal?
        `REVIEW BEFORE APPLY\n${proposal.summary||''}\n\n${proposal.kind==='game'?
          `GAME: ${proposal.gamePlan?.title||''}\nROLES\n${proposal.gamePlan?.roles?.map(role=>`${role.count} × ${role.assetId} as ${role.roleId} (${role.kind})`).join('\n')||''}\nRULES\n${proposal.gamePlan?.rules?.map(rule=>`${rule.actorRoleId} → ${rule.targetRoleId}: ${rule.event} within ${rule.distanceMeters} m, +${rule.scorePoints}`).join('\n')||''}\nOBJECTIVES\n${proposal.gamePlan?.objectives?.map(objective=>objective.kind==='score-at-least'?`At least ${objective.targetPoints} points`:`${objective.roleId}: ${objective.targetCount} delivered`).join('\n')||''}`:
          `COMMANDS (${proposal.commands?.length||0})\n${JSON.stringify(proposal.commands||[],null,2)}`}`:message;
      ctx.font=content.length>500?'24px sans-serif':'30px sans-serif';ctx.fillStyle='#dff7f8';
      const lines=[];
      for(const paragraph of content.split('\n')){
        let line='';
        for(const word of paragraph.split(/\s+/)){
          const next=line?`${line} ${word}`:word;
          if(ctx.measureText(next).width>900&&line){lines.push(line);line=word;}else line=next;
        }
        lines.push(line);
      }
      const perPage=content.length>500?14:12,pages=Math.max(1,Math.ceil(lines.length/perPage));page%=pages;
      const step=content.length>500?30:37;
      lines.slice(page*perPage,(page+1)*perPage).forEach((line,index)=>ctx.fillText(line,55,160+index*step));
      ctx.fillStyle='#8bb8c2';ctx.font='24px sans-serif';ctx.fillText(`Page ${page+1}/${pages}`,55,596);
    }
    if(worldWarning){ctx.fillStyle='#ffad8d';ctx.font='bold 19px sans-serif';ctx.fillText(worldWarning,55,625);}
    if(mode==='agent'){
      if(agent.pending){
        if(agent.approvalReviewable)button('agent-approve','APPROVE ONCE',35,636,275,90,true);
        else {ctx.fillStyle='#183744';ctx.fillRect(35,636,275,90);
          ctx.fillStyle='#a8c8ce';ctx.font='bold 20px sans-serif';ctx.fillText('PC REVIEW NEEDED',50,691);}
        button('agent-deny','DENY',322,636,220,90);
        button('agent-stop','STOP',554,636,210,90);
        button('next','NEXT',776,636,213,90);
      }else{
        button(agent.active?'agent-stop':agent.connected?'voice':'agent-connect',
          agent.active?'STOP TURN':agent.connected?'HOLD TO SPEAK':'CONNECT CODEX',35,636,472,90,agent.active);
        button('pin',pinLabel,519,636,210,90);
        button('next','NEXT',741,636,248,90);
      }
    }else if(mode==='proposal'&&proposal){
      button('voice','HOLD TO SPEAK',35,636,330,90,true);
      button('apply','APPLY',377,636,207,90,true);
      button('discard','DISCARD',596,636,207,90);
      button('next','NEXT',815,636,174,90);
    }else{
      button('voice','HOLD TO SPEAK',35,636,472,90,true);
      button('pin',pinLabel,519,636,210,90);
      button('voice-output',voiceLabel,741,636,132,90);
      button('next','NEXT',885,636,104,90);
    }
    texture.needsUpdate=true;
  };
  const setMessage=(next,nextTone='idle')=>{message=String(next);tone=nextTone;page=0;paint();};
  const setPinLabel=next=>{pinLabel=next;paint();};
  const setVoiceLabel=next=>{voiceLabel=next;paint();};
  const setOriginLabel=next=>{if(originLabel!==next){originLabel=next;paint();}};
  const setConversationCount=next=>{conversationCount=next;paint();};
  const setProposal=next=>{proposal=next;if(next)mode='proposal';else if(mode==='proposal')mode='chat';page=0;paint();};
  const setWorldInfo=next=>{if(JSON.stringify(worldInfo)!==JSON.stringify(next)){worldInfo=next;paint();}};
  const setGameStatus=next=>{if(gameStatus!==next){gameStatus=next;paint();}};
  const setWarning=next=>{if(worldWarning!==next){worldWarning=next;paint();}};
  const setCameraStatus=(next,active)=>{if(cameraStatus!==next||cameraActive!==active){cameraStatus=next;cameraActive=active;paint();}};
  const setAgentStatus=next=>{if(JSON.stringify(agent)!==JSON.stringify(next)){
    if(agent.pending!==next.pending)page=0;
    agent=next;if(mode==='agent')paint();
  }};
  const toggleWorld=()=>{mode=mode==='world'?'chat':'world';page=0;paint();};
  const toggleAgent=()=>{mode=mode==='agent'?'chat':'agent';page=0;paint();};
  const isAgentMode=()=>mode==='agent';
  const openProposal=()=>{if(proposal){mode='proposal';page=0;paint();}};
  const hit=uv=>{
    if(!uv)return null;const x=uv.x*1024,y=(1-uv.y)*768;
    return buttons.find(item=>x>=item.x&&x<=item.x+item.w&&y>=item.y&&y<=item.y+item.h)?.id||null;
  };
  const nextPage=()=>{page++;paint();};
  paint();
  return {group,mesh,setMessage,setPinLabel,setVoiceLabel,setOriginLabel,setConversationCount,
    setProposal,setWorldInfo,setGameStatus,setWarning,setCameraStatus,setAgentStatus,toggleWorld,toggleAgent,isAgentMode,openProposal,hit,nextPage};
}
const v3=v=>new THREE.Vector3(v.x,v.y,v.z);
const plain=v=>({x:Number(v.x.toFixed(3)),y:Number(v.y.toFixed(3)),z:Number(v.z.toFixed(3))});

export class MatrixView {
  constructor(container,world,onSelection,getToken=()=>'',onAssetError=()=>{},onSceneEdit=()=>{},onRuntimeChange=()=>{},onVoiceStart=()=>{},onVoiceEnd=()=>{},onVoiceOutputToggle=()=>{},onVisualReview=()=>{},onNewChat=()=>{}){
    this.world=world;this.onSelection=onSelection;this.getToken=getToken;this.onAssetError=onAssetError;this.onSceneEdit=onSceneEdit;this.onRuntimeChange=onRuntimeChange;this.onVoiceStart=onVoiceStart;this.onVoiceEnd=onVoiceEnd;this.onVoiceOutputToggle=onVoiceOutputToggle;this.onVisualReview=onVisualReview;this.onNewChat=onNewChat;this.onPanelAction=()=>{};this.onFrame=()=>{};
    this.container=container;this.objectRoots=new Map();this.anchorRoots=new Map();this.planeOutlines=new Map();this.planeIds=new WeakMap();this.nextPlaneId=0;this.hitSource=null;this.reticleVisible=false;this.xrViewer=null;this.reticleAnchorId='';this.lastPlaneTime=0;
    this.modelCache=new Map();
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x0a1b29);
    this.virtualFloorRoot=new THREE.Group();this.scene.add(this.virtualFloorRoot);
    this.roomAnchor=null;this.roomAnchorPending=false;this.roomAnchorCreationFailed=false;this.roomAnchorPersistent=false;this.roomAnchorRestoreFailed=false;this.roomAnchorLocated=false;this.roomAnchorHandleAvailable=false;this.roomPoseMissingSince=0;
    const storedEyeHeight=Number(sessionStorage.getItem('matrix-web-eye-height'));
    this.measuredEyeHeight=storedEyeHeight>=.4&&storedEyeHeight<=2.5?storedEyeHeight:null;
    this.virtualFloorCalibrated=false;
    this.camera=new THREE.PerspectiveCamera(65,1,.02,300);this.camera.position.set(0,1.7,3.7);this.camera.lookAt(0,.8,-1.3);
    this.camera.rotation.reorder('YXZ');this.keys=new Set();this.lastFrameTime=null;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.xr.enabled=true;
    this.renderer.shadowMap.enabled=true;this.renderer.outputColorSpace=THREE.SRGBColorSpace;container.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xb8e7ff,0x2b3c43,2.1));
    const sun=new THREE.DirectionalLight(0xffe9cc,2.4);sun.position.set(-2,6,4);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);this.scene.add(sun);
    this.floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x163149,roughness:1}));this.floor.rotation.x=-Math.PI/2;this.floor.receiveShadow=true;this.virtualFloorRoot.add(this.floor);
    this.grid=new THREE.GridHelper(200,200,0x2e8499,0x24506a);this.grid.position.y=.002;this.virtualFloorRoot.add(this.grid);
    this.reticle=new THREE.Mesh(new THREE.RingGeometry(.06,.075,32),new THREE.MeshBasicMaterial({color:0x5ef7d7,side:THREE.DoubleSide}));this.reticle.rotation.x=-Math.PI/2;this.reticle.visible=false;this.scene.add(this.reticle);
    this.operatorPanel=operatorPanel();this.scene.add(this.operatorPanel.group);this.operatorVoiceController=null;this.operatorMount={kind:'head'};
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    this.controllers=[0,1].map(index=>this.renderer.xr.getController(index));
    this.controllerRays=[];
    for(const controller of this.controllers){
      this.scene.add(controller);
      const ray=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-4)]),
        new THREE.LineBasicMaterial({color:0x5ef7d7,transparent:true,opacity:.7}));
      ray.visible=false;controller.add(ray);this.controllerRays.push(ray);
      controller.addEventListener('selectstart',()=>this.selectFromController(controller));
      controller.addEventListener('selectend',()=>{this.releaseOperatorVoice(controller);this.releaseGrab(controller);});
      controller.addEventListener('squeezestart',()=>this.onVoiceStart());
      controller.addEventListener('squeezeend',()=>this.onVoiceEnd());
    }
    this.grab=null;this.pointerGrab=null;this.pointerLook=null;
    this.renderer.xr.addEventListener('sessionstart',()=>this.onSessionStart());
    this.renderer.xr.addEventListener('sessionend',()=>this.onSessionEnd());
    this.renderer.domElement.addEventListener('pointerdown',e=>this.pointerDown(e));
    this.renderer.domElement.addEventListener('pointermove',e=>this.pointerMove(e));
    this.renderer.domElement.addEventListener('pointerup',e=>this.pointerUp(e));
    this.renderer.domElement.addEventListener('pointercancel',()=>this.cancelPointer());
    this.renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
    addEventListener('keydown',e=>{if(!this.renderer.xr.isPresenting&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&
      !['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName)&&!e.target?.isContentEditable&&
      ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].includes(e.code)){
      e.preventDefault();this.keys.add(e.code);
    }});
    addEventListener('keyup',e=>this.keys.delete(e.code));
    addEventListener('blur',()=>this.keys.clear());
    this.resize=()=>{this.camera.aspect=container.clientWidth/container.clientHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(container.clientWidth,container.clientHeight);};
    addEventListener('resize',this.resize);this.resize();
    this.renderer.setAnimationLoop((time,frame)=>this.animate(time,frame));
  }
  async initXR(buttons){
    if(!navigator.xr){buttons.textContent='WebXR unavailable in this browser';return;}
    const [ar,vr]=await Promise.all(['immersive-ar','immersive-vr'].map(mode=>navigator.xr.isSessionSupported(mode).catch(()=>false)));
    const overlay=document.getElementById('xr-overlay');
    if(ar){const button=ARButton.createButton(this.renderer,{requiredFeatures:['plane-detection'],optionalFeatures:['hit-test','anchors','local-floor','dom-overlay'],domOverlay:{root:overlay}});button.textContent='Enter AR';buttons.append(button);}
    if(vr){const button=VRButton.createButton(this.renderer,{optionalFeatures:['anchors','dom-overlay'],domOverlay:{root:overlay}});button.textContent='Enter VR';buttons.append(button);}
    if(!ar&&!vr)buttons.textContent='XR requires a compatible headset browser';
  }
  async onSessionStart(){
    const session=this.renderer.xr.getSession();this.isAR=session.environmentBlendMode!=='opaque';
    if(session.domOverlayState)document.getElementById('xr-overlay').style.display='';
    this.operatorPanel.group.visible=true;
    this.operatorMount={kind:'head'};this.operatorPanel.setPinLabel(this.isAR?'PIN TO WALL':'PIN HERE');
    this.sessionStartedAt=performance.now();this.roomCaptureRequested=false;this.virtualFloorCalibrated=false;this.roomAnchorCreationFailed=false;this.roomAnchorRestoreFailed=false;this.roomAnchorLocated=false;this.roomPoseMissingSince=0;
    if(this.isAR)this.world.enterAR();
    this.restoreRoomAnchor(session);
    if(this.isAR){this.sync();this.onRuntimeChange();}
    for(const ray of this.controllerRays)ray.visible=true;
    this.floor.visible=!this.isAR;this.grid.visible=!this.isAR;this.scene.background=this.isAR?null:new THREE.Color(0x0a1b29);
    document.getElementById('view-label').textContent=this.isAR?'WEBXR AR · SCANNING ROOM PLANES':'WEBXR VR · VIRTUAL ROOM';
    if(this.isAR){try{const viewer=await session.requestReferenceSpace('viewer');this.hitSource=await session.requestHitTestSource({space:viewer});}catch{this.hitSource=null;}}
  }
  restoreRoomAnchor(session){
    this.roomAnchor=null;this.roomAnchorPending=false;this.roomAnchorPersistent=false;this.roomAnchorHandleAvailable=false;this.roomPoseMissingSince=0;
    let handle;
    try{handle=localStorage.getItem(ROOM_ANCHOR_KEY);}
    catch(error){
      if(this.isAR)this.markRoomOriginUnavailable(`Room anchor storage: ${error.message}`);
      return;
    }
    this.roomAnchorHandleAvailable=!!handle;
    if(!handle){
      if(this.isAR&&hasWorldToProtect(this.world))
        this.markRoomOriginUnavailable('Saved world has no persistent room anchor. Retry or archive it before starting a new room.');
      return;
    }
    if(typeof session.restorePersistentAnchor!=='function'){
      if(this.isAR)this.markRoomOriginUnavailable('Saved room origin cannot be restored by this browser session');
      return;
    }
    if(this.isAR){this.virtualFloorRoot.visible=false;this.world.setOriginUnavailable(true);}
    this.roomAnchorPending=true;
    let restored;
    try{restored=session.restorePersistentAnchor(handle);}
    catch(error){this.roomAnchorPending=false;if(this.isAR)this.markRoomOriginUnavailable(`Room anchor restore: ${error.message}`);return;}
    Promise.resolve(restored).then(anchor=>{
      if(!anchor?.anchorSpace)throw Error('Quest returned no room anchor space');
      if(this.renderer.xr.getSession()===session){this.roomAnchor=anchor;this.roomAnchorPersistent=true;}
    }).catch(error=>{
      // Never silently replace a saved physical origin with the current head
      // pose. A relocalization failure must leave prior objects hidden.
      if(this.renderer.xr.getSession()===session&&this.isAR){this.roomAnchorPending=false;this.markRoomOriginUnavailable(`Room anchor restore: ${error.message}`);}
    }).finally(()=>{if(this.renderer.xr.getSession()===session)this.roomAnchorPending=false;});
  }
  markRoomOriginUnavailable(message){
    this.roomAnchorRestoreFailed=true;this.virtualFloorRoot.visible=false;
    this.world.setOriginUnavailable(true);
    this.onAssetError(message);
    this.onRuntimeChange();
  }
  retryRoomOrigin(){
    const session=this.renderer.xr.getSession();
    if(!this.isAR||!session||this.roomAnchorPending)return false;
    if(this.roomAnchorRestoreFailed&&this.roomAnchorHandleAvailable){
      this.roomAnchorRestoreFailed=false;
      this.restoreRoomAnchor(session);
      return true;
    }
    if(this.roomAnchorCreationFailed){
      this.roomAnchorCreationFailed=false;this.roomAnchor=null;this.roomAnchorLocated=false;
      this.roomPoseMissingSince=0;this.virtualFloorRoot.visible=false;
      return true;
    }
    return false;
  }
  startNewRoomOrigin(){
    if(!this.isAR||!this.world.spatial?.originUnavailable)throw Error('Room origin reset requires an unavailable AR origin');
    this.roomAnchor=null;this.roomAnchorPending=false;this.roomAnchorPersistent=false;
    this.roomAnchorRestoreFailed=false;this.roomAnchorCreationFailed=false;this.roomAnchorLocated=false;this.roomAnchorHandleAvailable=false;this.roomPoseMissingSince=0;
    this.virtualFloorRoot.visible=false;
  }
  createRoomAnchor(frame,ref,floorHeight){
    if(this.roomAnchor||this.roomAnchorPending||this.roomAnchorCreationFailed||this.roomAnchorRestoreFailed||typeof frame.createAnchor!=='function'||!this.xrViewer||typeof XRRigidTransform==='undefined')return;
    const head=this.xrViewer.position,forward=this.xrViewer.direction.clone().setY(0).normalize();
    const yaw=Math.atan2(-forward.x,-forward.z);
    const orientation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
    const position=new THREE.Vector3(head.x,floorHeight,head.z);
    this.virtualFloorRoot.position.copy(position);this.virtualFloorRoot.quaternion.copy(orientation);
    this.roomAnchorPending=true;
    const session=frame.session;
    let created;
    try{created=frame.createAnchor(new XRRigidTransform(position,orientation),ref);}
    catch(error){this.roomAnchorPending=false;this.roomAnchorCreationFailed=true;this.onAssetError(`Room anchor: ${error.message}`);return;}
    Promise.resolve(created).then(async anchor=>{
      if(this.renderer.xr.getSession()!==session)return;
      this.roomAnchor=anchor;
      if(typeof anchor.requestPersistentHandle==='function'){
        const handle=await anchor.requestPersistentHandle();
        if(this.renderer.xr.getSession()===session){localStorage.setItem(ROOM_ANCHOR_KEY,handle);this.roomAnchorPersistent=true;this.roomAnchorHandleAvailable=true;}
      }
    }).catch(error=>{if(this.renderer.xr.getSession()===session){this.roomAnchorCreationFailed=true;this.onAssetError(`Room anchor: ${error.message}`);}})
      .finally(()=>{if(this.renderer.xr.getSession()===session)this.roomAnchorPending=false;});
  }
  updateRoomAnchor(frame,ref){
    if(!this.roomAnchor)return;
    const pose=frame.getPose(this.roomAnchor.anchorSpace,ref);
    if(!pose){
      if(!this.isAR)return;
      if(!this.roomPoseMissingSince)this.roomPoseMissingSince=performance.now();
      if(this.roomAnchorLocated){
        this.roomAnchorLocated=false;this.virtualFloorRoot.visible=false;
        this.world.setOriginUnavailable(true);this.onRuntimeChange();
      }
      if(!this.roomAnchorRestoreFailed&&performance.now()-this.roomPoseMissingSince>10000){
        this.roomAnchorRestoreFailed=true;
        this.onAssetError('Room anchor pose has been unavailable for ten seconds; old world remains hidden.');
        this.onRuntimeChange();
      }
      return;
    }
    this.roomPoseMissingSince=0;this.roomAnchorRestoreFailed=false;
    this.virtualFloorRoot.position.copy(v3(pose.transform.position));
    const {x,y,z,w}=pose.transform.orientation;
    this.virtualFloorRoot.quaternion.set(x,y,z,w);
    this.virtualFloorRoot.visible=true;
    this.roomAnchorLocated=true;
    this.virtualFloorCalibrated=true;
    if(this.world.spatial?.originUnavailable){this.world.setOriginUnavailable(false);this.onRuntimeChange();}
  }
  onSessionEnd(){
    if(this.operatorVoiceController)this.releaseOperatorVoice(this.operatorVoiceController);
    this.operatorPanel.group.visible=false;this.operatorMount={kind:'head'};
    this.operatorPanel.setPinLabel('PIN TO WALL');this.operatorPanel.setOriginLabel('ROOM ORIGIN UNKNOWN');
    if(this.grab)this.releaseGrab(this.grab.controller);
    for(const ray of this.controllerRays)ray.visible=false;
    this.hitSource?.cancel();this.hitSource=null;this.reticle.visible=false;this.reticleVisible=false;this.reticleAnchorId='';
    this.xrViewer=null;this.planeIds=new WeakMap();this.nextPlaneId=0;this.clearPlanes();this.isAR=false;
    this.roomAnchor=null;this.roomAnchorPending=false;this.roomAnchorPersistent=false;this.roomAnchorRestoreFailed=false;this.roomAnchorLocated=false;this.roomAnchorHandleAvailable=false;this.roomPoseMissingSince=0;
    this.virtualFloorRoot.visible=true;this.virtualFloorRoot.position.set(0,0,0);this.virtualFloorRoot.quaternion.identity();this.virtualFloorCalibrated=false;
    this.world.leaveAR();this.sync();this.onRuntimeChange();
    document.getElementById('xr-overlay').style.display='none';this.floor.visible=true;this.grid.visible=true;
    this.scene.background=new THREE.Color(0x0a1b29);document.getElementById('view-label').textContent='DESKTOP · VIRTUAL ROOM';
  }
  setOperatorStatus(message,tone='idle'){this.operatorPanel.setMessage(message,tone);}
  setConversationCount(count){this.operatorPanel.setConversationCount(count);}
  setOperatorProposal(proposal){this.operatorPanel.setProposal(proposal);}
  setOperatorWorldInfo(info){this.operatorPanel.setWorldInfo(info);}
  setOperatorGameStatus(status){this.operatorPanel.setGameStatus(status);}
  setOperatorWarning(warning){this.operatorPanel.setWarning(warning);}
  setOperatorCameraStatus(status,active){this.operatorPanel.setCameraStatus(status,active);}
  setOperatorAgentStatus(status){this.operatorPanel.setAgentStatus(status);}
  isOperatorAgentMode(){return this.operatorPanel.isAgentMode();}
  setVoiceOutputEnabled(enabled){this.operatorPanel.setVoiceLabel(enabled?'VOICE ON':'VOICE OFF');}
  positionOperatorPanel(){
    if(!this.xrViewer)return;
    const group=this.operatorPanel.group,head=this.xrViewer;
    if(this.operatorMount.kind==='head'){
      group.position.copy(head.position).add(new THREE.Vector3(.53,-.16,-1.2).applyQuaternion(head.quaternion));
      group.quaternion.copy(head.quaternion);
    }else if(this.operatorMount.kind==='wall'){
      const mount=this.operatorMount,root=this.planeOutlines.get(mount.anchorId);
      if(root){
        group.position.copy(root.localToWorld(new THREE.Vector3(mount.x,.025*mount.sign,mount.z)));
        const normal=new THREE.Vector3(0,1,0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(mount.sign);
        group.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(group.position,group.position.clone().sub(normal),new THREE.Vector3(0,1,0)));
      }
    }
    group.updateMatrixWorld(true);
  }
  toggleOperatorPin(){
    if(this.operatorMount.kind!=='head'){
      this.operatorMount={kind:'head'};this.operatorPanel.setPinLabel(this.isAR?'PIN TO WALL':'PIN HERE');this.positionOperatorPanel();return;
    }
    this.positionOperatorPanel();
    const head=this.xrViewer;let best=null;
    if(this.isAR&&head)for(const anchor of this.world.spatial?.anchors||[]){
      if(anchor.surface.kind!=='wall'||!anchor.semanticLabels.includes('WALL'))continue;
      const root=this.planeOutlines.get(anchor.anchorId);if(!root)continue;
      const boundary=anchor.surface.boundary,xs=boundary.map(p=>p.x),zs=boundary.map(p=>p.z);
      const minX=Math.min(...xs)+.45,maxX=Math.max(...xs)-.45,minZ=Math.min(...zs)+.35,maxZ=Math.max(...zs)-.35;
      if(minX>=maxX||minZ>=maxZ)continue;
      const local=root.worldToLocal(head.position.clone());local.x=THREE.MathUtils.clamp(local.x,minX,maxX);local.y=0;local.z=THREE.MathUtils.clamp(local.z,minZ,maxZ);
      if(!insideBoundary(local,boundary))continue;
      const point=root.localToWorld(local.clone()),to=point.clone().sub(head.position),distance=to.length();
      if(distance<.4||distance>3.5)continue;
      const facing=head.direction.dot(to.normalize());if(facing<.2)continue;
      const score=distance+(1-facing)*4;
      if(!best||score<best.score){
        const normal=new THREE.Vector3(0,1,0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
        best={kind:'wall',anchorId:anchor.anchorId,x:local.x,z:local.z,sign:normal.dot(head.position.clone().sub(point))>=0?1:-1,score};
      }
    }
    this.operatorMount=best||{kind:'world'};
    this.operatorPanel.setPinLabel('FOLLOW ME');this.positionOperatorPanel();
  }
  clearPlanes(){for(const group of this.planeOutlines.values()){this.scene.remove(group);disposeGroup(group);}this.planeOutlines.clear();}
  anchorPose(group,anchor){const pose=anchor.roomPose;group.position.copy(v3(pose.position));group.rotation.set(...['x','y','z'].map(key=>THREE.MathUtils.degToRad(pose.rotation[key])),'XYZ');group.updateMatrixWorld(true);}
  updatePlanes(time,frame,ref){
    if(!this.isAR||time-this.lastPlaneTime<350)return;
    this.lastPlaneTime=time;
    const detected=frame.detectedPlanes||frame.session?.detectedPlanes;
    if(!detected)return;
    const raw=[];
    for(const plane of detected){if(raw.length>=64)break;const data=planeData(plane,frame,ref,'');if(data)raw.push({plane,data});}
    const anchors=[],present=new Set(),previous=this.world.spatial?.anchors||[],used=new Set();
    const pinned=previous.filter(anchor=>this.world.scene.objects.some(object=>object.anchorId===anchor.anchorId));
    for(const {plane,data} of raw){
      const unique=raw.filter(item=>samePlaneShape(item.data,data)).length===1;
      let id=this.planeIds.get(plane);
      if(unique){const recovery=matchPlaneAnchor(data,pinned,used);if(recovery)id=recovery;
        else if(!id)id=matchPlaneAnchor(data,previous,used);}
      if(!id||used.has(id))id=`webxr-plane-${++this.nextPlaneId}`;
      this.planeIds.set(plane,id);used.add(id);
      const {quaternion,...anchor}=data;anchor.anchorId=id;anchors.push(anchor);present.add(id);
      const key=JSON.stringify([anchor.displayName,anchor.surface.kind,anchor.surface.boundary]);
      let group=this.planeOutlines.get(id);
      if(group?.userData.key===key){this.anchorPose(group,anchor);const root=this.anchorRoots.get(id);if(root)this.anchorPose(root,anchor);continue;}
      if(group){this.scene.remove(group);disposeGroup(group);}
      group=new THREE.Group();this.anchorPose(group,anchor);group.userData.anchorId=id;group.userData.key=key;
      const corners=anchor.surface.boundary.map(vertex=>new THREE.Vector3(vertex.x,.004,vertex.z));
      const outline=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners),new THREE.LineBasicMaterial({color:anchor.surface.kind==='support'?0x5ef7d7:0x65aaff,transparent:true,opacity:.85}));group.add(outline);
      const label=planeLabel(anchor.displayName);group.userData.label=label;group.add(label);
      if(anchor.surface.kind==='support'){
        const shape=new THREE.Shape();shape.moveTo(corners[0].x,corners[0].z);for(const corner of corners.slice(1))shape.lineTo(corner.x,corner.z);
        const geometry=new THREE.ShapeGeometry(shape);geometry.rotateX(Math.PI/2);
        const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x5ef7d7,transparent:true,opacity:.025,side:THREE.DoubleSide,depthWrite:false}));mesh.userData.anchorId=id;group.add(mesh);
      }
      this.scene.add(group);this.planeOutlines.set(id,group);
      const root=this.anchorRoots.get(id);if(root)this.anchorPose(root,anchor);
    }
    for(const [id,group] of this.planeOutlines)if(!present.has(id)){this.scene.remove(group);disposeGroup(group);this.planeOutlines.delete(id);}
    this.world.setSpatialAnchors(anchors);
    const floorHeight=measuredFloorHeight(anchors,this.xrViewer?.position.y);
    if(floorHeight!==null){
      if(!this.roomAnchor)this.virtualFloorRoot.position.y=floorHeight;
      if(!this.virtualFloorCalibrated){
        this.measuredEyeHeight=this.xrViewer.position.y-floorHeight;
        sessionStorage.setItem('matrix-web-eye-height',String(this.measuredEyeHeight));
        this.virtualFloorCalibrated=true;
      }
      if(!this.roomAnchor)this.createRoomAnchor(frame,ref,floorHeight);
    }
    const floor=anchors.find(anchor=>anchor.semanticLabels.includes('FLOOR'))?.anchorId;
    for(const [id,group] of this.planeOutlines)group.userData.label.visible=id===floor||id===this.world.selection.anchorId;
    const origin=this.roomAnchorRestoreFailed?'ROOM RELOCALIZATION FAILED':this.roomAnchor&&this.roomAnchorLocated?(this.roomAnchorPersistent?'ROOM ANCHORED':'SESSION ANCHORED'):this.roomAnchorPending||this.roomAnchor?'ALIGNING ROOM':'ROOM ORIGIN UNAVAILABLE';
    this.operatorPanel.setOriginLabel(origin);
    document.getElementById('view-label').textContent=anchors.length?`WEBXR AR · ${anchors.length} ROOM PLANES · ${origin}`:'WEBXR AR · NO ROOM PLANES';
    if(!anchors.length&&!this.roomCaptureRequested&&time-this.sessionStartedAt>3000&&typeof frame.session?.initiateRoomCapture==='function'){
      this.roomCaptureRequested=true;
      Promise.resolve(frame.session.initiateRoomCapture()).catch(error=>this.onAssetError(`Quest Room Setup: ${error.message}`));
    }
  }
  sync(){
    this.grab=null;this.pointerGrab=null;
    for(const root of this.objectRoots.values()){root.parent?.remove(root);disposeGroup(root);}
    this.objectRoots.clear();
    for(const root of this.anchorRoots.values())this.scene.remove(root);
    this.anchorRoots.clear();
    if(this.world.spatial)for(const anchor of this.world.spatial.anchors){const root=new THREE.Group();this.anchorPose(root,anchor);this.scene.add(root);this.anchorRoots.set(anchor.anchorId,root);}
    for(const object of this.world.scene.objects){
      if(!this.world.spatial&&object.anchorId!=='web-floor')continue;
      const root=new THREE.Group();root.userData.objectId=object.objectId;root.position.copy(v3(object.transform.position));
      root.rotation.set(...['x','y','z'].map(k=>THREE.MathUtils.degToRad(object.transform.rotation[k])),'XYZ');
      root.scale.copy(v3(object.transform.scale));
      const asset=this.world.asset(object.assetId);
      const visual=asset.url?new THREE.Group():makeAsset(object.assetId);
      visual.scale.setScalar(asset.spawnScale||1);
      if(asset.url){
        const placeholder=new THREE.Mesh(new THREE.BoxGeometry(.35,.35,.35),new THREE.MeshBasicMaterial({color:0x5ee3cf,wireframe:true}));placeholder.position.y=.175;visual.add(placeholder);
      }
      visual.userData.objectId=object.objectId;root.add(visual);root.userData.visual=visual;root.userData.behaviors=object.behaviors||[];
      (this.anchorRoots.get(object.anchorId)||this.virtualFloorRoot).add(root);this.objectRoots.set(object.objectId,root);
      if(asset.url)this.loadExternal(asset,root,visual,object.objectId);
    }
    this.highlight();
  }
  async loadExternal(asset,root,visual,objectId){
    try{
      let pending=this.modelCache.get(asset.assetId);
      if(!pending){
        // This is a reuse cache, not a catalog limit. Older entries may be
        // fetched again from the PC if a different asset is summoned later.
        if(this.modelCache.size>=24)this.modelCache.delete(this.modelCache.keys().next().value);
        const loader=new GLTFLoader();const token=this.getToken();if(token)loader.setRequestHeader({Authorization:`Bearer ${token}`});
        pending=loader.loadAsync(asset.url).then(gltf=>{
          const scene=gltf.scene;
          const bounds=new THREE.Box3().setFromObject(scene);const size=bounds.getSize(new THREE.Vector3());
          if(!['x','y','z'].every(k=>Number.isFinite(size[k])&&size[k]>=0&&size[k]<=20)||size.lengthSq()===0)throw Error('GLB needs finite rendered bounds of 0–20 metres on each axis');
          validateRenderedFootprint(asset,size);
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
  rayFromPointer(event){
    const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
  }
  pointerDown(event){
    if(this.renderer.xr.isPresenting||![0,2].includes(event.button))return;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    if(event.button===2){this.pointerLook={pointerId:event.pointerId,x:event.clientX,y:event.clientY};return;}
    this.rayFromPointer(event);
    const id=this.selectFromRay();
    if(id){const grab=beginPointerGrab(this.raycaster,this.objectRoots.get(id));if(grab)this.pointerGrab={...grab,objectId:id,pointerId:event.pointerId,lastY:event.clientY,vertical:false};}
  }
  pointerMove(event){
    if(this.pointerLook?.pointerId===event.pointerId){
      const dx=event.clientX-this.pointerLook.x,dy=event.clientY-this.pointerLook.y;
      this.pointerLook.x=event.clientX;this.pointerLook.y=event.clientY;
      this.camera.rotation.y-=dx*.003;
      this.camera.rotation.x=THREE.MathUtils.clamp(this.camera.rotation.x-dy*.003,-Math.PI/2+.05,Math.PI/2-.05);
    }
    if(this.pointerGrab?.pointerId===event.pointerId){
      const grab=this.pointerGrab;this.rayFromPointer(event);
      if(event.shiftKey){movePointerGrabVertical(grab,this.raycaster,event.clientY-grab.lastY);grab.vertical=true;}
      else{
        if(grab.vertical)movePointerGrabVertical(grab,this.raycaster,0);
        movePointerGrab(grab,this.raycaster);grab.vertical=false;
      }
      grab.lastY=event.clientY;
    }
  }
  pointerUp(event){
    if(this.pointerLook?.pointerId===event.pointerId)this.pointerLook=null;
    if(this.pointerGrab?.pointerId!==event.pointerId)return;
    const grab=this.pointerGrab;this.pointerGrab=null;
    if(this.objectRoots.get(grab.objectId)!==grab.root)return;
    const transform=finishPointerGrab(grab,this.world.requireObject(grab.objectId).transform);
    if(transform)this.commitMove(grab.objectId,transform);
  }
  cancelPointer(){
    this.pointerLook=null;
    if(this.pointerGrab){this.pointerGrab=null;this.sync();}
  }
  selectFromController(controller){
    if(this.grab)return;
    controller.updateMatrixWorld(true);const origin=new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const direction=new THREE.Vector3(0,0,-1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));
    this.raycaster.set(origin,direction);
    const panelHit=this.operatorPanel.group.visible&&this.raycaster.intersectObject(this.operatorPanel.mesh)[0];
    if(panelHit){
      const action=this.operatorPanel.hit(panelHit.uv);
      if(action==='review-view')this.onVisualReview();
      else if(action==='toggle-world')this.operatorPanel.toggleWorld();
      else if(action==='toggle-agent')this.operatorPanel.toggleAgent();
      else if(action==='open-proposal')this.operatorPanel.openProposal();
      else if(action==='next')this.operatorPanel.nextPage();
      else if(action==='voice-output')this.onVoiceOutputToggle();
      else if(action==='pin')this.toggleOperatorPin();
      else if(action==='voice'){this.operatorVoiceController=controller;this.onVoiceStart();}
      else if(action==='new-chat')this.onNewChat();
      else if(action)this.onPanelAction(action);
      return;
    }
    const id=this.selectFromRay();
    if(id&&(this.world.spatial?.stale||this.world.spatial?.originUnavailable)){
      this.onAssetError('Room origin or tracking is unavailable; object grabs are paused.');return;
    }
    if(id)this.grab={...beginGrab(controller,this.objectRoots.get(id)),objectId:id};
  }
  releaseGrab(controller){
    if(!this.grab||this.grab.controller!==controller)return;
    const grab=this.grab;this.grab=null;
    if(this.objectRoots.get(grab.objectId)!==grab.root)return;
    const object=this.world.requireObject(grab.objectId);
    const transform=finishGrab(grab,object.transform);
    if(!transform)return;
    this.commitMove(grab.objectId,transform);
  }
  releaseOperatorVoice(controller){
    if(this.operatorVoiceController!==controller)return;
    this.operatorVoiceController=null;this.onVoiceEnd();
  }
  commitMove(objectId,transform){
    if(this.world.spatial?.stale||this.world.spatial?.originUnavailable){
      this.sync();this.onAssetError('Room origin or tracking is unavailable; object movement was not saved.');return;
    }
    const result=this.world.execute({requestId:crypto.randomUUID(),op:'set_transform',objectId,transform});
    if(!result.ok){this.sync();this.onAssetError(`Could not move object: ${result.error}`);return;}
    this.world.setSelection(objectId,transform.position,this.world.requireObject(objectId).anchorId);
    this.onSceneEdit(objectId,transform.position);
  }
  selectFromRay(){
    const roots=[...this.objectRoots.values()];const hits=this.raycaster.intersectObjects(roots,true);
    if(hits.length){let node=hits[0].object;while(node&&!node.userData.objectId)node=node.parent;
      const id=node?.userData.objectId;if(id){const object=this.world.requireObject(id);this.world.setSelection(id,object.transform.position,object.anchorId);this.highlight();this.onSelection();return id;}}
    if(this.isAR){const hits=this.raycaster.intersectObjects([...this.planeOutlines.values()],true);
      const hit=hits.find(item=>item.object.isMesh&&item.object.userData.anchorId);
      if(hit){const anchorId=hit.object.userData.anchorId;const root=this.planeOutlines.get(anchorId);const local=root.worldToLocal(hit.point.clone());this.world.setSelection('',plain(local),anchorId);this.onSelection();return;}
      if(this.reticleVisible&&this.reticleAnchorId){const root=this.planeOutlines.get(this.reticleAnchorId);this.world.setSelection('',plain(root.worldToLocal(this.reticle.position.clone())),this.reticleAnchorId);this.onSelection();return;}}
    const floorHit=this.isAR?null:this.raycaster.intersectObject(this.floor)[0];
    if(floorHit){const position=plain(floorHit.point);if(['x','y','z'].every(k=>Math.abs(position[k])<=100)){this.world.setSelection('',position);this.highlight();this.onSelection();}}
  }
  viewer(){
    if(this.isAR){if(!this.xrViewer)return null;const frames=[];
      this.virtualFloorRoot.updateMatrixWorld(true);
      const virtualPosition=this.virtualFloorRoot.worldToLocal(this.xrViewer.position.clone());
      const virtualDirection=this.xrViewer.direction.clone().applyQuaternion(this.virtualFloorRoot.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
      const virtualForward=virtualDirection.clone().setY(0);if(virtualForward.length()<.01)virtualForward.set(0,0,-1);virtualForward.normalize();
      frames.push({anchorId:'web-floor',position:plain(virtualPosition),forward:plain(virtualForward),lookDirection:plain(virtualDirection)});
      for(const anchor of this.world.spatial?.anchors||[]){if(anchor.surface.kind!=='support')continue;
        const root=this.planeOutlines.get(anchor.anchorId);if(!root)continue;
        const position=root.worldToLocal(this.xrViewer.position.clone());const direction=this.xrViewer.direction.clone().applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
        const forward=direction.clone().setY(0);if(forward.length()<.01)forward.set(0,0,-1);forward.normalize();
        frames.push({anchorId:anchor.anchorId,position:plain(position),forward:plain(forward),lookDirection:plain(direction)});
      }
      return frames.length?{frames}:null;
    }
    const camera=this.renderer.xr.isPresenting?this.renderer.xr.getCamera():this.camera;
    const position=camera.getWorldPosition(new THREE.Vector3());const direction=new THREE.Vector3(0,0,-1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    this.virtualFloorRoot.updateMatrixWorld(true);
    this.virtualFloorRoot.worldToLocal(position);
    direction.applyQuaternion(this.virtualFloorRoot.getWorldQuaternion(new THREE.Quaternion()).invert());
    const horizontal=direction.clone().setY(0);if(horizontal.length()<.01)horizontal.set(0,0,-1);horizontal.normalize();
    return {frames:[{anchorId:'web-floor',position:plain(position),forward:plain(horizontal),lookDirection:plain(direction.normalize())}]};
  }
  captureVirtual(request,clientId){
    const width=960,height=720,started=performance.now();
    const camera=new THREE.PerspectiveCamera(70,width/height,.02,100);
    if(this.renderer.xr.isPresenting){
      if(!this.xrViewer)throw Error('Tracked headset view is not ready');
      camera.position.copy(this.xrViewer.position);camera.quaternion.copy(this.xrViewer.quaternion);
    }else{
      camera.position.copy(this.camera.position);camera.quaternion.copy(this.camera.quaternion);
      camera.fov=this.camera.fov;camera.updateProjectionMatrix();
    }
    const target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true});
    const previousTarget=this.renderer.getRenderTarget(),previousBackground=this.scene.background;
    const previousXr=this.renderer.xr.enabled,panelVisible=this.operatorPanel.group.visible;
    const pixels=new Uint8Array(width*height*4);
    try{
      this.renderer.xr.enabled=false;
      this.scene.background=new THREE.Color(0x101820);
      this.operatorPanel.group.visible=false;
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.scene,camera);
      this.renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
    }finally{
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.xr.enabled=previousXr;
      this.scene.background=previousBackground;
      this.operatorPanel.group.visible=panelVisible;
      target.dispose();
    }
    const rendered=performance.now();
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)throw Error('JPEG encoder unavailable');
    const image=context.createImageData(width,height);
    for(let y=0;y<height;y++)image.data.set(pixels.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
    context.putImageData(image,0,0);
    let encoded='';
    for(const quality of [.75,.55,.35]){
      encoded=canvas.toDataURL('image/jpeg',quality).split(',')[1]||'';
      if(encoded.length<=4*Math.ceil(512*1024/3))break;
    }
    if(!encoded||encoded.length>4*Math.ceil(512*1024/3))throw Error('Rendered view exceeds 512 KiB');
    const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion).normalize();
    const euler=new THREE.Euler().setFromQuaternion(camera.quaternion,'XYZ');
    const snapshot=this.world.snapshot(this.viewer());
    return {captureId:request.captureId,revision:request.revision,clientId,mode:'virtual',ok:true,
      mimeType:'image/jpeg',dataBase64:encoded,width,height,source:'webxr_virtual_center_eye',includesPassthrough:false,
      capturedAtUtc:new Date().toISOString(),snapshot,
      camera:{position:plain(camera.position),rotation:plain(new THREE.Vector3(...['x','y','z'].map(axis=>THREE.MathUtils.radToDeg(euler[axis])))),
        forward:plain(forward),fieldOfView:camera.fov,aspect:width/height,nearClip:camera.near,farClip:camera.far},
      spatialProvenance:{source:'virtual',roomId:snapshot.scene.roomId,anchorCount:snapshot.anchors.length,
        alignmentVerified:false,depthOcclusion:false,physicalDepthIncluded:false},
      renderMs:rendered-started,encodeMs:performance.now()-rendered,frameTimeMs:0};
  }
  async captureCameraPair(request,clientId,cameraStream){
    const started=performance.now();
    const cameraFrame=cameraStream.captureFrame();
    const virtual=this.captureVirtual(request,clientId);
    const image=new Image();
    image.src=`data:image/jpeg;base64,${virtual.dataBase64}`;
    await image.decode();
    const width=1280,height=480,half=width/2;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)throw Error('Camera composite canvas unavailable');
    context.drawImage(cameraFrame,0,0,half,height);
    context.drawImage(image,half,0,half,height);
    context.fillStyle='rgba(0,0,0,.78)';context.fillRect(0,0,width,38);
    context.fillStyle='#ffffff';context.font='bold 23px sans-serif';
    context.fillText('QUEST ENVIRONMENT CAMERA · UNCALIBRATED',12,27);
    context.fillText('MATRIX VIRTUAL VIEW',half+12,27);
    let encoded='';
    for(const quality of [.75,.55,.35,.2]){
      encoded=canvas.toDataURL('image/jpeg',quality).split(',')[1]||'';
      if(encoded.length<=4*Math.ceil(512*1024/3))break;
    }
    if(!encoded||encoded.length>4*Math.ceil(512*1024/3))throw Error('Camera and virtual view exceed 512 KiB');
    return {...virtual,mode:'mixed',source:'webxr_camera_pair',includesPhysicalCamera:true,
      includesPassthrough:false,dataBase64:encoded,width,height,capturedAtUtc:new Date().toISOString(),
      spatialProvenance:{source:'webxr_room_planes',roomId:virtual.snapshot.scene.roomId,
        anchorCount:virtual.snapshot.anchors.length,alignmentVerified:!!this.world.spatial?.alignmentVerified,
        depthOcclusion:false,physicalDepthIncluded:false},
      layout:{kind:'side-by-side',cameraPanel:[0,0,half,height],virtualPanel:[half,0,half,height],
        calibrated:false},renderMs:virtual.renderMs,encodeMs:performance.now()-started-virtual.renderMs};
  }
  animate(time,frame){
    if(frame&&this.renderer.xr.isPresenting)this.onFrame();
    if(this.lastFrameTime!==null&&!this.renderer.xr.isPresenting)moveDesktopCamera(this.camera,this.keys,(time-this.lastFrameTime)/1000);
    this.lastFrameTime=time;
    if(frame&&this.renderer.xr.isPresenting){const ref=this.renderer.xr.getReferenceSpace();if(ref){this.xrViewer=viewerPose(frame,ref);this.positionOperatorPanel();this.updatePlanes(time,frame,ref);this.updateRoomAnchor(frame,ref);
      if(!this.isAR&&!this.virtualFloorCalibrated&&this.xrViewer&&this.measuredEyeHeight!==null){
        this.virtualFloorRoot.position.y=this.xrViewer.position.y-this.measuredEyeHeight;
        this.virtualFloorCalibrated=true;
      }
      if(!this.isAR){
        const origin=this.roomAnchor&&this.roomAnchorLocated?(this.roomAnchorPersistent?'ROOM ANCHORED':'SESSION ANCHORED'):this.roomAnchorPending||this.roomAnchor?'ALIGNING ROOM':this.virtualFloorCalibrated?'HEIGHT CALIBRATED':'ROOM ORIGIN UNAVAILABLE';
        this.operatorPanel.setOriginLabel(origin);
        document.getElementById('view-label').textContent=`WEBXR VR · ${origin}`;
      }
    }}
    if(this.hitSource&&frame){const hits=frame.getHitTestResults(this.hitSource);const ref=this.renderer.xr.getReferenceSpace();const pose=ref&&hits[0]?.getPose(ref);
      this.reticleVisible=!!pose;this.reticle.visible=!!pose;this.reticleAnchorId='';if(pose){this.reticle.position.setFromMatrixPosition(new THREE.Matrix4().fromArray(pose.transform.matrix));
        for(const anchor of this.world.spatial?.anchors||[]){if(anchor.surface.kind!=='support')continue;const root=this.planeOutlines.get(anchor.anchorId);if(!root)continue;
          const local=root.worldToLocal(this.reticle.position.clone());if(Math.abs(local.y)<.12&&insideBoundary(local,anchor.surface.boundary)){this.reticleAnchorId=anchor.anchorId;break;}}
      }}
    if(this.grab)moveGrab(this.grab);
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
