const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = {window:{}};
vm.runInNewContext(require('./frontend_test_module.cjs').bundleFeature('features/overview/traffic/model.js','trafficService','window.LocalDNSTraffic'),context);
const {record,summary,chart}=context.window.LocalDNSTraffic;
const rows=[],base=1792300000000;
assert.equal(record(rows,{total:100,start:1},base),true);
assert.equal(summary(rows,30,base).average,null);
record(rows,{total:110,start:1},base+10000);
record(rows,{total:150,start:1},base+30000);
let s=summary(rows,30,base+30000);
assert.equal(s.current,2);assert.equal(s.average,50/30);assert.equal(s.requests,50);assert.equal(s.peak,2);
assert.equal(record(rows,{total:9999,start:1},base+30500),false);
record(rows,{total:250,start:1},base+180000);
assert.equal(rows.at(-1).qps,null); // Background tab gap is not an inferred spike.
record(rows,{total:250,start:1},base+190000);
s=summary(rows,30,base+190000);assert.equal(s.current,0);assert.equal(s.requests,50);
const svg=chart(s.points,1200);
assert(svg.includes('viewBox="0 0 1200 204"'));assert(!svg.includes('NaN'));
assert.equal((svg.match(/class="traffic-line"/g)||[]).length,2); // The gap breaks the line.
assert.equal(summary(rows,30,base+300000).stale,true);
assert.equal(summary(rows,1,base+190000).requests,0); // Gap does not create window requests.
record(rows,{total:2,start:2},base+200000);
assert.equal(rows.length,1);assert.equal(rows[0].qps,null);
record(rows,{total:1,start:2},base+210000);
assert.equal(rows.length,1); // Counter reset with same process start also resets the baseline.
assert.equal(record(rows,{total:undefined,start:2},base+220000),false);
assert.equal(record(rows,{total:null,start:2},base+220000),false);
record(rows,{total:1,start:2},base+220000);
assert.equal(summary(rows,30,base+220000).current,0);
console.log('PASS traffic counters, weighted rates, zero traffic, gaps, resets, time window and SVG width');
