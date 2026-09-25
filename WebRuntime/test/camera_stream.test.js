import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraStream} from '../src/camera_stream.js';

test('environment camera probe advertises mixed only after a real stream is active',async()=>{
  let constraints,stopped=false;
  const track={readyState:'live',stop(){stopped=true;this.readyState='ended';}};
  const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
  const mediaDevices={async getUserMedia(value){constraints=value;return stream;}};
  const video={videoWidth:1280,videoHeight:960,async play(){}};
  const camera=new CameraStream(mediaDevices,()=>video);
  assert.deepEqual(camera.capabilities().modes,['virtual']);
  assert.equal(camera.capabilities().mixedStatus,'permission_required');
  await camera.enable();
  assert.deepEqual(constraints.video.facingMode,{exact:'environment'});
  assert.deepEqual(camera.capabilities().modes,['virtual','mixed']);
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
  const track={readyState:'live',stop(){this.readyState='ended';}};
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
