import { ApiError } from './api-error';
import { throwIfAborted } from '../lifecycle/abort';

export class HttpClient {
  constructor(private options: {
    base?: string;
    timeout?: number;
    signal?: () => AbortSignal | undefined;
    fetch?: typeof fetch;
  } = {}) {}

  url(path: string | URL): string {
    if (path instanceof URL || /^(?:https?:|data:|blob:)/i.test(String(path))) return String(path);
    return `${this.options.base || ''}${path}`;
  }

  private async run<T>(path: string | URL, options: RequestInit, read: (response: Response) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const signal = options.signal || (String(options.method || 'GET').toUpperCase() === 'GET' ? this.options.signal?.() : undefined);
    const forward = () => controller.abort(signal?.reason);
    if (signal?.aborted) forward();
    else signal?.addEventListener('abort', forward, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.timeout ?? 10000);
    try {
      throwIfAborted(controller.signal);
      const response = await (this.options.fetch || globalThis.fetch)(this.url(path), { ...options, signal: controller.signal });
      const value = await read(response);
      throwIfAborted(controller.signal);
      return value;
    } catch (error) {
      if (signal?.aborted) throw signal.reason || new DOMException('Request cancelled', 'AbortError');
      if (timedOut) throw new ApiError('请求超时，请重试。', 0, null, 'timeout');
      if (error instanceof ApiError) throw error;
      if (error instanceof SyntaxError) throw new ApiError('服务器返回了无效的 JSON。', 0, null, 'invalid-json');
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new ApiError(error instanceof Error ? error.message : '网络请求失败。', 0, null, 'network');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    }
  }

  request(path: string | URL, options: RequestInit = {}): Promise<unknown> {
    return this.run(path, options, async response => {
      const body: unknown = response.status === 204 ? null : /(?:application\/json|\+json)/i.test(response.headers.get('content-type') || '')
        ? await response.json() : await response.text();
      if (!response.ok) {
        const message = body && typeof body === 'object' && 'error' in body ? String(body.error)
          : typeof body === 'string' && body ? body : `HTTP ${response.status}`;
        throw new ApiError(message, response.status, body);
      }
      return body;
    });
  }

  // Buffer while the timeout and cancellation handlers are still attached.
  // Asset callers retain Response APIs and their existing status handling.
  fetch(path: string | URL, options: RequestInit = {}): Promise<Response> {
    return this.run(path, options, async response => {
      const body = [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer();
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    });
  }
}
