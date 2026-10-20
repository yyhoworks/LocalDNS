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
assert(svg.includes('viewBox="0 0 1200 216"'));assert(!svg.includes('NaN'));
assert.equal((svg.match(/class="traffic-line"/g)||[]).length,2); // The gap breaks the line.
assert.equal(summary(rows,30,base+300000).stale,true);
assert.equal(summary(rows,1,base+190000).requests,0); // Gap does not create window requests.
record(rows,{total:2,start:2},base+200000);
assert.equal(rows.at(-1).qps,null);assert.equal(summary(rows,30,base+200000).requests,50); // Preserve earlier history after restart.
record(rows,{total:1,start:2},base+210000);
assert.equal(rows.at(-1).qps,null); // Counter reset starts a new interval without erasing history.
assert.equal(record(rows,{total:undefined,start:2},base+220000),false);
assert.equal(record(rows,{total:null,start:2},base+220000),false);
record(rows,{total:1,start:2},base+220000);
assert.equal(summary(rows,30,base+220000).current,0);
console.log('PASS traffic counters, weighted rates, zero traffic, gaps, resets, time window and SVG width');

const {parse,aggregate}=context.window.LocalDNSTraffic;
const metrics=(q,cq,ch,sum,count)=>`process_start_time_seconds 1\nlocaldns_queries_total ${q}\nlocaldns_cache_query_total{tag="cache_main"} ${cq}\nlocaldns_cache_hit_total{tag="cache_main"} ${ch}\nlocaldns_upstream_response_latency_millisecond_sum{tag="a",metrics_tag="domestic"} ${sum}\nlocaldns_upstream_response_latency_millisecond_count{tag="a",metrics_tag="domestic"} ${count}`;
const multi=[];
record(multi,parse(metrics(100,20,10,100,10)),base);
record(multi,parse(metrics(110,30,18,120,12)),base+5000);
record(multi,parse(metrics(210,130,108,1120,22)),base+15000);
assert.equal(summary(multi,60,base+15000,'cache').average,98/110*100);
assert.equal(summary(multi,60,base+15000,'latency').average,1020/12);
assert.equal(summary(multi,60,base+15000,'latency').peak,100);
record(multi,parse(metrics(210,130,108,1120,22)),base+20000);
assert.equal(summary(multi,60,base+20000,'cache').current,null);
assert.equal(summary(multi,60,base+20000,'latency').current,null);
assert.equal(summary(multi,60,base+20000).current,0);
record(multi,parse(metrics(220,140,118,50,2)),base+25000);
assert.equal(multi.at(-1).latency,null); // An upstream counter reset cannot become negative latency.
const missing=parse('localdns_queries_total 1');
assert.equal(missing.cacheQueries,null);assert.equal(missing.upstreams,null);
assert.equal(parse('localdns_queries_total 1\nlocaldns_queries_total 2').total,null);
const day=[];
for(let i=0;i<=17280;i++)record(day,{total:i*10+(i>=10000?990:0),start:1},base+i*5000);
const full=summary(day,1440,base+86400000);
assert.equal(full.requests,172800+990);assert.equal(full.peak,200);
const compact=aggregate(full.points);
assert(compact.filter(p=>p.value!==null).length<=480);
assert.equal(Math.max(...compact.filter(p=>p.value!==null).map(p=>p.peak)),200);
assert(!chart(full.points,1000).includes('NaN'));
assert((chart(full.points,1000).match(/class="traffic-point"/g)||[]).length<=480);
record(day,{total:200000,start:2},base+86405000);
assert(day.length<=17281);assert(day[0].time>=base+5000);
assert.equal(day.at(-1).qps,null);assert(summary(day,1440,base+86405000).requests>0);
console.log('PASS three metrics, query/response weighting, missing values, 24-hour retention, bounded aggregation and restart history');
const pause=[];
record(pause,{total:100,start:1},base);
record(pause,{total:110,start:1},base+5000);
record(pause,{total:1000,start:1,breakBefore:true},base+30000);
record(pause,{total:1020,start:1},base+35000);
assert.equal(summary(pause,60,base+35000).requests,30);
const replay=[];
for(const point of pause)record(replay,context.window.LocalDNSTraffic.raw(point,point.time),point.time);
assert.equal(summary(replay,60,base+35000).requests,30);
assert.equal((chart(summary(replay,60,base+35000).points).match(/class="traffic-line"/g)||[]).length,2);
console.log('PASS explicit pause boundaries survive persistence and exclude unobserved traffic');
