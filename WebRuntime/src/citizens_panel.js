// Opt-in Citizens controls for the ordinary Matrix Web world. The simulation
// chooses intentions; MatrixWorld remains the executor and scene owner.
import {CitizensSimulation,createCitizensDemo} from './citizens.js';

const byId=id=>document.getElementById(id);
const intervalMs=500;

export class CitizensPanel {
  constructor(world,{onChange,canStart,onFeedback}){
    this.world=world;
    this.onChange=onChange;
    this.canStart=canStart;
    this.onFeedback=onFeedback;
    this.simulation=null;
    this.boundState=null;
    this.error='';
    this.stopArmedUntil=0;
    byId('citizens-start').addEventListener('click',()=>this.start());
    byId('citizens-toggle').addEventListener('click',()=>this.toggle());
    byId('citizens-step').addEventListener('click',()=>this.step());
    byId('citizens-stop').addEventListener('click',()=>this.stop());
    this.timer=setInterval(()=>this.tick(),intervalMs);
    this.syncFromWorld();
  }

  commit(){
    this.world.citizens=this.simulation?.snapshot()||null;
    this.boundState=this.world.citizens;
    this.render();
    this.onChange();
  }

  syncFromWorld(){
    if(this.world.spatial){
      if(this.simulation){
        this.simulation.pause();
        this.world.citizens=this.simulation.snapshot();
        this.boundState=this.world.citizens;
        this.simulation=null;
      }
      this.error=this.world.citizens?
        'Citizens is paused in AR. Return to the desktop virtual room to resume.':'';
      this.render();
      return;
    }
    if(!this.world.citizens){
      this.simulation=null;this.boundState=null;this.error='';this.render();return;
    }
    if(this.world.citizens!==this.boundState||!this.simulation){
      try{
        this.simulation=CitizensSimulation.restore(this.world,this.world.citizens);
        this.boundState=this.world.citizens;
        this.error='';
      }catch(error){
        this.simulation=null;this.boundState=this.world.citizens;
        this.error=`Simulation bindings need recovery: ${error.message}`;
      }
    }else{
      try{
        const before=JSON.stringify(this.world.citizens);
        const next=this.simulation.reconcileWorld();
        if(JSON.stringify(next)!==before){
          this.world.citizens=next;this.boundState=next;
          this.onFeedback('Citizens paused after an external world edit. Inspect the log before resuming.');
        }
        this.error=this.simulation.invalidBindings.size?
          'A Citizens object is missing or incompatible. Undo the edit, or stop Citizens to keep the edited scene. The last valid browser save was kept.':'';
      }catch(error){
        this.simulation.pause();
        this.world.citizens=this.simulation.snapshot();
        this.boundState=this.world.citizens;
        this.error=`Simulation bindings need recovery: ${error.message}`;
      }
    }
    this.render();
  }

  start(){
    const blocked=this.canStart();
    if(blocked){this.onFeedback(blocked,true);this.render();return;}
    const seed=Number(byId('citizens-seed').value);
    if(!Number.isSafeInteger(seed)||seed<1||seed>0xffffffff){
      this.onFeedback('Enter a whole-number Citizens seed from 1 to 4294967295.',true);return;
    }
    try{
      this.simulation=createCitizensDemo(this.world,{seed});
      this.error='';this.commit();
      this.onFeedback('Two residents were added to this Matrix world. Press Run to begin.');
    }catch(error){this.onFeedback(`Citizens could not start: ${error.message}`,true);}
  }

  toggle(){
    this.syncFromWorld();
    if(!this.simulation||this.error)return;
    this.simulation.snapshot().paused?this.simulation.resume():this.simulation.pause();
    this.commit();
  }

  step(){
    this.syncFromWorld();
    if(!this.simulation||this.error||!this.simulation.snapshot().paused)return;
    this.simulation.step();this.commit();
  }

  tick(){
    if(document.hidden||!this.simulation||this.world.spatial)return;
    this.syncFromWorld();
    if(!this.simulation||this.error||this.simulation.snapshot().paused)return;
    this.simulation.advance();this.commit();
  }

  pauseForCheckpoint(){
    this.syncFromWorld();
    if(this.simulation&&!this.simulation.snapshot().paused){
      this.simulation.pause();this.commit();
    }
  }

  decorate(view){
    const colors=['#71c5ef','#f1a878'];
    this.simulation?.snapshot().residents.forEach((resident,index)=>{
      const visual=view.objectRoots.get(resident.objectId)?.userData?.visual;
      visual?.traverse(node=>{
        if(!node.isMesh)return;
        node.material.color?.set(colors[index%colors.length]);
        node.material.emissive?.set(colors[index%colors.length]).multiplyScalar(.16);
      });
    });
  }

  stop(){
    if(!this.world.citizens)return;
    if(performance.now()>this.stopArmedUntil){
      this.stopArmedUntil=performance.now()+10000;
      byId('citizens-stop').textContent='Confirm stop';
      this.onFeedback('Click Confirm stop within ten seconds to detach Citizens. Their scene objects stay in the world.');
      return;
    }
    this.stopArmedUntil=0;
    this.simulation=null;this.boundState=null;this.world.citizens=null;this.error='';
    this.render();this.onChange();
    this.onFeedback('Citizens stopped. Their objects remain as ordinary scene objects.');
  }

  render(){
    const state=this.simulation?.snapshot();
    const blocked=this.canStart();
    byId('citizens-start').disabled=!!state||!!this.world.citizens||!!blocked;
    byId('citizens-toggle').disabled=!state||!!this.error||!!this.world.spatial;
    byId('citizens-step').disabled=!state||!!this.error||!state.paused||!!this.world.spatial;
    byId('citizens-stop').disabled=!this.world.citizens;
    if(performance.now()>this.stopArmedUntil)byId('citizens-stop').textContent='Stop Citizens';
    byId('citizens-status').textContent=this.error||(
      state?`${state.paused?'Paused':'Running'} · minute ${state.clockTick} · seed ${state.seed}`:
        this.world.citizens?'Citizens state needs recovery. Undo the edit or stop Citizens.':
          blocked||'No Citizens in this world. Start a seeded scenario on this empty virtual floor.');
    byId('citizens-toggle').textContent=state?.paused?'Run':'Pause';
    const cards=[];
    for(const resident of state?.residents||[]){
      const item=document.createElement('li');
      const action=resident.activity?`${resident.activity.phase==='travel'?'going to':'using'} ${resident.activity.kind}`:'choosing';
      item.textContent=`${resident.name}: ${action} · fullness ${Math.round(resident.needs.hunger)} · energy ${Math.round(resident.needs.energy)} · fun ${Math.round(resident.needs.fun)}${resident.lastOutcome?` · ${resident.lastOutcome}`:''}`;
      cards.push(item);
    }
    byId('citizens-residents').replaceChildren(...cards);
    const stations=(state?.stations||[]).map(station=>{
      const item=document.createElement('li');
      item.textContent=`${station.id}: ${station.holder?`reserved by ${station.holder}`:'available'}`;
      return item;
    });
    byId('citizens-stations').replaceChildren(...stations);
    const log=(state?.log||[]).slice(-6).reverse().map(entry=>{
      const item=document.createElement('li');
      item.textContent=`m ${entry.tick} · ${entry.message}`;
      return item;
    });
    byId('citizens-log').replaceChildren(...log);
  }
}
