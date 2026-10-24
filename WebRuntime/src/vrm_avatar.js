import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,VRMUtils} from '@pixiv/three-vrm';

export async function loadVrmAvatar(asset,token,camera){
  const loader=new GLTFLoader();
  if(token)loader.setRequestHeader({Authorization:`Bearer ${token}`});
  loader.register(parser=>new VRMLoaderPlugin(parser,{autoUpdateHumanBones:true}));
  const gltf=await loader.loadAsync(asset.url),vrm=gltf.userData.vrm;
  if(!vrm||vrm.meta.metaVersion!=='1'){
    VRMUtils.deepDispose(gltf.scene);throw Error('The registered avatar is not VRM 1.0.');
  }
  try{
    const bounds=new THREE.Box3().setFromObject(vrm.scene),size=bounds.getSize(new THREE.Vector3());
    if(!['x','y','z'].every(axis=>Number.isFinite(size[axis])&&size[axis]>0&&size[axis]<=20))
      throw Error('Avatar has invalid rendered bounds.');
    const center=bounds.getCenter(new THREE.Vector3());
    const group=new THREE.Group();group.add(vrm.scene);
    vrm.scene.position.sub(new THREE.Vector3(center.x,bounds.min.y,center.z));
    vrm.humanoid.setNormalizedPose({
      leftUpperArm:{rotation:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,-1.2)).toArray()},
      rightUpperArm:{rotation:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,1.2)).toArray()}});
    vrm.lookAt&&(vrm.lookAt.target=camera);
    vrm.scene.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
    return {model:group,vrm,measuredSize:{x:size.x,y:size.y,z:size.z},dispose:()=>{
      VRMUtils.deepDispose(group);group.clear();
    }};
  }catch(error){VRMUtils.deepDispose(vrm.scene);throw error;}
}
