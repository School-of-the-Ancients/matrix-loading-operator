const active = new Set(['queued','submitting','running','cancelling']);
export class ProfessorTaskClient {
  constructor({request,ensureSession,onVerified=()=>{},onChange=()=>{},canPoll=()=>true,isCurrent=()=>true}) {
    Object.assign(this,{request,ensureSession,onVerified,onChange,canPoll,isCurrent});
    this.records=new Map();this.submitting=new Set();this.polling=false;
  }
  watch(session){
    for(const task of session?.operatorTasks||[])if(task.execution&&active.has(task.status)&&!this.records.has(task.id))
      this.records.set(task.id,{task,schoolSessionId:session.id,status:task.status});
  }
  async submit(task,capture){
    if(this.submitting.has(task.id)||!this.isCurrent(capture))return;
    this.submitting.add(task.id);this.onChange();
    try{
      const sessionId=await this.ensureSession();
      if(!this.isCurrent(capture))throw Error('The lesson or world changed before task submission.');
      const result=await this.request('/api/professor/task',{taskId:task.id,schoolSessionId:capture.sessionId,sessionId,
        title:task.title,instruction:task.instruction,objectiveId:task.objectiveId});
      if(result.taskId!==task.id||result.schoolSessionId!==capture.sessionId)throw Error('Operator returned a different task identity.');
      this.records.set(task.id,{task,schoolSessionId:capture.sessionId,status:result.status});
      await this.verify(this.records.get(task.id));
    }catch(error){this.records.set(task.id,{task,schoolSessionId:capture.sessionId,status:'unconfirmed',error:error.message});}
    finally{this.submitting.delete(task.id);this.onChange();}
  }
  async verify(record){
    const session=await this.request(`/api/school/sessions/${record.schoolSessionId}/operator-task-result`,{taskId:record.task.id});
    const task=session.operatorTasks?.find(item=>item.id===record.task.id);
    if(!task)throw Error('The saved lesson no longer contains this task.');
    record.status=task.status;record.task=task;record.error='';this.onVerified(session,task);this.onChange();
  }
  async poll(){
    if(this.polling||!this.canPoll())return;this.polling=true;
    try{for(const record of this.records.values())if(active.has(record.status)){
      try{await this.verify(record);}catch(error){record.error=error.message;this.onChange();}
    }}finally{this.polling=false;}
  }
  async cancel(taskId){
    const record=this.records.get(taskId);if(!record)return;
    await this.request('/api/professor/task/cancel',{schoolSessionId:record.schoolSessionId,taskId});
    await this.verify(record);
  }
}
