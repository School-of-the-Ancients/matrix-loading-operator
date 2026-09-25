// This is the browser adapter for Matrix scene schema 1 and the existing
// /api/exchange command set. Keep changes to this contract coordinated with
// ControlService/server.py and Assets/Sandbox/Runtime/SandboxWorld.cs.
import {footprintInsideBoundary} from './spatial.js';
export const ROOM_ID = 'web-virtual-room-v1';
export const ANCHOR_ID = 'web-floor';
export const MAX_OBJECTS = 100;
export const ASSETS = [
  {assetId:'chair', displayName:'Chair', description:'A wooden chair with a seat and back, about 0.6 by 0.9 metres.', spawnScale:1, localBounds:{center:{x:0,y:.45,z:0},size:{x:.6,y:.9,z:.6}}},
  {assetId:'table', displayName:'Table', description:'A wooden table about 1.5 metres wide and 0.75 metres high.', spawnScale:1, localBounds:{center:{x:0,y:.375,z:0},size:{x:1.5,y:.75,z:.9}}},
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

export class MatrixWorld {
  constructor(idFactory=()=>crypto.randomUUID().replaceAll('-','')) {
    this.idFactory=idFactory;
    this.externalAssets=[];
    this.scene={schemaVersion:1,roomId:ROOM_ID,objects:[]};
    this.selection={anchorId:ANCHOR_ID,objectId:'',position:{x:0,y:0,z:-2}};
    this.spatial=null;this.virtualScene=null;
    this.undo=[]; this.redo=[];
  }
  snapshot(viewer=null) {
    const anchors=this.availableAnchors();
    const context=this.spatial?{mode:'ar',state:this.spatial.stale?'missing':'ready',message:this.spatial.stale?'A plane holding a scene object is no longer tracked; keep the scene for recovery and recheck the room.':this.spatial.anchors.length?`${this.spatial.anchors.length} WebXR room plane(s) detected. Virtual-floor objects remain visible as unanchored previews.`:'Waiting for Quest room planes. Virtual-floor objects remain visible as unanchored previews.',alignmentVerified:this.spatial.alignmentVerified}
      :{mode:'white-room',state:'ready',message:'Browser virtual floor; physical room alignment is not verified.',alignmentVerified:false};
    const snapshot={scene:clone(this.scene),assets:clone([...ASSETS,...this.externalAssets].map(({assetId,displayName,description,spawnScale,localBounds})=>({assetId,displayName,description,spawnScale,...(localBounds?{localBounds}:{})}))),anchors:clone(anchors),selection:clone(this.selection),behaviorKinds:['rotate','bob'],roomContext:context};
    if(this.spatial?.stale)snapshot.readOnly=true;
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
      ids.add(entry.assetId);checked.push(clone(entry));
    }
    this.externalAssets=checked;
  }
  asset(id){return ASSETS.find(a=>a.assetId===id)||this.externalAssets.find(a=>a.assetId===id);}
  enterAR(){
    if(this.spatial)return;
    this.virtualScene={scene:clone(this.scene),selection:clone(this.selection),undo:this.undo,redo:this.redo};
    this.scene={...clone(this.scene),roomId:`webxr-session-${this.idFactory()}`};
    this.spatial={anchors:[],alignmentVerified:false};
    this.undo=[];this.redo=[];
  }
  leaveAR(){
    if(!this.spatial)return;
    // Carry edits to virtual-floor objects back to desktop. Physical anchors
    // are session-local and must not leak into a virtual-room snapshot.
    const saved=this.virtualScene;
    saved.scene.objects=clone(this.scene.objects.filter(object=>object.anchorId===ANCHOR_ID));
    this.scene=saved.scene;
    this.selection=this.selection.anchorId===ANCHOR_ID?this.selection:saved.selection;
    this.undo=[];this.redo=[];this.spatial=null;this.virtualScene=null;
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
    const xs=[bounds.center.x-bounds.size.x/2,bounds.center.x+bounds.size.x/2]
      .map(x=>x*transform.scale.x*spawnScale);
    const zs=[bounds.center.z-bounds.size.z/2,bounds.center.z+bounds.size.z/2]
      .map(z=>z*transform.scale.z*spawnScale);
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
      transform.position.y-=((bounds.center.y-bounds.size.y/2)*transform.scale.y*spawnScale);
    }
    return transform;
  }
  execute(command) {
    const result={requestId:command?.requestId||'',ok:false,error:'',objectId:''};
    try {
      if (!command || !validId(command.requestId)) throw Error('Invalid requestId');
      const op=command.op;
      const mutation=['spawn','duplicate','set_transform','set_behavior','remove_behavior','delete','clear','load'].includes(op);
      const before=mutation?clone(this.scene):null;
      let object;
      switch(op) {
        case 'get_scene': case 'list_assets': case 'list_targets': break;
        case 'confirm_room':
          if(!this.spatial||!this.spatial.anchors.some(anchor=>anchor.surface.kind==='support'))throw Error('No measured support surface to confirm');
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
          this.setSelection(object.objectId,object.transform.position); break;
        case 'duplicate':
          object=this.requireObject(command.objectId);
          if (this.scene.objects.length>=MAX_OBJECTS) throw Error('Scene object limit reached');
          { const duplicate=clone(object); duplicate.objectId=this.idFactory(); duplicate.transform.position.x=Math.min(100,duplicate.transform.position.x+.3);
            if (!validId(duplicate.objectId)||this.scene.objects.some(o=>o.objectId===duplicate.objectId)) throw Error('Invalid generated objectId');
            const anchor=this.spatial?.anchors.find(item=>item.anchorId===duplicate.anchorId);
            if(anchor?.surface.kind==='support')this.assertSupportedFootprint(duplicate.transform,duplicate.assetId,anchor);
            this.scene.objects.push(duplicate); result.objectId=duplicate.objectId; }
          break;
        case 'set_transform':
          object=this.requireObject(command.objectId);
          if (!validTransform(command.transform)) throw Error('Invalid transform');
          if (command.anchorId && command.anchorId!==object.anchorId) throw Error('Changing an object anchor is not supported');
          object.transform=this.resolvedTransform(command,object.assetId,object.anchorId); result.objectId=object.objectId; break;
        case 'set_behavior':
          object=this.requireObject(command.objectId);
          if (!validBehavior(command.behavior)) throw Error('Invalid behavior');
          object.behaviors=(object.behaviors||[]).filter(b=>b.kind!==command.behavior.kind);
          object.behaviors.push(clone(command.behavior)); result.objectId=object.objectId; break;
        case 'remove_behavior':
          object=this.requireObject(command.objectId);
          if (!['rotate','bob','all'].includes(command.behaviorKind)) throw Error('Invalid behaviorKind');
          object.behaviors=command.behaviorKind==='all'?[]:(object.behaviors||[]).filter(b=>b.kind!==command.behaviorKind);
          if (!object.behaviors.length) delete object.behaviors;
          result.objectId=object.objectId; break;
        case 'delete':
          object=this.requireObject(command.objectId);
          this.scene.objects=this.scene.objects.filter(o=>o.objectId!==object.objectId);
          if (this.selection.objectId===object.objectId) this.selection.objectId='';
          result.objectId=object.objectId; break;
        case 'clear': this.scene.objects=[]; this.selection.objectId=''; break;
        case 'load':
          this.validateScene(command.scene); this.scene=clone(command.scene); this.selection.objectId=''; break;
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
  validateScene(scene) {
    if (!scene||scene.schemaVersion!==1||scene.roomId!==this.scene.roomId||!Array.isArray(scene.objects)||scene.objects.length>MAX_OBJECTS) throw Error('Incompatible scene');
    const ids=new Set();
    for(const o of scene.objects) {
      if(!validId(o.objectId)||ids.has(o.objectId)||!this.asset(o.assetId)||!this.availableAnchors().some(anchor=>anchor.anchorId===o.anchorId)||!validTransform(o.transform)) throw Error('Invalid scene object');
      const anchor=this.spatial?.anchors.find(item=>item.anchorId===o.anchorId);
      if(anchor?.surface.kind==='support')this.assertSupportedFootprint(o.transform,o.assetId,anchor);
      ids.add(o.objectId);
      if(o.behaviors && (!Array.isArray(o.behaviors)||o.behaviors.length>2||new Set(o.behaviors.map(b=>b.kind)).size!==o.behaviors.length||!o.behaviors.every(validBehavior))) throw Error('Invalid scene behavior');
    }
  }
  replay(from,to) {if(!from.length)throw Error('History is empty'); to.push(clone(this.scene)); if(to.length>32)to.shift(); this.scene=from.pop(); this.selection.objectId='';}
}
