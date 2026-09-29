import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixView} from '../src/view.js';

test('virtual frame returns unencoded pixels at the requested panel size',()=>{
  const priorDocument=globalThis.document;
  const previousTarget={previous:true},targetHistory=[],readSizes=[];
  let imageData;
  const canvas={width:0,height:0,toDataURL:()=>{throw Error('Frame renderer must not JPEG-encode');},
    getContext:()=>({createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),
      putImageData:value=>{imageData=value;}})};
  globalThis.document={createElement:kind=>{assert.equal(kind,'canvas');return canvas;}};
  try{
    const renderer={xr:{isPresenting:false,enabled:true},getRenderTarget:()=>previousTarget,
      setRenderTarget:target=>targetHistory.push(target),render(){},
      readRenderTargetPixels:(_target,_x,_y,width,height,pixels)=>{
        readSizes.push([width,height]);
        pixels[0]=10;pixels[(height-1)*width*4]=20;
      }};
    const scene={background:null},operatorPanel={group:{visible:true}};
    const view={renderer,scene,operatorPanel,camera:new THREE.PerspectiveCamera(70,4/3,.02,100),
      world:{snapshot:()=>({scene:{roomId:'test-room'},anchors:[]})},viewer:()=>null};
    const frame=MatrixView.prototype.renderVirtualFrame.call(view,
      {captureId:'capture-test',revision:0},'client-test',640,480);
    assert.equal(frame.canvas,canvas);
    assert.deepEqual([canvas.width,canvas.height],[640,480]);
    assert.deepEqual(readSizes,[[640,480]]);
    assert.equal(imageData.data[0],20,'GPU rows are flipped into top-down canvas order');
    assert.equal(imageData.data[(480-1)*640*4],10);
    assert.equal(frame.virtual.camera.aspect,4/3);
    assert.ok(frame.virtual.renderMs>=0);
    assert.equal(targetHistory.at(-1),previousTarget);
    assert.equal(renderer.xr.enabled,true);
    assert.equal(operatorPanel.group.visible,true);
  }finally{
    if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;
  }
});

test('camera pair labels both panels and measures copy-to-pair time without calibration',async()=>{
  const priorImage=globalThis.Image,priorDocument=globalThis.document;
  const drawings=[],sizes=[],qualities=[];
  const context={drawImage:(...args)=>drawings.push(args),fillRect(){},fillText(){}};
  const canvas={getContext:()=>context,toDataURL:(_type,quality)=>{
    qualities.push(quality);
    return `data:image/jpeg;base64,${Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64')}`;
  }};
  const cameraFrame={physical:true},virtualFrame={virtual:true};
  globalThis.Image=class {constructor(){throw Error('Mixed capture must not decode a virtual JPEG');}};
  globalThis.document={createElement:kind=>{assert.equal(kind,'canvas');return canvas;}};
  try{
    const cameraFrameCapturedAtUtc='2026-09-28T12:00:00.000Z';
    const cameraStream={captureFrame:()=>({canvas:cameraFrame,cameraFrameCapturedAtUtc,
      copiedAtMonotonicMs:performance.now()})};
    const virtual={renderMs:2,
      snapshot:{scene:{roomId:'webxr-session-test'},anchors:[]}};
    const view={renderVirtualFrame:(_request,_client,width,height)=>{
      sizes.push([width,height]);return {canvas:virtualFrame,virtual};
    },world:{spatial:{alignmentVerified:false}}};
    const pair=await MatrixView.prototype.captureCameraPair.call(view,
      {captureId:'capture-test'},'client-test',cameraStream);
    assert.equal(pair.source,'webxr_camera_pair');
    assert.equal(pair.mode,'mixed');
    assert.equal(pair.includesPhysicalCamera,true);
    assert.equal(pair.includesPassthrough,false);
    assert.equal(pair.cameraFrameCapturedAtUtc,cameraFrameCapturedAtUtc);
    assert.ok(Number.isFinite(pair.cameraToPairMs)&&pair.cameraToPairMs>=0);
    assert.deepEqual(pair.layout,{kind:'side-by-side',cameraPanel:[0,0,640,480],
      virtualPanel:[640,0,640,480],calibrated:false});
    assert.deepEqual(sizes,[[640,480]]);
    assert.deepEqual(qualities,[.75],'only the final composite is JPEG-encoded');
    assert.equal(drawings[0][0],cameraFrame);
    assert.equal(drawings[0][1],0);
    assert.equal(drawings[1][0],virtualFrame);
    assert.equal(drawings[1][1],640);
  }finally{
    if(priorImage===undefined)delete globalThis.Image;else globalThis.Image=priorImage;
    if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;
  }
});

test('virtual-only capture keeps the 960×720 render and JPEG size budget',()=>{
  const sizes=[],qualities=[];
  const limit=4*Math.ceil(512*1024/3);
  const canvas={toDataURL:(_type,quality)=>{
    qualities.push(quality);
    return `data:image/jpeg;base64,${quality===.75?'x'.repeat(limit+1):'jpeg'}`;
  }};
  const virtual={mode:'virtual',width:960,height:720,renderMs:3};
  const view={renderVirtualFrame:(_request,_client,width,height)=>{
    sizes.push([width,height]);return {canvas,virtual,renderedAtMs:performance.now()};
  }};
  const result=MatrixView.prototype.captureVirtual.call(view,{captureId:'virtual'},'client-test');
  assert.deepEqual(sizes,[[960,720]]);
  assert.deepEqual(qualities,[.75,.55]);
  assert.equal(result.dataBase64,'jpeg');
  assert.equal(result.width,960);
  assert.equal(result.height,720);
  assert.ok(result.encodeMs>=0);
});
