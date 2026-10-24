import * as THREE from 'three';

export function avatarPointerCollider(frame,size){
  return {frame,box:new THREE.Box3(
    new THREE.Vector3(-size.x/2,0,-size.z/2),
    new THREE.Vector3(size.x/2,size.y,size.z/2))};
}

function visibleInWorld(node){
  for(let current=node;current;current=current.parent)if(current.visible===false)return false;
  return true;
}

// Name labels, guide sprites and lines are presentation, not pickable surfaces.
// Animated avatars use a body envelope: skinning every triangle for each
// controller on every frame is too expensive for a standalone headset.
export function pointerObjectHits(raycaster,roots){
  const hits=[],meshes=[];
  for(const root of roots){
    if(!visibleInWorld(root))continue;
    const collider=root.userData.pointerCollider;
    if(collider){
      collider.frame.updateWorldMatrix(true,false);
      const inverse=new THREE.Matrix4().copy(collider.frame.matrixWorld).invert();
      const localRay=raycaster.ray.clone().applyMatrix4(inverse);
      const localPoint=localRay.intersectBox(collider.box,new THREE.Vector3());
      if(localPoint){
        const point=localPoint.applyMatrix4(collider.frame.matrixWorld);
        const distance=raycaster.ray.origin.distanceTo(point);
        if(distance>=raycaster.near&&distance<=raycaster.far)hits.push({object:root,point,distance});
      }
      continue;
    }
    root.updateWorldMatrix(true,true);
    root.traverseVisible(node=>{if(node.isMesh)meshes.push(node);});
  }
  hits.push(...raycaster.intersectObjects(meshes,false));
  return hits.sort((a,b)=>a.distance-b.distance);
}
