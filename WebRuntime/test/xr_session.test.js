import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixView} from '../src/view.js';
import {XRSessionController,bindXRPageLifecycle} from '../src/xr_session.js';

function session(){
  const value=new EventTarget();
  value.requestReferenceSpace=async()=>({});
  value.end=async()=>value.dispatchEvent(new Event('end'));
  return value;
}

function rendererXR(){
  const value=new EventTarget();
  let current=null;
  value.referenceSpaces=[];
  value.getSession=()=>current;
  value.setReferenceSpaceType=type=>value.referenceSpaces.push(type);
  value.setSession=async opened=>{
    current=opened;
    opened.addEventListener('end',()=>{current=null;value.dispatchEvent(new Event('sessionend'));});
    value.dispatchEvent(new Event('sessionstart'));
  };
  return value;
}

test('AR exit allows VR on the same page without competing session offers or stale reference space',async t=>{
  const xrRenderer=rendererXR(),requests=[];
  const xr={
    isSessionSupported:async()=>true,
    offerSession:()=>{throw Error('offerSession must not run');},
    requestSession:(mode,options)=>{requests.push({mode,options});return Promise.resolve(session());}
  };
  const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  class Button extends EventTarget{
    setAttribute(){}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
  }
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{xr}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{
    createElement:()=>new Button(),getElementById:()=>({})
  }});
  t.after(()=>{
    if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;
    if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete globalThis.document;
  });
  const errors=[],view=Object.create(MatrixView.prototype);
  view.renderer={xr:xrRenderer};view.onAssetError=message=>errors.push(message);
  const buttons={children:[],textContent:'Loading saved world before XR',append(button){this.children.push(button);}};
  await view.initXR(buttons);
  assert.equal(buttons.children.length,3);
  assert.equal(buttons.textContent,'');
  const [status,ar,vr]=buttons.children;
  assert.equal(status.id,'xr-entry-status');
  ar.click();
  assert.deepEqual(requests.map(request=>request.mode),['immersive-ar']);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(xrRenderer.getSession()!==null,true);
  assert.equal(vr.disabled,true);
  assert.equal(ar.textContent,'Exit AR');
  await view.exitXR();
  assert.equal(xrRenderer.getSession(),null);
  assert.equal(vr.disabled,false);
  vr.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(requests.map(request=>request.mode),['immersive-ar','immersive-vr']);
  assert.deepEqual(requests[1].options.requiredFeatures,['local-floor']);
  assert.ok(requests[1].options.optionalFeatures.includes('dom-overlay'));
  assert.equal(requests[1].options.domOverlay.root,requests[0].options.domOverlay.root);
  assert.deepEqual(xrRenderer.referenceSpaces,['local','local-floor']);
  assert.equal(xrRenderer.getSession()!==null,true);
  assert.equal(errors.length,0);
});

test('a world restore blocks XR entry before requestSession, including for a read-only view',async t=>{
  const xrRenderer=rendererXR(),requests=[],errors=[];
  let finishRequest;
  const xr={isSessionSupported:async()=>true,requestSession:mode=>{
    requests.push(mode);return new Promise(resolve=>{finishRequest=resolve;});
  }};
  const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  class Button extends EventTarget{
    setAttribute(){}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
  }
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{xr}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{
    createElement:()=>new Button(),getElementById:()=>({})
  }});
  t.after(()=>{
    if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;
    if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete globalThis.document;
  });
  const view=Object.create(MatrixView.prototype);
  view.renderer={xr:xrRenderer};view.readOnly=true;
  view.onAssetError=message=>errors.push(message);
  let restoring=true;
  view.xrEntryBlocker=()=>restoring?'PC world restore in progress':'';
  const buttons={children:[],textContent:'',append(button){this.children.push(button);}};
  await view.initXR(buttons);
  const [status,ar]=buttons.children;
  ar.click();
  assert.deepEqual(requests,[],'a blocked click must never request a native XR session');
  assert.equal(status.textContent,'PC world restore in progress');
  assert.equal(view.xrControls.busy,false);
  restoring=false;
  ar.click();
  assert.deepEqual(requests,['immersive-ar']);
  assert.equal(view.xrControls.busy,true,
    'PC restore can reject an entry that is still awaiting native session setup');
  finishRequest(session());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(view.xrControls.busy,false);
  assert.deepEqual(errors,['PC world restore in progress']);
});

test('pending and ending sessions reject another immersive entry until sessionend',async()=>{
  const xrRenderer=rendererXR(),errors=[];
  let resolveRequest,requestCount=0;
  const controls=new XRSessionController({requestSession:()=>{
    requestCount++;
    return new Promise(resolve=>{resolveRequest=resolve;});
  }},xrRenderer,()=>{},message=>errors.push(message));
  const opening=controls.enter('immersive-ar',{});
  assert.equal(requestCount,1,'requestSession happens synchronously on click');
  assert.equal(await controls.enter('immersive-vr',{}),false);
  const ar=session();resolveRequest(ar);await opening;
  assert.equal(await controls.enter('immersive-vr',{}),false);
  let finishEnd;
  ar.end=()=>new Promise(resolve=>{finishEnd=resolve;});
  const exiting=controls.exit();
  assert.equal(controls.ending,true);
  assert.equal(await controls.enter('immersive-vr',{}),false);
  ar.dispatchEvent(new Event('end'));finishEnd();await exiting;
  assert.equal(controls.ending,false);
  assert.equal(xrRenderer.getSession(),null);
  assert.equal(requestCount,1);
  assert.equal(errors.length,3);
});

test('hidden page or XR visibility closes AR before returning to the browser',async()=>{
  const xrRenderer=rendererXR();
  const opened=session();
  let endCalls=0;
  opened.end=async()=>{endCalls++;opened.dispatchEvent(new Event('end'));};
  let hiddenCalls=0;
  const controls=new XRSessionController({requestSession:async()=>opened},xrRenderer,
    ()=>{},()=>{},()=>hiddenCalls++);
  assert.equal(await controls.enter('immersive-ar',{}),true);
  const page=new EventTarget(),windowTarget=new EventTarget();
  page.visibilityState='visible';
  const unbind=bindXRPageLifecycle(()=>controls,page,windowTarget);
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(endCalls,0);
  page.visibilityState='hidden';
  page.dispatchEvent(new Event('visibilitychange'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(endCalls,1);
  assert.equal(xrRenderer.getSession(),null);
  assert.equal(controls.pageHidden,true);
  page.visibilityState='visible';
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(controls.busy,false);
  windowTarget.dispatchEvent(new Event('pagehide'));
  assert.equal(endCalls,1);
  windowTarget.dispatchEvent(new Event('pageshow'));
  unbind();

  const next=session();
  next.visibilityState='visible';
  next.end=async()=>{endCalls++;next.dispatchEvent(new Event('end'));};
  controls.xr={requestSession:async()=>next};
  assert.equal(await controls.enter('immersive-ar',{}),true);
  next.visibilityState='hidden';
  next.dispatchEvent(new Event('visibilitychange'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(hiddenCalls,1);
  assert.equal(endCalls,2);
  assert.equal(xrRenderer.getSession(),null);
});

test('pagehide closes an active XR session even while document remains visible',async()=>{
  const xrRenderer=rendererXR(),opened=session();
  let endCalls=0;
  opened.end=async()=>{endCalls++;opened.dispatchEvent(new Event('end'));};
  const controls=new XRSessionController({requestSession:async()=>opened},xrRenderer);
  assert.equal(await controls.enter('immersive-ar',{}),true);
  const page=new EventTarget(),windowTarget=new EventTarget();
  page.visibilityState='visible';
  const unbind=bindXRPageLifecycle(()=>controls,page,windowTarget);
  windowTarget.dispatchEvent(new Event('pagehide'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(endCalls,1);
  assert.equal(xrRenderer.getSession(),null);
  unbind();
});

test('page hide rejects a late requestSession result without clearing a newer entry',async()=>{
  const xrRenderer=rendererXR(),requests=[],errors=[];
  const controls=new XRSessionController({requestSession:()=>new Promise(resolve=>requests.push(resolve))},
    xrRenderer,()=>{},message=>errors.push(message));
  const page=new EventTarget(),windowTarget=new EventTarget();
  page.visibilityState='visible';
  const unbind=bindXRPageLifecycle(()=>controls,page,windowTarget);
  const first=controls.enter('immersive-ar',{});
  assert.equal(controls.pending,true);
  page.visibilityState='hidden';
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(controls.pending,false);
  assert.equal(controls.pageHidden,true);
  assert.match(errors.at(-1),/XR entry was cancelled/);
  page.visibilityState='visible';
  page.dispatchEvent(new Event('visibilitychange'));
  const second=controls.enter('immersive-vr',{});
  assert.equal(controls.pending,true);
  const late=session();
  let lateEnds=0;
  late.end=async()=>{lateEnds++;late.dispatchEvent(new Event('end'));};
  requests[0](late);
  assert.equal(await first,false);
  assert.equal(lateEnds,1);
  assert.equal(controls.pending,true,'old finally cannot unlock the newer entry');
  assert.equal(xrRenderer.getSession(),null);
  const current=session();requests[1](current);
  assert.equal(await second,true);
  assert.equal(xrRenderer.getSession(),current);
  await controls.exit();
  unbind();
});

test('pagehide during requestReferenceSpace unlocks controls and prevents renderer setup',async()=>{
  const xrRenderer=rendererXR(),opened=session();
  let resolveSpace,endCalls=0;
  opened.requestReferenceSpace=()=>new Promise(resolve=>{resolveSpace=resolve;});
  opened.end=async()=>{endCalls++;opened.dispatchEvent(new Event('end'));};
  let setSessionCalls=0;
  xrRenderer.setSession=async()=>{setSessionCalls++;};
  const controls=new XRSessionController({requestSession:async()=>opened},xrRenderer);
  const page=new EventTarget(),windowTarget=new EventTarget();
  page.visibilityState='visible';
  const unbind=bindXRPageLifecycle(()=>controls,page,windowTarget);
  const opening=controls.enter('immersive-ar',{});
  await Promise.resolve();
  assert.equal(controls.activeSession,opened);
  assert.equal(controls.pending,true);
  windowTarget.dispatchEvent(new Event('pagehide'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(endCalls,1);
  assert.equal(controls.pending,false);
  assert.equal(controls.pageHidden,true);
  page.visibilityState='visible';windowTarget.dispatchEvent(new Event('pageshow'));
  assert.equal(controls.busy,false);
  resolveSpace({});
  assert.equal(await opening,false);
  assert.equal(setSessionCalls,0);
  unbind();
});

test('stalled native XR exit unlocks the button and allows a retry',async()=>{
  const xrRenderer=rendererXR(),errors=[];
  const opened=session();
  const controls=new XRSessionController({requestSession:async()=>opened},xrRenderer,()=>{},
    message=>errors.push(message));
  assert.equal(await controls.enter('immersive-ar',{}),true);
  controls.exitTimeoutMs=10;
  opened.end=()=>new Promise(()=>{});
  assert.equal(await controls.exit(),false);
  assert.equal(controls.busy,false);
  assert.equal(controls.currentMode,'immersive-ar');
  assert.match(errors.at(-1),/XR exit did not finish/);
  opened.end=async()=>opened.dispatchEvent(new Event('end'));
  assert.equal(await controls.exit(),true);
  assert.equal(xrRenderer.getSession(),null);
});

test('failed request or renderer setup reports an error and unlocks a new entry',async()=>{
  const xrRenderer=rendererXR(),errors=[];
  let failRequest=true;
  const xr={requestSession:async()=>{
    if(failRequest)throw Error('browser denied session');
    return session();
  }};
  const controls=new XRSessionController(xr,xrRenderer,()=>{},message=>errors.push(message));
  assert.equal(await controls.enter('immersive-ar',{}),false);
  assert.equal(controls.busy,false);
  failRequest=false;
  const originalSetSession=xrRenderer.setSession;
  xrRenderer.setSession=async()=>{throw Error('reference space unavailable');};
  assert.equal(await controls.enter('immersive-vr',{}),false);
  assert.equal(controls.busy,false);
  assert.equal(controls.activeSession,null);
  xrRenderer.setSession=originalSetSession;
  assert.equal(await controls.enter('immersive-vr',{}),true);
  assert.match(errors[0],/AR could not start: browser denied session/);
  assert.match(errors[1],/VR could not start: reference space unavailable/);
});

test('unavailable reference space fails before Three installs its session-end handler',async()=>{
  const xrRenderer=rendererXR(),errors=[];
  const opened=session();
  opened.requestReferenceSpace=async()=>{throw Error('local-floor unavailable');};
  let setSessionCalled=false;
  xrRenderer.setSession=async()=>{setSessionCalled=true;};
  const controls=new XRSessionController({requestSession:async()=>opened},xrRenderer,()=>{},message=>errors.push(message));
  assert.equal(await controls.enter('immersive-vr',{}),false);
  assert.equal(setSessionCalled,false);
  assert.equal(controls.busy,false);
  assert.equal(controls.activeSession,null);
  assert.match(errors[0],/VR could not start: local-floor unavailable/);
});

test('native exit during session setup reports the aborted start',async()=>{
  const xrRenderer=rendererXR(),errors=[];
  const opened=session();
  let resolveSpace;
  opened.requestReferenceSpace=()=>new Promise(resolve=>{resolveSpace=resolve;});
  const controls=new XRSessionController({requestSession:async()=>opened},xrRenderer,()=>{},message=>errors.push(message));
  const opening=controls.enter('immersive-ar',{});
  await Promise.resolve();
  opened.dispatchEvent(new Event('end'));
  resolveSpace({});
  assert.equal(await opening,false);
  assert.equal(xrRenderer.getSession(),null);
  assert.match(errors[0],/AR could not start: Session ended during setup/);
});

test('unexpected native exit just after VR entry is visible to the wearer',async()=>{
  const xrRenderer=rendererXR(),errors=[];
  const opened=session();
  const controls=new XRSessionController({requestSession:async()=>opened},xrRenderer,()=>{},message=>errors.push(message));
  assert.equal(await controls.enter('immersive-vr',{}),true);
  opened.dispatchEvent(new Event('end'));
  assert.equal(xrRenderer.getSession(),null);
  assert.match(errors[0],/VR session closed immediately/);
});

test('a late AR hit test source is cancelled after the session changes',async()=>{
  let current=session(),resolveSource;
  const ar=current,source={cancelled:false,cancel(){this.cancelled=true;}};
  ar.requestReferenceSpace=async()=>({});
  ar.requestHitTestSource=()=>new Promise(resolve=>{resolveSource=resolve;});
  const view=Object.create(MatrixView.prototype);
  view.renderer={xr:{getSession:()=>current}};view.hitSource=null;
  const acquiring=view.acquireARHitSource(ar);
  await Promise.resolve();
  current=session();resolveSource(source);
  await acquiring;
  assert.equal(source.cancelled,true);
  assert.equal(view.hitSource,null);
});
