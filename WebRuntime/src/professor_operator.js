const kinds = new Set(['artifact','location','lab']);
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const matrixId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = ['schoolSessionId','requestId','requestVersion','lessonRevision','kind','prompt','objectiveId','learningIntent','interaction'];
export function validProfessorRequest(value) {
  return value && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key))
    && uuid(value.schoolSessionId) && uuid(value.requestId) && kinds.has(value.kind)
    && Number.isSafeInteger(value.requestVersion) && value.requestVersion>0
    && Number.isSafeInteger(value.lessonRevision) && value.lessonRevision>0
    && typeof value.prompt==='string' && value.prompt.trim().length>0 && value.prompt.length<=3600
    && typeof value.objectiveId==='string' && value.objectiveId.length<=40
    && typeof value.learningIntent==='string' && value.learningIntent.length<=1200
    && value.interaction && JSON.stringify(value.interaction).length<=1800;
}

export class ProfessorOperator {
  constructor({frame,origin,request,ensureSession,onReview=()=>{},onChange=()=>{},target=window}) {
    Object.assign(this,{frame,origin,request,ensureSession,onReview,onChange,target});
    this.records=new Map();this.submitting=new Set();this.polling=false;this.ready=false;
    this.reset=()=>{this.channel=crypto.randomUUID();this.ready=false;this.hello();};
    this.listener=event=>void this.receive(event);
    target.addEventListener('message',this.listener);frame.addEventListener('load',this.reset);this.reset();
    this.timer=setInterval(()=>{if(!this.ready)this.hello();else void this.poll();},2400);
    this.timer.unref?.();
  }
  hello(){this.frame.contentWindow?.postMessage({type:'matrix-operator-hello',channel:this.channel},this.origin);}
  send(message){this.frame.contentWindow?.postMessage({...message,channel:this.channel},this.origin);}
  async receive(event) {
    if(event.source!==this.frame.contentWindow||event.origin!==this.origin||event.data?.channel!==this.channel)return;
    const {type,payload}=event.data;
    if(type==='school-operator-ready'){this.ready=true;return;}
    if(type==='school-operator-review'){
      if(payload&&Object.keys(payload).length===1&&kinds.has(payload.kind))this.onReview(payload.kind);
      return;
    }
    if(type==='school-operator-watch'){
      if(!payload||Object.keys(payload).length!==5||!uuid(payload.schoolSessionId)||!uuid(payload.requestId)
        ||!Number.isSafeInteger(payload.requestVersion)||!matrixId(payload.sessionId)||!sha(payload.actionId))return;
      if(this.records.size>=40&&!this.records.has(payload.actionId))return;
      this.records.set(payload.actionId,{...payload,last:''});await this.poll();return;
    }
    if(type!=='school-operator-request'||!validProfessorRequest(payload))return;
    const identity=`${payload.schoolSessionId}:${payload.requestId}:${payload.requestVersion}`;
    if(this.submitting.has(identity))return;
    this.submitting.add(identity);
    try{
      const sessionId=await this.ensureSession();if(!matrixId(sessionId))throw Error('Connect the existing Matrix Operator session first.');
      const result=await this.request('/api/professor/actions',{...payload,sessionId});
      if(result?.schoolSessionId!==payload.schoolSessionId||result.requestId!==payload.requestId
        ||result.requestVersion!==payload.requestVersion||!sha(result.actionId))throw Error('Operator returned a mismatched job identity.');
      this.records.set(result.actionId,{schoolSessionId:payload.schoolSessionId,requestId:payload.requestId,
        requestVersion:payload.requestVersion,sessionId,actionId:result.actionId,last:JSON.stringify(result)});
      this.send({type:'matrix-operator-result',result});this.onChange();
    }catch(error){this.send({type:'matrix-operator-error',message:String(error?.message||error).slice(0,600)});}
    finally{this.submitting.delete(identity);}
  }
  async poll(){
    if(this.polling)return;this.polling=true;
    try{for(const record of this.records.values()){
      try{
        const result=await this.request(`/api/professor/actions?sessionId=${record.sessionId}&actionId=${record.actionId}`);
        if(result?.actionId!==record.actionId||result.schoolSessionId!==record.schoolSessionId
          ||result.requestId!==record.requestId||result.requestVersion!==record.requestVersion)continue;
        const signature=JSON.stringify(result);
        if(signature!==record.last){record.last=signature;this.send({type:'matrix-operator-result',result});}
      }catch(error){if(!record.error){record.error=true;this.send({type:'matrix-operator-error',message:'Operator status could not be confirmed. Refresh it before another request.'});}}
    }}finally{this.polling=false;}
  }
  dispose(){clearInterval(this.timer);this.target.removeEventListener('message',this.listener);this.frame.removeEventListener('load',this.reset);}
}
