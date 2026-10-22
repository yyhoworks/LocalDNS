import { ApiError } from './api-error';
import type { HttpClient, HttpRequestOptions } from './http-client';

type Transport = Pick<HttpClient, 'request'>;
type Features = Record<string, boolean | string>;
const lists: Record<string, string> = {
  whitelist: 'direct', blocklist: 'block', greylist: 'proxy', force_realip: 'proxy_realip',
  ddns_domains: 'ddns', pcdn_domains: 'pcdn', pcdn_regex_v4: 'pcdn_v4',
  pcdn_regex_v6: 'pcdn_v6', client_ip: 'clients', direct_ip: 'direct_cidrs', rewrite: 'rewrite',
};
const switches: Record<string, { key: string; value?: string }> = {
  switch1: { key: 'request_blocking' }, switch5: { key: 'block_special_qtypes' },
  switch7: { key: 'adguard' }, switch6: { key: 'block_aaaa' },
  switch13: { key: 'full_cache' }, switch4: { key: 'route_cache' },
  switch2: { key: 'client_policy', value: 'listed_proxy_only' },
  switch12: { key: 'client_policy', value: 'listed_direct' },
};
const groups = 'custom_cn|custom_non_cn|geoip_cn|geosite_cn|geosite_non_cn';

function features(value: unknown): Features {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('功能开关返回格式无效。', 0, value, 'contract');
  }
  const data = value as Features;
  for (const field of Object.values(switches)) {
    if (typeof data[field.key] !== (field.value ? 'string' : 'boolean')) {
      throw new ApiError('功能开关字段不完整。', 0, value, 'contract');
    }
  }
  if (!['normal', 'listed_proxy_only', 'listed_direct'].includes(String(data.client_policy))) {
    throw new ApiError('客户端策略无法识别。', 0, value, 'contract');
  }
  return data;
}

function body(options: HttpRequestOptions): Record<string, unknown> {
  const value: unknown = typeof options.body === 'string' ? JSON.parse(options.body) : null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求需要 JSON 对象。');
  return value as Record<string, unknown>;
}

/** Keep the UI's operations stable across the legacy plugin API and FJGLI. */
export class BackendClient {
  private family?: Promise<'legacy' | 'fjgli'>;
  private policyQueue: Promise<unknown> = Promise.resolve();

  constructor(private http: Transport) {}

  private detect(): Promise<'legacy' | 'fjgli'> {
    if (!this.family) {
      this.family = this.http.request('/api/v1/features').then(value => {
        // Older cores may serve the UI fallback for unknown routes.
        if (typeof value === 'string' && /^\s*(?:<!doctype html|<html)/i.test(value)) return 'legacy' as const;
        features(value);
        return 'fjgli' as const;
      }).catch(error => {
        if (error instanceof ApiError && [404, 405, 501].includes(error.status)) return 'legacy' as const;
        this.family = undefined;
        throw error;
      });
    }
    return this.family;
  }

  private json(path: string, options: HttpRequestOptions, method: string, value: unknown): Promise<unknown> {
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    return this.http.request(path, { ...options, headers, method, body: JSON.stringify(value) });
  }

  private switchOperation(tag: string, action: string, options: HttpRequestOptions): Promise<unknown> {
    const field = switches[tag];
    if (!field) throw new Error('内核不支持此功能开关。');
    if (action === 'show') {
      return this.http.request('/api/v1/features', options).then(value => {
        const data = features(value);
        return (field.value ? data[field.key] === field.value : data[field.key] === true) ? 'A' : 'B';
      });
    }
    const value = body(options).value;
    if (!['A', 'B'].includes(String(value))) throw new Error('功能开关值无效。');
    if (!field.value) return this.json('/api/v1/features', options, 'PUT', { [field.key]: value === 'A' });
    // Existing screens disable the opposite switch after selecting a policy.
    // Serialize these changes and only clear the policy that is actually selected.
    const operation = this.policyQueue.then(async () => {
      const current = features(await this.http.request('/api/v1/features', { ...options, method: 'GET', body: undefined }));
      if (value === 'B' && current.client_policy !== field.value) return current;
      return this.json('/api/v1/features', options, 'PUT', { client_policy: value === 'A' ? field.value : 'normal' });
    });
    this.policyQueue = operation.catch(() => undefined);
    return operation;
  }

  async request(path: string, options: HttpRequestOptions = {}): Promise<unknown> {
    const [route, query = ''] = path.split('?');
    if (route === '/metrics' || route === '/api/v1/status' || route.startsWith('/api/v1/upstream/') || route === '/api/v1/system/restart') {
      return this.http.request(path, options);
    }
    if (await this.detect() === 'legacy') return this.http.request(path, options);
    const suffix = query ? '?' + query : '';
    if (route.startsWith('/api/v1/audit/')) return this.http.request(route.replace('/api/v1/audit/', '/api/v1/querylog/') + suffix, options);
    if (route.startsWith('/api/v2/audit/')) {
      const target = route === '/api/v2/audit/logs' ? '/api/v1/querylog/entries' : route.replace('/api/v2/audit/', '/api/v1/querylog/');
      return this.http.request(target + suffix, options);
    }
    if (route === '/plugins/client_name') return this.http.request('/api/v1/client-aliases' + suffix, options);
    let match = route.match(/^\/plugins\/(switch\d+)\/(show|post)$/);
    if (match) return this.switchOperation(match[1], match[2], options);
    match = route.match(/^\/plugins\/([^/]+)\/(show|post)$/);
    if (match && lists[match[1]]) {
      const target = '/api/v1/lists/' + lists[match[1]];
      return match[2] === 'show' ? this.http.request(target, options) : this.json(target, options, 'PUT', body(options));
    }
    match = route.match(/^\/plugins\/cache_(main|domestic|foreign|foreign_ecs)\/(show|save|flush)$/);
    if (match) return this.http.request('/api/v1/caches/' + match[1] + (match[2] === 'show' ? '' : '/' + match[2]),
      { ...options, method: match[2] === 'show' ? 'GET' : 'POST' });
    match = route.match(/^\/plugins\/(domain_stats|fakeip|realip|nodata)\/(show|save|flush)$/);
    if (match) return this.http.request('/api/v1/' + (match[1] === 'domain_stats' ? 'domain-stats' : 'learned/' + match[1]) +
      (match[2] === 'show' ? '' : '/' + match[2]), { ...options, method: match[2] === 'show' ? 'GET' : 'POST' });
    if (route.startsWith('/plugins/requery/')) {
      const actions: Record<string, string> = { status: 'status', trigger: 'start', cancel: 'cancel', reset: 'reset',
        'scheduler/config': 'schedule', 'stats/source_file_counts': 'counts' };
      const action = route.slice('/plugins/requery/'.length), target = actions[action];
      if (!target) throw new Error('内核不支持此刷新任务操作。');
      const method = String(options.method || 'GET').toUpperCase();
      return this.http.request('/api/v1/route-refresh/' + target + suffix,
        { ...options, method: target === 'schedule' && method !== 'GET' ? 'PUT' : method });
    }
    if (route.startsWith('/plugins/adguard/')) return this.http.request(route.replace('/plugins/adguard/', '/api/v1/adguard/') + suffix, options);
    match = route.match(new RegExp('^/plugins/(' + groups + ')/config(?:/([^/]+))?$'));
    if (match) return this.http.request('/api/v1/rule-groups/' + match[1] + (match[2] ? '/' + match[2] : '') + suffix, options);
    match = route.match(new RegExp('^/plugins/(' + groups + ')/update/([^/]+)$'));
    if (match) return this.http.request('/api/v1/rule-groups/' + match[1] + '/' + match[2] + '/update' + suffix, options);
    match = route.match(new RegExp('^/plugins/(' + groups + ')/update-all$'));
    if (match) {
      // Update just this group. Never turn five legacy group requests into five global updates.
      const entries = await this.http.request('/api/v1/rule-groups/' + match[1], { ...options, method: 'GET', body: undefined });
      if (!Array.isArray(entries)) throw new ApiError('分流订阅返回格式无效。', 0, entries, 'contract');
      const results = await Promise.all(entries.filter(item => item.enabled !== false && item.url).map(async item => {
        try {
          const result = await this.http.request('/api/v1/rule-groups/' + match![1] + '/' + encodeURIComponent(item.name) + '/update', options);
          return { ok: true, name: item.name, result };
        } catch (error) {
          // A transport failure means the server may still be working; preserve that distinction.
          if (!(error instanceof ApiError) || ['timeout', 'network', 'invalid-json'].includes(error.code)) throw error;
          return { ok: false, name: item.name, error };
        }
      }));
      const errors = results.filter(item => !item.ok).map(item => ({ name: item.name,
        error: item.error!.message, code: (item.error!.body as { code?: string } | null)?.code }));
      return { updated: results.length - errors.length, failed: errors.length,
        dataset_required: errors.filter(error => error.code === 'dataset_required').length, errors };
    }
    if (route.startsWith('/plugins/')) throw new Error('FJGLI 不支持此旧版操作，请更新界面。');
    return this.http.request(path, options);
  }
}
