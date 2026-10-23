/* Appearance A+C and selected overview A; writes use local fixtures only. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'playwright');
const out=path.resolve(__dirname,'../dist/appearance-layout-verification');
fs.mkdirSync(out,{recursive:true});
(async()=>{
  const backend=process.env.LOCALDNS_PREVIEW_BACKEND;
  if(!backend){console.error('Set LOCALDNS_PREVIEW_BACKEND to an isolated LocalDNS backend (e.g. http://127.0.0.1:9099); this script no longer defaults to a hard-coded LAN address.');process.exit(2);}
  const server=createPreviewServer({backend});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=process.env.LOCALDNS_VERIFY_URL||`http://127.0.0.1:${server.address().port}/ui/`;
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  const report={origin,errors:[],unexpectedWrites:[],layouts:[],checks:[]};
  try{
    const c=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await c.addInitScript(()=>{window.__rejections=[];window.addEventListener('unhandledrejection',e=>window.__rejections.push(String(e.reason)));});
    await c.route(/\/(api|plugins)\//,r=>{
      if(r.request().method()!=='GET'){report.unexpectedWrites.push(r.request().url());return r.abort();}return r.continue();
    });
    await c.route('**/api/proxy-config/interface/*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({value:null,revision:'fixture'})}));
    await c.route('https://api.github.com/repos/yyhoworks/LocalDNS/releases/latest',r=>r.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({tag_name:'fjgac-ui-v2026.10.18.19',assets:[]})}));
    let mockFlushes=0;
    await c.route('**/plugins/cache_main/flush',r=>{mockFlushes++;return r.fulfill({contentType:'text/plain',body:'OK'});});
    const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));
    const baseline=await c.newPage();await baseline.goto(backend.replace(/\/+$/,'')+'/ui/');
    const oldIDs=await baseline.locator('#bg-customizer-popover [id]').evaluateAll(els=>els.map(el=>el.id));await baseline.close();
    await p.goto(origin);await p.locator('.overview-cache-pool').first().waitFor();
    assert.equal(await p.locator('.overview-scheme-bar').count(),0);
    await p.locator('#btn-open-bg-customizer').click();await p.locator('.appearance-tabs').waitFor();
    const newIDs=await p.locator('#bg-customizer-popover [id]').evaluateAll(els=>els.map(el=>el.id));
    for(const id of oldIDs)assert(newIDs.includes(id),'Existing setting was removed: '+id);
    assert.equal(new Set(newIDs).size,newIDs.length);
    assert.equal(await p.locator('.appearance-tab').count(),3);
    await p.locator('[data-appearance-tab=theme]').focus();await p.keyboard.press('ArrowRight');
    assert.equal(await p.locator('[data-appearance-tab=material]').getAttribute('aria-selected'),'true');
    assert(await p.locator('#slider-radius').isVisible());assert(!await p.locator('#font-heading').isVisible());
    await p.locator('#slider-radius').fill('120');await p.locator('#slider-radius').dispatchEvent('input');
    assert.equal(await p.locator('#val-radius').innerText(),'120%');
    await p.locator('[data-navigation-layout=top]').click();assert.equal(await p.locator('html').getAttribute('data-nav'),'top');
    await p.locator('[data-appearance-tab=brand]').click();
    await p.locator('#select-brand-ver').selectOption('custom');await p.locator('#input-brand-ver').fill('预览测试');
    assert.equal(await p.locator('#brand-version-tag').innerText(),'预览测试');
    await p.locator('#font-heading').selectOption('sans');assert.equal(await p.locator('#font-heading').inputValue(),'sans');
    await p.locator('#input-font-upload').setInputFiles(path.resolve(__dirname,'../_src/ui/assets/fonts/instrument-serif-numerals.woff2'));
    await p.locator('.bcp-font-item').waitFor();assert(await p.locator('#font-heading optgroup[data-uploaded-fonts] option').count()>0);
    await p.locator('.bcp-font-del').click();
    await p.locator('.identity-settings summary').click();assert(await p.locator('#identity-name').isVisible());
    await p.locator('.identity-settings summary').click();
    await p.locator('[data-appearance-tab=theme]').click();await p.locator('[data-skin-select=glass]').click();
    await p.locator('#bg-url-input').fill('invalid');await p.locator('#btn-apply-bg-url').click();
    assert((await p.locator('#wallpaper-save-status').innerText()).includes('有效图片 URL'));
    await p.locator('#bg-url-input').fill('');
    await p.locator('[data-appearance-tab=material]').click();
    await p.locator('#slider-blur').fill('20');await p.locator('#slider-blur').dispatchEvent('input');
    assert.equal(await p.locator('#val-blur').innerText(),'20px');
    await p.locator('#btn-close-bg-popover').click();await p.reload();await p.locator('.overview-slow-table').waitFor();
    await p.locator('#btn-open-bg-customizer').click();await p.locator('[data-appearance-tab=material]').click();
    assert.equal(await p.locator('#slider-radius').inputValue(),'120');assert.equal(await p.locator('#slider-blur').inputValue(),'20');
    await p.locator('[data-appearance-tab=brand]').click();assert.equal(await p.locator('#font-heading').inputValue(),'sans');assert.equal(await p.locator('#input-brand-ver').inputValue(),'预览测试');
    await p.locator('#btn-close-bg-popover').click();
    await p.locator('[data-overview-cache-view=cache_main]').click();await p.locator('#drawer.open').waitFor();await p.locator('#drawer-close').click();
    p.once('dialog',d=>d.dismiss());await p.locator('[data-overview-cache-flush=cache_main]').click();assert.equal(mockFlushes,0);
    p.once('dialog',d=>d.accept());await p.locator('[data-overview-cache-flush=cache_main]').click();await p.waitForFunction(()=>document.querySelector('.toast-stack')?.textContent.includes('已清空'));
    assert.equal(mockFlushes,1);
    report.checks.push('all existing control IDs retained without duplicates','keyboard tabs and hidden panels','sliders, navigation, custom version and fonts persist','font upload and removal','invalid wallpaper URL feedback','cache content and confirmed flush with isolated fixture');
    // Silent refresh holds the page's prior height; rows must retain content height.
    await p.evaluate(()=>document.querySelector('main').style.minHeight='10000px');
    try {
      const blank=await p.evaluate(()=>document.querySelector('.overview-cache-panel>.glass-card').getBoundingClientRect().bottom-document.querySelector('.overview-cache-panel .overview-outcome-note').getBoundingClientRect().bottom);
      assert(blank<30,'Silent refresh must not stretch content rows');
    } finally { await p.evaluate(()=>document.querySelector('main').style.minHeight=''); }
    report.checks.push('content height preserved while silent refresh holds page min-height');
    for(const skin of ['glass','claude'])for(const [width,height,nav]of[[1920,1080,'left'],[1440,1000,'left'],[1100,800,'top'],[390,844,'left'],[320,620,'left']]){
      await p.setViewportSize({width,height});await p.locator('#btn-open-bg-customizer').click();
      await p.locator('[data-appearance-tab=theme]').click();await p.locator(`[data-skin-select=${skin}]`).click();
      await p.locator('[data-appearance-tab=material]').click();await p.locator(`[data-navigation-layout=${nav}]`).click();
      const states=[];
      for(const tab of ['theme','material','brand']){
        await p.locator(`[data-appearance-tab=${tab}]`).click();
        const state=await p.evaluate(()=>{const panel=document.querySelector('.appearance-panel'),content=panel.querySelector('.appearance-content'),r=panel.getBoundingClientRect();const bad=[...panel.querySelectorAll('input:not([type=file]),select,button')].filter(el=>el.getClientRects().length).map(el=>({id:el.id||el.textContent,r:el.getBoundingClientRect()})).filter(({r:q})=>q.left<r.left||q.right>r.right);return{height:r.height,bottom:r.bottom,scroll:content.scrollHeight-content.clientHeight,width:r.width,overflow:panel.scrollWidth-panel.clientWidth,bad:bad.map(el=>el.id)};});
        states.push({tab,...state});assert(state.bottom<=height+1);assert(state.overflow<=1);assert.deepEqual(state.bad,[]);
        await p.locator('.appearance-panel').screenshot({path:path.join(out,`appearance-${skin}-${width}-${tab}.png`)});
        if(tab==='theme'&&skin==='glass'){
          const inline=await p.evaluate(()=>{const a=document.querySelector('#bg-url-input').getBoundingClientRect(),b=document.querySelector('#btn-apply-bg-url').getBoundingClientRect();return Math.abs((a.top+a.height/2)-(b.top+b.height/2))});
          assert(inline<=2,'URL and Apply must stay on one line');
        }
      }
      await p.locator('#btn-close-bg-popover').click();await p.locator('.overview-slow-table').waitFor();
      const layout=await p.evaluate(()=>{
        const b=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
        return{cache:b('.overview-cache-panel'),slow:b('.overview-slow-panel'),card:b('.overview-cache-panel>.glass-card'),pools:b('.overview-cache-pools'),foot:b('.overview-cache-panel .overview-outcome-note'),pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,poolColumns:getComputedStyle(document.querySelector('.overview-cache-pools')).gridTemplateColumns};
      });
      assert(layout.pageOverflow<=1);assert(layout.card.bottom-layout.foot.bottom<30,'Cache card has excessive blank space: '+JSON.stringify({skin,width,...layout}));
      if(width>1250){assert(Math.abs(layout.cache.y-layout.slow.y)<2);assert(layout.slow.width>layout.cache.width);assert.equal(layout.poolColumns.split(' ').length,2);}
      else assert(layout.slow.y>=layout.cache.bottom);
      report.layouts.push({skin,width,height,nav,states,...layout});
      await p.locator('.overview-cache-panel').screenshot({path:path.join(out,`cache-${skin}-${width}.png`),style:'.top-header-grid,.mobile-nav{visibility:hidden!important}'});
      await p.locator('.overview-slow-panel').screenshot({path:path.join(out,`slow-${skin}-${width}.png`),style:'.top-header-grid,.mobile-nav{visibility:hidden!important}'});
    }
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.unexpectedWrites,[]);assert.deepEqual(await p.evaluate(()=>window.__rejections),[]);
    report.status='passed';await c.close();
  }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
  console.log(JSON.stringify({status:report.status,layouts:report.layouts.length,checks:report.checks,errors:report.errors},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
