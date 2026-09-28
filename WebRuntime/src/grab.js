import * as THREE from 'three';

const position = value => ({x:Number(value.x.toFixed(3)),y:Number(value.y.toFixed(3)),z:Number(value.z.toFixed(3))});
const rotation = value => ({x:Number(THREE.MathUtils.radToDeg(value.x).toFixed(2)),
  y:Number(THREE.MathUtils.radToDeg(value.y).toFixed(2)),z:Number(THREE.MathUtils.radToDeg(value.z).toFixed(2))});
const STICK_DEAD_ZONE=.18;
const STICK_SPEED=.75;
const STICK_TRAVEL_LIMIT=3;

export function beginGrab(controller,root){
  controller.updateMatrixWorld(true);
  root.parent?.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  return {controller,root,
    offset:new THREE.Matrix4().copy(controller.matrixWorld).invert().multiply(root.matrixWorld),
    stickOffset:new THREE.Vector3(),
    startPosition:root.getWorldPosition(new THREE.Vector3()),
    startQuaternion:root.getWorldQuaternion(new THREE.Quaternion())};
}

export function moveGrabThumbstick(grab,axes,vertical,viewerDirection,seconds){
  if(!grab||!axes||axes.length<4||!viewerDirection||!Number.isFinite(seconds)||seconds<=0)return false;
  const x=axes[2],y=axes[3];
  if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>1||Math.abs(y)>1)return false;
  const magnitude=Math.hypot(x,y);
  if(magnitude<=STICK_DEAD_ZONE)return false;
  const forward=new THREE.Vector3(viewerDirection.x,0,viewerDirection.z);
  if(!Number.isFinite(forward.x)||!Number.isFinite(forward.z)||forward.lengthSq()<1e-6)return false;
  forward.normalize();
  const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0));
  const speed=Math.min(1,(Math.min(magnitude,1)-STICK_DEAD_ZONE)/(1-STICK_DEAD_ZONE))*
    STICK_SPEED*Math.min(seconds,.1);
  const step=right.multiplyScalar(x/magnitude*speed);
  if(vertical)step.y=-y/magnitude*speed;
  else step.addScaledVector(forward,-y/magnitude*speed);
  const next=grab.stickOffset.clone().add(step);
  if(next.length()>STICK_TRAVEL_LIMIT)next.setLength(STICK_TRAVEL_LIMIT);
  if(next.distanceToSquared(grab.stickOffset)<1e-12)return false;
  grab.stickOffset.copy(next);
  return true;
}

export function moveGrab(grab){
  if(grab.controller.visible===false)return false;
  grab.controller.updateMatrixWorld(true);
  const world=new THREE.Matrix4().multiplyMatrices(grab.controller.matrixWorld,grab.offset);
  world.elements[12]+=grab.stickOffset?.x||0;
  world.elements[13]+=grab.stickOffset?.y||0;
  world.elements[14]+=grab.stickOffset?.z||0;
  grab.root.parent?.updateMatrixWorld(true);
  const parentInverse=grab.root.parent ? new THREE.Matrix4().copy(grab.root.parent.matrixWorld).invert() : new THREE.Matrix4();
  const local=parentInverse.multiply(world);
  const nextPosition=new THREE.Vector3(),nextQuaternion=new THREE.Quaternion(),nextScale=new THREE.Vector3();
  local.decompose(nextPosition,nextQuaternion,nextScale);
  if(!['x','y','z'].every(axis=>Number.isFinite(nextPosition[axis])&&Math.abs(nextPosition[axis])<=100))return false;
  grab.root.position.copy(nextPosition);grab.root.quaternion.copy(nextQuaternion);grab.root.scale.copy(nextScale);
  grab.root.updateMatrixWorld(true);
  return true;
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

export function movePointerGrabVertical(grab,raycaster,pixels){
  const nextY=grab.root.position.y-pixels*.01;
  if(!Number.isFinite(nextY)||Math.abs(nextY)>100)return false;
  grab.root.position.y=nextY;
  grab.root.updateMatrixWorld(true);
  grab.plane.constant=-grab.root.getWorldPosition(new THREE.Vector3()).y;
  const hit=raycaster.ray.intersectPlane(grab.plane,new THREE.Vector3());
  if(hit){
    if(grab.root.parent)grab.root.parent.worldToLocal(hit);
    grab.offset.copy(grab.root.position).sub(hit);
  }
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
