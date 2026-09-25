import * as THREE from 'three';

const rounded=(value,digits=3)=>Number(value.toFixed(digits));
export const point=value=>({x:rounded(value.x),y:rounded(value.y),z:rounded(value.z)});
const finitePoint=value=>value&&['x','y','z'].every(key=>Number.isFinite(value[key])&&Math.abs(value[key])<=100);

export function viewerPose(frame,referenceSpace){
  const pose=frame?.getViewerPose?.(referenceSpace);
  const transform=pose?.transform;
  if(!finitePoint(transform?.position)||!transform?.orientation)return null;
  const {x,y,z,w}=transform.orientation;
  if(![x,y,z,w].every(Number.isFinite))return null;
  const quaternion=new THREE.Quaternion(x,y,z,w).normalize();
  const direction=new THREE.Vector3(0,0,-1).applyQuaternion(quaternion).normalize();
  return {position:new THREE.Vector3(transform.position.x,transform.position.y,transform.position.z),quaternion,direction};
}

export function planeData(plane,frame,referenceSpace,anchorId){
  const pose=frame.getPose(plane.planeSpace,referenceSpace);
  if(!finitePoint(pose?.transform?.position)||!pose.transform.orientation)return null;
  const orientation=pose.transform.orientation;
  if(![orientation.x,orientation.y,orientation.z,orientation.w].every(Number.isFinite))return null;
  const polygon=[...(plane.polygon||[])];
  if(polygon.length<3||polygon.length>256||!polygon.every(finitePoint))return null;
  const quaternion=new THREE.Quaternion(orientation.x,orientation.y,orientation.z,orientation.w).normalize();
  const normal=new THREE.Vector3(0,1,0).applyQuaternion(quaternion);
  const upward=plane.orientation==='horizontal'&&Math.abs(normal.y)>.7;
  if(upward&&normal.y<0)quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI));
  const label=typeof plane.semanticLabel==='string'&&/^[a-z0-9_ -]{1,64}$/i.test(plane.semanticLabel)
    ?plane.semanticLabel.toUpperCase().replaceAll('_',' '):(upward?'HORIZONTAL SURFACE':plane.orientation==='vertical'?'WALL':'OTHER SURFACE');
  const support=upward&&!/CEILING/.test(label);
  const boundary=polygon.map(vertex=>({x:rounded(vertex.x),y:0,z:rounded(upward&&normal.y<0?-vertex.z:vertex.z)}));
  const area=Math.abs(boundary.reduce((sum,a,index)=>{const b=boundary[(index+1)%boundary.length];return sum+a.x*b.z-b.x*a.z;},0));
  if(area<.0001)return null;
  const euler=new THREE.Euler().setFromQuaternion(quaternion,'XYZ');
  return {anchorId,displayName:label,source:'webxr',semanticLabels:[label],
    surface:{kind:support?'support':plane.orientation==='vertical'?'wall':'other',boundary},
    roomPose:{position:point(pose.transform.position),rotation:{x:rounded(THREE.MathUtils.radToDeg(euler.x),2),y:rounded(THREE.MathUtils.radToDeg(euler.y),2),z:rounded(THREE.MathUtils.radToDeg(euler.z),2)},scale:{x:1,y:1,z:1}},
    quaternion};
}

export function insideBoundary(position,boundary){
  let inside=false;
  for(let i=0,j=boundary.length-1;i<boundary.length;j=i++){
    const a=boundary[i],b=boundary[j];
    if((a.z>position.z)!==(b.z>position.z)&&position.x<(b.x-a.x)*(position.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return inside;
}

function extent(boundary,axis){
  const values=boundary.map(point=>point[axis]);return Math.max(...values)-Math.min(...values);
}

export function samePlaneShape(a,b){
  return a.displayName===b.displayName&&a.surface.kind===b.surface.kind&&
    Math.abs(extent(a.surface.boundary,'x')-extent(b.surface.boundary,'x'))<.08&&
    Math.abs(extent(a.surface.boundary,'z')-extent(b.surface.boundary,'z'))<.08;
}

// XRPlane object identity can be replaced after Quest room relocalization.
// Only reuse a session-local ID when the measured shape uniquely identifies it.
export function matchPlaneAnchor(anchor,previous,usedIds=new Set()){
  const matches=previous.filter(old=>!usedIds.has(old.anchorId)&&samePlaneShape(old,anchor));
  return matches.length===1?matches[0].anchorId:null;
}
