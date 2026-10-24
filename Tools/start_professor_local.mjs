// Loopback Professor launcher, also reachable by an explicitly connected USB Quest.
// Preserves the existing 3107/3108 demos.
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createConnection} from 'node:net';
import {openSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const professor=resolve(process.argv[2] || join(root,'..','sota-professor'));
for(const path of [join(root,'WebRuntime/dist/index.html'),join(professor,'dist/index.html'),join(professor,'dist-matrix/index.html')])
  if(!existsSync(path))throw Error('Build both applications and Professor build:matrix before starting.');
const connected=port=>new Promise(resolve=>{
  const socket=createConnection({host:'127.0.0.1',port});socket.setTimeout(1000);
  socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));
  socket.once('timeout',()=>{socket.destroy();resolve(false);});
});
for(const port of [8765,3110])if(await connected(port))throw Error(`Port ${port} is already occupied. No existing service was replaced.`);
const {discoverCodex}=await import(pathToFileURL(join(professor,'server/codex.mjs')));
const native=discoverCodex();if(!native)throw Error('Existing native Codex executable not found; no login or configuration was changed.');
const environment={...process.env};
for(const key of Object.keys(environment))if(/^(OPENAI_|CODEX_API_KEY$|AZURE_OPENAI_)/i.test(key))delete environment[key];
const login=spawnSync(native,['login','status'],{env:environment,encoding:'utf8',windowsHide:true,timeout:10000});
if(login.status!==0||!/logged in using ChatGPT/i.test(`${login.stdout}\n${login.stderr}`))
  throw Error('Existing ChatGPT-managed Codex sign-in is required. No login, keys or access were changed.');
const evidence=execFileSync(native,['--version'],{env:environment,encoding:'utf8',windowsHide:true,timeout:10000}).trim();
if(evidence!=='codex-cli 0.159.0')throw Error('Native version needs review before using this verified candidate.');
environment.SANDBOX_AI_MODE='codex-cli';environment.SANDBOX_CODEX_EXE=native;
// Explicit owner preference for this local Professor launcher, not a global Codex setting.
environment.SANDBOX_CODEX_AGENT_SANDBOX='danger-full-access';
environment.SANDBOX_CODEX_AGENT_APPROVAL_POLICY='never';
environment.SANDBOX_CODEX_MODEL ||= 'gpt-6.1-sol';
const data=join(root,'.utmp','professor-local');mkdirSync(data,{recursive:true});
const avatars=spawnSync('python',[join(root,'Tools','install_professor_avatars.py'),'--catalog',join(data,'assets')],{cwd:root,encoding:'utf8',windowsHide:true});
if(avatars.status!==0)throw Error('Bundled professor models could not be registered. No services were started.');
const children=[];
function start(command,args,cwd,name){
  const child=spawn(command,args,{cwd,env:environment,windowsHide:true,detached:true,
    stdio:['ignore',openSync(join(data,`${name}.log`),'a'),openSync(join(data,`${name}.err.log`),'a')]});
  child.on('error',()=>{});children.push(child);child.unref();return child;
}
try{
  start(process.execPath,[join(professor,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','3110','--strictPort'],professor,'professor');
  start('python',['ControlService/server.py','--host','127.0.0.1','--port','8765','--scenes',join(data,'scenes'),
    '--web-assets',join(data,'assets'),'--web-environments',join(data,'environments'),
    '--professor-ui',join(professor,'dist-matrix'),'--professor-port','3110'],root,'matrix');
  for(let attempt=0;attempt<30;attempt++){
    if(await connected(8765)&&await connected(3110))break;
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  if(!await connected(8765)||!await connected(3110))throw Error('Candidate startup failed; inspect the private local logs.');
  const receipt={matrixUrl:'http://127.0.0.1:8765/web/',professorUrl:'http://127.0.0.1:3110/',
    dataDirectory:data,professorSource:professor,pids:children.map(child=>child.pid),nativeVersion:evidence,
    existingServiceAuthConfigured:!!environment.SANDBOX_TOKEN,operatorPermissions:'full-access',existing3108Unchanged:true};
  writeFileSync(join(data,'startup.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}catch(error){for(const child of children)try{child.kill();}catch{}throw error;}
