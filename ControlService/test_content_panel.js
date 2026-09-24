// Dependency-free content-panel regressions. All API responses are fixtures;
// this does not establish browser rendering or headset acceptance.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let decodeFailure=false,decodeWidth=512,decodeHeight=512,decodeMutation=null;
const html=fs.readFileSync(path.join(__dirname,'content.html'),'utf8'),elements=new Map();
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this._value='';this.textContent='';this.disabled=false;this.checked=false;this.replacements=0;}
 set id(v){this._id=v;elements.set(v,this);}get id(){return this._id;}
 set value(v){this._value=v;}get value(){return this._value;}
 set src(value){this._src=value;if(this.tag==='img'&&this.onload)queueMicrotask(()=>{if(decodeMutation)decodeMutation();this.naturalWidth=decodeWidth;this.naturalHeight=decodeHeight;if(decodeFailure)this.onerror?.();else this.onload?.();});}get src(){return this._src;}
 get options(){return this.children;}
 append(...nodes){this.children.push(...nodes);if(this.tag==='select'&&!this._value&&this.children.length)this._value=this.children[0].value;}
 replaceChildren(...nodes){this.children=nodes;this.replacements++;if(this.tag==='select')this._value=nodes[0]?.value||'';}
 setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}removeAttribute(k){delete this.attributes[k];if(k==='href')delete this.href;}
 contains(e){return e===this||this.children.some(c=>c.contains(e));}
 scrollIntoView(options){this.scrollCount=(this.scrollCount||0)+1;this.scrollOptions=options;}
 addEventListener(){}
}
for(const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)){const e=new Element(match[1]);e.id=match[2];}
for(const match of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g))for(const item of match[2].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)){const e=new Element('option');e.value=item[1];e.textContent=item[2];elements.get(match[1]).append(e);}
const walk=e=>[e,...e.children.flatMap(walk)],all=()=>[...new Set([...elements.values()].flatMap(walk))],q=s=>all().filter(e=>s==='button'?e.tag==='button':s==='a[data-prefab-key]'?e.tag==='a'&&e.dataset.prefabKey:false);
const document={activeElement:null,getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),querySelectorAll:q};
const beaconSource={providerId:'fixture',packId:'props',version:'1.0.0',sha256:'a'.repeat(64),platform:'Android',unityVersion:'6000.6.0f1'};
const room={online:true,runtime:{mode:'ar',state:'ready',alignmentVerified:true},snapshot:{assets:[
 {assetId:'block',displayName:'Terracotta block',spawnScale:0.2,localBounds:{center:{x:0,y:0.5,z:0},size:{x:1,y:1,z:1}}},
 {assetId:'chair',displayName:'Chair',spawnScale:1},
 ...['column','orb','pedestal','table','wall'].map(id=>({assetId:id,displayName:id,spawnScale:1})),
 {assetId:'fixture:props:1.0.0:beacon',displayName:'Beacon',spawnScale:1,description:'A fixture prop.',source:beaconSource,localBounds:{center:{x:0,y:0.25,z:0},size:{x:0.32,y:0.5,z:0.32}}}
]}};
const content={runtime:{supported:true,online:true,platform:'Android',unityVersion:'6000.6.0f1'},providers:[],categories:[],jobs:[],imports:[],generations:[],configured:true};
const catalog={assets:['Android','StandaloneWindows64'].map(platform=>({assetId:'props',providerId:'fixture',version:'1.0.0',title:'Fixture props',targetPlatform:platform,runtimeLoadable:true,license:{name:'MIT'},metadata:{contentPack:{...beaconSource,platform,sha256:(platform==='Android'?'a':'b').repeat(64),assets:[{assetId:'fixture:props:1.0.0:beacon',displayName:'Beacon',spawnScale:1}]}}}))};
const sampleBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhCkAAAAASUVORK5CYII=','base64');
const sampleHash=require('node:crypto').createHash('sha256').update(sampleBytes).digest('hex');
const preview={providerId:'fixture',assetId:'beacon-preview',version:'1.0.0',targetPlatform:'Android',format:'png',sha256:sampleHash,byteLength:sampleBytes.length,metadata:{tags:['prefab-preview','prefab:fixture:props:1.0.0:beacon','unity:6000.6.0f1','bundle:'+beaconSource.sha256]}};
const calls=[],requests=[];let preparedOverride=null,downloadBytes=sampleBytes,downloadMutation=null;
class FileReaderFixture{readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result='data:'+blob.type+';base64,'+Buffer.from(buffer).toString('base64');this.onload?.();},()=>this.onerror?.());}}
const context=vm.createContext({document,console,Map,Set,JSON,Number,Error,Promise,Uint8Array,Blob,crypto:require('node:crypto').webcrypto,FileReader:FileReaderFixture,queueMicrotask,encodeURIComponent,setInterval:()=>0,setTimeout,clearTimeout,fetch:async(url,options)=>{calls.push(url);requests.push({url,options});if(url==='/api/content/prepare')return {ok:true,json:async()=>({...structuredClone(preview),downloadPath:'/api/content/files/'+preview.sha256,...preparedOverride})};if(url.startsWith('/api/content/files/')){if(downloadMutation)downloadMutation();return new Response(downloadBytes);}return {ok:true,json:async()=>structuredClone(url==='/api/state'?room:content)};}});
const run=code=>vm.runInContext(code,context),el=id=>elements.get(id),tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 run(html.match(/<script>([\s\S]*?)<\/script>/)[1]);await tick();await tick();
 assert.equal(el('prefabCards').children.length,8,'Live installed assets appear immediately');
 assert.equal(q('a[data-prefab-key]').filter(a=>a.getAttribute('aria-disabled')==='false').length,8);
 assert.equal(calls.some(url=>url==='/api/content/search'),false,'Opening browser never searches providers automatically');
 context.testCatalog=catalog;run('rememberPrefabPacks(testCatalog);controls()');
 assert.equal(run('prefabRows().length'),9,'Android and Windows versions stay distinct; installed Android deduplicated');
 assert.equal(run('prefabRows().filter(r=>r.ready).length'),8);
 const windowsCard=el('prefabCards').children.find(e=>walk(e).some(n=>n.textContent==='StandaloneWindows64 · Unity 6000.6.0f1'));
 assert(windowsCard);assert.equal(walk(windowsCard).find(e=>e.tag==='button').disabled,true,'Wrong platform install is disabled');
 assert.equal(run("prefabSize(sceneState.snapshot.assets.find(a=>a.assetId==='block')).text"),'0.2 × 0.2 × 0.2 m');
 const sourceFilter=el('prefabSource');document.activeElement=sourceFilter;sourceFilter.value='fixture';const sourceOptions=sourceFilter.children;sourceFilter.onchange();
 assert.equal(el('prefabCards').children.length,2,'Changing focused source filter updates cards immediately');assert.equal(sourceFilter.children,sourceOptions,'Focused source options are preserved');assert.equal(document.activeElement,sourceFilter);
 sourceFilter.value='';sourceFilter.onchange();assert.equal(el('prefabCards').children.length,9);document.activeElement=null;
 const stableCards=el('prefabCards').children;run('renderPrefabBrowser()');assert.equal(el('prefabCards').children,stableCards,'Unchanged polling does not recreate cards');
 const query=el('prefabQuery');document.activeElement=query;query.value='chair';query.oninput();assert.equal(el('prefabCards').children.length,1);assert.equal(document.activeElement,query);
 const link=q('a[data-prefab-key]')[0];assert.equal(link.href,'/?prefab=chair');document.activeElement=link;const oldCard=el('prefabCards').children[0];
 run("sceneState.snapshot.assets=sceneState.snapshot.assets.filter(a=>a.assetId!=='chair');renderPrefabBrowser();controls()");
 assert.equal(el('prefabCards').children[0],oldCard,'Focused action is not replaced by polling');assert.equal(link.getAttribute('aria-disabled'),'true','Removed asset disables focused link immediately');
 document.activeElement=null;run('renderPrefabBrowser()');assert.notEqual(el('prefabCards').children[0],oldCard);
 query.value='';query.oninput();run('sceneState.online=false;renderPrefabBrowser();controls()');assert(q('a[data-prefab-key]').every(a=>a.getAttribute('aria-disabled')==='true'));assert.match(el('prefabStatus').textContent,/last-reported/);
 run('sceneState.online=true;sceneState.snapshot.readOnly=true;renderPrefabBrowser();controls()');assert.match(el('prefabStatus').textContent,/retained for recovery/);
 run('sceneState.snapshot.readOnly=false;sceneState.runtime.alignmentVerified=false;renderPrefabBrowser();controls()');assert.match(el('prefabStatus').textContent,/Confirm the real room outlines/);
 run("sceneState.snapshot.assets.find(a=>a.source).source.sha256='c'.repeat(64)");assert.equal(run('prefabRows().length'),9,'Different checksum cannot merge with installed version');
 run('sceneFresh=false;renderPrefabBrowser();controls()');assert(q('a[data-prefab-key]').every(a=>a.getAttribute('aria-disabled')==='true'),'Failed state request never leaves actionable last report');
 el('prefabAvailability').value='available';el('prefabAvailability').onchange();assert(el('prefabCards').children.every(e=>!walk(e).some(n=>n.tag==='a'&&n.dataset.prefabKey)));
 context.preview=preview;context.roomFixture=room;context.contentFixture=content;
 document.activeElement=null;el('prefabAvailability').value='all';el('prefabQuery').value='';
 run('sceneState=JSON.parse(JSON.stringify(roomFixture));state=JSON.parse(JSON.stringify(contentFixture));sceneFresh=true;contentFresh=true;prefabImages=[preview];renderPrefabBrowser(true);controls()');
 const beaconKey=run("prefabRows().find(r=>r.asset.source?.platform==='Android').key");context.beaconKey=beaconKey;
 assert.equal(run('!!prefabPreviewCandidate(prefabRows().find(r=>r.key===beaconKey))'),true);
 assert.equal(run("!!prefabPreviewCandidate(prefabRows().find(r=>r.asset.source?.platform==='StandaloneWindows64'))"),false,'Platform variants cannot borrow another platform sample');
 for(const change of [{providerId:'other'}, {targetPlatform:'Any'}, {format:'svg'}, {byteLength:1048577}, {metadata:{tags:['prefab-preview','prefab:fixture:props:1.0.0:beacon','unity:6000.6.0f1','bundle:wrong']}}, {metadata:{tags:['prefab-preview','prefab:fixture:props:1.0.0:beacon','unity:old','bundle:'+beaconSource.sha256]}}, {metadata:{tags:['prefab-preview','prefab:other','unity:6000.6.0f1','bundle:'+beaconSource.sha256]}}]){
  context.changedPreview={...structuredClone(preview),...change};run('prefabImages=[changedPreview]');assert.equal(run('prefabPreviewCandidate(prefabRows().find(r=>r.key===beaconKey))'),null,'Mismatched or unsupported preview must not bind');
 }
 context.bundledPreview={...structuredClone(preview),assetId:'block-preview',metadata:{tags:['prefab-preview','prefab:block','unity:6000.6.0f1','bundled']}};
 run('prefabImages=[bundledPreview]');assert.equal(run("!!prefabPreviewCandidate(prefabRows().find(r=>r.asset.assetId==='block'))"),true,'Bundled samples bind by exact asset, platform and Unity');
 run("prefabImages[0].metadata.tags=prefabImages[0].metadata.tags.filter(t=>t!=='bundled')");assert.equal(run("prefabPreviewCandidate(prefabRows().find(r=>r.asset.assetId==='block'))"),null);
 run('prefabImages=[preview];renderPrefabBrowser(true);controls()');
 const sampleButton=q('button').find(e=>e.textContent==='Preview prefab');assert(sampleButton);document.activeElement=sampleButton;
 const previewCards=el('prefabCards').children;el('token').value='preview-test-token';
 await run('loadPrefabPreview(beaconKey)');
 assert.equal(el('prefabCards').children,previewCards,'Loading a thumbnail preserves the focused card action');
 assert.equal(document.activeElement,sampleButton);assert.equal(el('prefabSample').hidden,false);assert.equal(el('prefabSample').scrollCount,1,'Explicit preview brings the larger image into view');assert.equal(el('prefabSample').scrollOptions.block,'center');run('syncPrefabPreviews()');assert.equal(el('prefabSample').scrollCount,1,'Polling never scrolls the page');assert.match(el('prefabSampleCaption').textContent,/Unity Editor sample.*no scene edits/);
 assert.equal(walk(el('prefabCards')).filter(e=>e.tag==='img'&&e.src?.startsWith('data:image/png;base64,')).length,1,'Actual image appears inside the card');
 assert.equal(requests.find(r=>r.url==='/api/content/prepare').options.headers.Authorization,'Bearer preview-test-token');
 assert.equal(requests.find(r=>r.url.startsWith('/api/content/files/')).options.headers.Authorization,'Bearer preview-test-token');
 assert.equal(requests.find(r=>r.url.startsWith('/api/content/files/')).options.redirect,'error');
 const prepareCount=calls.filter(url=>url==='/api/content/prepare').length;await run('loadPrefabPreview(beaconKey)');assert.equal(calls.filter(url=>url==='/api/content/prepare').length,prepareCount,'Repeated preview reuses verified image');
 assert.equal(calls.some(url=>['/api/command','/api/plan','/api/apply_plan','/api/content/install'].includes(url)),false,'Preview never changes a scene, invokes AI or installs a pack');
 run('prefabPreviewCache.clear()');preparedOverride={downloadPath:'https://untrusted.invalid/image.png'};
 await assert.rejects(run('loadPrefabPreview(beaconKey)'),/prepared sample/);preparedOverride=null;
 assert.equal(calls.some(url=>url.startsWith('https:')),false,'Metadata cannot choose an external image URL');
 preparedOverride={sha256:'f'.repeat(64)};await assert.rejects(run('loadPrefabPreview(beaconKey)'),/prepared sample/);preparedOverride=null;
 downloadBytes=Buffer.concat([sampleBytes,Buffer.from([1])]);await assert.rejects(run('loadPrefabPreview(beaconKey)'),/declared size/);
 downloadBytes=Buffer.from(sampleBytes);downloadBytes[20]^=1;await assert.rejects(run('loadPrefabPreview(beaconKey)'),/checksum/);
 downloadBytes=Buffer.alloc(sampleBytes.length,60);await assert.rejects(run('loadPrefabPreview(beaconKey)'),/PNG or JPEG/);
 downloadBytes=sampleBytes;decodeFailure=true;await assert.rejects(run('loadPrefabPreview(beaconKey)'),/could not display/);assert.equal(el('prefabSample').hidden,true);assert.equal(run('prefabPreviewCache.size'),0);decodeFailure=false;
 decodeWidth=2049;await assert.rejects(run('loadPrefabPreview(beaconKey)'),/dimensions/);decodeWidth=512;
 decodeWidth=0;await assert.rejects(run('loadPrefabPreview(beaconKey)'),/dimensions/);decodeWidth=512;
 downloadMutation=()=>run('prefabImages=[]');
 await assert.rejects(run('loadPrefabPreview(beaconKey)'),/changed while loading/);downloadMutation=null;assert.equal(run('prefabPreviewCache.size'),0,'Stale completion cannot publish a preview');
 run('prefabImages=[preview]');decodeMutation=()=>run('prefabImages=[]');await assert.rejects(run('loadPrefabPreview(beaconKey)'),/changed while loading/);decodeMutation=null;assert.equal(run('prefabPreviewCache.size'),0,'Identity is checked again after image decoding');
 run('syncPrefabPreviews()');assert.equal(el('prefabSample').hidden,true,'Removed preview identity hides the old large sample');
 context.discovery={assets:[{providerId:'sketchfab',assetId:'a'.repeat(32),version:'live',title:'Castle',category:'objects',format:'gltf',targetPlatform:'Any',license:{name:'CC Attribution'},metadata:{sourceUrl:'https://sketchfab.com/models/'+'a'.repeat(32)},discoveryOnly:true,runtimeLoadable:false}],total:null,offset:0,limit:24,nextCursor:'next_24',hasMore:true,errors:[]};
 run('renderAssets(discovery)');
 assert.equal(el('assets').children.length,1);assert.equal(walk(el('assets')).filter(e=>e.tag==='a'&&e.href?.startsWith('https://sketchfab.com/models/')).length,1);
 assert.equal(walk(el('assets')).some(e=>e.tag==='button'&&/Download|Install/.test(e.textContent)),false,'Discovery cannot be mistaken for an installable pack');
 assert.equal(el('searchPager').children[0].textContent,'Next page');
 console.log('Content panel checks passed: prefab identity, filters, readiness, focus, handoff, authenticated bounded image previews, stale completion, and no scene edits.');
})().catch(e=>{console.error(e);process.exitCode=1;});
