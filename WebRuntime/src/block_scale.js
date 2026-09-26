// Browser presentation of the existing client-neutral block-scale capability.
// Validation, arithmetic, proposals, and observations stay in ControlService.
export const SCALE_CAPABILITY='experiment.block-scale.v1';
export const SCALE_EVIDENCE_KEY='matrix-web-block-scale-evidence-v1';
const AXES=['x','y','z'];
const ACTIVE=new Set(['planning','ready','queued','running']);
export const uniformScaleFactors=value=>({x:value,y:value,z:value});
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const positiveVector=value=>value&&typeof value==='object'&&
  AXES.every(axis=>positive(value[axis]));

function validObservedEvent(event){
  if(event?.schemaVersion!==1||event.type!=='experiment.block-scale.observed'||
     event.assetId!=='block'||event.anchorId!=='web-floor'||
     !['configure','reset'].includes(event.action)||
     event.source!=='acknowledged-runtime-transform'||event.physicalMeasurement!==false||
     !Number.isSafeInteger(event.revision)||event.revision<0||
     !positive(event.mathematicalVolumeRatio)||!positiveVector(event.relativeFactors))return false;
  if(event.dimensionSource==='catalog-local-bounds')
    return positiveVector(event.localDimensionsMeters)&&positive(event.boundingVolumeCubicMeters);
  return event.dimensionSource==='unavailable'&&event.localDimensionsMeters===null&&
    event.boundingVolumeCubicMeters===null;
}

export function scaleIntent(action,objectId,factors=null,baselineRequestId=null){
  if(typeof objectId!=='string'||!objectId||objectId.length>96)throw Error('Select an existing block.');
  if(action!=='configure'&&action!=='reset')throw Error('Unsupported scale action.');
  const intent={kind:'block-scale',version:1,action,objectId};
  if(action==='configure'){
    if(!factors||Object.keys(factors).length!==3||
       !AXES.every(axis=>typeof factors[axis]==='number'&&Number.isFinite(factors[axis])&&
         factors[axis]>=.25&&factors[axis]<=4))
      throw Error('Enter X, Y, and Z factors from 0.25 through 4.');
    intent.factors=Object.fromEntries(AXES.map(axis=>[axis,factors[axis]]));
  }else if(!baselineRequestId)throw Error('Reset needs a confirmed result in this pairing.');
  if(baselineRequestId)intent.baselineRequestId=baselineRequestId;
  return intent;
}

export function confirmedScaleEvent(outcome){
  const event=outcome?.experimentEvent;
  if(outcome?.status!=='succeeded'||outcome.experiment?.observationState!=='confirmed'||
     outcome.experiment?.observation?.physicalMeasurement!==false||
     !validObservedEvent(event)||event.requestId!==outcome.requestId)return null;
  return event;
}

export function scaleEvidence(outcome){
  const event=confirmedScaleEvent(outcome);
  if(!event)return null;
  const snapshot=outcome.observed?.snapshot;
  const object=snapshot?.scene?.objects?.find(item=>item.objectId===event.objectId);
  if(snapshot?.scene?.roomId!==event.roomId||object?.assetId!==event.assetId||
     object?.anchorId!==event.anchorId||!sameTransform(object?.transform,object?.transform))
    return null;
  return {version:1,event,roomId:event.roomId,objectId:event.objectId,
    transform:structuredClone(object.transform)};
}

function sameTransform(left,right){
  return ['position','rotation','scale'].every(part=>
    AXES.every(axis=>typeof left?.[part]?.[axis]==='number'&&Number.isFinite(left[part][axis])&&
      typeof right?.[part]?.[axis]==='number'&&Number.isFinite(right[part][axis])&&
      left[part][axis]===right[part][axis]));
}

export function matchingScaleEvidence(world,evidence){
  if(evidence?.version!==1||evidence.roomId!==world.scene.roomId||
     evidence.roomId!==evidence.event?.roomId||evidence.objectId!==evidence.event?.objectId||
     !validObservedEvent(evidence.event))return false;
  const object=world.scene.objects.find(item=>item.objectId===evidence.objectId);
  return !!object&&object.assetId==='block'&&object.anchorId==='web-floor'&&
    sameTransform(object.transform,evidence.transform);
}

async function http(path,body,token=''){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',
      signal:controller.signal,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,
        ...(body===undefined?{}:{'Content-Type':'application/json'})},
      body:body===undefined?undefined:JSON.stringify(body)});
    const value=await response.json();
    if(!response.ok){const error=Error(value.error||`HTTP ${response.status}`);error.code=value.code;throw error;}
    return value;
  }finally{clearTimeout(timeout);}
}

export class BlockScaleClient{
  constructor(request=http,idFactory=()=>crypto.randomUUID().replaceAll('-','')){
    this.request=request;this.idFactory=idFactory;this.session=null;this.currentId=null;
    this.confirmed=null;
  }
  get paired(){return !!this.session;}
  async discovery(){
    const value=await this.request('/api/v1/discovery');
    const capability=value.capabilities?.[SCALE_CAPABILITY];
    if(value.protocolVersion!=='1'||!capability||capability.version!==1)
      throw Error('This Matrix service does not offer block-scale version 1.');
    return value;
  }
  async pair(code){
    if(this.currentId)throw Error(
      `Scale request ${this.currentId} is unresolved. Keep this pairing and check its status here. `+
      'If polling cannot reconcile it, inspect /clients before reloading or pairing again.');
    if(typeof code!=='string'||!code.trim())throw Error('Enter the one-use code from /clients.');
    const value=await this.request('/api/v1/sessions',{pairingCode:code.trim()});
    if(value.protocolVersion!=='1'||!value.clientToken||!value.sessionId||!value.runtimeSessionId)
      throw Error('Matrix returned an incomplete pairing.');
    this.session=value;this.currentId=null;this.confirmed=null;
    return value;
  }
  async scene(){
    if(!this.session)throw Error('Pair with Matrix first.');
    const value=await this.request('/api/v1/scene',undefined,this.session.clientToken);
    if(value.protocolVersion!=='1'||value.sessionId!==this.session.sessionId||
       value.runtimeSessionId!==this.session.runtimeSessionId||!Number.isSafeInteger(value.revision))
      throw Error('The paired Matrix runtime changed; pair again after reconciling prior requests.');
    return value;
  }
  async propose(intent){
    if(this.currentId)throw Error('Reconcile the current scale request before proposing another.');
    const scene=await this.scene();
    if(scene.snapshot?.roomContext?.mode!=='white-room')throw Error('This scale experiment runs in the virtual room only.');
    const item=scene.snapshot.scene?.objects?.find(object=>object.objectId===intent.objectId);
    if(item?.assetId!=='block'||item.anchorId!=='web-floor')throw Error('Select a current built-in virtual-floor block.');
    const requestId=this.idFactory();
    this.currentId=requestId; // A lost POST reply must be reconciled by ID, never replayed.
    return this.request('/api/v1/requests',{requestId,
      expected:{runtimeSessionId:scene.runtimeSessionId,revision:scene.revision},intent},
    this.session.clientToken);
  }
  async outcome(){
    if(!this.currentId)throw Error('No scale request is awaiting an outcome.');
    const value=await this.request(`/api/v1/requests/${encodeURIComponent(this.currentId)}`,undefined,
      this.session.clientToken);
    if(value.protocolVersion!=='1'||value.sessionId!==this.session.sessionId||
       value.requestId!==this.currentId||value.runtimeSessionId!==this.session.runtimeSessionId)
      throw Error('Matrix returned an outcome for another request.');
    const event=confirmedScaleEvent(value);
    if(event)this.confirmed={requestId:value.requestId,objectId:event.objectId,event};
    if(!ACTIVE.has(value.status))this.currentId=null;
    return value;
  }
  async cancel(){
    if(!this.currentId)throw Error('No pending request to cancel.');
    return this.request(`/api/v1/requests/${encodeURIComponent(this.currentId)}/cancel`,{},
      this.session.clientToken);
  }
  baselineFor(objectId){return this.confirmed?.objectId===objectId?this.confirmed.requestId:null;}
}
