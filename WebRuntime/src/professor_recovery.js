// Resume only lessons actually bound to this saved world, never the newest archive entry.
const KEY='matrix-active-professor-v1';
export class ProfessorRecovery {
  constructor({storage,conversation,scene,onRestored=()=>{},preferredTeacher=null}){
    Object.assign(this,{storage,conversation,scene,onRestored,preferredTeacher});
    this.attempted=false;this.pending=null;this.error='';
  }
  remember(){
    const id=this.conversation.session?.id;
    const object=this.scene().objects.find(item=>item.professor?.schoolSessionId===id);
    if(!id||!object)return;
    this.error='';
    try{const value=JSON.stringify({sessionId:id,objectId:object.objectId});
      if(this.storage.getItem(KEY)!==value)this.storage.setItem(KEY,value);
    }catch{/* The saved world binding can still recover a single professor. */}
  }
  async restore(){
    if(this.pending)return this.pending;
    if(this.conversation.session){this.remember();return;}
    if(this.attempted){if(this.error)throw Error(this.error);return;}
    this.attempted=true;
    const scene=this.scene(),objects=scene.objects.filter(item=>item.professor?.schoolSessionId);
    let saved;
    try{saved=JSON.parse(this.storage.getItem(KEY)||'null');}catch{}
    const preferred=this.preferredTeacher?objects.filter(item=>item.professor.teacherId===this.preferredTeacher):[];
    const selected=(preferred.length===1?preferred[0]:null)||objects.find(item=>item.objectId===saved?.objectId&&item.professor.schoolSessionId===saved?.sessionId)
      ||(new Set(objects.map(item=>item.professor.schoolSessionId)).size===1?objects[0]:null);
    if(!selected){
      if(objects.length){this.error='Choose a saved professor or lesson before speaking; this world has more than one.';throw Error(this.error);}
      return;
    }
    const id=selected.professor.schoolSessionId;
    this.restoringId=id;
    const generation=this.conversation.generation+1;
    this.pending=(async()=>{
      await this.conversation.activate(id);
      if(this.scene()!==scene||this.conversation.generation!==generation)return;
      if(this.conversation.session?.id!==id){
        if(this.conversation.session)return; // An explicit selection won the race.
        this.error='The saved lesson could not reopen. Open Professor and choose the lesson before speaking.';
        throw Error(this.error);
      }
      this.remember();this.onRestored(id);
    })();
    try{await this.pending;}finally{this.pending=null;this.restoringId=null;}
  }
}
