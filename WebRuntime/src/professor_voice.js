export function speechChunks(text,limit=400){
  const words=text.replace(/[`*#]/g,'').split(/\s+/).filter(Boolean),chunks=[];let chunk='';
  for(const word of words){if(word.length>limit){if(chunk){chunks.push(chunk);chunk='';}for(let i=0;i<word.length;i+=limit)chunks.push(word.slice(i,i+limit));continue;}
    if(chunk.length+word.length+1>limit){chunks.push(chunk);chunk='';}chunk+=(chunk?' ':'')+word;}
  if(chunk)chunks.push(chunk);return chunks;
}
export class ProfessorVoice {
  constructor({load,onState=()=>{},onMouth=()=>{}}){Object.assign(this,{load,onState,onMouth});this.generation=0;this.context=null;this.source=null;this.active=null;}
  async unlock(){if(!this.context)this.context=new AudioContext();await this.context.resume();}
  stop(){this.generation++;if(this.active)this.onState(this.active,'interrupted');this.active=null;
    try{this.source?.stop();}catch{}this.source=null;this.resolvePlayback?.();this.resolvePlayback=null;this.onMouth(0);}
  async play(event,capture,isCurrent=()=>true){
    this.stop();const generation=this.generation;this.active={event,capture};
    try{
      await this.unlock();if(this.context.state!=='running')throw Error('Press Replay voice to enable audio.');
      const chunks=speechChunks(event.text);let next=this.load(chunks[0],capture);
      for(let i=0;i<chunks.length;i++){
        const data=await next;
        if(generation!==this.generation)return;
        if(!isCurrent()){this.stop();return;}
        const buffer=await this.context.decodeAudioData(data);
        if(generation!==this.generation)return;
        if(!isCurrent()){this.stop();return;}
        // Prefetch at most one clip while the current clip is speaking.
        next=i+1<chunks.length?this.load(chunks[i+1],capture):null;
        next?.catch(()=>{});
        const source=this.context.createBufferSource();source.buffer=buffer;
        const analyser=this.context.createAnalyser();analyser.fftSize=512;
        source.connect(analyser);analyser.connect(this.context.destination);this.analyser=analyser;
        this.samples=new Uint8Array(analyser.fftSize);this.frequencies=new Uint8Array(analyser.frequencyBinCount);this.source=source;
        this.onState(this.active,'speaking');
        await new Promise(resolve=>{this.resolvePlayback=resolve;source.onended=()=>{source.disconnect();analyser.disconnect();resolve();};source.start();});
        this.source=null;this.resolvePlayback=null;
        if(generation!==this.generation)return;
        if(!isCurrent()){this.stop();return;}
      }
      this.onState(this.active,'spoken');this.active=null;this.onMouth(0);
    }catch(error){if(generation===this.generation){this.onState(this.active,'failed',error);this.active=null;this.onMouth(0);}throw error;}
  }
  update(){if(!this.active||!this.source||!this.analyser){this.onMouth(0);return;}
    this.analyser.getByteTimeDomainData(this.samples);this.analyser.getByteFrequencyData(this.frequencies);let power=0;
    for(const sample of this.samples)power+=((sample-128)/128)**2;
    let weighted=0,magnitude=0;
    this.frequencies.forEach((value,index)=>{weighted+=value*index;magnitude+=value;});
    const centroid=magnitude?weighted/magnitude/this.frequencies.length:0;
    const shape=centroid>.3?'ee':centroid>.18?'ih':centroid>.09?'oh':'ou';
    this.onMouth(Math.min(1,Math.sqrt(power/this.samples.length)*6),shape);}
}
