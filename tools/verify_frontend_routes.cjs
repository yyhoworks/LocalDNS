/* Full frontend route contract. All reads and writes are isolated browser fixtures. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'playwright');
const {launchBrowser,FJGOE_FEATURES,fixtureKey}=require('./verify_support.cjs');
const baselineRoot=process.env.LOCALDNS_FRONTEND_BASELINE_ROOT;
const root=path.resolve(__dirname,'..'),out=path.join(root,baselineRoot?'dist/frontend-routes-baseline':'dist/frontend-routes-verification');
const fixtures=require('../frontend/tests/fixtures/api.json');
const metrics=fs.readFileSync(path.join(root,'frontend/tests/fixtures/metrics.prom'),'utf8');
const version=require('../VERSION.json');
const report={checks:[],views:[],errors:[],writes:[],requests:[]};
const routeSelectors={overview:'.console-service-summary',logs:'#log-search',upstreams:'#up-add',rules:'.wb-list-heading',management:'.management-service-actions'};
let server,browser;
(async()=>{
 fs.mkdirSync(out,{recursive:true});server=createPreviewServer(baselineRoot?{uiRoot:baselineRoot}:{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await launchBrowser(chromium);
 const origin=`http://127.0.0.1:${server.address().port}`;
 for(const [width,height] of [[1440,1000],[1024,768],[390,844]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  let state='success',delayPath='',release,late='';
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),p=fixtureKey(url.pathname);
   if(url.hostname==='api.github.com')return route.fulfill({contentType:'application/json',body:JSON.stringify({tag_name:version.releaseTag,draft:false,prerelease:false,assets:[]})});
   if(!p.startsWith('/api/')&&!p.startsWith('/plugins/')&&p!=='/metrics')return route.continue();
   report.requests.push({method:request.method(),path:p});
   if(request.method()!=='GET'){report.writes.push(p);return route.fulfill({contentType:'application/json',body:'{}'});}
   if(p===delayPath){delayPath='';await new Promise(r=>release=r);}
   if(state==='error')return route.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture temporarily unavailable"}'});
   if(p==='/api/v1/features')return route.fulfill({contentType:'application/json',body:JSON.stringify(FJGOE_FEATURES)});
   if(p==='/metrics')return route.fulfill({contentType:'text/plain',body:state==='empty'?'':metrics});
   if(/^\/plugins\/switch\d+\/show$/.test(p))return route.fulfill({contentType:'text/plain',body:'A'});
   if(/^\/plugins\/[\w-]+\/show$/.test(p))return route.fulfill({contentType:'text/plain',body:state==='empty'?'':'domain:example.com'});
   let body=structuredClone(fixtures[p]??(/\/config$/.test(p)?[]:{}));
   if(state==='empty'){
    if(p==='/api/v2/audit/logs')body={logs:[],filters:{},pagination:{current_page:1,total_pages:1,total_items:0}};
    else if(Array.isArray(body))body=[];
    else if(p==='/api/v1/upstream/config')body={};
   }
   if(state==='unsafe'&&p==='/api/v2/audit/logs')body.logs[0].query_name='<img src=x onerror="window.injected=true">.example';
   if(late&&p==='/api/v2/audit/logs')body.logs[0].query_name=late;
   return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);
  await page.clock.setFixedTime(new Date('2026-10-19T08:00:00Z'));
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(origin+'/ui/');await page.locator(routeSelectors.overview).waitFor();
  assert.equal(await page.title(),'运行概览 · LocalDNS');
  assert.equal(await page.locator('vite-error-overlay').count(),0);
  if(!baselineRoot)assert(await page.evaluate(()=>!Object.keys(window).some(k=>/^LocalDNS[A-Z]/.test(k))));
  for(const name of Object.keys(routeSelectors)){
   await page.evaluate(route=>location.hash='#/'+route,name);await page.locator(routeSelectors[name]).waitFor();
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForFunction(()=>!document.querySelector('#page-content .skeleton'));
   if(name==='management')await page.locator('[data-collection-control="caches"]').waitFor();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name}/${width} overflows`);
   assert(await page.locator('#page-content').innerText());
   if(name==='logs'){
    await page.locator('#log-q').fill('example');await page.locator('#log-search').click();await page.locator('.log-detail').waitFor();
    assert(report.requests.some(r=>r.path==='/api/v2/audit/logs'));
    await page.locator('.log-detail').first().click();await page.locator('#drawer.open').waitFor();await page.locator('#drawer-close').click();await page.locator('#drawer.open').waitFor({state:'hidden'});
   }
   if(name==='upstreams'){
    await page.locator('#up-add').click();await page.locator('#modal[open]').waitFor();await page.keyboard.press('Escape');await page.locator('#modal[open]').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>document.activeElement.id),'up-add');
   }
   const filename=`${name}-${width}.png`;await page.screenshot({path:path.join(out,filename),animations:'disabled'});await page.screenshot({path:path.join(out,filename.replace('.png','-full.png')),fullPage:true,animations:'disabled'});report.views.push(filename);
   if(process.env.LOCALDNS_STYLE_DIFF)fs.writeFileSync(path.join(out,`${name}-${width}-styles.json`),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('#page-content *')].map(element=>{const style=getComputedStyle(element);return{tag:element.tagName,id:element.id,classes:element.getAttribute('class'),css:Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','marginTop','marginBottom','paddingTop','paddingBottom','paddingLeft','paddingRight','gap','borderWidth','height','width','display','maxHeight'].map(key=>[key,style[key]]))};})),null,2));
  }
  report.checks.push(`All five routes, log filtering, drawer, dialog and focus at ${width}x${height}`);
  if(width===1440&&!baselineRoot){
   // An in-flight log response cannot paint over the next route.
   delayPath='/api/v2/audit/logs';late='late-response.example';
   await page.evaluate(()=>location.hash='#/logs');await page.waitForFunction(()=>!!document.querySelector('.skeleton'));
   const deadline=Date.now()+5000;while(!release&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert(release);
   await page.evaluate(()=>location.hash='#/upstreams');release();await page.locator('#up-add').waitFor();assert(!(await page.locator('#page-content').innerText()).includes('late-response'));late='';
   for(const name of ['overview','logs','upstreams','rules','management']){
    state='error';await page.evaluate(route=>location.hash='#/'+route,name);
    // Overview degrades per source instead of failing the page (features/overview/index.js degradedParts):
    // it still renders and reports every unavailable part in one toast. Other routes show .error-panel.
    if(name==='overview'){await page.locator(routeSelectors.overview).waitFor();await page.locator('.toast',{hasText:'部分数据暂不可用'}).filter({hasText:'运行统计、排行数据、系统指标读取失败'}).first().waitFor();}
    else await page.locator('.error-panel').first().waitFor();
    state='success';const retry=page.locator('#retry-page,#rule-retry');
    if(await retry.count())await retry.first().click();else await page.reload();
    await page.locator(routeSelectors[name]).waitFor();
   }
   report.checks.push('All routes report fixture failures (overview as degraded-data toast) and recover; stale async logs never overwrite upstreams');
   for(const [name,endpoint] of Object.entries({overview:'/api/v2/audit/stats',logs:'/api/v2/audit/logs',upstreams:'/api/v1/upstream/config',rules:'/plugins/whitelist/show',management:'/metrics'})){
    release=null;delayPath=endpoint;
    await page.evaluate(route=>location.hash='#/'+route,name);
    const deadline=Date.now()+5000;while(!release&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert(release,`${name} loading fixture was requested`);
    assert(await page.locator('#page-content .skeleton').count(),`${name} must show its loading state`);
    if(name==='rules')assert.equal(await page.locator('#rule-save').count(),0);
    release();await page.locator(routeSelectors[name]).waitFor();await page.waitForFunction(()=>!document.querySelector('#page-content .skeleton'));
   }
   report.checks.push('All five routes expose loading placeholders; unread rule content cannot be saved');

   state='unsafe';await page.evaluate(()=>location.hash='#/logs');await page.locator('.log-detail').waitFor();assert((await page.locator('#page-content').innerText()).includes('<img src=x'));
   assert.equal(await page.locator('#page-content img[onerror]').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);
   for(const name of ['logs','upstreams','rules','overview','management']){
    state='empty';await page.evaluate(route=>location.hash='#/'+route,name);await page.locator(routeSelectors[name]).waitFor();assert(await page.locator('#page-content').innerText());
   }
   report.checks.push('Empty route data renders safely; untrusted log fields remain literal text');
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);
 report.passed=true;report.origin=origin+'/ui/';
})().catch(error=>{report.failure=error.stack;process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,requests:report.requests.length},null,2));
});
