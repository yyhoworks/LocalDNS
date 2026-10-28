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
}

export interface CacheSettings {
  restart_needed: boolean;
  limits: CacheLimits;
  caches: CachePool[];
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
  return { restart_needed: data.restart_needed === true, limits, caches };
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
    const pending = poolPending(cache) ? '<span class="badge pink cache-limit-pending">待重启</span>' : '';
    return `<tr data-cache-key="${esc(cache.key)}"><th scope="row"><span class="cache-limit-name">${esc(cacheName(cache.tag))}</span><code class="cache-limit-key">${esc(cache.key)}</code>${pending}</th>${cells}</tr>`;
  }).join('');
  const [minEntries, maxEntries] = settings.limits.max_entries;
  const [minTtl, maxTtl] = displayBounds('stale_ttl', settings.limits.stale_ttl);
  const [minSave, maxSave] = displayBounds('save_interval', settings.limits.save_interval);
  return `<div class="cache-limit-editor">
      <div class="table-wrap"><table class="cache-limit-table"><thead><tr><th scope="col">缓存池</th>${header}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="form-note">取值范围：记录数 ${num(minEntries)}–${num(maxEntries)} 条；过期保留 ${minTtl}–${maxTtl} 小时；写盘间隔 ${minSave}–${maxSave} 分钟。</p>
      <p class="form-note">记录上限在缓存启动时分配，保存后若内核提示需要重启，请用上方「重启内核」应用新上限；过期保留与写盘间隔保存后即可生效。</p>
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
      values[cache.key][field] = fromDisplay(field, Number(raw));
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
