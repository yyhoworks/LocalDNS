// @ts-check
import { backendHttp } from './network';
import { normalizeResponse } from './contracts';
import { BackendClient } from './backend-client';
const backend = new BackendClient(backendHttp);
export const api = {
  /** @param {string} path */
  url: path => backendHttp.url(path),
  /**
   * @param {string} path
   * @param {import('./http-client').HttpRequestOptions} [options]
   */
  async request(path, options = {}) {
    const value = await backend.request(path, options);
    return String(options.method || 'GET').toUpperCase() === 'GET' ? normalizeResponse(path, value) : value;
  },
  /**
   * @param {string} path
   * @param {string} [method]
   * @param {unknown} [body]
   */
  json(path, method = 'GET', body) { return this.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); },
  metrics() { return this.request('/metrics'); },
  status() { return this.request('/api/v1/audit/status'); },
  capacity() { return this.request('/api/v1/audit/capacity'); },
  stats() { return this.request('/api/v2/audit/stats'); },
  /** @param {string} type @param {number} [limit] */
  rank(type, limit = 10) { return this.request(`/api/v2/audit/rank/${type}?limit=${limit}`); },
  /** @param {Record<string, string | number>} [params] */
  logs(params = {}) { const query = new URLSearchParams(/** @type {Record<string, string>} */ ({ page: '1', limit: '50', ...params })); const emptyKeys = []; for (const [key,value] of query) if (value === '' || value == null) emptyKeys.push(key); for (const key of emptyKeys) query.delete(key); return this.request(`/api/v2/audit/logs?${query}`); },
};
