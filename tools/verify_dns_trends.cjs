/* Real IndexedDB, 24-hour raw samples, no production writes or background service. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'playwright');
const fixtures=require('../frontend/tests/fixtures/api.json');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist/dns-trends-verification');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=createPreviewServer({backend:'http://127.0.0.1:1'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,channel:'msedge'});
 const report={errors:[],writes:[],checks:[],layouts:[]};let counter=0,offline=false;
 async function context(blocked=false){
  const c=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce',hasTouch:true});
  if(blocked)await c.addInitScript(()=>Object.defineProperty(globalThis,'indexedDB',{get(){throw new Error('Storage blocked');}}));
  c.on('page',p=>p.on('pageerror',e=>report.errors.push(e.message)));
  await c.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){report.writes.push(url.pathname);return route.fulfill({status:403,body:''});}
   if(/\/(api|plugins)\//.test(url.pathname))return route.fulfill({contentType:'application/json',body:JSON.stringify(fixtures[url.pathname]??{})});
   if(url.pathname==='/metrics'){
    if(offline)return route.fulfill({status:503,body:''});counter++;
    return route.fulfill({contentType:'text/plain',body:`localdns_info{version="FJGAC"} 1\nprocess_start_time_seconds 1\nlocaldns_queries_total ${173890+counter*10}\nlocaldns_cache_query_total{tag="cache_main"} ${172900+counter*10}\nlocaldns_cache_hit_total{tag="cache_main"} ${138320+counter*8}\nlocaldns_upstream_response_latency_millisecond_sum{metrics_tag="domestic",tag="a"} ${518970+counter*20}\nlocaldns_upstream_response_latency_millisecond_count{metrics_tag="domestic",tag="a"} ${34560+counter*2}\n`});
   }
   if(url.hostname!=='127.0.0.1')return route.fulfill({status:404,body:''});
   return route.continue();
  });
  return c;
 }
 try{
  const c=await context(),page=await c.newPage();await page.goto(base+'/ui/');await page.locator('.traffic-metric-tabs').waitFor();
  const seededAt=Date.now();
  await page.evaluate(async now=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('localdns-dns-trends',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   await new Promise((resolve,reject)=>{
    const tx=db.transaction('samples','readwrite'),store=tx.objectStore('samples');
    const key=JSON.stringify([['metrics_tag','domestic'],['tag','a']]);
    for(let i=0;i<=17278;i++){
     const time=now-86400000+i*5000;
     store.put({source:location.origin,slot:Math.floor(time/5000),time,total:i*10+(i>=10000?990:0),start:1,
      cacheQueries:i*10,cacheHits:i*8,upstreams:[[key,i*30+(i>=1000?570:0),i*2]]});
    }
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
   });db.close();
  },seededAt);
  await page.reload();await page.locator('.traffic-chart').waitFor();
  assert.deepEqual(await page.locator('[data-chart-range]').evaluateAll(els=>els.map(e=>e.dataset.chartRange)),['15','60','360','1440']);
  assert.equal(await page.locator('[data-chart-range="60"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-chart-range="1440"]').click();
  assert((await page.locator('.traffic-caption').textContent()).includes('当前 24 小时'));
  assert((await page.locator('.traffic-summary').textContent()).includes('200'));
  assert(await page.locator('.traffic-point').count()<=480);
  assert(await page.locator('.traffic-peak').count()>0);
  for(const [metric,unit] of [['qps','QPS'],['cache','%'],['latency','ms']]){
   await page.locator(`[data-traffic-metric="${metric}"]`).click();
   assert((await page.locator('.traffic-axis-unit').textContent())===unit);
   await page.locator('.traffic-plot').focus();await page.keyboard.press('Home');
   assert(await page.locator('.traffic-tooltip').isVisible());
   assert((await page.locator('.traffic-tooltip').textContent()).includes(unit));
   await page.keyboard.press('End');await page.keyboard.press('ArrowLeft');
   await page.keyboard.press('Escape');assert(await page.locator('.traffic-tooltip').isHidden());
  }
  await page.locator('[data-traffic-metric="qps"]').click();
  await page.locator('.traffic-plot').tap();assert(await page.locator('.traffic-tooltip').isVisible());
  report.checks.push('24-hour IndexedDB history, four ranges and one-hour default, three units, bounded points and preserved peak, keyboard and touch inspection');
  const card=page.locator('.console-trend > .glass-card');
  for(const skin of ['glass','claude'])for(const theme of ['cosmos-glass','light-glass'])for(const width of [1440,390,320]){
   await page.evaluate(({skin,theme})=>{document.documentElement.dataset.skin=skin;document.documentElement.dataset.theme=theme;},{skin,theme});
   await page.setViewportSize({width,height:1100});
   const result=await card.evaluate(card=>{
    const b=card.getBoundingClientRect(),buttons=[...card.querySelectorAll('[data-traffic-metric],[data-chart-range]')].map(e=>e.getBoundingClientRect());
    return {pageOverflow:document.documentElement.scrollWidth>innerWidth+1,controlsFit:buttons.every(r=>r.left>=b.left&&r.right<=b.right+1),metricHeight:Math.min(...buttons.map(r=>r.height)),points:card.querySelectorAll('.traffic-point').length};
   });
   assert.equal(result.pageOverflow,false,JSON.stringify({skin,theme,width,result}));assert(result.controlsFit);assert(result.points<=480);
   if(width<=760)assert(result.metricHeight>=44);
   report.layouts.push({skin,theme,width,...result});
   await card.screenshot({path:path.join(out,`${skin}-${theme}-${width}.png`)});
  }
  // Simulate a disconnected core, then retry against the same retained chart.
  offline=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('[data-traffic-retry]').waitFor();assert(await page.locator('.traffic-chart').isVisible());
  offline=false;await page.locator('[data-traffic-retry]').click();await page.locator('[data-traffic-retry]').waitFor({state:'detached'});
  await page.reload();await page.locator('.traffic-chart').waitFor();await page.locator('[data-chart-range="1440"]').click();
  assert((await page.locator('.traffic-caption').textContent()).includes('24 小时'));
  await c.close();
  const unavailable=await context(true),temporary=await unavailable.newPage();await temporary.goto(base+'/ui/');
  await temporary.locator('.traffic-storage-note').filter({hasText:'仅临时保留'}).waitFor();
  await temporary.waitForTimeout(5300);await temporary.locator('.traffic-chart').waitFor();
  assert(await temporary.locator('.traffic-read-error').count()===0);await unavailable.close();
  report.checks.push('offline retry retains chart, refresh restores local history, denied IndexedDB retains live sampling without false save claim');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks:report.checks,layouts:report.layouts.length,errors:report.errors,writes:report.writes}));
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
