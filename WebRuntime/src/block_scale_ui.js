import {BlockScaleClient,matchingScaleEvidence,scaleEvidence,scaleIntent,uniformScaleFactors,
  SCALE_EVIDENCE_KEY} from './block_scale.js';

const $=id=>document.getElementById(id);
const number=value=>Number.isFinite(value)?String(value):'unavailable';
const dimensions=value=>value?`X ${number(value.x)} · Y ${number(value.y)} · Z ${number(value.z)} m`:'unavailable';

export class BlockScaleUI{
  constructor(world,onSelect,storage=localStorage,client=new BlockScaleClient()){
    this.world=world;this.onSelect=onSelect;this.storage=storage;this.client=client;
    this.pollTimer=null;this.busy=false;this.evidence=null;
    try{this.evidence=JSON.parse(storage.getItem(SCALE_EVIDENCE_KEY)||'null');}catch{}
    $('scale-pair').addEventListener('click',()=>this.pair());
    $('scale-target').addEventListener('change',()=>{if($('scale-target').value)this.onSelect($('scale-target').value);});
    $('scale-configure').addEventListener('click',()=>this.configure());
    $('scale-reset').addEventListener('click',()=>this.reset());
    $('scale-cancel').addEventListener('click',()=>this.cancel());
    addEventListener('beforeunload',()=>this.stopPolling());
    this.refreshTargets();
    this.client.discovery().then(discovery=>{
      $('scale-discovery').textContent=discovery.pairingAvailable?
        'Open /clients on this PC, create a one-use code for Matrix Web Scale Lab, then pair here. Review and Apply each proposal on /clients.':
        discovery.pairingReason||'Client pairing is unavailable.';
    }).catch(error=>this.message(error.message,true));
  }
  message(value,error=false){
    $('scale-status').textContent=value;$('scale-status').classList.toggle('error',error);
  }
  refreshTargets(){
    const select=$('scale-target'),prior=select.value;
    const blocks=this.world.scene.objects.filter(item=>item.assetId==='block'&&item.anchorId==='web-floor');
    select.replaceChildren(new Option('Choose a built-in block',''));
    for(const item of blocks)select.add(new Option(`${item.objectId.slice(0,16)} · built-in block`,item.objectId));
    const selected=this.world.scene.objects.find(item=>item.objectId===this.world.selection.objectId&&item.assetId==='block');
    select.value=selected?.objectId||blocks.some(item=>item.objectId===prior)&&prior||'';
    const selected3D=selected&&selected.anchorId==='web-floor';
    $('scale-viewport-hint').classList.toggle('hidden',!selected3D);
    $('scale-viewport-hint').textContent=selected3D?
      `Selected block ${selected.objectId.slice(0,8)} · click the scene, then press 1–4 for a uniform scale proposal or R to reset.`:'';
    $('scale-reset').disabled=!this.client.baselineFor(select.value)||this.busy||!!this.client.currentId;
    $('scale-configure').disabled=this.busy||!!this.client.currentId||!select.value;
    $('scale-pair').disabled=this.busy||!!this.client.currentId;
    $('scale-pair').title=this.client.currentId?
      `Resolve scale request ${this.client.currentId} before pairing again. Inspect /clients if polling fails.`:'';
    this.renderEvidence();
  }
  renderEvidence(){
    const output=$('scale-observation');
    if(!matchingScaleEvidence(this.world,this.evidence)){
      output.textContent='No matching confirmed scale observation for this saved block. The current scene remains available; pair and configure to capture a new baseline.';
      return;
    }
    const event=this.evidence.event;
    output.textContent=`Saved historical runtime observation · revision ${event.revision}\n`+
      `Local-axis dimensions: ${dimensions(event.localDimensionsMeters)}\n`+
      `Bounding-box volume: ${number(event.boundingVolumeCubicMeters)} m³\n`+
      `Relative factors: X ${number(event.relativeFactors.x)} · Y ${number(event.relativeFactors.y)} · Z ${number(event.relativeFactors.z)}\n`+
      `Mathematical volume ratio: ${number(event.mathematicalVolumeRatio)} (dimensionless)\n`+
      'Catalog bounds × transform; not measured physical volume or a physics result. Saved browser evidence is historical; after reload, re-pair to make new requests.';
  }
  async pair(){
    if(this.busy)return;
    this.busy=true;this.refreshTargets();
    try{
      const code=$('scale-code').value;
      await this.client.pair(code);
      $('scale-code').value='';
      this.message('Paired for this tab. Select a built-in block, propose factors, then review and Apply on /clients.');
    }catch(error){this.message(error.message,true);}
    finally{this.busy=false;this.refreshTargets();}
  }
  async configure(){
    const objectId=$('scale-target').value;
    const factors=Object.fromEntries(['x','y','z'].map(axis=>[axis,$(`scale-${axis}`).valueAsNumber]));
    try{
      const baseline=$('scale-new-baseline').checked?null:this.client.baselineFor(objectId);
      await this.submit(scaleIntent('configure',objectId,factors,baseline));
    }catch(error){this.message(error.message,true);}
  }
  async reset(){
    const objectId=$('scale-target').value;
    try{await this.submit(scaleIntent('reset',objectId,null,this.client.baselineFor(objectId)));}
    catch(error){this.message(error.message,true);}
  }
  async viewportPreset(value){
    const object=this.world.scene.objects.find(item=>item.objectId===this.world.selection.objectId);
    if(!object||object.assetId!=='block'||object.anchorId!=='web-floor')return;
    $('scale-target').value=object.objectId;
    for(const [axis,factor] of Object.entries(uniformScaleFactors(value)))$(`scale-${axis}`).value=String(factor);
    await this.configure();
  }
  async viewportReset(){
    const object=this.world.scene.objects.find(item=>item.objectId===this.world.selection.objectId);
    if(!object||object.assetId!=='block'||object.anchorId!=='web-floor')return;
    $('scale-target').value=object.objectId;
    await this.reset();
  }
  async submit(intent){
    if(this.busy||this.client.currentId)return;
    this.busy=true;this.refreshTargets();
    this.message('Reading the current Matrix scene and preparing a reviewed request…');
    try{
      const proposed=await this.client.propose(intent);
      this.showOutcome(proposed);
    }catch(error){
      this.message(this.client.currentId?
        `Request ${this.client.currentId} may have reached Matrix. Reconciling without replay. ${error.message}`:
        error.message,true);
    }finally{
      this.busy=false;this.refreshTargets();
      if(this.client.currentId)this.startPolling();
    }
  }
  showOutcome(value){
    const proposal=value.proposal;
    $('scale-proposal').textContent=proposal&&value.status==='ready'?
      JSON.stringify({summary:proposal.summary,commands:proposal.commands,assumptions:proposal.assumptions},null,2):'';
    $('scale-cancel').disabled=!['planning','ready'].includes(value.status);
    if(value.status==='ready')this.message(`Request ${value.requestId} is ready. Review its exact set_transform command and Apply on /clients.`);
    else if(['queued','running'].includes(value.status))this.message(`Request ${value.requestId} is ${value.status}; waiting for the runtime receipt.`);
    else if(value.status==='succeeded'){
      const evidence=scaleEvidence(value);
      if(evidence){
        this.evidence=evidence;
        try{this.storage.setItem(SCALE_EVIDENCE_KEY,JSON.stringify(evidence));}
        catch{this.message('Scale confirmed, but browser storage could not retain its historical observation.',true);}
        $('scale-new-baseline').checked=false;
        this.renderEvidence();
        if($('scale-status').classList.contains('error'))return;
        this.message(`Confirmed ${value.experimentEvent.action} for ${value.experimentEvent.objectId}. Ratio ${number(value.experimentEvent.mathematicalVolumeRatio)}.`);
      }else this.message('The command completed, but the scale observation was not confirmed. Inspect the scene before trying again.',true);
    }else if(value.status==='planning')this.message(`Request ${value.requestId} is planning.`);
    else this.message(`Request ${value.requestId}: ${value.status}${value.error?` · ${value.error}`:''}. Inspect the scene before retrying.`,true);
    this.refreshTargets();
  }
  startPolling(){
    if(this.pollTimer)return;
    this.pollTimer=setInterval(()=>this.poll(),750);
    void this.poll();
  }
  stopPolling(){if(this.pollTimer){clearInterval(this.pollTimer);this.pollTimer=null;}}
  async poll(){
    if(this.busy||!this.client.currentId){if(!this.client.currentId)this.stopPolling();return;}
    this.busy=true;
    try{this.showOutcome(await this.client.outcome());}
    catch(error){
      if(error.code==='request_not_found'){
        this.client.currentId=null;
        this.message('The request ID was not found in this pairing. Nothing is confirmed; inspect /clients before making a new request.',true);
      }else this.message(`Cannot reconcile scale request ${this.client.currentId}: ${error.message}. Keep this tab open and inspect /clients before pairing again.`,true);
    }finally{this.busy=false;this.refreshTargets();if(!this.client.currentId)this.stopPolling();}
  }
  async cancel(){
    try{await this.client.cancel();this.message('Cancellation requested. Waiting for Matrix to confirm its status.');this.startPolling();}
    catch(error){this.message(error.message,true);}
  }
}
