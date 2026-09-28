import test from 'node:test';
import assert from 'node:assert/strict';
import {PanoramaUI} from '../src/panorama_ui.js';

test('single native panorama notice changes from generating to ready on refreshed status',async()=>{
  const sessionId='a'.repeat(32);
  const job={conceptId:'1'.repeat(32),version:1,status:'generating'};
  const client={sessionId,panoramaJobs:[job],
    async generatePanorama(){return job;}};
  const ui=Object.create(PanoramaUI.prototype);
  Object.assign(ui,{client,ensureSession:async()=>sessionId,getSession:()=>sessionId,
    els:{provider:{value:'codex-native'},prompt:{value:''}},render(){},onChange(){},
    batch:null,busy:false,notice:'',noticeError:false,pendingGeneration:null});
  await ui.generate('moonlit forest');
  assert.match(ui.notice,/generating/);
  job.status='ready';await ui.advanceQueue();
  assert.equal(ui.pendingGeneration,null);
  assert.match(ui.notice,/Version 1 ready/);
  assert.doesNotMatch(ui.notice,/generating/);
});

test('multiple native panorama versions submit only after the prior version is ready',async()=>{
  const sessionId='a'.repeat(32),jobs=[];
  const client={sessionId,panoramaJobs:jobs,
    async generatePanorama(id,prompt,{providerId}){
      assert.equal(id,sessionId);assert.equal(prompt,'moonlit forest');
      assert.equal(providerId,'codex-native');
      const job={conceptId:String(jobs.length+1).repeat(32),
        version:jobs.length+1,status:'generating'};
      jobs.push(job);return job;
    }};
  const ui=Object.create(PanoramaUI.prototype);
  Object.assign(ui,{client,ensureSession:async()=>sessionId,getSession:()=>sessionId,
    els:{provider:{value:'codex-native'},prompt:{value:''}},render(){},onChange(){},
    batch:null,busy:false,notice:'',noticeError:false});
  await ui.generateMany('moonlit forest',3,2);
  assert.equal(jobs.length,1,'only one Codex image turn may be active');
  await ui.advanceQueue();assert.equal(jobs.length,1);
  jobs[0].status='ready';await ui.advanceQueue();
  assert.equal(jobs.length,2);
  await ui.advanceQueue();assert.equal(jobs.length,2);
  jobs[1].status='ready';await ui.advanceQueue();
  assert.equal(jobs.length,3);
  jobs[2].status='ready';await ui.advanceQueue();
  assert.equal(ui.batch,null);
  assert.match(ui.notice,/Preview, choose, then apply/);
  assert.match(ui.notice,/not applied yet/);
});

test('failed panorama version stops the batch without starting another',async()=>{
  const sessionId='a'.repeat(32);
  const jobs=[];
  const client={sessionId,panoramaJobs:jobs,
    async generatePanorama(){const job={conceptId:String(jobs.length+1).repeat(32),
      version:jobs.length+1,status:'generating'};jobs.push(job);return job;}};
  const ui=Object.create(PanoramaUI.prototype);
  Object.assign(ui,{client,ensureSession:async()=>sessionId,getSession:()=>sessionId,
    els:{provider:{value:'codex-native'},prompt:{value:''}},render(){},onChange(){},
    batch:null,busy:false,notice:'',noticeError:false});
  await ui.generateMany('moonlit forest',3);
  jobs[0].status='failed';await ui.advanceQueue();
  assert.equal(jobs.length,1);
  assert.equal(ui.batch,null);
  assert.match(ui.notice,/Earlier ready versions remain/);
});

test('apply rejects a changed selected version before registration or world mutation',async()=>{
  const sessionId='a'.repeat(32);
  const first={conceptId:'1'.repeat(32),version:1,status:'ready'};
  const second={conceptId:'2'.repeat(32),version:2,status:'ready'};
  let selected=first,registered=false,applied=false;
  const client={sessionId,get selectedPanorama(){return selected;},
    async refresh(){selected=second;},
    async registerPanorama(){registered=true;}};
  const ui=Object.create(PanoramaUI.prototype);
  Object.assign(ui,{client,ensureSession:async()=>sessionId,getSession:()=>sessionId,
    canApply:()=>'',apply:async()=>{applied=true;},
    els:{yaw:{value:'0'},name:{value:''}},render(){},onChange(){}});
  await assert.rejects(ui.applySelected({conceptId:first.conceptId,version:1}),
    /Selected panorama changed/);
  assert.equal(registered,false);
  assert.equal(applied,false);
});
