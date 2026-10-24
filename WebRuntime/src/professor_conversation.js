// One recipient is captured for each utterance. Journal writes are never world actions.
export class ProfessorConversation {
  constructor({request,onChange=()=>{},onReply=()=>{},onCreated=()=>{},onStop=()=>{},onTasks=()=>{},isDelegatedTurn=()=>false,worldId=()=>'',worldIdentity=null,voiceId=()=>null}) {
    Object.assign(this,{request,onChange,onReply,onCreated,onStop,onTasks,isDelegatedTurn,worldId});
    this.worldIdentity=worldIdentity||worldId;
    this.voiceId=voiceId;
    this.target='professor';this.session=null;this.generation=0;this.pending=false;this.restoring=false;
    this.status='Ask a question to start a lesson.';this.draft='';this.operatorTurns=new Map();this.operatorInputs=[];
    this.queued=Promise.resolve();this.operatorSessions=new Set();
  }
  async activate(id) {
    if(id===this.session?.id){await this.refresh();return;}
    const generation=++this.generation,world=this.worldIdentity();this.onStop();this.session=null;this.target='professor';
    this.restoring=!!id;this.status=id?'Reopening your saved lesson…':'Ask a question to start a lesson.';this.onChange();
    if(!id){this.status='Ask a question to start a lesson.';this.onChange();return;}
    try{const session=await this.request(`/api/school/sessions/${id}`);
      if(this.generation!==generation||this.worldIdentity()!==world)return;
      this.session=session;this.status=`Talking to ${session.mentor.name}`;this.onChange();
    }catch(error){if(this.generation===generation){this.status=error.message;this.onChange();}}
    finally{if(this.generation===generation){this.restoring=false;this.onChange();}}
  }
  select(target){if(!['professor','operator'].includes(target))throw Error('Unknown conversation target.');
    this.target=target;this.onStop();this.status=target==='operator'?'Talking directly to Matrix Operator':this.session?`Talking to ${this.session.mentor.name}`:'Open Professor and choose a lesson.';this.onChange();}
  capture(){return Object.freeze({target:this.target,sessionId:this.session?.id||null,generation:this.generation,worldId:this.worldId(),worldIdentity:this.worldIdentity(),teacherId:this.session?.mentor?.id||null,voiceId:this.voiceId(this.session?.mentor?.id||'default')});}
  current(capture){return capture.generation===this.generation&&capture.sessionId===(this.session?.id||null)&&capture.worldId===this.worldId()&&capture.worldIdentity===this.worldIdentity();}
  context(){const session=this.session;if(!session)return null;return {sessionId:session.id,teacherName:session.mentor.name.slice(0,100),goal:(session.goal||'').slice(0,500),
    events:(session.conversation?.events||[]).slice(-10).map(({speaker,recipient,text})=>({speaker,recipient,text:text.slice(0,600)}))};}
  async refresh(speakNew=false){const id=this.session?.id;if(!id)return;
    const previous=this.session.conversation?.events.filter(event=>event.speaker==='professor'&&event.recipient==='learner').at(-1)?.id;
    const generation=this.generation,session=await this.request(`/api/school/sessions/${id}`);
    if(this.generation===generation&&this.session?.id===id){this.session=session;this.onChange();
      const reply=session.conversation?.events.filter(event=>event.speaker==='professor'&&event.recipient==='learner').at(-1);
      if(speakNew&&previous&&reply?.id!==previous&&!this.pending&&this.target==='professor'){
        const capture=this.capture();
        this.onTasks((session.operatorTasks||[]).filter(task=>task.sourceReplyId===reply.id&&task.status==='requested'),capture);
        await this.onReply(reply,capture);
      }}}
  enqueue(operation){const work=this.queued.catch(()=>{}).then(operation);this.queued=work;return work;}
  async record(sessionId,event){if(!sessionId)return null;
    return this.enqueue(async()=>{let session;
      const parts=event.recipient==='operator'||event.speaker==='operator'?Math.ceil(event.text.length/2000):1;
      for(let i=0;i<parts;i++)session=await this.request(`/api/school/sessions/${sessionId}/conversation`,{event:parts===1?event:{...event,id:`${event.id}:part${i}`,text:event.text.slice(i*2000,(i+1)*2000)}});
      if(this.session?.id===sessionId){this.session=session;this.onChange();}return event;});}
  async recordInput(text,capture,inputKind='voice') {
    const event={id:crypto.randomUUID(),speaker:'learner',recipient:capture.target,inputKind,text,worldId:capture.worldId};
    await this.record(capture.sessionId,event);
    if(capture.target==='operator')this.operatorInputs.push({event,sessionId:capture.sessionId});
    return event;
  }
  async ask(text,capture=this.capture(),inputKind='text') {
    if(this.restoring)throw Error('Wait for your saved lesson to reopen before speaking.');
    if(this.pending)throw Error('The professor is still replying. Your draft is kept.');
    if(capture.target!=='professor')throw Error('This reply belongs to Operator.');
    this.pending=true;this.draft=text;this.draftSessionId=capture.sessionId;this.status='Saving your turn…';this.onChange();
    try{
      if(!capture.sessionId){
        this.status='Creating your lesson and finding a professor…';this.onChange();
        const session=await this.request('/api/school/sessions',{goal:text,mentor:'',inputKind,
          preferences:{difficulty:'beginner',style:'dialogue',timeBudget:''}});
        if(!this.current(capture))return;
        this.session=session;this.draft='';this.pending=false;this.status=`Talking to ${session.mentor.name}`;this.onChange();
        await this.onCreated(session);
        const reply=session.conversation?.events.filter(item=>item.speaker==='professor').at(-1);
        if(reply)await this.onReply(reply,this.capture());
        return;
      }
      const event=await this.recordInput(text,capture,inputKind);
      if(!this.current(capture))throw Error('The lesson or world changed. Your transcript remains in its original lesson.');
      this.status='Professor is thinking…';this.onChange();
      const fresh=await this.request(`/api/school/sessions/${capture.sessionId}`);
      const session=await this.request(`/api/school/sessions/${capture.sessionId}/spoken-message`,{eventId:event.id,revision:fresh.revision});
      if(!this.current(capture))return;
      this.session=session;this.draft='';this.status='Reply saved.';this.onChange();
      const reply=session.conversation.events.find(item=>item.id===`reply:${event.id}`);
      this.onTasks((session.operatorTasks||[]).filter(task=>task.sourceReplyId===reply?.id&&task.status==='requested'),capture);
      if(reply)void Promise.resolve(this.onReply(reply,capture)).catch(error=>{
        if(this.current(capture)){this.status=error.message;this.onChange();}
      });
    }catch(error){if(this.current(capture))this.status=error.message;throw error;}
    finally{this.pending=false;this.onChange();}
  }
  async delivery(eventId,delivery,sessionId=this.session?.id){if(!sessionId)return;
    const session=await this.enqueue(()=>this.request(`/api/school/sessions/${sessionId}/speech-delivery`,{eventId,delivery}));
    if(this.session?.id===sessionId){this.session=session;this.onChange();}}
  observeOperator(status){
    if(!status?.sessionId||!this.session)return;
    const first=!this.operatorSessions.has(status.sessionId);this.operatorSessions.add(status.sessionId);
    for(const turn of status.transcript||[]){
      if(this.isDelegatedTurn(turn))continue;
      const key=`${status.sessionId}:${turn.turnId}`;let record=this.operatorTurns.get(key);
      if(!record){
        record={sessionId:this.session.id,inputDone:false,outputDone:false};this.operatorTurns.set(key,record);
        // Only import new/current turns, never replay unrelated historical conversations.
        if(first&&turn.status!=='working'){record.inputDone=true;record.outputDone=true;continue;}
      }
      if(!record.inputDone&&turn.user){record.inputDone=true;
        const existing=this.operatorInputs.find(item=>item.sessionId===record.sessionId&&item.event.text===turn.user);
        const event={id:`operator-input:${key}`,speaker:'learner',recipient:'operator',inputKind:'text',text:turn.user,worldId:this.worldId(),operatorSessionId:status.sessionId,operatorTurnId:turn.turnId};
        if(!existing)void this.record(record.sessionId,event).catch(error=>{record.inputDone=false;this.status=`Transcript save failed: ${error.message}`;this.onChange();});
      }
      if(!record.outputDone&&['completed','failed','cancelled'].includes(turn.status)&&turn.assistant){record.outputDone=true;
        void this.record(record.sessionId,{id:`operator-reply:${key}`,speaker:'operator',recipient:'learner',inputKind:'text',text:turn.assistant,worldId:this.worldId(),operatorSessionId:status.sessionId,operatorTurnId:turn.turnId})
          .catch(error=>{record.outputDone=false;this.status=`Transcript save failed: ${error.message}`;this.onChange();});
      }
    }
  }
}
