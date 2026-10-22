/* Isolated acceptance: every rule write is a fixture; no device is changed. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'playwright');
const output=path.resolve(__dirname,'../dist/rules-workbench-verification');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'}),errors=[],events=[],views=[];
 const initial='# 标题：日常直连\ndomain:example.com\nfull:api.example.com\n# keyword:ads\n#\n# 标题：自定义\nregexp:^cdn[0-9]+\\.example\\.com$';
 const grey='domain:grey.example.com\nfull:api.grey.example.com';
 const lists=new Map([['whitelist',initial],['greylist',grey],['direct_ip','192.0.2.0/24\n2001:db8::/32'],['client_ip','192.0.2.10']]);
 let dnsFailure=false,delayDNS=false,releaseDNS=null;
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.route('**/plugins/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname,m=p.match(/\/plugins\/([\w-]+)\/(show|post)/);
   if(m&&m[2]==='show'){events.push('read:'+m[1]);return route.fulfill({contentType:'text/plain',body:lists.get(m[1])||''});}
   if(m&&m[2]==='post'){
    events.push('save:'+m[1]);if(delayDNS)await new Promise(r=>releaseDNS=r);
    if(dnsFailure)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture save failed"}'});
    lists.set(m[1],req.postDataJSON().values.join('\n'));return route.fulfill({contentType:'application/json',body:'{}'});
   }
   return route.fulfill({contentType:'application/json',body:p.includes('client_name')?'{}':'[]'});
  });
  await context.route('**/api/proxy-config/**',route=>{errors.push('Unexpected legacy service request');return route.abort();});
  await context.route('**/api/v1/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await context.route('**/api/v2/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const openTag=async tag=>{await page.locator(`[data-rule-tag="${tag}"]`).click();await page.waitForFunction(t=>document.querySelector('.rule-menu button.active')?.dataset.ruleTag===t&&document.querySelector('#rule-text')?.dataset.original!==undefined&&document.querySelector('.wb-list-heading'),tag);};
  await page.goto(`http://127.0.0.1:${server.address().port}/ui/#/rules`);await page.locator('.wb-list-heading').waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('#rule-text').inputValue(),initial);
  await page.locator('[data-wb-mode="raw"]').click();await page.locator('[data-wb-mode="list"]').click();assert.equal(await page.locator('#rule-text').inputValue(),initial);
  await page.locator('#rv-q').fill('api.example');assert.equal(await page.locator('.rv-sw').count(),1);await page.locator('#rv-q').fill('');
  await page.locator('.rv-sw').first().uncheck();await page.locator('#rv-undo').click();assert.equal(await page.locator('#rule-text').inputValue(),initial);await page.locator('#rv-redo').click();
  await openTag('greylist');await page.locator('.rv-sw').first().uncheck();await openTag('whitelist');assert((await page.locator('#rule-text').inputValue()).startsWith('# 标题：日常直连\n# domain:example.com'));
  // A failed DNS save keeps the draft and current server list.
  dnsFailure=true;let saves=events.filter(x=>x.startsWith('save:')).length;await page.locator('#rule-save').click();await page.waitForFunction(()=>!document.querySelector('#rule-save').disabled);assert.equal(lists.get('whitelist'),initial);assert(await page.locator('#rule-save').evaluate(e=>e.classList.contains('rv-has-dirty')));dnsFailure=false;
  // A delayed whitelist response cannot replace the greylist's saved baseline.
  delayDNS=true;await page.locator('#rule-save').click();await page.waitForFunction(()=>document.querySelector('#rule-save').disabled);{const deadline=Date.now()+5000;while(!releaseDNS&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));assert(releaseDNS,'Save did not reach DNS fixture');}
  await openTag('greylist');releaseDNS();delayDNS=false;await page.waitForTimeout(150);await page.locator('.rv-sw').nth(1).uncheck();assert.equal(await page.locator('#rule-text').getAttribute('data-original'),grey);
  await page.locator('#rule-save').click();await page.waitForFunction(()=>!document.querySelector('#rule-save').disabled);assert.equal(lists.get('greylist'),await page.locator('#rule-text').inputValue());
  const tagEvents=events.filter(x=>x.endsWith(':greylist'));assert.deepEqual(tagEvents.slice(-3),['read:greylist','read:greylist','save:greylist']);
  assert.equal(await page.locator('[data-backups]').count(),0);
  // Content changed by another client is rejected before any write.
  lists.set('greylist','domain:other-client.example');await page.locator('.rv-sw').first().uncheck();saves=events.filter(x=>x.startsWith('save:')).length;await page.locator('#rule-save').click();await page.waitForFunction(()=>!document.querySelector('#rule-save').disabled);assert.equal(events.filter(x=>x.startsWith('save:')).length,saves);
  await openTag('direct_ip');await page.locator('.rv-sw').first().uncheck();await page.locator('[data-wb-mode="raw"]').click();await page.locator('[data-wb-mode="list"]').click();assert.equal(await page.locator('.rv-sw').count(),2);await page.locator('.rv-sw').first().check();assert.equal(await page.locator('#rule-text').inputValue(),'192.0.2.0/24\n2001:db8::/32');
  dnsFailure=true;await page.locator('.rv-sw').first().uncheck();await page.locator('#rule-save').click();await page.waitForFunction(()=>!document.querySelector('#rule-save').disabled);assert(await page.locator('#rule-save').evaluate(e=>e.classList.contains('rv-has-dirty')));dnsFailure=false;await page.locator('.rv-sw').first().check();
  // Batch delete requires confirmation, and undo can restore removed rules.
  await page.locator('#rv-all').click();page.once('dialog',d=>d.accept());await page.locator('[data-bulk="del"]').click();assert.equal(await page.locator('.rv-sw').count(),0);await page.locator('#rv-undo').click();assert.equal(await page.locator('.rv-sw').count(),2);
  await page.locator('#rule-save').click();await page.waitForFunction(()=>!document.querySelector('#rule-save').disabled);
  await page.evaluate(()=>{window.changeCount=0;window.idleObserver=new MutationObserver(r=>window.changeCount+=r.length);window.idleObserver.observe(document.querySelector('#rule-tab-body'),{subtree:true,childList:true});});await page.waitForTimeout(300);const idle=await page.evaluate(()=>{window.idleObserver.disconnect();return window.changeCount;});assert(idle<10,`Idle changes ${idle}`);
  await openTag('whitelist');
  for(const [skin,nav,width] of [['claude','left',1440],['glass','top',1440],['claude','left',390],['glass','top',390]]){
   await page.setViewportSize({width,height:width===390?844:1000});await page.locator('#btn-open-bg-customizer').click();await page.locator('[data-appearance-tab=theme]').click();await page.locator(`[data-skin-select="${skin}"]`).click();await page.locator('[data-appearance-tab=material]').click();await page.locator(`[data-navigation-layout="${nav}"]`).click();await page.locator('#btn-close-bg-popover').click();await page.locator('.wb-list-heading').waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const filename=`rules-${skin}-${nav}-${width}.png`;await page.screenshot({path:path.join(output,filename),fullPage:true});views.push(filename);
  }
  // Leaving list management removes overlays and no longer captures browser Save.
  await page.locator('[data-rule-tab="adguard"]').click();await page.waitForFunction(()=>!document.querySelector('#rv-root'));assert.equal(await page.locator('#rv-sheet').count(),0);assert.equal(await page.locator('.view-title-row h1').innerText(),'规则管理');
  const captured=await page.evaluate(()=>{const event=new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true});document.dispatchEvent(event);return event.defaultPrevented;});assert.equal(captured,false);
  assert.deepEqual(errors,[]);
  const report={passed:true,noCompanionService:true,dnsFailureKeepsDraft:true,crossListSaveIsolated:true,concurrentChangeRejected:true,rawLineRoundTrip:true,bulkDeleteUndo:true,unchangedTextPreserved:true,idleMutations:idle,views,errors};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
