import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixWorld} from '../src/protocol.js';
import {MatrixView} from '../src/view.js';
import {manipulationPolicy,canDirectManipulate,manipulationCommand} from '../src/manipulation.js';
import {storedWorld,restoreStoredWorld} from '../src/scene_store.js';
const setup=()=>{const world=new MatrixWorld(()=> 'prop-1');
  assert.equal(world.execute({requestId:'spawn-1',op:'spawn',assetId:'block',anchorId:'web-floor',transform:{position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}).ok,true);return world;};

test('policy defaults to grabbable and persists through history and world reopen',()=>{
  const w=setup(),o=w.requireObject('prop-1');assert.equal(manipulationPolicy(o),'grabbable');
  const original=structuredClone(o.transform);
  const r=w.execute(manipulationCommand(w,o.objectId,'environment','lock-1'));
  assert.equal(r.ok,true);assert.equal(r.objectId,o.objectId);assert.equal(canDirectManipulate(o),false);
  assert.deepEqual(o.transform,original);
  w.execute({requestId:'undo-1',op:'undo'});assert.equal(manipulationPolicy(w.requireObject(o.objectId)),'grabbable');
  w.execute({requestId:'redo-1',op:'redo'});assert.equal(manipulationPolicy(w.requireObject(o.objectId)),'environment');
  const reopened=new MatrixWorld();restoreStoredWorld(reopened,storedWorld(w));
  assert.equal(manipulationPolicy(reopened.requireObject(o.objectId)),'environment');
  assert.equal(reopened.execute(manipulationCommand(reopened,o.objectId,'grabbable','unlock-1')).ok,true);
  assert.equal(canDirectManipulate(reopened.requireObject(o.objectId)),true);
});

test('policy edits reject stale identity, transform, authority, invalid enum and unguarded commands',()=>{
  for(const change of [c=>c.expectedAssetId='chair',c=>c.expectedTransform.position.x++,
    c=>c.expectedCreatorRevision++,c=>c.expectedManipulation='locked',c=>c.manipulation='unknown',
    c=>delete c.expectedTransform]){
    const w=setup(),c=manipulationCommand(w,'prop-1','locked','change');change(c);
    assert.equal(w.execute(c).ok,false);assert.equal(canDirectManipulate(w.requireObject('prop-1')),true);
  }
  const w=setup(),c=manipulationCommand(w,'prop-1','locked','play');
  w.creatorMode={...w.creatorMode,mode:'play',simulation:'running'};
  assert.equal(w.execute(c).ok,false);
  const bad=structuredClone(w.scene);bad.objects[0].manipulation='auto-size';
  assert.throws(()=>w.validateScene(bad),/manipulation/i);
});

test('locked selection precedes desktop/controller/hand grab rejection, including child roots',()=>{
  for(const input of ['pointer','controller','hand']){
    const w=setup();w.execute(manipulationCommand(w,'prop-1','locked','lock'));
    const root=new THREE.Group();root.userData.objectId='prop-1';
    const child=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());root.add(child);
    const errors=[];
    const view={world:w,readOnly:false,objectRoots:new Map([['prop-1',root]]),
      renderer:{xr:{isPresenting:false},domElement:{focus(){},setPointerCapture(){}}},
      raycaster:new THREE.Raycaster(),operatorPanel:{group:{visible:false}},
      rayFromPointer(){},isPlayMode:()=>false,onAssetError:e=>errors.push(e),
      highlight(){},onSelection(){},
      selectFromRay:MatrixView.prototype.selectFromRay};
    view.raycaster.intersectObjects=()=>[{object:child}];
    if(input==='pointer')MatrixView.prototype.pointerDown.call(view,{button:0,pointerId:1});
    else MatrixView.prototype.selectFromController.call(view,new THREE.Group(),{hand:input==='hand'?{}:null});
    assert.equal(w.selection.objectId,'prop-1');assert.equal(view.grab,undefined);
    assert.equal(view.pointerGrab,undefined);assert.match(errors[0],/locked/i);
    child.geometry.dispose();child.material.dispose();
  }
});

test('locking an already held object cancels before thumbsticks or direct commit can move it',()=>{
  const w=setup(),original=structuredClone(w.requireObject('prop-1').transform);
  w.execute(manipulationCommand(w,'prop-1','locked','lock'));
  let cancelled=false,synced=false;
  const view={world:w,grab:{objectId:'prop-1',controller:{},inputSource:{}},
    cancelGrab(){cancelled=true;this.grab=null;},sync(){synced=true;},onAssetError(){}};
  MatrixView.prototype.updateHeldGrab.call(view,null,.1);assert.equal(cancelled,true);
  const target=structuredClone(original);target.position.x=2;
  MatrixView.prototype.commitMove.call(view,'prop-1',target);
  assert.equal(synced,true);assert.deepEqual(w.requireObject('prop-1').transform,original);
  assert.equal(w.beginRigidGrab('prop-1'),false);
  // A deliberate typed Operator transform is allowed in Creator Mode.
  assert.equal(w.execute({requestId:'intentional',op:'set_transform',objectId:'prop-1',transform:target}).ok,true);
});
