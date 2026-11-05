import { ApiError } from '../../core/api/api-error';

export type CacheField = 'max_entries' | 'stale_ttl' | 'save_interval';
export type CacheLimits = Record<CacheField, [number, number]>;

export interface CachePool {
  key: string;
  tag: string;
  max_entries: number;
  stale_ttl: number;
  save_interval: number;
  running: Record<CacheField, number> | null;
  /** Bytes the kernel reserves for this pool; absent on cores that only report limits. */
  budget_bytes?: number;
}

export interface CacheSettings {
  restart_needed: boolean;
  limits: CacheLimits;
  caches: CachePool[];
  /** Total cache budget in MB; the kernel reports it next to the per-pool budgets. */
  cache_memory_mb?: number;
}

export interface CacheUnit {
  label: string;
  unit: string;
  /** Display value = seconds / factor. */
  factor: number;
  step: number;
}

export const CACHE_FIELDS: readonly CacheField[] = ['max_entries', 'stale_ttl', 'save_interval'];

/** Fallback bounds, used only when the kernel omits a limit pair. */
const FALLBACK: CacheLimits = { max_entries: [128, 10000000], stale_ttl: [0, 2592000], save_interval: [60, 604800] };

export const CACHE_UNITS: Record<CacheField, CacheUnit> = {
  max_entries: { label: '最大记录数', unit: '条', factor: 1, step: 1 },
  stale_ttl: { label: '过期保留', unit: '小时', factor: 3600, step: 0.5 },
  save_interval: { label: '写盘间隔', unit: '分钟', factor: 60, step: 1 },
};

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function pair(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  const [min, max] = value;
  if (!isNumber(min) || !isNumber(max) || min > max) return fallback;
  return [min, max];
}

function pool(value: unknown): CachePool | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.key !== 'string' || !item.key || typeof item.tag !== 'string' || !item.tag) return null;
  for (const field of CACHE_FIELDS) {
    if (!isNumber(item[field]) || Number(item[field]) < 0) return null;
  }
  const raw = item.running;
  const running = raw && typeof raw === 'object' && !Array.isArray(raw) && CACHE_FIELDS.every(field => isNumber((raw as Record<string, unknown>)[field]))
    ? {
        max_entries: Number((raw as Record<string, unknown>).max_entries),
        stale_ttl: Number((raw as Record<string, unknown>).stale_ttl),
        save_interval: Number((raw as Record<string, unknown>).save_interval),
      }
    : null;
  return {
    key: item.key,
    tag: item.tag,
    max_entries: Number(item.max_entries),
    stale_ttl: Number(item.stale_ttl),
    save_interval: Number(item.save_interval),
    running,
    ...(isNumber(item.budget_bytes) && item.budget_bytes >= 0 ? { budget_bytes: Number(item.budget_bytes) } : {}),
  };
}

/**
 * Parse `/api/v1/cache/settings`. Returns null when the kernel only reports the
 * memory budget (FJGOE and older), so the page can hide the editor instead of
 * showing controls the core cannot accept.
 */
export function cacheSettings(value: unknown): CacheSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('缓存设置返回格式无效。', 0, null, 'contract');
  }
  const data = value as Record<string, unknown>;
  const rawLimits = data.limits;
  if (!rawLimits || typeof rawLimits !== 'object' || Array.isArray(rawLimits)) return null;
  const limits: CacheLimits = {
    max_entries: pair((rawLimits as Record<string, unknown>).max_entries, FALLBACK.max_entries),
    stale_ttl: pair((rawLimits as Record<string, unknown>).stale_ttl, FALLBACK.stale_ttl),
    save_interval: pair((rawLimits as Record<string, unknown>).save_interval, FALLBACK.save_interval),
  };
  const caches = (Array.isArray(data.caches) ? data.caches : []).map(pool).filter((item): item is CachePool => item !== null);
  if (!caches.length) throw new ApiError('缓存设置缺少缓存池信息。', 0, null, 'contract');
  return {
    restart_needed: data.restart_needed === true,
    limits,
    caches,
    ...(isNumber(data.cache_memory_mb) && data.cache_memory_mb >= 0 ? { cache_memory_mb: Number(data.cache_memory_mb) } : {}),
  };
}

export async function readCacheSettings(request: (path: string) => Promise<unknown>): Promise<CacheSettings | null> {
  try {
    return cacheSettings(await request('/api/v1/cache/settings'));
  } catch (error) {
    if (error instanceof ApiError && [404, 405, 501].includes(error.status)) return null;
    throw error;
  }
}

/** Seconds → the unit shown in the editor (hours or minutes), rounded to 2dp. */
export function toDisplay(field: CacheField, seconds: number): number {
  const { factor } = CACHE_UNITS[field];
  return factor === 1 ? Math.round(seconds) : Math.round((seconds / factor) * 100) / 100;
}

/** Editor unit → seconds, the value the kernel stores. */
export function fromDisplay(field: CacheField, value: number): number {
  const { factor } = CACHE_UNITS[field];
  return factor === 1 ? Math.round(value) : Math.round(value * factor);
}

/** Bounds converted to the editor's unit, snapped inward so the round trip stays valid. */
export function displayBounds(field: CacheField, limits: [number, number]): [number, number] {
  const { factor } = CACHE_UNITS[field];
  if (factor === 1) return limits;
  const [min, max] = limits;
  return [Math.ceil((min / factor) * 100) / 100, Math.floor((max / factor) * 100) / 100];
}

export interface CacheFormHelpers {
  cacheName: (tag: string) => string;
  esc: (value: unknown) => string;
  num: (value: number) => string;
}

/** Row selector shared by the dialog markup and its reader. */
export const cacheLimitRowSelector = (key: string): string => `tr[data-cache-key="${key}"]`;

/** Input selector shared by the dialog markup and its reader. */
export const cacheLimitInputSelector = (key: string, field: CacheField): string => `${cacheLimitRowSelector(key)} input[data-field="${field}"]`;

const BYTES_PER_MB = 1048576;

/**
 * Memory the kernel reserves for one pool and its share of the total budget.
 *
 * The kernel splits `cache_memory_mb` by each pool's `max_entries` weight, so a
 * bigger cap buys a bigger share. FJHAI ships 300k/200k/50k/50k, giving a new
 * installation weights of 6/4/1/1. The split is not a constant; an upgrade that
 * keeps its old caps keeps its old split.
 */
export function cacheBudget(cache: CachePool, totalMb?: number): { size: string; share: number | null } | null {
  const bytes = cache.budget_bytes;
  if (bytes === undefined || !Number.isFinite(bytes)) return null;
  const mb = bytes / BYTES_PER_MB;
  const total = totalMb !== undefined && totalMb > 0 ? totalMb * BYTES_PER_MB : null;
  return {
    size: mb >= 100 ? String(Math.round(mb)) : mb.toFixed(1),
    share: total === null ? null : Math.round((bytes / total) * 100),
  };
}

/** Dialog body for the four cache pools; one row per pool, one input per field. */
export function cacheLimitsForm(settings: CacheSettings, helpers: CacheFormHelpers): string {
  const { cacheName, esc, num } = helpers;
  const header = CACHE_FIELDS.map(field => {
    const unit = CACHE_UNITS[field];
    return `<th scope="col">${unit.label}<span class="cache-limit-unit">${unit.unit}</span></th>`;
  }).join('');
  const rows = settings.caches.map(cache => {
    const cells = CACHE_FIELDS.map(field => {
      const unit = CACHE_UNITS[field];
      const [min, max] = displayBounds(field, settings.limits[field]);
      const label = `${unit.label}（${unit.unit}）`;
      return `<td data-label="${label}"><input type="number" inputmode="decimal" data-field="${field}" min="${min}" max="${max}" step="${unit.step}" required value="${toDisplay(field, cache[field])}" aria-label="${esc(cacheName(cache.tag))} ${label}"></td>`;
    }).join('');
    const budget = cacheBudget(cache, settings.cache_memory_mb);
    const budgetText = budget
      ? `<span class="cache-limit-budget" title="内存预算按各池记录上限的比例分配，改上限并重启内核后重新计算">预算 ${budget.size} MB${budget.share === null ? '' : ` · ${budget.share}%`}</span>`
      : '';
    const pending = poolPending(cache) ? '<span class="badge pink cache-limit-pending">待重启</span>' : '';
    return `<tr data-cache-key="${esc(cache.key)}"><th scope="row"><span class="cache-limit-name">${esc(cacheName(cache.tag))}</span><code class="cache-limit-key">${esc(cache.key)}</code>${budgetText}${pending}</th>${cells}</tr>`;
  }).join('');
  const [minEntries, maxEntries] = settings.limits.max_entries;
  const [minTtl, maxTtl] = displayBounds('stale_ttl', settings.limits.stale_ttl);
  const [minSave, maxSave] = displayBounds('save_interval', settings.limits.save_interval);
  const budgetNote = settings.caches.some(cache => cacheBudget(cache, settings.cache_memory_mb))
    ? `<p class="form-note">内存预算按各池记录上限的比例分配${settings.cache_memory_mb ? `（当前 ${settings.cache_memory_mb} MB）` : ''}：上限越大分到的预算越多，改上限后要重启内核才按新比例重新分配。</p>`
    : '';
  const memoryEditor = settings.cache_memory_mb === undefined ? '' : `<div class="cache-memory-editor"><label class="field" for="cache-memory-mb">总缓存内存预算（MB）<input id="cache-memory-mb" type="number" inputmode="numeric" min="0" step="1" required value="${settings.cache_memory_mb}" aria-describedby="cache-memory-help"></label><p class="form-note" id="cache-memory-help">0 表示不限内存，仅受记录上限约束。预算保存后立即生效；以下各池预算显示当前运行分配。</p></div>`;
  return `<div class="cache-limit-editor">${memoryEditor}
      <div class="table-wrap"><table class="cache-limit-table"><thead><tr><th scope="col">缓存池</th>${header}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="form-note">取值范围：记录数 ${num(minEntries)}–${num(maxEntries)} 条；过期保留 ${minTtl}–${maxTtl} 小时；写盘间隔 ${minSave}–${maxSave} 分钟。</p>
      <p class="form-note">各池参数保存后，若与运行值不同会标记「待重启」。请用系统页的「重启内核」应用；总内存预算单独保存并立即生效。</p>
      ${budgetNote}
    </div>`;
}

/** Read the dialog inputs through `read` and validate them into a kernel payload. */
export function readCacheLimits(settings: CacheSettings, read: (key: string, field: CacheField) => string): Record<string, Record<CacheField, number>> {
  const values: Record<string, Record<CacheField, number>> = {};
  for (const cache of settings.caches) {
    values[cache.key] = {} as Record<CacheField, number>;
    for (const field of CACHE_FIELDS) {
      const raw = read(cache.key, field).trim();
      if (!raw) throw new Error(`请填写「${cache.tag}」的${CACHE_UNITS[field].label}。`);
      const n = Number(raw);
      if (field === 'max_entries' && !Number.isInteger(n)) throw new Error(`「${cache.tag}」的最大记录数必须是整数。`);
      // An unchanged rounded display value must not alter the stored seconds.
      values[cache.key][field] = n === toDisplay(field, cache[field]) ? cache[field] : fromDisplay(field, n);
    }
  }
  return buildCacheLimits(settings, values);
}

export function poolPending(cache: CachePool): boolean {
  if (!cache.running) return false;
  return CACHE_FIELDS.some(field => cache.running![field] !== cache[field]);
}

/**
 * Build the `/api/v1/cache/limits` body. The kernel requires every cache group
 * in one request and rejects the whole call when one field is out of range.
 */
export function buildCacheLimits(settings: CacheSettings, values: Record<string, Record<CacheField, number>>): Record<string, Record<CacheField, number>> {
  const payload: Record<string, Record<CacheField, number>> = {};
  for (const cache of settings.caches) {
    const row = values[cache.key];
    if (!row) throw new Error(`缺少「${cache.tag}」的参数。`);
    const next = {} as Record<CacheField, number>;
    for (const field of CACHE_FIELDS) {
      const value = row[field];
      const unit = CACHE_UNITS[field];
      const [min, max] = settings.limits[field];
      if (!Number.isFinite(value) || Math.round(value) !== value) throw new Error(`「${cache.tag}」的${unit.label}必须是整数秒。`);
      if (value < min || value > max) {
        throw new Error(`「${cache.tag}」的${unit.label}应在 ${toDisplay(field, min)}–${toDisplay(field, max)} ${unit.unit}之间。`);
      }
      next[field] = value;
    }
    payload[cache.key] = next;
  }
  return payload;
}

export function readCacheMemory(raw: string): number {
  const value = Number(raw.trim());
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value * BYTES_PER_MB)) throw new Error('总缓存内存预算请输入可精确表示的非负整数 MB，0 表示不限内存。');
  return value;
}

type LimitsPayload = Record<string, Record<CacheField, number>>;
export interface CacheSaveClient {
  read: () => Promise<CacheSettings | null>;
  write: (path: string, body: unknown) => Promise<unknown>;
}

/** Re-read on every attempt so a partially successful save is safe to retry. */
export async function saveCacheSettings(client: CacheSaveClient, limits: LimitsPayload, memory?: number): Promise<{settings: CacheSettings; changed: boolean}> {
  const current = await client.read();
  if (!current) throw new Error('当前内核未提供缓存参数，请重新打开窗口。');
  const payload = buildCacheLimits(current, limits);
  if (memory !== undefined) readCacheMemory(String(memory));
  const limitsChanged = current.caches.some(cache => CACHE_FIELDS.some(field => cache[field] !== payload[cache.key][field]));
  const memoryChanged = memory !== undefined && memory !== current.cache_memory_mb;
  if (memoryChanged && current.cache_memory_mb === undefined) throw new Error('内核未返回总内存预算，请重新打开窗口。');
  const saved: string[] = [];
  let pending = '总内存预算';
  try {
    if (memoryChanged) { await client.write('/api/v1/cache/settings', {cache_memory_mb: memory}); saved.push('总内存预算'); }
    pending = '各池参数';
    if (limitsChanged) { await client.write('/api/v1/cache/limits', payload); saved.push('各池参数'); }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${saved.length ? `已保存${saved.join('、')}；` : ''}${pending}保存未确认：${reason}。再次保存会先读取当前值，只提交尚未生效的修改。`, {cause:error});
  }
  if (!saved.length) return {settings:current,changed:false};
  let next: CacheSettings | null;
  try { next = await client.read(); } catch (error) {
    throw new Error(`已提交${saved.join('、')}，但回读失败，暂无法确认结果。再次保存会先核对当前值。`, {cause:error});
  }
  if (!next || (memoryChanged && next.cache_memory_mb !== memory) || next.caches.some(cache => !payload[cache.key] || CACHE_FIELDS.some(field => cache[field] !== payload[cache.key][field]))) {
    throw new Error('保存后回读值与提交值不一致，请重新读取缓存参数确认。');
  }
  return {settings:next,changed:true};
}
