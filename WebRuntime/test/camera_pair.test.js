import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixView} from '../src/view.js';

test('camera pair labels both panels and measures copy-to-pair time without calibration',async()=>{
  const priorImage=globalThis.Image,priorDocument=globalThis.document;
  const drawings=[];
  const context={drawImage:(...args)=>drawings.push(args),fillRect(){},fillText(){}};
  const canvas={getContext:()=>context,toDataURL:()=>
    `data:image/jpeg;base64,${Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64')}`};
  const cameraFrame={physical:true};
  globalThis.Image=class {async decode(){}};
  globalThis.document={createElement:kind=>{assert.equal(kind,'canvas');return canvas;}};
  try{
    const cameraFrameCapturedAtUtc='2026-09-28T12:00:00.000Z';
    const cameraStream={captureFrame:()=>({canvas:cameraFrame,cameraFrameCapturedAtUtc,
      copiedAtMonotonicMs:performance.now()})};
    const virtual={dataBase64:'virtual-jpeg',renderMs:2,
      snapshot:{scene:{roomId:'webxr-session-test'},anchors:[]}};
    const view={captureVirtual:()=>virtual,world:{spatial:{alignmentVerified:false}}};
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
    assert.equal(drawings[0][0],cameraFrame);
    assert.equal(drawings[0][1],0);
    assert.equal(drawings[1][1],640);
  }finally{
    if(priorImage===undefined)delete globalThis.Image;else globalThis.Image=priorImage;
    if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;
  }
});
