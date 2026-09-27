import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderCitizensInspector} from '../src/citizens_inspector_view.js';

const makeNode=tag=>({tag,textContent:'',children:[],open:false,scrollTop:0,
  replaceChildren(...children){this.children=children;}});
const allText=node=>[node.textContent,...node.children.flatMap(allText)].join(' ');
const findDetails=(root,key)=>{
  if(root.inspectorKey===key)return root;
  for(const child of root.children){
    const found=findDetails(child,key);
    if(found)return found;
  }
  return null;
};

test('shared inspector renders a saved choice, current action and exact creation provenance without changing the projection',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:makeNode};
  try{
    const root=makeNode('div');
    const receipt={requestId:'a'.repeat(32),ok:true,objectId:'generated-seat',error:''};
    const projection={tick:49,paused:false,residents:[{
      id:'bo',name:'Bo',objectId:'bo-object',
      needs:{hunger:68,energy:29,fun:80,social:42},
      routines:[{id:'evening-rest',kind:'rest',priority:'high',stationId:'chair',
        startMinute:0,endMinute:60,active:true}],appointments:[],
      latestChoice:{tick:1,mode:'routine',selectedKind:'rest',
        selectedRoutineId:'evening-rest',selectedAppointmentId:null,roll:.325,
        why:'At minute 1, the recorded routine choice selected rest; the current activity is shown separately.',
        candidates:[{kind:'rest',score:21.2,deficit:34,preference:1.1,
          travelMeters:2,baseWeight:8,availabilityFactor:.6}]},
      activity:{kind:'rest',phase:'use',stationId:'generated-seat',
        executionId:7,remainingTicks:1,target:{type:'station',
          stationId:'generated-seat',objectId:'generated-seat'}},
      reservation:{stationId:'generated-seat',objectId:'generated-seat',
        kind:'rest',mode:'claim',executionId:7,expiresTick:80,
        queuePosition:null,queueLength:0,holderId:'bo'},
      social:{session:null,latestEvent:null,
        relationship:{otherId:'ada',score:4}},
      currentSummary:'Bo is using rest at generated-seat.',
      lastOutcome:'Completed rest at minute 49',capabilities:[]}],
    capabilities:[{residentId:'bo',status:'succeeded',
      summary:'Bo observed Matrix creation and used the generated rest seat.',
      request:{citizenRequestId:'citizen-bo-1',residentId:'bo',
        capability:'asset',action:'generate'},
      policy:{allowed:true,requestId:'job-1',checkpointSequence:2,reason:''},
      work:{jobId:'job-1',assetId:'web:generated-rest-seat:123',
        sha256:'1'.repeat(64),spawnRequestId:receipt.requestId,
        objectId:'generated-seat'},receipts:[receipt],
      outcome:{status:'used',requestedTick:1,blockedStationId:'chair',
        waitExecutionId:3,objectId:'generated-seat',
        assetId:'web:generated-rest-seat:123',useRequestId:'use-1'}}]};
    const before=structuredClone(projection);
    renderCitizensInspector(root,projection);
    const visible=allText(root);
    assert.match(visible,/Saved Citizens minute 49/);
    assert.match(visible,/Bo is using rest at generated-seat/);
    assert.match(visible,/Latest recorded choice at minute 1/);
    assert.match(visible,/Draw 0\.325/);
    assert.match(visible,/the current activity is shown separately/);
    assert.match(visible,/requested another rest resource at minute 1 after waiting for chair/);
    assert.match(visible,/Policy allowed the request at checkpoint 2/);
    assert.match(visible,/observed Matrix creation and then used the object/);
    const provenance=findDetails(root,'capability:0');
    assert.ok(provenance);
    assert.match(allText(provenance),new RegExp(receipt.requestId));
    provenance.open=true;
    provenance.children.find(item=>item.tag==='pre').scrollTop=67;
    renderCitizensInspector(root,{...projection,tick:50});
    assert.equal(findDetails(root,'capability:0').open,true,
      'new host checkpoints preserve an opened provenance detail');
    assert.equal(findDetails(root,'capability:0').children.find(item=>
      item.tag==='pre').scrollTop,67,
    'a poll does not reset the reader position in receipt JSON');
    assert.deepEqual(projection,before,'the inspector only reads projected state');
    renderCitizensInspector(root,{...projection,capabilities:[{
      ...projection.capabilities[0],status:'failed',reason:'Blender export failed',
      outcome:{...projection.capabilities[0].outcome,status:'failed'}}]});
    assert.match(allText(root),/Failure: Blender export failed/);
    renderCitizensInspector(root,{...projection,capabilities:[{
      ...projection.capabilities[0],legacy:true,status:'created',
      request:null,policy:null,receipts:[],reason:'',
      outcome:{...projection.capabilities[0].outcome,status:'created'}}]});
    assert.match(allText(root),/Exact Matrix receipts were not stored/);
  }finally{
    if(previous===undefined)delete globalThis.document;
    else globalThis.document=previous;
  }
});

test('owner and hosted pages include the same inspector destination',()=>{
  const owner=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const visitor=readFileSync(new URL('../hosted.html',import.meta.url),'utf8');
  assert.match(owner,/id="citizens-inspector"/);
  assert.match(visitor,/id="citizens-inspector"/);
  assert.match(visitor,/READ ONLY/);
});
