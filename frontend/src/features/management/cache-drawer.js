import { openDrawer } from '../../shared/components/drawer.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { parseCacheDetail, cacheDetailHtml, cacheDetailRows, filterCacheEntries } from './cache-detail';

export function openCacheDrawer(name, text) {
  const detail = parseCacheDetail(text);
  openDrawer(name, '缓存条目与内存使用 · 打开时的快照', cacheDetailHtml(detail));
  if (!detail.supported) return;
  const root = document.querySelector('#drawer-content');
  const search = root.querySelector('[data-cache-search]');
  const results = root.querySelector('[data-cache-results]');
  let page = 0;
  const paint = () => {
    setHTML(results, cacheDetailRows(filterCacheEntries(detail.entries, search.value), page));
    results.querySelector('[data-cache-prev]').onclick = () => { page--; paint(); results.querySelector('[data-cache-prev]').focus(); };
    results.querySelector('[data-cache-next]').onclick = () => { page++; paint(); results.querySelector('[data-cache-next]').focus(); };
  };
  search.oninput = () => { page = 0; paint(); };
  paint();
}
