// Requires the explicit Python + Node fixtures. It refuses a real media service.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.MATRIX_PLAYWRIGHT_MODULE || 'playwright');
const base='http://127.0.0.1:8765';
const marker=await (await fetch(base+'/professor-fixture')).json();
assert.equal(marker.fixture,true,'Run only against the explicit mock fixture.');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1100}});
const page=await context.newPage(),errors=[],turns=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('response',async response=>{if(response.url().includes('/api/professor/')&&response.status()>=400)console.log('fixture API error',response.status(),await response.text());});
page.on('request',request=>{if(new URL(request.url()).pathname==='/api/agent/turn'&&request.method()==='POST')turns.push(request.url());});
const root=new URL('../.utmp/professor-connection-browser/',import.meta.url);await mkdir(root,{recursive:true});
try{
  await page.goto(base+'/web/');await page.locator('#professor-open').click();
  const app=page.frameLocator('#professor-frame');
  await app.getByText(/Matrix Operator connected/).waitFor();
  await app.getByLabel('Your question or learning goal').fill('Explain algorithms in ordered steps');
  await app.getByLabel(/A mentor you have in mind/).fill('Ada Lovelace');
  await app.getByRole('button',{name:/Create my learning quest/}).click();
  await app.getByRole('heading',{name:'From an idea to an algorithm'}).waitFor();
  const artifact=app.getByRole('heading',{name:/Algorithm sequence cards/}).locator('..');
  await artifact.getByRole('button',{name:'Request exhibit image from Operator'}).click();
  await artifact.getByText('Operator: generating',{exact:true}).waitFor();
  await artifact.getByText('Operator: image ready',{exact:true}).waitFor();
  await artifact.getByRole('img').waitFor();
  assert.equal(await artifact.getByRole('img').evaluate(image=>image.complete&&image.naturalWidth>0),true);
  await artifact.getByRole('button',{name:'Recover existing Operator job'}).click();
  await app.getByText('Operator status verified and saved with this lesson.').waitFor();
  assert.equal((await (await fetch(base+'/professor-fixture')).json()).nativeImageCalls,marker.nativeImageCalls+1);
  await artifact.getByRole('button',{name:'Review / select / build in Matrix'}).click();
  await page.locator('#concept-list').getByRole('button',{name:'Use this version'}).last().click();
  await page.locator('#professor-open').click();
  await artifact.getByText(/Selected in Matrix/).waitFor();
  await app.getByLabel('Continue the conversation').fill('Operator, go to a historical study setting for this example.');
  await app.getByRole('button',{name:'Send message',exact:true}).click();
  const setting=app.getByRole('heading',{name:'A historical study setting · location'}).locator('..');
  await setting.getByRole('button',{name:'Request setting image from Operator'}).click();
  await setting.getByText('Operator: image ready',{exact:true}).waitFor();
  await artifact.getByRole('button',{name:'Edit prompt',exact:true}).click();
  await artifact.getByRole('textbox',{name:/Edit prompt for/}).fill('An edited static exhibit prompt. Do not run a new job until explicitly requested.');
  await artifact.getByRole('button',{name:'Save prompt',exact:true}).click();
  await artifact.getByText(/Matrix connected; not submitted/).waitFor();
  await page.screenshot({path:new URL('operator-result.png',root).pathname.replace(/^\/(.:\/)/,'$1')});
  await page.reload();await page.locator('#professor-open').click();
  await app.getByRole('navigation',{name:'Saved quests'}).getByRole('button',{name:/From an idea to an algorithm/}).first().click();
  await app.getByText('An edited static exhibit prompt. Do not run a new job until explicitly requested.',{exact:true}).waitFor();
  await app.getByRole('heading',{name:'A historical study setting · location'}).locator('..').getByText('Operator: image ready',{exact:true}).waitFor();
  const after=await (await fetch(base+'/professor-fixture')).json();
  assert.equal(after.nativeImageCalls,marker.nativeImageCalls+2);
  assert.equal(after.environment,null);assert.equal(after.pendingWorldCommands,0);assert.equal(turns.length,0);
  assert.deepEqual(errors,[]);
  const report={status:'passed',browser:browser.version(),mode:'desktop real production pages and HTTP adapters, mock teaching/native-image backend',
    checks:['complete Professor page','frame handshake','artifact generating -> image ready','actual preview bytes','duplicate recovery without generation',
      'existing Matrix version selection','structured teacher setting request -> panorama job','prompt edit marks older receipt stale',
      'reload/session and status recovery without new jobs','no automatic background apply or Blender/scene turn'],
    nativeImageFixtureCalls:after.nativeImageCalls-marker.nativeImageCalls,worldCommands:after.pendingWorldCommands,environment:after.environment,errors,
    limits:['No real image generation, Blender or headset acceptance. Fixture images are tiny test PNGs.']};
  await writeFile(new URL('report.json',root),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  await page.screenshot({path:new URL('failed-desktop.png',root).pathname.replace(/^\/(.:\/)/,'$1')});
  console.log('Fixture status notices',await page.frameLocator('#professor-frame').getByRole('status').allTextContents());
  throw error;
}finally{await context.close();await browser.close();}
