import { describe, expect, it, vi } from 'vitest';
import { LatestView } from '../src/core/lifecycle/latest-view';
import { CleanupScope } from '../src/core/lifecycle/cleanup-scope';
import { createLogQuery, logQueryParams } from '../src/features/logs/query';
import { logViewModel } from '../src/features/logs/model.js';
import { normalizeResponse } from '../src/core/api/contracts';

describe('nested route views', () => {
  it('cancels a replaced list, rejects late results and follows parent disposal', async () => {
    const parent = new CleanupScope(), views = new LatestView(parent), first = views.begin();
    const cleanup = vi.fn(); first.add(cleanup);
    let resolve!: (value: string) => void;
    const result = first.guard(new Promise<string>(r => { resolve = r; }));
    const second = views.begin(); resolve('obsolete list');
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(cleanup).toHaveBeenCalledOnce(); expect(second.signal.aborted).toBe(false);
    parent.dispose(); expect(second.signal.aborted).toBe(true);
    expect(views.begin().signal.aborted).toBe(true);
  });
});

describe('logs boundary', () => {
  it('retains mobile and desktop defaults and maps UI filters to backend field names', () => {
    expect(createLogQuery(true).limit).toBe(25); expect(createLogQuery(false).limit).toBe(50);
    expect(logQueryParams({ ...createLogQuery(true), type:'AAAA', set:'cache_main', client:'192.0.2.1', exact:true }))
      .toMatchObject({ limit:25, query_type:'AAAA', domain_set:'cache_main', client_contains:'192.0.2.1', exact:true });
  });
  it('separates display fields while preserving zero latency, original details and unsafe text', () => {
    const record = { query_time:'2026-10-19T07:59:00Z', query_name:'<img onerror=x>', query_type:'AAAA', client_ip:'192.0.2.1', duration_ms:0, answers:[{value:'::1'}], extension:true };
    const view = logViewModel(record, {'192.0.2.1':'工作电脑'});
    expect(view).toMatchObject({ domain:'<img onerror=x>', shortType:'6', clientLabel:'工作电脑', duration:0, answer:'::1' });
    expect(view.record).toBe(record);
  });
});

it.each([
  ['/api/v1/upstream/config', { custom:[{tag:4}] }],
  ['/api/v1/upstream/config', { domestic:[{enabled:'yes'}] }],
  ['/api/v1/upstream/tags', [1]], ['/api/v1/upstream/ecs', {ecs:4}],
  ['/plugins/client_name', {'192.0.2.1':{name:'bad'}}],
  ['/api/v2/audit/logs', {logs:[{answers:[null]}]}],
])('rejects malformed feature fields at %s', (path, value) => {
  expect(() => normalizeResponse(path, value)).toThrow();
});
