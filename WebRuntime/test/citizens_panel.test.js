import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixWorld} from '../src/protocol.js';
import {createCitizensDemo} from '../src/citizens.js';
import {CitizensPanel} from '../src/citizens_panel.js';

test('AR entry cancels active claims before an AR object move and does not auto-resume',()=>{
  const previousDocument=globalThis.document;
  const elements=new Map();
  const element=()=>({textContent:'',value:'29',disabled:false,
    addEventListener(){},replaceChildren(){}});
  globalThis.document={hidden:false,
    getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
    createElement:element};
  let panel;
  try{
    let sequence=0;
    const world=new MatrixWorld(()=>`citizens-${++sequence}`);
    const simulation=createCitizensDemo(world,{seed:17});
    const active=simulation.step();
    const chair=active.stations.find(station=>station.kind==='rest');
    assert.equal(chair.holder,'ada');
    world.citizens=active;
    panel=new CitizensPanel(world,{onChange(){},canStart:()=>'',onFeedback(){}});

    world.enterAR();
    panel.syncFromWorld();
    const paused=world.citizens;
    assert.equal(paused.paused,true);
    assert.equal(paused.stations.find(station=>station.kind==='rest').holder,null);
    assert.ok(paused.residents.every(resident=>resident.activity===null));
    assert.ok(paused.log.some(entry=>entry.event==='failed'&&
      entry.message.includes('entering AR cancelled')));

    const transform=structuredClone(world.requireObject(chair.objectId).transform);
    transform.position.x+=1;
    assert.equal(world.execute({requestId:'ar-move-chair',op:'set_transform',
      objectId:chair.objectId,transform}).ok,true);
    world.leaveAR();
    panel.syncFromWorld();
    const returned=panel.simulation.snapshot();
    assert.equal(world.requireObject(chair.objectId).transform.position.x,1);
    assert.equal(returned.paused,true);
    assert.equal(returned.clockTick,active.clockTick);
    assert.equal(returned.stations.find(station=>station.kind==='rest').holder,null);
    assert.ok(returned.residents.every(resident=>resident.activity===null));
    panel.tick();
    assert.equal(panel.simulation.snapshot().clockTick,active.clockTick);
  }finally{
    if(panel)clearInterval(panel.timer);
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});
