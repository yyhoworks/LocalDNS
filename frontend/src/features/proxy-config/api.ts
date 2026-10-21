import { HttpClient } from '../../core/api/http-client';
import { ApiError } from '../../core/api/api-error';

export function proxyConfigBase(configured = '', apiBase = '', origin = location.origin): string {
  const url = new URL(configured || apiBase || origin, origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('配置服务地址必须为 HTTP(S) 地址。');
  if (!configured) { url.port = '9098'; url.pathname = '/'; }
  url.search = ''; url.hash = '';
  url.pathname = url.pathname.replace(/\/$/, '').replace(/\/api\/proxy-config$/, '') + '/api/proxy-config/';
  return url.href;
}

export async function request(path: string, { method = 'GET', body, signal }: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
  const settings = (window as typeof window & { LOCALDNS_UI_CONFIG?: { proxyConfigBase?: string; apiBase?: string } }).LOCALDNS_UI_CONFIG || {};
  const base = proxyConfigBase(settings.proxyConfigBase, settings.apiBase);
  const client = new HttpClient({ base, timeout: path === 'save' ? 105000 : path === 'check' ? 55000 : 20000 });
  try {
    return await client.request(path, { method, signal, credentials: 'omit', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    if (path === 'fetch' && error instanceof ApiError && [404, 405].includes(error.status)) {
      const failure = new Error('当前配置服务不支持 HTTP 获取，请安装 1.6.0 或更新的配套服务后重试。');
      Object.assign(failure, { cause: error }); throw failure;
    }
    if (error instanceof ApiError && (error.code === 'network' || error.code === 'invalid-json')) {
      const failure = new Error('无法连接配置管理服务，请检查服务地址和安装状态后重试。');
      Object.assign(failure, { cause: error }); throw failure;
    }
    throw error;
  }
}
