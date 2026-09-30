// Local, opt-in diagnostics. Never retain request bodies or response content.
const STAGES=new Set(['microphone.acquire','voice.finalize-and-deliver','command.apply',
  'receipts.acknowledged','http.exchange','http.agent.session','http.agent.status',
  'http.agent.turn','http.agent.steer','http.agent.cancel','http.agent.approval',
  'http.agent.transcribe','http.voice.submit','http.voice.status','http.other',
  'submission','frame.visible']);
const SERVICE_STAGES=new Set(['server.request','context.assemble','prompt.build','agent.start',
  'agent.first_tool','agent.completed','approval.wait','speech.transcribe','command.queued','receipt.received']);
const TRACE_ID=/^[0-9a-f]{32}$/;
const ROUTES=new Map([
  ['/api/exchange','http.exchange'],['/api/voice','http.voice.submit'],
  ...['session','status','turn','steer','cancel','approval','transcribe'].map(
    name=>[`/api/agent/${name}`,`http.agent.${name}`]),
]);

export function latencyRequestStage(path){
  return ROUTES.get(path)||(/^\/api\/voice\/[0-9a-f]{32}$/.test(path)?
    'http.voice.status':'http.other');
}

export class LatencyTrace {
  constructor({now=()=>performance.now(),capacity=256}={}){
    if(!Number.isSafeInteger(capacity)||capacity<1||capacity>256)
      throw Error('Trace capacity must be between 1 and 256.');
    this.now=now;this.capacity=capacity;this.records=[];this.sequence=0;this.generation=0;
    this.traceId=crypto.randomUUID().replaceAll('-','');
  }
  begin(stage,{traceId=this.traceId,requestId=null}={}){
    if(!STAGES.has(stage))throw Error('Unknown latency stage.');
    const start=this.now(),id=++this.sequence,generation=this.generation;
    let finished=false;
    return outcome=>{
      if(finished||generation!==this.generation)return;
      finished=true;
      const end=this.now();
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return;
      this.records.push({id,stage,clock:'browser-monotonic',traceId,
        ...(TRACE_ID.test(requestId||'')?{requestId}:{}),outcome:outcome==='ok'?'ok':'failed',
        startedMs:start,durationMs:end-start});
      if(this.records.length>this.capacity)this.records.shift();
    };
  }
  snapshot(){return {schemaVersion:1,clock:'browser-monotonic',
    records:this.records.map(record=>({...record}))};}
  submit(){this.traceId=crypto.randomUUID().replaceAll('-','');this.begin('submission')('ok');}
  ingestService(snapshot){
    if(snapshot?.schemaVersion!==1||snapshot.clock!=='service-monotonic'||
      !TRACE_ID.test(snapshot.traceId||'')||!Array.isArray(snapshot.records))return;
    for(const event of snapshot.records.slice(-128)){
      if(!SERVICE_STAGES.has(event.stage)||!Number.isSafeInteger(event.id)||
        !Number.isFinite(event.startedMs)||!Number.isFinite(event.durationMs)||
        event.durationMs<0||!['ok','failed'].includes(event.outcome))continue;
      if(this.records.some(r=>r.clock==='service-monotonic'&&r.id===event.id&&r.traceId===snapshot.traceId))continue;
      this.records.push({id:event.id,stage:event.stage,clock:'service-monotonic',traceId:snapshot.traceId,
        outcome:event.outcome,startedMs:event.startedMs,durationMs:event.durationMs,
        ...(TRACE_ID.test(event.requestId||'')?{requestId:event.requestId}:{}),
        ...(Number.isSafeInteger(event.bytes)&&event.bytes>=0&&event.bytes<=1048576?{bytes:event.bytes}:{})});
      if(this.records.length>this.capacity)this.records.shift();
    }
  }
  clear(){this.records=[];this.generation++;}
}
