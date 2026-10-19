const overviewInsightsService = (() => {
  'use strict';
  const names = {
    cache_main: '主缓存命中', cache_domestic: '国内缓存命中',
    cache_foreign: '国外缓存命中', cache_foreign_ecs: '国外 ECS 缓存命中',
    blocked_qtype: '查询类型屏蔽', blocked_nodata: '无结果请求屏蔽',
    client_direct: '客户端直连', geosite_non_cn: '非国内规则命中',
    whitelist: '白名单命中', greylist: '灰名单命中', blocked: '请求屏蔽',
    learned_realip: '已学习 RealIP', learned_fakeip: '已学习 FakeIP',
    geosite_cn: '国内规则命中', custom_cn: '自定义国内规则',
    custom_non_cn: '自定义非国内规则', unknown_fakeip: '未知域名 FakeIP',
    geosite_cn_nodata: '国内规则无记录', geosite_cn_unverified: '国内规则待验证',
    geosite_cn_conflict_fakeip: '国内规则冲突 FakeIP',
    client_direct_upstream_error: '客户端直连上游错误',
    unknown_noaddr: '未知域名无地址', foreign_other: '其他国外结果'
  };
  const tones = {
    cache_main: 0, blocked_qtype: 2, blocked_nodata: 4, client_direct: 1,
    geosite_non_cn: 3, geosite_cn: 1, whitelist: 1, greylist: 3,
    blocked: 4, learned_realip: 1, learned_fakeip: 3, __other__: 5
  };
  const palettes = {
    glass: ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b'],
    claude: ['#3b6d9b', '#2d6a4f', '#b45309', '#87619e', '#b91c1c', '#857f74']
  };
  const pools = {
    cache_main: { code: 'MAIN', short: '全部缓存', shortLabel: '全部缓存', sub: '最终结果主缓存池', tag: 'cache_main', full: '全部缓存 (cache_main)', tone: 'main' },
    cache_domestic: { code: 'CN', short: '国内缓存', shortLabel: '国内缓存', sub: '大陆域名直连缓存', tag: 'cache_domestic', full: '国内缓存 (cache_domestic)', tone: 'domestic' },
    cache_foreign: { code: 'GL', short: '国外缓存', shortLabel: '国外缓存', sub: '海外无污染缓存', tag: 'cache_foreign', full: '国外缓存 (cache_foreign)', tone: 'foreign' },
    cache_foreign_ecs: { code: 'ECS', short: '国外 ECS', shortLabel: '国外 ECS', sub: 'EDNS 子网缓存', tag: 'cache_foreign_ecs', full: '国外 ECS (cache_foreign_ecs)', tone: 'ecs' }
  };
  const label = key => names[key] || String(key || '未分类');
  function color(key, skin) {
    const hash = [...String(key)].reduce((value, ch) => (value * 31 + ch.charCodeAt(0)) >>> 0, 0);
    return (palettes[skin] || palettes.glass)[tones[key] ?? hash % 5];
  }
  function distribution(items, visible = 6) {
    const counts = new Map();
    for (const row of Array.isArray(items) ? items : []) {
      const count = Number(row?.count), key = String(row?.key || '');
      if (Number.isFinite(count) && count > 0) counts.set(key, (counts.get(key) || 0) + count);
    }
    const all = [...counts].map(([key, count]) => ({key, count, label: label(key)}))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const total = all.reduce((sum, row) => sum + row.count, 0);
    const shown = all.length > visible
      ? [...all.slice(0, visible - 1), {key: '__other__', label: '其他',
        count: all.slice(visible - 1).reduce((sum, row) => sum + row.count, 0),
        members: all.slice(visible - 1)}]
      : all;
    return {all, total, shown};
  }
  function latencyTier(durationMs) {
    const v = Number(durationMs) || 0;
    if (v > 500) return 'critical';
    if (v >= 300) return 'warn';
    if (v >= 150) return 'moderate';
    return 'fast';
  }
  function poolInfo(tag) {
    const t = String(tag || '缓存池');
    return pools[tag] || { code: 'POOL', short: t, shortLabel: t, sub: t, tag: t, full: t, tone: 'main' };
  }
  return {label, color, distribution, latencyTier, poolInfo};

})();
export { overviewInsightsService };
export function initialize() {}
