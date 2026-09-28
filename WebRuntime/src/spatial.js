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

const finiteVector=value=>value&&['x','y','z'].every(axis=>Number.isFinite(value[axis]));
const finiteTransform=value=>value&&finiteVector(value.position)&&
  finiteVector(value.rotation)&&finiteVector(value.scale)&&
  ['x','y','z'].every(axis=>value.scale[axis]>0);
const matrixFromTransform=transform=>new THREE.Matrix4().compose(
  new THREE.Vector3(transform.position.x,transform.position.y,transform.position.z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(transform.rotation.x),
    THREE.MathUtils.degToRad(transform.rotation.y),
    THREE.MathUtils.degToRad(transform.rotation.z),'XYZ')),
  new THREE.Vector3(transform.scale.x,transform.scale.y,transform.scale.z));

// The object remains a virtual-floor entity. Convert its floor-aligned bounds
// through the tracked web-floor pose into the current measured support frame.
export function footprintFitsRoomSupport(transform,bounds,spawnScale,webFloorPose,anchor){
  if(!finiteTransform(transform)||!finiteTransform(webFloorPose)||
     !finiteTransform(anchor?.roomPose)||!finiteVector(bounds?.size)||
     bounds.size.x<=0||bounds.size.z<=0||
     !Number.isFinite(spawnScale)||spawnScale<=0||
     anchor?.source!=='webxr'||anchor.surface?.kind!=='support'||
     !Array.isArray(anchor.surface.boundary)||
     Math.abs(transform.rotation.x)>.01||Math.abs(transform.rotation.z)>.01)
    return {ok:false,reason:'Room constraint needs upright measured object and support geometry'};
  const toSupport=matrixFromTransform(anchor.roomPose).invert()
    .multiply(matrixFromTransform(webFloorPose))
    .multiply(matrixFromTransform(transform));
  const halfX=bounds.size.x*spawnScale/2,halfZ=bounds.size.z*spawnScale/2;
  const corners=[[-halfX,-halfZ],[halfX,-halfZ],[halfX,halfZ],[-halfX,halfZ]]
    .map(([x,z])=>new THREE.Vector3(x,0,z).applyMatrix4(toSupport));
  const feet=new THREE.Vector3(0,0,0).applyMatrix4(toSupport);
  if(![feet,...corners].every(point=>Number.isFinite(point.y)&&Math.abs(point.y)<=.08))
    return {ok:false,reason:'Object feet do not meet the measured support plane'};
  if(!footprintInsideBoundary(corners,anchor.surface.boundary))
    return {ok:false,reason:'Object footprint extends beyond the measured room surface'};
  return {ok:true};
}

const VOLUME_EPSILON=.005;
const boxEdges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],
  [2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
const same2=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z)<VOLUME_EPSILON;
const onVolumeBoundary=(point,boundary)=>boundary.some((a,index)=>{
  const b=boundary[(index+1)%boundary.length];
  const edge={x:b.x-a.x,z:b.z-a.z};
  const relative={x:point.x-a.x,z:point.z-a.z};
  const lengthSquared=edge.x*edge.x+edge.z*edge.z;
  const dot=relative.x*edge.x+relative.z*edge.z;
  return lengthSquared>VOLUME_EPSILON*VOLUME_EPSILON&&
    Math.abs(cross2(relative,edge))<=VOLUME_EPSILON*Math.sqrt(lengthSquared)&&
    dot>=-VOLUME_EPSILON&&dot<=lengthSquared+VOLUME_EPSILON;
});
const strictlyInside=(point,boundary)=>
  !onVolumeBoundary(point,boundary)&&insideBoundary(point,boundary);
const properCross=(a,b,c,d)=>{
  const ab={x:b.x-a.x,z:b.z-a.z},cd={x:d.x-c.x,z:d.z-c.z};
  const ac={x:c.x-a.x,z:c.z-a.z},ad={x:d.x-a.x,z:d.z-a.z};
  const ca={x:a.x-c.x,z:a.z-c.z},cb={x:b.x-c.x,z:b.z-c.z};
  const one=cross2(ab,ac),two=cross2(ab,ad);
  const three=cross2(cd,ca),four=cross2(cd,cb);
  return one*two< -VOLUME_EPSILON*VOLUME_EPSILON&&
    three*four< -VOLUME_EPSILON*VOLUME_EPSILON;
};
function polygonsOverlap(a,b){
  if(a.some(point=>strictlyInside(point,b))||
     b.some(point=>strictlyInside(point,a)))return true;
  const center=polygon=>({x:polygon.reduce((sum,p)=>sum+p.x,0)/polygon.length,
    z:polygon.reduce((sum,p)=>sum+p.z,0)/polygon.length});
  // a is the convex box section. A measured polygon may be concave, with its
  // arithmetic vertex center in empty space outside that polygon.
  if(strictlyInside(center(a),b))return true;
  return a.some((point,index)=>b.some((other,edge)=>
    properCross(point,a[(index+1)%a.length],other,b[(edge+1)%b.length])));
}

// Check the finite measured polygon, not its infinite plane or an axis-aligned
// room box. Touching a plane at an object's top/bottom is allowed; crossing it
// inside the polygon is not. WebXR surfaces are session observations only.
export function volumeIntersectsMeasuredPlane(transform,bounds,spawnScale,
  basePose,plane,{floorAligned=false}={}){
  if(!finiteTransform(transform)||!finiteTransform(basePose)||
     !finiteTransform(plane?.roomPose)||!finiteVector(bounds?.size)||
     !['x','y','z'].every(axis=>bounds.size[axis]>0)||
     !Number.isFinite(spawnScale)||spawnScale<=0||
     plane?.source!=='webxr'||!['support','wall'].includes(plane.surface?.kind)||
     !Array.isArray(plane.surface.boundary)||plane.surface.boundary.length<3)
    return false;
  const toPlane=matrixFromTransform(plane.roomPose).invert()
    .multiply(matrixFromTransform(basePose))
    .multiply(matrixFromTransform(transform));
  const half={x:bounds.size.x*spawnScale/2,y:bounds.size.y*spawnScale/2,
    z:bounds.size.z*spawnScale/2};
  // Imported GLBs are recentered horizontally and floor aligned by loadExternal.
  // Built-ins retain their authored vertical center.
  const centerY=(floorAligned?bounds.size.y/2:bounds.center.y)*spawnScale;
  const corners=[];
  for(const x of [-half.x,half.x])for(const y of [centerY-half.y,centerY+half.y])
    for(const z of [-half.z,half.z])
      corners.push(new THREE.Vector3(x,y,z).applyMatrix4(toPlane));
  const heights=corners.map(point=>point.y);
  if(Math.min(...heights)>=-VOLUME_EPSILON||
     Math.max(...heights)<=VOLUME_EPSILON)return false;
  const section=[];
  const add=point=>{if(!section.some(other=>same2(other,point)))section.push(point);};
  for(const [i,j] of boxEdges){
    const a=corners[i],b=corners[j];
    if(Math.abs(a.y)<=VOLUME_EPSILON)add({x:a.x,z:a.z});
    if(Math.abs(b.y)<=VOLUME_EPSILON)add({x:b.x,z:b.z});
    if(a.y*b.y<0){const t=a.y/(a.y-b.y);
      add({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}
  }
  if(section.length<3)return false;
  const cx=section.reduce((sum,p)=>sum+p.x,0)/section.length;
  const cz=section.reduce((sum,p)=>sum+p.z,0)/section.length;
  section.sort((a,b)=>Math.atan2(a.z-cz,a.x-cx)-Math.atan2(b.z-cz,b.x-cx));
  return polygonsOverlap(section,plane.surface.boundary);
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
