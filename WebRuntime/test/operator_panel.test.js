import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixView,operatorPanel} from '../src/view.js';

test('MatrixView exposes the creation-mode setter used by the shared UI',()=>{
  const view=Object.create(MatrixView.prototype);
  let selected=null;
  view.operatorPanel={setCreationMode:mode=>{selected=mode;}};
  view.setOperatorCreationMode('procedural');
  assert.equal(selected,'procedural');
});

test('Codex XR page exposes one shared creation-mode selector and keeps turn controls',()=>{
  const drawn=[];
  const context={
    fillRect(x,y,w,h){drawn.push({kind:'rect',x,y,w,h,color:this.fillStyle});},
    strokeRect(){},
    fillText(text,x,y){drawn.push({kind:'text',text:String(text),x,y});},
    measureText(text){return {width:String(text).length*14};},
  };
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();
    const hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    assert.equal(hit(190,212),null,'creation modes belong to the Codex page');
    panel.toggleAgent();
    assert.ok(drawn.some(item=>item.kind==='text'&&
      item.text==='METHOD FOR SELECTED IMAGE BUILDS ONLY'&&item.y===158),
      'XR mode choice only applies when building the selected image');
    assert.equal(hit(190,212),'creation-mode-auto');
    assert.equal(hit(490,212),'creation-mode-procedural');
    assert.equal(hit(810,212),'creation-mode-blender');
    assert.ok(drawn.some(item=>item.kind==='rect'&&item.x===55&&item.y===176&&
      item.color==='#53dcc5'),'Auto is selected by default');
    assert.ok(drawn.some(item=>item.kind==='text'&&item.text.startsWith('CODEX AGENT')&&
      item.y===286),'transcript starts below the selector');
    panel.setCreationMode('blender');
    assert.ok(drawn.some(item=>item.kind==='rect'&&item.x===660&&item.y===176&&
      item.color==='#53dcc5'));
    assert.equal(hit(250,680),'agent-connect');
    panel.setAgentStatus({activity:'Waiting',content:'Review this request.',pending:true,
      approvalReviewable:true,active:true,connected:true,voiceStatus:'',latestTurnId:''});
    assert.equal(hit(190,212),'creation-mode-auto');
    assert.equal(hit(150,680),'agent-approve');
    assert.equal(hit(430,680),'agent-deny');
    assert.equal(hit(650,680),'agent-stop');
    panel.setAgentStatus({activity:'Working',content:'Arranging the room.',pending:false,
      approvalReviewable:false,active:true,connected:true,voiceStatus:'',latestTurnId:'turn-1'});
    assert.equal(hit(250,680),'voice','the wearer can speak an addition during a turn');
    assert.equal(hit(650,680),'agent-stop','stop remains available');
    assert.throws(()=>panel.setCreationMode('anything'),/Invalid creation mode/);
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('XR concept gallery draws authenticated previews and selects the visible version',()=>{
  const drawn=[];const images=[];
  const context={fillRect(){},strokeRect(){},
    drawImage(image,x,y,width,height){drawn.push({kind:'image',image,x,y,width,height});},
    fillText(value){drawn.push({kind:'text',value:String(value)});},
    measureText(value){return {width:String(value).length*12};}};
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel({createImage:()=>{
      const image={naturalWidth:800,naturalHeight:400,onload:null,onerror:null};
      images.push(image);return image;
    }});
    const hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    panel.setConceptGallery([
      {conceptId:'one',version:1,selected:true,prompt:'First design',sourceLabel:'ComfyUI',
        previewStatus:'ready',previewObjectUrl:'blob:one'},
      {conceptId:'two',version:2,selected:false,prompt:'Second design',sourceLabel:'Codex',
        previewStatus:'ready',previewObjectUrl:'blob:two'},
    ]);
    panel.toggleAgent();
    assert.equal(hit(400,290),'open-concepts');
    panel.toggleConcepts();
    assert.equal(panel.isAgentMode(),true,'gallery voice stays in the Codex conversation');
    assert.equal(images.length,1);
    assert.equal(images[0].src,'blob:one');
    assert.equal(hit(700,596),null,'an image must be visible before it can be selected');
    images[0].onload();
    assert.ok(drawn.some(item=>item.kind==='image'&&item.image===images[0]),
      'decoded preview is painted into the in-world canvas');
    assert.equal(hit(380,596),'concept-next');
    panel.nextConcept();
    assert.equal(images.length,2);
    assert.equal(images[1].src,'blob:two');
    images[1].onload();
    assert.equal(hit(700,596),'concept-select-2');
    panel.setConceptGallery([
      {conceptId:'one',version:1,selected:false,prompt:'First design',sourceLabel:'ComfyUI',
        previewStatus:'ready',previewObjectUrl:'blob:one'},
      {conceptId:'two',version:2,selected:true,prompt:'Second design',sourceLabel:'Codex',
        previewStatus:'ready',previewObjectUrl:'blob:two'},
    ]);
    assert.equal(hit(700,596),null,'selected version cannot be submitted twice');
    assert.equal(hit(895,71),'hide-panel');
    panel.setConceptGallery([{conceptId:'two',version:2,selected:false,
      prompt:'Second design',sourceLabel:'Codex',previewStatus:'error'}]);
    assert.equal(hit(800,525),'concept-retry-2');
    assert.equal(hit(700,596),null,'failed previews cannot be blindly selected');
    panel.setConceptGallery([]);
    assert.equal(images[1].onload,null,'old-session image callbacks are discarded');
    assert.equal(hit(700,596),null);
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('Quest in-world panorama gallery previews, chooses, and applies only in Creator VR',()=>{
  const drawn=[];const images=[];
  const context={fillRect(){},strokeRect(){},
    drawImage(image){drawn.push(image);},fillText(){},
    measureText(value){return {width:String(value).length*12};}};
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel({createImage:()=>{
      const image={naturalWidth:1024,naturalHeight:512,onload:null,onerror:null};
      images.push(image);return image;
    }});
    const hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    panel.setPanoramaGallery([{conceptId:'pano',version:2,selected:false,
      prompt:'Moonlit forest',sourceLabel:'Codex GPT Image',
      previewStatus:'ready',previewObjectUrl:'blob:pano',applyAvailable:true}]);
    panel.toggleAgent();
    assert.equal(hit(400,290),'open-panoramas');
    panel.togglePanoramas();
    assert.equal(panel.isAgentMode(),true);
    assert.equal(hit(700,596),null,'a panorama preview must be decoded first');
    images[0].onload();
    assert.ok(drawn.includes(images[0]));
    assert.equal(hit(700,596),'panorama-select-2');
    panel.setPanoramaGallery([{conceptId:'pano',version:2,selected:true,
      prompt:'Moonlit forest',sourceLabel:'Codex GPT Image',
      previewStatus:'ready',previewObjectUrl:'blob:pano',applyAvailable:true}]);
    assert.equal(hit(700,596),'panorama-apply-2');
    panel.setPanoramaGallery([{conceptId:'pano',version:2,selected:true,
      prompt:'Moonlit forest',sourceLabel:'Codex GPT Image',
      previewStatus:'ready',previewObjectUrl:'blob:pano',applyAvailable:false}]);
    assert.equal(hit(700,596),null,'AR and Play/Test cannot apply a panorama');
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('Codex panel shows voice phases and returns to the first page for new feedback',()=>{
  const drawn=[];
  const context={
    fillRect(){},strokeRect(){},
    fillText(value){drawn.push(String(value));},
    measureText(value){return {width:String(value).length*14};},
  };
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();panel.toggleAgent();
    const longContent=Array(220).fill('conversation').join(' ');
    const agent={activity:'Ready',content:longContent,pending:false,
      approvalReviewable:false,active:false,connected:true,voiceStatus:'',latestTurnId:''};
    panel.setAgentStatus(agent);
    panel.nextPage();drawn.length=0;
    panel.setVoiceInputLabel('REQUESTING MIC');
    assert.ok(drawn.includes('REQUESTING MIC'));
    assert.ok(drawn.some(text=>text.startsWith('Page 2/')));
    drawn.length=0;
    panel.setAgentStatus({...agent,content:`Recording…\n\n${longContent}`,voiceStatus:'Recording…'});
    assert.ok(drawn.some(text=>text.startsWith('Page 1/')));
    assert.ok(drawn.includes('Recording…'));
    drawn.length=0;
    panel.setVoiceInputLabel('VOICE BUSY');
    assert.ok(drawn.includes('VOICE BUSY'));
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('completed Codex transcript stays on its page through background Operator updates',()=>{
  const drawn=[];
  const context={
    fillRect(){},strokeRect(){},
    fillText(value){drawn.push(String(value));},
    measureText(value){return {width:String(value).length*14};},
  };
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();panel.toggleAgent();
    const longContent=Array(220).fill('conversation').join(' ');
    const agent={activity:'Completed',content:longContent,pending:false,
      approvalReviewable:false,active:false,connected:true,voiceStatus:'',latestTurnId:'turn-one'};
    panel.setAgentStatus(agent);
    panel.nextPage();
    assert.ok(drawn.some(text=>text.startsWith('Page 2/')));
    for(let poll=0;poll<3;poll++){
      drawn.length=0;
      panel.setMessage('Operator connected. Aim at the panel and hold trigger.');
      panel.setProposal(null);
      panel.setAgentStatus({...agent,content:`${longContent} ${'more '.repeat(poll+1)}`});
      assert.ok(drawn.some(text=>text.startsWith('Page 2/')),
        'background exchange and transcript redraw must not return to page one');
    }
    drawn.length=0;
    panel.setAgentStatus({...agent,latestTurnId:'turn-two'});
    assert.ok(drawn.some(text=>text.startsWith('Page 1/')),
      'a new Codex turn should reveal its first page');
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('WORLD page keeps checkpoint feedback visible through ordinary redraws',()=>{
  const drawn=[];
  const context={
    fillRect(){},strokeRect(){},
    fillText(text,x,y){drawn.push({text:String(text),y,color:this.fillStyle});},
    measureText(text){return {width:String(text).length*14};},
  };
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();panel.toggleWorld();
    const notice=()=>drawn.find(item=>item.y===317);
    panel.setWorldNotice('Saved in browser · saving PC scene backup…','pending');
    assert.deepEqual(notice(),{text:'Saved in browser · saving PC scene backup…',y:317,color:'#dff7f8'});
    drawn.length=0;
    panel.setWorldInfo({objects:2,alignment:'Virtual room',canConfirm:false});
    assert.equal(notice().text,'Saved in browser · saving PC scene backup…');
    drawn.length=0;
    panel.setMessage('Operator connected');
    assert.equal(notice().text,'Saved in browser · saving PC scene backup…');
    drawn.length=0;
    panel.setWorldNotice('Saved in browser · PC scene backup failed.','error');
    assert.deepEqual(notice(),{text:'Saved in browser · PC scene backup failed.',y:317,color:'#ffad8d'});
    drawn.length=0;
    panel.setWorldNotice('Browser world checkpoint restored.');
    assert.deepEqual(notice(),{text:'Browser world checkpoint restored.',y:317,color:'#75f4df'});
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('XR WORLD panel can select, create and restore archived worlds with guarded controls',()=>{
  const drawn=[];
  const context={fillRect(){},strokeRect(){},
    fillText(value){drawn.push(String(value));},measureText(){return {width:0};}};
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();
    const hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    panel.toggleWorld();
    assert.equal(hit(510,570),'toggle-archives');
    panel.toggleArchives();
    panel.setWorldInfo({objects:0,alignment:'Virtual room',archiveReady:true,
      archiveCount:2,archiveIndex:1,archiveName:'Orb playground',
      archiveDetails:'6 objects · Orb Course'});
    assert.ok(drawn.includes('Orb playground'));
    assert.equal(hit(200,445),'archive-prev');
    assert.equal(hit(510,445),'archive-next');
    assert.equal(hit(200,550),'new-world');
    assert.equal(hit(745,550),'restore-archive');
    panel.setWorldInfo({objects:0,alignment:'AR room',originUnavailable:true,
      archiveReady:false,archiveCount:2,archiveIndex:1,
      archiveName:'Orb playground'});
    assert.equal(hit(200,550),null);
    assert.equal(hit(745,550),null);
    assert.equal(hit(462,71),'toggle-world');
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('XR layout page exposes movement then separate clearance and room-outline decisions',()=>{
  const context={fillRect(){},strokeRect(){},fillText(){},measureText(){return {width:0};}};
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel(),hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    panel.setXRMode('ar');panel.toggleWorld();
    panel.setWorldInfo({objects:4,alignment:'Digital layout review required',
      canPlaceLayout:true,layoutReviewPending:true,
      arLayoutOffset:{x:.25,z:-.5,yawDegrees:15}});
    assert.equal(hit(500,365),'open-layout');
    panel.openLayout();
    assert.equal(hit(200,345),'layout-forward');
    assert.equal(hit(730,345),'layout-back');
    assert.equal(hit(200,415),'layout-left');
    assert.equal(hit(730,415),'layout-right');
    assert.equal(hit(250,485),'layout-turn-left');
    assert.equal(hit(730,485),'layout-turn-right');
    assert.equal(hit(500,560),'confirm-layout');
    assert.equal(hit(500,680),'voice','room review leaves the voice footer usable');
    panel.setWorldInfo({objects:4,alignment:'Check outlines',canPlaceLayout:true,
      canConfirm:true,layoutReviewPending:false,
      arLayoutOffset:{x:.25,z:-.5,yawDegrees:15}});
    assert.equal(hit(500,560),'confirm-room');
    panel.toggleWorld();
    assert.equal(hit(200,365),'confirm-room','outlines can be confirmed from WORLD');
    assert.equal(hit(800,365),'open-layout','layout can still be adjusted from WORLD');
    panel.openLayout();
    panel.setWorldInfo({objects:4,alignment:'Room origin unavailable',
      canPlaceLayout:false,layoutReviewPending:false,
      arLayoutOffset:{x:.25,z:-.5,yawDegrees:15}});
    assert.equal(hit(200,345),null,'tracking loss hides movement controls');
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('XR room-review controls paint separately from the fixed footer',()=>{
  const drawn=[];
  let rect=null;
  const context={
    fillRect(x,y,w,h){rect={x,y,w,h};},strokeRect(){},
    fillText(label,x,y){
      if(rect&&x===rect.x+rect.w/2&&y===rect.y+rect.h/2)
        drawn.push({label:String(label),...rect});
    },measureText(){return {width:0};}
  };
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel(),hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    panel.setXRMode('ar');panel.toggleWorld();
    const pending={objects:4,alignment:'Digital layout review required',
      canPlaceLayout:true,layoutReviewPending:true,
      arLayoutOffset:{x:0,z:0,yawDegrees:0}};
    const footer=new Set(['HOLD TO SPEAK','PIN TO WALL','VOICE ON','NEXT']);
    const verify=expected=>{
      const controls=drawn.filter(item=>expected.has(item.label));
      assert.equal(controls.length,expected.size);
      const footerRects=drawn.filter(item=>footer.has(item.label));
      assert.equal(footerRects.length,footer.size);
      for(const item of controls){
        assert.ok(item.y+item.h<636,`${item.label} must end above the footer`);
        assert.equal(hit(item.x+item.w/2,item.y+item.h/2),
          expected.get(item.label),`${item.label} hit rectangle matches its painted button`);
        for(const fixed of footerRects)
          assert.ok(item.x+item.w<=fixed.x||fixed.x+fixed.w<=item.x||
            item.y+item.h<=fixed.y||fixed.y+fixed.h<=item.y,
          `${item.label} overlaps ${fixed.label}`);
      }
    };
    drawn.length=0;panel.setWorldInfo(pending);
    verify(new Map([['REVIEW DIGITAL LAYOUT','open-layout']]));
    drawn.length=0;panel.setWorldInfo({...pending,layoutReviewPending:false,
      canConfirm:true,alignment:'Check outlines'});
    verify(new Map([
      ['OUTLINES MATCH — ENABLE MEASURED EDITS','confirm-room'],
      ['MOVE / TURN LAYOUT','open-layout']
    ]));
    panel.setWorldInfo(pending);
    drawn.length=0;panel.openLayout();
    verify(new Map([
      ['FORWARD','layout-forward'],['BACK','layout-back'],
      ['LEFT','layout-left'],['RIGHT','layout-right'],
      ['TURN LEFT','layout-turn-left'],['TURN RIGHT','layout-turn-right'],
      ['I CHECKED SCENE CLEARANCE','confirm-layout']
    ]));
    drawn.length=0;panel.setWorldInfo({...pending,layoutReviewPending:false,
      canConfirm:true,alignment:'Check outlines'});
    verify(new Map([
      ['FORWARD','layout-forward'],['BACK','layout-back'],
      ['LEFT','layout-left'],['RIGHT','layout-right'],
      ['TURN LEFT','layout-turn-left'],['TURN RIGHT','layout-turn-right'],
      ['OUTLINES MATCH · ENABLE MEASURED EDITS','confirm-room']
    ]));
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('Hide remains reachable on every Operator page',()=>{
  const context={fillRect(){},strokeRect(){},fillText(){},measureText(){return {width:0};}};
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();
    const hide={x:894/1024,y:1-71/768};
    assert.equal(panel.hit(hide),'hide-panel');
    panel.toggleWorld();assert.equal(panel.hit(hide),'hide-panel');
    panel.toggleAgent();assert.equal(panel.hit(hide),'hide-panel');
    panel.setProposal({summary:'Create one block',commands:[]});
    assert.equal(panel.hit(hide),'hide-panel');
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});

test('immersive mode page exposes play, stop and return without hiding Operator',()=>{
  const context={fillRect(){},strokeRect(){},fillText(){},measureText(){return {width:0};}};
  const previousDocument=globalThis.document;
  globalThis.document={createElement:kind=>{
    assert.equal(kind,'canvas');return {width:0,height:0,getContext:()=>context};
  }};
  try{
    const panel=operatorPanel();
    const hit=(x,y)=>panel.hit({x:x/1024,y:1-y/768});
    assert.equal(hit(597,71),'toggle-mode');
    panel.toggleModePage();
    assert.equal(hit(500,485),'enter-play');
    panel.setCreatorMode({mode:'play',simulation:'running',revision:1});
    assert.equal(hit(270,480),'enter-creator');
    assert.equal(hit(745,480),'stop-play');
    panel.setCreatorMode({mode:'play',simulation:'paused',revision:2});
    assert.equal(hit(745,480),'resume-play');
    assert.equal(hit(895,71),'hide-panel');
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});
