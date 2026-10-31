// Browser acceptance with synthetic upload/backup responses; no writes reach a device.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createPreviewServer } = require('./preview_ui.cjs');
const { fixtureKey, FJGOE_FEATURES, launchBrowser } = require('./verify_support.cjs');
const { chromium } = require(process.env.LOCALDNS_PLAYWRIGHT || 'playwright');
const fixtures = require('../frontend/tests/fixtures/api.json');
const metadata = require('../VERSION.json');
const out = path.resolve(__dirname, '../dist/core-upload-verification');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const zip = Buffer.from('synthetic upstream ZIP transfer fixture');
const backup = Buffer.from('synthetic complete backup fixture');
const selectedFile = { name: 'LocalDNS_FJNEW.zip', mimeType: 'application/zip', buffer: zip };
const jobId = 'a'.repeat(24);
const report = { checks: [], errors: [], screenshots: [], layouts: [] };
let browser, server;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await launchBrowser(chromium);
  for (const width of [1440, 390]) for (const theme of ['dark', 'light-glass']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(theme => localStorage.setItem('localdnsTheme', theme), theme);
    let supportsUpload = true, uploads = 0, loseResponse = false;
    const idle = () => ({ state: 'idle', canRollback: false, installedVersion: metadata.uiVersion, installedBackend: metadata.backendVersion });
    let task = idle();
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), p = url.pathname;
      // Prove uploaded cores remain available even when GitHub cannot be reached.
      if (url.hostname === 'api.github.com') return route.fulfill({ status: 503, json: { error: 'Fixture: GitHub unavailable' } });
      if (url.origin !== origin) return route.fulfill({ status: 503, json: { error: 'Fixture: optional service unavailable' } });
      if (p.startsWith('/upgrade')) {
        assert.equal(request.headers().authorization, undefined);
        if (p === '/upgrade/ui') return route.fulfill({ json: { protocol: 'localdns-ui-updater/v1', repository: 'https://github.com/yyhoworks/LocalDNS', capabilities: {
          protocol: 'localdns-updater/v2', modes: ['ui', 'core', 'full'], installed: { uiVersion: metadata.uiVersion, backendVersion: metadata.backendVersion },
          ...(supportsUpload ? { coreUpload: { format: 'upstream-zip', maxBytes: 256 * 1048576, architecture: 'amd64-v1' } } : {}),
        } } });
        if (p === '/upgrade/status') return route.fulfill({ json: task });
        if (p === '/upgrade/core/upload') {
          assert.equal(request.method(), 'POST');
          assert.equal(request.headers()['content-type'], 'application/zip');
          assert.equal(request.headers()['x-content-sha256'], hash(zip));
          assert.deepEqual(request.postDataBuffer(), zip);
          uploads++;
          task = { ...idle(), state: 'awaiting_backup', mode: 'core', source: 'upload', targetBackend: 'FJNEW', jobId,
            message: '备份已就绪。请下载到本机，并选择下载文件校验后继续。', backupDownloaded: false,
            backup: { name: 'localdns-original.tar.gz', sha256: hash(backup), bytes: backup.length } };
          if (loseResponse) { task = { ...task, state: 'running', message: '服务器仍在准备内核…' }; return route.abort('failed'); }
          return route.fulfill({ status: 202, json: task });
        }
        if (p === '/upgrade/backup/' + jobId) {
          assert.equal(request.method(), 'POST'); task.backupDownloaded = true;
          return route.fulfill({ contentType: 'application/gzip', body: backup });
        }
        if (p === '/upgrade/continue') {
          assert.deepEqual(request.postDataJSON(), { jobId, sha256: hash(backup) });
          task = { ...task, state: 'succeeded', installedBackend: 'FJNEW', canRollback: true, rollbackKind: 'full', message: '内核已升级，当前 UI 保持原样；DNS 与原设置检查通过。' };
          return route.fulfill({ status: 202, json: task });
        }
        throw new Error('Unexpected updater operation: ' + p);
      }
      if (p === '/metrics') return route.fulfill({ contentType: 'text/plain', body: fs.readFileSync(path.resolve(__dirname, '../frontend/tests/fixtures/metrics.prom'), 'utf8') });
      if (/^\/(api|plugins)\//.test(p)) {
        assert.equal(request.method(), 'GET', 'Business API must remain read-only');
        const body = structuredClone(fixtures[fixtureKey(p)] || {});
        if (p === '/api/v1/status') body.version = task.installedBackend;
        return route.fulfill({ json: p === '/api/v1/features' ? FJGOE_FEATURES : body });
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push({ width, theme, message: error.message }));
    await page.goto(origin + '/ui/');
    await page.locator('#version-button').click();
    const file = page.locator('[data-core-file]'), start = page.locator('[data-start="core"]');
    await page.waitForFunction(() => !document.querySelector('[data-core-file]')?.disabled);
    await page.locator('#version-content .version-error').waitFor();
    assert(await start.isDisabled());
    await file.setInputFiles({ ...selectedFile, name: 'not-a-kernel.exe' });
    await page.locator('[data-error]:not([hidden])').waitFor();
    assert(await start.isDisabled());
    await file.setInputFiles(selectedFile);
    assert(await start.isEnabled());
    const coreShot = `core-${width}-${theme}.png`;
    await page.locator('[data-mode="core"]').screenshot({ path: path.join(out, coreShot) });
    report.screenshots.push(coreShot);
    const shot = `selected-${width}-${theme}.png`;
    await page.locator('#version-dialog').screenshot({ path: path.join(out, shot) });
    report.screenshots.push(shot);
    const layout = await page.locator('#version-dialog').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
    assert(layout.scrollWidth <= layout.width + 1);
    report.layouts.push({ viewport: width, theme, ...layout });
    await start.click(); await page.locator('#confirm-cancel').click();
    assert.equal(uploads, 0, 'Cancellation must not upload');
    await start.click(); await page.locator('#confirm-ok').click();
    await page.locator('.version-backup:not([hidden])').waitFor();
    assert.equal(uploads, 1);
    assert(await start.isDisabled());
    assert(await page.locator('[data-continue]').isDisabled());
    assert((await page.locator('[data-mode="core"] [data-target]').textContent()).includes('FJNEW'));
    const downloading = page.waitForEvent('download');
    await page.locator('[data-download]').click();
    const downloaded = await downloading;
    const saved = path.join(out, `backup-${width}-${theme}.tar.gz`);
    await downloaded.saveAs(saved);
    await page.waitForFunction(() => !document.querySelector('[data-file]')?.disabled);
    await page.locator('[data-file]').setInputFiles({ name: 'wrong.tar.gz', mimeType: 'application/gzip', buffer: Buffer.from('wrong') });
    await page.getByText('校验未通过，现网尚未切换。', { exact: true }).waitFor();
    assert(await page.locator('[data-continue]').isDisabled());
    await page.locator('[data-file]').setInputFiles(saved);
    await page.waitForFunction(() => !document.querySelector('[data-continue]')?.disabled);
    await page.getByRole('button', { name: '关闭版本信息' }).click();
    await page.locator('#version-button').click();
    assert(await page.locator('.version-backup').isVisible());
    await page.locator('[data-continue]').click();
    await page.getByText('内核已升级，当前 UI 保持原样；DNS 与原设置检查通过。', { exact: true }).waitFor();
    assert(await page.locator('[data-rollback]').isVisible());
    assert(await page.locator('[data-refresh]').isHidden());
    assert.equal(task.installedVersion, metadata.uiVersion);
    report.checks.push(`${width}/${theme}: offline GitHub, file validation, cancel, upload, backup verification, reopen, core-only completion`);
    supportsUpload = false;
    await page.reload(); await page.locator('#version-button').click();
    await page.getByText('请先更新升级服务，以支持上传内核 ZIP。', { exact: true }).waitFor();
    assert(await file.isDisabled());
    assert(await page.locator('[data-help]').isVisible());
    report.checks.push(`${width}/${theme}: old v2 service requires updating before upload`);
    supportsUpload = true; task = idle(); loseResponse = true;
    await page.reload(); await page.locator('#version-button').click();
    await page.waitForFunction(() => !document.querySelector('[data-core-file]')?.disabled);
    await file.setInputFiles(selectedFile); await start.click(); await page.locator('#confirm-ok').click();
    await page.getByText('服务器仍在准备内核…', { exact: true }).waitFor();
    assert(await start.isDisabled(), 'Lost upload response must reconcile server state and prevent resubmission');
    report.checks.push(`${width}/${theme}: lost upload response reconciles active job`);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, layouts: report.layouts, errors: report.errors, output: out }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
