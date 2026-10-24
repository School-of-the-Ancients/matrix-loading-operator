import test from 'node:test';
import assert from 'node:assert/strict';
import {professorAttention} from '../src/professor_attention.js';
const scene={roomId:'room',objects:[{objectId:'professor',professor:{schoolSessionId:'lesson'}},
  {objectId:'exhibit',assetId:'drawing',transform:{position:{x:2,y:0,z:1}}}]};
const cue={kind:'point',objectId:'exhibit',assetId:'drawing',runtimeId:'runtime',roomId:'room'};
const context={scene,runtimeId:'runtime',sessionId:'lesson'};
test('attention resolves the current exhibit, tolerates moving it, and rejects stale/replaced targets',()=>{
  assert.equal(professorAttention(cue,context),scene.objects[1]);
  scene.objects[1].transform.position.x=5;
  assert.equal(professorAttention(cue,context).transform.position.x,5);
  for(const invalid of [{runtimeId:'other'},{roomId:'other'},{objectId:'missing'},{assetId:'replacement'},{objectId:'professor'},{kind:'execute'}])
    assert.equal(professorAttention({...cue,...invalid},context),null);
  assert.equal(professorAttention(cue,{...context,sessionId:'different'}),null);
  assert.equal(professorAttention(cue,{...context,scene:{...scene,objects:scene.objects.slice(0,1)}}),null);
});
