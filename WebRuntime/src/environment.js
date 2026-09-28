// A renderer-neutral, content-addressed panorama descriptor. Missing the
// optional scene field means the legacy neutral background.
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')===expected.slice().sort().join(',');
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const assetId=value=>typeof value==='string'&&
  /^panorama:[a-z0-9]+(?:-[a-z0-9]+)*:[0-9a-f]{12}$/.test(value)&&
  value.split(':')[1].length<=40;

export function validEnvironment(value){
  return keys(value,['schemaVersion','kind','assetId','sha256','yawDegrees'])&&
    value.schemaVersion===1&&value.kind==='equirectangular'&&
    assetId(value.assetId)&&sha(value.sha256)&&
    value.assetId.endsWith(`:${value.sha256.slice(0,12)}`)&&
    typeof value.yawDegrees==='number'&&Number.isFinite(value.yawDegrees)&&
    value.yawDegrees>=0&&value.yawDegrees<360;
}

export function validEnvironmentAsset(value){
  return keys(value,['assetId','displayName','sha256','byteLength','width',
    'height','format','url'])&&assetId(value.assetId)&&
    typeof value.displayName==='string'&&[...value.displayName].length>0&&
    [...value.displayName].length<=80&&!/\p{C}/u.test(value.displayName)&&
    sha(value.sha256)&&value.assetId.endsWith(`:${value.sha256.slice(0,12)}`)&&
    Number.isSafeInteger(value.byteLength)&&value.byteLength>=45&&
    value.byteLength<=32*1024*1024&&Number.isSafeInteger(value.width)&&
    value.width>=2&&value.width<=4096&&Number.isSafeInteger(value.height)&&
    value.height>=1&&value.height<=2048&&value.width===2*value.height&&
    value.format==='png'&&
    value.url===`/api/web/environments/${value.sha256}.png`;
}

export function sameEnvironment(left,right){
  if(left===null||right===null)return left===null&&right===null;
  return validEnvironment(left)&&validEnvironment(right)&&
    Object.keys(left).every(key=>left[key]===right[key]);
}

export function matchingEnvironmentAsset(environment,asset){
  return validEnvironment(environment)&&validEnvironmentAsset(asset)&&
    environment.assetId===asset.assetId&&environment.sha256===asset.sha256;
}
