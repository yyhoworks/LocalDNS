// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CleanupScope } from '../src/core/lifecycle/cleanup-scope';
import { parseSummary, parseDetail, freshness, rangeRows, rankings, trafficCSV, sumBytes, monthDays, monthRows, hourlySeries, shiftMonth, monthBounds } from '../src/features/proxy/traffic-model.js';
import { proxyCardView } from '../src/features/overview/proxy-traffic.js';
import { mountTraffic } from '../src/features/proxy/traffic.js';

const NOW=Date.parse('2026-11-01T15:00:00+08:00');
const TODAY='2026-11-01';
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

describe('calendar month semantics',()=>{
  it('lays out a Monday-first month without turning unrecorded days into zero',()=>{
    const data=parseDetail(snapshot({daily:[{date:'2026-11-01',down:1000,up:200},{date:'2026-10-30',down:10,up:20}]}))!;
    const cells=monthDays(data,'2026-11',TODAY);
    expect(cells.filter(cell=>cell.blank)).toHaveLength(6);
    expect(cells.find(cell=>cell.date==='2026-11-01')).toMatchObject({day:1,missing:false,total:1200,today:true});
    expect(cells.find(cell=>cell.date==='2026-11-02')).toMatchObject({missing:true});
    expect(monthRows(data,'2026-11',TODAY)).toHaveLength(1);
    expect(monthRows(data,'2026-10',TODAY).filter(row=>!row.missing).map(row=>row.date)).toEqual(['2026-10-30']);
  });
  it('offers only months that can hold records and fills 24 hourly buckets',()=>{
    const data=parseDetail(snapshot({daily:[{date:'2026-09-12',down:10,up:20},{date:'2026-11-01',down:1000,up:200,hourly:{'14':{down:50,up:10}}}]}))!;
    expect(monthBounds(data,TODAY)).toEqual({min:'2026-09',max:'2026-11'});
    expect(shiftMonth('2026-11',-1)).toBe('2026-10');
    expect(shiftMonth('2026-12',1)).toBe('2027-01');
    const hours=hourlySeries(data.days.get('2026-11-01'));
    expect(hours).toHaveLength(24);
    expect(hours[14]).toMatchObject({hour:'14',missing:false,down:50,up:10,total:60});
    expect(hours[13]).toMatchObject({missing:true,total:0});
  });
});

describe('statistics interactions',()=>{
  it('reports a truly observed zero peak without inventing one byte',async()=>{
    vi.useFakeTimers();vi.setSystemTime(NOW);
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json(snapshot({today:{down:0,up:0},daily:[{date:TODAY,down:0,up:0,hourly:{'00':{down:0,up:0}}}]}))));
    document.body.innerHTML='<main></main>';scope=new CleanupScope();
    await mountTraffic(document.querySelector('main')!,{scope,signal:scope.signal},()=>{});
    expect(document.querySelector('.pt-day-meta')?.textContent).toContain('0 B');
    expect(document.querySelector('.pt-day-meta')?.textContent).not.toContain('1 B');
    expect(document.querySelector('.pt-hour-bars')?.innerHTML).not.toMatch(/NaN|Infinity/);
  });
  it('opens the current month, selects the collected day, escapes names and releases polling',async()=>{
    vi.useFakeTimers();vi.setSystemTime(NOW);
    const fetcher=vi.fn(async()=>Response.json(snapshot()));vi.stubGlobal('fetch',fetcher);
    document.body.innerHTML='<main id="test"></main>';const root=document.querySelector<HTMLElement>('main')!;
    scope=new CleanupScope();await mountTraffic(root,{scope,signal:scope.signal},()=>{});
    const day=root.querySelector<HTMLButtonElement>('#pt-day-2026-11-01');
    expect(day).not.toBeNull();
    expect(day?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('#pt-cal-prev')?.hasAttribute('disabled')).toBe(true);
    expect(root.querySelector('#pt-cal-next')?.hasAttribute('disabled')).toBe(true);
    expect(root.querySelectorAll('.pt-cal-day.na')).toHaveLength(29);
    root.querySelector<HTMLButtonElement>('#pt-dimension-providers')!.click();
    expect(root.textContent).toContain('<b>subscription</b>');
    expect(root.querySelector('b.subscription')).toBeNull();
    expect(root.querySelector('#pt-dimension-providers')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.pt-mini-list')).not.toBeNull();
    expect(root.querySelector('#pt-export')).not.toBeNull();
    scope.dispose();await vi.advanceTimersByTimeAsync(60000);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('falls back to the last collected day when today has no record yet',async()=>{
    vi.useFakeTimers();vi.setSystemTime(NOW);
    const stale=snapshot({updated:'2026-10-31T23:50:00+08:00',date:'2026-10-31',since:'2026-10-31',today:{down:10,up:20},
      daily:[{date:'2026-10-31',down:10,up:20,coverage:'full',devices:{'192.168.8.102':{down:10,up:20}}}]});
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json(stale)));
    document.body.innerHTML='<main></main>';scope=new CleanupScope();
    await mountTraffic(document.querySelector('main')!,{scope,signal:scope.signal},()=>{});
    expect(document.querySelector('.pt-cal-nav b')?.textContent).toBe('2026 年 10 月');
    expect(document.querySelector('#pt-day-2026-10-31')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.pt-alert')?.textContent).toContain('采集暂停更新');
    expect(document.querySelector('.pt-kpi')?.textContent).toContain('—');
    expect(document.querySelector('.pt-day-date')?.textContent).toContain('已采集');
  });
  it('keeps every rank in a full-width panel so the calendar column never stretches',async()=>{
    vi.useFakeTimers();vi.setSystemTime(NOW);
    const devices=Object.fromEntries(Array.from({length:15},(_,i)=>[`dev${String(i).padStart(2,'0')}`,{down:100,up:10}]));
    const many=snapshot({today:{down:1500,up:150},daily:[{date:'2026-11-01',down:1500,up:150,coverage:'full',devices}]});
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json(many)));
    document.body.innerHTML='<main></main>';scope=new CleanupScope();
    await mountTraffic(document.querySelector('main')!,{scope,signal:scope.signal},()=>{});
    document.querySelector<HTMLButtonElement>('#pt-dimension-devices')!.click();
    expect(document.querySelectorAll('.pt-mini-row')).toHaveLength(15);
    expect(document.querySelector('.pt-mini-index')?.textContent).toBe('01');
    expect(document.querySelector('#pt-rank-more')).toBeNull();
    expect(document.querySelector('.pt-rank-panel')).not.toBeNull();
    // 排行不再位于日期详情卡内，两列的高度不会互相牵制。
    expect(document.querySelector('.pt-day .pt-mini-list')).toBeNull();
    expect(document.querySelector('.pt-rank-panel .pt-mini-list')).not.toBeNull();
    expect(document.querySelector('.pt-cal-summary')?.textContent).toContain('当月合计');
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
