// Separate environment-camera stream. This never reads WebXR compositor pixels.
const videoConstraints={width:{ideal:1280},height:{ideal:960},frameRate:{ideal:30}};
const isEnvironmentLabel=label=>/(back|rear|environment|passthrough)/i.test(label||'')&&
  !/(front|selfie|user)/i.test(label||'');
const stopStream=stream=>stream?.getTracks?.().forEach(track=>track.stop());

export class CameraStream {
  constructor(mediaDevices=globalThis.navigator?.mediaDevices,createVideo=()=>document.createElement('video')){
    this.mediaDevices=mediaDevices;
    this.createVideo=createVideo;
    this.stream=null;this.video=null;this.route='';
    this.status=mediaDevices?.getUserMedia?'permission_required':'unsupported';
    this.reason=mediaDevices?.getUserMedia?
      'Camera access has not been tested. Enable the environment camera in AR to try mixed visual review.':
      'This browser does not expose MediaDevices camera access.';
  }
  get active(){return this.status==='available'&&this.stream?.getVideoTracks?.().some(track=>track.readyState==='live');}
  capabilities(){
    const active=this.active;
    return {modes:active?['virtual','mixed']:['virtual'],device:'WebXR environment camera',
      mixedStatus:active?'available':this.status==='available'?'error':this.status,
      reason:active?`Environment camera active (${this.video.videoWidth}×${this.video.videoHeight}; ${this.route}). Separate virtual render; alignment is not calibrated.`:
        this.status==='available'?'Camera stream ended; enable it again.':this.reason,
      depthOcclusion:false};
  }
  async requestEnvironmentStream(){
    try{
      return {stream:await this.mediaDevices.getUserMedia({audio:false,video:{
        facingMode:{exact:'environment'},...videoConstraints}}),route:'exact facing'};
    }catch(error){
      // A missing facing match can still leave a labeled rear device available.
      // Never retry after an explicit permission denial.
      if(!['OverconstrainedError','NotFoundError','TypeError'].includes(error?.name))throw error;
      const devices=await this.mediaDevices.enumerateDevices?.()||[];
      let rear=devices.find(item=>item.kind==='videoinput'&&item.deviceId&&isEnvironmentLabel(item.label));
      if(rear)return {stream:await this.mediaDevices.getUserMedia({audio:false,video:{
        deviceId:{exact:rear.deviceId},...videoConstraints}}),route:'enumerated rear device'};
      // A user-initiated generic stream can unlock labels for enumeration.
      const probe=await this.mediaDevices.getUserMedia({audio:false,video:true});
      const track=probe.getVideoTracks?.()[0];
      if(track?.getSettings?.()?.facingMode==='environment'||isEnvironmentLabel(track?.label))
        return {stream:probe,route:'verified generic stream'};
      try{
        const granted=await this.mediaDevices.enumerateDevices?.()||[];
        rear=granted.find(item=>item.kind==='videoinput'&&item.deviceId&&isEnvironmentLabel(item.label));
      }finally{stopStream(probe);}
      if(!rear)throw Error('No identifiable environment camera is available');
      return {stream:await this.mediaDevices.getUserMedia({audio:false,video:{
        deviceId:{exact:rear.deviceId},...videoConstraints}}),route:'enumerated rear device'};
    }
  }
  async enable(){
    if(this.active)return;
    if(!this.mediaDevices?.getUserMedia)throw Error(this.reason);
    this.stop();
    this.status='permission_required';this.reason='Requesting environment camera permission…';
    let stream;
    try{
      const requested=await this.requestEnvironmentStream();
      stream=requested.stream;
      const track=stream.getVideoTracks?.()[0];
      if(!track||track.getSettings?.()?.facingMode==='user'||/(front|selfie)/i.test(track.label||''))
        throw Error('Selected camera is not an environment camera');
      const video=this.createVideo();
      video.muted=true;video.playsInline=true;video.srcObject=stream;
      await video.play();
      if(!video.videoWidth||!video.videoHeight){
        await new Promise((resolve,reject)=>{
          const cleanup=()=>{clearTimeout(timeout);video.removeEventListener('loadedmetadata',check);video.removeEventListener('resize',check);};
          const check=()=>{if(video.videoWidth&&video.videoHeight){cleanup();resolve();}};
          const timeout=setTimeout(()=>{cleanup();reject(Error('Camera did not deliver video dimensions within 5 seconds'));},5000);
          video.addEventListener('loadedmetadata',check);
          video.addEventListener('resize',check);
          check();
        });
      }
      this.stream=stream;this.video=video;this.route=requested.route;this.status='available';this.reason='';
    }catch(error){
      stopStream(stream);
      this.status=error?.name==='NotAllowedError'||error?.name==='PermissionDeniedError'?'denied':'error';
      this.reason=`Environment camera unavailable: ${error?.message||String(error)}`.slice(0,800);
      throw Error(this.reason);
    }
  }
  stop(){
    stopStream(this.stream);
    if(this.video)this.video.srcObject=null;
    this.stream=null;this.video=null;this.route='';
    if(this.status==='available'){
      this.status='permission_required';
      this.reason='Camera stopped. Enable it again in AR to review the real room.';
    }
  }
  captureFrame(){
    if(!this.active||!this.video?.videoWidth||!this.video?.videoHeight)
      throw Error('Environment camera frame is not ready');
    const canvas=document.createElement('canvas');
    canvas.width=this.video.videoWidth;canvas.height=this.video.videoHeight;
    const context=canvas.getContext('2d');
    if(!context)throw Error('Camera frame canvas is unavailable');
    context.drawImage(this.video,0,0,canvas.width,canvas.height);
    return canvas;
  }
}
