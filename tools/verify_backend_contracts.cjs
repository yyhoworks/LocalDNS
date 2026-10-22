/* Run only against the disposable loopback fixture documented in the audit. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dgram = require('node:dgram');

async function queryRewrite(name) {
  const socket = dgram.createSocket('udp4');
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x42ad, 0); header.writeUInt16BE(0x100, 2); header.writeUInt16BE(1, 4);
  const question = Buffer.concat([...name.split('.').map(label => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])), Buffer.from([0, 0, 1, 0, 1])]);
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Isolated DNS query timed out')); }, 3000);
    socket.once('error', error => { clearTimeout(timer); socket.close(); reject(error); });
    socket.once('message', value => { clearTimeout(timer); socket.close(); resolve(value); });
    socket.send(Buffer.concat([header, question]), 2053, '127.0.0.1');
  });
  assert.equal(reply.readUInt16BE(0), 0x42ad);
  assert.equal(reply.readUInt16BE(2) & 15, 0);
  assert(reply.readUInt16BE(6) > 0, 'The rewrite must produce a DNS answer');
  assert(reply.includes(Buffer.from([192, 0, 2, 99])), 'The saved rewrite address must be served');
}

(async () => {
  const args = Object.fromEntries(process.argv.slice(2).map(value => value.split('=', 2)));
  const base = new URL(args['--base']), fixture = new URL(args['--fixture']);
  for (const url of [base, fixture]) assert.equal(url.hostname, '127.0.0.1', 'Only a loopback test fixture is allowed');
  assert(args['--output'] && path.isAbsolute(args['--output']));
  let modulePath = args['--client'];
  if (!modulePath) {
    const esbuild = require('../frontend/node_modules/esbuild');
    const root = path.resolve(__dirname, '..');
    const built = await esbuild.build({ stdin: { resolveDir: root, loader: 'ts', contents:
    'export { BackendClient } from "./frontend/src/core/api/backend-client.ts"; export { HttpClient } from "./frontend/src/core/api/http-client.ts"; export { normalizeResponse } from "./frontend/src/core/api/contracts.ts"; export { initialize as initializeRuleConversion, ruleConversionService } from "./frontend/src/features/rules/conversion.js";' },
    bundle: true, platform: 'node', format: 'cjs', write: false });
    modulePath = path.join(args['--output'], 'audit-backend-client.cjs');
    fs.writeFileSync(modulePath, built.outputFiles[0].contents);
  }
  if ('--build-only' in args) return;
  const clientModule = require(modulePath);
  clientModule.initializeRuleConversion();
  const { BackendClient, HttpClient, normalizeResponse, ruleConversionService } = clientModule;
  const backend = new BackendClient(new HttpClient({ base: base.origin, timeout: 15000 }));
  let restarting = false;
  const request = async (url, options = {}) => {
    const read = String(options.method || 'GET').toUpperCase() === 'GET';
    for (let attempt = 0; ; attempt++) {
      try {
        const value = await backend.request(url, options);
        return read ? normalizeResponse(url, value) : value;
      } catch (error) {
        // A restarted core closes Node's pooled sockets. Retry only its reads.
        if (!restarting || !read || error.code !== 'network' || attempt >= 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  };
  const json = (url, method, value) => request(url, { method, headers: { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value), timeout: 30000 });
  const fixtureStatus = async () => (await fetch(new URL('/control/status', fixture))).json();
  const status = await request('/api/v1/status');
  const identity = await fixtureStatus();
  assert.equal(status.api_listen, '127.0.0.1:19099');
  assert.equal(status.dns_listen, '127.0.0.1:2053');
  assert(identity.root.startsWith('/opt/localdns-contract-audit-'));
  const checks = [];
  async function check(name, run) {
    try { await run(); checks.push({ name, passed: true }); }
    catch (error) { checks.push({ name, passed: false, error: error.message, body: error.body, stack: error.stack }); }
  }
  const sourceBase = 'http://127.0.0.1:19096';
  const groups = ['custom_cn', 'custom_non_cn', 'geoip_cn', 'geosite_cn', 'geosite_non_cn'];
  for (const endpoint of ['/metrics', '/api/v1/status', '/api/v1/upstream/tags', '/api/v1/upstream/config', '/api/v1/upstream/ecs',
    '/api/v1/audit/status', '/api/v1/audit/capacity', '/api/v1/audit/settings', '/api/v2/audit/stats', '/api/v2/audit/logs?limit=1',
    '/api/v2/audit/rank/domain?limit=2', '/api/v2/audit/rank/client?limit=2', '/api/v2/audit/rank/slowest?limit=2',
    '/api/v2/audit/rank/domain_set?limit=2', '/plugins/client_name', '/plugins/requery/status',
    '/plugins/requery/scheduler/config', '/plugins/requery/stats/source_file_counts']) {
    await check('read ' + endpoint, () => request(endpoint));
  }

  for (const group of ['domestic', 'foreign', 'foreign_ecs', 'proxy']) {
    await check('upstream create/edit/toggle/delete ' + group, async () => {
      const before = await request('/api/v1/upstream/config');
      const ecs = (await request('/api/v1/upstream/ecs')).ecs;
      const value = { plugin_tag: group, upstreams: [...before[group], { tag: '__contract__', protocol: 'udp', addr: '127.0.0.1:9', enabled: false }] };
      if (group === 'foreign_ecs') value.ecs = ecs;
      await json('/api/v1/upstream/config', 'POST', value);
      assert((await request('/api/v1/upstream/config'))[group].some(x => x.tag === '__contract__'));
      value.upstreams[value.upstreams.length - 1] = { ...value.upstreams[value.upstreams.length - 1], tag: '__edited__', enabled: true, upstream_query_timeout: 100 };
      await json('/api/v1/upstream/config', 'POST', value);
      assert((await request('/api/v1/upstream/config'))[group].some(x => x.tag === '__edited__' && x.enabled));
      await json('/api/v1/upstream/config', 'POST', { ...value, upstreams: before[group] });
      assert.deepEqual(await request('/api/v1/upstream/config'), before);
      assert.equal((await request('/api/v1/upstream/ecs')).ecs, ecs);
    });
  }
  for (const [tag, sample] of Object.entries({ whitelist: 'domain:direct.contract.example', blocklist: 'domain:block.contract.example',
    greylist: 'domain:proxy.contract.example', force_realip: 'domain:realip.contract.example', ddns_domains: 'domain:ddns.contract.example',
    pcdn_domains: 'domain:pcdn.contract.example', pcdn_regex_v4: 'regexp:^192\\.0\\.2\\.', pcdn_regex_v6: 'regexp:^2001:db8:',
    client_ip: '192.0.2.99', direct_ip: '198.51.100.0/24', rewrite: 'rewrite.contract.example 192.0.2.99' })) {
    await check('manual save ' + tag, async () => {
      const before = await request('/plugins/' + tag + '/show?all=1');
      const values = before.split('\n').filter(x => x.trim());
      await json('/plugins/' + tag + '/post', 'POST', { values: [...values, sample] });
      assert((await request('/plugins/' + tag + '/show?all=1')).includes(sample));
      await json('/plugins/' + tag + '/post', 'POST', { values });
    });
  }
  await check('aliases add/edit/remove and persistence', async () => {
    const before = await request('/plugins/client_name');
    await json('/plugins/client_name', 'PUT', { ...before, '192.0.2.99': 'Contract test' });
    assert.equal((await request('/plugins/client_name'))['192.0.2.99'], 'Contract test');
    await json('/plugins/client_name', 'PUT', { ...before, '192.0.2.99': 'Contract edited' });
    assert.equal((await request('/plugins/client_name'))['192.0.2.99'], 'Contract edited');
    await json('/plugins/client_name', 'PUT', before);
    assert.deepEqual(await request('/plugins/client_name'), before);
  });
  for (const tag of ['switch1', 'switch5', 'switch7', 'switch6', 'switch13', 'switch4', 'switch2', 'switch12']) {
    await check('feature toggle ' + tag, async () => {
      const original = await request('/plugins/' + tag + '/show');
      const value = original === 'A' ? 'B' : 'A';
      await json('/plugins/' + tag + '/post', 'POST', { value });
      assert.equal(await request('/plugins/' + tag + '/show'), value);
      await json('/plugins/' + tag + '/post', 'POST', { value: original });
    });
  }
  await check('log capacity, directory, start/stop/clear', async () => {
    const cap = await request('/api/v1/audit/capacity');
    await json('/api/v1/audit/capacity', 'POST', { capacity: 4096 });
    assert.equal((await request('/api/v1/audit/capacity')).capacity, 4096);
    await json('/api/v1/audit/settings', 'POST', { dir: 'contract-querylog' });
    const setting = await request('/api/v1/audit/settings');
    assert.equal(setting.dir, 'contract-querylog');
    assert(setting.path.startsWith(identity.root));
    try { await json('/api/v1/audit/settings', 'POST', { dir: '/proc/contract-invalid' }); assert.fail('Expected a directory error'); }
    catch (error) { assert.equal(error.status, 400); }
    assert.equal((await request('/api/v1/audit/settings')).dir, 'contract-querylog');
    await request('/api/v1/audit/stop', { method: 'POST' });
    assert.equal((await request('/api/v1/audit/status')).capturing, false);
    await request('/api/v1/audit/start', { method: 'POST' });
    assert.equal((await request('/api/v1/audit/status')).capturing, true);
    await request('/api/v1/audit/clear', { method: 'POST' });
    assert.equal((await request('/api/v2/audit/logs')).pagination.total_items, 0);
    await json('/api/v1/audit/capacity', 'POST', cap);
  });
  for (const cache of ['main', 'domestic', 'foreign', 'foreign_ecs']) {
    for (const action of ['show', 'save', 'flush']) await check('cache ' + cache + '/' + action,
      () => request('/plugins/cache_' + cache + '/' + action));
  }
  for (const name of ['domain_stats', 'realip', 'fakeip', 'nodata']) {
    await check('generated save ' + name, () => request('/plugins/' + name + '/save'));
  }
  await check('cache budget save', async () => {
    const before = await request('/api/v1/cache/settings');
    await json('/api/v1/cache/settings', 'POST', { cache_memory_mb: 64 });
    assert.equal((await request('/api/v1/cache/settings')).cache_memory_mb, 64);
    await json('/api/v1/cache/settings', 'POST', { cache_memory_mb: before.cache_memory_mb });
  });
  await check('route refresh schedule, start/cancel/reset', async () => {
    await json('/plugins/requery/scheduler/config', 'POST', { enabled: false, interval_minutes: 120,
      start_datetime: '', date_range_days: 7 });
    const schedule = await request('/plugins/requery/scheduler/config');
    assert.equal(schedule.scheduler.interval_minutes, 120);
    assert.equal(schedule.execution_settings.date_range_days, 7);
    await request('/plugins/requery/trigger', { method: 'POST' });
    await request('/plugins/requery/cancel', { method: 'POST' });
    for (let n = 0; (await request('/plugins/requery/status')).running; n++) {
      assert(n < 50, 'The route task must finish cancelling');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await request('/plugins/requery/reset', { method: 'POST' });
    assert.equal((await request('/plugins/requery/status')).running, false);
  });

  for (const group of groups) {
    await check('diversion create/edit/update/delete ' + group, async () => {
      for (const row of await request('/plugins/' + group + '/config')) {
        await request('/plugins/' + group + '/config/' + encodeURIComponent(row.name), { method: 'DELETE' });
      }
      const name = '契约测试 ' + group;
      const value = { name, type: group, files: '', url: sourceBase + (group === 'geoip_cn' ? '/rules/geoip.txt' : '/rules/domestic.txt'),
        enabled: true, auto_update: false, update_interval_hours: 24 };
      if (group !== 'geoip_cn') value.enable_regexp = true;
      const save = async payload => {
        const saved = await json('/plugins/' + group + '/config/' + encodeURIComponent(name), 'PUT', payload);
        return ruleConversionService.finishSave(saved, () => request('/plugins/' + group + '/update/' + encodeURIComponent(name), { method: 'POST', timeout: 30000 }));
      };
      assert.equal((await save(value)).name, name);
      const created = (await request('/plugins/' + group + '/config')).find(x => x.name === name);
      assert(created);
      await save({ ...value, enabled: false });
      assert.equal((await request('/plugins/' + group + '/config')).find(x => x.name === name).enabled, false);
      await save(value);
      const updated = await request('/plugins/' + group + '/update/' + encodeURIComponent(name), { method: 'POST', timeout: 30000 });
      assert.equal(typeof updated.changed, 'boolean');
      assert.equal(ruleConversionService.updated(updated).name, name);
      const batch = await request('/plugins/' + group + '/update-all', { method: 'POST', timeout: 30000 });
      assert.equal(batch.failed, 0);
      assert.equal(batch.updated, 1);
      await request('/plugins/' + group + '/config/' + encodeURIComponent(name), { method: 'DELETE' });
      assert(!(await request('/plugins/' + group + '/config')).some(x => x.name === name));
      await save(value); // Keep a real saved subscription for the restart check.
    });
  }
  await check('adguard create/update/edit/toggle/delete and bulk update', async () => {
    for (const row of await request('/plugins/adguard/rules')) await request('/plugins/adguard/rules/' + encodeURIComponent(row.id), { method: 'DELETE' });
    const value = { name: 'Contract ads', url: sourceBase + '/rules/adguard.txt', files: '', enabled: true,
      auto_update: false, update_interval_hours: 24 };
    await json('/plugins/adguard/rules', 'POST', value);
    let row = (await request('/plugins/adguard/rules')).find(x => x.name === value.name);
    assert(row);
    await request('/plugins/adguard/rules/' + row.id + '/update', { method: 'POST', timeout: 30000 });
    row = (await request('/plugins/adguard/rules')).find(x => x.id === row.id);
    const next = { ...row, enabled: false }; delete next.last_error; delete next.line_report;
    await json('/plugins/adguard/rules/' + row.id, 'PUT', next);
    assert.equal((await request('/plugins/adguard/rules')).find(x => x.id === row.id).enabled, false);
    const edited = { ...row, name: 'Contract ads edited', enabled: true }; delete edited.last_error; delete edited.line_report;
    await json('/plugins/adguard/rules/' + row.id, 'PUT', edited);
    const result = await request('/plugins/adguard/update', { method: 'POST', timeout: 30000 });
    assert.equal((result.errors || []).length, 0);
    assert.equal(result.updated_sources, 1);
    await request('/plugins/adguard/rules/' + row.id, { method: 'DELETE' });
    assert.equal((await request('/plugins/adguard/rules')).length, 0);
    await json('/plugins/adguard/rules', 'POST', value);
  });
  await check('system restart retains saved settings and serves the manual rewrite', async () => {
    await json('/plugins/client_name', 'PUT', { ...(await request('/plugins/client_name')), '127.0.0.1': 'Contract restart' });
    const rewrite = await request('/plugins/rewrite/show?all=1');
    await json('/plugins/rewrite/post', 'POST', { values: [...rewrite.split('\n').filter(x => x.trim()), 'persist.contract.example 192.0.2.99'] });
    await queryRewrite('persist.contract.example');
    const aliases = await request('/plugins/client_name');
    const upstreams = await request('/api/v1/upstream/config');
    const ecs = await request('/api/v1/upstream/ecs');
    const originalPid = (await fixtureStatus()).corePid;
    const log = await request('/api/v1/audit/settings');
    const schedule = await request('/plugins/requery/scheduler/config');
    const features = {};
    for (const tag of ['switch1', 'switch5', 'switch7', 'switch6', 'switch13', 'switch4', 'switch2', 'switch12']) features[tag] = await request('/plugins/' + tag + '/show');
    const subscriptions = {};
    for (const group of groups) subscriptions[group] = await request('/plugins/' + group + '/config');
    const ads = await request('/plugins/adguard/rules');
    restarting = true;
    await json('/api/v1/system/restart', 'POST', { delay_ms: 100 });
    await new Promise(resolve => setTimeout(resolve, 500));
    for (let n = 0; n < 30; n++) {
      try { assert.equal((await request('/api/v1/status')).version, 'FJGLI'); break; }
      catch (error) { if (n === 29) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.deepEqual(await request('/plugins/client_name'), aliases);
    assert.notEqual((await fixtureStatus()).corePid, originalPid, 'The isolated core must actually restart');
    assert.deepEqual(await request('/api/v1/upstream/config'), upstreams);
    assert.deepEqual(await request('/api/v1/upstream/ecs'), ecs);
    assert.equal((await request('/api/v1/audit/settings')).dir, log.dir);
    assert.deepEqual((await request('/plugins/requery/scheduler/config')).scheduler, schedule.scheduler);
    for (const [tag, value] of Object.entries(features)) assert.equal(await request('/plugins/' + tag + '/show'), value);
    for (const [group, value] of Object.entries(subscriptions)) assert.deepEqual(await request('/plugins/' + group + '/config'), value);
    assert.deepEqual(await request('/plugins/adguard/rules'), ads);
    assert((await request('/plugins/rewrite/show?all=1')).includes('persist.contract.example 192.0.2.99'));
    await queryRewrite('persist.contract.example');
    const logs = await request('/api/v2/audit/logs?limit=10');
    assert(logs.logs.some(row => row.query_name === 'persist.contract.example'), 'The real DNS query must appear in the UI log contract');
  });
  const report = { passed: checks.every(x => x.passed), checks, fixture: await fixtureStatus() };
  fs.writeFileSync(path.join(args['--output'], 'backend-contract-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, total: checks.length, failures: checks.filter(x => !x.passed) }, null, 2));
  if (!report.passed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
