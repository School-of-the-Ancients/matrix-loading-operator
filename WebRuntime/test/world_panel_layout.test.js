import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorPanel} from '../src/view.js';

function fixture(run){
  const previous=globalThis.document;
  const painted={buttons:[],text:[]};let rectangle=null;
  const context={
    fillRect(x,y,w,h){
      if(w===1024&&h===768){painted.buttons=[];painted.text=[];}
      rectangle={x,y,w,h};
    },
    strokeRect(){},measureText(){return {width:0};},
    fillText(label){
      painted.text.push(String(label));
      if(this.textAlign==='center'&&this.textBaseline==='middle')
        painted.buttons.push({...rectangle,label:String(label)});
    },
  };
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
  try{run(operatorPanel(),painted);}finally{
    if(previous===undefined)delete globalThis.document;else globalThis.document=previous;
  }
}
const hit=(panel,x,y)=>panel.hit({x:x/1024,y:1-y/768});
const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;

test('AR and VR world controls are readable and independently clickable above the voice footer',()=>{
  fixture((panel,painted)=>{
    panel.toggleWorld();
    panel.setWorldInfo({canSetManipulation:true,selectedObjectLabel:'Starfall rocket',selectedManipulation:'locked'});
    for(const presentation of ['ar','vr']){
      panel.setXRMode(presentation);
      const unlock=painted.buttons.find(button=>button.label==='UNLOCK SELECTED OBJECT');
      const voice=painted.buttons.find(button=>button.label==='HOLD TO SPEAK');
      assert.ok(unlock&&voice);
      assert.ok(unlock.y+unlock.h<=voice.y-16,'unlock needs a visible gap above the persistent footer');
      assert.equal(hit(panel,unlock.x+unlock.w/2,unlock.y+unlock.h/2),'toggle-manipulation');
      for(let i=0;i<painted.buttons.length;i++)for(let j=i+1;j<painted.buttons.length;j++){
        const a=painted.buttons[i],b=painted.buttons[j];
        assert.equal(overlaps(a,b),false,`${a.label} overlaps ${b.label}`);
      }
      const expected={'SAVE WORLD':'save-world','RESTORE SAVED':'restore-world','UNDO':'undo',
        'REDO':'redo','WORLDS':'toggle-archives','ENABLE CAMERA':'toggle-camera',
        'HOLD TO SPEAK':'voice','PIN TO WALL':'pin','VOICE ON':'voice-output','NEXT':'next'};
      for(const [label,action] of Object.entries(expected)){
        const button=painted.buttons.find(item=>item.label===label);assert.ok(button,label);
        // The old unlock row intercepted the top part of the voice footer.
        for(const inset of [5,button.h/2,button.h-5])
          assert.equal(hit(panel,button.x+button.w/2,button.y+inset),action,label);
      }
      assert.ok(painted.text.includes('Selected: Starfall rocket · locked'));
    }
  });
});

test('world lock control displays selection and unavailable reason without admitting an action',()=>{
  fixture((panel,painted)=>{
    panel.toggleWorld();
    panel.setWorldInfo({canSetManipulation:false,selectedObjectLabel:'Starfall rocket',
      selectedManipulation:'locked',manipulationUnavailableReason:'Return to Creator Mode to change object locks.'});
    const disabled=painted.buttons.find(button=>button.label==='UNLOCK SELECTED OBJECT');
    assert.ok(disabled,'unavailable controls remain discoverable');
    assert.equal(hit(panel,disabled.x+disabled.w/2,disabled.y+disabled.h/2),null);
    assert.ok(painted.text.includes('Return to Creator Mode to change object locks.'));
    panel.setWorldInfo({canSetManipulation:false,selectedObjectLabel:'',
      manipulationUnavailableReason:'Select an object first.'});
    assert.ok(painted.text.includes('SELECT AN OBJECT'));
    panel.setWorldInfo({canSetManipulation:true,selectedObjectLabel:'Starfall rocket',selectedManipulation:'grabbable'});
    const lock=painted.buttons.find(button=>button.label==='LOCK SELECTED OBJECT');
    assert.equal(hit(panel,lock.x+lock.w/2,lock.y+lock.h/2),'toggle-manipulation');
  });
});
