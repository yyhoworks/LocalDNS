// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/core/api/api-error';
import {
  CACHE_FIELDS, buildCacheLimits, cacheBudget, cacheLimitInputSelector, cacheLimitsForm, cacheSettings, displayBounds,
  fromDisplay, poolPending, readCacheLimits, readCacheSettings, toDisplay,
} from '../src/features/management/cache-settings';

const helpers = { cacheName: (tag: string) => tag, esc: (value: unknown) => String(value), num: (value: number) => String(value) };

// FJH7T defaults: 128 MB split 8/12 · 2/12 · 1/12 · 1/12 across the four pools.
const payload = () => ({
  cache_memory_mb: 128,
  default_mb: 128,
  restart_needed: false,
  limits: { max_entries: [128, 10000000], stale_ttl: [0, 2592000], save_interval: [60, 604800] },
  caches: [
    { tag: 'cache_main', key: 'main', entries: 0, bytes: 0, budget_bytes: 89478485, max_entries: 400000, stale_ttl: 604800, save_interval: 1800, running: { max_entries: 400000, stale_ttl: 604800, save_interval: 1800 } },
    { tag: 'cache_domestic', key: 'domestic', entries: 0, bytes: 0, budget_bytes: 22369621, max_entries: 100000, stale_ttl: 604800, save_interval: 1800, running: { max_entries: 100000, stale_ttl: 604800, save_interval: 1800 } },
    { tag: 'cache_foreign', key: 'foreign', entries: 0, bytes: 0, budget_bytes: 11184810, max_entries: 50000, stale_ttl: 604800, save_interval: 1800, running: { max_entries: 50000, stale_ttl: 604800, save_interval: 1800 } },
    { tag: 'cache_foreign_ecs', key: 'foreign_ecs', entries: 0, bytes: 0, budget_bytes: 11184810, max_entries: 50000, stale_ttl: 604800, save_interval: 1800, running: { max_entries: 50000, stale_ttl: 604800, save_interval: 1800 } },
  ],
});

const values = () => ({
  main: { max_entries: 400000, stale_ttl: 604800, save_interval: 1800 },
  domestic: { max_entries: 100000, stale_ttl: 604800, save_interval: 1800 },
  foreign: { max_entries: 50000, stale_ttl: 604800, save_interval: 1800 },
  foreign_ecs: { max_entries: 50000, stale_ttl: 604800, save_interval: 1800 },
});

describe('cache settings contract', () => {
  it('hides the editor on cores that only report the memory budget', async () => {
    const legacy = { cache_memory_mb: 150, default_mb: 128, caches: [{ tag: 'cache_main', entries: 0, bytes: 0, budget_bytes: 1 }] };
    expect(cacheSettings(legacy)).toBeNull();
    expect(await readCacheSettings(async () => legacy)).toBeNull();
    expect(await readCacheSettings(async () => { throw new ApiError('missing', 404); })).toBeNull();
  });

  it('rejects malformed payloads and network failures instead of silently hiding the editor', async () => {
    expect(() => cacheSettings(null)).toThrow();
    expect(() => cacheSettings({ limits: {}, caches: [] })).toThrow(/缓存池/);
    for (const error of [new ApiError('offline', 0), new ApiError('denied', 403)]) {
      await expect(readCacheSettings(async () => { throw error; })).rejects.toBe(error);
    }
  });

  it('parses limits, per-pool values and the running snapshot', () => {
    const parsed = cacheSettings(payload())!;
    expect(parsed.restart_needed).toBe(false);
    expect(parsed.limits.max_entries).toEqual([128, 10000000]);
    expect(parsed.caches.map(cache => cache.key)).toEqual(['main', 'domestic', 'foreign', 'foreign_ecs']);
    expect(parsed.caches[0]).toMatchObject({ tag: 'cache_main', max_entries: 400000, stale_ttl: 604800, save_interval: 1800 });
    expect(poolPending(parsed.caches[0])).toBe(false);
  });

  it('keeps the per-pool budget the kernel reports and tolerates cores without one', () => {
    const parsed = cacheSettings(payload())!;
    expect(parsed.cache_memory_mb).toBe(128);
    expect(parsed.caches.map(cache => cache.budget_bytes)).toEqual([89478485, 22369621, 11184810, 11184810]);

    const legacy = payload() as Record<string, unknown>;
    delete legacy.cache_memory_mb;
    for (const cache of legacy.caches as Record<string, unknown>[]) delete cache.budget_bytes;
    const withoutBudget = cacheSettings(legacy)!;
    expect(withoutBudget.cache_memory_mb).toBeUndefined();
    expect(withoutBudget.caches[0].budget_bytes).toBeUndefined();
  });

  it('flags a pool whose saved value differs from the running value', () => {
    const value = payload();
    value.caches[0].max_entries = 123456;
    value.restart_needed = true;
    const parsed = cacheSettings(value)!;
    expect(poolPending(parsed.caches[0])).toBe(true);
    expect(poolPending(parsed.caches[1])).toBe(false);
  });

  it('round-trips the editor units through seconds without drifting', () => {
    expect(toDisplay('stale_ttl', 604800)).toBe(168);
    expect(fromDisplay('stale_ttl', 168)).toBe(604800);
    expect(toDisplay('save_interval', 1800)).toBe(30);
    expect(fromDisplay('save_interval', 30)).toBe(1800);
    expect(toDisplay('max_entries', 500000)).toBe(500000);
    for (const seconds of [0, 3600, 5400, 86400, 604800, 2592000]) expect(fromDisplay('stale_ttl', toDisplay('stale_ttl', seconds))).toBe(seconds);
    for (const seconds of [60, 600, 1800, 3600, 604800]) expect(fromDisplay('save_interval', toDisplay('save_interval', seconds))).toBe(seconds);
  });

  it('snaps the hour/minute bounds inward so the converted value stays inside the kernel range', () => {
    expect(displayBounds('max_entries', [128, 10000000])).toEqual([128, 10000000]);
    expect(displayBounds('stale_ttl', [0, 2592000])).toEqual([0, 720]);
    expect(displayBounds('save_interval', [60, 604800])).toEqual([1, 10080]);
    expect(displayBounds('stale_ttl', [1, 3599])).toEqual([0.01, 0.99]);
  });
});

describe('cache limits dialog markup', () => {
  it('renders one input per pool and field that the reader can find again', () => {
    const settings = cacheSettings(payload())!;
    document.body.innerHTML = '<div id="modal-content"></div>';
    document.querySelector('#modal-content')!.innerHTML = cacheLimitsForm(settings, helpers);
    for (const cache of settings.caches) {
      for (const field of CACHE_FIELDS) {
        const input = document.querySelector<HTMLInputElement>(cacheLimitInputSelector(cache.key, field));
        expect(input, `${cache.key}.${field}`).not.toBeNull();
        expect(input!.value).toBe(String(toDisplay(field, cache[field])));
      }
    }
    const body = readCacheLimits(settings, (key, field) => document.querySelector<HTMLInputElement>(cacheLimitInputSelector(key, field))!.value);
    expect(body.main).toEqual({ max_entries: 400000, stale_ttl: 604800, save_interval: 1800 });
    expect(Object.keys(body)).toEqual(['main', 'domestic', 'foreign', 'foreign_ecs']);
  });

  it('shows the per-pool memory budget and its share of the kernel total', () => {
    const settings = cacheSettings(payload())!;
    expect(cacheBudget(settings.caches[0], settings.cache_memory_mb)).toEqual({ size: '85.3', share: 67 });
    expect(cacheBudget(settings.caches[1], settings.cache_memory_mb)).toEqual({ size: '21.3', share: 17 });
    expect(cacheBudget(settings.caches[2], settings.cache_memory_mb)).toEqual({ size: '10.7', share: 8 });

    const html = cacheLimitsForm(settings, helpers);
    expect(html).toContain('预算 85.3 MB · 67%');
    expect(html).toContain('内存预算按各池记录上限的比例分配（当前 128 MB）');
    expect(html).toContain('改上限后要重启内核才按新比例重新分配');
  });

  it('leaves the budget out on cores that do not report it', () => {
    const value = payload() as Record<string, unknown>;
    delete value.cache_memory_mb;
    for (const cache of value.caches as Record<string, unknown>[]) delete cache.budget_bytes;
    const settings = cacheSettings(value)!;
    expect(cacheBudget(settings.caches[0], settings.cache_memory_mb)).toBeNull();
    const html = cacheLimitsForm(settings, helpers);
    expect(html).not.toContain('cache-limit-budget');
    expect(html).not.toContain('内存预算按各池记录上限的比例分配');
  });

  it('marks a pool whose saved value is waiting for a restart', () => {
    const value = payload();
    value.caches[2].max_entries = 123456;
    const settings = cacheSettings(value)!;
    const html = cacheLimitsForm(settings, helpers);
    expect(html).toContain('cache-limit-pending');
    expect(html.match(/cache-limit-pending/g)).toHaveLength(1);
  });

  it('reports the empty field instead of sending NaN to the kernel', () => {
    const settings = cacheSettings(payload())!;
    expect(() => readCacheLimits(settings, () => '  ')).toThrow(/请填写/);
  });
});

describe('cache limits payload', () => {
  it('sends every pool in one request', () => {
    const parsed = cacheSettings(payload())!;
    const body = buildCacheLimits(parsed, values());
    expect(Object.keys(body)).toEqual(['main', 'domestic', 'foreign', 'foreign_ecs']);
    for (const pool of Object.values(body)) expect(Object.keys(pool).sort()).toEqual([...CACHE_FIELDS].sort());
  });

  it('refuses out-of-range and non-integer values before calling the kernel', () => {
    const parsed = cacheSettings(payload())!;
    const low = values(); low.main.max_entries = 127;
    expect(() => buildCacheLimits(parsed, low)).toThrow(/最大记录数/);
    const high = values(); high.foreign.stale_ttl = 2592001;
    expect(() => buildCacheLimits(parsed, high)).toThrow(/过期保留/);
    const fractional = values(); fractional.domestic.save_interval = 90.5;
    expect(() => buildCacheLimits(parsed, fractional)).toThrow(/整数秒/);
    const missing = values() as Record<string, Record<string, number>>;
    delete missing.foreign_ecs;
    expect(() => buildCacheLimits(parsed, missing)).toThrow(/缺少/);
  });
});
