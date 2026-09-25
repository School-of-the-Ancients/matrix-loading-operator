import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraStream} from '../src/camera_stream.js';

test('environment camera probe advertises mixed only after a real stream is active',async()=>{
  let constraints,stopped=false;
  const track={readyState:'live',getSettings:()=>({facingMode:'environment'}),
    stop(){stopped=true;this.readyState='ended';}};
  const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
  const mediaDevices={async getUserMedia(value){constraints=value;return stream;}};
  const video={videoWidth:1280,videoHeight:960,async play(){}};
  const camera=new CameraStream(mediaDevices,()=>video);
  assert.deepEqual(camera.capabilities().modes,['virtual']);
  assert.equal(camera.capabilities().mixedStatus,'permission_required');
  await camera.enable();
  assert.deepEqual(constraints.video.facingMode,{exact:'environment'});
  assert.deepEqual(camera.capabilities().modes,['virtual','mixed']);
  assert.match(camera.capabilities().reason,/1280×960; exact facing/);
  camera.stop();
  assert.equal(stopped,true);
  assert.deepEqual(camera.capabilities().modes,['virtual']);
});

test('permission failure and missing MediaDevices fall back to virtual capture',async()=>{
  const absent=new CameraStream(null);
  assert.equal(absent.capabilities().mixedStatus,'unsupported');
  const denied=new CameraStream({getUserMedia:async()=>{const error=Error('denied');error.name='NotAllowedError';throw error;}});
  await assert.rejects(denied.enable(),/Environment camera unavailable/);
  assert.equal(denied.capabilities().mixedStatus,'denied');
  assert.deepEqual(denied.capabilities().modes,['virtual']);
});

test('camera waits for metadata before declaring the stream unavailable',async()=>{
  const track={readyState:'live',getSettings:()=>({facingMode:'environment'}),
    stop(){this.readyState='ended';}};
  const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
  const video=new EventTarget();
  video.videoWidth=0;video.videoHeight=0;
  video.play=async()=>{
    setTimeout(()=>{video.videoWidth=1280;video.videoHeight=960;video.dispatchEvent(new Event('loadedmetadata'));},1);
  };
  const camera=new CameraStream({getUserMedia:async()=>stream},()=>video);
  await camera.enable();
  assert.equal(camera.active,true);
  camera.stop();
});

test('facing mismatch can use a labeled rear device after permission enumeration',async()=>{
  const calls=[];
  const front={label:'Front camera',readyState:'live',getSettings:()=>({facingMode:'user'}),
    stop(){this.readyState='ended';}};
  const rear={label:'Quest passthrough rear camera',readyState:'live',
    getSettings:()=>({facingMode:'environment'}),stop(){this.readyState='ended';}};
  const makeStream=track=>({getVideoTracks:()=>[track],getTracks:()=>[track]});
  let granted=false;
  const devices={
    async getUserMedia(request){
      calls.push(request);
      if(request.video?.facingMode){const error=Error('no facing match');error.name='OverconstrainedError';throw error;}
      if(request.video===true){granted=true;return makeStream(front);}
      assert.deepEqual(request.video.deviceId,{exact:'rear-id'});
      return makeStream(rear);
    },
    async enumerateDevices(){return granted?[
      {kind:'videoinput',deviceId:'front-id',label:'Front camera'},
      {kind:'videoinput',deviceId:'rear-id',label:'Quest passthrough rear camera'}]:[];}
  };
  const camera=new CameraStream(devices,()=>({videoWidth:1280,videoHeight:960,async play(){}}));
  await camera.enable();
  assert.equal(calls.length,3);
  assert.equal(front.readyState,'ended','generic permission probe is stopped');
  assert.equal(camera.active,true);
  assert.match(camera.capabilities().reason,/enumerated rear device/);
  camera.stop();assert.equal(rear.readyState,'ended');
});

test('unknown or front camera is never advertised as mixed capture',async()=>{
  const front={label:'Front camera',readyState:'live',getSettings:()=>({facingMode:'user'}),
    stop(){this.readyState='ended';}};
  const stream={getVideoTracks:()=>[front],getTracks:()=>[front]};
  const devices={async getUserMedia(request){
    if(request.video?.facingMode){const error=Error('no facing match');error.name='OverconstrainedError';throw error;}
    return stream;
  },async enumerateDevices(){return [{kind:'videoinput',deviceId:'front-id',label:'Front camera'}];}};
  const camera=new CameraStream(devices);
  await assert.rejects(camera.enable(),/No identifiable environment camera/);
  assert.equal(front.readyState,'ended');
  assert.deepEqual(camera.capabilities().modes,['virtual']);
});

test('an explicit camera permission denial does not request a generic camera',async()=>{
  let calls=0;
  const camera=new CameraStream({async getUserMedia(){calls++;const error=Error('denied');
    error.name='NotAllowedError';throw error;},async enumerateDevices(){throw Error('must not enumerate');}});
  await assert.rejects(camera.enable(),/denied/);
  assert.equal(calls,1);
  assert.equal(camera.capabilities().mixedStatus,'denied');
});

test('a browser returning a front track for exact environment is rejected',async()=>{
  const front={label:'Front camera',readyState:'live',getSettings:()=>({facingMode:'user'}),
    stop(){this.readyState='ended';}};
  const camera=new CameraStream({async getUserMedia(){return {getVideoTracks:()=>[front],getTracks:()=>[front]};}});
  await assert.rejects(camera.enable(),/not an environment camera/);
  assert.equal(front.readyState,'ended');
  assert.deepEqual(camera.capabilities().modes,['virtual']);
});

test('an exact-facing request still needs positive environment-camera evidence',async()=>{
  const unknown={label:'Integrated Camera',readyState:'live',getSettings:()=>({}),
    stop(){this.readyState='ended';}};
  const camera=new CameraStream({async getUserMedia(){return {
    getVideoTracks:()=>[unknown],getTracks:()=>[unknown]};}});
  await assert.rejects(camera.enable(),/not an environment camera/);
  assert.equal(unknown.readyState,'ended');
  assert.deepEqual(camera.capabilities().modes,['virtual']);
});

test('an exact-facing track can be identified from its enumerated device label',async()=>{
  const rear={label:'Camera 2',readyState:'live',getSettings:()=>({deviceId:'rear-id'}),
    stop(){this.readyState='ended';}};
  const camera=new CameraStream({async getUserMedia(){return {
    getVideoTracks:()=>[rear],getTracks:()=>[rear]};},
    async enumerateDevices(){return [{kind:'videoinput',deviceId:'rear-id',label:'Quest rear camera'}];}},
  ()=>({videoWidth:1280,videoHeight:960,async play(){}}));
  await camera.enable();
  assert.equal(camera.active,true);
  camera.stop();
});
