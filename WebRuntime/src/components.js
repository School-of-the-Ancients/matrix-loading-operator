// Matrix component schema 1: a bounded numeric graph, never executable source.
// Each object has at most one attachment. Evaluation reads only base transforms,
// an optional target transform, and elapsed time; it cannot access browser APIs.
const channels=new Set(['position.x','position.y','position.z','rotation.x','rotation.y','rotation.z',
  'scale.x','scale.y','scale.z']);
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const componentId=/^webcomp:[a-z0-9][a-z0-9-]{0,39}:[0-9a-f]{12}$/;

export function validatePackage(value){
  if(!exact(value,['schemaVersion','name','outputs'])||value.schemaVersion!==1||
     typeof value.name!=='string'||value.name.length<1||value.name.length>64||
     !/^[\p{L}\p{N} ._'-]+$/u.test(value.name)||
     !value.outputs||typeof value.outputs!=='object'||Array.isArray(value.outputs))throw Error('Invalid component package');
  const outputs=Object.entries(value.outputs);
  if(outputs.length<1||outputs.length>9)throw Error('Invalid component outputs');
  let nodes=0;
  const expression=(node,depth)=>{
    if(++nodes>64||depth>8||!node||typeof node!=='object'||Array.isArray(node))
      throw Error('Component expression budget exceeded');
    if(node.op==='const'&&exact(node,['op','value'])&&finite(node.value,-1000,1000))return;
    if(node.op==='time'&&exact(node,['op']))return;
    if(['self','target'].includes(node.op)&&exact(node,['op','path'])&&channels.has(node.path))return;
    if(['sin','cos'].includes(node.op)&&exact(node,['op','arg']))return expression(node.arg,depth+1);
    if(['add','mul'].includes(node.op)&&exact(node,['op','args'])&&Array.isArray(node.args)&&
       node.args.length>=2&&node.args.length<=4){for(const arg of node.args)expression(arg,depth+1);return;}
    throw Error('Invalid component expression');
  };
  for(const [channel,node] of outputs){if(!channels.has(channel))throw Error('Invalid component output channel');expression(node,1);}
  if(new TextEncoder().encode(JSON.stringify(value)).length>4096)throw Error('Component package exceeds 4 KiB');
  return value;
}

export function validateAttachment(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     !Object.keys(value).every(key=>['componentId','package','targetObjectId','startedAtMs','status','error'].includes(key))||
     !['componentId','package','targetObjectId','startedAtMs','status'].every(key=>Object.hasOwn(value,key))||
     typeof value.componentId!=='string'||!componentId.test(value.componentId)||
     typeof value.targetObjectId!=='string'||value.targetObjectId.length>128||
     !Number.isSafeInteger(value.startedAtMs)||value.startedAtMs<0||
     !['running','stopped','failed'].includes(value.status)||
     (value.error!==undefined&&(value.status!=='failed'||typeof value.error!=='string'||value.error.length>120)))
    throw Error('Invalid component attachment');
  validatePackage(value.package);
  return value;
}

const read=(transform,path)=>{const [group,axis]=path.split('.');return transform[group][axis];};
function evaluate(node,self,target,time){
  switch(node.op){
    case 'const':return node.value;
    case 'time':return time;
    case 'self':return read(self,node.path);
    case 'target':return read(target,node.path);
    case 'sin':return Math.sin(evaluate(node.arg,self,target,time));
    case 'cos':return Math.cos(evaluate(node.arg,self,target,time));
    case 'add':return node.args.reduce((sum,arg)=>sum+evaluate(arg,self,target,time),0);
    case 'mul':return node.args.reduce((product,arg)=>product*evaluate(arg,self,target,time),1);
    default:throw Error('Invalid component expression');
  }
}

export function componentFrame(attachment,self,target,nowMs){
  if(attachment.status!=='running')return null;
  if(!target)throw Error('Component target is unavailable');
  const elapsed=Math.max(0,(nowMs-attachment.startedAtMs)/1000);
  const result=structuredClone(self);
  for(const [path,expr] of Object.entries(attachment.package.outputs)){
    const [group,axis]=path.split('.');const value=evaluate(expr,self,target,elapsed);
    const [min,max]=group==='scale'?[.01,20]:group==='rotation'?[-36000,36000]:[-100,100];
    if(!finite(value,min,max))throw Error('Component output exceeds transform bounds');
    result[group][axis]=value;
  }
  return result;
}
