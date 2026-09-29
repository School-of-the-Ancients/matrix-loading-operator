// Separate environment-camera stream. This never reads WebXR compositor pixels.
const videoConstraints={width:{ideal:1280},height:{ideal:960},frameRate:{ideal:30}};
const CAMERA_ENABLE_TIMEOUT_MS=45000;
const isEnvironmentLabel=label=>/(back|rear|environment|passthrough)/i.test(label||'')&&
  !/(front|selfie|user)/i.test(label||'');
const stopStream=stream=>stream?.getTracks?.().forEach(track=>track.stop());
const cancelled=()=>{const error=Error('Environment camera request was cancelled');error.name='AbortError';return error;};

export function bindCameraPageLifecycle(camera,documentTarget,windowTarget,onStop=()=>{}){
  const stop=()=>{camera.stop();onStop();};
  const stopWhenHidden=()=>{if(documentTarget.visibilityState==='hidden')stop();};
  documentTarget.addEventListener('visibilitychange',stopWhenHidden);
  windowTarget.addEventListener('pagehide',stop);
  return ()=>{
    documentTarget.removeEventListener('visibilitychange',stopWhenHidden);
    windowTarget.removeEventListener('pagehide',stop);
  };
}

export class CameraStream {
  constructor(mediaDevices=globalThis.navigator?.mediaDevices,createVideo=()=>document.createElement('video'),
    createCanvas=()=>document.createElement('canvas')){
    this.mediaDevices=mediaDevices;
    this.createVideo=createVideo;
    this.createCanvas=createCanvas;
    this.stream=null;this.video=null;this.route='';
    this._generation=0;this._enabling=false;this._pendingStream=null;this._pendingVideo=null;
    this._cancelRequest=null;this._cancelMetadata=null;
    this.enableTimeoutMs=CAMERA_ENABLE_TIMEOUT_MS;
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
  async requestEnvironmentStream(isCurrent=()=>true){
    const accept=stream=>{
      if(!isCurrent()){stopStream(stream);throw cancelled();}
      this._pendingStream=stream;
      return stream;
    };
    try{
      const stream=accept(await this.mediaDevices.getUserMedia({audio:false,video:{
        facingMode:{exact:'environment'},...videoConstraints}}));
      return {stream,route:'exact facing',identified:false};
    }catch(error){
      if(!isCurrent())throw cancelled();
      // A missing facing match can still leave a labeled rear device available.
      // Never retry after an explicit permission denial.
      if(!['OverconstrainedError','NotFoundError','TypeError'].includes(error?.name))throw error;
      const devices=await this.mediaDevices.enumerateDevices?.()||[];
      if(!isCurrent())throw cancelled();
      let rear=devices.find(item=>item.kind==='videoinput'&&item.deviceId&&isEnvironmentLabel(item.label));
      if(rear)return {stream:accept(await this.mediaDevices.getUserMedia({audio:false,video:{
        deviceId:{exact:rear.deviceId},...videoConstraints}})),route:'enumerated rear device',identified:true};
      // A user-initiated generic stream can unlock labels for enumeration.
      const probe=accept(await this.mediaDevices.getUserMedia({audio:false,video:true}));
      const track=probe.getVideoTracks?.()[0];
      if(track?.getSettings?.()?.facingMode==='environment'||isEnvironmentLabel(track?.label))
        return {stream:probe,route:'verified generic stream',identified:true};
      try{
        const granted=await this.mediaDevices.enumerateDevices?.()||[];
        if(!isCurrent())throw cancelled();
        rear=granted.find(item=>item.kind==='videoinput'&&item.deviceId&&isEnvironmentLabel(item.label));
      }finally{stopStream(probe);if(this._pendingStream===probe)this._pendingStream=null;}
      if(!rear)throw Error('No identifiable environment camera is available');
      return {stream:accept(await this.mediaDevices.getUserMedia({audio:false,video:{
        deviceId:{exact:rear.deviceId},...videoConstraints}})),route:'enumerated rear device',identified:true};
    }
  }
  async enable(){
    if(this.active)return;
    if(this._enabling)throw Error('Environment camera request is already in progress');
    if(!this.mediaDevices?.getUserMedia)throw Error(this.reason);
    this.stop();
    const generation=this._generation;
    const isCurrent=()=>generation===this._generation;
    let rejectRequest;
    const cancelledRequest=new Promise((resolve,reject)=>{rejectRequest=reject;});
    this._cancelRequest=()=>rejectRequest(cancelled());
    let timeoutId;
    const deadline=new Promise((_,reject)=>{timeoutId=setTimeout(()=>{
      const error=Error('Camera permission or playback did not respond in time; try again');
      error.name='TimeoutError';
      reject(error);
      this.stop();
    },this.enableTimeoutMs);});
    const waitFor=promise=>Promise.race([promise,cancelledRequest,deadline]);
    this._enabling=true;
    this.status='permission_required';this.reason='Requesting environment camera permission…';
    let stream,video;
    try{
      const requested=await waitFor(this.requestEnvironmentStream(isCurrent));
      stream=requested.stream;
      if(!isCurrent())throw cancelled();
      const track=stream.getVideoTracks?.()[0];
      const settings=track?.getSettings?.()||{};
      let identified=requested.identified||settings.facingMode==='environment'||isEnvironmentLabel(track?.label);
      if(!identified&&settings.deviceId&&this.mediaDevices.enumerateDevices){
        try{const devices=await waitFor(this.mediaDevices.enumerateDevices());
          if(!isCurrent())throw cancelled();
          identified=devices.some(item=>item.kind==='videoinput'&&item.deviceId===settings.deviceId&&
            isEnvironmentLabel(item.label));}
        catch(error){if(!isCurrent())throw error;
          /* Without positive evidence, do not claim environment capture. */}
      }
      if(!track||settings.facingMode==='user'||/(front|selfie)/i.test(track.label||'')||!identified)
        throw Error('Selected camera is not an environment camera');
      video=this.createVideo();this._pendingVideo=video;
      video.muted=true;video.playsInline=true;video.srcObject=stream;
      await waitFor(video.play());
      if(!isCurrent())throw cancelled();
      if(!video.videoWidth||!video.videoHeight){
        await waitFor(new Promise((resolve,reject)=>{
          const cleanup=()=>{clearTimeout(timeout);video.removeEventListener('loadedmetadata',check);
            video.removeEventListener('resize',check);
            if(this._cancelMetadata===abort)this._cancelMetadata=null;};
          const check=()=>{if(video.videoWidth&&video.videoHeight){cleanup();resolve();}};
          const abort=()=>{cleanup();reject(cancelled());};
          const timeout=setTimeout(()=>{cleanup();reject(Error('Camera did not deliver video dimensions within 5 seconds'));},5000);
          this._cancelMetadata=abort;
          video.addEventListener('loadedmetadata',check);
          video.addEventListener('resize',check);
          check();
        }));
      }
      if(!isCurrent())throw cancelled();
      this.stream=stream;this.video=video;this.route=requested.route;this.status='available';this.reason='';
      this._pendingStream=null;this._pendingVideo=null;
    }catch(error){
      stopStream(stream);
      if(video)video.srcObject=null;
      if(!isCurrent()&&error?.name!=='TimeoutError')throw cancelled();
      this.status=error?.name==='NotAllowedError'||error?.name==='PermissionDeniedError'?'denied':'error';
      this.reason=`Environment camera unavailable: ${error?.message||String(error)}`.slice(0,800);
      throw Error(this.reason);
    }finally{
      clearTimeout(timeoutId);
      if(isCurrent()){
        this._enabling=false;this._pendingStream=null;this._pendingVideo=null;
        this._cancelRequest=null;this._cancelMetadata=null;
      }
    }
  }
  stop(){
    const wasOpen=this.status==='available'||this._enabling;
    this._generation++;
    const cancelMetadata=this._cancelMetadata;
    this._cancelMetadata=null;
    if(cancelMetadata)cancelMetadata();
    const cancelRequest=this._cancelRequest;
    this._cancelRequest=null;
    if(cancelRequest)cancelRequest();
    stopStream(this._pendingStream);
    if(this._pendingVideo)this._pendingVideo.srcObject=null;
    stopStream(this.stream);
    if(this.video)this.video.srcObject=null;
    this._pendingStream=null;this._pendingVideo=null;this._enabling=false;
    this.stream=null;this.video=null;this.route='';
    if(wasOpen){
      this.status='permission_required';
      this.reason='Camera stopped. Enable it again in AR to review the real room.';
    }
  }
  captureFrame(){
    if(!this.active||!this.video?.videoWidth||!this.video?.videoHeight)
      throw Error('Environment camera frame is not ready');
    const canvas=this.createCanvas();
    canvas.width=this.video.videoWidth;canvas.height=this.video.videoHeight;
    const context=canvas.getContext('2d');
    if(!context)throw Error('Camera frame canvas is unavailable');
    context.drawImage(this.video,0,0,canvas.width,canvas.height);
    // This is when JavaScript copied the current video element, not sensor exposure time.
    const copiedAtMonotonicMs=performance.now();
    return {canvas,cameraFrameCapturedAtUtc:new Date().toISOString(),copiedAtMonotonicMs};
  }
}
