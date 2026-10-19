const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = {window:{}, DOMException};
vm.runInNewContext(require('./frontend_test_module.cjs').bundleFeature('features/overview/ranking/latency.js','rankLatencyService','window.LocalDNSRankLatency'),context);
const {summarize, params, create} = context.window.LocalDNSRankLatency;

(async () => {
  const rows = [0,10,null,undefined,'',-2,'bad'].map(duration_ms => ({query_name:'example.com',duration_ms}));
  rows.push({query_name:'another.example',duration_ms:900});
  const result = summarize('domain','example.com',{logs:rows,pagination:{total_items:20}});
  assert.equal(result.average,5); assert.equal(result.samples,2); assert.equal(result.partial,true);
  assert.equal(summarize('client','192.0.2.1',{logs:[{client_ip:'192.0.2.1',duration_ms:0}],pagination:{total_items:1}}).average,0);
  assert.equal(summarize('set','cache_main',{logs:[],pagination:{total_items:0}}).average,null);
  const overlapping = summarize('set','geosite_cn',{logs:[{domain_set:'geosite_cn',duration_ms:10},
    {domain_set:'geosite_cn_nodata',duration_ms:100}],pagination:{total_items:2}});
  assert.equal(overlapping.average,10); assert.equal(overlapping.partial,false);
  assert.equal(params('client','192.0.2.1').exact,true);
  assert.equal(params('set','cache_main').domain_set,'cache_main');
  let time = 0, calls = 0;
  const cache = create(async () => {calls++;return {logs:[],pagination:{total_items:0}}}, () => time);
  await Promise.all([cache.get('domain','a'),cache.get('domain','a')]);
  assert.equal(calls,1);
  time = 60001; await cache.get('domain','a'); assert.equal(calls,2);
  let active = 0, peak = 0;
  const jobs = [], pool = create(async () => {
    active++; peak = Math.max(peak,active);
    await new Promise(resolve => jobs.push(resolve)); active--;
    return {logs:[],pagination:{total_items:0}};
  });
  const pending = Promise.all(Array.from({length:12},(_,i)=>pool.get('domain',String(i))));
  while (jobs.length || active === 0) {
    await new Promise(resolve => setImmediate(resolve));
    if (!jobs.length && !active) break;
    jobs.splice(0).forEach(resolve => resolve());
    await new Promise(resolve => setImmediate(resolve));
    if (!jobs.length && !active) break;
  }
  await pending; assert.equal(peak,4);
  let invoked = false;
  await assert.rejects(create(async () => {invoked=true}).get('domain','gone',()=>false),{name:'AbortError'});
  assert.equal(invoked,false);
  let retries = 0;
  const retry = create(async () => {if (++retries===1) throw new Error('offline'); return {logs:[]}});
  await assert.rejects(retry.get('domain','retry'));
  await retry.get('domain','retry'); assert.equal(retries,2);
  console.log('Rank latency: zero/missing samples, exact filters, cache/dedup/expiry, concurrency, cancellation and retry passed');
})().catch(error => {console.error(error);process.exitCode=1});
