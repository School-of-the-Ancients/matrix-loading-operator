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
  // The tracked floor can serialize an upright yaw as XYZ x/z near 180 degrees.
  // Normalize small tracking tilt to the equivalent floor-upright yaw, so a
  // later measured-support move can use the stored transform unchanged. Keep a
  // genuinely tilted support's exact orientation instead of flattening it.
  const yaw=new THREE.Euler().setFromQuaternion(rotation,'YXZ').y;
  const upright=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
  const nearUpright=rotation.angleTo(upright)<=THREE.MathUtils.degToRad(.25);
  const full=new THREE.Euler().setFromQuaternion(rotation,'XYZ');
  return {position:plain(position),
    rotation:nearUpright?{x:0,y:rounded(THREE.MathUtils.radToDeg(yaw)),z:0}:
      Object.fromEntries(['x','y','z'].map(axis=>
        [axis,rounded(THREE.MathUtils.radToDeg(full[axis]))])),
    scale:plain(scale)};
}
