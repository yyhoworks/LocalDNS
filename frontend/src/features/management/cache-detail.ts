import { esc, num } from '../../shared/format/number.js';

export interface CacheEntry { domain: string; type: string; fresh: number | null; retained: number | null }
export interface CacheDetail { raw: string; supported: boolean; summary: Record<string, number>; entries: CacheEntry[]; unparsed: number }
const types: Record<number, string> = {1:'A',2:'NS',5:'CNAME',6:'SOA',12:'PTR',15:'MX',16:'TXT',28:'AAAA',33:'SRV',64:'SVCB',65:'HTTPS',255:'ANY'};
const integer = (value?: string): number | null => value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

/** Parse only known fields; retain the untouched response for inspection/future cores. */
export function parseCacheDetail(value: unknown): CacheDetail {
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
  const lines = raw.trim().split(/\r?\n/), summary: Record<string, number> = {};
  for (const match of lines[0].matchAll(/(?:^|\s)(\w+)=(\S+)/g)) {
    const n = integer(match[2]); if (n !== null) summary[match[1]] = n;
  }
  const supported = ['entries','capacity'].every(key => summary[key] !== undefined);
  const entries: CacheEntry[] = []; let unparsed = 0;
  if (supported) for (const line of lines.slice(1).filter(line => line.trim())) {
    const parts = line.split('\t');
    if (parts.length < 2 || !parts[0] || integer(parts[1]) === null) { unparsed++; continue; }
    const fields = Object.fromEntries(parts.slice(2).map(p => p.split('=')));
    const seconds = (key: string) => /^\d+s$/.test(fields[key] || '') ? integer(fields[key].slice(0, -1)) : null;
    entries.push({domain:parts[0],type:types[Number(parts[1])] || `TYPE${parts[1]}`,fresh:seconds('fresh'),retained:seconds('retained')});
  }
  return {raw,supported,summary,entries,unparsed};
}

export function filterCacheEntries(entries: CacheEntry[], query: string): CacheEntry[] {
  const term = query.trim().toLowerCase();
  return term ? entries.filter(row => `${row.domain} ${row.type}`.toLowerCase().includes(term)) : entries;
}

const count = (value?: number) => value === undefined ? '—' : num(value);
const memory = (value?: number) => value === undefined ? '—' : `${(value / 1048576).toFixed(2)} MB`;
const duration = (value: number | null | undefined) => value == null ? '—' : value >= 86400 ? `${(value / 86400).toFixed(1)} 天` : value >= 3600 ? `${(value / 3600).toFixed(1)} 小时` : value >= 60 ? `${Math.floor(value / 60)} 分钟` : `${value} 秒`;

export function cacheDetailHtml(detail: CacheDetail): string {
  if (!detail.supported) return `<p class="form-note">当前内核返回了其他格式，以下显示原始内容。</p><pre class="cache-detail-raw">${esc(detail.raw)}</pre>`;
  const s = detail.summary;
  const facts = [['条目 / 上限',`${count(s.entries)} / ${count(s.capacity)}`],['占用 / 预算',`${memory(s.bytes)} / ${s.budget === 0 ? '不限内存' : memory(s.budget)}`],['过期保留',duration(s.stale_ttl_seconds)],['请求 / 命中 / 过期命中',`${count(s.queries)} / ${count(s.hits)} / ${count(s.lazy_hits)}`]];
  return `<div class="cache-detail"><dl class="cache-detail-summary">${facts.map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    <p class="form-note">内核返回 ${num(detail.entries.length)} 条明细${s.entries > detail.entries.length ? `（缓存共 ${num(s.entries)} 条，搜索仅覆盖返回的明细）` : ''}。${detail.unparsed ? `另有 ${num(detail.unparsed)} 行未识别，可查看原始内容。` : ''}</p>
    <label class="field cache-detail-search">搜索域名或记录类型<input type="search" data-cache-search placeholder="例如 example.com 或 AAAA" autocomplete="off"></label>
    <div data-cache-results></div><details class="cache-detail-source"><summary>原始内容</summary><pre class="cache-detail-raw">${esc(detail.raw)}</pre></details></div>`;
}

export const CACHE_DETAIL_PAGE_SIZE = 50;
export function cacheDetailRows(entries: CacheEntry[], page = 0): string {
  const pages = Math.max(1, Math.ceil(entries.length / CACHE_DETAIL_PAGE_SIZE));
  const current = Math.min(Math.max(0, page), pages - 1);
  const rows = entries.slice(current * CACHE_DETAIL_PAGE_SIZE, (current + 1) * CACHE_DETAIL_PAGE_SIZE);
  return `<div class="table-wrap"><table class="cache-detail-table"><thead><tr><th scope="col">域名</th><th scope="col">类型</th><th scope="col">新鲜期剩余</th><th scope="col">保留期剩余</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.domain)}</td><td>${esc(row.type)}</td><td>${row.fresh === 0 ? '已过期' : duration(row.fresh)}</td><td>${duration(row.retained)}</td></tr>`).join('') || '<tr><td colspan="4">没有匹配的缓存条目</td></tr>'}</tbody></table></div>
    <div class="cache-detail-pages"><span role="status">${num(entries.length)} 条 · ${current + 1} / ${pages} 页</span><button type="button" class="button small" data-cache-prev ${current === 0 ? 'disabled' : ''}>上一页</button><button type="button" class="button small" data-cache-next ${current >= pages - 1 ? 'disabled' : ''}>下一页</button></div>`;
}
