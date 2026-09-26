import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixView} from '../src/view.js';
import {XRSessionController} from '../src/xr_session.js';

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
  assert.deepEqual(xrRenderer.referenceSpaces,['local','local-floor']);
  assert.equal(xrRenderer.getSession()!==null,true);
  assert.equal(errors.length,0);
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
