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

const cross2=(a,b)=>a.x*b.z-a.z*b.x;
const FOOTPRINT_EPSILON=1e-5;
function onBoundary(point,boundary){
  return boundary.some((a,index)=>{
    const b=boundary[(index+1)%boundary.length],edge={x:b.x-a.x,z:b.z-a.z};
    const relative={x:point.x-a.x,z:point.z-a.z};
    const lengthSquared=edge.x*edge.x+edge.z*edge.z;
    return lengthSquared>FOOTPRINT_EPSILON*FOOTPRINT_EPSILON&&
      Math.abs(cross2(relative,edge))<=FOOTPRINT_EPSILON*Math.sqrt(lengthSquared)&&
      relative.x*edge.x+relative.z*edge.z>=-FOOTPRINT_EPSILON&&
      relative.x*edge.x+relative.z*edge.z<=lengthSquared+FOOTPRINT_EPSILON;
  });
}
const insideOrOnBoundary=(point,boundary)=>onBoundary(point,boundary)||insideBoundary(point,boundary);

// Every segment of the rectangular footprint must stay inside the (possibly
// concave) support polygon. Four accepted corners alone can bridge a notch.
export function footprintInsideBoundary(corners,boundary){
  if(!Array.isArray(corners)||corners.length!==4||!Array.isArray(boundary)||boundary.length<3||
     !corners.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.z)))return false;
  if(!corners.every(point=>insideOrOnBoundary(point,boundary)))return false;
  const center={x:corners.reduce((sum,point)=>sum+point.x,0)/4,
    z:corners.reduce((sum,point)=>sum+point.z,0)/4};
  if(!insideOrOnBoundary(center,boundary))return false;
  for(let index=0;index<4;index++){
    const a=corners[index],b=corners[(index+1)%4],r={x:b.x-a.x,z:b.z-a.z};
    const lengthSquared=r.x*r.x+r.z*r.z;
    if(lengthSquared<=FOOTPRINT_EPSILON*FOOTPRINT_EPSILON)return false;
    const breaks=[0,1];
    for(let edge=0;edge<boundary.length;edge++){
      const c=boundary[edge],d=boundary[(edge+1)%boundary.length];
      const s={x:d.x-c.x,z:d.z-c.z},q={x:c.x-a.x,z:c.z-a.z};
      const denominator=cross2(r,s);
      if(Math.abs(denominator)>FOOTPRINT_EPSILON){
        const t=cross2(q,s)/denominator,u=cross2(q,r)/denominator;
        if(t>=-FOOTPRINT_EPSILON&&t<=1+FOOTPRINT_EPSILON&&
           u>=-FOOTPRINT_EPSILON&&u<=1+FOOTPRINT_EPSILON)
          breaks.push(Math.max(0,Math.min(1,t)));
      }else if(Math.abs(cross2(q,r))<=FOOTPRINT_EPSILON){
        for(const point of [c,d]){
          const t=((point.x-a.x)*r.x+(point.z-a.z)*r.z)/lengthSquared;
          if(t>=0&&t<=1)breaks.push(t);
        }
      }
    }
    breaks.sort((left,right)=>left-right);
    for(let part=1;part<breaks.length;part++){
      if(breaks[part]-breaks[part-1]<=FOOTPRINT_EPSILON)continue;
      const t=(breaks[part]+breaks[part-1])/2;
      if(!insideOrOnBoundary({x:a.x+r.x*t,z:a.z+r.z*t},boundary))return false;
    }
  }
  return true;
}

function extent(boundary,axis){
  const values=boundary.map(point=>point[axis]);return Math.max(...values)-Math.min(...values);
}

export function samePlaneShape(a,b){
  return a.displayName===b.displayName&&a.surface.kind===b.surface.kind&&
    Math.abs(extent(a.surface.boundary,'x')-extent(b.surface.boundary,'x'))<.08&&
    Math.abs(extent(a.surface.boundary,'z')-extent(b.surface.boundary,'z'))<.08;
}

export function measuredFloorHeight(anchors,viewerY){
  if(!Number.isFinite(viewerY))return null;
  const floors=anchors.filter(anchor=>anchor.surface?.kind==='support'&&
    anchor.semanticLabels?.includes('FLOOR')&&Number.isFinite(anchor.roomPose?.position?.y))
    .map(anchor=>anchor.roomPose.position.y)
    .filter(y=>viewerY-y>=.25&&viewerY-y<=2.5);
  return floors.length?Math.max(...floors):null;
}

// XRPlane object identity can be replaced after Quest room relocalization.
// Only reuse a session-local ID when the measured shape uniquely identifies it.
export function matchPlaneAnchor(anchor,previous,usedIds=new Set()){
  const matches=previous.filter(old=>!usedIds.has(old.anchorId)&&samePlaneShape(old,anchor));
  return matches.length===1?matches[0].anchorId:null;
}
