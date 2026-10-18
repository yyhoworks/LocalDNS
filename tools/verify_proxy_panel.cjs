/* Targeted browser verification, using the existing read-only preview proxy. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPreviewServer } = require('./preview_ui.cjs');
const { chromium } = require(process.env.LOCALDNS_PLAYWRIGHT || 'C:/Users/dev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.resolve(__dirname, '../dist/proxy-panel-verification');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const blocked = [], errors = [], badAssets = [], layouts = [];
  const server = createPreviewServer({ backend: process.env.LOCALDNS_PREVIEW_BACKEND || 'http://192.168.1.7:9099', onBlocked: event => blocked.push(event) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.LOCALDNS_VERIFY_URL || `http://127.0.0.1:${server.address().port}/ui/`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (/\/assets\//.test(response.url()) && response.status() >= 400) badAssets.push(response.url()); });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await context.route(/\/(api|plugins)\//, route => route.request().method() === 'GET' ? route.continue() : route.abort());
    await page.goto(origin);
    await page.locator('.console-service-summary').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const opener = page.locator('#proxy-launcher button');
    const panel = page.locator('#proxy-panel-popover');
    const link = page.locator('#proxy-launcher a');
    const url = page.locator('#proxy-panel-url');
    const save = panel.getByRole('button', { name: '保存设置' });
    assert.equal(await link.getAttribute('href'), 'http://192.168.1.7:9090/ui');
    assert.equal(await link.innerText(), '');
    await opener.click();
    for (const invalid of ['javascript:alert(1)', 'file:///tmp/ui', 'http://', 'http://user:secret@localhost/ui', '']) {
      await url.fill(invalid); await save.click();
      assert.equal(await panel.isVisible(), true);
      assert.equal(await page.locator('#proxy-panel-error').isVisible(), true);
      assert.equal(await link.getAttribute('href'), 'http://192.168.1.7:9090/ui');
    }
    await panel.getByText('sing-box', { exact: true }).click();
    await url.fill('https://example.com/custom-ui/#/proxies');
    await panel.getByRole('button', { name: '取消', exact: true }).click();
    assert((await link.getAttribute('aria-label')).includes('Mihomo'));
    await opener.click();
    assert.equal(await url.inputValue(), 'http://192.168.1.7:9090/ui');
    await panel.getByText('sing-box', { exact: true }).click();
    await url.fill('http://192.168.1.7:9090/ui'); await save.click();
    await page.reload(); await page.locator('.console-service-summary').waitFor();
    assert((await link.getAttribute('aria-label')).includes('sing-box'));
    assert(await link.locator('img').evaluate(image => image.complete && image.naturalWidth > 0));
    await opener.click();
    await url.fill('https://example.com/unsaved');
    await page.evaluate(() => { window.originalStorageSet = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('Denied', 'QuotaExceededError'); }; });
    await save.click();
    assert.equal(await panel.isVisible(), true);
    assert((await page.locator('#proxy-panel-error').innerText()).includes('未保存'));
    assert.equal(await link.getAttribute('href'), 'http://192.168.1.7:9090/ui');
    await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; delete window.originalStorageSet; });
    await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(), false);
    assert.equal(await opener.evaluate(element => document.activeElement === element), true);
    await opener.click(); await page.locator('.console-service-summary').click({ position: { x: 25, y: 20 } });
    assert.equal(await panel.isVisible(), false);
    await page.locator('#btn-open-bg-customizer').click();
    await opener.click();
    await panel.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#bg-customizer-popover').evaluate(element => element.classList.contains('open')), false);
    await page.keyboard.press('Escape');
    const popupPromise = page.waitForEvent('popup');
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    assert(popup.url().startsWith('http://192.168.1.7:9090/ui'));
    assert.equal(await popup.evaluate(() => window.opener), null);
    await popup.close();
    await page.evaluate(() => { location.hash = '#/management'; });
    await page.locator('[data-proxy-panel-settings]').click();
    assert.equal(await panel.isVisible(), true);
    await panel.getByText('Mihomo', { exact: true }).click(); await save.click();
    assert.equal(await page.locator('[data-proxy-panel-name]').innerText(), 'Mihomo 面板');
    await page.evaluate(() => { location.hash = '#/overview'; });
    await page.locator('.console-service-summary').waitFor();

    for (const skin of ['claude', 'glass']) for (const theme of ['light-glass', 'cosmos-glass']) for (const mode of ['left', 'top']) {
      await page.locator('#btn-open-bg-customizer').click();
      await page.locator(`[data-skin-select="${skin}"]`).click();
      await page.locator(`[data-navigation-layout="${mode}"]`).click();
      await page.locator('#btn-close-bg-popover').click();
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme-toggle').click();
      for (const width of [1440, 1100, 901, 600, 390, 360, 320]) {
        await page.setViewportSize({ width, height: width < 601 ? 844 : 1000 });
        // Navigation moves the existing sidebar in a media-query change handler.
        await page.waitForTimeout(100);
        const bounds = await page.evaluate(() => {
          const selectors = ['.brand-box', '#sidebar', '.cmd-search-bar', '.console-search-button', '#proxy-launcher', '.glass-action-capsule'];
          const boxes = selectors.map(selector => {
            const element = document.querySelector(selector), rect = element.getBoundingClientRect();
            return { selector, x: rect.x, y: rect.y, r: rect.right, b: rect.bottom, w: rect.width, h: rect.height, visible: getComputedStyle(element).display !== 'none' && rect.width > 0 };
          }).filter(box => box.visible && box.y < 80 && box.h < 80);
          const overlaps = [];
          for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            if (Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1) overlaps.push([a.selector, b.selector]);
          }
          return { viewport: innerWidth, scroll: document.body.scrollWidth, boxes, overlaps };
        });
        assert(bounds.scroll <= width + 1, JSON.stringify({ skin, theme, mode, width, bounds }));
        assert.equal(bounds.overlaps.length, 0, JSON.stringify({ skin, theme, mode, width, bounds }));
        assert(bounds.boxes.every(box => box.x >= 0 && box.r <= width + 1), JSON.stringify(bounds));
        await opener.click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const rect = await panel.boundingBox();
        const viewport = await page.evaluate(() => ({ inner: innerWidth, client: document.documentElement.clientWidth, visual: visualViewport.width, offset: visualViewport.offsetLeft, scrollX, style: document.querySelector('#proxy-panel-popover').getAttribute('style'), transform: getComputedStyle(document.querySelector('#proxy-panel-popover')).transform }));
        assert(rect.x >= 0 && rect.x + rect.width <= width + 1 && rect.y >= 0 && rect.y + rect.height <= (width < 601 ? 844 : 1000) + 1, JSON.stringify({ skin, theme, mode, width, rect, viewport }));
        if ((width === 1440 && theme === 'light-glass') || (width === 390 && mode === 'top')) await page.screenshot({ path: path.join(output, `${skin}-${theme}-${mode}-${width}.png`) });
        await page.keyboard.press('Escape');
        layouts.push({ skin, theme, mode, width, launcherWidth: await page.locator('#proxy-launcher').evaluate(element => element.offsetWidth), noOverlap: true });
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(badAssets, []);
    assert.deepEqual(blocked, []);
    const report = { url: origin, behavior: 'URL validation, cancel, save/reload, logo switch, storage failure, Escape/focus, outside click, appearance handoff, new tab, management settings', layouts, errors, badAssets, blocked };
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: 'passed', layoutChecks: layouts.length, output, errors, badAssets, blocked }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
