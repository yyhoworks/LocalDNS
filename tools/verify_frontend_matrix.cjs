/* Theme/navigation visual regression plus route-owned resources. Backend writes never leave fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createPreviewServer} = require('./preview_ui.cjs');
const {chromium} = require(process.env.LOCALDNS_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'dist/frontend-matrix-verification');
const fixtures = require('../frontend/tests/fixtures/api.json');
const metrics = fs.readFileSync(path.join(root, 'frontend/tests/fixtures/metrics.prom'), 'utf8');
const version = require('../VERSION.json');
const baseline = process.env.LOCALDNS_FRONTEND_BASELINE;
if (baseline) assert.match(baseline, /^[a-f0-9]{40}$/i);
const selectors = {overview:'.console-service-summary', logs:'.log-detail', upstreams:'#up-add', rules:'.wb-list-heading', management:'[data-collection-control="caches"]'};
const report = {checks:[], views:[], errors:[], warnings:[], resources:[], requests:[]};
const cache = new Map();
let server, browser;
function gitFile(relative) {
  if (!cache.has(relative)) cache.set(relative, execFileSync('git', ['show', `${baseline}:_src/ui/${relative}`], {cwd:root, maxBuffer:20*1024*1024}));
  return cache.get(relative);
}
async function ready(page, route) {
  await page.locator(selectors[route]).waitFor();
  await page.waitForFunction(() => !document.querySelector('#page-content .skeleton'));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
(async () => {
  fs.mkdirSync(out, {recursive:true});
  server = createPreviewServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({channel:process.env.LOCALDNS_BROWSER || 'msedge', headless:true});
  report.browser = browser.version(); report.baseline = baseline || null;
  for (const [width,height] of [[1440,1000],[1024,768],[390,844]]) {
    for (const skin of ['claude','glass']) for (const theme of ['light-glass','cosmos-glass']) for (const nav of width===390 ? ['left'] : ['left','top']) {
      const snapshots = {};
      for (const mode of baseline ? ['baseline','generated'] : ['generated']) {
        const context = await browser.newContext({viewport:{width,height}, reducedMotion:'reduce', locale:'zh-CN', timezoneId:'Asia/Shanghai'});
        await context.addInitScript(({skin,theme,nav}) => {
          localStorage.setItem('localdns-skin-v1', JSON.stringify({active:skin,claude:{preset:theme==='cosmos-glass'?'obsidian':'parchment',theme},glass:{theme}}));
          localStorage.setItem('localdnsTheme', theme);
          localStorage.setItem('localdns-navigation-v1', JSON.stringify({mode:nav,collapsed:false}));
        }, {skin,theme,nav});
        let delay = '', release, requested;
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url()), p = url.pathname;
          if (url.hostname==='api.github.com') return route.fulfill({contentType:'application/json', body:JSON.stringify({tag_name:version.releaseTag,draft:false,prerelease:false,assets:[]})});
          if (url.port==='9090') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#386b89"/></svg>'});
          if (p==='/metrics' || p.startsWith('/api/') || p.startsWith('/plugins/')) {
            report.requests.push({mode,width,skin,theme,nav,method:request.method(),url:p+url.search});
            assert.equal(request.method(), 'GET', 'Matrix must never perform backend writes');
            if (p===delay) { requested?.(); await new Promise(resolve => { release=resolve; }); delay=''; }
            if (p==='/metrics') return route.fulfill({contentType:'text/plain',body:metrics});
            if (/^\/plugins\/switch\d+\/show$/.test(p)) return route.fulfill({contentType:'text/plain',body:'A'});
            if (/^\/plugins\/[\w-]+\/show$/.test(p)) return route.fulfill({contentType:'text/plain',body:'domain:example.com'});
            return route.fulfill({contentType:'application/json',body:JSON.stringify(fixtures[p] ?? (/\/config$/.test(p) ? [] : {}))});
          }
          if (mode==='baseline' && (p==='/ui/' || p.startsWith('/ui/assets/'))) {
            const relative = p==='/ui/' ? 'index.html' : p.slice('/ui/'.length);
            const contentType = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'}[path.extname(relative)] || 'application/octet-stream';
            return route.fulfill({contentType,body:gitFile(relative)});
          }
          return route.continue();
        });
        const page = await context.newPage(); page.setDefaultTimeout(10000);
        page.on('pageerror', error => report.errors.push({mode,width,skin,theme,nav,error:error.message}));
        page.on('console', message => { if (['warning','error'].includes(message.type())) report.warnings.push({mode,text:message.text()}); });
        page.on('response', response => { if (response.status()>=400) report.resources.push({mode,url:response.url(),status:response.status()}); });
        await page.clock.setFixedTime(new Date('2026-10-19T08:00:00Z'));
        await page.goto(origin+'/ui/'); await ready(page,'overview');
        snapshots[mode] = {};
        for (const name of Object.keys(selectors)) {
          await page.evaluate(name => { location.hash='#/'+name; },name); await ready(page,name);
          const info = await page.evaluate(() => {
            const root=document.documentElement;
            return {title:document.title,hash:location.hash,skin:root.dataset.skin,theme:root.dataset.theme,nav:root.dataset.nav,
              overflow:root.scrollWidth-innerWidth,text:document.querySelector('#page-content').innerText,
              boxes:[...document.querySelectorAll('#page-content .view-title-row,#page-content .card,#page-content .console-service-summary')].map(node => {
                const box=node.getBoundingClientRect(),style=getComputedStyle(node);
                return {x:box.x,y:box.y,width:box.width,height:box.height,color:style.color,background:style.backgroundColor,font:style.fontFamily};
              })};
          });
          assert.equal(info.title,'LocalDNS 控制台'); assert.equal(info.hash,'#/'+name);
          assert.equal(info.skin,skin); assert.equal(info.theme,theme); assert.equal(info.nav,nav);
          assert(info.text.trim()); assert(info.overflow<=1,`${name}/${width}/${skin}/${theme}/${nav} overflows`);
          assert.equal(await page.locator('vite-error-overlay,.error-panel').count(),0);
          const file=`${mode}-${name}-${width}-${skin}-${theme}-${nav}.png`;
          await page.screenshot({path:path.join(out,file),fullPage:true,animations:'disabled'});
          snapshots[mode][name]=info; report.views.push(file);
        }
        if (mode==='generated' && skin==='claude' && theme==='light-glass' && nav==='left') {
          // A saved collection choice must survive a fresh application instance.
          await page.locator('[data-collection-control="caches"] [data-layout="list"]').click();
          await page.reload(); await ready(page,'management');
          assert.equal(await page.locator('[data-collection-kind="caches"]').getAttribute('data-collection-layout'),'list');
          await page.locator('[data-collection-control="caches"] [data-layout="cards"]').click();
          await page.evaluate(() => { location.hash='#/logs'; }); await ready(page,'logs');
          const logRequest=report.requests.filter(item=>item.mode===mode&&item.width===width&&item.url.startsWith('/api/v2/audit/logs?')).at(-1);
          assert.equal(new URL(logRequest.url,origin).searchParams.get('limit'),width===390?'25':'50');
          // Filters and pagination are session UI state across route changes.
          await page.locator('#log-q').fill('retained.example'); await page.locator('#log-search').click(); await ready(page,'logs');
          await page.evaluate(() => { location.hash='#/upstreams'; }); await ready(page,'upstreams');
          await page.evaluate(() => { location.hash='#/logs'; }); await ready(page,'logs');
          assert.equal(await page.locator('#log-q').inputValue(),'retained.example');
          await page.evaluate(() => { location.hash='#/overview'; }); await ready(page,'overview');
          await page.evaluate(() => { location.hash='#/logs'; }); await ready(page,'logs');
          const count=report.requests.filter(item=>item.url==='/metrics').length;
          await page.clock.runFor(6200);
          assert.equal(report.requests.filter(item=>item.url==='/metrics').length,count,'Overview sampling continued after leaving');
          assert.equal(await page.evaluate(() => Object.keys(window.Chart?.instances||{}).length),0);
          assert.equal(await page.locator('.is-flow,#slow-type-popover,.up-error-popover').count(),0);
          if (width===1440) {
            await page.evaluate(() => { location.hash='#/rules'; }); await ready(page,'rules');
            delay='/plugins/adguard/rules'; const started=new Promise(resolve=>{requested=resolve;});
            await page.locator('[data-rule-tab="adguard"]').click(); await started;
            await page.locator('[data-rule-tab="lists"]').click(); await ready(page,'rules');
            release(); await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            assert.equal(await page.locator('[data-rule-tab="lists"]').getAttribute('class'),'seg-item active');
            assert.equal(await page.locator('.wb-list-heading').count(),1);
          }
          report.checks.push(`Collection persistence, query restoration, ${width===390?25:50} log limit, stopped overview sampling/charts at ${width}`);
        }
        await context.close();
      }
      if (baseline) for (const name of Object.keys(selectors)) assert.deepEqual(snapshots.generated[name],snapshots.baseline[name],`Visual contract ${name}/${width}/${skin}/${theme}/${nav}`);
      report.checks.push(`Five routes ${width}x${height}/${skin}/${theme}/${nav}${baseline?' match baseline text, geometry and surface styles':''}`);
    }
  }
  assert.deepEqual(report.errors,[]); assert.deepEqual(report.warnings,[]); assert.deepEqual(report.resources,[]);
  report.passed=true;
})().catch(error=>{report.failure=error.stack;process.exitCode=1;}).finally(async()=>{
  if (browser) await browser.close(); if (server) await new Promise(resolve=>server.close(resolve));
  fs.mkdirSync(out,{recursive:true}); fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,views:report.views.length,requests:report.requests.length},null,2));
});
