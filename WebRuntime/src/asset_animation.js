import * as THREE from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';

// GLB clips are data from the validated catalog. Only a single clip is
// auto-looped; multi-clip selection needs an explicit binding contract.
function safeTrack(track){
  if(!track?.times||!track?.values||track.times.length<2||track.times.length>2000)return false;
  for(let index=0;index<track.times.length;index++){
    const value=track.times[index];
    if(!Number.isFinite(value)||value<0||value>120||index&&value<track.times[index-1])return false;
  }
  const limit=track.name.endsWith('.quaternion')?1.1:20;
  for(const value of track.values)if(!Number.isFinite(value)||Math.abs(value)>limit)return false;
  return true;
}
export function instantiateAnimatedAsset(gltf,asset,{play=true}={}){
  const advertised=asset.geometry?.animationClips||[];
  const clips=gltf.animations||[];
  if(!Array.isArray(advertised)||!Array.isArray(clips)||advertised.length!==clips.length||
     !clips.every((clip,index)=>clip.name===advertised[index]?.name&&
       Number.isFinite(clip.duration)&&clip.duration>=0&&clip.duration<=120&&
       Math.abs(clip.duration-advertised[index]?.durationSeconds)<=.05&&
       clip.tracks.length>=1&&clip.tracks.length<=128&&clip.tracks.every(safeTrack)))
    throw Error('GLB animation clips differ from the validated asset catalog');
  const model=cloneSkeleton(gltf.scene);
  let mixer=null;
  if(play&&clips.length===1){
    mixer=new THREE.AnimationMixer(model);
    mixer.clipAction(clips[0]).setLoop(THREE.LoopRepeat,Infinity).play();
  }
  return {model,mixer};
}

export function stopAnimatedAsset(mixer,model){
  if(mixer){mixer.stopAllAction();mixer.uncacheRoot(model);}
}
