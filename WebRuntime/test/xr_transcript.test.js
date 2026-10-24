import test from 'node:test';
import assert from 'node:assert/strict';
import {XRTranscript,transcriptContent} from '../src/xr_transcript.js';
class Element extends EventTarget{
  hidden=false;textContent='';children=[];attributes={};scrollTop=0;scrollHeight=500;clientHeight=200;
  setAttribute(k,v){this.attributes[k]=v;}append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}focus(){}click(){this.dispatchEvent(new Event('click'));}
}
const session={id:'lesson',mentor:{name:'Leonardo'},conversation:{events:[
  {id:'1',speaker:'learner',recipient:'professor',text:'Why does it turn?'},
  {id:'2',speaker:'professor',recipient:'learner',text:'Look at the shaft. What drives it?',delivery:'interrupted'},
  {id:'3',speaker:'professor',recipient:'operator',text:'Private task instruction'},
  {id:'4',speaker:'operator',recipient:'learner',text:'The exhibit is ready.'}]}};
function fixture(){const elements=Object.fromEntries(['toggle','panel','close','title','latest','history'].map(k=>[k,new Element()]));
  const view=new XRTranscript({...elements,document:{createElement:()=>new Element()}});return {view,...elements};}
test('shows the exact last professor question and attributed recent conversation, without replaying tasks',()=>{
  const result=transcriptContent(session);assert.equal(result.latest,'Look at the shaft. What drives it?');
  assert.equal(result.entries.length,3);assert.equal(result.entries[1].status,'Interrupted');
  assert.equal(result.entries[0].label,'You → Leonardo');
  assert(!JSON.stringify(result).includes('Private task instruction'));
});
test('transcript opens and closes independently; rendering never submits a message',()=>{
  const f=fixture();f.view.render(session);f.toggle.click();assert.equal(f.panel.hidden,false);
  assert.equal(f.toggle.attributes['aria-expanded'],'true');assert.equal(f.latest.textContent,transcriptContent(session).latest);
  assert.equal(f.history.children[1].children[1].textContent,transcriptContent(session).latest);
  f.close.click();assert.equal(f.panel.hidden,true);
  f.view.render(null);assert.equal(f.history.children.length,1);assert(!f.latest.textContent.includes('shaft'));
});
test('a new reply updates the pinned question but preserves the scroll position while reviewing',()=>{
  const f=fixture();f.view.render(session);f.view.setOpen(true);f.history.scrollTop=20;
  const next=structuredClone(session);next.conversation.events.push({id:'5',speaker:'professor',recipient:'learner',text:'What changes if it is heavier?',delivery:'spoken'});
  f.view.render(next);assert.equal(f.history.scrollTop,20);assert.equal(f.latest.textContent,'What changes if it is heavier?');
  const other={id:'another',mentor:{name:'Ada'},conversation:{events:[]}};f.view.render(other);
  assert.equal(f.title.textContent,'Ada · conversation');assert.equal(f.history.scrollTop,f.history.scrollHeight);
});
