// This is the browser adapter for Matrix scene schema 1 and the existing
// /api/exchange command set. Keep changes to this contract coordinated with
// ControlService/server.py and Assets/Sandbox/Runtime/SandboxWorld.cs.
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
    this.undo=[]; this.redo=[];
  }
  snapshot(viewer=null) {
    const snapshot={scene:clone(this.scene),assets:clone([...ASSETS,...this.externalAssets].map(({assetId,displayName,description,spawnScale,localBounds})=>({assetId,displayName,description,spawnScale,...(localBounds?{localBounds}:{})}))),anchors:[{anchorId:ANCHOR_ID,displayName:'Virtual floor'}],selection:clone(this.selection),behaviorKinds:['rotate','bob'],roomContext:{mode:'white-room',state:'ready',message:'Browser virtual floor; physical room alignment is not verified.',alignmentVerified:false}};
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
         typeof entry.description!=='string'||entry.description.length>500||entry.spawnScale!==1||
         !/^[0-9a-f]{64}$/.test(entry.sha256)||entry.url!==`/api/web/assets/${entry.sha256}.glb`||
         !Number.isInteger(entry.byteLength)||entry.byteLength<20||entry.byteLength>16*1024*1024)throw Error('Invalid web asset entry');
      ids.add(entry.assetId);checked.push(clone(entry));
    }
    this.externalAssets=checked;
  }
  asset(id){return ASSETS.find(a=>a.assetId===id)||this.externalAssets.find(a=>a.assetId===id);}
  setSelection(objectId,position) {
    if (objectId && !this.scene.objects.some(o=>o.objectId===objectId)) throw Error('Unknown objectId');
    if (!vec(position,-100,100)) throw Error('Invalid selection position');
    this.selection={anchorId:ANCHOR_ID,objectId:objectId||'',position:clone(position)};
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
        case 'spawn':
          if (!this.asset(command.assetId)) throw Error('Unknown assetId');
          if (command.anchorId!==ANCHOR_ID) throw Error('Unknown anchorId');
          if (!validTransform(command.transform)) throw Error('Invalid transform');
          if (this.scene.objects.length>=MAX_OBJECTS) throw Error('Scene object limit reached');
          object={objectId:this.idFactory(),assetId:command.assetId,anchorId:ANCHOR_ID,transform:clone(command.transform)};
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
            this.scene.objects.push(duplicate); result.objectId=duplicate.objectId; }
          break;
        case 'set_transform':
          object=this.requireObject(command.objectId);
          if (!validTransform(command.transform)) throw Error('Invalid transform');
          if (command.anchorId && command.anchorId!==ANCHOR_ID) throw Error('Unknown anchorId');
          object.transform=clone(command.transform); result.objectId=object.objectId; break;
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
    if (!scene||scene.schemaVersion!==1||scene.roomId!==ROOM_ID||!Array.isArray(scene.objects)||scene.objects.length>MAX_OBJECTS) throw Error('Incompatible scene');
    const ids=new Set();
    for(const o of scene.objects) {
      if(!validId(o.objectId)||ids.has(o.objectId)||!this.asset(o.assetId)||o.anchorId!==ANCHOR_ID||!validTransform(o.transform)) throw Error('Invalid scene object');
      ids.add(o.objectId);
      if(o.behaviors && (!Array.isArray(o.behaviors)||o.behaviors.length>2||new Set(o.behaviors.map(b=>b.kind)).size!==o.behaviors.length||!o.behaviors.every(validBehavior))) throw Error('Invalid scene behavior');
    }
  }
  replay(from,to) {if(!from.length)throw Error('History is empty'); to.push(clone(this.scene)); if(to.length>32)to.shift(); this.scene=from.pop(); this.selection.objectId='';}
}
