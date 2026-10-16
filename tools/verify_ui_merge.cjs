// Run with Playwright on NODE_PATH and LOCALDNS_PREVIEW_BACKEND set to the existing backend.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPreviewServer, isReadEndpoint } = require('./preview_ui.cjs');
const output = path.resolve(__dirname, '../dist/pr1-verification');
const report = { readOnly: true, checks: [], errors: [], resourceErrors: [], blocked: [], visual: [] };
const server = createPreviewServer({ backend: process.env.LOCALDNS_PREVIEW_BACKEND, onBlocked: item => report.blocked.push(item) });
let browser;
async function check(name, action) {
  try { await action(); report.checks.push({ name, passed: true }); }
  catch (error) { report.checks.push({ name, passed: false, error: error.message }); }
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, channel: process.env.LOCALDNS_BROWSER || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) report.resourceErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.addInitScript(() => {
    if (!localStorage.getItem('localdns-typography-v1')) localStorage.setItem('localdns-typography-v1', JSON.stringify({ heading: 'sans', numeral: 'mono', body: 'noto' }));
  });
  await page.goto(origin + '/ui/'); await page.locator('.console-service-summary').waitFor();
  async function route(name) {
    await page.evaluate(value => { location.hash = '#/' + value; }, name);
    const target = { overview: '.console-service-summary', logs: '.log-detail', upstreams: '#up-add', rules: '#rule-top-tabs', management: '.management-feature-card' }[name];
    await page.locator(target).first().waitFor(); await page.waitForTimeout(350);
  }
  async function appearance() {
    if (await page.locator('#btn-open-bg-customizer').getAttribute('aria-expanded') !== 'true') await page.locator('#btn-open-bg-customizer').click();
    await page.locator('#slider-radius').waitFor();
  }
  const styles = () => page.evaluate(() => Object.fromEntries(['--font-heading', '--font-numeral', '--font-sans', '--font-mono'].map(key => [key, getComputedStyle(document.documentElement).getPropertyValue(key)])));
  await check('preview refuses backend writes including GET flush', async () => {
    assert.equal(isReadEndpoint('/plugins/cache_main/flush'), false);
    const response = await fetch(origin + '/plugins/cache_main/flush'); assert.equal(response.status, 403);
    assert.equal((await fetch(origin + '/api/v1/upstream/config', { method: 'POST', body: '{}' })).status, 403);
  });
  await check('existing typography preferences survive integration', async () => {
    const fonts = await styles(); assert.match(fonts['--font-heading'], /Noto Sans/); assert.match(fonts['--font-numeral'], /IBM Plex Mono/); assert.match(fonts['--font-sans'], /Noto Sans/); assert.match(fonts['--font-mono'], /IBM Plex Mono/);
    assert.equal(await page.locator('#select-font').count(), 0);
  });
  if (process.env.LOCALDNS_EXPECT_BACKEND) await check('running backend version matches release target', async () => {
    await page.waitForFunction(expected => document.querySelector('#brand-version-tag')?.dataset.backendVersion === expected, process.env.LOCALDNS_EXPECT_BACKEND);
    const metrics = await (await fetch(origin + '/metrics')).text();
    assert(metrics.includes(`version="${process.env.LOCALDNS_EXPECT_BACKEND}"`));
  });
  await check('KPI number and unit structure recovers after a text-only update', async () => {
    const before = await page.locator('.console-kpi .sk-val').evaluateAll(nodes => nodes.map(node => node.textContent));
    assert.equal(before.length, 6);
    await page.locator('.console-kpi .sk-val').evaluateAll(nodes => nodes.forEach(node => { node.textContent = node.textContent; }));
    await page.waitForFunction(() => document.querySelectorAll('.console-kpi .sk-val .display-number').length === 6);
    assert.deepEqual(await page.locator('.console-kpi .sk-val').evaluateAll(nodes => nodes.map(node => node.textContent)), before);
    assert(await page.locator('.console-kpi .sk-val .display-unit').count() > 0);
    const metadata = await (await fetch(origin + '/ui/version.json')).json();
    const expected = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../VERSION.json'), 'utf8'));
    assert.equal(metadata.uiVersion, expected.uiVersion); assert.equal(metadata.backendVersion, expected.backendVersion);
  });
  await check('2026.10.16.1 layout, centered edges and keyboard tracing preserved', async () => {
    const layout = await page.locator('.topo-grid').evaluate(node => ({ gap: getComputedStyle(node).columnGap, columns: getComputedStyle(node).gridTemplateColumns }));
    assert.equal(layout.gap, '22px', 'Use the explicitly selected 2026.10.16.1 topology layout');
    assert.equal(layout.columns.split(' ').length, 5);
    const columns = layout.columns.split(' ').map(parseFloat);
    assert(columns.every((value, index) => Math.abs(value / columns[0] - [1, 1.05, 1.08, 1, 1][index]) < 0.002));
    assert.equal(await page.locator('[data-client-ip] .tn-icon-box').first().evaluate(node => getComputedStyle(node).display), 'none');
    assert.equal(await page.locator('.console-topology-heading').evaluate(node => getComputedStyle(node).marginBottom), '20px');
    assert.equal(await page.locator('[data-topo-preset], #topo-inspector-bar, .tn-micro-bar, .tec-ports-grid').count(), 0);
    assert.equal(await page.locator('.tec-bar-row').count(), 5);
    assert.equal(await page.locator('[data-col="4"] .tn-val').count(), 0);
    const nodes = await page.locator('.t-node:not(.t-engine-card)').evaluateAll(nodes => nodes.map(node => ({ direction: getComputedStyle(node).flexDirection, height: node.getBoundingClientRect().height })));
    assert(nodes.every(node => node.direction === 'row' && node.height >= 64));
    const engineCenter = await page.locator('[data-node-id=e_core]').evaluate(node => { const r = node.getBoundingClientRect(), wrap = document.querySelector('#topo-stage-wrap').getBoundingClientRect(); return r.top + r.height / 2 - wrap.top; });
    const edges = await page.locator('.topo-edge').evaluateAll(nodes => nodes.map(node => node.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number)));
    assert(edges.length > 10); assert(edges.slice(0, 5).every(points => Math.abs(points[7] - engineCenter) < 0.11));
    await page.locator('[data-node-id=c1]').focus(); assert(await page.locator('.topo-edge.is-active').count()); await page.locator('[data-node-id=c1]').blur();
  });
  await check('font upload, role selection, persistence, wallpaper coexistence and removal', async () => {
    await appearance(); await page.waitForFunction(() => !document.querySelector('#btn-font-upload').disabled);
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('localdns-appearance', 1);
      request.onsuccess = () => { const db = request.result, tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put('keep-wallpaper', 'merge-test-wallpaper'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
    }));
    await page.locator('#input-font-upload').setInputFiles(path.resolve(__dirname, '../_src/ui/assets/fonts/instrument-serif-numerals.woff2'));
    await page.waitForFunction(() => document.querySelectorAll('#font-heading optgroup option').length === 1);
    const id = await page.locator('#font-heading optgroup option').getAttribute('value');
    await page.locator('#font-heading').selectOption(id); await page.locator('#font-body').selectOption(id);
    let fonts = await styles(); assert.match(fonts['--font-heading'], /LocalDNSUploaded/); assert.match(fonts['--font-sans'], /LocalDNSUploaded/); assert.match(fonts['--font-numeral'], /IBM Plex Mono/); assert.match(fonts['--font-mono'], /IBM Plex Mono/);
    await page.reload(); await page.locator('.console-service-summary').waitFor(); await appearance();
    await page.waitForFunction(() => document.querySelector('#font-heading').value.startsWith('up'));
    fonts = await styles(); assert.match(fonts['--font-heading'], /LocalDNSUploaded/);
    await page.locator('#input-font-upload').setInputFiles({ name: 'invalid.woff2', mimeType: 'font/woff2', buffer: Buffer.from('invalid-font') });
    await page.waitForFunction(() => !document.querySelector('#btn-font-upload').disabled);
    assert.equal(await page.locator('.bcp-font-item').count(), 1);
    // A failed storage write must not pretend the font was removed.
    await page.evaluate(() => {
      window.mergeOriginalTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(...args) { const tx = window.mergeOriginalTransaction.apply(this, args); if (args[1] === 'readwrite') queueMicrotask(() => tx.abort()); return tx; };
    });
    await page.locator('.bcp-font-del').click(); await page.waitForFunction(() => document.querySelector('#val-font-upload').textContent.includes('移除失败'));
    assert.equal(await page.locator('.bcp-font-item').count(), 1);
    await page.evaluate(() => { IDBDatabase.prototype.transaction = window.mergeOriginalTransaction; });
    await page.locator('.bcp-font-del').click(); await page.waitForFunction(() => document.querySelectorAll('.bcp-font-item').length === 0);
    fonts = await styles(); assert.match(fonts['--font-heading'], /Noto Serif/); assert.match(fonts['--font-numeral'], /IBM Plex Mono/); assert.match(fonts['--font-mono'], /IBM Plex Mono/);
    const wallpaper = await page.evaluate(() => new Promise(resolve => { const request = indexedDB.open('localdns-appearance', 1); request.onsuccess = () => { const db = request.result, tx = db.transaction('settings'), op = tx.objectStore('settings').get('merge-test-wallpaper'); op.onsuccess = () => resolve(op.result); tx.oncomplete = () => db.close(); }; }));
    assert.equal(wallpaper, 'keep-wallpaper');
  });
  await check('radius and version label persist without overwriting other settings', async () => {
    await appearance(); await page.locator('#slider-radius').fill('150');
    await page.locator('#select-brand-ver').selectOption('custom'); await page.locator('#input-brand-ver').fill('预览版');
    await page.reload(); await page.locator('.console-service-summary').waitFor(); await appearance();
    assert.equal(await page.locator('#slider-radius').inputValue(), '150'); assert.equal(await page.locator('#brand-version-tag').innerText(), '预览版');
    await page.locator('#select-brand-ver').selectOption('version'); assert.notEqual(await page.locator('#brand-version-tag').innerText(), '预览版');
    await page.locator('#slider-radius').fill('100'); await page.locator('[data-font-preset=classic]').click(); await page.keyboard.press('Escape');
  });
  await check('copy keyboard access, search shortcut and drawer Escape', async () => {
    await route('logs'); const copy = page.locator('[data-copy]').first(); await copy.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!document.querySelector('.is-copied'));
    await page.keyboard.press('Control+k'); assert.equal(await page.locator('#global-search-input').evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Escape'); await page.locator('.log-detail').first().click();
    assert.equal(await page.locator('#drawer').getAttribute('aria-hidden'), 'false'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#drawer').getAttribute('aria-hidden'), 'true');
  });
  await check('modal backdrop and Escape close without submitting', async () => {
    await route('upstreams'); await page.locator('#up-add').click(); await page.locator('#modal').waitFor();
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#modal').getAttribute('open'), null);
    await page.locator('#up-add').click(); await page.mouse.click(6, 6); await page.waitForFunction(() => !document.querySelector('#modal').open);
  });
  await check('rule drafts remain when switching lists', async () => {
    await route('rules'); await page.locator('#rule-text').waitFor(); const original = await page.locator('#rule-text').inputValue();
    await page.locator('#rule-text').fill(original + '\nmerge-preview-unsaved.example');
    await page.locator('[data-rule-tag=blocklist]').click(); await page.locator('[data-rule-tag=whitelist]').click();
    await page.waitForFunction(() => document.querySelector('#rule-text')?.value.includes('merge-preview-unsaved.example'));
    await page.locator('#rule-text').fill(original);
  });
  await check('flow respects reduced motion, toggle, hover, focus and route cleanup', async () => {
    await route('overview'); await page.mouse.move(0, 0); await page.locator('#global-search-input').focus();
    assert.equal(await page.locator('.is-flow').count(), 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForFunction(() => document.querySelectorAll('.is-flow').length > 0);
    await appearance(); await page.locator('#btn-toggle-particles').click(); assert.equal(await page.locator('.is-flow').count(), 0);
    await page.locator('#btn-toggle-particles').click(); await page.keyboard.press('Escape'); await page.mouse.move(0, 0); await page.waitForFunction(() => document.querySelectorAll('.is-flow').length > 0);
    await page.locator('[data-node-id=c1]').hover(); await page.waitForFunction(() => document.querySelectorAll('.is-flow').length === 0);
    await page.mouse.move(0, 0); await page.waitForFunction(() => document.querySelectorAll('.is-flow').length > 0);
    await page.locator('[data-node-id=c1]').focus(); await page.waitForFunction(() => document.querySelectorAll('.is-flow').length === 0);
    await page.locator('#global-search-input').focus(); await page.waitForFunction(() => document.querySelectorAll('.is-flow').length > 0);
    await page.evaluate(() => { window.mergeOldTopology = document.querySelector('#topo-stage-wrap'); });
    await route('logs'); assert.equal(await page.evaluate(() => window.mergeOldTopology.querySelectorAll('.topo-cursor').length), 0);
    await route('overview'); await page.waitForTimeout(700);
    assert.equal(await page.locator('.console-kpi .sk-val .display-number').count(), 6, 'Count-up must retain semantic number/unit typography');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelectorAll('.is-flow').length === 0);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // One batched visual round, covering both themes and shipped viewport classes.
  for (const [width, theme] of [[1440, 'cosmos-glass'], [390, 'light-glass']]) {
    await page.setViewportSize({ width, height: 1000 });
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme-toggle').click();
    for (const name of ['overview', 'logs', 'upstreams', 'rules', 'management']) {
      await check(`render ${name} ${width} ${theme}`, async () => {
        await route(name); assert.equal(await page.locator('.error-panel').count(), 0);
        const dimensions = await page.evaluate(() => ({ width: innerWidth, body: document.body.scrollWidth })); assert(dimensions.body <= width + 1, JSON.stringify(dimensions));
        const filename = `${name}-${width}-${theme}.png`; await page.screenshot({ path: path.join(output, filename), fullPage: name === 'overview' });
        report.visual.push(filename);
      });
    }
    await appearance(); await page.locator('#font-body').focus(); await page.screenshot({ path: path.join(output, `appearance-${width}.png`) }); await page.keyboard.press('Escape');
  }
  await check('no runtime errors or failed local assets', async () => {
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.resourceErrors.filter(item => !['/plugins/cache_main/flush', '/api/v1/upstream/config'].includes(item.path)), []);
  });
}
main().catch(error => { report.errors.push(error.stack); }).finally(async () => {
  if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length || report.checks.some(item => !item.passed)) process.exitCode = 1;
});
