import test from 'node:test';
import assert from 'node:assert/strict';
import {ProfessorOverlay,professorRoute} from '../src/professor_overlay.js';
import {MatrixView,operatorPanel} from '../src/view.js';

class Element extends EventTarget {
  style={};dataset={};attributes={};hidden=false;textContent='';focusCount=0;
  setAttribute(name,value){this.attributes[name]=value;}
  focus(){this.focusCount++;}
  click(){this.dispatchEvent(new Event('click',{bubbles:true}));}
}
function fixture(location={protocol:'http:',hostname:'127.0.0.1'},canOpen=()=> '') {
  const elements=Object.fromEntries(['root','panel','frame','status','notice','closeButton','standalone'].map(key=>[key,new Element()]));
  const triggers=[new Element(),new Element()],changes=[],notices=[];
  const overlay=new ProfessorOverlay({...elements,triggers,location,canOpen,onOpenChange:value=>changes.push(value),onNotice:value=>notices.push(value)});
  return {...elements,triggers,changes,notices,overlay};
}

test('desktop loads the entire existing app lazily and close/reopen preserves its browsing state',()=>{
  const f=fixture();assert.equal(f.frame.src,undefined);assert.equal(f.root.style.display,'none');
  f.triggers[0].click();assert.equal(f.frame.src,'http://127.0.0.1:3108/');
  assert.equal(f.panel.hidden,false);assert.equal(f.triggers[0].attributes['aria-expanded'],'true');
  f.frame.src='http://127.0.0.1:3108/#session=saved';
  f.closeButton.click();assert.equal(f.panel.hidden,true);assert.equal(f.triggers[0].focusCount,1);
  f.triggers[0].click();assert.equal(f.frame.src,'http://127.0.0.1:3108/#session=saved');
  assert.deepEqual(f.changes,[true,false,true]);
});

test('actual DOM overlay state controls immersive access and desktop windows do not masquerade as XR',()=>{
  const f=fixture();f.overlay.open();f.overlay.setSession({});
  assert.equal(f.panel.hidden,true);assert.equal(f.root.style.display,'none');
  assert.equal(f.overlay.open(),false);assert.match(f.notices[0],/does not provide DOM overlay/);
  f.overlay.setSession({domOverlayState:{type:'floating'}});assert.equal(f.overlay.open(),true);
  assert.match(f.status.textContent,/floating/);
  f.overlay.setSession(null);assert.equal(f.panel.hidden,true);assert.equal(f.overlay.open(),true);
});

test('remote/HTTPS routes cannot redirect to headset localhost or weaken origin guards',()=>{
  for(const location of [{protocol:'https:',hostname:'127.0.0.1'},{protocol:'http:',hostname:'192.168.1.4'},
    {protocol:'https:',hostname:'matrix.example'},{protocol:'http:',hostname:'127.0.0.1.attacker.test'}]){
    const f=fixture(location);f.overlay.setSession({domOverlayState:{type:'head-locked'}});f.overlay.open();
    assert.equal(f.frame.src,undefined);assert.equal(f.frame.hidden,true);assert.equal(f.standalone.hidden,true);
    assert.match(f.notice.textContent,/approved same-origin connection/);
  }
  assert.equal(professorRoute({protocol:'http:',hostname:'localhost'}).url,'http://localhost:3108/');
});

test('beforexrselect is cancelled, outer shortcuts stop, and active grabs/recordings are not interrupted',()=>{
  const f=fixture(undefined,()=> 'Finish the current grab.');
  assert.equal(f.overlay.open(),false);assert.equal(f.frame.src,undefined);assert.deepEqual(f.changes,[]);
  assert.equal(f.root.dispatchEvent(new Event('beforexrselect',{cancelable:true})),false);
  const escape=new Event('keydown',{cancelable:true});Object.defineProperty(escape,'key',{value:'Escape'});
  const active=fixture();active.overlay.open();active.panel.dispatchEvent(escape);assert.equal(active.panel.hidden,true);
});

test('Matrix controller, pointer and thumbstick world handlers ignore input while the full page is open',()=>{
  const view=Object.create(MatrixView.prototype);view.professorOpen=true;
  assert.doesNotThrow(()=>view.selectFromController(null));
  assert.doesNotThrow(()=>view.pointerDown(null));
  view.renderer={xr:{getSession:()=>({inputSources:[{gamepad:{mapping:'xr-standard',buttons:[{},{},{},{pressed:true}]}}]})}};
  let toggles=0;view.toggleOperatorPanel=()=>toggles++;
  view.updateOperatorShortcut();assert.equal(toggles,0);
  view.professorOpen=false;view.updateOperatorShortcut();assert.equal(toggles,0,'held press is not replayed on close');
});

test('the existing XR Operator panel exposes Professor without removing its controls',()=>{
  const oldDocument=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},strokeRect(){},fillText(){},measureText:()=>({width:1})})})};
  try{
    const panel=operatorPanel();const hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    assert.equal(hit(850,130),'open-professor');assert.equal(hit(895,71),'hide-panel');
    panel.toggleAgent();assert.equal(hit(850,130),'open-professor');
    assert.equal(hit(190,212),'creation-mode-auto');
  }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});
