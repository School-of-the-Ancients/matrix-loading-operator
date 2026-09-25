import test from 'node:test';
import assert from 'node:assert/strict';
import {captureAgentContext} from '../src/agent_context.js';

test('captures selected object and a distinct pointing hit at send time',()=>{
  const world={scene:{roomId:'webxr-session-1',objects:[{objectId:'chair-1',anchorId:'floor-1'}]},
    selection:{objectId:'chair-1'}};
  const view={pointingTarget:()=>({anchorId:'floor-1',objectId:null,position:{x:2,y:0,z:-3}}),
    viewer:()=>({frames:[{anchorId:'floor-1',position:{x:0,y:1.7,z:0},forward:{x:0,y:0,z:-1}}]})};
  const context=captureAgentContext(world,view,'client-1','voice_transcript');
  assert.equal(context.selectedObjectId,'chair-1');
  assert.deepEqual(context.pointingTarget.position,{x:2,y:0,z:-3});
  assert.equal(context.viewerFrame.anchorId,'floor-1');
  assert.equal(context.inputSource,'voice_transcript');
  assert.equal(context.roomId,'webxr-session-1');
});

test('does not invent a pointing hit or head pose for a plain request',()=>{
  const world={scene:{roomId:'web-virtual-room-v1',objects:[]},selection:{objectId:''}};
  const view={pointingTarget:()=>null,viewer:()=>({frames:[{anchorId:'web-floor'}]})};
  const context=captureAgentContext(world,view,'client-1','text');
  assert.equal(context.selectedObjectId,null);
  assert.equal(context.pointingTarget,null);
  assert.equal(context.viewerFrame,null);
});
