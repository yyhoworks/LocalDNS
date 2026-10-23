import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/core/api/api';

const features = { request_blocking: true, block_special_qtypes: true, adguard: false,
  block_aaaa: false, full_cache: true, route_cache: true, client_policy: 'normal' };
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('api.logs query cleanup', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('removes every empty parameter, including adjacent ones', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      return json(url.includes('/api/v1/features') ? features : {});
    }));
    await api.logs({ a: '', b: '', c: 'x', d: '' });
    const logsUrl = urls.find(url => url.includes('/api/v1/querylog/entries'));
    expect(logsUrl).toBeDefined();
    const query = new URLSearchParams(logsUrl!.split('?')[1]);
    expect(query.get('page')).toBe('1');
    expect(query.get('limit')).toBe('50');
    expect(query.get('c')).toBe('x');
    for (const key of ['a', 'b', 'd']) expect(query.has(key)).toBe(false);
  });
});
