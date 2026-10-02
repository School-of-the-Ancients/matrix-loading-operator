import {MatrixWorld} from '../../WebRuntime/src/protocol.js';
import {storedWorld,saveStoredWorld,loadStoredWorld,restoreStoredWorld}
  from '../../WebRuntime/src/scene_store.js';

const initial={position:{x:1,y:0,z:-2},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
export const target={position:{x:2,y:.5,z:-3},rotation:{x:15,y:45,z:30},scale:{x:2,y:3,z:4}};
const world=new MatrixWorld(()=> 'automated-check-block');
const receipts=[];
function execute(requestId,op,data={}){
  const receipt=world.execute({requestId,op,...data});
  receipts.push(receipt);
  if(receipt.requestId!==requestId||receipt.ok!==true)throw Error(`${op}: ${JSON.stringify(receipt)}`);
  return receipt;
}
window.matrixCheck={
  ready(){return {descriptor:world.snapshot().runtimeDescriptor,userAgent:navigator.userAgent,
    secureContext:isSecureContext,fixture:'matrix-contract-v1'};},
  exercise(){
    // Fixture authoring stays in this fresh world; no PC approvals or live lease are involved.
    execute('check-spawn','spawn',{assetId:'block',anchorId:'web-floor',transform:initial});
    const scene=structuredClone(world.scene);
    execute('check-clear','clear');
    execute('check-load','load',{scene});
    execute('check-transform','set_transform',{objectId:'automated-check-block',transform:target});
    const saved=storedWorld(world);
    const error=saveStoredWorld(saved,sessionStorage,localStorage);
    if(error)throw Error(error);
    return {receipts,scene:world.scene,saved};
  },
  reopen(){
    // A newly opened page has no session copy: require the durable browser save.
    const loaded=loadStoredWorld(sessionStorage,localStorage);
    if(!loaded.value)throw Error(`Missing durable world: ${JSON.stringify(loaded)}`);
    restoreStoredWorld(world,loaded.value);
    return {scene:world.scene,world:storedWorld(world)};
  }
};
