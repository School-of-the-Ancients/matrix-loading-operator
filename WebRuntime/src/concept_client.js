// Browser contract for PC-owned concept jobs. The browser retains no provider
// endpoint, workflow, model, seed, artifact path or credential.
const SESSION_ID=/^[0-9a-f]{32}$/;

export class ConceptClient {
  constructor(request,onChange=()=>{}){
    this.request=request;this.onChange=onChange;
    this.sessionId=null;this.jobs=[];this.concepts=[];
    this.selectedConceptId=null;this.builds=[];this.error='';this.refreshPromise=null;
    this.refreshSessionId=null;this.providers=[];this.defaultProviderId=null;
    this.selectedProviderId=null;this.providerStatusLoaded=false;
    this.mutationVersion=0;
  }
  _session(sessionId){
    if(!SESSION_ID.test(sessionId||''))throw Error('Connect Codex before using image concepts.');
    if(this.sessionId!==sessionId){
      this.sessionId=sessionId;this.jobs=[];this.concepts=[];this.builds=[];
      this.selectedConceptId=null;this.error='';this.providers=[];
      this.defaultProviderId=null;this.selectedProviderId=null;
      this.providerStatusLoaded=false;this._mutated();this.onChange(this);
    }
    return sessionId;
  }
  _fail(error){this.error=String(error?.message||error).slice(0,300);this.onChange(this);}
  _mutated(){
    this.mutationVersion++;
    // A GET started before a confirmed write cannot replace the newer state.
    this.refreshPromise=null;this.refreshSessionId=null;
  }
  _update(data){
    if(!data||!Array.isArray(data.jobs)||!Array.isArray(data.concepts)||
      !(data.selectedConceptId===null||typeof data.selectedConceptId==='string'))
      throw Error('Invalid concept status response');
    this.jobs=data.jobs;this.concepts=data.concepts;this.builds=Array.isArray(data.builds)?data.builds:[];
    if(Array.isArray(data.providers)){
      this.providers=data.providers.filter(provider=>provider&&typeof provider.id==='string'&&
        typeof provider.label==='string'&&typeof provider.available==='boolean');
      this.defaultProviderId=typeof data.defaultProviderId==='string'?data.defaultProviderId:null;
      this.providerStatusLoaded=true;
      const available=this.availableProviders;
      if(!available.some(provider=>provider.id===this.selectedProviderId)){
        this.selectedProviderId=available.some(provider=>provider.id===this.defaultProviderId)?
          this.defaultProviderId:available[0]?.id||null;
      }
    }
    this.selectedConceptId=data.selectedConceptId;this.error='';this.onChange(this);
    return data;
  }
  async refresh(sessionId){
    this._session(sessionId);
    if(this.refreshPromise&&this.refreshSessionId===sessionId)return this.refreshPromise;
    const version=this.mutationVersion;
    const pending=(async()=>{
      try{
        const data=await this.request(`/api/agent/concepts?sessionId=${encodeURIComponent(sessionId)}`);
        return this.sessionId===sessionId&&this.mutationVersion===version?this._update(data):null;
      }catch(error){
        if(this.sessionId===sessionId&&this.mutationVersion===version)this._fail(error);
        throw error;
      }
    })();
    this.refreshPromise=pending;this.refreshSessionId=sessionId;
    try{return await pending;}
    finally{if(this.refreshPromise===pending){
      this.refreshPromise=null;this.refreshSessionId=null;}}
  }
  selectProvider(providerId){
    if(!this.availableProviders.some(provider=>provider.id===providerId))
      throw Error('Image source is unavailable.');
    this.selectedProviderId=providerId;this.onChange(this);
  }
  providerForRequest(){
    if(this.providerStatusLoaded&&!this.selectedProviderId)
      throw Error('No image source is currently available on the PC.');
    return this.selectedProviderId||undefined;
  }
  async generate(sessionId,prompt,providerId){
    this._session(sessionId);
    if(typeof prompt!=='string'||!prompt.trim())throw Error('Describe the image first.');
    try{
      const result=await this.request('/api/agent/concepts',{
        sessionId,prompt:prompt.trim(),...(providerId?{providerId}:{})});
      if(!result?.job?.id||!result.job.conceptId)throw Error('Invalid concept job response');
      if(this.sessionId===sessionId){
        this._mutated();
        this.jobs=[...this.jobs.filter(job=>job.id!==result.job.id),result.job];
        this.error='';this.onChange(this);
      }
      return result.job;
    }catch(error){if(this.sessionId===sessionId)this._fail(error);throw error;}
  }
  async vary(sessionId,sourceConceptId,prompt,providerId){
    this._session(sessionId);
    if(typeof sourceConceptId!=='string'||!sourceConceptId)throw Error('Choose a ready concept first.');
    try{
      const result=await this.request('/api/agent/concepts/variation',{
        sessionId,sourceConceptId,...(prompt?.trim()?{prompt:prompt.trim()}:{}),
        ...(providerId?{providerId}:{})});
      if(!result?.job?.id||!result.job.conceptId)throw Error('Invalid variation job response');
      if(this.sessionId===sessionId){
        this._mutated();
        this.jobs=[...this.jobs.filter(job=>job.id!==result.job.id),result.job];
        this.error='';this.onChange(this);
      }
      return result.job;
    }catch(error){if(this.sessionId===sessionId)this._fail(error);throw error;}
  }
  async select(sessionId,conceptId,designNotes){
    this._session(sessionId);
    if(typeof conceptId!=='string'||!conceptId)throw Error('Choose a ready concept first.');
    try{
      const result=await this.request('/api/agent/concepts/select',{
        sessionId,conceptId,...(designNotes!==undefined?{designNotes}:{})});
      if(result?.selectedConceptId!==conceptId||!result.concept)
        throw Error('Concept selection was not confirmed');
      if(this.sessionId===sessionId){
        this._mutated();
        this.selectedConceptId=conceptId;
        this.concepts=this.concepts.map(concept=>concept.conceptId===conceptId?result.concept:concept);
        if(!this.concepts.some(concept=>concept.conceptId===conceptId))this.concepts.push(result.concept);
        this.error='';this.onChange(this);
      }
      return result.concept;
    }catch(error){if(this.sessionId===sessionId)this._fail(error);throw error;}
  }
  async cancel(sessionId,conceptId){
    this._session(sessionId);
    if(typeof conceptId!=='string'||!conceptId)throw Error('Choose a queued job first.');
    try{
      const result=await this.request('/api/agent/concepts/cancel',{sessionId,conceptId});
      if(result?.job?.conceptId!==conceptId||result.job.status!=='cancelled')
        throw Error('Concept cancellation was not confirmed');
      if(this.sessionId===sessionId){
        this._mutated();
        this.jobs=this.jobs.map(job=>job.conceptId===conceptId?result.job:job);
        this.error='';this.onChange(this);
      }
      return result.job;
    }catch(error){if(this.sessionId===sessionId)this._fail(error);throw error;}
  }
  get selected(){return this.concepts.find(concept=>concept.conceptId===this.selectedConceptId)||null;}
  get availableProviders(){return this.providers.filter(provider=>provider.available);}
  byVersion(version){return this.concepts.find(concept=>concept.version===version)||null;}
  get activeJobs(){return this.jobs.filter(job=>['queued','generating'].includes(job.status));}
}
