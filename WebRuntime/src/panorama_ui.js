import {parsePanoramaIntent} from './concept_intent.js';

const $=id=>document.getElementById(id);
const version=item=>`Version ${item.version}`;
const latest=items=>[...items].sort((a,b)=>b.version-a.version)[0]||null;
const short=value=>String(value||'').slice(0,240);

export class PanoramaUI {
  constructor({client,ensureSession,getSession,getToken,canApply,apply,remove,
    removeAvailable=()=>false,onChange=()=>{}}){
    this.client=client;this.ensureSession=ensureSession;this.getSession=getSession;
    this.getToken=getToken;this.canApply=canApply;this.apply=apply;this.remove=remove;
    this.removeAvailable=removeAvailable;
    this.onChange=onChange;this.busy=false;this.batch=null;
    this.pendingGeneration=null;
    this.providerTouched=false;
    this.notice='';this.noticeError=false;
    this.lastSelectedId=null;this.previews=new Map();this.loadingPreviews=new Set();
    this.previewErrors=new Map();
    this.els={prompt:$('panorama-prompt'),provider:$('panorama-provider'),
      generate:$('panorama-generate'),
      vary:$('panorama-vary'),summary:$('panorama-summary'),status:$('panorama-status'),
      jobs:$('panorama-jobs'),versions:$('panorama-versions'),name:$('panorama-name'),
      yaw:$('panorama-yaw'),apply:$('panorama-apply'),remove:$('panorama-remove'),
      applyStatus:$('panorama-apply-status')};
  }
  bind(){
    this.els.generate.addEventListener('click',()=>void this._run(()=>
      this.generate(this.els.prompt.value)).catch(()=>{}));
    this.els.vary.addEventListener('click',()=>void this._run(()=>
      this.vary(this.els.prompt.value)).catch(()=>{}));
    this.els.apply.addEventListener('click',()=>{
      const chosen=this.client.selectedPanorama;
      void this._run(()=>this.applySelected(chosen?{
        conceptId:chosen.conceptId,version:chosen.version}:null)).catch(()=>{});
    });
    this.els.remove.addEventListener('click',()=>void this._run(()=>
      this.removeCurrent()).catch(()=>{}));
    this.els.provider.addEventListener('change',()=>{this.providerTouched=true;this.render();});
    this.render();
  }
  async _run(action){
    if(this.busy)throw Error('Wait for the current panorama request.');
    this.busy=true;this.notice='';this.noticeError=false;this.render();this.onChange();
    try{return await action();}
    catch(error){this.notice=String(error?.message||error);this.noticeError=true;
      this.render();this.onChange();throw error;}
    finally{this.busy=false;this.render();this.onChange();}
  }
  async _session(){
    const sessionId=await this.ensureSession();
    if(this.client.sessionId&&this.client.sessionId!==sessionId)this._clearPreviews();
    return sessionId;
  }
  async generate(prompt){
    if(this.batch||this.pendingGeneration)
      throw Error('Wait for the current panorama image to finish.');
    const sessionId=await this._session();
    const job=await this.client.generatePanorama(sessionId,prompt,
      {providerId:this.els.provider.value});
    if(this.getSession()!==sessionId)return null;
    this.els.prompt.value=prompt.trim();
    if(job.status==='failed')throw Error(`${version(job)} failed: ${job.message||'Panorama generation failed.'}`);
    this.pendingGeneration=job.status==='ready'?null:{sessionId,
      conceptId:job.conceptId,version:job.version};
    this.notice=job.status==='ready'?`${version(job)} ready. Preview, choose, then apply it.`:
      `${version(job)} ${job.status}. Earlier panorama versions remain available.`;
    this.noticeError=false;this.render();this.onChange();
    return job;
  }
  async generateMany(prompt,count,requestedVersion=null){
    if(!Number.isInteger(count)||count<2||count>3)
      throw Error('Request two or three panorama versions at a time.');
    if(this.batch||this.pendingGeneration)
      throw Error('Wait for the current panorama image to finish.');
    const sessionId=await this._session();
    const providerId=this.els.provider.value;
    const job=await this.client.generatePanorama(sessionId,prompt,{providerId});
    if(this.getSession()!==sessionId)return null;
    if(job.status==='failed')throw Error(`${version(job)} failed: ${job.message||'Panorama generation failed.'}`);
    this.batch={sessionId,prompt:prompt.trim(),providerId,count,submitted:1,
      lastConceptId:job.conceptId,versions:[job.version],requestedVersion,submitting:false};
    this.els.prompt.value=prompt.trim();
    this.notice=`Generating panorama 1 of ${count}. Each version starts after the previous image is ready. Preview and choose a version before applying.${requestedVersion?` Version ${requestedVersion} was requested but will not apply automatically.`:''}`;
    this.noticeError=false;this.render();this.onChange();
    return [job.version];
  }
  async advanceQueue(){
    if(this.busy)return;
    const pending=this.pendingGeneration;
    if(pending){
      if(this.getSession()!==pending.sessionId||
        this.client.sessionId!==pending.sessionId){
        this.pendingGeneration=null;
        this.notice='Panorama status stopped because the Codex session changed.';
        this.noticeError=true;this.render();this.onChange();
      }else{
        const job=this.client.panoramaJobs.find(item=>
          item.conceptId===pending.conceptId);
        if(!job||['ready','failed','cancelled'].includes(job.status)){
          this.pendingGeneration=null;
          this.notice=!job?`${version(pending)} status is unavailable; inspect the jobs before requesting another image.`:
            job.status==='ready'?`${version(job)} ready. Preview, choose, then apply it.`:
              `${version(job)} ${job.status}: ${job.message||'inspect the job before another request'}.`;
          this.noticeError=!job||job.status!=='ready';this.render();this.onChange();
        }
      }
    }
    const batch=this.batch;
    if(!batch||batch.submitting)return;
    if(this.getSession()!==batch.sessionId||this.client.sessionId!==batch.sessionId){
      this.batch=null;this.notice='Panorama version batch stopped because the Codex session changed.';
      this.noticeError=true;this.render();this.onChange();return;
    }
    const current=this.client.panoramaJobs.find(item=>item.conceptId===batch.lastConceptId);
    if(!current){
      this.batch=null;this.notice='Panorama version status is unavailable. Inspect existing jobs before starting another version.';
      this.noticeError=true;this.render();this.onChange();return;
    }
    if(current.status==='failed'||current.status==='cancelled'){
      this.batch=null;this.notice=`${version(current)} ${current.status}. Earlier ready versions remain; inspect the job before another request.`;
      this.noticeError=true;this.render();this.onChange();return;
    }
    if(current.status!=='ready')return;
    if(batch.submitted===batch.count){
      this.batch=null;
      this.notice=`Panorama versions ${batch.versions.join(', ')} are ready. Preview, choose, then apply one.${batch.requestedVersion?` Requested version ${batch.requestedVersion} is not applied yet.`:''}`;
      this.noticeError=false;this.render();this.onChange();return;
    }
    batch.submitting=true;
    try{
      const job=await this.client.generatePanorama(batch.sessionId,batch.prompt,
        {providerId:batch.providerId});
      if(this.batch!==batch||this.getSession()!==batch.sessionId)return;
      if(job.status==='failed')throw Error(job.message||'Panorama generation failed.');
      batch.submitted++;batch.lastConceptId=job.conceptId;
      batch.versions.push(job.version);
      this.notice=`Generating panorama ${batch.submitted} of ${batch.count}. Ready versions remain available for preview.`;
      this.noticeError=false;this.render();this.onChange();
    }catch(error){
      if(this.batch===batch){
        this.batch=null;
        this.notice=`Panorama version batch stopped: ${String(error?.message||error)}. Inspect the prior versions before another request.`;
        this.noticeError=true;this.render();this.onChange();
      }
    }finally{batch.submitting=false;}
  }
  async vary(typed=''){
    if(this.batch||this.pendingGeneration)
      throw Error('Wait for the current panorama image to finish.');
    const sessionId=await this._session();
    await this.client.refresh(sessionId);
    if(this.getSession()!==sessionId)return null;
    const source=this.client.selectedPanorama||latest(this.client.panoramas);
    if(!source)throw Error('Wait for a ready panorama before making another version.');
    const prompt=typed.trim()&&typed.trim()!==source.prompt?typed.trim():source.prompt;
    const job=await this.client.generatePanorama(sessionId,prompt,
      {sourceConceptId:source.conceptId,providerId:this.els.provider.value});
    if(this.getSession()!==sessionId)return null;
    if(job.status==='failed')throw Error(`${version(job)} failed: ${job.message||'Panorama generation failed.'}`);
    this.pendingGeneration=job.status==='ready'?null:{sessionId,
      conceptId:job.conceptId,version:job.version};
    this.notice=job.status==='ready'?`${version(job)} ready. Preview and choose it before applying.`:
      `${version(job)} ${job.status}. The selected panorama did not change.`;
    this.noticeError=false;this.render();this.onChange();
    return job;
  }
  async selectVersion(number){
    const sessionId=await this._session();
    await this.client.refresh(sessionId);
    if(this.getSession()!==sessionId)return null;
    const panorama=this.client.panoramas.find(item=>item.version===number);
    if(!panorama){
      const pending=this.client.panoramaJobs.find(item=>item.version===number);
      throw Error(pending?`${version(pending)} is ${pending.status}; wait until it is ready.`:
        `Panorama version ${number} is unavailable.`);
    }
    const selected=await this.client.selectPanorama(sessionId,panorama.conceptId);
    if(this.getSession()!==sessionId)return null;
    this.notice=`${version(selected)} selected. Use selected panorama to surround this world.`;
    this.noticeError=false;this.render();this.onChange();
    return selected;
  }
  async applySelected(expected=this.client.selectedPanorama?{
    conceptId:this.client.selectedPanorama.conceptId,
    version:this.client.selectedPanorama.version}:null){
    const blocker=this.canApply();
    if(blocker)throw Error(blocker);
    const sessionId=await this._session();
    await this.client.refresh(sessionId);
    if(this.getSession()!==sessionId)return null;
    const selected=this.client.selectedPanorama;
    if(!selected)throw Error('Select a ready panorama version first.');
    if(!expected||selected.conceptId!==expected.conceptId||
      selected.version!==expected.version)
      throw Error('Selected panorama changed; preview and choose the intended version again.');
    const yaw=Number(this.els.yaw.value);
    if(!Number.isFinite(yaw)||yaw<0||yaw>=360)
      throw Error('Panorama rotation must be from 0 to less than 360 degrees.');
    const name=this.els.name.value.trim()||`Panorama ${selected.version}`;
    if(name.length>80)throw Error('Panorama name must be at most 80 characters.');
    if(this.canApply())throw Error(this.canApply());
    this.notice=`Registering ${version(selected)} on the PC…`;this.render();this.onChange();
    const asset=await this.client.registerPanorama(sessionId,selected.conceptId,name);
    if(this.getSession()!==sessionId)throw Error('Codex session changed; inspect the panorama before applying.');
    this.notice=`Loading ${version(selected)} into the browser…`;this.render();this.onChange();
    const outcome=await this.apply(asset,yaw);
    this.notice=`${version(selected)} is the world panorama at ${yaw}°. Confirm its appearance in VR. Receipt ${outcome.requestId}.`;
    this.noticeError=false;this.render();this.onChange();
    return outcome;
  }
  async removeCurrent(){
    const blocker=this.canApply();if(blocker)throw Error(blocker);
    this.notice='Removing the world panorama…';this.render();this.onChange();
    const outcome=await this.remove();
    this.notice=`World panorama removed. Receipt ${outcome.requestId}.`;
    this.noticeError=false;this.render();this.onChange();
    return outcome;
  }
  async handleText(text){
    const intent=parsePanoramaIntent(text);
    if(!intent)return null;
    return this._run(async()=>{
      if(intent.kind==='describe'){
        this.notice='Describe the scene for the panorama, for example: “Create a panorama of a moonlit forest with distant mountains.”';
        this.noticeError=false;this.render();this.onChange();
      }else if(intent.kind==='generate')await this.generate(intent.prompt);
      else if(intent.kind==='generateMany')
        await this.generateMany(intent.prompt,intent.count,intent.requestedVersion);
      else if(intent.kind==='vary')await this.vary(intent.prompt||this.els.prompt.value);
      else if(intent.kind==='select')await this.selectVersion(intent.version);
      else if(intent.kind==='applyVersion'){
        const selected=await this.selectVersion(intent.version);
        await this.applySelected(selected?{conceptId:selected.conceptId,
          version:selected.version}:null);
      }else await this.applySelected();
      if(intent.deferredApply){
        this.notice+=' The requested apply step is pending: preview and choose a ready version, then apply it explicitly.';
        this.render();this.onChange();
      }
      return this.notice;
    });
  }
  statusForWorld(){
    const active=this.client.panoramaJobs.filter(item=>
      ['queued','generating'].includes(item.status)).at(-1);
    const selected=this.client.selectedPanorama;
    return [active?`Panorama ${version(active)}: ${active.status}.`:'',
      selected?`Selected panorama: ${version(selected)}. ${short(selected.prompt)}`:'',
      this.notice].filter(Boolean).join('\n');
  }
  galleryForWorld(){
    const sessionId=this.getSession();
    if(!sessionId||this.client.sessionId!==sessionId)return [];
    return [...this.client.panoramas].filter(item=>item.status==='ready')
      .sort((a,b)=>a.version-b.version||a.conceptId.localeCompare(b.conceptId))
      .map(item=>{
        const preview=this.previews.get(item.conceptId);
        const ready=!!item.previewUrl&&preview?.sessionId===sessionId&&
          preview.serverUrl===item.previewUrl&&
          typeof preview.objectUrl==='string'&&preview.objectUrl.startsWith('blob:');
        return {conceptId:item.conceptId,version:item.version,
          selected:item.conceptId===this.client.selectedPanoramaId,
          prompt:short(item.prompt),sourceLabel:item.providerId==='codex-native'?
            'Codex GPT Image':'ComfyUI',
          previewStatus:ready?'ready':!item.previewUrl||
            this.previewErrors.has(item.conceptId)?'error':'loading',
          applyAvailable:!this.canApply(),
          ...(ready?{previewObjectUrl:preview.objectUrl}:{})};
      });
  }
  async retryPreviewVersion(number){
    const sessionId=await this._session();
    await this.client.refresh(sessionId);
    if(this.getSession()!==sessionId)return null;
    const item=this.client.panoramas.find(value=>value.version===number);
    if(!item?.previewUrl)throw Error(`Panorama version ${number} has no preview.`);
    this.previewErrors.delete(item.conceptId);
    await this._loadPreview(item);
    const gallery=this.galleryForWorld().find(value=>value.conceptId===item.conceptId);
    if(gallery?.previewStatus!=='ready')
      throw Error(`Panorama version ${number} preview is unavailable.`);
    return gallery;
  }
  updateAvailability(){
    const blocker=this.canApply();
    this.els.apply.disabled=this.busy||!!blocker||!this.client.selectedPanorama;
    this.els.remove.disabled=this.busy||!!blocker||!this.removeAvailable();
    this.els.applyStatus.textContent=blocker||this.notice||
      'Apply the selected panorama in paused Creator Mode on desktop or VR.';
    this.els.applyStatus.classList.toggle('error',this.noticeError||!!blocker);
  }
  render(){
    const selected=this.client.selectedPanorama;
    this.els.summary.textContent=selected?`${version(selected)} selected`:'No panorama version selected';
    if(selected?.conceptId!==this.lastSelectedId){
      this.lastSelectedId=selected?.conceptId||null;
      if(selected?.prompt)this.els.prompt.value=selected.prompt;
      this.els.name.value='';
    }
    const available=this.client.providers.filter(item=>item.available&&
      ['codex-native','comfyui'].includes(item.id));
    if(this.client.providerStatusLoaded){
      const chosen=this.els.provider.value;
      if(!this.providerTouched&&available.some(item=>item.id==='codex-native'))
        this.els.provider.value='codex-native';
      else if(!available.some(item=>item.id===chosen))
        this.els.provider.value=available[0]?.id||'codex-native';
    }
    const noSource=this.client.providerStatusLoaded&&!available.length;
    this.els.generate.disabled=this.busy||!!this.batch||!!this.pendingGeneration||noSource;
    this.els.vary.disabled=this.busy||!!this.batch||!!this.pendingGeneration||
      !this.client.panoramas.length||noSource;
    this.els.provider.disabled=this.busy||!!this.batch||!!this.pendingGeneration||noSource;
    for(const option of this.els.provider.options){
      const source=this.client.providers.find(item=>item.id===option.value);
      option.disabled=this.client.providerStatusLoaded&&source?.available===false;
    }
    const active=this.client.panoramaJobs.filter(item=>
      ['queued','generating'].includes(item.status));
    this.els.status.textContent=this.notice||(active.length?
      `${active.map(item=>`${version(item)} ${item.status}`).join(' · ')}. The selected panorama stays unchanged.`:
      selected?`${version(selected)} is ready. Apply it in desktop or VR Creator Mode.`:
        noSource?'No panorama image source is available on the PC.':
        this.getSession()?'Describe a surrounding scene and generate a panorama.':
          'Connect to Codex to generate panoramas.');
    this.els.status.classList.toggle('error',this.noticeError);
    this.els.jobs.replaceChildren();
    for(const job of [...this.client.panoramaJobs].filter(item=>item.status!=='ready')
      .sort((a,b)=>b.version-a.version).slice(0,5)){
      const row=document.createElement('div');row.className='concept-job';
      row.textContent=`${version(job)} · ${job.status}${job.message?` · ${short(job.message)}`:''}`;
      this.els.jobs.append(row);
    }
    this._renderVersions(this.client.panoramas,selected?.conceptId);
    this.updateAvailability();
  }
  _renderVersions(panoramas,selectedId){
    this.els.versions.replaceChildren();
    for(const item of [...panoramas].sort((a,b)=>a.version-b.version)){
      const card=document.createElement('article');
      card.className=`concept-card${item.conceptId===selectedId?' selected':''}`;
      const title=document.createElement('strong');
      title.textContent=`${version(item)}${item.conceptId===selectedId?' · SELECTED':''}`;
      card.append(title);
      const preview=this.previews.get(item.conceptId);
      if(preview?.sessionId===this.client.sessionId&&preview.serverUrl===item.previewUrl){
        const image=document.createElement('img');image.src=preview.objectUrl;
        image.alt=`Generated panorama ${version(item)}`;card.append(image);
      }else{
        const message=document.createElement('p');message.className='concept-preview-message';
        message.textContent=this.previewErrors.get(item.conceptId)||'Loading preview…';
        card.append(message);
        if(this.previewErrors.has(item.conceptId)){
          const retry=document.createElement('button');retry.type='button';
          retry.textContent='Retry preview';
          retry.addEventListener('click',()=>void this._run(()=>
            this.retryPreviewVersion(item.version)).catch(()=>{}));
          card.append(retry);
        }else void this._loadPreview(item);
      }
      const prompt=document.createElement('p');prompt.textContent=short(item.prompt);
      card.append(prompt);
      const button=document.createElement('button');button.type='button';
      button.textContent=item.conceptId===selectedId?'Selected':'Choose this panorama';
      button.disabled=this.busy||item.conceptId===selectedId;
      button.addEventListener('click',()=>void this._run(()=>
        this.selectVersion(item.version)).catch(()=>{}));
      card.append(button);this.els.versions.append(card);
    }
  }
  async _loadPreview(item){
    const id=item.conceptId,url=item.previewUrl;
    if(this.loadingPreviews.has(id)||!url)return;
    const sessionId=this.client.sessionId;
    this.loadingPreviews.add(id);
    try{
      const parsed=new URL(url,window.location.href);
      if(parsed.origin!==window.location.origin||
        !/^\/api\/agent\/concepts\/[0-9a-f]{32}\/preview$/.test(parsed.pathname)||parsed.search)
        throw Error('Panorama preview URL is invalid');
      const headers={};const token=this.getToken();
      if(token)headers.Authorization=`Bearer ${token}`;
      const response=await fetch(parsed.href,{headers,cache:'no-store'});
      if(!response.ok)throw Error(`Preview HTTP ${response.status}`);
      const blob=await response.blob();
      if(blob.type!=='image/png'||!blob.size||blob.size>32*1024*1024)
        throw Error('Panorama preview must be a PNG up to 32 MiB');
      if(this.client.sessionId!==sessionId||this.getSession()!==sessionId)return;
      const objectUrl=URL.createObjectURL(blob);
      const prior=this.previews.get(id);if(prior)URL.revokeObjectURL(prior.objectUrl);
      this.previews.set(id,{sessionId,serverUrl:url,objectUrl});
      this.previewErrors.delete(id);this.render();this.onChange();
    }catch(error){
      if(this.client.sessionId===sessionId&&this.getSession()===sessionId){
        this.previewErrors.set(id,String(error?.message||error));this.render();this.onChange();
      }
    }finally{this.loadingPreviews.delete(id);}
  }
  _clearPreviews(){
    for(const preview of this.previews.values())URL.revokeObjectURL(preview.objectUrl);
    this.previews.clear();this.previewErrors.clear();
  }
  destroy(){this._clearPreviews();}
}
