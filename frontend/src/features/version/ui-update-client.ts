import { HttpClient } from '../../core/api/http-client';
import { ApiError } from '../../core/api/api-error';

export interface InstalledUI { uiVersion: string; backendVersion?: string }
export interface UIRelease { tag: string; version: string; backend: string; packages: string[] }
export interface UIUpdateStatus {
  state: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';
  jobId?: string;
  action?: 'upgrade' | 'rollback';
  step?: string;
  message?: string;
  installedVersion?: string;
  canRollback: boolean;
}

function parts(value: string): number[] | undefined {
  return /^(\d{4}\.\d+\.\d+\.\d+)(?:-local[\w.-]*)?$/.exec(value)?.[1].split('.').map(Number);
}

export function upgradeTarget(installed: InstalledUI | null, release: UIRelease | null): { tag?: string; reason: string } {
  if (!installed || !release) return { reason: '先检查更新，获取可安装的正式版本。' };
  if (release.backend !== installed.backendVersion?.toUpperCase()) return { reason: '此发行版需要不同的 DNS 核心，请先查看发布说明。' };
  const current = parts(installed.uiVersion), target = parts(release.version);
  if (!current || !target) return { reason: '版本信息无效，请重新检查更新。' };
  const different = target.findIndex((value, index) => value !== current[index]);
  if (different < 0 || target[different] < current[different]) return { reason: '暂无比当前 UI 更新的正式版。' };
  if (!release.packages.includes('UI 升级包')) return { reason: '该发行版没有提供 UI 升级包。' };
  if (!/^fjg[a-z0-9]+-ui-v\d{4}\.\d+\.\d+\.\d+$/i.test(release.tag)) return { reason: '发行版标签无效，请查看发布说明。' };
  return { tag: release.tag, reason: '仅更新界面，保留配置、Logo 和字体；无需重启 DNS。' };
}

export class UIUpdateClient {
  private token = '';
  private http: HttpClient;
  constructor(base: string, pageURL = document.baseURI, fetcher?: typeof fetch) {
    const address = new URL(base || new URL(pageURL).origin, pageURL);
    if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password || address.search || address.hash) {
      throw new Error('网页升级地址无效，请检查服务器配置。');
    }
    if (new URL(pageURL).protocol === 'https:' && address.protocol !== 'https:') {
      throw new Error('HTTPS 网页需要配置 HTTPS 升级入口，请查看安装说明。');
    }
    this.http = new HttpClient({ base: address.href.replace(/\/$/, ''), timeout: 10000, fetch: fetcher });
  }
  get authorized() { return Boolean(this.token); }
  private async request(path: string, data?: object): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    if (data) headers['Content-Type'] = 'application/json';
    try {
      return await this.http.request(path, {
        method: data ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', headers,
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.token = '';
      throw error;
    }
  }
  async discover(): Promise<void> {
    const result = await this.request('/upgrade/ui') as { protocol?: string; repository?: string };
    if (result?.protocol !== 'localdns-ui-updater/v1' || result.repository !== 'https://github.com/yyhoworks/LocalDNS') {
      throw new Error('服务器未提供兼容的 LocalDNS UI 升级接口。');
    }
  }
  async login(password: string): Promise<void> {
    const result = await this.request('/session', { password }) as { token?: string };
    if (!result || typeof result.token !== 'string' || !result.token) throw new Error('服务器未返回有效的升级授权。');
    this.token = result.token;
  }
  private validate(value: unknown): UIUpdateStatus {
    const result = value as UIUpdateStatus;
    if (!result || !['idle', 'queued', 'running', 'succeeded', 'failed'].includes(result.state)
      || typeof result.canRollback !== 'boolean') throw new Error('升级任务状态无效，请重试连接。');
    return result;
  }
  async status() { return this.validate(await this.request('/upgrade/ui/status')); }
  async upgrade(releaseTag: string) { return this.validate(await this.request('/upgrade/ui', { releaseTag })); }
  async rollback() { return this.validate(await this.request('/upgrade/ui/rollback', {})); }
}
