/* Functional acceptance; all writes and panel icons stay in isolated fixtures. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist/shared-ui-verification');fs.mkdirSync(out,{recursive:true});
const font=fs.readFileSync(path.join(root,'_src/ui/assets/fonts/instrument-serif-numerals.woff2'));
const logo=fs.readFileSync(path.join(root,'_src/ui/assets/img/logo-04-light.png'));
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#386b89"/></svg>';
let shared={version:1,localdns:{name:'共享测试 DNS',logo:'custom/assets/server.png'},proxy:{name:'家庭面板',url:'http://panel.test/ui/#/overview?secret=not-forwarded'},typography:{heading:'upshared',numeral:'serif',body:'plex'},fonts:[{id:'upshared',name:'共享标题.woff2',path:'custom/fonts/shared.woff2',size:font.length},{id:'upunused',name:'备用字体.woff2',path:'custom/fonts/unused.woff2',size:font.length}]}
let imported=null;
(async()=>{
 const server=createPreviewServer({backend:process.env.LOCALDNS_TEST_BACKEND||'http://127.0.0.1:9099'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}/ui/`,browser=await chromium.launch({headless:true,channel:'msedge'});
 const report={checks:[],pageErrors:[],companionRequests:[],unexpectedWrites:[],fontRequests:[],panelRequests:[]};
 async function context(){
  const c=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  c.on('request',r=>{if(new URL(r.url()).port==='9098')report.companionRequests.push(r.url());if(new URL(r.url()).hostname==='panel.test')report.panelRequests.push(r.url());if(!['GET','HEAD'].includes(r.method()))report.unexpectedWrites.push(r.url());});
  const fixtures=require('../frontend/tests/fixtures/api.json');
  await c.route(/\/(api|plugins)\//,route=>{const p=new URL(route.request().url()).pathname;if(/^\/plugins\/switch\d+\/show$/.test(p))return route.fulfill({contentType:'text/plain',body:'A'});return route.fulfill({contentType:'application/json',body:JSON.stringify(fixtures[p]??{})});});
  await c.route('**/metrics',r=>r.fulfill({contentType:'text/plain',body:fs.readFileSync(path.join(root,'frontend/tests/fixtures/metrics.prom'),'utf8')}));
  await c.route('**/custom/**',async r=>{
   const relative=new URL(r.request().url()).pathname.split('/custom/')[1];
   if(relative==='settings.json')return r.fulfill({contentType:'application/json',body:JSON.stringify(shared)});
   if(relative.startsWith('fonts/'))report.fontRequests.push(relative);
   if(imported){const p=path.join(imported,relative);if(fs.existsSync(p))return r.fulfill({contentType:relative.startsWith('fonts/')?'font/woff2':'image/png',body:fs.readFileSync(p)});}
   return r.fulfill({contentType:relative.startsWith('fonts/')?'font/woff2':'image/png',body:relative.startsWith('fonts/')?font:logo});
  });
  await c.route('http://panel.test/**',r=>r.fulfill(new URL(r.request().url()).pathname==='/ui/favicon.svg'?{contentType:'image/svg+xml',body:svg}:{status:404,body:''}));
  await c.route('http://missing.test/**',r=>r.fulfill({status:404,body:''}));
  await c.route('https://api.github.com/repos/yyhoworks/LocalDNS/releases/latest',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({tag_name:'fjgac-ui-v2026.10.19.5',assets:[]})}));
  return c;
 }
 async function open(c){const p=await c.newPage();p.on('pageerror',e=>report.pageErrors.push(e.message));await p.goto(origin);await p.locator('.console-service-summary').waitFor();await p.waitForFunction(()=>document.fonts.check('12px LocalDNSUploaded_'+document.querySelector('#font-heading').value));return p;}
 try{
  const c=await context(),p=await open(c);
  await p.waitForFunction(()=>document.title==='共享测试 DNS 控制台');
  await p.waitForFunction(()=>document.querySelector('#proxy-launcher img').src==='http://panel.test/ui/favicon.svg');
  assert(report.fontRequests.includes('fonts/shared.woff2'));assert(!report.fontRequests.includes('fonts/unused.woff2'));
  assert.equal(await p.locator('#proxy-panel-logo-file').count(),0);assert.equal(await p.locator('#proxy-panel-logo-url').count(),0);
  const urls=report.panelRequests;
  assert(urls.every(u=>u.startsWith('http://panel.test/')&&!u.includes('secret')&&!u.includes('#')));
  assert((await p.locator('.traffic-caption').innerText()).includes('当前会话'));
  report.checks.push('shared name, logo and selected font load without companion','unused server fonts are not downloaded','panel logo uses /ui/ favicon without forwarding URL secrets');
  const other=await context(),otherPage=await open(other);assert.equal(await otherPage.title(),'共享测试 DNS 控制台');await other.close();
  report.checks.push('fresh independent browser reads the same name, logo and font');
  await p.locator('#btn-open-bg-customizer').click();await p.locator('[data-appearance-tab=brand]').click();await p.locator('.identity-settings summary').click();
  await p.locator('#identity-name').fill('新共享名称');await p.locator('#identity-logo-file').setInputFiles({name:'local.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
  await p.waitForFunction(()=>document.querySelector('#identity-preview').src.startsWith('data:image/png'));
  await p.locator('#identity-save').click();await p.waitForFunction(()=>document.title==='新共享名称 控制台');
  assert((await p.locator('#identity-status').innerText()).includes('当前浏览器'));
  await p.locator('#font-heading').selectOption('upunused');
  await p.locator('#input-font-upload').setInputFiles(path.join(root,'_src/ui/assets/fonts/instrument-serif-numerals.woff2'));
  await p.waitForFunction(()=>document.querySelectorAll('.bcp-font-item').length===3);
  const localId=await p.locator('#font-body optgroup option').last().getAttribute('value');await p.locator('#font-body').selectOption(localId);
  const downloadPromise=p.waitForEvent('download');await p.locator('#export-shared-ui').click();const download=await downloadPromise;const bundle=path.join(out,'exported-settings.zip');await download.saveAs(bundle);
  const installed=fs.mkdtempSync(path.join(out,'import-test-'));fs.mkdirSync(path.join(installed,'ui'));fs.writeFileSync(path.join(installed,'ui/index.html'),'UI');
  const result=cp.spawnSync('python',[path.join(root,'tools/configure_ui.py'),'--dir',installed,'--import',bundle],{encoding:'utf8'});assert.equal(result.status,0,result.stderr+result.stdout);
  imported=path.join(installed,'ui/custom');shared=JSON.parse(fs.readFileSync(path.join(imported,'settings.json'),'utf8'));
  assert.equal(shared.localdns.name,'新共享名称');assert.equal(shared.fonts.length,3);assert.equal(shared.typography.body,localId);assert(!('logo'in shared.proxy));
  const fresh=await context(),freshPage=await open(fresh);await freshPage.waitForFunction(()=>document.title==='新共享名称 控制台');assert.equal(await freshPage.evaluate(()=>localStorage.getItem('localdns-identity-v1')),null);
  await freshPage.waitForFunction(()=>document.fonts.check('12px LocalDNSUploaded_'+document.querySelector('#font-body').value));await fresh.close();
  report.checks.push('local preview copy is accurate','export ZIP imports with real Python tool','another device sees imported name, PNG logo, font files and role choices');
  await p.locator('#btn-close-bg-popover').click();await p.locator('#proxy-launcher button').click();await p.locator('#proxy-panel-url').fill('javascript:alert(1)');await p.locator('#proxy-panel-popover [type=submit]').click();assert(await p.locator('#proxy-panel-error').isVisible());
  await p.locator('#proxy-panel-url').fill('http://missing.test/ui/');await p.locator('#proxy-panel-url').dispatchEvent('change');await p.waitForFunction(()=>document.querySelector('#proxy-logo-status').textContent.includes('默认图标'));
  await p.keyboard.press('Escape');
  const ruleSave=require('./frontend_test_module.cjs').loadFeature('features/rules/save.js','ruleSaveService');let saved;await ruleSave.save('whitelist','new.example','old.example',async()=>'old.example',async value=>{saved=value;});assert.deepEqual(saved,['new.example']);
  report.checks.push('invalid panel URL is rejected','failed favicon keeps default icon','rules save through DNS callbacks without backup service');
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.companionRequests,[]);assert.deepEqual(report.unexpectedWrites,[]);
  report.passed=true;fs.writeFileSync(path.join(out,'functional-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await c.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
