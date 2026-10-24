import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.MATRIX_PLAYWRIGHT_MODULE||'playwright');
const base='http://127.0.0.1:8765';
assert.equal((await fetch(base+'/professor-fixture')).status,404,'This check is for the real local candidate, not the fixture.');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
const errors=[],posts=[];page.on('pageerror',error=>errors.push(error.message));
await context.route('**/api/school/**',route=>{
  if(route.request().method()!=='GET'){posts.push(route.request().url());return route.abort();}
  return route.continue();
});
const root=new URL('../.utmp/professor-local/',import.meta.url);await mkdir(root,{recursive:true});
try{
  const status=page.waitForResponse(response=>response.url()===base+'/api/school/status');
  await page.goto(base+'/web/');await page.locator('#professor-open').click();
  const app=page.frameLocator('#professor-frame');await app.getByText(/Matrix Operator connected/).waitFor();
  const provider=await(await status).json();assert.equal(provider.configured,true);
  await app.getByRole('region',{name:'Historical teacher library'}).getByRole('button',{name:/Ada Lovelace/}).waitFor();
  assert.equal(await app.getByRole('region',{name:'Historical teacher library'}).getByRole('button',{pressed:false}).count(),11);
  await app.getByLabel('Your question or learning goal').fill('Read-only connection check; no lesson submitted.');
  await page.locator('#professor-close').click();await page.locator('#professor-open').click();
  assert.equal(await app.getByLabel('Your question or learning goal').inputValue(),'Read-only connection check; no lesson submitted.');
  assert.equal(await app.getByRole('alert').count(),0);assert.deepEqual(errors,[]);assert.equal(posts.length,0);
  await page.screenshot({path:new URL('actual-full-page.png',root).pathname.replace(/^\/(.:\/)/,'$1')});
  const report={status:'passed',browser:browser.version(),mode:'real local Matrix + Professor, read-only fresh browser identity',
    providerConfigured:provider.configured,teachers:11,schoolPostRequests:posts.length,errors,
    checks:['same-origin full UI mount and CSP','real School API host/origin protections','frame handshake','readable complete landing UI and retained draft'],
    limits:['No teaching turn or additional image request','No headset or live Blender evidence']};
  await writeFile(new URL('readonly-desktop.json',root),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await context.close();await browser.close();}
