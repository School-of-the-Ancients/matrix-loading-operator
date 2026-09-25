import * as THREE from 'three';

const position = value => ({x:Number(value.x.toFixed(3)),y:Number(value.y.toFixed(3)),z:Number(value.z.toFixed(3))});
const rotation = value => ({x:Number(THREE.MathUtils.radToDeg(value.x).toFixed(2)),
  y:Number(THREE.MathUtils.radToDeg(value.y).toFixed(2)),z:Number(THREE.MathUtils.radToDeg(value.z).toFixed(2))});

export function beginGrab(controller,root){
  controller.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  return {controller,root,
    offset:new THREE.Matrix4().copy(controller.matrixWorld).invert().multiply(root.matrixWorld),
    startPosition:root.getWorldPosition(new THREE.Vector3()),
    startQuaternion:root.getWorldQuaternion(new THREE.Quaternion())};
}

export function moveGrab(grab){
  grab.controller.updateMatrixWorld(true);
  const world=new THREE.Matrix4().multiplyMatrices(grab.controller.matrixWorld,grab.offset);
  const parentInverse=grab.root.parent ? new THREE.Matrix4().copy(grab.root.parent.matrixWorld).invert() : new THREE.Matrix4();
  parentInverse.multiply(world).decompose(grab.root.position,grab.root.quaternion,grab.root.scale);
  grab.root.updateMatrixWorld(true);
}

export function finishGrab(grab,previousTransform){
  moveGrab(grab);
  const currentPosition=grab.root.getWorldPosition(new THREE.Vector3());
  const currentQuaternion=grab.root.getWorldQuaternion(new THREE.Quaternion());
  if(currentPosition.distanceTo(grab.startPosition)<.005&&currentQuaternion.angleTo(grab.startQuaternion)<THREE.MathUtils.degToRad(.5))return null;
  const angles=new THREE.Euler().setFromQuaternion(grab.root.quaternion,'XYZ');
  return {position:position(grab.root.position),rotation:rotation(angles),scale:structuredClone(previousTransform.scale)};
}

export function beginPointerGrab(raycaster,root){
  root.updateMatrixWorld(true);
  const height=root.getWorldPosition(new THREE.Vector3()).y;
  const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-height);
  const hit=raycaster.ray.intersectPlane(plane,new THREE.Vector3());
  if(!hit)return null;
  if(root.parent)root.parent.worldToLocal(hit);
  return {root,plane,offset:root.position.clone().sub(hit),startPosition:root.position.clone()};
}

export function movePointerGrab(grab,raycaster){
  const hit=raycaster.ray.intersectPlane(grab.plane,new THREE.Vector3());
  if(!hit)return false;
  if(grab.root.parent)grab.root.parent.worldToLocal(hit);
  const next=hit.add(grab.offset);
  if(!['x','y','z'].every(axis=>Number.isFinite(next[axis])&&Math.abs(next[axis])<=100))return false;
  grab.root.position.copy(next);
  grab.root.updateMatrixWorld(true);
  return true;
}

export function finishPointerGrab(grab,previousTransform){
  if(grab.root.position.distanceTo(grab.startPosition)<.005)return null;
  return {...structuredClone(previousTransform),position:position(grab.root.position)};
}

export function moveDesktopCamera(camera,keys,seconds){
  const forward=camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
  const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0));
  const step=new THREE.Vector3();
  if(keys.has('ArrowUp')||keys.has('KeyW'))step.add(forward);
  if(keys.has('ArrowDown')||keys.has('KeyS'))step.sub(forward);
  if(keys.has('ArrowRight')||keys.has('KeyD'))step.add(right);
  if(keys.has('ArrowLeft')||keys.has('KeyA'))step.sub(right);
  if(step.lengthSq()===0)return;
  camera.position.addScaledVector(step.normalize(),Math.min(seconds,.05)*2.5);
  camera.position.x=THREE.MathUtils.clamp(camera.position.x,-100,100);
  camera.position.z=THREE.MathUtils.clamp(camera.position.z,-100,100);
}
