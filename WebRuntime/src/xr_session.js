// One entry point owns both immersive modes. Three's separate ARButton and
// VRButton helpers each offer a session and track only their own mode.
export class XRSessionController {
  constructor(xr,rendererXR,onChange=()=>{},onError=()=>{}){
    this.xr=xr;this.rendererXR=rendererXR;this.onChange=onChange;this.onError=onError;
    this.activeSession=null;this.activeMode=null;this.pending=false;this.ending=false;
    rendererXR.addEventListener('sessionend',()=>{
      if(!rendererXR.getSession()){
        this.activeSession=null;this.activeMode=null;this.ending=false;
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
      session.addEventListener('end',()=>{
        if(this.activeSession===session){
          this.activeSession=null;this.activeMode=null;this.ending=false;
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
      return true;
    }catch(error){
      if(session){try{await session.end();}catch{/* The session may already have ended. */}}
      if(this.activeSession===session){this.activeSession=null;this.activeMode=null;this.ending=false;}
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
    try{await session.end();return true;}
    catch(error){
      this.ending=false;this.onChange();
      this.onError(`Could not exit XR: ${error?.message||error}`);
      return false;
    }
  }
}
