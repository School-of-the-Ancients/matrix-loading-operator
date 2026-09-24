import './style.css';
import {MatrixWorld} from './protocol.js';
import {MatrixView} from './view.js';
import {MatrixBridge} from './bridge.js';

const $=id=>document.getElementById(id);
const world=new MatrixWorld();
let pendingScene=null;
try {pendingScene=JSON.parse(sessionStorage.getItem('matrix-web-scene')||'null');}
catch {sessionStorage.removeItem('matrix-web-scene');}

let proposal=null;
const feedback=(message,isError=false)=>{$('feedback').textContent=message;$('feedback').classList.toggle('error',isError);};
const view=new MatrixView($('view'),world,()=>{proposal=null;$('proposal').classList.add('hidden');feedback(`Selected ${world.selection.objectId||'placement point'} at ${Object.values(world.selection.position).join(', ')} m.`);},()=>$('token').value.trim(),message=>feedback(message,true));
view.sync();
view.initXR($('xr-buttons')).catch(e=>feedback(e.message,true));

function renderScene(){view.sync();$('object-count').textContent=`${world.scene.objects.length} object${world.scene.objects.length===1?'':'s'}`;if(!pendingScene)sessionStorage.setItem('matrix-web-scene',JSON.stringify(world.scene));}
renderScene();
const bridge=new MatrixBridge(world,()=>$('token').value.trim(),event=>{
  if(event.type==='scene')renderScene();
  if(event.type==='connection'){
    $('connection').textContent=event.online?'Operator connected':event.error||'Operator unavailable';
    $('connection-dot').classList.toggle('online',event.online);
  }
  if(event.type==='receipt')feedback(event.result.ok?`Applied ${event.result.requestId.slice(0,8)}${event.result.objectId?` · ${event.result.objectId.slice(0,8)}`:''}`:`Command failed: ${event.result.error}`,!event.result.ok);
});
async function refreshAssets(silent=false){
  try{
    const data=await bridge.request('/api/web/assets');world.registerAssets(data.assets||[]);
    $('asset-count').textContent=`${7+world.externalAssets.length} available`;
    if(pendingScene){
      try{world.validateScene(pendingScene);world.scene=pendingScene;pendingScene=null;renderScene();}
      catch(error){if(!silent)feedback(`Saved tab scene unavailable: ${error.message}`,true);}
    }
    if(!silent)feedback(`Catalog updated: ${world.externalAssets.length} web assets.`);
  }catch(error){if(!silent)feedback(error.message,true);}
}
bridge.start(()=>view.viewer());
refreshAssets(true);
setInterval(()=>refreshAssets(true),10000);
addEventListener('beforeunload',()=>bridge.stop());

async function call(path,body,success){
  try{const data=await bridge.request(path,body);if(success)feedback(success);return data;}
  catch(error){feedback(error.message,true);return null;}
}
async function refreshScenes(){
  const data=await call('/api/scenes');if(!data)return;
  const select=$('saved-scenes'),current=select.value;select.replaceChildren(new Option('Saved scenes',''));
  for(const name of data.scenes||[])select.add(new Option(name,name));select.value=current;
}
async function propose(){
  const text=$('prompt').value.trim();if(!text){feedback('Enter a request first.',true);return;}
  $('propose').disabled=true;feedback('Planning…');
  const data=await call('/api/plan',{text,mode:$('mode').value});$('propose').disabled=false;
  if(!data)return;
  proposal=data.requiresApply?data:null;
  $('proposal').classList.toggle('hidden',!proposal);
  $('proposal-summary').textContent=data.summary||data.message||data.status||'Review the exact commands.';
  $('proposal-commands').textContent=JSON.stringify(data.commands||[],null,2);
  feedback(proposal?'Review the proposal, then Apply.':data.message||'No scene edits proposed.');
}
$('propose').addEventListener('click',propose);
$('prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey))propose();});
$('discard').addEventListener('click',()=>{proposal=null;$('proposal').classList.add('hidden');feedback('Proposal discarded.');});
$('apply').addEventListener('click',async()=>{
  if(!proposal?.planId)return;
  const data=await call('/api/apply_plan',{planId:proposal.planId},'Proposal queued for runtime.');
  if(data){proposal=null;$('proposal').classList.add('hidden');}
});
for(const op of ['undo','redo','clear'])$(op).addEventListener('click',()=>call('/api/command',{op},`${op} queued.`));
$('save').addEventListener('click',async()=>{
  const name=$('save-name').value.trim();if(!name){feedback('Enter a scene name.',true);return;}
  const data=await call('/api/save',{name},`Saved ${name}.`);if(data)refreshScenes();
});
$('restore').addEventListener('click',async()=>{
  const name=$('saved-scenes').value;if(!name){feedback('Choose a saved scene.',true);return;}
  await call('/api/load',{name},`Restore of ${name} queued.`);
});
$('mode').addEventListener('change',()=>{proposal=null;$('proposal').classList.add('hidden');});
$('refresh-assets').addEventListener('click',()=>refreshAssets());
$('token').addEventListener('change',()=>refreshAssets());
refreshScenes();
