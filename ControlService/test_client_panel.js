// Local owner review controls; no headset, hosted site, or real credentials.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'clients.html'),'utf8'),elements=new Map(),calls=[];
class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.textContent='';this.disabled=false;this.hidden=false;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  set innerHTML(_){throw Error('Untrusted client data must not become HTML');}
}
for(const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g))elements.set(match[2],new Element(match[1]));
const session={sessionId:'fixture-session',clientName:'<img src=x onerror=alert(1)>',status:'active',requests:[{requestId:'fixture-request',status:'ready',requiresApply:true,correlationId:'opaque-turn',proposal:{summary:'Place one block.',commands:[{op:'spawn',assetId:'cube'}],assumptions:['Use the selected floor.']},receipts:[],error:null}]};
let sessions=[structuredClone(session)],reject=false;
const context=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:tag=>new Element(tag)},JSON,Error,AbortController,setTimeout,clearTimeout,setInterval:()=>1,fetch:async(url,options)=>{
  const body=options.body===undefined?undefined:JSON.parse(options.body);calls.push({url,method:options.method,headers:options.headers,body});
  if(reject)return {ok:false,json:async()=>({error:'Authorization required'})};
  if(url==='/api/v1/operator')return {ok:true,json:async()=>({sessions:structuredClone(sessions)})};
  if(url==='/api/v1/pairings')return {ok:true,json:async()=>({pairingCode:'one-use-synthetic-code',expiresInSeconds:120})};
  if(url.endsWith('/apply')){sessions[0].requests[0].status='queued';sessions[0].requests[0].requiresApply=false;return {ok:true,json:async()=>({status:'queued'})};}
  if(url.endsWith('/cancel')){sessions[0].requests[0].status='cancelled';sessions[0].requests[0].requiresApply=false;return {ok:true,json:async()=>({status:'cancelled'})};}
  if(url.endsWith('/revoke')){sessions[0].status='revoked';return {ok:true,json:async()=>({status:'revoked'})};}
  throw Error('Unexpected request: '+url);
}});
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
const node=id=>elements.get(id),walk=value=>[value,...value.children.flatMap(walk)];
const button=label=>walk(node('sessions')).find(value=>value.tag==='button'&&value.textContent===label);
async function run(){
  await node('connect').onclick();assert.equal(calls.length,0,'No requests before owner supplies a token');
  node('token').value='synthetic-owner-token';node('clientName').value='Demo client';
  await node('connect').onclick();
  assert.ok(button('Apply reviewed proposal'));
  assert.ok(walk(node('sessions')).some(value=>value.textContent===session.clientName),'Render untrusted names as literal text');
  assert.ok(calls.every(value=>value.method==='GET'),'Loading/polling never grants access or applies work');
  await node('pair').onclick();
  const paired=calls.find(value=>value.url==='/api/v1/pairings');
  assert.deepEqual(paired.body,{clientName:'Demo client'});
  assert.equal(paired.headers.Authorization,'Bearer synthetic-owner-token');
  assert.equal(node('pairingCode').textContent,'one-use-synthetic-code');
  assert.match(node('pairingHelp').textContent,/One use.*120/);
  assert.ok(!calls.some(value=>value.url.endsWith('/apply')),'Pairing must not approve a proposal');
  await button('Apply reviewed proposal').onclick();
  assert.equal(calls.filter(value=>value.url.endsWith('/apply')).length,1);
  assert.ok(!button('Apply reviewed proposal'),'Queued work is no longer shown as reviewable');
  assert.ok(walk(node('sessions')).some(value=>value.textContent==='fixture-request · queued'));
  sessions=[structuredClone(session)];await node('connect').onclick();
  await button('Cancel proposal').onclick();
  assert.ok(walk(node('sessions')).some(value=>value.textContent==='fixture-request · cancelled'));
  await button('Revoke client').onclick();assert.ok(!button('Revoke client'));
  assert.equal(calls.filter(value=>value.url.endsWith('/revoke')).length,1);
  reject=true;await node('connect').onclick();assert.equal(node('message').textContent,'Authorization required');
  assert.match(html,/id="token" type="password" autocomplete="off"/);
  assert.ok(!/localStorage|sessionStorage|innerHTML/.test(html),'No persistent credential store or unsafe HTML rendering');
  console.log('Client owner panel checks passed: explicit pairing, literal untrusted text, review/Apply, cancellation, revocation, credential scope and no automatic mutations.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
