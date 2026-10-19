import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/core/api/api-error';
import { HttpClient } from '../src/core/api/http-client';
import { normalizeResponse } from '../src/core/api/contracts';
import { CleanupScope } from '../src/core/lifecycle/cleanup-scope';
import { Preferences } from '../src/core/persistence/preferences';
import { migratePreference } from '../src/core/persistence/migrations';

afterEach(() => vi.useRealTimers());

describe('HTTP boundary', () => {
  it('preserves base, method, body, headers, JSON and text responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"ok":true}', { headers: { 'content-type': 'application/problem+json' } })).mockResolvedValueOnce(new Response('metric 3'));
    const client = new HttpClient({ base: 'http://dns.test', fetch: fetcher });
    expect(await client.request('/api/test', { method: 'POST', body: 'test', headers: { 'x-test': 'ok' } })).toEqual({ ok: true });
    expect(fetcher.mock.calls[0][0]).toBe('http://dns.test/api/test');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: 'test', headers: { 'x-test': 'ok' } });
    expect(await client.request('/metrics')).toBe('metric 3');
  });
  it('retains status and error body for conflict handling', async () => {
    const client = new HttpClient({ fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":"changed","code":"conflict"}', { status: 409, headers: { 'content-type': 'application/json' } })) });
    await expect(client.request('/config')).rejects.toMatchObject({ status: 409, message: 'changed', body: { code: 'conflict' } });
  });
  it('reports malformed JSON and network failures consistently', async () => {
    const client = new HttpClient({ fetch: vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{bad', { headers: { 'content-type': 'application/json' } })).mockRejectedValueOnce(new TypeError('offline')) });
    await expect(client.request('/x')).rejects.toMatchObject({ code: 'invalid-json' });
    await expect(client.request('/x')).rejects.toMatchObject({ code: 'network' });
  });
  it('cancels an already aborted request before sending it', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn<typeof fetch>();
    await expect(new HttpClient({ fetch: fetcher }).request('/x', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps the timeout active while reading the body', async () => {
    vi.useFakeTimers();
    const fetcher: typeof fetch = async (_url, options) => new Response(new ReadableStream({ start(controller) { options?.signal?.addEventListener('abort', () => controller.error(new DOMException('cancelled', 'AbortError'))); } }));
    const pending = new HttpClient({ timeout: 20, fetch: fetcher }).request('/slow');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(20); await assertion;
  });
  it('applies route cancellation to reads and permits explicitly scoped writes', async () => {
    const route = new AbortController(); route.abort();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('saved'));
    const client = new HttpClient({ signal: () => route.signal, fetch: fetcher });
    await expect(client.request('/read')).rejects.toMatchObject({ name: 'AbortError' });
    expect(await client.request('/save', { method: 'POST' })).toBe('saved');
  });
});

describe('runtime contracts', () => {
  it('fills missing log collections and preserves extensions', () => {
    expect(normalizeResponse('/api/v2/audit/logs?page=1', { extension: true })).toEqual({ extension: true, logs: [], filters: {}, pagination: {} });
  });
  it.each([
    ['/api/v2/audit/logs', { logs: {} }], ['/api/v2/audit/logs', { logs: [{ query_name: 123 }] }],
    ['/api/v2/audit/logs', { pagination: { total_items: 'x' } }], ['/api/v2/audit/logs', { filters: { query_types: [1] } }],
    ['/api/v1/upstream/config', { domestic: 'bad' }], ['/api/v2/audit/stats', { total_queries: '100' }],
    ['/metrics', {}], ['/api/v2/audit/rank/domain', {}],
  ])('rejects malformed %s before rendering', (path, value) => {
    expect(() => normalizeResponse(path, value)).toThrow(ApiError);
  });
});

describe('route cleanup', () => {
  it('releases listeners and timers once, even when one cleanup throws', () => {
    vi.useFakeTimers();
    const target = new EventTarget(), callback = vi.fn(), cleanup = vi.fn();
    const scope = new CleanupScope();
    scope.listen(target, 'test', callback); scope.interval(callback, 10); scope.timeout(callback, 20);
    scope.add(cleanup); scope.add(() => { throw new Error('test'); });
    target.dispatchEvent(new Event('test')); expect(callback).toHaveBeenCalledTimes(1);
    scope.dispose(); scope.dispose(); target.dispatchEvent(new Event('test')); vi.advanceTimersByTime(100);
    expect(scope.signal.aborted).toBe(true); expect(cleanup).toHaveBeenCalledTimes(1); expect(callback).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a late result after navigation and immediately cleans resources added after disposal', async () => {
    const scope = new CleanupScope(), cleanup = vi.fn();
    let resolve!: (value: string) => void;
    const pending = scope.guard(new Promise<string>(r => { resolve = r; }));
    scope.dispose(); scope.add(cleanup); resolve('old page');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('compatible preferences', () => {
  it('retains old data and never overwrites an existing destination', () => {
    const values = new Map([['old', '{"font":"serif"}']]);
    const repository = new Preferences(() => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }) as Storage);
    migratePreference(repository, 'old', 'new', value => ({ version: 1, value }));
    expect(repository.get('old', null)).toEqual({ font: 'serif' });
    repository.set('new', { custom: true }); migratePreference(repository, 'old', 'new', () => 'wrong');
    expect(repository.get('new', null)).toEqual({ custom: true });
  });
  it('surfaces storage failure while keeping the migration source', () => {
    const storage = { getItem: (key: string) => key === 'old' ? '1' : null, setItem: () => { throw new Error('quota'); } } as unknown as Storage;
    expect(() => migratePreference(new Preferences(() => storage), 'old', 'new', value => value)).toThrow('quota');
    expect(storage.getItem('old')).toBe('1');
  });
});
