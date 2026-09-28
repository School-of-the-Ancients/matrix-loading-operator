import {insideBoundary} from './spatial.js';

const finitePoint=point=>point&&['x','y','z'].every(axis=>
  Number.isFinite(point[axis])&&Math.abs(point[axis])<=100);

export function currentSelectedPoint(world,selected,trackingEpoch){
  if(!selected||selected.roomId!==world.scene.roomId||
     selected.presentation!==world.runtimePresentation||!finitePoint(selected.position))return null;
  if(selected.presentation!=='ar')return selected.anchorId==='web-floor'?selected:null;
  const spatial=world.spatial;
  if(!spatial||world.digitalWorldVisit||spatial.stale||spatial.originUnavailable||
     !spatial.alignmentVerified||
     selected.trackingEpoch!==trackingEpoch||
     selected.trackingEpoch!==spatial.trackingEpoch||
     !world.originFresh()||!world.planeFresh())return null;
  const anchor=(spatial.observedAnchors||spatial.anchors).find(item=>
    item.anchorId===selected.anchorId&&item.source==='webxr'&&
    item.surface?.kind==='support');
  if(!anchor||Math.abs(selected.position.y)>.02||
     !insideBoundary(selected.position,anchor.surface.boundary))return null;
  return selected;
}

export function selectedPointAt(world,anchorId,position,trackingEpoch,source='raycast'){
  if(!finitePoint(position)||!['raycast','hit-test','adjusted'].includes(source)||
     source==='raycast'&&Math.abs(position.y)>.02)
    throw Error('Choose a current measured support point inside its boundary');
  const selected={anchorId,position:{x:position.x,y:0,z:position.z},source,
    roomId:world.scene.roomId,presentation:world.runtimePresentation,
    trackingEpoch:world.runtimePresentation==='ar'?trackingEpoch:null};
  if(!currentSelectedPoint(world,selected,trackingEpoch))
    throw Error('Choose a current measured support point inside its boundary');
  return selected;
}

export function agentSelectedPoint(world,selected,trackingEpoch){
  const current=currentSelectedPoint(world,selected,trackingEpoch);
  return current?{anchorId:current.anchorId,position:{...current.position},
    source:current.source}:null;
}
