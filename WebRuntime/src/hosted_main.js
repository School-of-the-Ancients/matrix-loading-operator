import './style.css';
import './hosted.css';
import {MatrixWorld} from './protocol.js';
import {MatrixView} from './view.js';
import {applyHostedObservation} from './hosted_visit.js';

const $=id=>document.getElementById(id);
const world=new MatrixWorld();
let token='';
let current=null;
let rendered=false;
let xrInitialized=false;
let generation=0;
let pollTimer=null;
const feedback=(message,error=false)=>{
  $('feedback').textContent=message;
  $('feedback').classList.toggle('error',error);
  $('connection').textContent=message;
  $('connection-dot').classList.toggle('online',!error&&!!current);
  $('hosted-xr-status').textContent=message;
};
let view=null;
let startupError=null;
const sidebar=$('toggle-sidebar');
sidebar.addEventListener('click',()=>{
  const expanded=sidebar.getAttribute('aria-expanded')==='true';
  sidebar.setAttribute('aria-expanded',String(!expanded));
  sidebar.textContent=expanded?'Show details':'Hide details';
});
try{
  view=new MatrixView($('view'),world,()=>{},()=>'',message=>feedback(message,true),
    ()=>{},()=>{},()=>{},()=>{},()=>{},()=>{},()=>{},
    {readOnly:true});
  view.sync();
  view.setObservationStale(true);
}catch(error){
  startupError=error;
  feedback(`Hosted viewer could not start: ${error.message}`,true);
  console.error('Hosted viewer startup failed',error);
}
function renderObservation(){
  $('world-id').textContent=current.worldId;
  $('clock-tick').textContent=String(current.clockTick);
  $('observation-sequence').textContent=`${current.instanceId.slice(0,8)} · ${current.sequence}`;
  const residents=new Map(world.citizens.residents.map(item=>[item.id,item]));
  $('residents').replaceChildren(...['ada','bo'].map(id=>{
    const item=document.createElement('li'),resident=residents.get(id);
    const activity=resident.activity?
      `${resident.activity.phase==='travel'?'Going to':'Using'} ${resident.activity.kind}`:
      'Choosing next activity';
    item.textContent=`${resident.name} · ${activity} · object ${resident.objectId.slice(0,8)}`;
    return item;
  }));
}
async function poll(run){
  if(run!==generation||!token)return;
  try{
    const response=await fetch('/api/web/hosted/observe',{method:'GET',
      headers:{Authorization:`Bearer ${token}`},cache:'no-store',credentials:'omit',
      redirect:'error',signal:AbortSignal.timeout(8000)});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||`Observation returned HTTP ${response.status}`);
    if(run!==generation)return;
    const accepted=applyHostedObservation(world,data,current);
    current=accepted.state;
    if(accepted.changed){
      if(rendered&&!accepted.structureChanged)view.syncObservedTransforms();
      else view.sync();
      rendered=true;
      if(!xrInitialized){
        xrInitialized=true;
        view.initXR($('xr-buttons')).catch(error=>feedback(error.message,true));
      }
    }
    view.setObservationStale(false);
    renderObservation();
    feedback(`Hosted world online · saved tick ${current.clockTick}`);
  }catch(error){
    if(run===generation){
      view.setObservationStale(true);
      feedback(`Hosted observation stale: ${error.message}`,true);
    }
  }finally{
    if(run===generation)pollTimer=setTimeout(()=>poll(run),1000);
  }
}
$('connect').addEventListener('click',()=>{
  if(startupError||!view){feedback(`Hosted viewer could not start: ${startupError?.message||'unknown error'}`,true);return;}
  if(view.renderer.xr.isPresenting){feedback('Leave XR before connecting to another hosted world.',true);return;}
  const next=$('view-token').value.trim();
  if(next.length<24){feedback('Enter the separate world view token.',true);return;}
  $('view-token').value='';
  token=next;current=null;rendered=false;
  view.setObservationStale(true);
  clearTimeout(pollTimer);
  generation++;
  feedback('Connecting to the hosted world…');
  void poll(generation);
});
$('view-token').addEventListener('keydown',event=>{if(event.key==='Enter')$('connect').click();});
$('xr-exit').addEventListener('click',()=>view?.exitXR());
