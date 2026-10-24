import * as THREE from 'three';
import {partNode} from './asset_parts.js';

export function validSurface(value){
  return value&&/^[a-f0-9-]{36}$/.test(value.selectionId||'')&&
    ['objectId','assetId'].every(k=>typeof value[k]==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value[k]))&&
    ['nodeIndex','primitiveIndex'].every(k=>value[k]===null||Number.isInteger(value[k])&&value[k]>=0&&value[k]<256)&&
    (value.nodeIndex!==null||value.primitiveIndex===null)&&value.localPoint&&
    Object.keys(value.localPoint).sort().join(',')==='x,y,z'&&Object.values(value.localPoint).every(n=>Number.isFinite(n)&&Math.abs(n)<=100);
}
export function selectedSurface(world){
  const value=world.surfaceSelection;
  return validSurface(value)&&world.scene.objects.some(o=>o.objectId===value.objectId&&o.assetId===value.assetId)?value:null;
}
export function surfaceFromHit(hit,root,object){
  if(!hit?.point||!root||!object)return null;
  let node=hit.object,primitiveIndex=null;
  while(node&&node!==root&&node.userData.matrixNodeIndex===undefined){
    primitiveIndex??=node.userData.matrixPrimitiveIndex??null;node=node.parent;
  }
  const nodeIndex=node?.userData.matrixNodeIndex??null;
  primitiveIndex=nodeIndex===null?null:(primitiveIndex??node?.userData.matrixPrimitiveIndex??null);
  const target=nodeIndex===null?root:partNode(root,{nodeIndex,...(primitiveIndex===null?{}:{primitiveIndex})});
  if(!target)return null;target.updateWorldMatrix(true,false);
  const point=target.worldToLocal(hit.point.clone());
  const value={selectionId:crypto.randomUUID(),objectId:object.objectId,assetId:object.assetId,
    nodeIndex,primitiveIndex,localPoint:{x:point.x,y:point.y,z:point.z}};
  return validSurface(value)?value:null;
}
export function surfacePosition(root,value,target=new THREE.Vector3()){
  if(!root||!validSurface(value))return null;
  const node=value.nodeIndex===null?root:partNode(root,{nodeIndex:value.nodeIndex,...(value.primitiveIndex===null?{}:{primitiveIndex:value.primitiveIndex})});
  if(!node)return null;
  for(let parent=node;parent;parent=parent.parent)if(parent.visible===false)return null;
  node.updateWorldMatrix(true,false);target.set(value.localPoint.x,value.localPoint.y,value.localPoint.z);
  return node.localToWorld(target);
}
