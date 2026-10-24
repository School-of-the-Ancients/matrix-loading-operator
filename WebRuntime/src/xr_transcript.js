// Read-only view of the existing lesson journal; never submits or replays turns.
export function transcriptContent(session){
  const events=(session?.conversation?.events||[]).filter(e=>typeof e.text==='string'&&
    (e.speaker==='learner'||e.recipient==='learner')&&['learner','professor','operator'].includes(e.speaker));
  const latest=events.findLast(e=>e.speaker==='professor'&&e.recipient==='learner');
  const name=session?.mentor?.name||'Professor';
  const delivery={text:'Text only',speaking:'Speaking',spoken:'Spoken',interrupted:'Interrupted',failed:'Voice failed'};
  return {lessonId:session?.id||'',title:session?`${name} · conversation`:'Conversation',
    latest:latest?.text.slice(0,4000)||'Your professor’s latest reply will appear here.',
    entries:events.slice(-40).map(e=>({id:e.id,label:e.speaker==='learner'?`You → ${e.recipient==='operator'?'Operator':name}`:
      e.speaker==='operator'?'Operator':name,status:e.speaker==='professor'?(delivery[e.delivery]||'Text only'):'',
      text:e.text.length>2000?e.text.slice(0,2000)+'…':e.text}))};
}

export class XRTranscript {
  constructor({toggle,panel,close,title,latest,history,document,canOpen=()=>true}){
    Object.assign(this,{toggle,panel,close,title,latest,history,document,canOpen});
    this.opened=false;this.signature='';this.lessonId='';
    toggle.addEventListener('click',()=>this.setOpen(!this.opened));
    close.addEventListener('click',()=>this.setOpen(false));
    panel.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();this.setOpen(false);}});
    panel.addEventListener('wheel',event=>event.stopPropagation());
    this.setOpen(false);this.render(null);
  }
  setOpen(open){
    if(open&&!this.canOpen())return false;
    const wasOpen=this.opened;
    this.opened=open;this.panel.hidden=!open;this.toggle.setAttribute('aria-expanded',String(open));
    if(open){this.history.scrollTop=this.history.scrollHeight;this.close.focus?.({preventScroll:true});}
    else if(wasOpen)this.toggle.focus?.({preventScroll:true});
    return true;
  }
  render(session){
    const content=transcriptContent(session),signature=JSON.stringify(content);
    if(signature===this.signature)return;
    const nearBottom=this.history.scrollHeight-this.history.scrollTop-this.history.clientHeight<60;
    const scrollTop=this.history.scrollTop;
    const changedLesson=content.lessonId!==this.lessonId;
    this.signature=signature;this.lessonId=content.lessonId;
    this.title.textContent=content.title;this.latest.textContent=content.latest;
    const rows=content.entries.map(entry=>{
      const row=this.document.createElement('article'),label=this.document.createElement('strong'),text=this.document.createElement('p');
      label.textContent=entry.label+(entry.status?` · ${entry.status}`:'');text.textContent=entry.text;
      row.append(label,text);return row;
    });
    if(!rows.length){const empty=this.document.createElement('p');empty.textContent='No conversation yet. Ask a question to begin.';rows.push(empty);}
    this.history.replaceChildren(...rows);
    if(nearBottom||changedLesson)this.history.scrollTop=this.history.scrollHeight;
    else this.history.scrollTop=scrollTop;
  }
}
