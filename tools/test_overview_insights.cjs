const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('../frontend/node_modules/jsdom');
const { bundleFeature } = require('./frontend_test_module.cjs');

// 这两个模块在顶层读 window.LOCALDNS_UI_CONFIG、还会 new AbortController，
// 必须在带浏览器全局的 VM 上下文里跑；loadFeature（Node CJS 直载）会报 window is not defined。
function load(file, name) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/ui/',
    runScripts: 'outside-only',
  });
  // jsdom 不实现 matchMedia，模块顶层会读它。
  dom.window.matchMedia = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const context = dom.getInternalVMContext();
  vm.runInContext(bundleFeature(file, name, `window.${name}`, false), context);
  return context[name];
}

const overview = load('features/overview/insights.js', 'overviewInsightsService');
const version = load('features/version/index.js', 'versionService');

const data = Array.from({length:19}, (_, i) => ({key: 'result_' + i, count: 19 - i}));
const summary = overview.distribution(data.reverse());
assert.equal(summary.all.length, 19);
assert.equal(summary.shown.length, 6);
assert.equal(summary.shown[0].key, 'result_0');
assert.equal(summary.shown[5].members.length, 14);
assert.equal(summary.shown.reduce((sum, row) => sum + row.count, 0), summary.total);
assert.equal(summary.total, 190);
assert.equal(overview.distribution(data.slice(0,6)).shown.length, 6);
assert.equal(overview.distribution([{key:'x',count:3},{key:'x',count:2},{key:'z',count:NaN},{key:'a',count:-1}]).total, 5);
assert.equal(overview.distribution([]).total, 0);
assert.equal(overview.label('cache_main'), '主缓存命中');
assert.equal(overview.label('future_result'), 'future_result');
assert.equal(overview.color(summary.all[0].key, 'glass'), overview.color(overview.distribution([{key:'result_0',count:1}]).shown[0].key, 'glass'));
assert.equal(version.compareVersions('2026.10.18.19','2026.10.18.9'), 1);
assert.equal(version.compareVersions('fjgac-ui-v2026.10.18.19','2026.10.18.19'), 0);
assert.equal(version.compareVersions('2026.10.19.1-local','2026.10.18.19'), 1);
assert.equal(version.compareVersions('broken','2026.10.18.19'), null);
const release = version.releaseInfo({tag_name:'fjgac-ui-v2026.10.18.19',assets:[{name:'LocalDNS_UI_Update.zip'},{name:'LocalDNS_FJGAC_Full.zip'},{name:'Config_Service.zip'}],html_url:'https://invalid.example/'});
assert.equal(release.url, 'https://github.com/yyhoworks/LocalDNS/releases/tag/fjgac-ui-v2026.10.18.19');
assert.equal(release.packages.length, 3);
assert.throws(() => version.releaseInfo({tag_name:'fjgac-ui-v2026.10.18.19',prerelease:true}));
const installed = {uiVersion:'2026.10.19.1-local',channel:'local',baseUiVersion:'2026.10.18.19',backendVersion:'FJGAC'};
assert.equal(version.assess(installed,release).available, false);
assert.equal(version.assess(installed,{...release,version:'2026.10.18.20'}).available, true);
assert.equal(version.assess(installed,{...release,backend:'FJGAD'}).available, true);
assert.equal(overview.poolInfo('cache_domestic').code, 'CN');
assert.equal(overview.poolInfo('cache_foreign_ecs').tone, 'ecs');
assert.equal(overview.latencyTier(1200), 'critical');
assert.equal(overview.latencyTier(420), 'warn');
assert.equal(overview.latencyTier(220), 'moderate');
assert.equal(overview.latencyTier(45), 'fast');
console.log('Overview aggregation, stable colors, pool/latency helpers, numeric version comparison, and local-release baseline: passed');
