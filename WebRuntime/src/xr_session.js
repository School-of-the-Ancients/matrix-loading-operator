// One entry point owns both immersive modes. Three's separate ARButton and
// VRButton helpers each offer a session and track only their own mode.
export function bindXRPageLifecycle(getController,documentTarget,windowTarget){
  const exit=()=>{
    const controller=getController();
    if(controller&&(controller.activeSession||controller.rendererXR.getSession()))void controller.exit();
  };
  const exitWhenHidden=()=>{if(documentTarget.visibilityState==='hidden')exit();};
  documentTarget.addEventListener('visibilitychange',exitWhenHidden);
  windowTarget.addEventListener('pagehide',exit);
  return ()=>{
    documentTarget.removeEventListener('visibilitychange',exitWhenHidden);
    windowTarget.removeEventListener('pagehide',exit);
  };
}

export class XRSessionController {
  constructor(xr,rendererXR,onChange=()=>{},onError=()=>{},onHidden=()=>{}){
    this.xr=xr;this.rendererXR=rendererXR;this.onChange=onChange;this.onError=onError;this.onHidden=onHidden;
    this.activeSession=null;this.activeMode=null;this.pending=false;this.ending=false;this.presentedAt=null;
    this.exitTimeoutMs=5000;
    rendererXR.addEventListener('sessionend',()=>{
      if(!rendererXR.getSession()){
        this.activeSession=null;this.activeMode=null;this.ending=false;this.presentedAt=null;
        this.onChange();
      }
    });
  }
  get busy(){return this.pending||this.ending;}
  get currentMode(){return this.rendererXR.getSession()?this.activeMode:null;}
  async enter(mode,options){
    if(this.busy||this.activeSession||this.rendererXR.getSession()){
      this.onError('Exit the current XR session before entering another mode.');
      return false;
    }
    this.pending=true;this.onChange();
    let session;
    try{
      // Keep requestSession in the click call stack for browser user activation.
      session=await this.xr.requestSession(mode,options);
      this.activeSession=session;this.activeMode=mode;
      const onVisibility=()=>{if(session.visibilityState==='hidden'){
        try{this.onHidden();}finally{void this.exit();}
      }};
      session.addEventListener('visibilitychange',onVisibility);
      session.addEventListener('end',()=>{
        session.removeEventListener('visibilitychange',onVisibility);
        if(this.activeSession===session){
          const endedImmediately=!this.ending&&this.presentedAt!==null&&performance.now()-this.presentedAt<1500;
          this.activeSession=null;this.activeMode=null;this.ending=false;
          this.presentedAt=null;
          if(endedImmediately)this.onError(`${mode==='immersive-ar'?'AR':'VR'} session closed immediately. Check Quest tracking and controllers, then try again.`);
          this.onChange();
        }
      },{once:true});
      const referenceSpaceType=mode==='immersive-ar'?'local':'local-floor';
      // Three's session-end handler assumes this succeeds. Check it before
      // setSession installs that handler so an unsupported space exits cleanly.
      await session.requestReferenceSpace(referenceSpaceType);
      if(this.activeSession!==session)throw Error('Session ended during setup');
      this.rendererXR.setReferenceSpaceType(referenceSpaceType);
      await this.rendererXR.setSession(session);
      if(this.rendererXR.getSession()!==session){
        this.onError(`${mode==='immersive-ar'?'AR':'VR'} ended before it became ready. Please try again.`);
        return false;
      }
      this.presentedAt=performance.now();
      return true;
    }catch(error){
      if(session){try{await session.end();}catch{/* The session may already have ended. */}}
      if(this.activeSession===session){this.activeSession=null;this.activeMode=null;this.ending=false;this.presentedAt=null;}
      this.onError(`${mode==='immersive-ar'?'AR':'VR'} could not start: ${error?.message||error}`);
      return false;
    }finally{
      this.pending=false;this.onChange();
    }
  }
  async exit(){
    const session=this.rendererXR.getSession()||this.activeSession;
    if(!session||this.ending)return false;
    this.ending=true;this.onChange();
    let timer,onEnd,rejectEnd;
    const ended=new Promise(resolve=>{onEnd=()=>resolve(true);session.addEventListener('end',onEnd,{once:true});});
    const failed=new Promise((_,reject)=>{rejectEnd=reject;});
    const timed=new Promise(resolve=>{timer=setTimeout(()=>resolve(false),this.exitTimeoutMs);});
    try{
      Promise.resolve(session.end()).catch(rejectEnd);
      if(await Promise.race([ended,failed,timed]))return true;
      this.ending=false;this.onChange();
      this.onError('XR exit did not finish. Retry Exit AR/VR or reload the Quest Browser page.');
      return false;
    }
    catch(error){
      this.ending=false;this.onChange();
      this.onError(`Could not exit XR: ${error?.message||error}`);
      return false;
    }finally{
      clearTimeout(timer);
      session.removeEventListener('end',onEnd);
    }
  }
}
