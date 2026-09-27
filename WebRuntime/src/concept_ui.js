import {ConceptClient} from './concept_client.js';
import {parseConceptIntent} from './concept_intent.js';

const $=id=>document.getElementById(id);
const label=concept=>`Version ${concept.version}`;
const short=value=>String(value||'').slice(0,240);
const latest=concepts=>[...concepts].sort((a,b)=>b.version-a.version)[0]||null;

function revisedPrompt(source,notes){
  const instruction=String(notes||'').trim().replace(/^(?:but|with|and)\s+/i,'');
  if(!instruction||/^(?:make (?:it|this) different|different|surprise me)\.?$/i.test(instruction))
    return undefined;
  return `${String(source.prompt||'').trim().replace(/[.!?]+$/,'')}. ${instruction}`;
}

export class ConceptUI {
  constructor({request,ensureSession,getSession,getToken,onChange=()=>{}}){
    this.ensureSession=ensureSession;this.getSession=getSession;this.getToken=getToken;
    this.onChange=onChange;this.busy=false;this.notice='';this.noticeError=false;
    this.lastSelectedId=null;this.previews=new Map();this.loadingPreviews=new Set();
    this.previewErrors=new Map();
    this.client=new ConceptClient(request,()=>{this.render();this.onChange();});
    this.els={prompt:$('concept-prompt'),generate:$('concept-generate'),
      vary:$('concept-vary'),summary:$('concept-summary'),status:$('concept-status'),
      provider:$('concept-provider'),providerLabel:$('concept-provider-label'),
      buildStatus:$('concept-build-status'),
      jobs:$('concept-jobs'),list:$('concept-list'),notes:$('concept-notes'),
      saveNotes:$('concept-save-notes')};
    this.providerOptionsKey='';
  }
  bind(){
    this.els.generate.addEventListener('click',()=>void this._run(()=>this.generate(this.els.prompt.value)).catch(()=>{}));
    this.els.vary.addEventListener('click',()=>void this._run(()=>this.vary()).catch(()=>{}));
    this.els.saveNotes.addEventListener('click',()=>void this._run(()=>this.saveNotes()).catch(()=>{}));
    this.els.provider.addEventListener('change',()=>{
      try{this.client.selectProvider(this.els.provider.value);}
      catch(error){this.notice=String(error?.message||error);this.noticeError=true;this.render();}
    });
    this.render();
  }
  async _run(action){
    if(this.busy)throw Error('Wait for the current concept request.');
    this.busy=true;this.notice='';this.noticeError=false;this.render();
    try{return await action();}
    catch(error){this.notice=String(error?.message||error);this.noticeError=true;this.render();throw error;}
    finally{this.busy=false;this.render();}
  }
  async _session(){
    const sessionId=await this.ensureSession();
    if(this.client.sessionId&&this.client.sessionId!==sessionId)this._clearPreviews();
    return sessionId;
  }
  async _providerForRequest(sessionId){
    if(this.client.sessionId!==sessionId||!this.client.providerStatusLoaded)
      await this.client.refresh(sessionId);
    return this.client.providerForRequest();
  }
  _providerLabel(providerId){
    return providerId?(this.client.providers.find(provider=>provider.id===providerId)?.label||providerId):'';
  }
  async refresh(){
    const sessionId=this.getSession();
    if(!sessionId)return null;
    if(this.client.sessionId&&this.client.sessionId!==sessionId)this._clearPreviews();
    const before=this.client.jobs.map(job=>`${job.conceptId}:${job.status}:${job.message||''}`).join('|');
    const result=await this.client.refresh(sessionId);
    const after=this.client.jobs.map(job=>`${job.conceptId}:${job.status}:${job.message||''}`).join('|');
    if(before!==after){this.notice='';this.noticeError=false;this.render();}
    return result;
  }
  async generate(prompt){
    this.notice='Submitting image request on the PC…';this.noticeError=false;
    this.render();this.onChange();
    const sessionId=await this._session();
    const providerId=await this._providerForRequest(sessionId);
    const job=await this.client.generate(sessionId,prompt,providerId);
    this.els.prompt.value=prompt.trim();
    if(job.status==='failed')throw Error(`${label(job)} failed: ${job.message||'Image submission failed.'}`);
    this.notice=`${label(job)} ${job.status}. Earlier versions and the current selection remain available.`;
    this.noticeError=false;
    void this.refresh().catch(()=>{});
    return job;
  }
  async vary(notes=''){
    this.notice='Starting another image version on the PC…';this.noticeError=false;
    this.render();this.onChange();
    const sessionId=await this._session();
    if(!this.client.concepts.length||this.client.sessionId!==sessionId||
        !this.client.providerStatusLoaded)await this.client.refresh(sessionId);
    const source=this.client.selected||latest(this.client.concepts);
    if(!source)throw Error('Wait for a ready concept before making another version.');
    const typed=this.els.prompt.value.trim();
    const prompt=notes?revisedPrompt(source,notes):
      typed&&typed!==source.prompt?typed:undefined;
    const job=await this.client.vary(sessionId,source.conceptId,prompt,
      this.client.providerForRequest());
    if(prompt)this.els.prompt.value=prompt;
    if(job.status==='failed')throw Error(`${label(job)} failed: ${job.message||'Image submission failed.'}`);
    this.notice=`${label(job)} ${job.status}. This is a new text-to-image sample from ${label(source)}; the selected design does not change.`;
    this.noticeError=false;
    void this.refresh().catch(()=>{});
    return job;
  }
  async select(conceptId,notes){
    const sessionId=await this._session();
    const concept=await this.client.select(sessionId,conceptId,notes);
    this.notice=`${label(concept)} selected${notes?' with design notes':''}. The image was not edited. Ask Codex to build from this design when ready.`;
    this.noticeError=false;
    return concept;
  }
  async selectVersion(version,notes){
    const sessionId=await this._session();
    await this.client.refresh(sessionId);
    const concept=this.client.byVersion(version);
    if(!concept){
      const pending=this.client.jobs.find(job=>job.version===version);
      throw Error(pending?`${label(pending)} is ${pending.status}; wait until it is ready.`:
        `Version ${version} is unavailable.`);
    }
    return this.select(concept.conceptId,notes||concept.designNotes||'');
  }
  async saveNotes(){
    const selected=this.client.selected;
    if(!selected)throw Error('Select a ready concept before saving design notes.');
    return this.select(selected.conceptId,this.els.notes.value.trim());
  }
  async cancel(conceptId){
    const sessionId=await this._session();
    const job=await this.client.cancel(sessionId,conceptId);
    this.notice=`${label(job)} cancelled.`;this.noticeError=false;
    return job;
  }
  async handleText(text){
    const intent=parseConceptIntent(text);
    if(!intent)return null;
    return this._run(async()=>{
      if(intent.kind==='generate')await this.generate(intent.prompt);
      else if(intent.kind==='vary')await this.vary(intent.notes);
      else await this.selectVersion(intent.version,intent.notes);
      return this.notice;
    });
  }
  get selected(){return this.client.selected;}
  buildStatus(){
    const build=this.client.builds.at(-1);
    if(!build)return '';
    const concept=this.client.concepts.find(item=>item.conceptId===build.conceptId);
    const source=concept?label(concept):'selected concept';
    const strategy=build.strategy?` Strategy: ${short(build.strategy)}.`:'';
    if(build.status==='completed')
      return `Verified Matrix result from ${source}.${strategy} ${build.objectIds?.length||0} object ID(s), ${build.receipts?.length||0} receipt(s).`;
    if(build.status==='failed')return `Build from ${source} failed.${strategy}`;
    return `Codex build requested from ${source}. Awaiting a verified Matrix result.${strategy}`;
  }
  statusForWorld(){
    const selected=this.selected,active=this.client.activeJobs.at(-1);
    const newest=latest(this.client.concepts);
    return [this.busy&&this.notice?this.notice:'',
      active?`Image ${label(active)}${active.providerId?` (${this._providerLabel(active.providerId)})`:''}: ${active.status}.`:'',
      newest?`Image ${label(newest)} ready.`:'',
      selected?`Selected design: ${label(selected)}. ${short(selected.designNotes||selected.prompt)}`:
        this.client.concepts.length?'No image selected. Choose a version before asking Codex to build from it.':'',
      this.buildStatus(),
      this.client.error?`Image concepts: ${this.client.error}`:''].filter(Boolean).join('\n');
  }
  render(){
    const {selected,activeJobs,concepts,jobs,error}=this.client;
    this._renderProviders();
    this.els.summary.textContent=selected?`${label(selected)} selected`:'No concept selected';
    if(selected?.conceptId!==this.lastSelectedId){
      this.lastSelectedId=selected?.conceptId||null;
      this.els.notes.value=selected?.designNotes||'';
      if(selected?.prompt)this.els.prompt.value=selected.prompt;
    }
    const unavailable=this.client.providerStatusLoaded&&!this.client.availableProviders.length;
    this.els.generate.disabled=this.busy||unavailable;
    this.els.vary.disabled=this.busy||!concepts.length||unavailable;
    this.els.saveNotes.disabled=this.busy||!selected;
    const status=error||this.notice||(activeJobs.length?
      `${activeJobs.map(job=>`${label(job)} ${job.status}`).join(' · ')}. Selected version will not change when a job finishes.`:
      selected?`${label(selected)} is selected. Image generation stops here until you explicitly ask Codex to build.`:
        this.getSession()?'No image selected. Generate an image or choose a ready version.':
          'Connect to Codex to view saved concepts.');
    this.els.status.textContent=status;
    this.els.status.classList.toggle('error',this.noticeError||!!error);
    this.els.buildStatus.textContent=this.buildStatus();
    this._renderJobs(jobs);
    this._renderConcepts(concepts,selected?.conceptId);
  }
  _renderProviders(){
    const available=this.client.availableProviders;
    const key=available.map(provider=>`${provider.id}:${provider.label}`).join('|');
    if(key!==this.providerOptionsKey){
      this.providerOptionsKey=key;this.els.provider.replaceChildren();
      for(const provider of available){
        const option=document.createElement('option');
        option.value=provider.id;option.textContent=provider.label;
        this.els.provider.append(option);
      }
    }
    this.els.provider.hidden=available.length<=1;
    this.els.provider.disabled=this.busy;
    this.els.providerLabel.hidden=available.length>1;
    if(available.length>1)this.els.provider.value=this.client.selectedProviderId||'';
    else if(available.length===1)this.els.providerLabel.textContent=available[0].label;
    else if(this.client.providerStatusLoaded){
      const reasons=this.client.providers.map(provider=>provider.reason).filter(Boolean);
      this.els.providerLabel.textContent=reasons.length?short(reasons.join(' · ')):
        'No image source is currently available on the PC.';
    }else this.els.providerLabel.textContent='Connect to Codex to check image sources.';
  }
  _renderJobs(jobs){
    this.els.jobs.replaceChildren();
    for(const job of [...jobs].filter(job=>job.status!=='ready').sort((a,b)=>b.version-a.version).slice(0,6)){
      const row=document.createElement('div');row.className='concept-job';
      const status=document.createElement('span');
      status.textContent=`${label(job)}${job.providerId?` · ${this._providerLabel(job.providerId)}`:''} · ${job.status}${job.message?` · ${short(job.message)}`:''}`;
      row.append(status);
      if(job.status==='queued'){
        const button=document.createElement('button');button.type='button';button.textContent='Cancel';
        button.disabled=this.busy;
        button.addEventListener('click',()=>void this._run(()=>this.cancel(job.conceptId)).catch(()=>{}));
        row.append(button);
      }
      this.els.jobs.append(row);
    }
  }
  _renderConcepts(concepts,selectedId){
    this.els.list.replaceChildren();
    for(const concept of [...concepts].sort((a,b)=>a.version-b.version)){
      const card=document.createElement('article');
      card.className=`concept-card${concept.conceptId===selectedId?' selected':''}`;
      const title=document.createElement('strong');
      title.textContent=`${label(concept)}${concept.conceptId===selectedId?' · SELECTED':''}`;
      card.append(title);
      if(concept.providerId){
        const source=document.createElement('p');source.className='concept-source';
        source.textContent=`Image source: ${this._providerLabel(concept.providerId)}`;
        card.append(source);
      }
      const preview=this.previews.get(concept.conceptId);
      if(preview?.serverUrl===concept.previewUrl){
        const image=document.createElement('img');image.src=preview.objectUrl;
        image.alt=`Generated image for ${label(concept)}`;
        card.append(image);
      }else{
        const message=document.createElement('p');message.className='concept-preview-message';
        message.textContent=this.previewErrors.get(concept.conceptId)||'Loading preview…';
        card.append(message);
        if(this.previewErrors.has(concept.conceptId)){
          const retry=document.createElement('button');retry.type='button';retry.textContent='Retry preview';
          retry.addEventListener('click',()=>{this.previewErrors.delete(concept.conceptId);void this._loadPreview(concept);});
          card.append(retry);
        }else void this._loadPreview(concept);
      }
      const prompt=document.createElement('p');prompt.textContent=short(concept.prompt);
      card.append(prompt);
      if(concept.designNotes){
        const notes=document.createElement('p');notes.textContent=`Notes: ${short(concept.designNotes)}`;
        card.append(notes);
      }
      const button=document.createElement('button');button.type='button';
      button.textContent=concept.conceptId===selectedId?'Selected':'Use this version';
      button.disabled=this.busy||concept.conceptId===selectedId;
      button.addEventListener('click',()=>void this._run(()=>this.select(concept.conceptId,concept.designNotes||'')).catch(()=>{}));
      card.append(button);this.els.list.append(card);
    }
  }
  async _loadPreview(concept){
    const id=concept.conceptId,url=concept.previewUrl;
    if(this.loadingPreviews.has(id)||!url)return;
    const sessionId=this.client.sessionId;
    this.loadingPreviews.add(id);
    try{
      const parsed=new URL(url,window.location.href);
      if(parsed.origin!==window.location.origin||
        !/^\/api\/agent\/concepts\/[A-Za-z0-9_-]+\/preview$/.test(parsed.pathname)||parsed.search)
        throw Error('Preview URL is invalid');
      const headers={};const token=this.getToken();
      if(token)headers.Authorization=`Bearer ${token}`;
      const response=await fetch(parsed.href,{headers,cache:'no-store'});
      if(!response.ok)throw Error(`Preview HTTP ${response.status}`);
      const blob=await response.blob();
      if(!['image/png','image/jpeg','image/webp'].includes(blob.type)||
          blob.size===0||blob.size>24*1024*1024)
        throw Error('Preview image format is unsupported');
      if(this.client.sessionId!==sessionId)return;
      const objectUrl=URL.createObjectURL(blob);
      const previous=this.previews.get(id);
      if(previous)URL.revokeObjectURL(previous.objectUrl);
      this.previews.set(id,{serverUrl:url,objectUrl});
      this.previewErrors.delete(id);this.render();
    }catch(error){if(this.client.sessionId===sessionId){
      this.previewErrors.set(id,String(error?.message||error));this.render();}}
    finally{this.loadingPreviews.delete(id);}
  }
  _clearPreviews(){
    for(const preview of this.previews.values())URL.revokeObjectURL(preview.objectUrl);
    this.previews.clear();this.previewErrors.clear();
  }
  destroy(){this._clearPreviews();}
}
