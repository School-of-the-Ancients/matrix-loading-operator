// Asset production is independent of teaching. Only apply verified catalog entries in an idle scene.
export class ProfessorAppearanceClient {
  constructor({request,current,isBusy,apply,worldIdentity=()=>null,onSession=()=>{},onError=()=>{}}){
    Object.assign(this,{request,current,isBusy,apply,worldIdentity,onSession,onError});this.pending=false;
  }
  async sync(){
    const initial=this.current();
    if(this.pending||!initial?.id||this.isBusy())return;
    if(this.sessionId!==initial.id){this.sessionId=initial.id;this.world=this.worldIdentity();}
    if(this.world!==this.worldIdentity())return;
    this.pending=true;
    try{
      const session=await this.request(`/api/school/sessions/${initial.id}`);
      if(this.current()?.id!==initial.id||this.world!==this.worldIdentity()||this.isBusy())return;
      const current=this.current();
      if(session.revision<current.revision||(session.appearanceRevision||0)<(current.appearanceRevision||0))return;
      this.onSession(session);
      const catalog=await this.request('/api/professor/avatars');
      if(this.current()?.id!==session.id||this.world!==this.worldIdentity()||this.isBusy())return;
      const id=session.appearance?.catalogId||'generic-professor';
      const avatar=catalog.avatars.find(item=>item.catalogId===id&&item.availability==='ready');
      if(!avatar)return;
      await this.apply(avatar,session,catalog);
    }catch(error){this.onError(error);}
    finally{this.pending=false;}
  }
}
