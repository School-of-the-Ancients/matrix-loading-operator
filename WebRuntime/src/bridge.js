export class MatrixBridge {
  constructor(world, getToken, onUpdate) {
    this.world=world; this.getToken=getToken; this.onUpdate=onUpdate;
    this.clientId=sessionStorage.getItem('matrix-web-client-id')||crypto.randomUUID().replaceAll('-','');
    sessionStorage.setItem('matrix-web-client-id',this.clientId);
    this.receipts=new Map(); this.running=false; this.timer=null;this.inFlight=false;this.lastExchange=0;this.getViewer=()=>null;
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
  async exchange(viewer) {
    const sent=[...this.receipts.values()];
    const data=await this.request('/api/exchange',{clientId:this.clientId,snapshot:this.world.snapshot(viewer),results:sent,captureSupported:false});
    for(const result of sent)this.receipts.delete(result.requestId);
    let changed=false;
    for(const command of data.commands||[]) {
      if(this.receipts.has(command.requestId))continue;
      const result=this.world.execute(command);
      this.receipts.set(command.requestId,result); changed=changed||result.ok;
      this.onUpdate({type:'receipt',result});
    }
    if(changed)this.onUpdate({type:'scene'});
    this.onUpdate({type:'connection',online:true});
  }
  async tick(force=false){
    if(!this.running||this.inFlight||(!force&&performance.now()-this.lastExchange<650))return;
    this.inFlight=true;this.lastExchange=performance.now();
    try{await this.exchange(this.getViewer());}
    catch(error){this.onUpdate({type:'connection',online:false,error:error.message});}
    finally{this.inFlight=false;}
  }
  start(getViewer) {
    this.getViewer=getViewer;this.running=true;this.tick(true);
    this.timer=setInterval(()=>this.tick(),650);
  }
  stop(){this.running=false;if(this.timer)clearInterval(this.timer);}
}
