export class MatrixBridge {
  constructor(world, getToken, onUpdate) {
    this.world=world; this.getToken=getToken; this.onUpdate=onUpdate;
    this.clientId=sessionStorage.getItem('matrix-web-client-id')||crypto.randomUUID().replaceAll('-','');
    sessionStorage.setItem('matrix-web-client-id',this.clientId);
    this.receipts=new Map(); this.running=false; this.timer=null;this.inFlight=false;this.exchangePaused=false;this.lastExchange=0;this.getViewer=()=>null;
    this.getCapture=null;this.captureInFlight=false;this.captureReceipt=null;
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
    for(const result of sent)this.receipts.delete(result.requestId);
    if(this.captureReceipt===sentCapture)this.captureReceipt=null;
    let changed=false;
    for(const command of data.commands||[]) {
      if(this.receipts.has(command.requestId))continue;
      const result=this.world.execute(command);
      this.receipts.set(command.requestId,result); changed=changed||result.ok;
      this.onUpdate({type:'receipt',result});
    }
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
    if(!this.running)throw Error('Operator connection is not started');
    const restoringWorld=arguments.length>0;
    if(restoringWorld&&(!Number.isSafeInteger(worldRestoreExpectedRevision)||worldRestoreExpectedRevision<0))
      throw Error('PC world restore has no valid scene revision');
    while(this.inFlight)await new Promise(resolve=>setTimeout(resolve,25));
    this.inFlight=true;this.lastExchange=performance.now();
    try{await this.exchange(this.getViewer(),restoringWorld?worldRestoreExpectedRevision:null);}
    catch(error){this.onUpdate({type:'connection',online:false,error:error.message});throw error;}
    finally{this.inFlight=false;}
  }
  async withExclusiveExchange(action){
    if(!this.running||this.exchangePaused)throw Error('Operator exchange is unavailable for PC world restore');
    this.exchangePaused=true;
    try{
      while(this.inFlight)await new Promise(resolve=>setTimeout(resolve,25));
      return await action();
    }finally{this.exchangePaused=false;}
  }
  start(getViewer,getCapture=null) {
    this.getViewer=getViewer;this.getCapture=getCapture;this.running=true;this.tick(true);
    this.timer=setInterval(()=>this.tick(),650);
  }
  stop(){this.running=false;if(this.timer)clearInterval(this.timer);}
}
