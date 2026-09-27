import test from 'node:test';
import assert from 'node:assert/strict';
import {canAuthorWorld,canPlayWorld,createCreatorMode,restoredCreatorMode,
  transitionCreatorMode,validCreatorMode} from '../src/creator_mode.js';

test('creator/play/stop/creator preserves unrelated authored and earned state',()=>{
  const world={scene:{objects:[{objectId:'same-object'}]},
    game:{state:{deliveries:['same-object'],score:10}},creatorMode:createCreatorMode()};
  const before=structuredClone({scene:world.scene,game:world.game});
  assert.equal(canAuthorWorld(world.creatorMode),true);
  world.creatorMode=transitionCreatorMode(world.creatorMode,'enter-play',0);
  assert.equal(canPlayWorld(world.creatorMode),true);
  world.creatorMode=transitionCreatorMode(world.creatorMode,'stop',1);
  assert.equal(world.creatorMode.mode,'play');
  assert.equal(world.creatorMode.simulation,'paused');
  assert.equal(canPlayWorld(world.creatorMode),false);
  world.creatorMode=transitionCreatorMode(world.creatorMode,'enter-creator',2);
  assert.deepEqual({scene:world.scene,game:world.game},before);
  assert.equal(canAuthorWorld(world.creatorMode),true);
  assert.equal(world.creatorMode.revision,3);
});

test('old checkpoints migrate to paused creator and stale changes fail closed',()=>{
  const old=restoredCreatorMode(undefined);
  assert.deepEqual(old,createCreatorMode());
  assert.throws(()=>transitionCreatorMode(old,'resume',0),/Enter Play/);
  const playing=transitionCreatorMode(old,'enter-play',0);
  assert.throws(()=>transitionCreatorMode(playing,'enter-creator',0),/changed/);
  assert.equal(playing.mode,'play');
  assert.equal(old.mode,'creator');
  assert.equal(validCreatorMode({...playing,mode:'creator'}),false);
  assert.throws(()=>restoredCreatorMode({...playing,mode:'creator'}),/checkpoint/);
});
