// Browser regression with intercepted release/updater responses. No device writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPreviewServer } = require('./preview_ui.cjs');
const { fixtureKey, FJGOE_FEATURES, launchBrowser } = require('./verify_support.cjs');
const { chromium } = require(process.env.LOCALDNS_PLAYWRIGHT || 'playwright');
const fixtures = require('../frontend/tests/fixtures/api.json');
const metadata = require('../VERSION.json');
const out = path.resolve(__dirname, '../dist/update-recovery-verification');
const report = { checks: [], layouts: [], screenshots: [], errors: [] };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await launchBrowser(chromium);
    for (const width of [1440, 390, 320]) for (const theme of ['dark', 'light-glass']) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      await context.addInitScript(theme => localStorage.setItem('localdnsTheme', theme), theme);
      let enabled = false, upload = false, limited = false, releaseRequests = 0;
      const date = new Date(Date.now() + 480 * 60000).toISOString().slice(0, 10);
      const devices = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`192.168.8.${i + 10}`, { down: (30 - i) * 1000, up: 100 }]));
      const down = Object.values(devices).reduce((sum, value) => sum + value.down, 0) + 20000, up = 3000;
      const detail = { version: 2, date, updated: new Date().toISOString(), since: date, utc_offset_minutes: 480,
        source: 'mihomo', publish_interval_seconds: 30, today: { down, up }, total: { down, up }, dimensions_since: date + 'T08:00:00+08:00',
        daily: [{ date, down, up, coverage: 'partial', first: date + 'T08:00:00+08:00', last: date + 'T09:00:00+08:00', gaps: 0,
          devices, providers: { sample: { down: down - 20000, up } }, nodes: {}, hourly: { '08': { down: 0, up: 0 }, '09': { down, up } } }],
        aliases: { '192.168.8.10': '书房里的测试电脑 · 一段很长的设备名称' } };
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), p = url.pathname;
        if (url.hostname === 'api.github.com') {
          releaseRequests++;
          return limited ? route.fulfill({ status: 403, headers: { 'Access-Control-Expose-Headers': 'X-RateLimit-Remaining, X-RateLimit-Reset', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) }, json: { message: 'API rate limit exceeded' } })
            : route.fulfill({ json: { tag_name: metadata.releaseTag, assets: [{ name: 'LocalDNS_Update.zip' }, { name: 'LocalDNS_Full.zip' }] } });
        }
        if (url.origin !== origin) return route.fulfill({ status: 503, json: {} });
        if (p.startsWith('/upgrade')) {
          assert.equal(request.method(), 'GET', 'Only read operations are permitted in this verification');
          if (!enabled) return route.fulfill({ status: 404, json: { error: 'No updater' } });
          if (p === '/upgrade/ui') return route.fulfill({ json: { protocol: 'localdns-ui-updater/v1', repository: 'https://github.com/yyhoworks/LocalDNS', capabilities: {
            protocol: 'localdns-updater/v2', modes: ['ui', 'core', 'full'], installed: metadata,
            ...(upload ? { coreUpload: { format: 'upstream-zip', maxBytes: 256 * 1048576, architecture: 'amd64-v3' } } : {}),
          } } });
          if (p === '/upgrade/status') return route.fulfill({ json: { state: 'idle', canRollback: false, installedVersion: metadata.uiVersion, installedBackend: metadata.backendVersion } });
          throw new Error('Unexpected updater path: ' + p);
        }
        if (p === '/ui/custom/traffic-detail.json') return route.fulfill({ json: detail });
        if (p === '/metrics') return route.fulfill({ contentType: 'text/plain', body: fs.readFileSync(path.resolve(__dirname, '../frontend/tests/fixtures/metrics.prom'), 'utf8') });
        if (/^\/(api|plugins)\//.test(p)) {
          assert.equal(request.method(), 'GET');
          const body = structuredClone(fixtures[fixtureKey(p)] || {});
          if (p === '/api/v1/status') body.version = metadata.backendVersion;
          return route.fulfill({ json: p === '/api/v1/features' ? FJGOE_FEATURES : body });
        }
        return route.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.errors.push({ width, theme, message: error.message }));
      await page.goto(origin + '/ui/');
      await page.locator('#version-button').click();
      await page.getByText('当前地址没有网页升级接口。请按安装说明启用独立升级服务，已有服务请核对 uiUpdaterBase 地址。', { exact: true }).waitFor();
      await page.locator('[data-mode="ui"][hidden]').waitFor({ state: 'attached' });
      assert(await page.locator('[data-start="full"]').isDisabled());
      assert(!await page.locator('[data-start="full"]').evaluate(el => el.classList.contains('primary')));
      report.checks.push(`${width}/${theme}: missing service explains setup, no misleading blue action`);
      enabled = true;
      await page.locator('[data-retry]').click();
      await page.getByText('已连接。当前服务支持 UI 与整套升级；更新升级服务后可上传内核 ZIP。', { exact: true }).waitFor();
      assert(await page.locator('[data-core-file]').isDisabled());
      upload = true; await page.locator('[data-retry]').click();
      await page.waitForFunction(() => !document.querySelector('[data-core-file]').disabled);
      assert(await page.locator('[data-start="core"]').isDisabled());
      report.checks.push(`${width}/${theme}: capability refresh enables choosing a ZIP without reloading`);
      limited = true; await page.locator('#version-check-now').click();
      await page.getByText('允许再次检查', { exact: true }).waitFor();
      assert(await page.locator('#version-check-now').isDisabled());
      assert(await page.evaluate(() => Number(localStorage.getItem('localdns-github-release-retry-at')) > Date.now() + 50 * 60000), 'Use the exposed GitHub reset time');
      assert(await page.locator('[data-core-file]').isEnabled());
      const requests = releaseRequests;
      await page.locator('#version-check-now').evaluate(el => el.onclick());
      assert.equal(releaseRequests, requests, 'Forced/manual checks respect cooldown');
      await page.reload(); await page.locator('#version-button').click();
      await page.getByText('允许再次检查', { exact: true }).waitFor();
      assert.equal(releaseRequests, requests, 'Reload respects persisted cooldown');
      report.checks.push(`${width}/${theme}: API cooldown survives forced checks and reload, core upload stays available`);
      const shot = `version-${width}-${theme}.png`;
      await page.locator('#version-dialog').screenshot({ path: path.join(out, shot) }); report.screenshots.push(shot);
      await page.locator('#version-dialog form button').click();
      await page.goto(origin + '/ui/#/proxy-config');
      await page.locator('.pt-mini-row').first().waitFor();
      assert.equal(await page.locator('.pt-mini-row').count(), 31);
      assert.equal(await page.locator('.pt-day .pt-mini-row').count(), 0);
      const layouts = await page.evaluate(() => ['.pt-analytics', '.pt-flow', '.pt-mini-list', '.pt-rank-panel'].map(selector => {
        const el = document.querySelector(selector); return { selector, width: el.clientWidth, scrollWidth: el.scrollWidth };
      }));
      for (const layout of layouts) assert(layout.scrollWidth <= layout.width + 1, `${width}/${theme} overflow: ${JSON.stringify(layout)}`);
      report.layouts.push({ width, theme, layouts });
      const trafficShot = `traffic-${width}-${theme}.png`;
      await page.screenshot({ path: path.join(out, trafficShot), fullPage: true }); report.screenshots.push(trafficShot);
      report.checks.push(`${width}/${theme}: 30 devices + unclassified bucket, calendar and rank do not overflow`);
      await context.close();
    }
    assert.deepEqual(report.errors, []);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: report.checks.length, layouts: report.layouts.length, errors: report.errors, output: out }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
