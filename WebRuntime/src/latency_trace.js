// Local, opt-in diagnostics. Never retain request bodies or response content.
const STAGES=new Set(['microphone.acquire','voice.finalize-and-deliver','command.apply',
  'receipts.acknowledged','http.exchange','http.agent.session','http.agent.status',
  'http.agent.turn','http.agent.steer','http.agent.cancel','http.agent.approval',
  'http.agent.transcribe','http.voice.submit','http.voice.status','http.other']);
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
  }
  begin(stage){
    if(!STAGES.has(stage))throw Error('Unknown latency stage.');
    const start=this.now(),id=++this.sequence,generation=this.generation;
    let finished=false;
    return outcome=>{
      if(finished||generation!==this.generation)return;
      finished=true;
      const end=this.now();
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return;
      this.records.push({id,stage,outcome:outcome==='ok'?'ok':'failed',
        startedMs:start,durationMs:end-start});
      if(this.records.length>this.capacity)this.records.shift();
    };
  }
  snapshot(){return {schemaVersion:1,clock:'browser-monotonic',
    records:this.records.map(record=>({...record}))};}
  clear(){this.records=[];this.generation++;}
}
