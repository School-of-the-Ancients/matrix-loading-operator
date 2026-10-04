// Browser contract for the PC-owned Agent Portal. Only the opaque Matrix ID is stored.
import {validCreationMode} from './creation_mode.js';

export const AGENT_SESSION_KEY='matrix-agent-session-id';
const SESSION_ID=/^[0-9a-f]{32}$/;
const CAPTURE_ID=/^[0-9a-f]{32}$/;

export class AgentClient {
  constructor(request,storage,onChange=()=>{}){
    this.request=request;this.storage=storage;this.onChange=onChange;
    const saved=storage.getItem(AGENT_SESSION_KEY);
    this.sessionId=SESSION_ID.test(saved||'')?saved:null;
    this.status=null;this.error='';this.cursor=0;this.polling=false;this.statusGeneration=0;
    this.permissionDraft=null;
  }
  _update(status){
    if(!status||status.sessionId!==this.sessionId||!Array.isArray(status.transcript))
      throw Error('Invalid Agent Portal response');
    this.status=status;this.cursor=status.cursor;this.error='';this.onChange(this);
    return status;
  }
  _fail(error){this.error=String(error?.message||error).slice(0,300);this.onChange(this);}
  async connect(){
    if(this.sessionId)return this.restore();
    try{
      const status=await this.request('/api/agent/session',{});
      if(!SESSION_ID.test(status?.sessionId||''))throw Error('Invalid Agent Portal session');
      this.sessionId=status.sessionId;
      this.storage.setItem(AGENT_SESSION_KEY,this.sessionId);
      return this._update(status);
    }catch(error){this._fail(error);throw error;}
  }
  async restore(){
    if(!this.sessionId)return null;
    const generation=this.statusGeneration;
    try{
      const status=await this.request('/api/agent/status',{sessionId:this.sessionId,cursor:this.cursor});
      return generation===this.statusGeneration?this._update(status):this.status;
    }catch(error){
      if(generation!==this.statusGeneration)return this.status;
      this._fail(error);throw error;
    }
  }
  async poll(){
    if(!this.sessionId||this.polling)return null;
    this.polling=true;
    try{return await this.restore();}
    finally{this.polling=false;}
  }
  async send(text,context=null,expectedConcept=null,creationMode='auto',captureId=null){
    if(!this.sessionId)await this.connect();
    this.assertPermissionsApplied();
    if(typeof text!=='string'||!text.trim()||text.length>16000)throw Error('Enter a message up to 16000 characters.');
    if(expectedConcept&&(!SESSION_ID.test(expectedConcept.conceptId||'')||
        !Number.isSafeInteger(expectedConcept.version)||expectedConcept.version<1))
      throw Error('Selected concept identity is invalid. Refresh and choose the version again.');
    if(expectedConcept&&!validCreationMode(creationMode))
      throw Error('Unknown concept creation mode.');
    if(captureId!==null&&(typeof captureId!=='string'||!CAPTURE_ID.test(captureId)||!context||expectedConcept))
      throw Error('A reviewed capture needs a Matrix context and cannot accompany a selected concept.');
    try{
      const accepted=await this.request('/api/agent/turn',{sessionId:this.sessionId,text,
        ...(context?{context}:{}),
        ...(captureId?{captureId}:{}),
        ...(expectedConcept?{expectedConceptId:expectedConcept.conceptId,
          expectedConceptVersion:expectedConcept.version,creationMode}:{})});
      if(accepted?.sessionId!==this.sessionId||!accepted?.turnId)
        throw Error('Could not confirm the Agent submission. Inspect the current turn before retrying.');
      if(Array.isArray(accepted.transcript))return this._update(accepted);
      // Older services still acknowledge without a snapshot. An acknowledged
      // turn must never be resent merely because its status refresh failed.
      try{return await this.restore();}catch{return accepted;}
    }catch(error){this._fail(error);throw error;}
  }
  async steer(text,context=null,turnId=this.status?.activeTurnId){
    if(!this.sessionId||!turnId)throw Error('No active Codex turn can accept an instruction.');
    if(typeof text!=='string'||!text.trim()||text.length>16000)
      throw Error('Enter an instruction up to 16000 characters.');
    let accepted;
    try{
      accepted=await this.request('/api/agent/steer',{sessionId:this.sessionId,turnId,text,
        ...(context?{context}:{})});
      if(accepted?.turnId!==turnId)throw Error('Could not confirm the added instruction.');
    }catch(error){this._fail(error);throw error;}
    // A failed status refresh cannot undo an acknowledged native steer.
    try{return await this.restore();}
    catch{return accepted;}
  }
  async transcribe(audioBase64){
    if(!this.sessionId)await this.connect();
    try{
      const result=await this.request('/api/agent/transcribe',{sessionId:this.sessionId,audioBase64});
      if(typeof result?.transcript!=='string'||!result.transcript.trim()||result.transcript.length>4000)
        throw Error('Invalid Agent Portal transcription');
      return result.transcript;
    }catch(error){this._fail(error);throw error;}
  }
  async decide(approvalId,turnId,approve){
    if(!this.sessionId||typeof approve!=='boolean')throw Error('Invalid Agent approval');
    try{
      await this.request('/api/agent/approval',{sessionId:this.sessionId,approvalId,turnId,approve});
      return await this.restore();
    }catch(error){this._fail(error);throw error;}
  }
  async setPermissions(mode,confirmed=false){
    if(!this.sessionId||!this.status)throw Error('Connect to Codex before changing permissions.');
    if(this.status.activeTurnId)throw Error('Wait for the current turn to finish or stop it before changing permissions.');
    if(this.status.permissionsChangeAllowed!==true)throw Error('Permission changes are unavailable for this Agent session.');
    if(mode!=='reviewed'&&mode!=='full-access')throw Error('Choose Reviewed or Full access.');
    if(typeof confirmed!=='boolean'||(mode==='full-access'&&!confirmed))
      throw Error('Confirm access to PC files, network and tools before enabling Full access.');
    try{
      const status=await this.request('/api/agent/permissions',{sessionId:this.sessionId,mode,confirmed});
      // A poll started before this response cannot restore the previous mode.
      this.statusGeneration++;
      return this._update(status);
    }catch(error){
      // The change may have reached the service even if its response was lost.
      this.statusGeneration++;
      this._fail(error);throw error;
    }
  }
  pendingPermissionChange(){
    return agentPermissionDraftMessage(this.error?null:this.status,this.permissionDraft);
  }
  assertPermissionsApplied(){
    const message=this.pendingPermissionChange();
    if(message)throw Error(message);
  }
  async cancel(){
    const turnId=this.status?.activeTurnId;
    if(!this.sessionId||!turnId)return null;
    try{
      await this.request('/api/agent/cancel',{sessionId:this.sessionId,turnId});
      return await this.restore();
    }catch(error){this._fail(error);throw error;}
  }
}

export function agentActivityLabel(activity){
  return ({idle:'Ready',working:'Working',using_tool:'Using a tool',using_blender:'Using Blender',
    running_command:'Running a command',editing_files:'Editing files',
    waiting_for_approval:'Waiting for approval',completed:'Completed',cancelled:'Cancelled',
    failed:'Failed',stopping:'Stopping'})[activity]||'Ready';
}

export function agentAccessLabel(status){
  if(status?.accessMode==='danger-full-access'&&status?.approvalMode==='automatic')
    return 'Full access · automatic approvals';
  if(status?.approvalMode==='reviewed'){
    if(status.accessMode==='danger-full-access')return 'Reviewed · full PC access';
    if(status.accessMode==='workspace-write')return 'Reviewed · workspace access';
    if(status.accessMode==='read-only')return 'Limited · read-only access';
  }
  return 'Permissions unknown';
}

export function agentPermissionMode(status){
  if(status?.accessMode==='danger-full-access'&&status?.approvalMode==='automatic')return 'full-access';
  if(status?.approvalMode==='reviewed'&&
    ['read-only','workspace-write','danger-full-access'].includes(status?.accessMode))return 'reviewed';
  return null;
}

export function agentPermissionDraftMessage(status,draft){
  if(draft!=='reviewed'&&draft!=='full-access')return '';
  const active=agentPermissionMode(status);
  if(draft===active)return '';
  const selected=draft==='full-access'?'Full access':'Reviewed';
  const apply=draft==='full-access'?'Confirm and choose Enable Full access':'Choose Use Reviewed';
  const restore=active?`select the active ${active==='full-access'?'Full access':'Reviewed'} mode again`:
    'reconnect to check the active mode';
  return `Not applied: ${selected}. ${apply}, or ${restore}, before a new request or entering AR/VR.`;
}
