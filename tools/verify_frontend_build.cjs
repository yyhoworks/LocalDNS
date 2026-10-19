/* Built UI smoke / optional Git baseline comparison. All backend data uses fixtures. */
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require(process.env.LOCALDNS_PLAYWRIGHT || 'playwright');
const {createPreviewServer} = require('./preview_ui.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist/frontend-build-verification');
const report = {checks: [], scenarios: [], pageErrors: [], consoleErrors: [], resourceErrors: [], blocked: [], fixtureMethods: []};
const baseline = process.env.LOCALDNS_FRONTEND_BASELINE;
const widths = process.env.LOCALDNS_VIEWPORTS ? process.env.LOCALDNS_VIEWPORTS.split(',').map(Number) : [1440, 1024, 390];
assert(widths.length && widths.every(width => [1440, 1024, 390].includes(width)), 'Use supported baseline widths: 1440,1024,390');
if (baseline) assert.match(baseline, /^[a-f0-9]{40}$/i, 'Use a full baseline commit SHA');
const baselineApp = baseline && execFileSync('git', ['show', `${baseline}:_src/ui/assets/js/app.js`], {cwd: root});
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'VERSION.json'), 'utf8'));
const log = {query_time: '2026-10-19T07:59:00Z', query_name: 'example.com', query_type: 'A', client_ip: '192.0.2.10', domain_set: 'cache_main', duration_ms: 12, response_code: 'NOERROR', answers: [{data: '192.0.2.20'}]};
const metrics = [
  `localdns_info{version="${metadata.backendVersion}"} 1`,
  'localdns_runtime_info{runtime="rust-1.98.1",platform="amd64-v3"} 1',
  'process_start_time_seconds 1792382400', 'process_cpu_seconds_total 12',
  'process_resident_memory_bytes 33554432', 'localdns_queries_total 1000',
  ...['cache_main', 'cache_domestic', 'cache_foreign', 'cache_foreign_ecs'].flatMap(tag => [
    `localdns_cache_query_total{tag="${tag}"} 100`, `localdns_cache_hit_total{tag="${tag}"} 80`,
    `localdns_cache_lazy_hit_total{tag="${tag}"} 10`, `localdns_cache_size_current{tag="${tag}"} 20`,
  ]),
].join('\n');

const fixture = http.createServer((request, response) => {
  report.fixtureMethods.push(request.method);
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  const url = new URL(request.url, 'http://fixture.test');
  let body;
  if (url.pathname === '/metrics') {
    response.writeHead(200, {'Content-Type': 'text/plain'}).end(metrics); return;
  }
  if (/^\/plugins\/switch\d+\/show$/.test(url.pathname)) {
    response.writeHead(200, {'Content-Type': 'text/plain'}).end('A'); return;
  }
  switch (url.pathname) {
    case '/plugins/client_name': body = {'192.0.2.10': '测试客户端'}; break;
    case '/api/v1/status': body = {stats: {adguard_blocked: 10}, rules: {geosite_cn: 100}}; break;
    case '/api/v1/audit/status': body = {capturing: true}; break;
    case '/api/v1/audit/capacity': body = {capacity: 10000}; break;
    case '/api/v1/upstream/config': body = {}; break;
    case '/api/v2/audit/stats': body = {total_queries: 1000, average_duration_ms: 3.25, client_count: 1, domain_count: 1}; break;
    case '/api/v2/audit/rank/domain': body = [{key: 'example.com', count: 1000}]; break;
    case '/api/v2/audit/rank/client': body = [{key: '192.0.2.10', count: 1000}]; break;
    case '/api/v2/audit/rank/domain_set': body = [{key: 'cache_main', count: 800}, {key: 'geosite_cn', count: 200}]; break;
    case '/api/v2/audit/rank/slowest': body = [log]; break;
    case '/api/v2/audit/logs': body = {logs: [log], filters: {query_types: ['A'], domain_sets: ['cache_main'], response_codes: ['NOERROR']}, pagination: {current_page: 1, total_pages: 1, total_items: 1}}; break;
    default: response.writeHead(404).end('Unknown fixture endpoint'); return;
  }
  response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(body));
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
let server, browser;

async function main() {
  fs.mkdirSync(output, {recursive: true});
  await listen(fixture);
  server = createPreviewServer({backend: `http://127.0.0.1:${fixture.address().port}`, onBlocked: item => report.blocked.push(item)});
  await listen(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  report.origin = origin + '/ui/';
  report.baseline = baseline || null;
  for (const [method, endpoint] of [['POST', '/api/v1/upstream/config'], ['PUT', '/plugins/client_name'], ['DELETE', '/api/v1/upstream/config'], ['GET', '/plugins/cache_main/flush']]) {
    assert.equal((await fetch(origin + endpoint, {method})).status, 403);
  }
  report.checks.push('Preview rejects POST/PUT/DELETE and mutating GET before the fixture backend');
  assert.equal((await fetch(origin + '/ui/')).status, 200);
  browser = await chromium.launch({headless: true, channel: process.env.LOCALDNS_BROWSER || 'msedge'});
  report.browser = {channel: process.env.LOCALDNS_BROWSER || 'msedge', version: browser.version()};
  for (const width of widths) {
    for (const reducedMotion of ['reduce', 'no-preference']) {
      const snapshots = {};
      for (const mode of baseline ? ['baseline', 'generated'] : ['generated']) {
        const context = await browser.newContext({viewport: {width, height: width === 390 ? 844 : width === 1024 ? 768 : 1000}, reducedMotion, locale: 'zh-CN', timezoneId: 'Asia/Shanghai'});
        try {
          await context.route('https://api.github.com/repos/yyhoworks/LocalDNS/releases/latest', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({tag_name: metadata.releaseTag, draft: false, prerelease: false, assets: []})}));
          await context.route('http://127.0.0.1:9090/**', route => route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#386b89"/></svg>'}));
          if (mode === 'baseline') {
            await context.route('**/ui/', route => route.fulfill({contentType:'text/html',body:execFileSync('git',['show',`${baseline}:_src/ui/index.html`],{cwd:root})}));
            await context.route('**/ui/assets/**', route => {
              const relative=new URL(route.request().url()).pathname.slice('/ui/'.length);
              const body=execFileSync('git',['show',`${baseline}:_src/ui/${relative}`],{cwd:root,maxBuffer:15*1024*1024});
              const ext=path.extname(relative),type={'.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'}[ext];
              return route.fulfill({contentType:type||'application/octet-stream',body});
            });
            await context.route('**/assets/js/app.js*', route => route.fulfill({contentType: 'application/javascript', body: baselineApp}));
          }
          const page = await context.newPage();
          page.setDefaultTimeout(10000);
          await page.clock.setFixedTime(new Date('2026-10-19T08:00:00Z'));
          page.on('pageerror', error => report.pageErrors.push({mode, width, reducedMotion, message: error.message}));
          page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.consoleErrors.push({mode, width, type: message.type(), text: message.text(), location: message.location()}); });
          page.on('response', response => { if (response.status() >= 400) report.resourceErrors.push({mode, path: new URL(response.url()).pathname, status: response.status()}); });
          await page.goto(origin + '/ui/');
          await page.locator('.console-service-summary').waitFor();
          await page.waitForFunction(() => document.querySelectorAll('.console-kpi .display-number').length === 6);
          assert.equal(await page.title(), 'LocalDNS 控制台');
          assert.equal(await page.locator('vite-error-overlay,.error-panel').count(), 0);
          assert(await page.locator('#page-content').innerText());
          const nav = page.locator(width === 390 ? '#mobile-nav' : '#side-nav');
          await nav.getByRole('button', {name: width === 390 ? '日志' : '查询日志', exact: true}).click();
          await page.locator('.log-detail').waitFor();
          await page.locator('[data-collection-control="logs"]').waitFor();
          assert(page.url().endsWith('#/logs'));
          await page.evaluate(() => document.fonts.ready);
          const logs = await page.locator('#page-content').innerText();
          assert(logs.includes('example.com'));
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          await nav.getByRole('button', {name: width === 390 ? '概览' : '运行概览', exact: true}).click();
          await page.locator('.console-service-summary').waitFor();
          await page.evaluate(() => document.fonts.ready);
          // Allow existing layout/entrance animations to finish before comparing geometry.
          await page.waitForTimeout(1500);
          const dom = await page.evaluate(() => ({
            title: document.title, url: location.href, width: innerWidth,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            text: document.querySelector('#page-content').innerText,
            scripts: [...document.scripts].map(node => node.getAttribute('src')).filter(Boolean),
            globalKeys: Object.keys(window).sort(),
            metricGlobals: ['parseProm', 'metricFind'].filter(key => key in window),
            flows: document.querySelectorAll('.is-flow').length,
            boxes: [...document.querySelectorAll('.console-service-summary,.console-kpi,.console-topology,.overview-cache-panel')].map(node => {
              const {x, y, width, height} = node.getBoundingClientRect(); return {x, y, width, height};
            }),
          }));
          assert(dom.overflow <= 1);
          assert.deepEqual(dom.metricGlobals, []);
          if (reducedMotion === 'reduce') assert.equal(dom.flows, 0);
          const name = `${mode}-${width}-${reducedMotion}`;
          fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify({logs, ...dom}, null, 2));
          if(process.env.LOCALDNS_STYLE_DIFF)fs.writeFileSync(path.join(output,name+'-styles.json'),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('#page-content *')].map(element=>{const style=getComputedStyle(element);return{tag:element.tagName,id:element.id,classes:element.getAttribute('class'),css:Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','marginTop','marginBottom','paddingTop','paddingBottom','paddingLeft','paddingRight','gap','borderWidth','height','width','display','maxHeight'].map(key=>[key,style[key]]))};})),null,2));
          await page.screenshot({path: path.join(output, name + '-full.png'), fullPage: true, animations: 'disabled'});
          const screenshot = await page.screenshot({path: path.join(output, name + '.png'), animations: 'disabled'});
          snapshots[mode] = {logs, dom, screenshot};
          report.scenarios.push({mode, width, reducedMotion, url: page.url(), title: dom.title, overflow: dom.overflow, flows: dom.flows, evidence: name, routes: ['overview', 'logs', 'overview']});
        } finally { await context.close(); }
      }
      if (baseline) {
        const comparable=({scripts,globalKeys,...dom})=>dom;
        assert.deepEqual(comparable(snapshots.generated.dom), comparable(snapshots.baseline.dom), `DOM/layout differ at ${width}/${reducedMotion}`);
        assert(snapshots.generated.dom.scripts.some(script=>/assets\/app-[\w-]+\.js$/.test(script)));
        assert(!snapshots.generated.dom.globalKeys.some(key=>/^LocalDNS[A-Z]/.test(key)));
        assert.equal(snapshots.generated.logs, snapshots.baseline.logs);
        if (reducedMotion === 'reduce') {
          assert(snapshots.generated.screenshot.equals(snapshots.baseline.screenshot), `Viewport screenshots differ at ${width}`);
          report.checks.push(`Reduced-motion viewport screenshot bytes match at ${width}`);
        }
        report.checks.push(`Baseline DOM and geometry match; hashed entry and zero LocalDNS service globals at ${width}/${reducedMotion}`);
      }
    }
  }
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.resourceErrors, []);
  assert(report.fixtureMethods.length > 0 && report.fixtureMethods.every(method => method === 'GET'));
  report.checks.push('No runtime errors, console warnings, failed resources, new metric globals or forwarded writes');
  report.passed = true;
}
main().catch(error => { report.failure = error.stack; process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await close(server);
  await close(fixture);
  fs.mkdirSync(output, {recursive: true});
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({...report, fixtureMethods: {requests: report.fixtureMethods.length, methods: [...new Set(report.fixtureMethods)]}}, null, 2));
});
