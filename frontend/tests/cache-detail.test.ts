import { describe, expect, it } from 'vitest';
import { parseCacheDetail, filterCacheEntries, cacheDetailHtml, cacheDetailRows } from '../src/features/management/cache-detail';
import { switchProfiles } from '../src/features/management/feature-profiles.js';
import { groupedFeatures } from '../src/features/management/layout.js';

const header = 'entries=1983 capacity=500000 bytes=674119 budget=65536000 stale_ttl_seconds=604800 queries=3 hits=3 lazy_hits=3';
describe('cache detail response', () => {
  it('reads real tab-delimited records and discloses an incomplete response', () => {
    const value = parseCacheDetail(header+'\nexample.com\t1\tflags=0\tfresh=0s\tretained=603624s\nexample.com\t28\tfresh=60s\tretained=604800s');
    expect(value.summary.entries).toBe(1983);
    expect(value.entries).toEqual([{domain:'example.com',type:'A',fresh:0,retained:603624},{domain:'example.com',type:'AAAA',fresh:60,retained:604800}]);
    expect(filterCacheEntries(value.entries, 'aaaA')).toHaveLength(1);
    expect(filterCacheEntries(value.entries, ' EXAMPLE ')).toHaveLength(2);
    expect(cacheDetailHtml(value)).toContain('搜索仅覆盖返回的明细');
    expect(cacheDetailRows(value.entries)).toContain('已过期');
  });
  it('preserves unknown formats and missing fields without inventing zeros', () => {
    const value = parseCacheDetail('entries=1 capacity=20\na.test\t65280\tfresh=bad\tretained=-2s\nunrecognized');
    expect(value.unparsed).toBe(1);
    expect(value.entries[0]).toEqual({domain:'a.test',type:'TYPE65280',fresh:null,retained:null});
    expect(cacheDetailRows(value.entries)).toContain('—');
    expect(cacheDetailHtml(parseCacheDetail({new_format:true}))).toContain('原始内容');
    expect(parseCacheDetail('entries=broken capacity=20').supported).toBe(false);
    expect(cacheDetailHtml(parseCacheDetail('entries=0 capacity=20 budget=0'))).toContain('不限内存');
  });
  it('escapes domains and raw HTML, and renders at most 50 records per page', () => {
    const value = parseCacheDetail(header+'\n<img src=x onerror=alert(1)>\t1\tfresh=0s');
    expect(cacheDetailHtml(value)).not.toContain('<img');
    expect(cacheDetailRows(value.entries)).not.toContain('<img');
    const rows = Array.from({length:120},(_,i)=>({...value.entries[0],domain:`${i}.test`}));
    expect(cacheDetailRows(rows).match(/<tr>/g)).toHaveLength(51);
    expect(cacheDetailRows(rows,2)).toContain('100.test');
    expect(cacheDetailRows(rows,2)).not.toContain('99.test');
    expect(cacheDetailRows([])).toContain('没有匹配');
  });
});
describe('feature semantics', () => {
  it('explains OFF type blocking and the two client policies precisely', () => {
    const html = groupedFeatures(switchProfiles, {switch5:'B',switch2:'A',switch12:'A'});
    expect(html).toContain('仍屏蔽 FakeIP 域名的 HTTPS、SVCB');
    expect(html).toContain('客户端名单之外的设备全部直连');
    expect(html).toContain('客户端名单之内的设备全部直连');
    const unknown = groupedFeatures(switchProfiles,{});
    expect(unknown).toContain('控制特殊 DNS 记录类型');
    expect(unknown).not.toContain('仍屏蔽');
    expect(unknown).toContain('读取失败');
  });
});
