import { HttpClient } from '../../core/api/http-client';
import { sha256 } from '@noble/hashes/sha2.js';

export interface InstalledUI { uiVersion: string; backendVersion?: string }
export interface UIRelease { tag: string; version: string; backend: string; packages: string[] }
export type UpdateMode = 'ui' | 'core' | 'full';
export interface UpdateCapabilities { protocol: string; modes: UpdateMode[]; installed: InstalledUI }
export interface UIUpdateStatus {
  state: 'idle' | 'queued' | 'running' | 'awaiting_backup' | 'rolling_back' | 'rolled_back' | 'succeeded' | 'failed';
  jobId?: string;
  action?: 'upgrade' | 'rollback';
  step?: string;
  message?: string;
  installedVersion?: string;
  installedBackend?: string;
  mode?: UpdateMode | 'rollback';
  rollbackKind?: 'ui' | 'full';
  backupDownloaded?: boolean;
  backup?: { name: string; sha256: string; bytes: number };
  canRollback: boolean;
}

function parts(value: string): number[] | undefined {
  return /^(\d{4}\.\d+\.\d+\.\d+)(?:-local[\w.-]*)?$/.exec(value)?.[1].split('.').map(Number);
}

export function upgradeTarget(installed: InstalledUI | null, release: UIRelease | null, options?: { mode: UpdateMode; unified: boolean }): { tag?: string; reason: string } {
  if (!installed || !release) return { reason: '先检查更新，获取可安装的正式版本。' };
  // A release tag without a backend prefix carries no core requirement; only
  // block when it names a different backend (mirrors assess() in index.js).
  if (!options?.unified && release.backend && release.backend !== installed.backendVersion?.toUpperCase()) return { reason: '此发行版需要不同的 DNS 核心，请先查看发布说明。' };
  const current = parts(installed.uiVersion), target = parts(release.version);
  if (!current || !target) return { reason: '版本信息无效，请重新检查更新。' };
  const different = target.findIndex((value, index) => value !== current[index]);
  if (options?.unified && options.mode !== 'ui') {
    if (!release.packages.includes('含核心完整包')) return { reason: '该发行版没有提供完整包。' };
    if (!release.backend || !/^fj[a-z][a-z0-9]+-ui-v\d{4}\.\d+\.\d+\.\d+$/i.test(release.tag)) return { reason: '发行版标签无效。' };
    if (different >= 0 && target[different] < current[different]) return { reason: '目标发行版早于当前 UI，请使用回退操作。' };
    const sameCore = release.backend === installed.backendVersion?.toUpperCase();
    if (options.mode === 'core' && sameCore) return { reason: '当前内核已是此版本。' };
    if (options.mode === 'full' && sameCore && different < 0) return { reason: 'UI 与内核均已是此版本。' };
    return { tag: release.tag, reason: options.mode === 'core' ? '保留当前 UI，升级内核；先下载备份，切换时 DNS 会短暂重启。' : '同时升级 UI 与内核；先下载备份，切换时 DNS 会短暂重启。' };
  }
  if (different < 0 || target[different] < current[different]) return { reason: '暂无比当前 UI 更新的正式版。' };
  if (!release.packages.includes('UI 升级包')) return { reason: '该发行版没有提供 UI 升级包。' };
  // The FJ prefix does not imply a G third letter (FJGOE -> FJH21); keep this
  // shape aligned with tools/ui_updater.py and tools/package_ui.py.
  if (!/^fj[a-z][a-z0-9]+-ui-v\d{4}\.\d+\.\d+\.\d+$/i.test(release.tag)) return { reason: '发行版标签无效，请查看发布说明。' };
  return { tag: release.tag, reason: '仅更新界面，保留配置、Logo 和字体；无需重启 DNS。' };
}

export class UIUpdateClient {
  private http: HttpClient;
  capabilities?: UpdateCapabilities;
  get unified() { return this.capabilities?.protocol === 'localdns-updater/v2'; }
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
    if (data) headers['Content-Type'] = 'application/json';
    return this.http.request(path, {
        method: data ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', headers,
        ...(data ? { body: JSON.stringify(data) } : {}),
    });
  }
  async discover(): Promise<void> {
    const result = await this.request('/upgrade/ui') as { protocol?: string; repository?: string; capabilities?: UpdateCapabilities };
    if (result?.protocol !== 'localdns-ui-updater/v1' || result.repository !== 'https://github.com/yyhoworks/LocalDNS') {
      throw new Error('服务器未提供兼容的 LocalDNS UI 升级接口。');
    }
    if (result.capabilities?.protocol === 'localdns-updater/v2' && ['ui', 'core', 'full'].every(mode => result.capabilities!.modes?.includes(mode as UpdateMode))) this.capabilities = result.capabilities;
  }
  private validate(value: unknown): UIUpdateStatus {
    const result = value as UIUpdateStatus;
    if (!result || !['idle', 'queued', 'running', 'awaiting_backup', 'rolling_back', 'rolled_back', 'succeeded', 'failed'].includes(result.state)
      || typeof result.canRollback !== 'boolean') throw new Error('升级任务状态无效，请重试连接。');
    if (result.backup && (!/^[a-f0-9]{64}$/.test(result.backup.sha256) || !Number.isSafeInteger(result.backup.bytes) || result.backup.bytes <= 0 || !/^[a-f0-9]{24}$/.test(result.jobId || ''))) throw new Error('升级备份信息无效。');
    return result;
  }
  private get path() { return this.unified ? '/upgrade' : '/upgrade/ui'; }
  async status() { return this.validate(await this.request(this.path + '/status')); }
  async upgrade(releaseTag: string, mode: UpdateMode = 'ui') {
    if (!this.unified && mode !== 'ui') throw new Error('请先安装支持内核升级的服务。');
    return this.validate(await this.request(this.path, { releaseTag, ...(this.unified ? { mode } : {}) }));
  }
  async rollback() { return this.validate(await this.request(this.path + '/rollback', {})); }
  async continue(jobId: string, sha256: string) { return this.validate(await this.request('/upgrade/continue', { jobId, sha256 })); }
  async cancel(jobId: string) { return this.validate(await this.request('/upgrade/cancel', { jobId })); }
  async download(task: UIUpdateStatus): Promise<Blob> {
    if (!task.backup || !/^[a-f0-9]{24}$/.test(task.jobId || '')) throw new Error('备份尚未就绪。');
    const response = await this.http.fetch('/upgrade/backup/' + task.jobId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', timeout: 300000, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error('备份下载失败，请刷新状态后重试。');
    const blob = await response.blob();
    if (blob.size !== task.backup.bytes || await hashBackup(blob) !== task.backup.sha256) throw new Error('备份下载不完整或摘要不一致，请重新下载。');
    return blob;
  }
}

export async function hashBackup(file: Blob, progress?: (percent: number) => void): Promise<string> {
  const hash = sha256.create(), size = 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += size) {
    hash.update(new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()));
    progress?.(Math.min(100, Math.round((offset + size) / file.size * 100)));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
}
