import { HttpClient } from '../../core/api/http-client';

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

/** localStorage key holding the optional ui-updater service token (see tools/ui_updater.py). */
export const UI_UPDATE_TOKEN_KEY = 'localdns-ui-update-token-v1';

export function readUIUpdateToken(): string {
  try { return localStorage.getItem(UI_UPDATE_TOKEN_KEY) || ''; } catch { return ''; }
}

export function saveUIUpdateToken(token: string): void {
  try {
    if (token) localStorage.setItem(UI_UPDATE_TOKEN_KEY, token);
    else localStorage.removeItem(UI_UPDATE_TOKEN_KEY);
  } catch { /* storage unavailable: requests simply go out without a token */ }
}

export function upgradeTarget(installed: InstalledUI | null, release: UIRelease | null): { tag?: string; reason: string } {
  if (!installed || !release) return { reason: '先检查更新，获取可安装的正式版本。' };
  // A release tag without a backend prefix carries no core requirement; only
  // block when it names a different backend (mirrors assess() in index.js).
  if (release.backend && release.backend !== installed.backendVersion?.toUpperCase()) return { reason: '此发行版需要不同的 DNS 核心，请先查看发布说明。' };
  const current = parts(installed.uiVersion), target = parts(release.version);
  if (!current || !target) return { reason: '版本信息无效，请重新检查更新。' };
  const different = target.findIndex((value, index) => value !== current[index]);
  if (different < 0 || target[different] < current[different]) return { reason: '暂无比当前 UI 更新的正式版。' };
  if (!release.packages.includes('UI 升级包')) return { reason: '该发行版没有提供 UI 升级包。' };
  if (!/^fjg[a-z0-9]+-ui-v\d{4}\.\d+\.\d+\.\d+$/i.test(release.tag)) return { reason: '发行版标签无效，请查看发布说明。' };
  return { tag: release.tag, reason: '仅更新界面，保留配置、Logo 和字体；无需重启 DNS。' };
}

export class UIUpdateClient {
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
  private async request(path: string, data?: object): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    // Send the token on every request when one is configured. Servers with an
    // empty token configured ignore it, so this stays compatible with both
    // token-protected and legacy updaters (read endpoints may be exempt there).
    const token = readUIUpdateToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data) headers['Content-Type'] = 'application/json';
    return this.http.request(path, {
        method: data ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', headers,
        ...(data ? { body: JSON.stringify(data) } : {}),
    });
  }
  async discover(): Promise<void> {
    const result = await this.request('/upgrade/ui') as { protocol?: string; repository?: string };
    if (result?.protocol !== 'localdns-ui-updater/v1' || result.repository !== 'https://github.com/yyhoworks/LocalDNS') {
      throw new Error('服务器未提供兼容的 LocalDNS UI 升级接口。');
    }
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
