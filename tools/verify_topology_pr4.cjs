/* Browser acceptance for the reviewed PR #4 integration. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'playwright');
const fixtures=require('../frontend/tests/fixtures/api.json');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist/topology-pr4-verification');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=createPreviewServer({backend:'http://127.0.0.1:1'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,channel:'msedge'});
 const report={errors:[],writes:[],checks:[],layouts:[]};
 async function context(){
  const c=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  c.on('page',p=>p.on('pageerror',e=>report.errors.push(e.message)));
  await c.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){report.writes.push(url.pathname);return route.fulfill({status:403,body:''});}
   if(/\/(api|plugins)\//.test(url.pathname))return route.fulfill({contentType:'application/json',body:JSON.stringify(fixtures[url.pathname]??{})});
   if(url.pathname==='/metrics')return route.fulfill({contentType:'text/plain',body:fs.readFileSync(path.join(root,'frontend/tests/fixtures/metrics.prom'),'utf8')});
   if(url.hostname!=='127.0.0.1')return route.fulfill({status:404,body:''});
   return route.continue();
  });
  return c;
 }
 try{
  const c=await context(),page=await c.newPage();await page.goto(base+'/ui/');
  await page.locator('.workspace-topology-tools').waitFor();
  assert.deepEqual(await page.locator('[data-chart-range]').evaluateAll(els=>els.map(e=>e.dataset.chartRange)),['15','60','360','1440']);
  const motion=page.locator('#btn-toggle-particles');
  assert.equal(await motion.getAttribute('aria-pressed'),'false');
  assert((await motion.getAttribute('title')).includes('减少动态'));
  assert.equal(await page.locator('.topo-cursor').evaluate(el=>getComputedStyle(el).display),'none');
  await motion.click();await page.mouse.move(0,0);
  assert.equal(await motion.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.topo-stage-wrap.motion-override').count(),1);
  assert.notEqual(await page.locator('.topo-cursor').evaluate(el=>getComputedStyle(el).display),'none');
  await page.reload();await page.locator('.workspace-topology-tools').waitFor();
  assert.equal(await motion.getAttribute('aria-pressed'),'true',JSON.stringify(await page.evaluate(()=>({override:localStorage.getItem('localdns_particles_motion_override'),particles:localStorage.getItem('localdns_particles'),reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,title:document.querySelector('#btn-toggle-particles').title}))));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>!document.querySelector('.topo-stage-wrap').classList.contains('motion-override'));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>document.querySelector('#btn-toggle-particles').getAttribute('aria-pressed')==='false');
  await page.locator('[data-topology-lock="r1"]').click();
  assert(await page.locator('[data-topology-node]').isVisible());
  assert(await page.locator('[data-topology-queries]').isVisible());
  await page.locator('[data-topology-node]').click();await page.waitForURL('**/#/rules');
  await page.goto(base+'/ui/#/overview');await page.locator('.workspace-topology-tools').waitFor();
  await page.locator('[data-topology-clear]').click();
  await page.locator('[data-topology-lock="r1"]').click();await page.locator('[data-topology-queries]').click();
  await page.waitForURL('**/#/logs');await page.goto(base+'/ui/#/overview');await page.locator('.workspace-topology-tools').waitFor();
  await page.locator('[data-topology-clear]').click();
  assert.equal(await page.locator('[data-topology-clear]').getAttribute('aria-pressed'),'true');
  report.checks.push('current trend ranges, reduced motion default and explicit override, persisted override, system change, node details and related queries');
  for(const skin of ['glass','claude'])for(const theme of ['cosmos-glass','light-glass'])for(const width of [1440,760,390]){
   await page.evaluate(({skin,theme})=>{document.documentElement.dataset.skin=skin;document.documentElement.dataset.theme=theme;},{skin,theme});
   await page.setViewportSize({width,height:1000});
   const result=await page.locator('.topology-glass-card').evaluate(card=>{
    const text=[...card.querySelectorAll('.console-topology-heading h2,.console-topology-heading span')].map(el=>{const r=document.createRange();r.selectNodeContents(el);return r.getBoundingClientRect()});
    const buttons=[...card.querySelectorAll('[data-topology-lock],[data-topology-clear]')].map(el=>el.getBoundingClientRect());
    const overlap=text.some(t=>buttons.some(b=>t.left<b.right&&t.right>b.left&&t.top<b.bottom&&t.bottom>b.top));
    const b=card.getBoundingClientRect(),tools=card.querySelector('.workspace-topology-tools').getBoundingClientRect();
    return {overlap,toolsVisible:tools.left>=b.left&&tools.right<=b.right+1,buttonHeight:Math.min(...buttons.map(b=>b.height))};
   });
   assert.equal(result.overlap,false,JSON.stringify({skin,theme,width,result}));assert(result.toolsVisible);
   if(width<=760)assert(result.buttonHeight>=44,JSON.stringify({width,result}));
   report.layouts.push({skin,theme,width,...result});
   await page.locator('.topology-glass-card').screenshot({path:path.join(out,`${skin}-${theme}-${width}.png`)});
  }
  await c.close();
  const fresh=await context(),second=await fresh.newPage();await second.goto(base+'/ui/');await second.locator('.workspace-topology-tools').waitFor();
  assert.equal(await second.locator('#btn-toggle-particles').getAttribute('aria-pressed'),'false');await fresh.close();
  report.checks.push('fresh browser follows reduced motion, current browser trend ranges');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks,layouts:report.layouts.length,errors:report.errors,writes:report.writes}));
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
