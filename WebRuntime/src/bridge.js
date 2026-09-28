const validRequestId=value=>typeof value==='string'&&value.length>0&&
  value.length<=128&&!/[\x00-\x1f]/.test(value);
const READ_ONLY_OPS=new Set(['get_scene','get_environment','list_assets','list_targets','inspect_entity',
  'list_world_archives']);
const WORLD_SLOT_OPS=new Set(['list_world_archives','start_new_world','restore_world_archive']);

export class MatrixBridge {
  constructor(world, getToken, onUpdate) {
    this.world=world; this.getToken=getToken; this.onUpdate=onUpdate;
    this.clientId=sessionStorage.getItem('matrix-web-client-id')||crypto.randomUUID().replaceAll('-','');
    sessionStorage.setItem('matrix-web-client-id',this.clientId);
    this.receipts=new Map();this.recentReceipts=new Map();this.receiptWaiters=new Map();
    this.commandGuards=new Map();
    this.running=false; this.timer=null;this.inFlight=false;this.exchangePaused=false;this.rejectPendingOnNextExchange=false;this.lastExchange=0;this.getViewer=()=>null;
    this.getCapture=null;this.captureInFlight=false;this.captureReceipt=null;
    this.onWorldSlotCommand=null;
    this.prepareEnvironment=async()=>{};
    this.getCaptureCapabilities=()=>({modes:['virtual'],device:'Matrix WebXR',
      mixedStatus:'permission_required',reason:'Environment camera has not been tested in this browser.',
      depthOcclusion:false});
  }
  async request(path, body) {
    const headers={}; const token=this.getToken();
    if(token)headers.Authorization=`Bearer ${token}`;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);
    return data;
  }
  async exchange(viewer,worldRestoreExpectedRevision=null) {
    const sent=[...this.receipts.values()];
    const sentCapture=this.captureReceipt;
    const data=await this.request('/api/exchange',{clientId:this.clientId,snapshot:this.world.snapshot(viewer),results:sent,
      captureSupported:!!this.getCapture,
      captureCapabilities:this.getCapture?this.getCaptureCapabilities():
        {modes:[],device:'Matrix WebXR',mixedStatus:'unsupported',reason:'No capture renderer',depthOcclusion:false},
      ...(sentCapture?{capture:sentCapture}:{}),
      ...(worldRestoreExpectedRevision===null?{}:{worldRestoreExpectedRevision})});
    if(worldRestoreExpectedRevision!==null&&data.commands?.length)
      throw Error('A command arrived during PC world restore; retry after the command finishes');
    // After a saved-world reload, an old command may already be reflected in
    // the restored browser copy even though its receipt never reached the PC.
    // Reject commands from the first successful exchange to avoid replaying it.
    const rejectPending=this.rejectPendingOnNextExchange;
    for(const result of sent)this.receipts.delete(result.requestId);
    if(this.captureReceipt===sentCapture)this.captureReceipt=null;
    let changed=false;
    let worldSwitched=false;
    let dependencyPreflightUsed=false;
    const completed=new Map(sent.map(result=>[result.requestId,result]));
    const apply=async operation=>{
      const guard=()=>{
        try{this.commandGuards.get(operation.requestId)?.(operation);return null;}
        catch(error){return {requestId:operation.requestId,ok:false,
          error:String(error?.message||error).slice(0,1000),objectId:''};}
      };
      const initialGuardFailure=guard();
      if(initialGuardFailure)return initialGuardFailure;
      if(!WORLD_SLOT_OPS.has(operation.op)){
        try{
          const environment=operation.op==='set_environment'?operation.environment:
            operation.op==='load'?operation.scene?.environment:
            operation.op==='undo'?this.world.undo.at(-1)?.scene.environment:
            operation.op==='redo'?this.world.redo.at(-1)?.scene.environment:null;
          if(environment){
            dependencyPreflightUsed=true;
            // Local desktop/XR edits can execute while uncached panorama bytes
            // are fetched. Never replay a different history entry or replace a
            // newer authored scene after that wait. Citizens motion is not an
            // authored edit and may continue while the dependency loads.
            const world=this.world,history=operation.op==='redo'?world.redo:world.undo;
            const scene=world.scene,generation=world.authoredGeneration;
            const historyLength=history.length,historyTop=history.at(-1);
            await this.prepareEnvironment(environment);
            if(this.world!==world||world.scene!==scene||
               world.authoredGeneration!==generation||
               history!==(operation.op==='redo'?world.redo:world.undo)||
               (operation.op==='undo'||operation.op==='redo'||operation.op==='load')&&
               (history.length!==historyLength||history.at(-1)!==historyTop))
              return {requestId:operation.requestId,ok:false,
                error:'World changed during panorama loading; inspect the current scene before retrying',
                objectId:''};
            const refreshedGuardFailure=guard();
            if(refreshedGuardFailure)return refreshedGuardFailure;
          }
        }catch(error){return {requestId:operation.requestId,ok:false,
          error:`Panorama dependency unavailable: ${String(error?.message||error).slice(0,900)}`,
          objectId:''};}
        return this.world.execute(operation);
      }
      try{
        if(!this.onWorldSlotCommand)throw Error('Browser world archive controls are unavailable');
        if(operation.op==='restore_world_archive')dependencyPreflightUsed=true;
        const outcome=await this.onWorldSlotCommand(operation);
        return {requestId:operation.requestId,ok:true,error:'',objectId:'',outcome};
      }catch(error){
        return {requestId:operation.requestId,ok:false,
          error:String(error?.message||error).slice(0,1000),objectId:''};
      }
    };
    for(const command of data.commands||[]) {
      // A panorama fetch/decode can use most of the runtime's 15-second lease.
      // Send its receipt on the next exchange before starting another such
      // dependency. The PC retains unacknowledged commands in order.
      if(dependencyPreflightUsed)break;
      if(this.receipts.has(command.requestId))continue;
      let result;
      if(rejectPending||worldSwitched)
        result={requestId:command.requestId,ok:false,
          error:worldSwitched?'World changed during this command batch; inspect the new world before retrying':
            'Command outcome unknown after saved-world recovery; inspect the restored scene before retrying',objectId:''};
      else if(Object.hasOwn(command,'requiresSuccessOf')){
        const predecessor=command.requiresSuccessOf;
        if(!validRequestId(predecessor)||predecessor===command.requestId)
          result={requestId:command.requestId,ok:false,error:'Invalid requiresSuccessOf precondition',objectId:''};
        else if(!completed.get(predecessor)?.ok)
          result={requestId:command.requestId,ok:false,
            error:`Skipped because prerequisite command ${predecessor} did not succeed`,objectId:''};
        else {
          const {requiresSuccessOf,...operation}=command;
          result=await apply(operation);
        }
      }else result=await apply(command);
      this.receipts.set(command.requestId,result);
      this.commandGuards.delete(command.requestId);
      this.recentReceipts.set(command.requestId,result);
      while(this.recentReceipts.size>64)this.recentReceipts.delete(this.recentReceipts.keys().next().value);
      const waiters=this.receiptWaiters.get(command.requestId)||[];
      this.receiptWaiters.delete(command.requestId);
      for(const waiter of waiters)waiter(result);
      if(result.ok&&(command.op==='start_new_world'||command.op==='restore_world_archive'))
        worldSwitched=true;
      changed=changed||(result.ok&&!READ_ONLY_OPS.has(command.op));
      completed.set(command.requestId,result);
      this.onUpdate({type:'receipt',result});
    }
    if(rejectPending)this.rejectPendingOnNextExchange=false;
    if(worldSwitched)this.rejectPendingOnNextExchange=true;
    if(changed)this.onUpdate({type:'scene'});
    if(data.capture&&this.getCapture&&!this.captureInFlight&&!this.captureReceipt){
      this.captureInFlight=true;
      Promise.resolve().then(()=>this.getCapture(data.capture,this.clientId)).then(result=>{
        this.captureReceipt=result;
      }).catch(error=>{
        this.captureReceipt={captureId:data.capture.captureId,revision:data.capture.revision,clientId:this.clientId,
          ok:false,error:String(error.message||error).slice(0,1000)};
      }).finally(()=>{this.captureInFlight=false;this.tick(true);});
    }
    this.onUpdate({type:'connection',online:true});
  }
  async tick(force=false){
    if(!this.running||this.exchangePaused||this.inFlight||(!force&&performance.now()-this.lastExchange<650))return;
    this.inFlight=true;this.lastExchange=performance.now();
    try{await this.exchange(this.getViewer());}
    catch(error){this.onUpdate({type:'connection',online:false,error:error.message});}
    finally{this.inFlight=false;}
  }
  async sync(worldRestoreExpectedRevision){
    return this._sync(false,arguments.length>0,worldRestoreExpectedRevision);
  }
  async _sync(exclusive,restoringWorld,worldRestoreExpectedRevision){
    if(!this.running)throw Error('Operator connection is not started');
    if(restoringWorld&&(!Number.isSafeInteger(worldRestoreExpectedRevision)||worldRestoreExpectedRevision<0))
      throw Error('PC world restore has no valid scene revision');
    while(this.inFlight||(this.exchangePaused&&!exclusive))
      await new Promise(resolve=>setTimeout(resolve,25));
    this.inFlight=true;this.lastExchange=performance.now();
    try{await this.exchange(this.getViewer(),restoringWorld?worldRestoreExpectedRevision:null);}
    catch(error){this.onUpdate({type:'connection',online:false,error:error.message});throw error;}
    finally{this.inFlight=false;}
  }
  waitForReceipt(requestId,{timeoutMs=15000}={}){
    if(!validRequestId(requestId))return Promise.reject(Error('Invalid Matrix request ID'));
    const existing=this.recentReceipts.get(requestId);
    if(existing)return Promise.resolve(existing);
    return new Promise((resolve,reject)=>{
      const waiter=result=>{clearTimeout(timer);resolve(result);};
      const timer=setTimeout(()=>{
        const list=this.receiptWaiters.get(requestId)||[];
        const remaining=list.filter(item=>item!==waiter);
        if(remaining.length)this.receiptWaiters.set(requestId,remaining);
        else this.receiptWaiters.delete(requestId);
        reject(Error(`Matrix request ${requestId} has no browser receipt yet; inspect its status before retrying`));
      },timeoutMs);
      this.receiptWaiters.set(requestId,[...(this.receiptWaiters.get(requestId)||[]),waiter]);
    });
  }
  guardCommand(requestId,guard){
    if(!validRequestId(requestId)||typeof guard!=='function')throw Error('Invalid Matrix command guard');
    this.commandGuards.set(requestId,guard);
  }
  async withExclusiveExchange(action){
    if(!this.running||this.exchangePaused)throw Error('Operator exchange is unavailable for PC world restore');
    this.exchangePaused=true;
    try{
      while(this.inFlight)await new Promise(resolve=>setTimeout(resolve,25));
      return await action(revision=>this._sync(true,true,revision));
    }finally{this.exchangePaused=false;}
  }
  start(getViewer,getCapture=null) {
    this.getViewer=getViewer;this.getCapture=getCapture;this.running=true;this.tick(true);
    this.timer=setInterval(()=>this.tick(),650);
  }
  stop(){this.running=false;if(this.timer)clearInterval(this.timer);}
}
