// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CleanupScope } from '../src/core/lifecycle/cleanup-scope';
import { parseSummary, parseDetail, freshness, rangeRows, rankings, trafficCSV, sumBytes } from '../src/features/proxy/traffic-model.js';
import { proxyCardView } from '../src/features/overview/proxy-traffic.js';
import { mountTraffic } from '../src/features/proxy/traffic.js';

const NOW=Date.parse('2026-11-01T15:00:00+08:00');
const snapshot=(extra={})=>({version:2,updated:'2026-11-01T15:00:00+08:00',date:'2026-11-01',since:'2026-11-01',utc_offset_minutes:480,source:'mihomo',publish_interval_seconds:30,today:{down:1000,up:200},total:{down:1000,up:200},daily:[{date:'2026-11-01',down:1000,up:200,coverage:'unknown',devices:{'192.168.8.102':{down:600,up:100}},providers:{'<b>subscription</b>':{down:1000,up:200}},hourly:{'14':{down:50,up:10}}}],aliases:{'192.168.8.102':'书房电脑'},...extra});
let scope:CleanupScope|undefined;
afterEach(()=>{scope?.dispose();scope=undefined;vi.unstubAllGlobals();vi.useRealTimers();document.body.replaceChildren();});

describe('proxy traffic semantics',()=>{
  it('keeps separate units for upload and download',()=>{
    const data=parseSummary(snapshot({today:{down:512*1024**2,up:2*1024**3}}));
    expect(proxyCardView(data,NOW).note).toBe('今日 ↓512 MB ↑2.00 GB');
  });
  it('distinguishes stale and expired data using the collector timezone',()=>{
    const data=parseSummary(snapshot())!;
    expect(freshness(data,NOW+121000)).toBe('stale');
    expect(freshness(data,Date.parse('2026-11-02T00:00:01+08:00'))).toBe('expired');
    expect(proxyCardView(data,Date.parse('2026-11-02T00:00:01+08:00')).value).toBe('—');
  });
  it('rejects corrupt counters and timestamps without displaying zero',()=>{
    expect(parseSummary(snapshot({today:{down:-1,up:0}}))).toBeNull();
    expect(parseSummary(snapshot({today:{down:NaN,up:0}}))).toBeNull();
    expect(parseSummary(snapshot({updated:'invalid'}))).toBeNull();
    expect(parseDetail(snapshot({daily:[{date:'2026-99-99',down:1,up:1}]}))?.days.size).toBe(0);
  });
  it('keeps unrecorded days separate from a genuinely observed zero',()=>{
    const data=parseDetail(snapshot({today:{down:0,up:0},daily:[{date:'2026-11-01',down:0,up:0}]}))!;
    const rows=rangeRows(data,'week',NOW);
    expect(rows.filter(row=>!row.missing)).toHaveLength(1);
    expect(rows.filter(row=>row.missing)).toHaveLength(6);
    expect(trafficCSV(rows,'2026-11-01')).toContain('2026-10-31,,,,未采集');
    expect(trafficCSV(rows,'2026-11-01')).toContain('2026-11-01,0,0,0,今日未结束');
  });
  it('accounts for unclassified legacy bytes without inventing device attribution',()=>{
    const data=parseDetail(snapshot())!,rows=rangeRows(data,'week',NOW),result=rankings(data,rows,'devices');
    expect(result.find(row=>row.key==='192.168.8.102')?.name).toBe('书房电脑');
    expect(result.find(row=>row.key==='__history__')).toMatchObject({down:400,up:100,total:500});
    expect(sumBytes(result)).toEqual({down:1000,up:200});
  });
  it('rejects overcounted classifications while preserving daily totals',()=>{
    const data=parseDetail(snapshot({daily:[{date:'2026-11-01',down:1000,up:200,devices:{bad:{down:5000,up:100}}}]}))!;
    expect(rankings(data,rangeRows(data,'today',NOW),'devices')).toMatchObject([{name:'历史未分类',total:1200}]);
  });
  it('aggregates remaining rankings rather than discarding their bytes',()=>{
    const devices=Object.fromEntries(Array.from({length:30},(_,i)=>[String(i),{down:10,up:1}]));
    const data=parseDetail(snapshot({today:{down:300,up:30},daily:[{date:'2026-11-01',down:300,up:30,devices}]}))!;
    const result=rankings(data,rangeRows(data,'today',NOW),'devices');
    expect(result).toHaveLength(20);expect(result.at(-1)?.name).toBe('其他');
    expect(sumBytes(result)).toEqual({down:300,up:30});
  });
});

describe('statistics interactions',()=>{
  it('shares the date range across views, escapes names, exports real bytes and releases polling',async()=>{
    vi.useFakeTimers();vi.setSystemTime(NOW);
    const fetcher=vi.fn(async()=>Response.json(snapshot()));vi.stubGlobal('fetch',fetcher);
    document.body.innerHTML='<main id="test"></main>';const root=document.querySelector<HTMLElement>('main')!;
    scope=new CleanupScope();await mountTraffic(root,{scope,signal:scope.signal},()=>{});
    root.querySelector<HTMLButtonElement>('#pt-range-today')!.click();
    root.querySelector<HTMLButtonElement>('#pt-tab-ranking')!.click();
    root.querySelector<HTMLButtonElement>('#pt-dimension-providers')!.click();
    expect(root.textContent).toContain('<b>subscription</b>');
    expect(root.querySelector('b.subscription')).toBeNull();
    root.querySelector<HTMLButtonElement>('#pt-tab-daily')!.click();
    expect(root.querySelector('#pt-range-today')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('.pt-table tbody tr')).toHaveLength(1);
    expect(root.querySelector('.pt-table tbody')?.textContent).toContain('1000 B');
    scope.dispose();await vi.advanceTimersByTimeAsync(60000);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('degrades cleanly when the optional collector is absent',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:404})));
    document.body.innerHTML='<main></main>';scope=new CleanupScope();
    await mountTraffic(document.querySelector('main')!,{scope,signal:scope.signal},()=>{});
    expect(document.body.textContent).toContain('尚未接入明细采集');
    expect(document.querySelector('#pt-amount')).toBeNull();
    expect(document.querySelector('#pt-retry')).not.toBeNull();
  });
});
