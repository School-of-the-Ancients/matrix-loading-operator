import {storedWorld} from './scene_store.js';

export const ROOM_ANCHOR_KEY='matrix-web-room-anchor-v1';
export const ROOM_ARCHIVES_KEY='matrix-web-room-archives-v1';
const MAX_ARCHIVES=3;

export function hasWorldToProtect(world){
  return world.scene.objects.length>0||world.game!==null;
}

export function roomArchives(storage){
  const raw=storage.getItem(ROOM_ARCHIVES_KEY);
  if(!raw)return [];
  let archives;
  try{archives=JSON.parse(raw);}
  catch{throw Error('Room recovery archive is invalid; export it before resetting the room');}
  if(!Array.isArray(archives)||archives.length>MAX_ARCHIVES||
     !archives.every(item=>item?.version===1&&typeof item.archiveId==='string'&&
       item.world?.version===2&&item.world.scene&&Object.hasOwn(item.world,'game')))
    throw Error('Room recovery archive is invalid; export it before resetting the room');
  return archives;
}

export function clearRoomArchives(storage){
  storage.removeItem(ROOM_ARCHIVES_KEY);
  if(storage.getItem(ROOM_ARCHIVES_KEY)!==null)
    throw Error('Room recovery archives could not be cleared from browser storage');
}

function archiveAndStartRoom(world,storage,keepWorld){
  if(!world.spatial?.originUnavailable)throw Error('Room reset is available only while its origin is unavailable');
  if(world.scene.objects.some(object=>object.anchorId!=='web-floor'))
    throw Error('Session-only physical objects cannot be archived; exit AR and retry recovery before resetting the room');
  const archives=roomArchives(storage);
  if(archives.length>=MAX_ARCHIVES)throw Error('Three room recovery archives already exist; export them before resetting again');
  const archive={version:1,archiveId:crypto.randomUUID(),archivedAtUtc:new Date().toISOString(),
    anchorHandle:(world.originBinding==='ar'&&world.originAnchorHandle)||
      storage.getItem(ROOM_ANCHOR_KEY)||null,world:storedWorld(world)};
  const serialized=JSON.stringify([...archives,archive]);
  storage.setItem(ROOM_ARCHIVES_KEY,serialized);
  if(storage.getItem(ROOM_ARCHIVES_KEY)!==serialized)throw Error('Room archive could not be verified');
  storage.removeItem(ROOM_ANCHOR_KEY);
  if(!keepWorld){
    world.scene.objects=[];
    if(world.virtualScene)world.virtualScene.scene.objects=[];
    world.game=null;
  }
  world.originBinding=keepWorld?'ar':'virtual';
  world.originAnchorHandle=null;
  world.resetAROriginBaseline();
  world.selection={anchorId:'web-floor',objectId:'',position:{x:0,y:0,z:-2}};
  if(world.virtualScene)world.virtualScene.selection=structuredClone(world.selection);
  world.undo=[];world.redo=[];
  if(world.virtualScene){world.virtualScene.undo=[];world.virtualScene.redo=[];}
  world.spatial.alignmentVerified=false;
  world.spatial.stale=false;
  // The new room remains read-only until its new anchor has a tracked pose.
  world.spatial.originUnavailable=true;
  return archive;
}

export const archiveAndClearRoom=(world,storage)=>archiveAndStartRoom(world,storage,false);
export const archiveAndRebaseRoom=(world,storage)=>archiveAndStartRoom(world,storage,true);
