const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'playwright');
const out=path.resolve(__dirname,process.env.LOCALDNS_AUDIT_OUT||'../dist/shared-ui-audit');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=createPreviewServer({backend:process.env.LOCALDNS_TEST_BACKEND||'http://127.0.0.1:9099'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'}),report={errors:[],layouts:[]};
 try{
  for(const skin of ['glass','claude'])for(const width of [1440,390,320]){
   const c=await browser.newContext({viewport:{width,height:width===320?620:width===390?844:1000},reducedMotion:'reduce',isMobile:width<600,hasTouch:width<600});
   await c.addInitScript(skin=>{localStorage.setItem('localdns-skin',skin);},skin);
   await c.route('https://api.github.com/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({tag_name:'fjgac-ui-v2026.10.19.5',assets:[]})}));
   const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));
   await p.goto(process.env.LOCALDNS_AUDIT_URL||`http://127.0.0.1:${server.address().port}/ui/`);await p.locator('.console-service-summary').waitFor();
   await p.locator('#btn-open-bg-customizer').click();await p.locator('[data-appearance-tab=theme]').click();await p.locator(`[data-skin-select=${skin}]`).click();
   await p.locator('[data-appearance-tab=brand]').click();await p.locator('.identity-settings summary').click();
   await p.screenshot({path:path.join(out,`${skin}-${width}-brand.png`)});
   await p.locator('#export-shared-ui').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,`${skin}-${width}-sharing.png`)});
   const brand=await p.locator('#bg-customizer-popover').evaluate(el=>{
    const rect=el.getBoundingClientRect(),visible=[...el.querySelectorAll('input,select,button,summary')].filter(e=>e.getClientRects().length);
    return {width:rect.width,right:rect.right,left:rect.left,viewport:innerWidth,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,smallTargets:visible.filter(e=>e.getBoundingClientRect().height<40).map(e=>({id:e.id,tag:e.tagName,height:e.getBoundingClientRect().height})),overflow:visible.filter(e=>e.getBoundingClientRect().right>rect.right+1||e.getBoundingClientRect().left<rect.left-1).map(e=>e.id)};
   });
   await p.locator('#btn-close-bg-popover').click();await p.locator('#proxy-launcher button').click();
   await p.screenshot({path:path.join(out,`${skin}-${width}-proxy.png`)});
   const proxy=await p.locator('#proxy-panel-popover').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth};});
   await p.keyboard.press('Escape');assert(await p.locator('#proxy-panel-popover').isHidden());
   await p.screenshot({path:path.join(out,`${skin}-${width}-overview.png`)});
   assert(brand.left>=0&&brand.right<=width+1&&brand.scrollWidth<=brand.clientWidth+1);assert.deepEqual(brand.overflow,[]);assert(proxy.left>=0&&proxy.right<=width+1&&proxy.bottom<=proxy.viewportHeight+1);
   report.layouts.push({skin,width,brand,proxy});await c.close();
  }
  assert.deepEqual(report.errors,[]);fs.writeFileSync(path.join(out,'layout-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
