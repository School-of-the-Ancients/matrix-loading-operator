// Keep legacy object recovery independent of the optional panorama catalog.
export async function refreshAssetCatalogs(world,request,onObjectsRegistered=()=>{}){
  const data=await request('/api/web/assets');
  const changed=world.registerAssets(data.assets||[]);
  onObjectsRegistered(changed);
  let environmentError=null;
  try{
    const environments=await request('/api/web/environments');
    world.registerEnvironmentAssets(environments.assets||[]);
  }catch(error){environmentError=error;}
  return {data,environmentError};
}
