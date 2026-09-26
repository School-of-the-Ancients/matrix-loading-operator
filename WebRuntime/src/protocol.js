// This is the browser adapter for Matrix scene schema 1 and the existing
// /api/exchange command set. Keep changes to this contract coordinated with
// ControlService/server.py and Assets/Sandbox/Runtime/SandboxWorld.cs.
import {footprintInsideBoundary} from './spatial.js';
import {validateAttachment,validatePackage} from './components.js';
import {advanceFloorBody,createFloorBody,publicPhysicsState,validPhysicsConfig,validRenderedPhysicsSize} from './physics_floor.js';
export const ROOM_ID = 'web-virtual-room-v1';
export const ANCHOR_ID = 'web-floor';
export const MAX_OBJECTS = 100;
export const ASSETS = [
  {assetId:'chair', displayName:'Chair', description:'A wooden chair with a seat and back, about 0.6 by 0.9 metres.', spawnScale:1, localBounds:{center:{x:0,y:.45,z:0},size:{x:.6,y:.9,z:.6}},interactions:[{kind:'rest',rangeMeters:.8}]},
  {assetId:'table', displayName:'Table', description:'A wooden table about 1.5 metres wide and 0.75 metres high.', spawnScale:1, localBounds:{center:{x:0,y:.375,z:0},size:{x:1.5,y:.75,z:.9}},interactions:[{kind:'eat',rangeMeters:.9}]},
  {assetId:'wall', displayName:'Wall', description:'A straight wall panel 2 metres wide and 2 metres high.', spawnScale:1, localBounds:{center:{x:0,y:1,z:0},size:{x:2,y:2,z:.12}}},
  {assetId:'pedestal', displayName:'Pedestal', description:'A stone display pedestal.', spawnScale:1, localBounds:{center:{x:0,y:.5,z:0},size:{x:.6,y:1,z:.6}}},
  {assetId:'block', displayName:'Block', description:'A one metre cube.', spawnScale:1, localBounds:{center:{x:0,y:.5,z:0},size:{x:1,y:1,z:1}}},
  {assetId:'orb', displayName:'Orb', description:'A luminous sphere 0.5 metres across.', spawnScale:1, localBounds:{center:{x:0,y:.25,z:0},size:{x:.5,y:.5,z:.5}}},
  {assetId:'column', displayName:'Column', description:'A cylindrical stone column 2 metres high.', spawnScale:1, localBounds:{center:{x:0,y:1,z:0},size:{x:.5,y:2,z:.5}}}
];
const assetIds = new Set(ASSETS.map(a=>a.assetId));
const clone = value => structuredClone(value);
const finite = (n,min,max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const vec = (v,min,max) => v && ['x','y','z'].every(k=>finite(v[k],min,max));
const validTransform = t => t && vec(t.position,-100,100) && vec(t.rotation,-36000,36000) && vec(t.scale,.01,20);
const validId = s => typeof s === 'string' && s.length > 0 && s.length <= 128 && !/[\x00-\x1f]/.test(s);
const validBehavior = b => b && ['rotate','bob'].includes(b.kind) && typeof b.enabled === 'boolean' && typeof b.paused === 'boolean' &&
  ['x','y','z'].includes(b.axis) && finite(b.speedDegreesPerSecond,-180,180) && finite(b.amplitudeMeters,0,.25) && finite(b.frequencyHz,.05,2);
const sameVector=(a,b)=>a&&b&&['x','y','z'].every(axis=>a[axis]===b[axis]);
const sameTransform=(a,b)=>a&&b&&['position','rotation','scale'].every(key=>sameVector(a[key],b[key]));
const samePhysics=(a,b)=>a&&b&&['schemaVersion','kind','collider','restitution'].every(key=>a[key]===b[key]);
const physicsAssetSignature=asset=>JSON.stringify([asset?.sha256,asset?.url,asset?.spawnScale,
  ...['center','size'].flatMap(group=>['x','y','z'].map(axis=>asset?.localBounds?.[group]?.[axis]))]);
const renderedAssetSignature=asset=>JSON.stringify([physicsAssetSignature(asset),asset?.geometry?.animationClips]);
const physicsRegisteredGlb=asset=>!!asset?.url&&asset.assetId?.startsWith('web:')&&
  /^[0-9a-f]{64}$/.test(asset.sha256||'')&&finite(asset.spawnScale,.01,20);
const validAnimationBinding=(binding,asset,allowEmpty=false)=>{
  if(!binding||typeof binding!=='object'||Array.isArray(binding)||
     Object.keys(binding).sort().join(',')!=='loopClip,selectClip')return false;
  const clips=new Set((asset?.geometry?.animationClips||[]).map(clip=>clip.name));
  if(!['loopClip','selectClip'].every(key=>binding[key]===null||
      typeof binding[key]==='string'&&clips.has(binding[key])))return false;
  if(!allowEmpty&&!binding.loopClip&&!binding.selectClip)return false;
  return !binding.loopClip||binding.loopClip!==binding.selectClip;
};

export class MatrixWorld {
  constructor(idFactory=()=>crypto.randomUUID().replaceAll('-','')) {
    this.idFactory=idFactory;
    this.externalAssets=[];
    this.scene={schemaVersion:1,roomId:ROOM_ID,objects:[]};
    this.game=null;
    // Browser world provenance is separate from the renderer-neutral scene.
    this.originBinding='virtual';
    this.originAnchorHandle=null;
    this.arEntryContent=null;
    this.selection={anchorId:ANCHOR_ID,objectId:'',position:{x:0,y:0,z:-2}};
    this.spatial=null;this.virtualScene=null;
    this.undo=[]; this.redo=[];
    this.physicsBodies=new Map();this.physicsVerification=new Map();
    this.physicsSceneReference=this.scene;
  }
  snapshot(viewer=null) {
    const anchors=this.availableAnchors();
    const context=this.spatial?{mode:'ar',state:this.spatial.originUnavailable||this.spatial.stale?'missing':'ready',message:this.spatial.originUnavailable?'Saved room origin is unavailable. The old world is hidden and editing is paused until it is restored or explicitly archived for a new room.':this.spatial.stale?'A plane holding a scene object is no longer tracked; keep the scene for recovery and recheck the room.':this.spatial.anchors.length?`${this.spatial.anchors.length} WebXR room plane(s) detected. Virtual-floor objects remain visible as unanchored previews.`:'Waiting for Quest room planes. Virtual-floor objects remain visible as unanchored previews.',alignmentVerified:this.spatial.alignmentVerified&&!this.spatial.originUnavailable}
      :{mode:'white-room',state:'ready',message:'Browser virtual floor; physical room alignment is not verified.',alignmentVerified:false};
    const snapshot={scene:clone(this.scene),assets:clone([...ASSETS,...this.externalAssets].map(({assetId,displayName,description,spawnScale,localBounds,geometry,interactions})=>({assetId,displayName,description,spawnScale,...(localBounds?{localBounds}:{}),...(interactions?{interactions}:{}),...(geometry?.animationClips?{animationClips:geometry.animationClips.map(clip=>clip.name)}:{})}))),anchors:clone(anchors),selection:clone(this.selection),behaviorKinds:['rotate','bob'],componentSchemaVersion:1,animationSchemaVersion:1,physicsSchemaVersion:1,physicsStates:this.physicsStates(),roomContext:context};
    if(this.spatial?.stale||this.spatial?.originUnavailable)snapshot.readOnly=true;
    if (viewer) snapshot.viewer=viewer;
    return snapshot;
  }
  registerAssets(entries) {
    if(!Array.isArray(entries)||entries.length>256)throw Error('Invalid web asset catalog');
    const ids=new Set(assetIds);
    const checked=[];
    for(const entry of entries){
      if(!entry||!validId(entry.assetId)||!entry.assetId.startsWith('web:')||ids.has(entry.assetId)||
         typeof entry.displayName!=='string'||entry.displayName.length>80||
         typeof entry.description!=='string'||entry.description.length>500||!finite(entry.spawnScale,.01,20)||
         (entry.localBounds!==undefined&&(!entry.localBounds||!vec(entry.localBounds.center,-20,20)||
           !vec(entry.localBounds.size,.001,20)))||
         !/^[0-9a-f]{64}$/.test(entry.sha256)||entry.url!==`/api/web/assets/${entry.sha256}.glb`||
         !Number.isInteger(entry.byteLength)||entry.byteLength<20||entry.byteLength>16*1024*1024)throw Error('Invalid web asset entry');
      const clips=entry.geometry?.animationClips;
      if(clips!==undefined&&(!Array.isArray(clips)||clips.length>8||
        new Set(clips.map(clip=>clip?.name)).size!==clips.length||
        !clips.every(clip=>typeof clip?.name==='string'&&[...clip.name].length>=1&&[...clip.name].length<=64&&
          !/\p{C}/u.test(clip.name)&&finite(clip.durationSeconds,0,120))))
        throw Error('Invalid web asset animation metadata');
      ids.add(entry.assetId);checked.push(clone(entry));
    }
    const previous=new Map(this.externalAssets.map(asset=>[asset.assetId,asset]));
    this.externalAssets=checked;
    const changed=checked.filter(asset=>renderedAssetSignature(asset)!==
      renderedAssetSignature(previous.get(asset.assetId))).map(asset=>asset.assetId);
    for(const [objectId,verification] of this.physicsVerification){
      const object=this.scene.objects.find(item=>item.objectId===objectId);
      if(!object||physicsAssetSignature(this.asset(object.assetId))!==verification.signature)
        this.invalidatePhysicsAsset(objectId,true);
    }
    for(const [id,body] of this.physicsBodies){
      if(!physicsRegisteredGlb(this.asset(body.assetId)))this.physicsBodies.delete(id);
    }
    return changed;
  }
  asset(id){return ASSETS.find(a=>a.assetId===id)||this.externalAssets.find(a=>a.assetId===id);}
  verifyPhysicsAsset(assetId,measuredSize,objectId){
    this.ensurePhysicsScene();
    const asset=this.asset(assetId);
    const object=this.scene.objects.find(item=>item.objectId===objectId);
    const bounds=asset?.localBounds;
    const verified=!!object&&object.assetId===assetId&&physicsRegisteredGlb(asset)&&
      validRenderedPhysicsSize(measuredSize)&&
      (!bounds||['x','y','z'].every(axis=>Math.abs(measuredSize[axis]-bounds.size[axis])<=.02));
    if(verified){
      this.physicsVerification.set(objectId,{signature:physicsAssetSignature(asset),
        measuredSize:clone(measuredSize)});
      const body=this.physicsBodies.get(objectId);
      if(body)this.setPhysicsPause(body,'model',false);
    }
    else{
      this.invalidatePhysicsAsset(objectId,true);
    }
    return verified;
  }
  invalidatePhysicsAsset(objectId,cancelRun=false){
    this.physicsVerification.delete(objectId);
    const body=this.physicsBodies.get(objectId);
    if(!body)return false;
    if(cancelRun)this.physicsBodies.delete(objectId);
    else this.setPhysicsPause(body,'model',true);
    return true;
  }
  physicsAssetVerified(object){
    this.ensurePhysicsScene();
    const verification=this.physicsVerification.get(object.objectId);
    return verification?.signature===physicsAssetSignature(this.asset(object.assetId))&&
      validRenderedPhysicsSize(verification.measuredSize);
  }
  setPhysicsPause(body,reason,enabled){
    body.pauseReasons ||= [];
    const exists=body.pauseReasons.includes(reason);
    if(enabled&&!exists){
      if(body.status!=='paused')body.resumeStatus=body.status;
      body.status='paused';body.pauseReasons.push(reason);body.accumulatorSeconds=0;
    }else if(!enabled&&exists){
      body.pauseReasons=body.pauseReasons.filter(item=>item!==reason);
      if(!body.pauseReasons.length){
        body.status=body.resumeStatus||'falling';delete body.resumeStatus;
        body.accumulatorSeconds=0;
      }
    }
  }
  assertPhysicsEligible(object,transform=object.transform,{verified=false}={}){
    const asset=this.asset(object.assetId);
    if(object.anchorId!==ANCHOR_ID||!physicsRegisteredGlb(asset))
      throw Error('Physics requires an imported GLB on the virtual floor');
    if(!validPhysicsConfig(object.physics))throw Error('Invalid physics configuration');
    if(!validTransform(transform)||!finite(transform.position.y,0,5)||
       Math.abs(transform.rotation.x)>.01||Math.abs(transform.rotation.z)>.01)
      throw Error('Physics needs an upright pose 0–5 metres above the virtual floor');
    if(object.component||object.behaviors?.some(behavior=>behavior.enabled))
      throw Error('Remove components and enabled transform behaviors before physics');
    if(verified&&!this.physicsAssetVerified(object))
      throw Error('This GLB instance has not been verified by the browser renderer');
  }
  ensurePhysicsScene(){
    // Browser-local recovery replaces world.scene directly. A recovered scene
    // retains authored configuration but must never inherit an old run.
    if(this.physicsSceneReference!==this.scene){
      this.physicsBodies.clear();this.physicsVerification.clear();
      this.physicsSceneReference=this.scene;
    }
  }
  startPhysics(object,executionId){
    this.ensurePhysicsScene();
    const measuredSize=this.physicsVerification.get(object.objectId)?.measuredSize;
    this.physicsBodies.set(object.objectId,createFloorBody(object,this.asset(object.assetId),executionId,measuredSize));
  }
  physicsState(objectId){
    this.ensurePhysicsScene();
    const body=this.physicsBodies.get(objectId);
    const object=this.scene.objects.find(item=>item.objectId===objectId);
    if(!body||!object||!object.physics||body.assetId!==object.assetId||
       body.anchorId!==object.anchorId||!physicsRegisteredGlb(this.asset(body.assetId))||
       !sameTransform(body.authoredTransform,object.transform)||
       !samePhysics(body.physics,object.physics)){
      this.physicsBodies.delete(objectId);return null;
    }
    return publicPhysicsState(body);
  }
  physicsStates(){
    this.ensurePhysicsScene();
    return [...this.physicsBodies.keys()].map(id=>this.physicsState(id)).filter(Boolean);
  }
  pausePhysics(objectId){
    if(!this.physicsState(objectId))return false;
    const body=this.physicsBodies.get(objectId);
    this.setPhysicsPause(body,'grab',true);
    return true;
  }
  resumePhysics(objectId){
    if(!this.physicsState(objectId))return false;
    const body=this.physicsBodies.get(objectId);
    this.setPhysicsPause(body,'grab',false);
    return true;
  }
  advancePhysics(deltaSeconds){
    this.ensurePhysicsScene();
    if(this.spatial||this.scene.roomId!==ROOM_ID)return [];
    const contacts=[];
    for(const id of [...this.physicsBodies.keys()]){
      if(!this.physicsState(id))continue;
      const result=advanceFloorBody(this.physicsBodies.get(id),deltaSeconds);
      this.physicsBodies.set(id,result.body);contacts.push(...result.contacts);
    }
    return contacts;
  }
  enterAR(){
    if(this.spatial)return;
    this.physicsBodies.clear();this.physicsVerification.clear();
    this.virtualScene={scene:clone(this.scene),selection:clone(this.selection),undo:this.undo,redo:this.redo};
    this.scene={...clone(this.scene),roomId:`webxr-session-${this.idFactory()}`};
    this.physicsSceneReference=this.scene;
    this.spatial={anchors:[],alignmentVerified:false,originUnavailable:false};
    this.resetAROriginBaseline();
    this.undo=[];this.redo=[];
  }
  resetAROriginBaseline(){
    if(this.spatial)this.arEntryContent=this.retainedARContent();
  }
  retainedARContent(){
    // Measured-plane objects are session-only; they do not survive a save or exit.
    return JSON.stringify([this.scene.objects.filter(object=>object.anchorId===ANCHOR_ID),this.game]);
  }
  markAROriginIfChanged(){
    if(this.spatial&&this.originBinding==='virtual'&&
       this.arEntryContent!==this.retainedARContent())
      this.originBinding='ar';
  }
  leaveAR(){
    if(!this.spatial)return;
    this.markAROriginIfChanged();
    // Carry edits to virtual-floor objects back to desktop. Physical anchors
    // are session-local and must not leak into a virtual-room snapshot.
    const saved=this.virtualScene;
    saved.scene.objects=clone(this.scene.objects.filter(object=>object.anchorId===ANCHOR_ID));
    this.scene=saved.scene;
    if(!this.scene.objects.length&&this.game===null){this.originBinding='virtual';this.originAnchorHandle=null;}
    this.physicsBodies.clear();this.physicsVerification.clear();this.physicsSceneReference=this.scene;
    this.selection=this.selection.anchorId===ANCHOR_ID?this.selection:saved.selection;
    this.undo=[];this.redo=[];this.spatial=null;this.virtualScene=null;this.arEntryContent=null;
  }
  setSpatialAnchors(anchors){
    if(!this.spatial)return;
    const stable=anchors.map(anchor=>{
      const old=this.spatial.anchors.find(item=>item.anchorId===anchor.anchorId);
      if(!old||old.displayName!==anchor.displayName||old.surface.kind!==anchor.surface.kind||old.surface.boundary.length!==anchor.surface.boundary.length)return anchor;
      const close=(a,b,tolerance)=>['x','y','z'].every(key=>Math.abs(a[key]-b[key])<tolerance);
      if(!close(old.roomPose.position,anchor.roomPose.position,.02)||!close(old.roomPose.rotation,anchor.roomPose.rotation,1))return anchor;
      if(!anchor.surface.boundary.every((point,index)=>close(point,old.surface.boundary[index],.02)))return anchor;
      return old;
    });
    const missing=this.scene.objects.map(object=>object.anchorId).filter(id=>id!==ANCHOR_ID&&!anchors.some(anchor=>anchor.anchorId===id));
    const retained=this.spatial.anchors.filter(anchor=>missing.includes(anchor.anchorId));
    this.spatial.stale=missing.length>0;
    if(this.spatial.stale)this.spatial.alignmentVerified=false;
    this.spatial.anchors=clone([...stable,...retained]);
    if(this.selection.anchorId!==ANCHOR_ID&&!anchors.some(anchor=>anchor.anchorId===this.selection.anchorId)){
      const support=anchors.find(anchor=>anchor.surface.kind==='support'&&anchor.semanticLabels.includes('FLOOR'))||
        anchors.find(anchor=>anchor.surface.kind==='support');
      this.selection={anchorId:support?.anchorId||'',objectId:'',position:{x:0,y:0,z:0}};
    }
    if(!anchors.length)this.spatial.alignmentVerified=false;
  }
  setOriginUnavailable(unavailable){
    if(!this.spatial)return;
    this.spatial.originUnavailable=!!unavailable;
    if(unavailable)this.spatial.alignmentVerified=false;
  }
  setSelection(objectId,position,anchorId=this.spatial?this.selection.anchorId:ANCHOR_ID) {
    if (objectId && !this.scene.objects.some(o=>o.objectId===objectId)) throw Error('Unknown objectId');
    if (!vec(position,-100,100)) throw Error('Invalid selection position');
    if(!this.availableAnchors().some(anchor=>anchor.anchorId===anchorId))throw Error('Unknown selection anchorId');
    this.selection={anchorId,objectId:objectId||'',position:clone(position)};
  }
  availableAnchors(){return [{anchorId:ANCHOR_ID,displayName:this.spatial?'Unanchored virtual preview':'Virtual floor'},...(this.spatial?.anchors||[])];}
  assertSupportedFootprint(transform,assetId,anchor){
    const bounds=this.asset(assetId)?.localBounds;
    if(!bounds)throw Error('This asset has no measured bounds for support placement');
    if(Math.abs(transform.rotation.x)>.01||Math.abs(transform.rotation.z)>.01)
      throw Error('Support placement needs an upright object');
    const spawnScale=this.asset(assetId)?.spawnScale||1;
    // loadExternal centers GLBs horizontally; built-in meshes are centered too.
    const xs=[-bounds.size.x/2,bounds.size.x/2].map(x=>x*transform.scale.x*spawnScale);
    const zs=[-bounds.size.z/2,bounds.size.z/2].map(z=>z*transform.scale.z*spawnScale);
    const radians=transform.rotation.y*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
    const corners=[[xs[0],zs[0]],[xs[1],zs[0]],[xs[1],zs[1]],[xs[0],zs[1]]]
      .map(([x,z])=>({x:transform.position.x+x*cos-z*sin,z:transform.position.z+x*sin+z*cos}));
    if(!footprintInsideBoundary(corners,anchor.surface.boundary))
      throw Error('Object footprint extends beyond measured surface');
  }
  resolvedTransform(command,assetId,anchorId){
    const transform=clone(command.transform);
    const anchor=this.availableAnchors().find(item=>item.anchorId===anchorId);
    if(!anchor)throw Error('Unknown anchorId');
    if(!this.spatial||anchorId===ANCHOR_ID)return transform;
    if(!this.spatial.alignmentVerified)throw Error('Confirm room alignment first');
    if(command.placement!==undefined&&command.placement!=='surface')throw Error('Unknown placement mode');
    if(command.placement==='surface'&&anchor.surface.kind!=='support')throw Error('Choose a measured support surface');
    if(anchor.surface.kind==='support'){
      this.assertSupportedFootprint(transform,assetId,anchor);
    }
    if(command.placement==='surface'){
      const bounds=this.asset(assetId).localBounds;
      if(transform.position.y<0)throw Error('Surface clearance cannot be negative');
      const spawnScale=this.asset(assetId)?.spawnScale||1;
      // Imported GLBs are already floor aligned by loadExternal.
      if(!this.asset(assetId).url)
        transform.position.y-=((bounds.center.y-bounds.size.y/2)*transform.scale.y*spawnScale);
    }
    return transform;
  }
  execute(command,{recordHistory=true}={}) {
    const result={requestId:command?.requestId||'',ok:false,error:'',objectId:''};
    try {
      if (!command || !validId(command.requestId)) throw Error('Invalid requestId');
      const op=command.op;
      if(this.spatial?.originUnavailable&&!['get_scene','list_assets','list_targets'].includes(op))
        throw Error('Saved room origin is unavailable; restore it or archive the old world before editing');
      if(this.spatial?.stale&&['spawn','duplicate','set_transform','set_behavior','remove_behavior','attach_component','stop_component','remove_component','bind_animation','set_physics','remove_physics','delete','load','undo','redo','select'].includes(op))
        throw Error('Room tracking is stale; editing is paused until the room is recovered');
      const mutation=['spawn','duplicate','set_transform','set_behavior','remove_behavior','attach_component','stop_component','remove_component','bind_animation','set_physics','remove_physics','delete','clear','load'].includes(op);
      // Local finite simulation steps use the same validation and receipt path
      // without filling the user's scene Undo history with each movement tick.
      const before=mutation&&recordHistory?clone(this.scene):null;
      let object;
      switch(op) {
        case 'get_scene': case 'list_assets': case 'list_targets': break;
        case 'confirm_room':
          if(!this.spatial||this.spatial.stale||!this.spatial.anchors.some(anchor=>anchor.surface.kind==='support'))throw Error('No ready measured support surface to confirm');
          this.spatial.alignmentVerified=true;break;
        case 'spawn':
          if (!this.asset(command.assetId)) throw Error('Unknown assetId');
          if (!this.availableAnchors().some(anchor=>anchor.anchorId===command.anchorId)) throw Error('Unknown anchorId');
          if (!validTransform(command.transform)) throw Error('Invalid transform');
          if (this.scene.objects.length>=MAX_OBJECTS) throw Error('Scene object limit reached');
          object={objectId:this.idFactory(),assetId:command.assetId,anchorId:command.anchorId,transform:this.resolvedTransform(command,command.assetId,command.anchorId)};
          if (!validId(object.objectId)||this.scene.objects.some(o=>o.objectId===object.objectId)) throw Error('Invalid generated objectId');
          this.scene.objects.push(object); result.objectId=object.objectId; break;
        case 'select':
          object=this.requireObject(command.objectId); result.objectId=object.objectId;
          this.setSelection(object.objectId,object.transform.position,object.anchorId); break;
        case 'interact':
          // A finite local outcome: check the advertised action and the current
          // observed actor pose. Citizens owns intent and resource reservations.
          if(this.spatial||this.scene.roomId!==ROOM_ID)throw Error('Interaction requires the virtual room');
          {const actor=this.requireObject(command.actorObjectId);
            const target=this.requireObject(command.targetObjectId);
            const advertised=ASSETS.find(asset=>asset.assetId===target.assetId)?.interactions
              ?.find(item=>item.kind===command.kind);
            if(actor.objectId===target.objectId||actor.anchorId!==ANCHOR_ID||
               target.anchorId!==ANCHOR_ID||!advertised)
              throw Error('Interaction is not advertised by this virtual-floor target');
            const a=actor.transform.position,b=target.transform.position;
            const distance=Math.hypot(a.x-b.x,a.z-b.z);
            if(Math.abs(a.y-b.y)>.3||distance>advertised.rangeMeters)
              throw Error('Actor is out of interaction range');
            result.objectId=actor.objectId;
            result.outcome={kind:command.kind,actorObjectId:actor.objectId,
              targetObjectId:target.objectId,observedDistanceMeters:Math.round(distance*1000)/1000};}
          break;
        case 'duplicate':
          object=this.requireObject(command.objectId);
          if (this.scene.objects.length>=MAX_OBJECTS) throw Error('Scene object limit reached');
          if(object.physics&&this.scene.objects.filter(item=>item.physics).length>=16)
            throw Error('Physics object limit reached');
          { const duplicate=clone(object); duplicate.objectId=this.idFactory(); duplicate.transform.position.x=Math.min(100,duplicate.transform.position.x+.3);
            if (!validId(duplicate.objectId)||this.scene.objects.some(o=>o.objectId===duplicate.objectId)) throw Error('Invalid generated objectId');
            const anchor=this.spatial?.anchors.find(item=>item.anchorId===duplicate.anchorId);
            if(anchor?.surface.kind==='support')this.assertSupportedFootprint(duplicate.transform,duplicate.assetId,anchor);
            if(duplicate.physics)this.assertPhysicsEligible(duplicate);
            this.scene.objects.push(duplicate);result.objectId=duplicate.objectId; }
          break;
        case 'set_transform':
          object=this.requireObject(command.objectId);
          if (!validTransform(command.transform)) throw Error('Invalid transform');
          if (command.anchorId && command.anchorId!==object.anchorId) throw Error('Changing an object anchor is not supported');
          {const resolved=this.resolvedTransform(command,object.assetId,object.anchorId);
            if(object.physics)this.assertPhysicsEligible(object,resolved,{verified:!this.spatial});
            object.transform=resolved;
            if(object.physics){
              if(this.spatial)this.physicsBodies.delete(object.objectId);
              else this.startPhysics(object,command.requestId);
            }}
          result.objectId=object.objectId; break;
        case 'set_behavior':
          object=this.requireObject(command.objectId);
          if (!validBehavior(command.behavior)) throw Error('Invalid behavior');
          if(object.physics&&command.behavior.enabled)
            throw Error('Remove physics before enabling a transform behavior');
          object.behaviors=(object.behaviors||[]).filter(b=>b.kind!==command.behavior.kind);
          object.behaviors.push(clone(command.behavior)); result.objectId=object.objectId; break;
        case 'remove_behavior':
          object=this.requireObject(command.objectId);
          if (!['rotate','bob','all'].includes(command.behaviorKind)) throw Error('Invalid behaviorKind');
          object.behaviors=command.behaviorKind==='all'?[]:(object.behaviors||[]).filter(b=>b.kind!==command.behaviorKind);
          if (!object.behaviors.length) delete object.behaviors;
          result.objectId=object.objectId; break;
        case 'attach_component':
          object=this.requireObject(command.objectId);
          if(object.anchorId!==ANCHOR_ID)throw Error('Components currently require virtual-floor objects');
          if(object.physics)throw Error('Remove physics before attaching a component');
          if(object.component)throw Error('Remove the existing component first');
          if(!validId(command.componentId)||!validId(command.targetObjectId)||
             !/^webcomp:[a-z0-9][a-z0-9-]{0,39}:[0-9a-f]{12}$/.test(command.componentId))
            throw Error('Invalid component identity');
          {const target=this.requireObject(command.targetObjectId);
            if(target.objectId===object.objectId||target.anchorId!==ANCHOR_ID)
              throw Error('Component target must be another virtual-floor object');}
          validatePackage(command.package);
          object.component={componentId:command.componentId,package:clone(command.package),
            targetObjectId:command.targetObjectId,startedAtMs:Date.now(),status:'running'};
          result.objectId=object.objectId;break;
        case 'stop_component':
          object=this.requireObject(command.objectId);
          if(!object.component)throw Error('Object has no component');
          if(object.component.status==='failed')throw Error('Failed component must be removed');
          object.component.status='stopped';delete object.component.error;
          result.objectId=object.objectId;break;
        case 'remove_component':
          object=this.requireObject(command.objectId);
          if(!object.component)throw Error('Object has no component');
          delete object.component;result.objectId=object.objectId;break;
        case 'bind_animation':
          object=this.requireObject(command.objectId);
          if(object.anchorId!==ANCHOR_ID||!this.asset(object.assetId)?.url)
            throw Error('Animation binding requires a virtual-floor GLB');
          {const binding={loopClip:command.loopClip,selectClip:command.selectClip};
            if(!validAnimationBinding(binding,this.asset(object.assetId),true))
              throw Error('Invalid GLB animation binding');
            if(binding.loopClip||binding.selectClip)object.animation=clone(binding);
            else delete object.animation;}
          result.objectId=object.objectId;break;
        case 'set_physics':
          if(this.spatial||this.scene.roomId!==ROOM_ID)
            throw Error('Physics currently runs in the white room only');
          object=this.requireObject(command.objectId);
          if(!validPhysicsConfig(command.physics))throw Error('Invalid physics configuration');
          if(!object.physics&&this.scene.objects.filter(item=>item.physics).length>=16)
            throw Error('Physics object limit reached');
          {const configured={...object,physics:command.physics};
            this.assertPhysicsEligible(configured,configured.transform,{verified:true});
            object.physics=clone(command.physics);this.startPhysics(object,command.requestId);}
          result.objectId=object.objectId;break;
        case 'remove_physics':
          object=this.requireObject(command.objectId);
          if(!object.physics)throw Error('Object has no physics configuration');
          delete object.physics;this.physicsBodies.delete(object.objectId);
          result.objectId=object.objectId;break;
        case 'delete':
          object=this.requireObject(command.objectId);
          this.scene.objects=this.scene.objects.filter(o=>o.objectId!==object.objectId);
          for(const dependent of this.scene.objects)if(dependent.component?.targetObjectId===object.objectId){
            dependent.component.status='failed';dependent.component.error='Component target was deleted';}
          if (this.selection.objectId===object.objectId) this.selection.objectId='';
          this.physicsBodies.delete(object.objectId);this.physicsVerification.delete(object.objectId);
          result.objectId=object.objectId; break;
        case 'clear': this.scene.objects=[]; this.selection.objectId='';
          this.physicsBodies.clear();this.physicsVerification.clear();break;
        case 'load':
          this.validateScene(command.scene); this.scene=clone(command.scene); this.selection.objectId='';
          this.physicsBodies.clear();this.physicsVerification.clear();this.physicsSceneReference=this.scene;break;
        case 'undo': this.replay(this.undo,this.redo); break;
        case 'redo': this.replay(this.redo,this.undo); break;
        default: throw Error('Unknown operation');
      }
      if (before) {this.undo.push(before); if(this.undo.length>32)this.undo.shift(); this.redo=[];}
      result.ok=true;
    } catch(error) {result.error=error.message||String(error);}
    return result;
  }
  requireObject(id) {const object=this.scene.objects.find(o=>o.objectId===id); if(!object)throw Error('Unknown objectId'); return object;}
  failComponent(objectId,message){
    const component=this.scene.objects.find(object=>object.objectId===objectId)?.component;
    if(!component||component.status!=='running')return false;
    component.status='failed';component.error=String(message).slice(0,120);return true;
  }
  validateScene(scene) {
    if (!scene||scene.schemaVersion!==1||scene.roomId!==this.scene.roomId||!Array.isArray(scene.objects)||scene.objects.length>MAX_OBJECTS) throw Error('Incompatible scene');
    if(scene.objects.filter(object=>object.physics).length>16)throw Error('Physics object limit reached');
    const ids=new Set();
    for(const o of scene.objects) {
      if(!validId(o.objectId)||ids.has(o.objectId)||!this.asset(o.assetId)||!this.availableAnchors().some(anchor=>anchor.anchorId===o.anchorId)||!validTransform(o.transform)) throw Error('Invalid scene object');
      const anchor=this.spatial?.anchors.find(item=>item.anchorId===o.anchorId);
      if(anchor?.surface.kind==='support')this.assertSupportedFootprint(o.transform,o.assetId,anchor);
      ids.add(o.objectId);
      if(o.behaviors && (!Array.isArray(o.behaviors)||o.behaviors.length>2||new Set(o.behaviors.map(b=>b.kind)).size!==o.behaviors.length||!o.behaviors.every(validBehavior))) throw Error('Invalid scene behavior');
      if(o.component){validateAttachment(o.component);if(o.anchorId!==ANCHOR_ID)throw Error('Component requires virtual-floor object');}
      if(o.animation&&(o.anchorId!==ANCHOR_ID||!validAnimationBinding(o.animation,this.asset(o.assetId))))
        throw Error('Invalid GLB animation binding');
      if(o.physics)this.assertPhysicsEligible(o);
    }
    for(const o of scene.objects)if(o.component){
      const target=scene.objects.find(item=>item.objectId===o.component.targetObjectId);
      if(target&&(target.anchorId!==ANCHOR_ID||target.objectId===o.objectId))throw Error('Invalid component target');
      if(!target&&o.component.status!=='failed')throw Error('Invalid component target');
    }
  }
  replay(from,to) {if(!from.length)throw Error('History is empty'); to.push(clone(this.scene)); if(to.length>32)to.shift(); this.scene=from.pop(); this.selection.objectId='';this.physicsBodies.clear();this.physicsVerification.clear();this.physicsSceneReference=this.scene;}
}
