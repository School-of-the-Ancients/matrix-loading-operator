const TARGET_RATE=16000;
const MAX_FRAMES=TARGET_RATE*15;

export function pcmWav(chunks,sampleRate){
  if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error('Unsupported microphone sample rate');
  const total=chunks.reduce((sum,chunk)=>sum+chunk.length,0);
  if(!total)throw Error('No microphone audio was recorded');
  const input=new Float32Array(total);let offset=0;
  for(const chunk of chunks){input.set(chunk,offset);offset+=chunk.length;}
  const count=Math.min(MAX_FRAMES,Math.floor(total*TARGET_RATE/sampleRate));
  if(count<4000)throw Error('Hold the voice button for at least a quarter second');
  const buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
  const write=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  write(0,'RIFF');view.setUint32(4,36+count*2,true);write(8,'WAVE');write(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,TARGET_RATE,true);view.setUint32(28,TARGET_RATE*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,count*2,true);
  for(let i=0;i<count;i++){
    const source=i*sampleRate/TARGET_RATE,index=Math.floor(source),fraction=source-index;
    const sample=Math.max(-1,Math.min(1,input[index]*(1-fraction)+(input[Math.min(index+1,total-1)]||0)*fraction));
    view.setInt16(44+i*2,Math.round(sample<0?sample*32768:sample*32767),true);
  }
  return new Uint8Array(buffer);
}

export function base64Bytes(bytes){
  const parts=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
  return btoa(parts.join(''));
}

export class VoiceRecorder {
  constructor(){this.active=false;this.stopping=false;this.chunks=[];}
  async start(){
    if(this.active||this.stopping)throw Error('Already recording');
    if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser cannot use the microphone');
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)throw Error('This browser has no audio capture API');
      let context;try{context=new Audio({sampleRate:TARGET_RATE});}catch{context=new Audio();}
      await context.resume();
      const source=context.createMediaStreamSource(stream),processor=context.createScriptProcessor(4096,1,1),mute=context.createGain();
      mute.gain.value=0;this.chunks=[];this.recordedFrames=0;this.active=true;this.stream=stream;this.context=context;
      this.source=source;this.processor=processor;this.mute=mute;
      processor.onaudioprocess=event=>{
        if(!this.active)return;
        const data=event.inputBuffer.getChannelData(0),remaining=Math.max(0,Math.ceil(context.sampleRate*15)-this.recordedFrames);
        if(remaining){const chunk=new Float32Array(data.subarray(0,remaining));this.chunks.push(chunk);this.recordedFrames+=chunk.length;}
      };
      source.connect(processor);processor.connect(mute);mute.connect(context.destination);
    }catch(error){stream.getTracks().forEach(track=>track.stop());throw error;}
  }
  async stop(){
    if(!this.active)throw Error('Voice recording was not started');
    this.active=false;this.stopping=true;
    const rate=this.context.sampleRate,chunks=this.chunks;
    try{
      this.processor.disconnect();this.source.disconnect();this.mute.disconnect();
      this.stream.getTracks().forEach(track=>track.stop());
      await this.context.close();return base64Bytes(pcmWav(chunks,rate));
    }
    finally{this.stopping=false;}
  }
}
