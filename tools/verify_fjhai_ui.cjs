// Browser acceptance against local, synthetic FJHAI responses. Never reaches a VM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPreviewServer } = require('./preview_ui.cjs');
const { fixtureKey, FJGOE_FEATURES, launchBrowser } = require('./verify_support.cjs');
const { chromium } = require(process.env.LOCALDNS_PLAYWRIGHT || 'playwright');
const fixtures = require('../frontend/tests/fixtures/api.json');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist/fjhai-ui-verification');
const metrics = fs.readFileSync(path.join(root, 'frontend/tests/fixtures/metrics.prom'), 'utf8');
const report = { checks: [], writes: [], errors: [], screenshots: [] };
let browser, server;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await launchBrowser(chromium);
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const lists = { foreign_cidrs: '192.0.2.0/24\n2001:db8::/32' };
    let release, started = false;
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!p.startsWith('/api/') && !p.startsWith('/plugins/') && p !== '/metrics') return route.continue();
      if (req.method() !== 'GET') {
        report.writes.push({ width, path: p, method: req.method(), body: req.postDataJSON() });
        if (p.endsWith('/update') || p === '/api/v1/adguard/update') {
          started = true;
          await new Promise(resolve => { release = resolve; });
        }
        if (p.startsWith('/api/v1/lists/')) lists[p.split('/').pop()] = req.postDataJSON().values.join('\n');
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ changed: true, rule_count: 7, detected_format: 'srs', updated_sources: 1 }) });
      }
      if (p === '/metrics') return route.fulfill({ contentType: 'text/plain', body: metrics });
      if (p === '/api/v1/features') return route.fulfill({ json: FJGOE_FEATURES });
      if (p.startsWith('/api/v1/lists/')) return route.fulfill({ contentType: 'text/plain', body: lists[p.split('/').pop()] || 'domain:example.com' });
      if (p === '/api/v1/adguard/rules') return route.fulfill({ json: [{ id: 'test-ads', name: '测试广告订阅', url: 'https://example.com/adguard.txt', enabled: true, auto_update: true, rule_count: 7 }] });
      if (p.startsWith('/api/v1/rule-groups/')) {
        const tag = p.split('/').pop();
        return route.fulfill({ json: ['custom_cn','geoip_non_cn'].includes(tag) ? [{ name: '测试 ' + tag, type: tag, url: 'https://example.com/rules.srs', enabled: true, detected_format: 'srs', rule_count: 10 }] : [] });
      }
      const body = structuredClone(fixtures[fixtureKey(p)] ?? {});
      if (p === '/api/v1/status') body.version = 'FJHAI';
      if (p === '/api/v1/querylog/entries') {
        body.logs[0].domain_set = 'geosite_cn_unverified_noreply';
        body.filters.domain_sets = ['geosite_cn_unverified_noreply'];
      }
      return route.fulfill({ json: body });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => report.errors.push({ width, message: e.message }));
    await page.goto(`http://127.0.0.1:${server.address().port}/ui/#/rules`);
    await page.locator('#rv-root').waitFor();
    await page.locator('[data-rule-group="解析控制"]').click();
    await page.locator('[data-rule-tag="foreign_ip"]').click();
    await page.locator('.wb-list-heading').filter({ hasText: '国外 IP 段' }).waitFor();
    await page.locator('#rv-new').click();
    await page.locator('[data-new="rule"]').click();
    await page.locator('#rv-value').fill('198.51.100.0/24');
    await page.locator('#rv-ok').click();
    await page.locator('#rule-save').click();
    await page.waitForFunction(() => document.querySelector('#toast-stack').textContent.includes('国外 IP 段已保存'));
    const save = report.writes.filter(w => w.width === width && w.path === '/api/v1/lists/foreign_cidrs').at(-1);
    assert(save.body.values.includes('198.51.100.0/24'));
    assert(!save.body.values.some(value => value.startsWith('domain:')));
    report.checks.push({ width, check: 'foreign CIDR editor saves raw addresses', passed: true });
    let shot = `foreign-cidrs-${width}.png`;
    await page.screenshot({ path: path.join(out, shot), fullPage: true });report.screenshots.push(shot);

    await page.locator('[data-rule-tab="adguard"]').click();
    await page.locator('.ad-update').waitFor();
    await page.clock.install();
    await page.locator('.ad-update').click();
    await page.waitForFunction(() => document.querySelector('.ad-update').textContent === '更新中…');
    await page.clock.fastForward(11000);
    assert(await page.locator('.ad-update').isDisabled());
    assert(await page.locator('#ad-update-all').isDisabled());
    await page.locator('[data-rule-tab="diversion"]').click();
    await page.locator('#div-update-all').waitFor();
    await page.locator('[data-rule-tab="adguard"]').click();
    await page.waitForFunction(() => document.querySelector('.ad-update')?.textContent === '更新中…');
    while (!started) await new Promise(resolve => setTimeout(resolve, 10));
    shot = `adguard-updating-${width}.png`;
    await page.screenshot({ path: path.join(out, shot), fullPage: true });report.screenshots.push(shot);
    release();
    await page.waitForFunction(() => document.querySelector('.ad-update')?.textContent === '更新' && !document.querySelector('#ad-update-all').disabled);
    report.checks.push({ width, check: 'AdGuard pending after 11 seconds and tab changes, then restored', passed: true });

    started = false;
    await page.locator('[data-rule-tab="diversion"]').click();
    await page.locator('.collection-switch [data-layout="list"]').click();
    await page.locator('[data-div-update-group="geoip_non_cn"]').click();
    await page.waitForFunction(() => document.querySelector('[data-div-update-group="geoip_non_cn"]').textContent === '更新中…');
    while (!started) await new Promise(resolve => setTimeout(resolve, 10));
    shot = `diversion-updating-${width}.png`;
    await page.screenshot({ path: path.join(out, shot), fullPage: true });report.screenshots.push(shot);
    release();
    await page.waitForFunction(() => !document.querySelector('#div-update-all').disabled);
    report.checks.push({ width, check: 'group update busy state and recovery', passed: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert(!overflow, 'Document must fit the viewport');

    await page.goto(`http://127.0.0.1:${server.address().port}/ui/#/logs`);
    const choice = page.locator('#log-set option[value="geosite_cn_unverified_noreply"]');
    await choice.waitFor({ state: 'attached' });
    assert.equal(await choice.textContent(), '国内规则待验证·国外无回应');
    await page.locator('#log-set').selectOption('geosite_cn_unverified_noreply');
    const filtered = page.waitForRequest(req => req.url().includes('domain_set=geosite_cn_unverified_noreply'));
    await page.locator('#log-search').click();await filtered;
    report.checks.push({ width, check: 'Chinese query filter retains backend code', passed: true });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
})().catch(error => { console.error(error);process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
