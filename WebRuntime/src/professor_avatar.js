// A professor is a presentation binding on a normal Matrix object, not a second simulation.
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const keys=['schemaVersion','teacherId','teacherName','schoolSessionId','catalogId','assetSha256','representation'];
export function validProfessorBinding(value,assetId){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).sort().join(',')===keys.slice().sort().join(',')&&value.schemaVersion===1&&
    id(value.teacherId)&&id(value.catalogId)&&uuid(value.schoolSessionId)&&
    typeof value.teacherName==='string'&&value.teacherName.length>0&&value.teacherName.length<=100&&
    !/[\x00-\x1f]/.test(value.teacherName)&&['generic','approximate'].includes(value.representation)&&
    (assetId==='professor-placeholder'?value.catalogId==='generic-professor'&&value.assetSha256==='':
      typeof value.assetSha256==='string'&&/^[a-f0-9]{64}$/.test(value.assetSha256)&&
      assetId?.startsWith('web:')&&assetId.endsWith(':'+value.assetSha256.slice(0,12)));
}
export function validProfessorPlacement(value){
  return !!value&&Object.keys(value).sort().join(',')==='catalogId,schoolSessionId,teacherId,teacherName'&&
    id(value.catalogId)&&id(value.teacherId)&&uuid(value.schoolSessionId)&&
    typeof value.teacherName==='string'&&value.teacherName.length>0&&value.teacherName.length<=100&&
    !/[\x00-\x1f]/.test(value.teacherName);
}
export function placeProfessor(world,avatar,request,position){
  if(!validProfessorPlacement(request)||avatar.catalogId!==request.catalogId||avatar.availability!=='ready')
    throw Error('Choose an available professor appearance.');
  const binding={schemaVersion:1,teacherId:request.teacherId,teacherName:request.teacherName,
    schoolSessionId:request.schoolSessionId,catalogId:avatar.catalogId,
    assetSha256:avatar.assetSha256,representation:avatar.representation};
  if(!validProfessorBinding(binding,avatar.assetId))throw Error('Professor appearance identity is invalid.');
  const existing=world.scene.objects.find(object=>object.professor?.schoolSessionId===request.schoolSessionId);
  const receipt=world.execute(existing?{requestId:crypto.randomUUID(),op:'bind_professor',objectId:existing.objectId,
    professor:binding,assetId:avatar.assetId,expectedTransform:structuredClone(existing.transform)}:
    {requestId:crypto.randomUUID(),op:'spawn',assetId:avatar.assetId,anchorId:'web-floor',professor:binding,
      transform:{position,rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}});
  if(!receipt.ok)throw Error(receipt.error);
  return receipt;
}
