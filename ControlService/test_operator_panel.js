// Dependency-free panel interaction regressions. Network responses are fixtures;
// this is not browser, headset microphone, or live-model evidence.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const elements=new Map();
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this._value='';this.disabled=false;this.hidden=false;this.textContent='';}
  set id(value){this._id=value;elements.set(value,this);} get id(){return this._id;}
  set value(value){this._value=value??'';} get value(){return this._value;}
  get options(){return this.children;}
  append(...values){this.children.push(...values);}
  replaceChildren(...values){this.children=[...values];}
  setAttribute(){} scrollIntoView(){}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(selector==='input'&&child.tag==='input'?[child]:[]),...child.querySelectorAll(selector)]);}
}
for(const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)){const element=new Element(match[1]);element.id=match[2];}
for(const mode of ['offline-rules','openai-compatible','codex-cli']){const option=new Element('option');option.value=mode;elements.get('mode').append(option);}
const info={mode:'codex-cli',provider:'Codex CLI',configured:true,model:null,availableModes:['codex-cli','offline-rules'],
  codexPreferences:{model:null,reasoningEffort:null},codexOptions:{models:[
    {id:'model-a',displayName:'Model A',reasoningEfforts:['low','medium','high'],defaultReasoningEffort:'medium'},
    {id:'model-b',displayName:'Model B',reasoningEfforts:['low'],defaultReasoningEffort:'low'}]}};
const ready={mode:'codex-cli',provider:'Codex CLI',status:'ready',phase:'ready',planId:'voice-plan',requiresApply:true,
  commands:[{op:'duplicate',objectId:'chair-1'}],summary:'Duplicate the selected chair.',transcript:'Copy this chair',assumptions:[]};
const calls=[];let rejectPreferences=false;
const context=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),querySelectorAll:()=>[]},
  console,Map,JSON,Number,Date,Error,setInterval:()=>0,clearInterval:()=>{},fetch:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):undefined;calls.push({url,body});
    if(url==='/api/planner')return {ok:true,json:async()=>structuredClone(info)};
    if(url==='/api/state')return {ok:true,json:async()=>({online:true,pendingCount:0,snapshot:null,voice:null})};
    if(url==='/api/scenes')return {ok:true,json:async()=>({scenes:[]})};
    if(url==='/api/planner_preferences')return {ok:!rejectPreferences,json:async()=>rejectPreferences?{error:'Unsupported model'}:{codex:body.codex}};
    if(url==='/api/plan')return {ok:true,json:async()=>structuredClone(ready)};
    throw Error('Unexpected request: '+url);
  }});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const element=id=>elements.get(id);
async function run(){
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);await tick();await tick();
  assert.equal(element('codexSettings').hidden,false);
  assert.equal(element('codexReasoning').disabled,true,'Unknown CLI default must not invent supported reasoning');
  element('codexModel').value='model-a';element('codexModel').onchange();await tick();
  assert.equal(element('codexReasoning').disabled,false);
  assert.deepEqual(element('codexReasoning').options.map(option=>option.value),['','low','medium','high']);
  element('codexReasoning').value='high';await element('codexReasoning').onchange();
  assert.deepEqual(calls.filter(call=>call.url==='/api/planner_preferences').at(-1).body,
                   {codex:{model:'model-a',reasoningEffort:'high'}});
  element('codexModel').value='model-b';element('codexModel').onchange();await tick();
  assert.equal(element('codexReasoning').value,'','Switching model clears incompatible reasoning');
  assert.deepEqual(element('codexReasoning').options.map(option=>option.value),['','low']);
  assert.equal(calls.some(call=>call.url==='/api/apply_plan'||call.url==='/api/command'),false,'Changing preferences cannot edit the runtime');
  rejectPreferences=true;element('codexModel').value='model-a';element('codexModel').onchange();await tick();
  assert.equal(element('codexModel').value,'model-b','Rejected preference restores confirmed settings');
  assert.match(element('codexSettingsStatus').textContent,/not changed/);rejectPreferences=false;
  element('prompt').value='Make another chair';await element('plan').onclick();
  assert.deepEqual(calls.find(call=>call.url==='/api/plan').body,
                   {text:'Make another chair',mode:'codex-cli',codex:{model:'model-b',reasoningEffort:null}});
  context.testVoice=ready;vm.runInContext('latest.voice=testVoice;renderVoice(latest.voice);controls();',context);
  assert.equal(element('reviewVoice').disabled,false);assert.match(element('voiceTranscript').textContent,/Copy this chair/);
  element('reviewVoice').onclick();assert.equal(element('proposalSummary').textContent,ready.summary);
  assert.equal(element('apply').disabled,false,'Review uses existing Apply gate');
  vm.runInContext("latest.voice.phase='applied';renderVoice(latest.voice);controls();",context);
  assert.equal(element('reviewVoice').disabled,true);
  element('mode').value='offline-rules';element('mode').onchange();
  assert.equal(element('codexSettings').hidden,true);assert.equal(element('apply').disabled,true);
  console.log('Operator panel interaction checks passed (model/effort validation, failed preference rollback, text payload, voice review, Apply gate).');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
