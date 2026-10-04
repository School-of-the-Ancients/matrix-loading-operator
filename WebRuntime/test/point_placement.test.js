import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {selectedPointAt} from '../src/selected_point.js';
import {captureAgentContext,verifyAgentContextAtDelivery} from '../src/agent_context.js';
import {operatorPanel} from '../src/view.js';

const point=(x=0,y=0,z=0)=>({x,y,z});
const identity={position:point(),rotation:point(),scale:point(1,1,1)};
function fixture(){
  const world=new MatrixWorld(()=> 'prop-1');
  const transform={position:point(0,0,-2),rotation:point(20,45,-15),scale:point(6,6,6)};
  assert.equal(world.execute({requestId:'spawn-1',op:'spawn',assetId:'orb',anchorId:'web-floor',transform}).ok,true);
  world.enterAR();
  world.setSpatialAnchors([{anchorId:'table-1',displayName:'TABLE',source:'webxr',semanticLabels:['TABLE'],
    surface:{kind:'support',boundary:[point(-.1,0,-.1),point(.1,0,-.1),point(.1,0,.1),point(-.1,0,.1)]},roomPose:identity}]);
  world.setOriginLocated(true);
  world.setSpatialObservation({planeObservedAt:performance.now(),trackingEpoch:7,webFloorPose:identity});
  world.setSelection('prop-1',transform.position,'web-floor');
  world.selectedPlacement=selectedPointAt(world,'table-1',point(),7);
  const command={requestId:'move-point-1',op:'set_transform',objectId:'prop-1',
    transform:{...transform,position:point()},expectedTransform:structuredClone(transform),
    expectedAssetId:'orb',expectedCreatorRevision:world.creatorMode.revision,
    pointTarget:{anchorId:'table-1',position:point(),presentation:'ar',trackingEpoch:7,fitToRoom:false}};
  return {world,command};
}

test('free AR moves a tilted oversized object onto a marker without fitting or straightening',()=>{
  const {world,command}=fixture();
  assert.equal(world.fitToRoom,false);
  assert.equal(world.spatial.alignmentVerified,false);
  world.assertRoomConstraint=()=>{throw Error('Free movement must not fit surfaces');};
  const result=world.execute(command);
  assert.equal(result.ok,true,result.error);
  assert.deepEqual(world.scene.objects[0].transform,command.transform);
  assert.equal(world.scene.objects[0].objectId,'prop-1');
  assert.equal(world.execute({requestId:'undo-point',op:'undo'}).ok,true);
  assert.deepEqual(world.scene.objects[0].transform,command.expectedTransform);
});

test('Fit to room keeps full-footprint rejection and leaves the object unchanged',()=>{
  const {world,command}=fixture();
  assert.equal(world.execute({requestId:'confirm-1',op:'confirm_room'}).ok,true);
  world.fitToRoom=true;
  command.pointTarget.fitToRoom=true;
  command.transform.rotation=point(0,45,0);
  command.roomConstraint={anchorId:'table-1',trackingEpoch:7};
  const result=world.execute(command);
  assert.equal(result.ok,false);
  assert.match(result.error,/footprint extends/);
  assert.deepEqual(world.scene.objects[0].transform,command.expectedTransform);
});

test('queued free moves reject changed pin, object, policy, presentation and tracking',()=>{
  const changes=[
    world=>{world.selectedPlacement.position.x=.03;},
    world=>{world.selection.objectId='';},
    world=>{world.fitToRoom=true;},
    world=>{world.runtimePresentation='vr';},
    world=>{world.spatial.trackingEpoch=8;},
    world=>{world.spatial.originUnavailable=true;},
    world=>{world.spatial.planeObservedAt=performance.now()-5000;},
  ];
  for(const change of changes){
    const {world,command}=fixture();change(world);
    const result=world.execute(command);
    assert.equal(result.ok,false,result.error);
    assert.deepEqual(world.scene.objects[0].transform,command.expectedTransform);
  }
});

test('free AR can pin the digital floor with no measured planes; precise mode cannot',()=>{
  const {world}=fixture();
  world.spatial.observedAnchors=[];world.spatial.anchors=[];
  world.spatial.planeObservedAt=null;
  assert.equal(selectedPointAt(world,'web-floor',point(2,0,-3),7).anchorId,'web-floor');
  world.fitToRoom=true;
  assert.throws(()=>selectedPointAt(world,'web-floor',point(),7),/Choose a current/);
});

test('voice preparation keeps the selected fitting policy and rejects a later change',()=>{
  const {world}=fixture();
  const view={roomTrackingEpoch:7,pointingTarget:()=>null,
    selectedPlacementTarget:()=>({anchorId:'table-1',position:point(),source:'raycast'}),viewer:()=>null};
  const captured=captureAgentContext(world,view,'client-1','voice_transcript');
  world.fitToRoom=true;
  assert.throws(()=>verifyAgentContextAtDelivery(captured,
    captureAgentContext(world,view,'client-1','voice_transcript')),/changed while preparing/);
});

test('XR mode page keeps Save and Stop accessible without a deferred fitting control',()=>{
  const labels=[];
  const context={fillRect(){},strokeRect(){},fillText(label){labels.push(String(label));},measureText(){return {width:0};}};
  const previous=globalThis.document;
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
  try{
    const panel=operatorPanel();panel.toggleModePage();
    const hit=x=>panel.hit({x:x/1024,y:1-589/768});
    assert.equal(hit(275),'toggle-world');
    assert.equal(hit(747),'agent-stop');
    assert.equal(hit(510),null,'Save and Stop have separate hit targets');
    assert.ok(!labels.some(label=>label.includes('FIT TO ROOM')));
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
