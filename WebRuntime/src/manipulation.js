export const validManipulation=value=>['grabbable','locked','environment'].includes(value);
export const manipulationPolicy=object=>object?.manipulation??'grabbable';
export const canDirectManipulate=object=>!!object&&manipulationPolicy(object)==='grabbable';

export function manipulationCommand(world,objectId,policy,requestId){
  if(!validManipulation(policy))throw Error('Unknown manipulation policy');
  const object=world.requireObject(objectId);
  return {requestId,op:'set_manipulation',objectId,manipulation:policy,
    expectedManipulation:manipulationPolicy(object),expectedAssetId:object.assetId,
    expectedTransform:structuredClone(object.transform),expectedCreatorRevision:world.creatorMode.revision};
}
