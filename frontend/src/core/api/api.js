import { backendHttp } from './network';
import { normalizeResponse } from './contracts';
export const api = {
  url: path => backendHttp.url(path),
  async request(path, options = {}) {
    const value = await backendHttp.request(path, options);
    return String(options.method || 'GET').toUpperCase() === 'GET' ? normalizeResponse(path, value) : value;
  },
  json(path, method = 'GET', body) { return this.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); },
  metrics() { return this.request('/metrics'); },
  status() { return this.request('/api/v1/audit/status'); },
  capacity() { return this.request('/api/v1/audit/capacity'); },
  stats() { return this.request('/api/v2/audit/stats'); },
  rank(type, limit = 10) { return this.request(`/api/v2/audit/rank/${type}?limit=${limit}`); },
  logs(params = {}) { const query = new URLSearchParams({ page: 1, limit: 50, ...params }); for (const [key,value] of query) if (value === '' || value == null) query.delete(key); return this.request(`/api/v2/audit/logs?${query}`); },
};
