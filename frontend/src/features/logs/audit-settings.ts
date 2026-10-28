import { ApiError } from '../../core/api/api-error';

export interface AuditStorage {
  capacity: number;
  dir: string;
  path: string;
  memory_fs: boolean;
  entries: number;
  memory_bytes: number;
  disk_bytes: number;
  /** FJH1Z and later expose the runtime disk-writing switch. */
  persist?: boolean;
}

export function auditDirectory(value: string): string {
  const directory = value.trim();
  if (!directory) throw new Error('请填写日志目录，例如 logs 或 /var/log/localdns。');
  if ([...directory].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('目录不能包含换行或控制字符。');
  if (directory.includes('\\') || /^[a-z]:/i.test(directory) || /^[a-z]+:\/\//i.test(directory)) {
    throw new Error('请填写 VM 上的 Linux 目录，例如 /var/log/localdns。');
  }
  return directory;
}

export function auditStorage(value: unknown): AuditStorage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('日志存储信息格式无效。', 0, null, 'contract');
  }
  const data = value as Record<string, unknown>;
  if (typeof data.dir !== 'string' || !data.dir.trim() || typeof data.path !== 'string' || !data.path.startsWith('/') || typeof data.memory_fs !== 'boolean') {
    throw new ApiError('日志存储目录信息不完整。', 0, null, 'contract');
  }
  for (const key of ['capacity', 'entries', 'memory_bytes', 'disk_bytes']) {
    if (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || Number(data[key]) < 0) {
      throw new ApiError('日志存储统计格式无效。', 0, null, 'contract');
    }
  }
  // Older cores omit `persist` entirely; only reject a present-but-wrong value
  // so the switch is hidden instead of the whole dialog failing.
  if (data.persist !== undefined && typeof data.persist !== 'boolean') {
    throw new ApiError('日志存盘状态格式无效。', 0, null, 'contract');
  }
  return data as unknown as AuditStorage;
}

export async function readAuditStorage(request: (path: string) => Promise<unknown>): Promise<AuditStorage | null> {
  try {
    return auditStorage(await request('/api/v1/audit/settings'));
  } catch (error) {
    if (error instanceof ApiError && [404, 405, 501].includes(error.status)) return null;
    throw error;
  }
}
