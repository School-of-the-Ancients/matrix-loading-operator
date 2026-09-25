// Browser contract for the PC-owned Agent Portal. Only the opaque Matrix ID is stored.
export const AGENT_SESSION_KEY='matrix-agent-session-id';
const SESSION_ID=/^[0-9a-f]{32}$/;

export class AgentClient {
  constructor(request,storage,onChange=()=>{}){
    this.request=request;this.storage=storage;this.onChange=onChange;
    const saved=storage.getItem(AGENT_SESSION_KEY);
    this.sessionId=SESSION_ID.test(saved||'')?saved:null;
    this.status=null;this.error='';this.cursor=0;this.polling=false;
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
    try{return this._update(await this.request('/api/agent/status',
      {sessionId:this.sessionId,cursor:this.cursor}));}
    catch(error){this._fail(error);throw error;}
  }
  async poll(){
    if(!this.sessionId||this.polling)return null;
    this.polling=true;
    try{return await this.restore();}
    finally{this.polling=false;}
  }
  async send(text,context=null){
    if(!this.sessionId)await this.connect();
    if(typeof text!=='string'||!text.trim()||text.length>16000)throw Error('Enter a message up to 16000 characters.');
    try{
      await this.request('/api/agent/turn',{sessionId:this.sessionId,text,
        ...(context?{context}:{})});
      return await this.restore();
    }catch(error){this._fail(error);throw error;}
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
