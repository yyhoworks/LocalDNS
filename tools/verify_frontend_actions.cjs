/* Mutation acceptance against browser fixtures only. No live backend is contacted. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist/frontend-actions-verification');
const fixtures=require('../frontend/tests/fixtures/api.json');
const metrics=fs.readFileSync(path.join(root,'frontend/tests/fixtures/metrics.prom'),'utf8');
const report={checks:[],writes:[],errors:[]};
let server,browser;
(async()=>{
 server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({channel:process.env.LOCALDNS_BROWSER||'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 let config={domestic:[{tag:'fixture-original',addr:'192.0.2.53:53',protocol:'udp',enabled:true}]},fail=false,delay=false,release;
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname;
  if(url.hostname==='api.github.com')return route.fulfill({contentType:'application/json',body:'{}'});
  if(!p.startsWith('/api/')&&!p.startsWith('/plugins/')&&p!=='/metrics')return route.continue();
  if(request.method()!=='GET'||p.endsWith('/flush')){
   const payload=request.postDataJSON();report.writes.push({path:p,method:request.method(),payload});
   if(delay){delay=false;await new Promise(resolve=>{release=resolve;});}
   if(fail)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture save failed"}'});
   if(p==='/api/v1/upstream/config')config[payload.plugin_tag]=payload.upstreams;
   return route.fulfill({contentType:'application/json',body:'{}'});
  }
  if(p==='/metrics')return route.fulfill({contentType:'text/plain',body:metrics});
  if(/^\/plugins\/switch\d+\/show$/.test(p))return route.fulfill({contentType:'text/plain',body:'A'});
  let body=p==='/api/v1/upstream/config'?config:structuredClone(fixtures[p]??{});
  if(p==='/api/v2/audit/logs')body.pagination={current_page:Number(url.searchParams.get('page')||1),total_pages:3,total_items:125};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>report.errors.push(error.message));
 const rows=()=>page.locator('tr[data-group="domestic"]');
 async function upstreamReady(count){await page.locator('#up-add').waitFor();await page.waitForFunction(count=>document.querySelectorAll('tr[data-group="domestic"]').length===count,count);}
 await page.goto(`http://127.0.0.1:${server.address().port}/ui/#/upstreams`);await upstreamReady(1);
 await page.locator('#up-add').click();await page.locator('#u-tag').fill('fixture-added');await page.locator('#u-addr').fill('198.51.100.53:53');
 fail=true;await page.locator('#modal-save').click();await page.locator('#modal-error').waitFor();
 assert.equal(await page.locator('#u-tag').inputValue(),'fixture-added');assert.equal(await page.locator('#modal-save').isEnabled(),true);
 assert.equal(config.domestic.length,1);
 fail=false;delay=true;await page.locator('#modal-save').click();
 const deadline=Date.now()+5000;while(!release&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert(release);
 assert(await page.locator('#modal-save').isDisabled());release();await page.locator('#modal[open]').waitFor({state:'hidden'});await upstreamReady(2);
 assert.equal(config.domestic[1].addr,'198.51.100.53:53');
 await rows().nth(1).locator('.up-edit').click();await page.locator('#u-tag').fill('fixture-edited');await page.locator('#modal-save').click();await page.locator('#modal[open]').waitFor({state:'hidden'});await upstreamReady(2);
 assert.equal(config.domestic[1].tag,'fixture-edited');
 fail=true;await page.locator('tr[data-group="domestic"][data-index="0"] .up-toggle').evaluate(input=>{input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});await page.locator('.toast').filter({hasText:'保存失败'}).first().waitFor();await upstreamReady(2);
 assert(await rows().first().locator('.up-toggle').isChecked());assert.equal(config.domestic[0].enabled,true);
 fail=false;await page.locator('tr[data-group="domestic"][data-index="0"] .up-toggle').uncheck();await page.waitForFunction(()=>document.querySelector('tr[data-group="domestic"][data-index="0"] .up-toggle')?.checked===false);
 assert.equal(config.domestic[0].enabled,false); // Enabled rows are intentionally sorted first.
 const before=report.writes.length;page.once('dialog',dialog=>dialog.dismiss());await rows().first().locator('.up-delete').click();assert.equal(report.writes.length,before);
 page.once('dialog',dialog=>dialog.accept());await rows().first().locator('.up-delete').click();await upstreamReady(1);assert.equal(config.domestic.length,1);
 report.checks.push('Upstream add/edit/toggle/delete, failed-save draft retention, in-flight disabled save and rollback; delete cancel sends no write');
 await page.evaluate(()=>{location.hash='#/logs';});await page.locator('.pagination:visible').first().waitFor();
 await page.locator('.pagination:visible').first().locator('[data-page="2"]').first().click();await page.waitForFunction(()=>document.querySelector('.pagination button.active')?.textContent==='2');
 await page.evaluate(()=>{location.hash='#/upstreams';});await upstreamReady(1);
 await page.evaluate(()=>{location.hash='#/logs';});await page.waitForFunction(()=>document.querySelector('.pagination button.active')?.textContent==='2');
 report.checks.push('Log pagination uses backend current-page data and survives route navigation');
 await page.evaluate(()=>{location.hash='#/management';});await page.locator('#cache-clear-all').waitFor();
 const beforeFlush=report.writes.length;page.once('dialog',dialog=>dialog.dismiss());await page.locator('#cache-clear-all').click();assert.equal(report.writes.length,beforeFlush);
 page.once('dialog',dialog=>dialog.accept());await page.locator('#cache-clear-all').click();await page.waitForFunction(()=>document.querySelector('#cache-clear-all'));
 assert(report.writes.slice(beforeFlush).some(item=>item.path.endsWith('/flush')));
 report.checks.push('Cache destructive action requires confirmation; cancel sends no flush; confirmed reads mutate fixtures only');
 assert.deepEqual(report.errors,[]);report.passed=true;
})().catch(error=>{report.failure=error.stack;process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
