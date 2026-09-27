import {MatrixWorld} from './protocol.js';
import {restoreStoredWorld} from './scene_store.js';

const WORLD_NAME=/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
const ids=items=>items.map(item=>item.objectId).sort();
const residentIds=items=>items.map(item=>item.id).sort();
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

// The service publishes a checkpointed Citizens fixture with at most one
// reviewed procedural addition. Check its outer contract before staging the
// existing world-save validator.
export function stageHostedObservation(observation,previous=null){
  if(!exactKeys(observation,['schemaVersion','worldId','instanceId','sequence',
      'clockTick','online','readOnly','world'])||observation.schemaVersion!==1||
      observation.online!==true||observation.readOnly!==true||
      typeof observation.worldId!=='string'||!WORLD_NAME.test(observation.worldId)||
      typeof observation.instanceId!=='string'||
      !/^[0-9a-f]{32}$/.test(observation.instanceId)||
      !Number.isSafeInteger(observation.sequence)||observation.sequence<1||
      !Number.isSafeInteger(observation.clockTick)||observation.clockTick<0)
    throw Error('Invalid hosted world observation');
  const saved=observation.world;
  const objects=saved?.scene?.objects;
  const core=Array.isArray(objects)?objects.filter(item=>item?.assetId!=='matrix:procedural'):[];
  const created=Array.isArray(objects)?objects.filter(item=>item?.assetId==='matrix:procedural'):[];
  if(!exactKeys(saved,['version','scene','game','citizens'])||saved.version!==3||
      saved.game!==null||!exactKeys(saved.scene,['schemaVersion','roomId','objects'])||
      saved.scene.schemaVersion!==1||saved.scene.roomId!=='web-virtual-room-v1'||
      !Array.isArray(objects)||core.length!==4||created.length>1||
      core.map(item=>item?.assetId).sort().join(',')!=='chair,orb,orb,table'||
      core.some(item=>!exactKeys(item,['objectId','assetId','anchorId','transform'])||
        item.anchorId!=='web-floor')||
      created.some(item=>!exactKeys(item,['objectId','assetId','anchorId','transform','procedural'])||
        item.anchorId!=='web-floor')||
      !saved.citizens||typeof saved.citizens!=='object'||Array.isArray(saved.citizens)||
      saved.citizens.schemaVersion!==12||saved.citizens.clockSpeed!==1||
      saved.citizens.clockTick!==observation.clockTick||
      !Array.isArray(saved.citizens.residents)||
      saved.citizens.residents.map(item=>item.id).sort().join(',')!=='ada,bo'||
      !Array.isArray(saved.citizens.stations)||
      saved.citizens.stations.map(item=>item.id).sort().join(',')!=='chair,food')
    throw Error('Hosted world is outside the supported Citizens fixture');

  const staged=new MatrixWorld();
  restoreStoredWorld(staged,{...saved,originBinding:'virtual'});
  if(!staged.canVisitDigitalWorld())
    throw Error('Hosted Citizens world cannot be visited in AR');
  const sceneIds=ids(staged.scene.objects);
  const coreIds=ids(core);
  const citizenIds=residentIds(staged.citizens.residents);
  const bindingIds=[...staged.citizens.residents,...staged.citizens.stations]
    .map(item=>`${item.id}:${item.objectId}`).sort();
  const sceneStructure=JSON.stringify(staged.scene.objects.map(item=>({
    objectId:item.objectId,assetId:item.assetId,anchorId:item.anchorId,
    procedural:item.procedural??null})).sort((a,b)=>a.objectId.localeCompare(b.objectId)));
  const signature=JSON.stringify(saved);
  if(previous){
    if(observation.worldId!==previous.worldId||
       !previous.sceneIds.every(id=>sceneIds.includes(id))||
       !same(coreIds,previous.coreIds)||
       !same(citizenIds,previous.residentIds)||
       !same(bindingIds,previous.bindingIds)||
       observation.clockTick<previous.clockTick)
      throw Error('Hosted world identity or clock moved backward');
    if(observation.instanceId===previous.instanceId){
      if(observation.sequence<previous.sequence||
         observation.sequence===previous.sequence&&signature!==previous.signature)
        throw Error('Hosted observation sequence is stale or inconsistent');
    }
  }
  const changed=!previous||signature!==previous.signature;
  const structureChanged=!previous||sceneStructure!==previous.sceneStructure;
  return {world:staged,changed,structureChanged,state:{worldId:observation.worldId,
    instanceId:observation.instanceId,sequence:observation.sequence,
    clockTick:observation.clockTick,sceneIds,coreIds,residentIds:citizenIds,
    bindingIds,sceneStructure,signature}};
}

export function applyHostedObservation(world,observation,previous=null){
  const candidate=stageHostedObservation(observation,previous);
  if(candidate.changed){
    // Keep any AR view anchor and its tracking state. This is a local read-only
    // projection of a fully validated host checkpoint, never a second clock.
    world.scene=candidate.world.scene;
    world.game=null;
    world.citizens=candidate.world.citizens;
    world.originBinding='virtual';
    world.originAnchorHandle=null;
  }
  return candidate;
}
