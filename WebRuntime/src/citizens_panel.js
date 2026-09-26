// Opt-in Citizens controls for the ordinary Matrix Web world. The simulation
// chooses intentions; MatrixWorld remains the executor and scene owner.
import {CitizensSimulation,createCitizensDemo} from './citizens.js';

const byId=id=>document.getElementById(id);
const intervalMs=500;

export class CitizensPanel {
  constructor(world,{onChange,canStart,onFeedback,canMutate=()=>'',getRecovery=()=>null,
    canRecover=()=>'',onRecover=()=>{throw Error('No recovery action is configured');},
    confirmDurableRecovery=()=>false,clearRecovery=()=>{}}){
    this.world=world;
    this.onChange=onChange;
    this.canStart=canStart;
    this.canMutate=canMutate;
    this.onFeedback=onFeedback;
    this.getRecovery=getRecovery;
    this.canRecover=canRecover;
    this.onRecover=onRecover;
    this.confirmDurableRecovery=confirmDurableRecovery;
    this.clearRecovery=clearRecovery;
    this.simulation=null;
    this.boundState=null;
    this.error='';
    this.stopArmedUntil=0;
    this.recoverArmedUntil=0;
    this.recoverArmedCopy='';
    byId('citizens-start').addEventListener('click',()=>this.start());
    byId('citizens-toggle').addEventListener('click',()=>this.toggle());
    byId('citizens-step').addEventListener('click',()=>this.step());
    byId('citizens-stop').addEventListener('click',()=>this.stop());
    byId('citizens-recover').addEventListener('click',()=>this.recover());
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
    // A PC restore stages its candidate directly on the world until the PC
    // exchange accepts it. Do not bind to or reconcile that temporary state.
    if(this.canMutate()){this.render();return;}
    if(this.world.spatial){
      if(this.simulation){
        this.simulation.pause();
        // The AR session can move virtual-floor objects while this simulation
        // has no live transform baseline. Cancel intentions before detaching it.
        for(const resident of this.simulation.state.residents)
          if(resident.activity||this.simulation.waitingFor(resident))this.simulation.fail(resident,
            'entering AR cancelled the current activity or queued wait');
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
        const previous=this.world.citizens;
        const before=JSON.stringify(this.world.citizens);
        const next=this.simulation.reconcileWorld();
        if(JSON.stringify(next)!==before){
          this.world.citizens=next;this.boundState=next;
          const retired=next.residents.length<previous.residents.length||
            next.stations.length<previous.stations.length;
          let feedback='Citizens paused after an authored world edit. Inspect the log before resuming.';
          if(retired)feedback=next.residents.length===0?
            'Citizens retired the last actor and paused the simulation.':
            next.paused?'Citizens retired a missing actor or resource. Press Run to resume surviving residents.':
              'Citizens retired a missing actor or resource; surviving residents continue.';
          if(this.simulation.invalidBindings.size)
            feedback='Citizens needs binding recovery after a world edit. Inspect the panel.';
          this.onFeedback(feedback);
        }
        this.error=this.simulation.invalidBindings.size?
          'A Citizens object is missing or incompatible. Undo the edit, restore a valid PC world, or stop Citizens to keep the edited scene. The last valid browser save was kept.':'';
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
    const mutationBlocked=this.canMutate();
    if(mutationBlocked){this.onFeedback(mutationBlocked,true);this.render();return;}
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
    if(this.canMutate())return;
    this.syncFromWorld();
    if(!this.simulation||this.error)return;
    this.simulation.snapshot().paused?this.simulation.resume():this.simulation.pause();
    this.commit();
  }

  step(){
    if(this.canMutate())return;
    this.syncFromWorld();
    if(!this.simulation||this.error||!this.simulation.snapshot().paused)return;
    this.simulation.step();this.commit();
  }

  tick(){
    if(this.recoverArmedUntil&&performance.now()>this.recoverArmedUntil){
      this.recoverArmedUntil=0;this.recoverArmedCopy='';this.render();
    }
    if(document.hidden||!this.simulation||this.world.spatial||this.canMutate())return;
    this.syncFromWorld();
    if(!this.simulation||this.error||this.simulation.snapshot().paused)return;
    this.simulation.advance();this.commit();
  }

  pauseForCheckpoint(){
    if(this.canMutate())return;
    this.syncFromWorld();
    if(this.simulation&&!this.simulation.snapshot().paused){
      this.simulation.pause();this.commit();
    }
  }

  decorate(view){
    const colors={ada:'#71c5ef',bo:'#f1a878'};
    this.simulation?.snapshot().residents.forEach((resident,index)=>{
      const visual=view.objectRoots.get(resident.objectId)?.userData?.visual;
      visual?.traverse(node=>{
        if(!node.isMesh)return;
        const color=colors[resident.id]||Object.values(colors)[index%2];
        node.material.color?.set(color);
        node.material.emissive?.set(color).multiplyScalar(.16);
      });
    });
  }

  stop(){
    if(this.canMutate())return;
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

  recover(){
    const blocked=this.canRecover();
    if(blocked||this.world.spatial){
      this.recoverArmedUntil=0;this.recoverArmedCopy='';this.render();
      this.onFeedback(blocked||'Return to the desktop virtual room before restoring Citizens.',true);
      return;
    }
    let copy;
    try{copy=this.getRecovery();}
    catch(error){
      this.recoverArmedUntil=0;this.recoverArmedCopy='';this.render();
      this.onFeedback(`Pre-deletion browser copy is unreadable: ${error.message}`,true);
      return;
    }
    if(!copy){
      this.recoverArmedUntil=0;this.recoverArmedCopy='';this.render();
      this.onFeedback('No pre-deletion browser copy is available.',true);
      return;
    }
    const signature=JSON.stringify(copy);
    const tick=Number.isSafeInteger(copy.citizens?.clockTick)?
      `minute ${copy.citizens.clockTick}`:'the saved minute';
    if(performance.now()>this.recoverArmedUntil||signature!==this.recoverArmedCopy){
      this.recoverArmedUntil=performance.now()+10000;
      this.recoverArmedCopy=signature;
      this.render();
      this.onFeedback(`Click Confirm restore within ten seconds to replace the current scene, game, and Citizens with the pre-deletion browser copy from ${tick}. The manual Save world checkpoint is untouched.`);
      return;
    }
    this.recoverArmedUntil=0;this.recoverArmedCopy='';
    try{this.onRecover(copy);}
    catch(error){
      this.render();
      this.onFeedback(`Pre-deletion world could not be restored: ${error.message}`,true);
      return;
    }
    this.simulation=null;this.boundState=null;this.error='';
    let warning;
    try{warning=this.onChange();}
    catch(error){warning=error.message||String(error);}
    if(warning!==''){
      this.render();
      this.onFeedback(`Restored the pre-deletion world in this tab, but the browser save did not complete cleanly: ${warning||'save status unavailable'}. The recovery copy was kept.`,true);
      return;
    }
    let durableConfirmed=false;
    try{durableConfirmed=this.confirmDurableRecovery();}
    catch{ /* Keep the recovery copy until the durable world can be verified. */ }
    if(!durableConfirmed){
      this.render();
      this.onFeedback('Restored the pre-deletion world in this tab, but the durable browser copy could not be verified. The recovery copy was kept.',true);
      return;
    }
    try{this.clearRecovery();}
    catch(error){
      this.render();
      this.onFeedback(`Restored and saved the pre-deletion world, but the recovery copy could not be cleared: ${error.message}`,true);
      return;
    }
    this.render();
    this.onFeedback(`Restored and saved the pre-deletion world from ${tick}. Review the scene and Citizens status. The manual Save world checkpoint is unchanged.`);
  }

  render(){
    const state=this.simulation?.snapshot();
    const residentNames=new Map((state?.residents||[]).map(resident=>
      [resident.id,resident.name]));
    const waiting=new Map();
    for(const station of state?.stations||[])
      (station.waiters||[]).forEach((waiter,index)=>waiting.set(waiter.residentId,
        {stationId:station.id,executionId:waiter.executionId,position:index+1}));
    const blocked=this.canStart();
    const mutationBlocked=this.canMutate();
    let recovery=null,recoveryError='';
    try{recovery=this.getRecovery();}
    catch(error){recoveryError=error.message||String(error);}
    const recoveryBlocked=this.canRecover();
    const recoveryTick=Number.isSafeInteger(recovery?.citizens?.clockTick)?
      `minute ${recovery.citizens.clockTick}`:'';
    if(!recovery||recoveryBlocked||this.world.spatial){
      this.recoverArmedUntil=0;this.recoverArmedCopy='';
    }
    byId('citizens-start').disabled=!!state||!!this.world.citizens||!!blocked||!!mutationBlocked;
    byId('citizens-toggle').disabled=!state||state.residents.length===0||
      !!this.error||!!this.world.spatial||!!mutationBlocked;
    byId('citizens-step').disabled=!state||state.residents.length===0||
      !!this.error||!state.paused||!!this.world.spatial||!!mutationBlocked;
    byId('citizens-stop').disabled=!this.world.citizens||!!mutationBlocked;
    byId('citizens-recover').disabled=!recovery||!!recoveryBlocked||!!this.world.spatial;
    byId('citizens-recover').textContent=performance.now()<this.recoverArmedUntil&&recovery?
      `Confirm restore ${recoveryTick}`:`Restore ${recoveryTick||'before deletion'}`;
    byId('citizens-recovery-status').textContent=recoveryError?
      `Pre-deletion browser copy is unreadable: ${recoveryError}. The manual Save world checkpoint is separate.`:
      recovery?recoveryBlocked||this.world.spatial?
        `${recoveryBlocked||'Return to the desktop virtual room to restore this copy.'} The manual Save world checkpoint is separate.`:
        `A pre-deletion browser copy from ${recoveryTick||'an earlier tick'} is available. Restoring replaces the current scene, game, and Citizens. The manual Save world checkpoint is untouched.`:
        'No pre-deletion browser copy is available. The manual Save world checkpoint is separate.';
    if(performance.now()>this.stopArmedUntil)byId('citizens-stop').textContent='Stop Citizens';
    byId('citizens-status').textContent=this.error||(
      state?`${state.paused?'Paused':'Running'} · minute ${state.clockTick} · seed ${state.seed}`:
        this.world.citizens?'Citizens state needs recovery. Undo the edit, restore a valid PC world, or stop Citizens.':
          blocked||'No Citizens in this world. Start a seeded scenario on this empty virtual floor.');
    byId('citizens-toggle').textContent=state?.paused?'Run':'Pause';
    const cards=[];
    for(const resident of state?.residents||[]){
      const item=document.createElement('li');
      const queue=waiting.get(resident.id);
      const action=queue?`waiting for ${queue.stationId} · queue #${queue.position} · execution ${queue.executionId}`:
        resident.activity?`${resident.activity.phase==='travel'?'going to':'using'} ${resident.activity.kind} · execution ${resident.activity.executionId}`:'choosing';
      item.textContent=`${resident.name}: ${action} · fullness ${Math.round(resident.needs.hunger)} · energy ${Math.round(resident.needs.energy)} · fun ${Math.round(resident.needs.fun)}${resident.lastOutcome?` · ${resident.lastOutcome}`:''}`;
      cards.push(item);
    }
    for(const id of state?.retiredResidentIds||[]){
      const item=document.createElement('li');
      item.textContent=`${id}: retired · actor object removed from this world`;
      cards.push(item);
    }
    byId('citizens-residents').replaceChildren(...cards);
    const stations=(state?.stations||[]).map(station=>{
      const item=document.createElement('li');
      const claim=station.claim;
      const owner=claim?residentNames.get(claim.residentId)||claim.residentId:null;
      const queue=(station.waiters||[]).map((waiter,index)=>
        `#${index+1} ${residentNames.get(waiter.residentId)||waiter.residentId} (execution ${waiter.executionId})`);
      item.textContent=`${station.id}: ${claim?`claimed by ${owner} · execution ${claim.executionId} · expires m ${claim.expiresTick}`:'available'}${queue.length?` · waiting ${queue.join(' → ')}`:''}`;
      return item;
    });
    if(state)for(const resource of [{id:'chair',kind:'rest'},{id:'food',kind:'eat'}])
      if(!state.stations.some(station=>station.kind===resource.kind)){
        const item=document.createElement('li');
        item.textContent=`${resource.id}: missing · resource object removed; claims and waiters cleared`;
        stations.push(item);
      }
    byId('citizens-stations').replaceChildren(...stations);
    const log=(state?.log||[]).slice(-6).reverse().map(entry=>{
      const item=document.createElement('li');
      item.textContent=`m ${entry.tick} · ${entry.message}`;
      return item;
    });
    byId('citizens-log').replaceChildren(...log);
  }
}
