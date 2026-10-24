import * as THREE from 'three';
export function validParts(parts){
  return Array.isArray(parts)&&parts.length<=64&&new Set(parts.map(p=>p?.partId)).size===parts.length&&parts.every(p=>
    p&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(p.partId)&&typeof p.label==='string'&&p.label.length>0&&p.label.length<=120&&
    typeof p.description==='string'&&p.description.length<=600&&!/[\x00-\x1f]/.test(p.label+p.description)&&
    ['authored','node-name'].includes(p.provenance)&&Number.isInteger(p.nodeIndex)&&p.nodeIndex>=0&&p.nodeIndex<256&&
    (p.primitiveIndex===undefined||Number.isInteger(p.primitiveIndex)&&p.primitiveIndex>=0&&p.primitiveIndex<256)&&
    (p.localPoint===undefined||p.localPoint&&Object.keys(p.localPoint).sort().join(',')==='x,y,z'&&Object.values(p.localPoint).every(n=>Number.isFinite(n)&&Math.abs(n)<=20)));
}
export function partNode(root,part){
  let node=null;
  (root?.userData.model||root)?.traverse(child=>{if(child.userData.matrixNodeIndex===part.nodeIndex)node=child;});
  if(!node||part.primitiveIndex===undefined)return node;
  let primitive=null;
  node.traverse(child=>{if(child.userData.matrixPrimitiveIndex===part.primitiveIndex)primitive=child;});
  return primitive;
}
export function partPosition(root,part,target=new THREE.Vector3()){
  const node=partNode(root,part);if(!node||!node.visible)return null;
  node.updateWorldMatrix(true,true);
  if(part.localPoint){target.set(part.localPoint.x,part.localPoint.y,part.localPoint.z);node.localToWorld(target);}
  else if(node.isMesh){node.geometry.computeBoundingBox();node.geometry.boundingBox.getCenter(target);node.localToWorld(target);}
  else{const box=new THREE.Box3().setFromObject(node);if(box.isEmpty())return null;box.getCenter(target);}
  return [target.x,target.y,target.z].every(Number.isFinite)?target:null;
}
export function partForHit(hit,asset){
  if(!hit||!asset?.parts?.length)return null;
  let node=hit.object,primitiveIndex;
  while(node&&node.userData.matrixNodeIndex===undefined){primitiveIndex??=node.userData.matrixPrimitiveIndex;node=node.parent;}
  if(!node)return null;
  primitiveIndex??=node.userData.matrixPrimitiveIndex;
  const candidates=asset.parts.filter(p=>p.nodeIndex===node.userData.matrixNodeIndex&&
    (p.primitiveIndex===undefined||p.primitiveIndex===primitiveIndex));
  const local=hit.point?node.worldToLocal(hit.point.clone()):null;
  const distance=p=>p.localPoint&&local?local.distanceTo(new THREE.Vector3(p.localPoint.x,p.localPoint.y,p.localPoint.z)):Infinity;
  // Landmarks within a joined mesh are picked only near their actual anchor;
  // elsewhere keep the honest whole-mesh target instead of naming a guessed part.
  const eligible=candidates.filter(p=>!p.localPoint||distance(p)<=.35);
  eligible.sort((a,b)=>Number(b.primitiveIndex!==undefined)-Number(a.primitiveIndex!==undefined)||
    Number(b.provenance==='authored')-Number(a.provenance==='authored')||(a.localPoint&&b.localPoint?distance(a)-distance(b):0));
  return eligible[0]||null;
}
export function selectedPart(world){
  const selected=world.partSelection;if(!selected||selected.objectId!==world.selection.objectId)return null;
  const object=world.scene.objects.find(o=>o.objectId===selected.objectId),asset=object&&world.asset(object.assetId);
  return asset&&asset.assetId===selected.assetId&&asset.partsRevision===selected.partsRevision&&asset.parts?.some(p=>p.partId===selected.partId)?selected:null;
}
export class PartMarker {
  constructor(){
    this.group=new THREE.Group();this.group.visible=false;
    const dot=new THREE.Mesh(new THREE.SphereGeometry(.025,12,8),new THREE.MeshBasicMaterial({color:0xffce68,depthTest:false,transparent:true,opacity:.95}));
    dot.renderOrder=999;dot.raycast=()=>{};this.group.add(dot);this.dot=dot;
    this.arrow=new THREE.ArrowHelper(new THREE.Vector3(0,-1,0),new THREE.Vector3(),.24,0xffce68,.07,.04);
    this.arrow.traverse(node=>{node.raycast=()=>{};if(node.material){node.material.depthTest=false;node.material.transparent=true;node.renderOrder=999;}});
    this.group.add(this.arrow);
    this.bounds=new THREE.Box3();this.outline=new THREE.Box3Helper(this.bounds,0x4be0eb);this.outline.material.depthTest=false;this.outline.renderOrder=998;this.outline.raycast=()=>{};this.group.add(this.outline);
    this.overlay=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:0x4be0eb,transparent:true,opacity:.3,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
    this.overlay.matrixAutoUpdate=false;this.overlay.renderOrder=998;this.overlay.raycast=()=>{};this.group.add(this.overlay);
    this.canvas=document.createElement('canvas');this.canvas.width=512;this.canvas.height=80;
    this.texture=new THREE.CanvasTexture(this.canvas);
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:this.texture,depthTest:false,transparent:true}));
    label.scale.set(.64,.1,1);label.renderOrder=999;label.raycast=()=>{};this.group.add(label);this.label=label;
  }
  show(position,text,node,part,mode='both'){
    this.group.visible=mode!=='off';this.dot.position.copy(position);
    this.label.position.copy(position).y+=.34;
    this.arrow.position.copy(position).y+=.28;this.arrow.visible=mode==='both'||mode==='arrow';
    const highlight=mode==='both'||mode==='highlight';
    this.outline.visible=highlight&&(!node?.isMesh||!!part.localPoint);this.overlay.visible=highlight&&node?.isMesh&&!part.localPoint;
    if(part.localPoint)this.bounds.setFromCenterAndSize(position,new THREE.Vector3(.12,.12,.12));
    else if(node)this.bounds.setFromObject(node);
    if(this.overlay.visible){this.overlay.geometry=node.geometry;this.overlay.matrix.copy(node.matrixWorld);}
    if(this.text===text)return;this.text=text;
    const ctx=this.canvas.getContext('2d');ctx.clearRect(0,0,512,80);ctx.fillStyle='rgba(8,19,30,.88)';ctx.fillRect(0,0,512,80);
    ctx.fillStyle='#ffe3a3';ctx.textAlign='center';ctx.font='bold 28px sans-serif';ctx.fillText(text.slice(0,50),256,50,490);this.texture.needsUpdate=true;
  }
}
