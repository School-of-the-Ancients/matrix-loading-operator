import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializePanelSections,revealPanelSection,revealAgentAttention} from '../src/panel_sections.js';

function details(id,open=false,parentElement=null){
  const listeners=new Map();
  return {id,open,parentElement,tagName:'DETAILS',
    addEventListener(name,listener){listeners.set(name,listener);},
    toggle(){this.open=!this.open;listeners.get('toggle')();}};
}

function storage(initial){
  const values=new Map(initial?[['matrix:web:panel-sections:v1',initial]]:[]);
  return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
}

test('browser sections restore tab preferences and retain independent expansion state',()=>{
  const agent=details('section-agent',true),planner=details('section-planner');
  const concept=details('concept-panel',false,agent);
  const root={querySelectorAll:()=>[agent,concept,planner]};
  const tab=storage(JSON.stringify({'section-agent':false,'section-planner':true}));
  initializePanelSections(root,tab);
  assert.equal(agent.open,false);
  assert.equal(concept.open,false);
  assert.equal(planner.open,true);
  concept.toggle();
  assert.deepEqual(JSON.parse(tab.getItem('matrix:web:panel-sections:v1')),
    {'section-agent':false,'concept-panel':true,'section-planner':true});
  revealPanelSection(concept);
  assert.equal(agent.open,true,'revealing a nested control opens its parent');
  assert.equal(concept.open,true);
  assert.equal(planner.open,true);
});

test('bad or unavailable UI storage leaves native default sections usable',()=>{
  const agent=details('section-agent',true);
  const root={querySelectorAll:()=>[agent]};
  initializePanelSections(root,{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});
  assert.equal(agent.open,true);
  assert.doesNotThrow(()=>agent.toggle());
  assert.equal(agent.open,false);
});

test('a new Agent approval reopens a manually collapsed active-turn section once',()=>{
  const agent=details('section-agent');
  let key=revealAgentAttention(agent,'','turn-1',null);
  assert.equal(agent.open,true,'active turn opens the section');
  agent.open=false;
  key=revealAgentAttention(agent,key,'turn-1',null);
  assert.equal(agent.open,false,'status polls preserve a manual collapse');
  const approval={turnId:'turn-1',approvalId:42};
  key=revealAgentAttention(agent,key,'turn-1',approval);
  assert.equal(agent.open,true,'approval transition reveals the review controls');
  agent.open=false;
  key=revealAgentAttention(agent,key,'turn-1',approval);
  assert.equal(agent.open,false,'same approval does not repeatedly force expansion');
  key=revealAgentAttention(agent,key,'turn-1',{...approval,approvalId:43});
  assert.equal(agent.open,true,'a later approval also opens the section');
});

test('main browser controls remain in the intended expandable sections',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const order=['section-mode','section-agent','section-planner','section-room',
    'section-world','section-citizens','section-scale','section-help'];
  const starts=order.map(id=>html.indexOf(`<details id="${id}"`));
  assert.ok(starts.every(index=>index>=0));
  assert.deepEqual(starts,[...starts].sort((a,b)=>a-b));
  assert.match(html.slice(starts[1],starts[2]),/id="agent-stop"/);
  assert.match(html.slice(starts[2],starts[3]),/id="proposal"/);
  assert.match(html.slice(starts[3],starts[4]),/id="confirm-room"/);
  assert.match(html.slice(starts[4],starts[5]),/id="save-pc-world"/);
  assert.match(html.slice(starts[5],starts[6]),/id="citizens-routine-apply"/);
  assert.match(html.slice(starts[7]),/id="token"/);
  assert.doesNotMatch(html,/<details id="section-agent"[^>]*\bopen>/);
});
