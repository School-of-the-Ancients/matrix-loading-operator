import * as THREE from 'three';

export const DEFAULT_AR_LAYOUT_OFFSET=Object.freeze({x:0,z:0,yawDegrees:0});
const MOVE_STEP=.25;
const TURN_STEP=15;
const MAX_TRANSLATION=10;

export function checkedARLayoutOffset(value){
  if(value===undefined)return {...DEFAULT_AR_LAYOUT_OFFSET};
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).sort().join(',')!=='x,yawDegrees,z'||
     !['x','z','yawDegrees'].every(key=>typeof value[key]==='number'&&Number.isFinite(value[key]))||
     Math.abs(value.x)>MAX_TRANSLATION||Math.abs(value.z)>MAX_TRANSLATION||
     Math.abs(value.yawDegrees)>180)
    throw Error('Invalid saved AR layout offset');
  return {x:value.x,z:value.z,yawDegrees:value.yawDegrees};
}

export function adjustedARLayoutOffset(current,action){
  const offset=checkedARLayoutOffset(current);
  if(action==='layout-turn-left'||action==='layout-turn-right'){
    const delta=action==='layout-turn-left'?TURN_STEP:-TURN_STEP;
    const yaw=((offset.yawDegrees+delta+180)%360+360)%360-180;
    return {...offset,yawDegrees:yaw};
  }
  const direction={
    'layout-forward':{x:0,z:-1},'layout-back':{x:0,z:1},
    'layout-left':{x:-1,z:0},'layout-right':{x:1,z:0}
  }[action];
  if(!direction)throw Error('Unknown AR layout adjustment');
  const radians=THREE.MathUtils.degToRad(offset.yawDegrees);
  const dx=(direction.x*Math.cos(radians)+direction.z*Math.sin(radians))*MOVE_STEP;
  const dz=(-direction.x*Math.sin(radians)+direction.z*Math.cos(radians))*MOVE_STEP;
  return checkedARLayoutOffset({...offset,
    x:Number((offset.x+dx).toFixed(3)),z:Number((offset.z+dz).toFixed(3))});
}

export function composeARLayoutPose(root,anchorPose,offset){
  const layout=checkedARLayoutOffset(offset);
  const {position,orientation}=anchorPose.transform;
  const anchorQuaternion=new THREE.Quaternion(orientation.x,orientation.y,
    orientation.z,orientation.w);
  root.position.set(position.x,position.y,position.z).add(
    new THREE.Vector3(layout.x,0,layout.z).applyQuaternion(anchorQuaternion));
  root.quaternion.copy(anchorQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(layout.yawDegrees)));
}
