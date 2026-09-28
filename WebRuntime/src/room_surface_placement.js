import * as THREE from 'three';

const matrix=transform=>new THREE.Matrix4().compose(
  new THREE.Vector3(...['x','y','z'].map(axis=>transform.position[axis])),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(
    ...['x','y','z'].map(axis=>THREE.MathUtils.degToRad(transform.rotation[axis])),
    'XYZ')),
  new THREE.Vector3(...['x','y','z'].map(axis=>transform.scale[axis])));

const rounded=value=>Number(value.toFixed(6));
const plain=vector=>Object.fromEntries(['x','y','z'].map(axis=>[axis,rounded(vector[axis])]));

// A measured plane is a temporary AR coordinate frame. Store the placed entity
// in the one persistent digital scene while retaining its current AR pose.
export function surfaceToVirtualTransform(surfaceTransform,roomPose,webFloorPose){
  const inVirtual=matrix(webFloorPose).invert().multiply(matrix(roomPose))
    .multiply(matrix(surfaceTransform));
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  inVirtual.decompose(position,rotation,scale);
  const euler=new THREE.Euler().setFromQuaternion(rotation,'XYZ');
  return {position:plain(position),
    rotation:Object.fromEntries(['x','y','z'].map(axis=>
      [axis,rounded(THREE.MathUtils.radToDeg(euler[axis]))])),
    scale:plain(scale)};
}
