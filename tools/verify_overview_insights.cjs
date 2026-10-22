/* Bounded browser checks. All backend mutations are blocked. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createPreviewServer} = require('./preview_ui.cjs');
const {chromium} = require(process.env.LOCALDNS_PLAYWRIGHT || 'playwright');
const output = path.resolve(__dirname, '../dist/overview-insights-verification');
fs.mkdirSync(output, {recursive:true});
const installedMetadata = require('../_src/ui/version.json');
const expectedStatus = installedMetadata.channel === 'local' ? '本地测试版' : '已是最新';
const baseVersion = installedMetadata.channel === 'local' ? installedMetadata.baseUiVersion : installedMetadata.uiVersion;
const nextParts = baseVersion.split('.').map(Number); nextParts[3]++;
const nextVersion = nextParts.join('.');
const release = {tag_name:'fjgac-ui-v' + baseVersion,prerelease:false,draft:false,assets:[{name:'LocalDNS_UI_Update.zip'},{name:'LocalDNS_FJGAC_Full.zip'},{name:'Config_Service.zip'}]};
const github = 'https://api.github.com/repos/yyhoworks/LocalDNS/releases/latest';
(async () => {
  const backend = process.env.LOCALDNS_PREVIEW_BACKEND;
  if (!backend) { console.error('Set LOCALDNS_PREVIEW_BACKEND to an isolated LocalDNS backend (e.g. http://127.0.0.1:9099); this script no longer defaults to a hard-coded LAN address.'); process.exit(2); }
  const server = createPreviewServer({backend});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = process.env.LOCALDNS_VERIFY_URL || `http://127.0.0.1:${server.address().port}/ui/`;
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  const report = {origin, layouts:[], errors:[], blockedWrites:[], scenarios:[]};
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addInitScript(() => {window.__insightRejections=[];window.addEventListener('unhandledrejection',event=>window.__insightRejections.push(String(event.reason)));});
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await context.route(/\/(api|plugins)\//, route => {
      if (route.request().method() !== 'GET') { report.blockedWrites.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    let mode = 'normal', githubCalls = 0;
    await context.route(github, async route => {
      githubCalls++;
      if (mode === 'offline') return route.abort('internetdisconnected');
      if (mode === 'rate-limit') return route.fulfill({status:403,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:'{}'});
      return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({...release,tag_name:mode === 'new' ? 'fjgac-ui-v' + nextVersion : release.tag_name})});
    });
    await page.goto(origin);
    await page.locator('.overview-slow-table').waitFor();
    await page.locator('#version-button[data-status=normal]').waitFor();
    await page.waitForFunction(status => document.querySelector('[data-version-status]').textContent === status, expectedStatus).catch(async error => {
      console.error(await page.locator('#version-content').innerText());
      console.error('Version button:',await page.locator('#version-button').innerText()); throw error;
    });
    assert.equal(await page.locator('.outcome-item').count(), 6);
    assert.equal(await page.locator('#overview-slow-rows tr').count(), 10);
    assert.equal(await page.locator('.overview-slow-table th').count(), 5);
    assert.equal(await page.locator('.overview-cache-pool').count(), 4);
    assert((await page.locator('.outcome-item').first().innerText()).includes('主缓存命中'));
    await page.locator('.outcome-item').last().click();
    await page.locator('#drawer.open').waitFor();
    const otherCount = await page.locator('[data-outcome-filter]').count();
    assert(otherCount > 0);
    const filter = await page.locator('[data-outcome-filter]').first().getAttribute('data-outcome-filter');
    await page.locator('[data-outcome-filter]').first().click();
    await page.locator('#log-set').waitFor();
    assert.equal(await page.locator('#log-set').inputValue(), filter);
    await page.evaluate(() => { location.hash = '#/overview'; });
    await page.locator('#overview-slow-limit').waitFor();
    for (const limit of [5,20]) {
      await page.locator('#overview-slow-limit').selectOption(String(limit));
      assert.equal(await page.locator('#overview-slow-rows tr').count(), limit);
    }
    await page.reload(); await page.locator('#overview-slow-limit').waitFor();
    assert.equal(await page.locator('#overview-slow-limit').inputValue(),'20');
    assert.equal(githubCalls,1, 'Fresh cached GitHub result should avoid another request');
    await page.locator('#overview-slow-limit').selectOption('10');
    await page.locator('#slow-detail-button').click();
    assert.equal(await page.locator('#modal[open] .overview-detail-slow-table tbody tr').count(),20);
    await page.locator('#modal-close').click();
    await page.locator('#version-button').click();
    await page.locator('#version-dialog[open]').waitFor();
    assert((await page.locator('#version-content').innerText()).includes(require('../_src/ui/version.json').uiVersion));
    mode='new'; await page.locator('#version-check-now').click();
    await page.waitForFunction(() => document.querySelector('[data-version-status]').textContent === '有新版本');
    mode='offline'; await page.locator('#version-check-now').click();
    await page.waitForFunction(() => document.querySelector('[data-version-status]').textContent === '检查失败');
    assert((await page.locator('#version-content').innerText()).includes(nextVersion));
    mode='rate-limit'; await page.locator('#version-check-now').click();
    await page.waitForFunction(() => document.querySelector('.version-error')?.textContent.includes('请求受限'));
    mode='normal'; await page.locator('#version-check-now').click();
    await page.waitForFunction(status => document.querySelector('[data-version-status]').textContent === status, expectedStatus);
    await page.locator('#version-dialog').screenshot({path:path.join(output,'version-dialog.png')});
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#version-dialog').evaluate(el=>el.open),false);
    assert.equal(await page.locator('#version-button').evaluate(el=>document.activeElement===el),true);
    report.scenarios.push('six outcome groups and exact raw-key log filter','5/10/20 rows and reload persistence','20-row paginated detail','cached check, update, offline, rate limit and retry','dialog Escape and focus return');
    for (const skin of ['glass','claude']) for (const [width,nav] of [[1440,'left'],[1440,'top'],[1100,'top'],[901,'top'],[390,'left'],[320,'left']]) {
      await page.setViewportSize({width,height:width>600?1000:844});
      await page.locator('#btn-open-bg-customizer').click();
      await page.locator('[data-appearance-tab="theme"]').click();
      await page.locator(`[data-skin-select="${skin}"]`).click();
      await page.locator('[data-appearance-tab="material"]').click();
      await page.locator(`[data-navigation-layout="${nav}"]`).click();
      await page.locator('#btn-close-bg-popover').click();
      await page.locator('.overview-slow-table').waitFor();
      const theme = skin==='glass'?'cosmos-glass':'light-glass';
      if (await page.locator('html').getAttribute('data-theme')!==theme) await page.locator('#theme-toggle').click();
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.evaluate(() => document.fonts.ready);
      const layout=await page.evaluate(() => {
        const bounds=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return {width:r.width,right:r.right,left:r.left};};
        const interactive=[...document.querySelectorAll('.top-actions-dock button,.top-actions-dock a')].filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return {name:el.getAttribute('aria-label')||el.textContent.trim(),left:r.left,right:r.right};});
        return {pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,header:bounds('.navbar-content'),slow:bounds('.overview-slow-panel'),outcomes:bounds('.console-donut'),versionVisible:document.querySelector('#version-button').getBoundingClientRect().width>0,slowRows:document.querySelectorAll('#overview-slow-rows tr').length,interactive};
      });
      report.layouts.push({skin,width,nav,...layout});
      const hideFixed='.top-header-grid,.mobile-nav{visibility:hidden!important}';
      await page.locator('.console-donut').screenshot({path:path.join(output,`outcomes-${skin}-${width}-${nav}.png`),style:hideFixed});
      await page.locator('.overview-slow-panel').screenshot({path:path.join(output,`slow-${skin}-${width}-${nav}.png`),style:hideFixed});
      await page.locator('.overview-cache-panel').screenshot({path:path.join(output,`cache-${skin}-${width}-${nav}.png`),style:hideFixed});
      if (width>=901) {await page.evaluate(()=>scrollTo(0,0)); await page.screenshot({path:path.join(output,`header-${skin}-${width}-${nav}.png`)});}
      assert(layout.pageOverflow<=1, `Page overflows at ${skin}/${width}: ${layout.pageOverflow}`);
      assert(layout.versionVisible);
      assert(layout.slow.right<=width+1);
      assert(layout.interactive.every(item=>item.left>=0&&item.right<=width+1),`Header controls clipped at ${skin}/${width}/${nav}`);
    }
    assert.deepEqual(await page.evaluate(()=>window.__insightRejections),[]);
    assert.deepEqual(report.errors,[]);
    assert.deepEqual(report.blockedWrites,[]);
    report.status='passed';
    await context.close();
  } finally {
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    await browser.close(); await new Promise(resolve=>server.close(resolve));
  }
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
