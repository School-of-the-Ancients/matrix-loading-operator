"""Automated desktop smoke; run only against a fresh, dedicated local service.
Requires Playwright and Chromium. Never use an existing wearer/world service.
"""
import time, os
from playwright.sync_api import sync_playwright, expect
URL=os.environ.get('MATRIX_SMOKE_URL','http://127.0.0.1:8767')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'])
    context=browser.new_context()
    page=context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL+'/web/?latency=1',wait_until='domcontentloaded')
    page.locator('#view canvas').wait_for(timeout=30000)
    expect(page.locator('#connection')).to_have_text('Operator connected',timeout=30000)
    def state():return page.evaluate("async()=>await (await fetch('/api/state')).json()")
    def poll(check):
        end=time.monotonic()+12
        while time.monotonic()<end:
            value=state()
            if check(value):return value
            page.wait_for_timeout(100)
        raise AssertionError('Smoke observation timed out')
    def command(c):
        response=page.evaluate("async c=>{const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Matrix-Trace':window.matrixLatencyTrace.snapshot().records[0]?.traceId||crypto.randomUUID().replaceAll('-','')},body:JSON.stringify(c)});return {status:r.status,body:await r.json()};}",c)
        assert response['status']==200,response
        return response['body']['commands'][0]['requestId']
    request=command({'op':'spawn','assetId':'block','anchorId':'web-floor','transform':{'position':{'x':0,'y':.5,'z':-2},'rotation':{'x':0,'y':0,'z':0},'scale':{'x':1,'y':1,'z':1}}})
    current=poll(lambda s:any(r['requestId']==request and r['ok'] for r in s['results']))
    obj=current['snapshot']['scene']['objects'][0];oid=obj['objectId'];original=obj['transform']
    request=command({'op':'select','objectId':oid})
    poll(lambda s:s['snapshot']['selection']['objectId']==oid)
    expect(page.locator('#toggle-manipulation')).to_be_enabled(timeout=10000)
    if not page.locator('#section-world').evaluate('(el)=>el.open'):page.locator('#section-world summary').click()
    page.locator('#toggle-manipulation').click()
    poll(lambda s:s['snapshot']['scene']['objects'][0].get('manipulation')=='locked')
    expect(page.locator('#toggle-manipulation')).to_have_text('Unlock selected object')
    assert state()['snapshot']['scene']['objects'][0]['transform']==original
    page.locator('#undo').click();poll(lambda s:s['snapshot']['scene']['objects'][0].get('manipulation','grabbable')=='grabbable')
    page.locator('#redo').click();poll(lambda s:s['snapshot']['scene']['objects'][0].get('manipulation')=='locked')
    trace=page.evaluate('()=>window.matrixLatencyTrace.snapshot()')
    stages={r['stage'] for r in trace['records']}
    assert {'command.queued','command.apply','frame.visible','receipt.received','receipts.acknowledged'}<=stages,stages
    assert len(trace['records'])<=256
    assert all(set(r)<={'id','stage','clock','traceId','requestId','outcome','startedMs','durationMs','bytes'} for r in trace['records'])
    assert any(r.get('requestId')==request for r in trace['records'])
    assert page.evaluate('()=>{window.matrixLatencyTrace.clear();return window.matrixLatencyTrace.snapshot().records.length;}')==0
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('#connection')).to_have_text('Operator connected',timeout=30000)
    poll(lambda s:len(s['snapshot']['scene']['objects'])==1 and s['snapshot']['scene']['objects'][0].get('manipulation')=='locked')
    request=command({'op':'select','objectId':oid});poll(lambda s:s['snapshot']['selection']['objectId']==oid)
    page.locator('#toggle-manipulation').click();poll(lambda s:s['snapshot']['scene']['objects'][0]['manipulation']=='grabbable')
    if not page.locator('#section-mode').count():
        section=page.locator('#enter-play').locator('xpath=ancestor::details')
    else:section=page.locator('#section-mode')
    if not section.evaluate('(el)=>el.open'):section.locator('summary').click()
    page.locator('#enter-play').click()
    expect(page.locator('#toggle-manipulation')).to_be_disabled()
    page.goto(URL+'/web/',wait_until='domcontentloaded')
    assert page.evaluate('()=>typeof window.matrixLatencyTrace')=='undefined'
    assert not errors,errors
    browser.close()
print('Desktop CSP-preserving Chromium smoke passed: connection, receipt/frame trace correlation, lock/unlock, Undo/Redo, browser reopen, Play gate, tracing default off. No physical headset validation.')
