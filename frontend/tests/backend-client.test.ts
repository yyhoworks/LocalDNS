import { describe, expect, it, vi } from 'vitest';
import { BackendClient } from '../src/core/api/backend-client';
import { ApiError } from '../src/core/api/api-error';
import type { HttpRequestOptions } from '../src/core/api/http-client';

function fixture(legacy = false) {
  const state: Record<string, boolean | string> = { request_blocking: true, block_special_qtypes: true,
    adguard: false, block_aaaa: false, full_cache: true, route_cache: true, client_policy: 'normal' };
  const request = vi.fn(async (path: string, options: HttpRequestOptions = {}): Promise<unknown> => {
    if (path === '/api/v1/features') {
      if (legacy) throw new ApiError('Not found', 404, null);
      if (options.method === 'PUT') Object.assign(state, JSON.parse(String(options.body)));
      return { ...state };
    }
    return { path, method: options.method || 'GET', body: options.body };
  });
  return { state, request, client: new BackendClient({ request }) };
}

describe('backend compatibility', () => {
  it.each(['domestic', 'foreign', 'foreign_ecs', 'proxy'])('saves %s with the FJGLI group field and retains all upstream settings', async group => {
    const { request, client } = fixture();
    const upstreams = [{ tag: 'test', protocol: 'https', addr: 'https://dns.example/dns-query',
      enabled: false, dial_addr: '192.0.2.53', socks5: '127.0.0.1:1080' }];
    const ecs = group === 'foreign_ecs' ? { ecs: '192.0.2.0/24' } : {};
    await client.request('/api/v1/upstream/config', { method: 'POST', body: JSON.stringify({ plugin_tag: group, upstreams, ...ecs }) });
    const [path, options] = request.mock.calls[request.mock.calls.length - 1];
    expect(path).toBe('/api/v1/upstream/config');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({ group, upstreams, ...ecs });
  });

  it('retains plugin_tag for old cores and never retries a failed upstream save', async () => {
    const old = fixture(true);
    const options = { method: 'POST', body: '{"plugin_tag":"domestic","upstreams":[]}' };
    await old.client.request('/api/v1/upstream/config', options);
    expect(old.request).toHaveBeenLastCalledWith('/api/v1/upstream/config', options);
    const current = fixture();
    await current.client.request('/plugins/switch1/show');
    current.request.mockRejectedValueOnce(new ApiError('save failed', 400));
    const count = current.request.mock.calls.length;
    await expect(current.client.request('/api/v1/upstream/config', options)).rejects.toMatchObject({ status: 400 });
    expect(current.request.mock.calls.slice(count)).toHaveLength(1);
    expect(JSON.parse(String(current.request.mock.calls[current.request.mock.calls.length - 1][1]?.body))).toEqual({ group: 'domestic', upstreams: [] });
  });

  it('retains legacy paths and methods after a read-only capability check', async () => {
    const { request, client } = fixture(true);
    const options = { method: 'POST', body: '{"values":["example.com"]}' };
    await client.request('/plugins/whitelist/post', options);
    expect(request).toHaveBeenLastCalledWith('/plugins/whitelist/post', options);
    await client.request('/api/v2/audit/stats');
    expect(request.mock.calls.filter(([path]) => path === '/api/v1/features')).toHaveLength(1);
  });

  it('maps logs, aliases, list tags, methods and rule names without changing payloads', async () => {
    const { client } = fixture();
    expect(await client.request('/api/v2/audit/logs?page=3&client_contains=192.0.2.1')).toMatchObject({
      path: '/api/v1/querylog/entries?page=3&client_contains=192.0.2.1', method: 'GET' });
    expect(await client.request('/plugins/client_name', { method: 'PUT', body: '{}' })).toMatchObject({ path: '/api/v1/client-aliases', method: 'PUT' });
    expect(await client.request('/plugins/greylist/show?all=1')).toMatchObject({ path: '/api/v1/lists/proxy?all=1' });
    expect(await client.request('/plugins/whitelist/post', { method: 'POST', body: '{"values":[]}' })).toMatchObject({
      path: '/api/v1/lists/direct', method: 'PUT', body: '{"values":[]}' });
    expect(await client.request('/plugins/geosite_cn/update/a%2Fb', { method: 'POST', timeout: 300000 })).toMatchObject({
      path: '/api/v1/rule-groups/geosite_cn/a%2Fb/update', method: 'POST' });
    expect(await client.request('/plugins/requery/scheduler/config', { method: 'POST', body: '{}' })).toMatchObject({
      path: '/api/v1/route-refresh/schedule', method: 'PUT' });
    expect(await client.request('/plugins/cache_foreign_ecs/flush')).toMatchObject({
      path: '/api/v1/caches/foreign_ecs/flush', method: 'POST' });
    expect(await client.request('/plugins/fakeip/save')).toMatchObject({ path: '/api/v1/learned/fakeip/save', method: 'POST' });
  });

  it('forwards query parameters through the lists, cache and learned translations', async () => {
    const { client } = fixture();
    expect(await client.request('/plugins/greylist/post?all=1', { method: 'POST', body: '{"values":[]}' })).toMatchObject({
      path: '/api/v1/lists/proxy?all=1', method: 'PUT', body: '{"values":[]}' });
    expect(await client.request('/plugins/cache_main/show?detail=1')).toMatchObject({
      path: '/api/v1/caches/main?detail=1', method: 'GET' });
    expect(await client.request('/plugins/cache_main/flush?force=1')).toMatchObject({
      path: '/api/v1/caches/main/flush?force=1', method: 'POST' });
    expect(await client.request('/plugins/domain_stats/show?range=7d')).toMatchObject({
      path: '/api/v1/domain-stats?range=7d', method: 'GET' });
    expect(await client.request('/plugins/fakeip/show?note=a?b')).toMatchObject({
      path: '/api/v1/learned/fakeip?note=a?b', method: 'GET' });
  });

  it('preserves the selected client policy when old screens disable the opposite switch', async () => {
    const { client, state } = fixture();
    await client.request('/plugins/switch2/post', { method: 'POST', body: '{"value":"A"}' });
    await client.request('/plugins/switch12/post', { method: 'POST', body: '{"value":"B"}' });
    expect(state.client_policy).toBe('listed_proxy_only');
    await client.request('/plugins/switch12/post', { method: 'POST', body: '{"value":"A"}' });
    await client.request('/plugins/switch2/post', { method: 'POST', body: '{"value":"B"}' });
    expect(state.client_policy).toBe('listed_direct');
    await Promise.all(['switch2', 'switch12'].map(tag => client.request('/plugins/' + tag + '/post', { method: 'POST', body: '{"value":"B"}' })));
    expect(state.client_policy).toBe('normal');
  });

  it('does not guess a legacy API or repeat a write after transport failure', async () => {
    const { request, client } = fixture();
    await client.request('/plugins/switch1/show');
    request.mockRejectedValueOnce(new ApiError('timeout', 0, null, 'timeout'));
    const count = request.mock.calls.length;
    await expect(client.request('/plugins/whitelist/post', { method: 'POST', body: '{"values":[]}' })).rejects.toMatchObject({ code: 'timeout' });
    expect(request.mock.calls.slice(count).map(([path]) => path)).toEqual(['/api/v1/lists/direct']);
  });

  it('does not treat authentication or invalid feature data as an older backend', async () => {
    for (const failure of [new ApiError('Forbidden', 403, null), new ApiError('Network', 0, null, 'network')]) {
      const request = vi.fn().mockRejectedValue(failure);
      await expect(new BackendClient({ request }).request('/plugins/whitelist/post', { method: 'POST', body: '{}' })).rejects.toBe(failure);
      expect(request).toHaveBeenCalledTimes(1);
    }
    await expect(new BackendClient({ request: vi.fn().mockResolvedValue({}) }).request('/plugins/whitelist/show')).rejects.toMatchObject({ code: 'contract' });
  });

  it('updates only the requested group and preserves uncertain update results', async () => {
    const { request, client } = fixture();
    const base = request.getMockImplementation()!;
    request.mockImplementation(async (path, options) => {
      if (path === '/api/v1/rule-groups/geosite_cn') return [
        { name: 'first', url: 'https://example.com/first', enabled: true },
        { name: 'disabled', url: 'https://example.com/disabled', enabled: false },
      ];
      return base(path, options);
    });
    expect(await client.request('/plugins/geosite_cn/update-all', { method: 'POST', timeout: 300000 })).toMatchObject({ updated: 1, failed: 0 });
    expect(request.mock.calls.some(([path]) => path === '/api/v1/rule-groups/update')).toBe(false);
    expect(request.mock.calls.some(([path]) => path.endsWith('/disabled/update'))).toBe(false);
    request.mockImplementation(async (path, options) => {
      if (path.endsWith('/first/update')) throw new ApiError('Pending', 0, null, 'timeout');
      if (path === '/api/v1/rule-groups/geosite_cn') return [{ name: 'first', url: 'https://example.com' }];
      return base(path, options);
    });
    await expect(client.request('/plugins/geosite_cn/update-all', { method: 'POST' })).rejects.toMatchObject({ code: 'timeout' });
  });
});
