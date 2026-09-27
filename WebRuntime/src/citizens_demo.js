import './citizens.css';
import * as THREE from 'three';
import {MatrixView} from './view.js';
import {createCitizensDemo} from './citizens.js';
import {makeCitizensWorld,saveCitizensCheckpoint,loadCitizensCheckpoint} from './citizens_store.js';

const $=id=>document.getElementById(id);
const palette=['#71c5ef','#f1a878','#b6df83','#d4a2ed'];
const needLabels={hunger:'Fullness',energy:'Energy',fun:'Fun'};
const stationLabels={rest:'Chair · Rest',eat:'Table · Eat'};
const tickIntervalMs=500;
let world,simulation,view,autosave=true;

function setFeedback(message,error=false){
  $('feedback').textContent=message;
  $('feedback').classList.toggle('error',error);
}

function seedFromInput(){
  const seed=Number($('seed').value);
  if(!Number.isSafeInteger(seed)||seed<1||seed>0xffffffff)
    throw Error('Enter a whole-number seed from 1 to 4294967295.');
  return seed;
}

function newSimulation(seed,{autoRun=false}={}){
  const nextWorld=makeCitizensWorld(seed);
  const nextSimulation=createCitizensDemo(nextWorld,{seed});
  if(autoRun)nextSimulation.resume();
  return {world:nextWorld,simulation:nextSimulation};
}

function makeNameSprite(name,color){
  const canvas=document.createElement('canvas');
  canvas.width=320;canvas.height=80;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#09202ddc';ctx.beginPath();ctx.roundRect(3,3,314,74,16);ctx.fill();
  ctx.strokeStyle=color;ctx.lineWidth=5;ctx.stroke();
  ctx.fillStyle='#f2ffff';ctx.font='bold 38px sans-serif';ctx.textAlign='center';
  ctx.textBaseline='middle';ctx.fillText(name,160,42,270);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false}));
  sprite.position.y=1.05;sprite.scale.set(.66,.165,1);
  sprite.userData.ownedTexture=true;
  return sprite;
}

function decorateResidents(){
  const state=simulation.snapshot();
  state.residents.forEach((resident,index)=>{
    const root=view.objectRoots.get(resident.objectId);
    if(!root)return;
    const color=palette[index%palette.length];
    root.userData.visual.traverse(node=>{
      if(!node.isMesh)return;
      node.material.color?.set(color);
      node.material.emissive?.set(color).multiplyScalar(.16);
    });
    const marker=new THREE.Group();
    const body=new THREE.MeshStandardMaterial({color,roughness:.5,metalness:.05});
    const face=new THREE.MeshStandardMaterial({color:'#14323c',roughness:.8});
    const head=new THREE.Mesh(new THREE.SphereGeometry(.145,18,14),body);
    head.position.set(0,.67,0);marker.add(head);
    for(const x of [-.055,.055]){
      const eye=new THREE.Mesh(new THREE.SphereGeometry(.013,8,8),face);
      eye.position.set(x,.69,.138);marker.add(eye);
    }
    for(const side of [-1,1]){
      const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.036,.19,4,8),body);
      arm.position.set(side*.295,.32,0);arm.rotation.z=side*.32;marker.add(arm);
      const foot=new THREE.Mesh(new THREE.SphereGeometry(.075,10,8),face);
      foot.scale.set(1,.45,1.4);foot.position.set(side*.12,.035,.07);marker.add(foot);
    }
    marker.add(makeNameSprite(resident.name,color));
    root.add(marker);
  });
}

function frameWorld(){
  const positions=world.scene.objects.map(object=>object.transform.position);
  const xs=positions.map(position=>position.x),zs=positions.map(position=>position.z);
  const centerX=(Math.min(...xs)+Math.max(...xs))/2;
  const centerZ=(Math.min(...zs)+Math.max(...zs))/2;
  const span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs));
  view.camera.position.set(centerX,Math.max(2,span*.48),centerZ+Math.max(4.1,span*.95));
  view.camera.lookAt(centerX,.35,centerZ);
}

function syncResidentPoses(state){
  for(const resident of state.residents){
    const root=view.objectRoots.get(resident.objectId);
    const object=world.scene.objects.find(item=>item.objectId===resident.objectId);
    if(root&&object)root.position.set(object.transform.position.x,object.transform.position.y,object.transform.position.z);
  }
}

function needItem(name,value){
  const fraction=Math.max(0,Math.min(100,Number(value)||0));
  const item=document.createElement('div');
  const label=document.createElement('div');label.className='need-label';
  const title=document.createElement('span');title.textContent=needLabels[name]||name;
  const number=document.createElement('span');number.textContent=`${Math.round(fraction)}%`;
  label.append(title,number);
  const track=document.createElement('div');track.className='need-meter';
  const fill=document.createElement('span');
  fill.style.setProperty('--level',`${fraction}%`);
  fill.style.setProperty('--bar-color',fraction<30?'#ef9d82':fraction<55?'#ebc779':'#66d6ac');
  track.append(fill);item.append(label,track);
  return item;
}

function renderResidents(state){
  const cards=state.residents.map((resident,index)=>{
    const card=document.createElement('article');card.className='resident-card';
    card.style.setProperty('--resident-color',palette[index%palette.length]);
    const top=document.createElement('div');top.className='resident-top';
    const name=document.createElement('div');name.className='resident-name';
    const dot=document.createElement('span');dot.className='resident-dot';dot.setAttribute('aria-hidden','true');
    name.append(dot,document.createTextNode(resident.name));
    const identity=document.createElement('span');identity.className='subtle';identity.textContent=resident.id;
    top.append(name,identity);
    const meta=document.createElement('div');meta.className='resident-meta';
    const activity=document.createElement('span');activity.className='resident-activity';
    activity.textContent=resident.activity?`${resident.activity.phase==='travel'?'Going to':'Using'} ${resident.activity.kind}`:'Choosing next activity';
    const destination=document.createElement('span');
    destination.textContent=resident.activity?.stationId||'';
    meta.append(activity,destination);
    const needs=document.createElement('div');needs.className='needs';
    for(const key of ['hunger','energy','fun'])needs.append(needItem(key,resident.needs[key]));
    card.append(top,meta,needs);
    if(resident.lastOutcome){const outcome=document.createElement('p');outcome.className='resident-outcome';outcome.textContent=resident.lastOutcome;card.append(outcome);}
    return card;
  });
  $('residents').replaceChildren(...cards);
}

function renderStations(state){
  const nodes=state.stations.map(station=>{
    const item=document.createElement('div');item.className='station';
    const title=document.createElement('div');
    const heading=document.createElement('strong');heading.textContent=stationLabels[station.kind]||station.kind;
    const caption=document.createElement('small');caption.textContent=`Capacity ${station.capacity}`;
    title.append(heading,caption);
    const status=document.createElement('span');status.className='station-status';
    const holder=state.residents.find(resident=>resident.id===station.holder);
    status.textContent=holder?`Reserved by ${holder.name}`:'Available';
    status.classList.toggle('busy',!!holder);
    item.append(title,status);return item;
  });
  $('stations').replaceChildren(...nodes);
}

function renderLog(state){
  const latest=state.log.at(-1);
  $('latest-event').textContent=latest?`Latest · m ${latest.tick} · ${latest.message}`:
    'Latest · Run the world to see an observed action.';
  const entries=state.log.slice(-14).reverse().map(entry=>{
    const row=document.createElement('li');
    const time=document.createElement('time');time.textContent=`m ${entry.tick}`;
    const detail=document.createElement('div');
    const kind=document.createElement('span');kind.className='event-kind';kind.textContent=`${entry.event.toUpperCase()} · `;
    detail.append(kind,document.createTextNode(entry.message));row.append(time,detail);return row;
  });
  if(!entries.length){const empty=document.createElement('li');empty.className='empty';empty.textContent='Run or step the world to see decisions and observed outcomes.';entries.push(empty);}
  $('event-log').replaceChildren(...entries);
}

function render(state=simulation.snapshot()){
  const day=Math.floor(state.clockTick/1440)+1;
  const minute=state.clockTick%1440;
  $('clock').textContent=`Day ${day} · ${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  $('tick-count').textContent=`Tick ${state.clockTick}`;
  $('run-state').textContent=state.paused?'Paused':'Running';
  $('run-state').parentElement.classList.toggle('paused',state.paused);
  $('toggle-run').textContent=state.paused?'Run':'Pause';
  $('step').disabled=!state.paused;
  renderResidents(state);renderStations(state);renderLog(state);
  syncResidentPoses(state);
}

function attach(next){
  world=next.world;simulation=next.simulation;
  view.world=world;view.sync();decorateResidents();frameWorld();
  $('seed').value=String(simulation.snapshot().seed);
  render();
}

function save(silent=false){
  try{
    saveCitizensCheckpoint(localStorage,world,simulation);
    if(!silent)setFeedback(`Saved minute ${simulation.snapshot().clockTick} in this browser.`);
    return true;
  }catch(error){
    autosave=false;
    setFeedback(`Save failed: ${error.message}. The current world is still running in this tab.`,true);
    return false;
  }
}

let startup,restored=false;
try{startup=loadCitizensCheckpoint(localStorage);restored=!!startup;}
catch(error){autosave=false;setFeedback(`Saved Citizens world was rejected: ${error.message}. Reset seed to replace it.`,true);}
if(!startup){
  startup=newSimulation(29,{autoRun:true});
  if(autosave)setFeedback('New seeded world started. Two residents will choose activities.');
}
world=startup.world;simulation=startup.simulation;
view=new MatrixView($('view'),world,()=>{},()=>'',message=>setFeedback(message,true));
const originalPointerDown=view.pointerDown.bind(view);
view.pointerDown=event=>{if(event.button===2)originalPointerDown(event);};
view.sync();decorateResidents();frameWorld();
$('seed').value=String(simulation.snapshot().seed);
render();
if(restored)
  setFeedback(`Resumed saved world at minute ${simulation.snapshot().clockTick}.`);

$('reset').addEventListener('click',()=>{
  try{
    const next=newSimulation(seedFromInput());
    attach(next);autosave=true;save(true);
    setFeedback(`Reset seed ${simulation.snapshot().seed}. Press Run to start both residents.`);
  }catch(error){setFeedback(error.message,true);}
});
$('toggle-run').addEventListener('click',()=>{
  const state=simulation.snapshot();
  state.paused?simulation.resume():simulation.pause();
  render();if(autosave)save(true);
  setFeedback(simulation.snapshot().paused?'Simulation paused.':'Simulation running.');
});
$('step').addEventListener('click',()=>{
  simulation.step();render();if(autosave)save(true);
  setFeedback(`Advanced to minute ${simulation.snapshot().clockTick}.`);
});
$('save').addEventListener('click',()=>{autosave=true;save();});
$('load').addEventListener('click',()=>{
  try{
    const next=loadCitizensCheckpoint(localStorage);
    if(!next){setFeedback('No Citizens checkpoint is saved in this browser.',true);return;}
    attach(next);autosave=true;
    setFeedback(`Loaded saved world at minute ${simulation.snapshot().clockTick}.`);
  }catch(error){setFeedback(`Saved world was rejected: ${error.message}. Current world was kept.`,true);}
});

setInterval(()=>{
  if(document.hidden||simulation.snapshot().paused)return;
  simulation.advance();render();
  if(autosave)save(true);
},tickIntervalMs);
addEventListener('beforeunload',()=>{if(autosave)save(true);});
