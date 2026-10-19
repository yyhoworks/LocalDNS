// Targeted layout regression against the existing backend through a read-only proxy.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createPreviewServer } = require('./preview_ui.cjs');
const output = path.resolve(__dirname, '../dist/navigation-20261018');
const report = { readOnly: true, checks: [], errors: [], failedResources: [], blocked: [], screenshots: [] };
const server = createPreviewServer({ backend: process.env.LOCALDNS_PREVIEW_BACKEND, onBlocked: request => report.blocked.push(request) });
let browser;
async function main() {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) report.failedResources.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  async function appearance() {
    if (await page.locator('#btn-open-bg-customizer').getAttribute('aria-expanded') !== 'true') await page.locator('#btn-open-bg-customizer').click();
    await page.locator('#navigation-layout-options').waitFor();
  }
  async function layout(mode) {
    await appearance();
    await page.locator(`[data-navigation-layout="${mode}"]`).click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(expected => document.documentElement.dataset.nav === expected, mode);
  }
  async function route(name) {
    await page.evaluate(name => { location.hash = '#/' + name; }, name);
    await page.locator({ overview: '.console-service-summary', rules: '#rule-text', logs: '.log-detail', upstreams: '#up-add', management: '.management-feature-card' }[name]).first().waitFor();
  }
  async function frame(name) {
    await page.evaluate(() => document.fonts.ready);
    const bounds = await page.evaluate(() => ({ width: innerWidth, body: document.body.scrollWidth }));
    assert(bounds.body <= bounds.width + 1, JSON.stringify(bounds));
    const filename = name + '.png';
    await page.screenshot({ path: path.join(output, filename) });
    report.screenshots.push(filename);
  }
  await page.goto(origin + '/ui/');
  await page.locator('.console-service-summary').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-nav'), 'left');
  await page.locator('#navigation-collapse').click();
  assert.equal(await page.locator('html').getAttribute('data-nav'), 'collapsed');
  await page.reload();
  await page.locator('.console-service-summary').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-nav'), 'collapsed');
  await page.locator('#navigation-collapse').click();
  report.checks.push('vertical collapse and reload persistence');

  await route('rules');
  const original = await page.locator('#rule-text').inputValue();
  await page.locator('#rule-text').fill(original + '\nlayout-unsaved.example');
  await page.evaluate(() => { window.navigationRuleNode = document.querySelector('#rule-text'); });
  await layout('top');
  assert.equal(await page.locator('#sidebar').evaluate(node => node.parentElement.className), 'navbar-content');
  assert.equal(await page.evaluate(() => window.navigationRuleNode === document.querySelector('#rule-text')), true);
  assert((await page.locator('#rule-text').inputValue()).endsWith('layout-unsaved.example'));
  assert.equal(await page.locator('#side-nav [aria-current=page]').getAttribute('data-route'), 'rules');
  const center = await page.locator('#side-nav').evaluate(node => { const nav = node.getBoundingClientRect(), bar = document.querySelector('.navbar-content').getBoundingClientRect(); return Math.abs(nav.x + nav.width / 2 - bar.x - bar.width / 2); });
  assert(center < 2, 'Horizontal navigation must be centered: ' + center);
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('#global-search-input').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Escape');
  await layout('left');
  assert.equal(await page.locator('#sidebar').evaluate(node => node.parentElement.className), 'shell-grid');
  assert((await page.locator('#rule-text').inputValue()).endsWith('layout-unsaved.example'));
  await page.locator('#rule-text').fill(original);
  report.checks.push('centered top layout, search shortcut, route state and unchanged rule draft');

  await route('management');
  await page.locator('[data-claude-preset="obsidian"]').dispatchEvent('click');
  await page.locator('.management-feature-card').first().waitFor();
  const cards = await page.locator('.management-feature-card').evaluateAll(nodes => nodes.map(node => {
    const text = node.firstElementChild.getBoundingClientRect();
    const footer = node.querySelector('.feature-footer').getBoundingClientRect();
    const badge = node.querySelector('.badge').getBoundingClientRect();
    const toggle = node.querySelector('.switch').getBoundingClientRect();
    return { direction: getComputedStyle(node).flexDirection, afterText: footer.top >= text.bottom, badgeLeft: badge.right < toggle.left, sameRow: Math.abs(badge.top + badge.height / 2 - toggle.top - toggle.height / 2) < 1 };
  }));
  assert.equal(cards.length, 8);
  assert(cards.every(card => card.direction === 'column' && card.afterText && card.badgeLeft && card.sameRow));
  await frame('management-vertical-1440-claude-dark');
  await layout('top');
  await frame('management-horizontal-1440-claude-dark');
  await page.reload();
  await page.locator('.management-feature-card').first().waitFor();
  assert.equal(await page.locator('html').getAttribute('data-nav'), 'top');
  assert.equal(await page.locator('#sidebar').evaluate(node => node.parentElement.className), 'navbar-content');
  report.checks.push('pre-merge feature card structure and horizontal preference persistence');

  await route('overview');
  const pathBefore = await page.locator('.topo-edge').first().getAttribute('d');
  await layout('left');
  await page.waitForFunction(previous => document.querySelector('.topo-edge')?.getAttribute('d') !== previous, pathBefore);
  assert.equal(await page.locator('.topo-grid').evaluate(node => getComputedStyle(node).columnGap), '22px');
  report.checks.push('topology recalculates while preserving the five-stage layout');
  await layout('top');
  await page.locator('[data-skin-select="glass"]').dispatchEvent('click');
  await page.locator('.console-service-summary').waitFor();
  await frame('overview-horizontal-1440-glass-dark');
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.locator('#theme-toggle').click();
  await frame('overview-horizontal-1024-glass-light');
  for (const name of ['logs', 'upstreams', 'rules', 'management']) {
    await route(name);
    assert.equal(await page.locator('#side-nav [aria-current=page]').getAttribute('data-route'), name);
    assert.equal(await page.locator('.error-panel').count(), 0);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await page.locator('#sidebar').evaluate(node => node.parentElement.className), 'shell-grid');
  assert.equal(await page.locator('#mobile-nav').evaluate(node => getComputedStyle(node).display), 'grid');
  await frame('management-390-glass-light');
  await page.locator('[data-skin-select="claude"]').dispatchEvent('click');
  await page.locator('.management-feature-card').first().waitFor();
  await frame('management-390-claude-dark');
  await appearance();
  await frame('appearance-layout-390');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.locator('#sidebar').evaluate(node => node.parentElement.className), 'navbar-content');
  report.checks.push('both skins, 1024px top navigation, 390px mobile and desktop restoration');
  assert.deepEqual(report.blocked, []);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedResources, []);
  report.checks.push('zero runtime errors, failed resources or backend writes');
  report.passed = true;
}
main().catch(error => { report.failure = error.stack; process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
