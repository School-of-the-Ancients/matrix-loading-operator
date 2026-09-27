// Browser contract for PC-owned concept jobs. The browser retains no ComfyUI
// endpoint, workflow, model, seed, artifact path or provider credential.
const SESSION_ID=/^[0-9a-f]{32}$/;

export class ConceptClient {
  constructor(request,onChange=()=>{}){
    this.request=request;this.onChange=onChange;
    this.sessionId=null;this.jobs=[];this.concepts=[];
    this.selectedConceptId=null;this.builds=[];this.error='';this.refreshPromise=null;
    this.refreshSessionId=null;
  }
  _session(sessionId){
    if(!SESSION_ID.test(sessionId||''))throw Error('Connect Codex before using image concepts.');
    if(this.sessionId!==sessionId){
      this.sessionId=sessionId;this.jobs=[];this.concepts=[];this.builds=[];
      this.selectedConceptId=null;this.error='';this.onChange(this);
    }
    return sessionId;
  }
  _fail(error){this.error=String(error?.message||error).slice(0,300);this.onChange(this);}
  _update(data){
    if(!data||!Array.isArray(data.jobs)||!Array.isArray(data.concepts)||
      !(data.selectedConceptId===null||typeof data.selectedConceptId==='string'))
      throw Error('Invalid concept status response');
    this.jobs=data.jobs;this.concepts=data.concepts;this.builds=Array.isArray(data.builds)?data.builds:[];
    this.selectedConceptId=data.selectedConceptId;this.error='';this.onChange(this);
    return data;
  }
  async refresh(sessionId){
    this._session(sessionId);
    if(this.refreshPromise&&this.refreshSessionId===sessionId)return this.refreshPromise;
    const pending=(async()=>{
      try{
        const data=await this.request(`/api/agent/concepts?sessionId=${encodeURIComponent(sessionId)}`);
        return this.sessionId===sessionId?this._update(data):null;
      }catch(error){if(this.sessionId===sessionId)this._fail(error);throw error;}
    })();
    this.refreshPromise=pending;this.refreshSessionId=sessionId;
    try{return await pending;}
    finally{if(this.refreshPromise===pending){
      this.refreshPromise=null;this.refreshSessionId=null;}}
  }
  async generate(sessionId,prompt){
    this._session(sessionId);
    if(typeof prompt!=='string'||!prompt.trim())throw Error('Describe the image first.');
    try{
      const result=await this.request('/api/agent/concepts',{sessionId,prompt:prompt.trim()});
      if(!result?.job?.id||!result.job.conceptId)throw Error('Invalid concept job response');
      this.jobs=[...this.jobs.filter(job=>job.id!==result.job.id),result.job];
      this.error='';this.onChange(this);
      return result.job;
    }catch(error){this._fail(error);throw error;}
  }
  async vary(sessionId,sourceConceptId,prompt){
    this._session(sessionId);
    if(typeof sourceConceptId!=='string'||!sourceConceptId)throw Error('Choose a ready concept first.');
    try{
      const result=await this.request('/api/agent/concepts/variation',{
        sessionId,sourceConceptId,...(prompt?.trim()?{prompt:prompt.trim()}:{})});
      if(!result?.job?.id||!result.job.conceptId)throw Error('Invalid variation job response');
      this.jobs=[...this.jobs.filter(job=>job.id!==result.job.id),result.job];
      this.error='';this.onChange(this);
      return result.job;
    }catch(error){this._fail(error);throw error;}
  }
  async select(sessionId,conceptId,designNotes){
    this._session(sessionId);
    if(typeof conceptId!=='string'||!conceptId)throw Error('Choose a ready concept first.');
    try{
      const result=await this.request('/api/agent/concepts/select',{
        sessionId,conceptId,...(designNotes!==undefined?{designNotes}:{})});
      if(result?.selectedConceptId!==conceptId||!result.concept)
        throw Error('Concept selection was not confirmed');
      this.selectedConceptId=conceptId;
      this.concepts=this.concepts.map(concept=>concept.conceptId===conceptId?result.concept:concept);
      if(!this.concepts.some(concept=>concept.conceptId===conceptId))this.concepts.push(result.concept);
      this.error='';this.onChange(this);
      return result.concept;
    }catch(error){this._fail(error);throw error;}
  }
  async cancel(sessionId,conceptId){
    this._session(sessionId);
    if(typeof conceptId!=='string'||!conceptId)throw Error('Choose a queued job first.');
    try{
      const result=await this.request('/api/agent/concepts/cancel',{sessionId,conceptId});
      if(result?.job?.conceptId!==conceptId||result.job.status!=='cancelled')
        throw Error('Concept cancellation was not confirmed');
      this.jobs=this.jobs.map(job=>job.conceptId===conceptId?result.job:job);
      this.error='';this.onChange(this);
      return result.job;
    }catch(error){this._fail(error);throw error;}
  }
  get selected(){return this.concepts.find(concept=>concept.conceptId===this.selectedConceptId)||null;}
  byVersion(version){return this.concepts.find(concept=>concept.version===version)||null;}
  get activeJobs(){return this.jobs.filter(job=>['queued','generating'].includes(job.status));}
}
