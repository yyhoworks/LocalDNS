import { clientAliases } from '../logs/aliases.js';
import { currentScope } from '../../core/router/route-lifetime';
import { shellInterfaceService } from '../shell/interface.js';
import { overviewInsightsService } from './insights.js';
import { workspaceService } from '../../shared/workspace.js';
import { clientsService } from '../logs/clients.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { loadAliases, openAliasModal } from '../logs/aliases.js';
import { api } from '../../core/api/api.js';
import { safe } from '../../shared/async.js';
import { parseProm } from '../../shared/metrics/prometheus.ts';
import { parseSystem, parseCaches } from './model.js';
import { $, state, page, $$, storage, API_BASE } from '../../core/context.js';
import { compactNum, ms, pct, fullNum, rankCount, num, esc, startTimeMarkup, overviewUptimeMarkup, fmtBytesBrief, duration } from '../../shared/format/number.js';
import { aggregateSlowest, slowOverviewRowsHtml, openDomainDetailModal, openSlowDetailModal, openOutcomeDetail } from './details.js';
import { upstreamMetrics } from '../upstreams/errors.js';
import { icon } from '../../shared/components/icons.js';
import { getNodeIcon, drawTopoCurves } from './topology/graph.js';
import { trackRouteCleanup, navigate, renderRoute } from '../../core/router/router.js';
import { toast } from '../../shared/components/toast.js';
import { openDrawer } from '../../shared/components/drawer.js';
import { cacheName } from '../management/index.js';

  const cpuSample = {total:null, at:null};

  async function renderOverview(container, context){
 const renderScope = context.scope, page = container;

    await renderScope.guard(loadAliases(renderScope).catch(()=>{}));
    const switchTags = ['switch1','switch5','switch7','switch6','switch13','switch4','switch2','switch12'];
    const [stats,domains,clients,slowest,sets,metricsRaw,engineStatus,upCfg,switchVals] = await renderScope.guard(Promise.all([
      api.stats(),
      api.rank('domain',1000),
      api.rank('client',1000),
      api.rank('slowest',1000),
      api.rank('domain_set',64),
      api.metrics(),
      safe(()=>api.request('/api/v1/status'),{}),
      safe(()=>api.request('/api/v1/upstream/config'),{}),
      Promise.all(switchTags.map(t=>safe(()=>api.request(`/plugins/${t}/show`),'B')))
    ]));
    const sw = Object.fromEntries(switchTags.map((t,i)=>[t, String(switchVals[i]||'').trim().toUpperCase()]));
    const enabledCount = Object.values(sw).filter(v => v === 'A').length;

    const metrics = parseProm(metricsRaw), sys = parseSystem(metrics), caches = parseCaches(metrics);
    // 品牌区版本标签按外观设置显示（hidden/custom 时不覆盖用户选择）
    if (sys.version && $('#brand-version-tag')) $('#brand-version-tag').dataset.backendVersion = sys.version;
    if (sys.version && $('#brand-version-tag') && (document.documentElement.dataset.brandVerMode || 'version') === 'version') $('#brand-version-tag').textContent = sys.version;

    // 更新右下角实时状态胶囊
    if ($('#float-stat-top')) $('#float-stat-top').textContent = `↑ 累计 ${compactNum(stats.total_queries)} 次`;
    if ($('#float-stat-bot')) $('#float-stat-bot').textContent = `↓ ${ms(stats.average_duration_ms)}`;

    const cacheDisabled = sw.switch13 === 'B';
    const lazyEnabled   = sw.switch4 === 'A';
    const cMain = caches.find(x=>x.tag==='cache_main') || {hit:0,lazy:0,q:0,h:0,size:0};
    const cDom  = caches.find(x=>x.tag==='cache_domestic') || {hit:0,lazy:0,q:0,h:0,size:0};
    const cFor  = caches.find(x=>x.tag==='cache_foreign') || {hit:0,lazy:0,q:0,h:0,size:0};
    const cEcs  = caches.find(x=>x.tag==='cache_foreign_ecs') || {hit:0,lazy:0,q:0,h:0,size:0};

    const totalCacheQ = caches.reduce((s,c)=>s+(c.q||0),0);
    const totalCacheH = caches.reduce((s,c)=>s+(c.h||0),0);
    const overallHitRate = cMain.q > 0 ? cMain.hit : (totalCacheQ > 0 ? (totalCacheH / totalCacheQ * 100) : 0);
    const cacheValue = cacheDisabled ? '已关闭' : pct(overallHitRate);

    const now = Date.now();
    let cpuPct = sys.uptime > 0 ? Math.max(0, sys.cpu / sys.uptime * 100) : 0;
    if (cpuSample.total != null && cpuSample.at != null && sys.cpu >= cpuSample.total && now > cpuSample.at) {
      cpuPct = Math.max(0, (sys.cpu - cpuSample.total) / ((now - cpuSample.at) / 1000) * 100);
    }
    cpuSample.total = sys.cpu; cpuSample.at = now;

    const adguardBlocked = Math.max(0, +engineStatus?.stats?.adguard_blocked || 0);
    const clientCount = Number.isFinite(+stats?.client_count) ? fullNum(+stats.client_count) : rankCount(clients);
    const domainCount = Number.isFinite(+stats?.domain_count) ? fullNum(+stats.domain_count) : rankCount(domains);
    shellInterfaceService?.recordMetrics({total:metrics.find(x=>x.name==='localdns_queries_total')?.value,latency:stats.average_duration_ms,cache:overallHitRate,cacheEnabled:!cacheDisabled,clients:stats.client_count??clients.length,domains:stats.domain_count??domains.length,blocked:adguardBlocked,start:sys.start});
    const outcomes = overviewInsightsService.distribution(sets);
    const allSets = outcomes.all;
    const ds = outcomes.shown;
    const slowGroups = aggregateSlowest(slowest, Infinity);

    // 客户端分流策略状态（对应真实 switch2 / switch12）
    const clientMode = sw.switch2 === 'A' ? 'fakeip' : (sw.switch12 === 'A' ? 'realip' : 'all');

    // === 构造五阶段全链路拓扑真实数据 ===
    const totalQ = Math.max(1, +stats.total_queries || 0);
    // Aliases only name recorded clients; never add inactive aliases as topology nodes.
    const topoClients = clientsService.topology(clients, clientAliases, stats.total_queries, compactNum);

    // 03 分流规则集（6 节点：对应真实 /api/v1/status rules 与 stats）
    const isClaude = document.documentElement.dataset.skin === 'claude';
    const rRules = engineStatus?.rules || {};
    const eStats = engineStatus?.stats || {};
    const topoRules = [
      { id: 'r1', tab: 'diversion', name: 'geosite_cn', sub: `国内大陆域名直连 · ${num(rRules.geosite_cn || 0)} 条规则`, val: compactNum(eStats.domestic || 0), iconColor: isClaude ? '#2D6A4F' : '#10B981', icon: 'globe' },
      { id: 'r2', tab: 'lists', name: 'whitelist / custom_cn', sub: `白名单与自定义国内 · ${num(rRules.force_domestic || 0)} 条规则`, val: `${num(rRules.force_domestic || 0)} 条`, iconColor: isClaude ? '#C96442' : '#60A5FA', icon: 'check' },
      { id: 'r3', tab: 'diversion', name: 'geosite_non_cn', sub: `海外无污染分流 · ${num(rRules.geosite_non_cn || 0)} 条规则`, val: compactNum((+eStats.foreign || 0) + (+eStats.foreign_ecs || 0)), iconColor: isClaude ? '#3D6B66' : '#14B8A6', icon: 'split' },
      { id: 'r4', tab: 'lists', name: 'force_fakeip / 灰名单', sub: `FakeIP 分流映射 · ${num(rRules.force_foreign_fakeip || 0)} 条规则`, val: compactNum(eStats.fakeip || 0), iconColor: isClaude ? '#B45309' : '#F59E0B', icon: 'spark' },
      { id: 'r5', tab: 'adguard', name: 'adguard_block', sub: `广告与追踪器拦截 · ${num(engineStatus?.adguard_rules || 0)} 条规则`, val: compactNum(adguardBlocked), iconColor: isClaude ? '#B91C1C' : '#EF4444', icon: 'shield' },
      { id: 'r6', tab: 'lists', name: 'block / 特殊类型清洗', sub: `黑名单与类型抑制 · ${num(rRules.block || 0)} 条规则`, val: compactNum(eStats.blocked || 0), iconColor: isClaude ? '#857F74' : '#94A3B8', icon: 'sliders' }
    ];

    // 提取真实配置的上游列表及性能指标
    const groupUpstreams = {};
    ['domestic', 'foreign', 'foreign_ecs', 'proxy'].forEach(g => {
      const list = (upCfg?.[g] || []).map(u => ({ g, u, m: upstreamMetrics(metrics, g, u.tag) }));
      groupUpstreams[g] = list;
    });
    const groupAvgMs = g => {
      const active = (groupUpstreams[g] || []).filter(x => x.u.enabled !== false && x.m.latency > 0);
      if (!active.length) return '就绪';
      const avg = active.reduce((s, x) => s + x.m.latency, 0) / active.length;
      return `${avg.toFixed(1)} ms`;
    };

    // 04 上游策略组（5 节点：对应真实 domestic / foreign / foreign_ecs / proxy / 拦截）
    const topoGroups = [
      { id: 'g1', code: 'CN', codeColor: isClaude ? '#2D6A4F' : '#34D399', codeBg: isClaude ? 'rgba(45,106,79,0.12)' : 'rgba(16,185,129,0.14)', name: '国内组 (domestic)', sub: `并发竞速 · ${groupAvgMs('domestic')} · ${num(eStats.domestic || 0)} 次` },
      { id: 'g2', code: 'GL', codeColor: isClaude ? '#3D6B66' : '#2DD4BF', codeBg: isClaude ? 'rgba(61,107,102,0.12)' : 'rgba(20,184,166,0.14)', name: '国外组 (foreign)', sub: `无污染解析 · ${groupAvgMs('foreign')} · ${num(eStats.foreign || 0)} 次` },
      { id: 'g3', code: 'ECS', codeColor: isClaude ? '#C96442' : '#93C5FD', codeBg: isClaude ? 'rgba(201,100,66,0.12)' : 'rgba(59,130,246,0.16)', name: '国外 ECS (foreign_ecs)', sub: `EDNS 子网 · ${groupAvgMs('foreign_ecs')} · ${num(eStats.foreign_ecs || 0)} 次` },
      { id: 'g4', code: 'PX', codeColor: isClaude ? '#B45309' : '#FBBF24', codeBg: isClaude ? 'rgba(180,83,9,0.12)' : 'rgba(245,158,11,0.15)', name: '代理组 (proxy)', sub: `远端解析 · ${groupAvgMs('proxy')} · ${num(eStats.fakeip || 0)} 次` },
      { id: 'g5', code: 'BLK', codeColor: isClaude ? '#B91C1C' : '#F87171', codeBg: isClaude ? 'rgba(185,28,28,0.12)' : 'rgba(239,68,68,0.15)', name: '本地拦截黑洞', sub: `0.0.0.0 / NXDOMAIN · ${num(eStats.blocked || 0)} 拦截` }
    ];

    // 05 上游 DNS 节点（6 节点：5 个真实上游 DNS + 第 6 个拦截直接响应节点）
    const allRealUps = [
      ...(groupUpstreams.domestic || []),
      ...(groupUpstreams.foreign || []),
      ...(groupUpstreams.foreign_ecs || []),
      ...(groupUpstreams.proxy || [])
    ].sort((a, b) => Number(b.u.enabled !== false) - Number(a.u.enabled !== false) || (b.m.win - a.m.win));

    // 优先保证国内、国外、ECS、代理各选代表节点展示在拓扑第 05 列
    const pickedUps = [];
    const pickFrom = (g, count) => {
      const candidates = (groupUpstreams[g] || []).slice().sort((a,b)=>Number(b.u.enabled!==false)-Number(a.u.enabled!==false)||(b.m.win-a.m.win));
      candidates.slice(0, count).forEach(x => { if (pickedUps.length < 5) pickedUps.push(x); });
    };
    pickFrom('domestic', 2);
    pickFrom('foreign', 1);
    pickFrom('foreign_ecs', 1);
    pickFrom('proxy', 1);
    allRealUps.forEach(x => { if (pickedUps.length < 5 && !pickedUps.includes(x)) pickedUps.push(x); });

    const groupToNodeId = { domestic: 'g1', foreign: 'g2', foreign_ecs: 'g3', proxy: 'g4' };
    const topoServers = pickedUps.map((item, idx) => {
      const { g, u, m } = item;
      const latTxt = m.latency > 0 ? `${m.latency.toFixed(1)} ms` : (u.enabled !== false ? '在线' : '未启用');
      const badgeTxt = m.q > 0 ? `${Math.round(m.adoption)}% 采纳` : (u.protocol || 'UDP').toUpperCase();
      const colorMap = isClaude ? {
        domestic: ['#2D6A4F', 'rgba(45,106,79,0.12)'],
        foreign: ['#3D6B66', 'rgba(61,107,102,0.12)'],
        foreign_ecs: ['#C96442', 'rgba(201,100,66,0.12)'],
        proxy: ['#B45309', 'rgba(180,83,9,0.12)']
      } : {
        domestic: ['#34D399', 'rgba(16,185,129,0.15)'],
        foreign: ['#2DD4BF', 'rgba(20,184,166,0.15)'],
        foreign_ecs: ['#93C5FD', 'rgba(59,130,246,0.16)'],
        proxy: ['#FBBF24', 'rgba(245,158,11,0.16)']
      };
      const [badgeColor, badgeBg] = colorMap[g] || ['#CBD5E1', 'rgba(148,163,184,0.14)'];
      return {
        id: `s${idx+1}`,
        groupNode: groupToNodeId[g] || 'g1',
        name: u.tag || `Upstream-${idx+1}`,
        sub: `${u.addr || u.server_addr || '—'} · ${latTxt}`,
        badge: badgeTxt,
        badgeColor,
        badgeBg,
        icon: 'server',
        muted: u.enabled === false
      };
    });
    topoServers.push({
      id: 's6',
      groupNode: 'g5',
      name: '拦截直接响应',
      sub: '零上游消耗 · 立即阻断',
      badge: `${compactNum(eStats.blocked || 0)} 阻断`,
      badgeColor: isClaude ? '#B91C1C' : '#F87171',
      badgeBg: isClaude ? 'rgba(185,28,28,0.12)' : 'rgba(239,68,68,0.16)',
      icon: 'shieldRed'
    });

    const cPrimary = isClaude ? '#C96442' : '#3B82F6';
    const cTeal = isClaude ? '#2D6A4F' : '#14B8A6';
    const cAmber = isClaude ? '#B45309' : '#F59E0B';
    const cGreen = isClaude ? '#2D6A4F' : '#10B981';
    const topoEdges = [
      ...topoClients.filter(c => !c.muted).map(c => [c.id, 'e_core', cPrimary]),

      ['e_core', 'r1', cTeal],
      ['e_core', 'r2', cPrimary],
      ['e_core', 'r3', cTeal],
      ['e_core', 'r4', cAmber],
      ['e_core', 'r5', cTeal],
      ['e_core', 'r6', cTeal],

      ['r1', 'g1', cTeal],
      ['r2', 'g1', cTeal],
      ['r3', 'g2', cTeal],
      ['r3', 'g3', cPrimary],
      ['r4', 'g4', cAmber],
      ['r5', 'g5', cTeal],
      ['r6', 'g5', cTeal],

      ...topoServers.map(s => [s.groupNode, s.id, cGreen])
    ].map(([from, to, color]) => ({
      from, to, color,
      muted: Boolean(topoClients.find(c => c.id === from)?.muted || topoServers.find(s => s.id === to)?.muted)
    }));

    // 分流结果占比环形图数据（基于真实 domain_set 排行 ds）
    const dsTotal = Math.max(1, outcomes.total);
    const outcomeColor = key => overviewInsightsService.color(key,isClaude?'claude':'glass');
    let dashOffset = 25;
    const ringCircles = ds.map(x => {
      const pctVal = Math.max(0, Math.min(100, (+x.count || 0) / dsTotal * 100));
      const circle = `<circle cx="21" cy="21" r="15.915" fill="transparent" stroke="${outcomeColor(x.key)}" stroke-width="4.8" stroke-dasharray="${pctVal.toFixed(4)} ${(100 - pctVal).toFixed(4)}" stroke-dashoffset="${dashOffset.toFixed(4)}"></circle>`;
      dashOffset -= pctVal;
      return circle;
    }).join('');

    const rankTab = state.overviewRankTab || 'client';
    const rankItems = (rankTab === 'client' ? (clients || []) : (domains || [])).slice(0, 4);
    const rankMax = Math.max(1, ...rankItems.map(x => +x.count || 0));

    setHTML(page, `
      <div class="view-title-row">
        <div style="display:flex;align-items:baseline;gap:12px">
          <h1>运行概览</h1>
          <span class="mono" style="font-size:12px;color:var(--text-3)">${esc([sys.version || engineStatus?.version || 'FJG20', sys.platform, sys.runtime !== '—' ? sys.runtime : ''].filter(Boolean).join(' · '))}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="button" class="glass-btn" id="btn-overview-custom-bg">自定义壁纸与玻璃</button>
        </div>
      </div>

      <section class="console-service-summary" aria-labelledby="service-summary-title">
        <div class="console-service-row">
          <div class="console-service-health">
            <span class="service-health-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path data-service-check d="m7 12 3 3 7-7"/></svg></span>
            <div class="service-health-copy">
              <div class="service-health-title"><h2 id="service-summary-title">DNS 服务运行中</h2><span class="service-connection">已连接</span></div>
              <p class="service-build mono">${esc([sys.version || engineStatus?.version || 'FJG20', sys.platform, sys.runtime !== '—' ? sys.runtime : ''].filter(Boolean).join(' · '))}</p>
            </div>
          </div>
          <div class="service-metric" data-service-metric="start"><div class="service-metric-label"><span>启动时间</span>${icon('clock')}</div><div class="service-value service-start-value">${startTimeMarkup(sys.start)}</div></div>
          <div class="service-metric" data-service-metric="uptime"><div class="service-metric-label"><span>运行时长</span>${icon('uptime')}</div><div class="service-value service-uptime-value">${sys.start?overviewUptimeMarkup(sys.uptime):'—'}</div></div>
          <div class="service-metric" data-service-metric="cpu"><div class="service-metric-label"><span>进程 CPU</span>${icon('cpu')}</div><div class="service-value" data-display-number>${metrics.some(m=>m.name==='process_cpu_seconds_total')?cpuPct.toFixed(1)+'%':'—'}</div></div>
          <div class="service-metric" data-service-metric="memory"><div class="service-metric-label"><span>内存占用</span>${icon('memory')}</div><div class="service-value" data-display-number>${metrics.some(m=>m.name==='process_resident_memory_bytes')?fmtBytesBrief(sys.rss):'—'}</div></div>
        </div>
      </section>

      <!-- 第一层：3 张等宽快捷控制条 (4 + 4 + 4 = 12列)，100% 绑定 LocalDNS 真实功能 -->
      <div class="col-4">
        <div class="glass-card control-bar-card">
          <div class="cb-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
            <span>客户端分流</span>
          </div>
          <div class="cb-right">
            <div class="seg-group" role="group" aria-label="客户端分流策略">
              <button type="button" class="seg-item ${clientMode==='all'?'active':''}" data-client-mode="all" title="所有客户端均按分流规则正常解析">全员分流</button>
              <button type="button" class="seg-item ${clientMode==='fakeip'?'active':''}" data-client-mode="fakeip" title="switch2：只允许指定客户端科学">指定 FakeIP</button>
              <button type="button" class="seg-item ${clientMode==='realip'?'active':''}" data-client-mode="realip" title="switch12：指定客户端不允许科学">指定 RealIP</button>
            </div>
            <button type="button" class="glass-btn" id="manage-alias">别名</button>
          </div>
        </div>
      </div>

      <div class="col-4">
        <div class="glass-card control-bar-card">
          <div class="cb-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span>缓存与过期</span>
          </div>
          <div class="cb-right">
            <div class="seg-group" role="group" aria-label="缓存功能开关">
              <button type="button" class="seg-item ${!cacheDisabled?'active':''}" id="btn-toggle-switch13" title="点击切换核心缓存 (switch13)">核心缓存 ${!cacheDisabled?'开':'关'}</button>
              <button type="button" class="seg-item ${lazyEnabled?'active':''}" id="btn-toggle-switch4" title="点击切换乐观过期缓存 (switch4)">过期缓存 ${lazyEnabled?'开':'关'}</button>
            </div>
            <button type="button" class="glass-btn" id="btn-flush-all-cache">清空</button>
          </div>
        </div>
      </div>

      <div class="col-4">
        <div class="glass-card control-bar-card">
          <div class="cb-label">
            <span class="dot-online" aria-hidden="true"></span>
            <span style="color:var(--text-1);font-weight:600">运行中 · ${duration(sys.uptime)}</span>
          </div>
          <div class="cb-right">
            <button type="button" class="glass-btn" id="btn-toggle-switch7" title="点击切换 AdGuard 广告屏蔽 (switch7)">AdGuard ${sw.switch7==='A'?'已开启':'已关闭'}</button>
            <span style="font-size:12px;color:var(--text-2);cursor:pointer" data-route="management">${enabledCount}/8 项开启 ›</span>
          </div>
        </div>
      </div>

      <!-- 第二层：6 张等宽微趋势指标卡 (2 × 6 = 12列)，100% 对应 LocalDNS 6 大真实指标 -->
      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="logs">
          <div class="sk-top"><span class="sk-title">累计请求</span><svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" aria-hidden="true"><path d="M12 3v14m0 0-4-4m4 4 4-4M4 21h16"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${num(stats.total_queries)}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">${cacheDisabled ? '缓存已关闭' : '缓存命中占 ' + pct(overallHitRate)}</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="management">
          <div class="sk-top"><span class="sk-title">缓存命中</span><svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" aria-hidden="true"><path d="M12 21V7m0 0-4 4m4-4 4 4M4 3h16"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${cacheValue}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">${caches.filter(c => (+c.q || 0) > 0).length} 个活跃缓存池</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" id="kpi-card-clients">
          <div class="sk-top"><span class="sk-title">客户端数</span><svg viewBox="0 0 24 24" fill="none" stroke="#14B8A6" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${clientCount}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">活跃来源 IP</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="rules">
          <div class="sk-top"><span class="sk-title">拦截请求</span><svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V7l-8-4Z"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${fullNum(adguardBlocked)}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">${pct(totalQ > 0 ? (adguardBlocked / totalQ) * 100 : 0)} 的请求被拦截</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="upstreams">
          <div class="sk-top"><span class="sk-title">平均响应</span><svg viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular" style="color:#F59E0B">${ms(stats.average_duration_ms)}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">当前浏览器会话采样</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" id="kpi-card-domains">
          <div class="sk-top"><span class="sk-title">域名统计</span><svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${domainCount}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">去重域名数</div>
        </div>
      </div>

      <!-- 第三层：UI 2026.10.16.1 的五阶段 DNS 解析路径布局 -->
      <div class="col-12">
        <section class="glass-card topology-glass-card" aria-label="实时 DNS 解析与分流全链路拓扑" title="流光仅示意拓扑路径，不代表单条 DNS 查询记录">
          <div class="topo-stage-wrap ${state.particles === false ? 'no-particles' : ''}" id="topo-stage-wrap">
            <svg class="topo-svg-overlay" id="topo-svg" aria-hidden="true"></svg>

            <div class="topo-grid">
              <div class="topo-col" data-col="1">
                <div class="topo-col-title"><span>01</span>客户端来源</div>
                <div class="topo-col-body">
                  ${topoClients.map(c => `
                    <div class="t-node" data-node-id="${c.id}" data-client-ip="${esc(c.ip)}">
                      <div class="tn-left">
                        <div class="tn-icon-box">${getNodeIcon(c.icon, '#94A3B8')}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc(c.name)}</div>
                          <div class="tn-sub">${esc(c.sub)}</div>
                        </div>
                      </div>
                      <span class="tn-val" style="color:${c.valColor}">${esc(c.val)}</span>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="topo-col" data-col="2">
                <div class="topo-col-title"><span>02</span>引擎与多级缓存</div>
                <div class="topo-col-body">
                  <div class="t-node t-engine-card" data-node-id="e_core" data-route="management">
                    <div>
                      <div class="tec-top">
                        <span class="tec-big tabular">${cacheDisabled ? '—' : overallHitRate.toFixed(1) + '%'}</span>
                        <span class="tec-badge">${compactNum(stats.total_queries)} 请求</span>
                      </div>
                      <div class="tec-desc">多级内存缓存命中 · ${cacheDisabled ? '核心缓存已关闭' : '4 个活跃缓存池'}</div>
                    </div>

                    <div class="tec-bars">
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">主缓存</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cMain.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cMain.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">国内池</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cDom.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cDom.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">国外池</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cFor.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cFor.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">ECS 池</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cEcs.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cEcs.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">乐观过期</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, Math.max(cMain.lazy, cDom.lazy))}%;background:#F59E0B"></div></div>
                        <span class="tec-bar-pct">${Math.max(cMain.lazy, cDom.lazy).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="topo-col" data-col="3">
                <div class="topo-col-title"><span>03</span>分流规则集</div>
                <div class="topo-col-body">
                  ${topoRules.map(r => `
                    <div class="t-node" data-node-id="${r.id}" data-rule-jump="${r.tab}">
                      <div class="tn-left">
                        <div class="tn-icon-box">${getNodeIcon(r.icon, r.iconColor)}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc(r.name)}</div>
                          <div class="tn-sub">${esc(r.sub)}</div>
                        </div>
                      </div>
                      <span class="tn-val">${esc(r.val)}</span>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="topo-col" data-col="4">
                <div class="topo-col-title"><span>04</span>上游策略组</div>
                <div class="topo-col-body">
                  ${topoGroups.map(g => `
                    <div class="t-node" data-node-id="${g.id}" data-route="upstreams">
                      <div class="tn-left">
                        <div class="tn-icon-box" style="color:${g.codeColor};background:${g.codeBg};border-color:${g.codeColor}33">${esc(g.code)}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc(g.name)}</div>
                          <div class="tn-sub">${esc(g.sub)}</div>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="topo-col" data-col="5">
                <div class="topo-col-title"><span>05</span>上游 DNS 节点</div>
                <div class="topo-col-body">
                  ${topoServers.map(s => `
                    <div class="t-node" data-node-id="${s.id}" data-route="upstreams">
                      <div class="tn-left">
                        <div class="tn-icon-box">${getNodeIcon(s.icon, '#94A3B8')}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc(s.name)}</div>
                          <div class="tn-sub">${esc(s.sub)}</div>
                        </div>
                      </div>
                      <span class="tn-pill" style="color:${s.badgeColor};background:${s.badgeBg}">${esc(s.badge)}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- 第四层：8列系统运行体征与实时流量趋势 + 4列分流结果占比 = 12列 -->
      <div class="col-8">
        <div class="glass-card">
          <div class="gc-head">
            <div class="gc-title">服务运行体征与查询吞吐监控</div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="tn-pill" style="color:#93C5FD;background:rgba(59,130,246,0.16)">启动于 ${startTimeMarkup(sys.start)}</span>
              <span class="tn-pill" style="color:#34D399;background:rgba(16,185,129,0.15)">在线 ${duration(sys.uptime)}</span>
            </div>
          </div>
          <div class="traffic-chart-body">
            <div class="console-chart-empty">正在积累趋势数据…</div>
            <div class="tc-metrics-side">
              <div class="tcm-row"><span>国内直连</span><strong>${num(eStats.domestic || 0)}</strong></div>
              <div class="tcm-row"><span>国外无污染</span><strong>${num((+eStats.foreign || 0) + (+eStats.foreign_ecs || 0))}</strong></div>
              <div class="tcm-row"><span>FakeIP 映射</span><strong>${num(eStats.fakeip || 0)}</strong></div>
              <div class="tcm-row"><span>平均耗时</span><strong>${ms(stats.average_duration_ms)}</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div class="col-4">
        <div class="glass-card">
          <div class="gc-head">
            <div><div class="gc-title">查询处理结果占比</div><p class="workspace-subline">当前保留日志 · 最终处理结果</p></div>
            <button type="button" class="glass-btn" id="outcome-detail-button">全部 ${allSets.length} 类</button>
          </div>
          <div class="outbound-donut-body">
            <div class="ring-wrap">
              <svg viewBox="0 0 42 42" width="124" height="124" aria-hidden="true">
                <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="rgba(148,163,184,0.14)" stroke-width="4.8"></circle>
                ${ringCircles}
              </svg>
              <div class="ring-center" title="${fullNum(outcomes.total)} 次查询">${compactNum(outcomes.total)}</div>
            </div>
            <div class="ring-legend">
              ${ds.map((x, i) => {
                const p = ((+x.count || 0) / dsTotal * 100).toFixed(1);
                return `<button type="button" class="rl-item outcome-item" data-outcome-index="${i}" title="${x.members?`展开其余 ${x.members.length} 类`:`${esc(x.key||'未分类')} · 点击查看查询日志`}">
                  <span class="rl-name"><i class="rl-dot" style="background:${outcomeColor(x.key)}"></i>${esc(x.label)}${x.members?`<small>（${x.members.length} 类）</small>`:''}</span>
                  <span class="mono" style="color:var(--text-2);text-align:right">${compactNum(x.count)}</span>
                  <span class="mono" style="color:var(--text-3);text-align:right">${p}%</span>
                </button>`;
              }).join('') || `<div style="color:var(--text-3);font-size:12px">暂无分流分类统计</div>`}
            </div>
          </div>
          <p class="overview-outcome-note">按查询次数排列；缓存命中不展开原始分流去向。${allSets.length>=64?'接口最多读取 64 类，当前占比仅覆盖已返回分类。':''}</p>
        </div>
      </div>

      <div class="col-12 workspace-rankings">
        ${workspaceService.rankings({domains:domains||[],clients:clients||[],sets:sets||[],total:stats.total_queries,aliases:clientAliases})}
      </div>

      <div class="col-12 overview-cache-panel">
        <div class="glass-card">
          <div class="gc-head">
            <div>
              <div class="gc-title-row">
                <div class="gc-title">多级缓存池状态</div>
                <span class="cache-status-pill ${cacheDisabled ? 'is-off' : 'is-on'}">${cacheDisabled ? '● 核心缓存已关闭' : '● 核心缓存运行中'}</span>
                <span class="cache-status-pill ${lazyEnabled ? 'is-lazy' : 'is-muted'}">乐观过期 ${lazyEnabled ? '开启' : '关闭'}</span>
              </div>
              <p class="workspace-subline cache-panel-subline">4 级独立缓存池实时命中率、请求量与驻留条目数 · 综合命中率 ${pct(overallHitRate)}</p>
            </div>
            <div class="cache-head-actions">
              <span class="gc-sub" style="cursor:pointer" data-route="management">缓存管理 ›</span>
            </div>
          </div>
          <div class="overview-cache-pools">
            ${[
              ['全部缓存 (cache_main)', 'cache_main', cMain],
              ['国内缓存 (cache_domestic)', 'cache_domestic', cDom],
              ['国外缓存 (cache_foreign)', 'cache_foreign', cFor],
              ['国外 ECS (cache_foreign_ecs)', 'cache_foreign_ecs', cEcs]
            ].map(([label, tag, c]) => {
              const info = overviewInsightsService?.poolInfo ? overviewInsightsService.poolInfo(tag) : { code: 'POOL', shortLabel: label, sub: tag, tone: 'main' };
              const hitClamped = Math.max(0, Math.min(100, +c.hit || 0));
              const lazyVal = Math.max(0, +c.lazy || 0);
              return `
              <div class="u-row-bar overview-cache-pool" data-pool-tag="${esc(tag)}" data-pool-tone="${esc(info.tone)}">
                <div class="cache-pool-body">
                  <div class="urb-head">
                    <span class="cache-pool-title-wrap" style="color:var(--text-1)">
                      <span class="cache-pool-code mono">${esc(info.code)}</span>
                      <span class="cache-pool-titles">
                        <strong class="cache-pool-short">${esc(info.shortLabel)}</strong>
                        <small class="cache-pool-sub">${esc(info.sub)}</small>
                      </span>
                    </span>
                    <span class="cache-pool-rate-wrap" style="color:var(--text-2)" aria-label="命中率 ${c.hit.toFixed(1)}%">
                      <span class="cache-pool-hit-num tabular">${c.hit.toFixed(1)}%</span> <small class="cache-pool-hit-unit" style="font-size:11px">命中率</small>
                      <span class="cache-pool-lazy-tag tabular" title="乐观过期缓存命中率 ${lazyVal.toFixed(1)}%">过期 ${lazyVal.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div class="urb-track" aria-hidden="true"><div class="urb-fill" style="width:${hitClamped.toFixed(1)}%"></div></div>
                  <dl class="overview-cache-facts"><div><dt>查询数</dt><dd>${num(c.q)}</dd></div><div><dt>命中数</dt><dd>${num(c.h)}</dd></div><div><dt>缓存条目</dt><dd>${num(c.size)}</dd></div></dl>
                  <div class="cache-pool-foot">
                    <span class="cache-pool-tag-mono mono">${esc(tag)}</span>
                    <div class="cache-pool-actions">
                      <button type="button" class="cache-pool-btn" data-overview-cache-view="${esc(tag)}" title="查看 ${esc(info.shortLabel)} 内容">查看</button>
                      <button type="button" class="cache-pool-btn is-danger" data-overview-cache-flush="${esc(tag)}" title="清空 ${esc(info.shortLabel)}">清空</button>
                    </div>
                  </div>
                </div>
              </div>`;
            }).join('')}
          </div>
          <p class="overview-outcome-note">命中率 = 命中数 ÷ 本池查询数；条目数为当前值。查询与命中计数来自核心运行指标，统计周期与审计日志不同。</p>
        </div>
      </div>

      <div class="col-12 overview-slow-panel">
        <div class="glass-card">
          <div class="gc-head">
            <div><div class="gc-title">慢查询排行</div><p class="workspace-subline">当前保留日志中耗时最高的最多 1,000 条样本 · 按域名与客户端合并，取最大耗时</p></div>
            <div class="overview-slow-tools"><label for="overview-slow-limit">显示条数</label><select id="overview-slow-limit">${[5,10,20].map(n=>`<option value="${n}" ${state.overviewSlowLimit===n?'selected':''}>${n} 条</option>`).join('')}</select><button type="button" class="glass-btn" id="slow-detail-button">详情</button></div>
          </div>
          <div class="overview-slow-table-wrap" tabindex="0" role="region" aria-label="慢查询列表，可滚动查看更多记录"><table class="overview-slow-table"><thead><tr><th scope="col">序号</th><th scope="col">域名</th><th scope="col">查询类型</th><th scope="col">客户端</th><th scope="col">最大耗时</th></tr></thead><tbody id="overview-slow-rows">${slowOverviewRowsHtml(slowGroups)}</tbody></table></div>
          <p class="overview-outcome-note" id="overview-slow-count">显示 ${Math.min(state.overviewSlowLimit,slowGroups.length)} / ${slowGroups.length} 组 · 点击域名查看对应查询日志</p>
        </div>
      </div>
    `);

    // 绘制发布版五阶段拓扑连线，并叠加可停止的流光示意。
    const topologyWrap = $('#topo-stage-wrap');
    const redraw = () => { if (topologyWrap?.isConnected && $('#topo-stage-wrap') === topologyWrap) drawTopoCurves(topoEdges); };
    requestAnimationFrame(() => requestAnimationFrame(redraw));
    const onResize = () => requestAnimationFrame(redraw);
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('localdns:layoutchange', onResize);
    trackRouteCleanup(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('localdns:layoutchange', onResize);
    });

    // 绑定拓扑节点点击事件
    $$('[data-client-ip]', page).forEach(el => {
      el.onclick = () => {
        const ip = el.dataset.clientIp;
        if (ip) { state.logs.client = ip; state.logs.page = 1; }
        navigate('logs');
      };
    });
    $$('[data-rule-jump]', page).forEach(el => {
      el.onclick = async () => {
        const tab = el.dataset.ruleJump;
        await navigate('rules');
        if(state.route!=='rules')return;
        const btn = $(`[data-rule-tab="${tab}"]`);
        if (btn) btn.click();
      };
    });

    // 绑定第一层真实控制条事件
    if ($('#btn-overview-custom-bg')) {
      $('#btn-overview-custom-bg').onclick = e => {
        e.stopPropagation();
        $('#btn-open-bg-customizer')?.click();
      };
    }

    $$('[data-client-mode]', page).forEach(btn => {
      btn.onclick = async () => {
        const m = btn.dataset.clientMode;
        try {
          if (m === 'all') {
            await Promise.all([
              api.json('/plugins/switch2/post', 'POST', { value: 'B' }),
              api.json('/plugins/switch12/post', 'POST', { value: 'B' })
            ]);
            toast('已切换为全员分流模式');
          } else if (m === 'fakeip') {
            await api.json('/plugins/switch2/post', 'POST', { value: 'A' });
            await api.json('/plugins/switch12/post', 'POST', { value: 'B' });
            toast('已启用：指定 Client FakeIP');
          } else if (m === 'realip') {
            await api.json('/plugins/switch12/post', 'POST', { value: 'A' });
            await api.json('/plugins/switch2/post', 'POST', { value: 'B' });
            toast('已启用：指定 Client RealIP');
          }
          renderRoute(true, true);
        } catch (e) {
          toast('切换失败', 'error', e.message);
        }
      };
    });

    const bindSwitchBtn = (sel, tag, curVal, label) => {
      const el = $(sel);
      if (!el) return;
      el.onclick = async () => {
        const nextVal = curVal === 'A' ? 'B' : 'A';
        try {
          await api.json(`/plugins/${tag}/post`, 'POST', { value: nextVal });
          toast(`${label}已${nextVal === 'A' ? '开启' : '关闭'}`);
          renderRoute(true, true);
        } catch (e) {
          toast('操作失败', 'error', e.message);
        }
      };
    };
    bindSwitchBtn('#btn-toggle-switch13', 'switch13', sw.switch13, '核心缓存');
    bindSwitchBtn('#btn-toggle-switch4', 'switch4', sw.switch4, '乐观过期缓存');
    bindSwitchBtn('#btn-toggle-switch7', 'switch7', sw.switch7, 'AdGuard 广告拦截');

    if ($('#btn-flush-all-cache')) {
      $('#btn-flush-all-cache').onclick = async () => {
        if (!confirm('确定清空全部 DNS 缓存？将同时清空全部、国内、国外与国外 ECS 缓存。')) return;
        const ct = ['cache_main', 'cache_domestic', 'cache_foreign', 'cache_foreign_ecs'];
        await Promise.allSettled(ct.map(t => api.request(`/plugins/${t}/flush`)));
        toast('全部 4 个 DNS 缓存池已清空');
        renderRoute(true, true);
      };
    }

    workspaceService.bindRanks(page,{domains:domains||[],clients:clients||[],sets:sets||[],aliases:clientAliases});
    // 绑定排行维度切换与详情弹窗
    $$('[data-rank-tab]', page).forEach(btn => {
      btn.onclick = () => {
        state.overviewRankTab = btn.dataset.rankTab;
        renderRoute(true, true);
      };
    });
    $$('[data-overview-cache-view]', page).forEach(btn => {
      btn.onclick = async () => {
        const tag = btn.dataset.overviewCacheView;
        try {
          const text = await api.request(`/plugins/${tag}/show`);
          openDrawer(cacheName(tag), '缓存内容', `<pre>${esc(text)}</pre>`);
        } catch (e) {
          toast('查看缓存失败', 'error', e.message);
        }
      };
    });
    $$('[data-overview-cache-flush]', page).forEach(btn => {
      btn.onclick = async () => {
        const tag = btn.dataset.overviewCacheFlush;
        if (!confirm(`确定清空 ${cacheName(tag)}？`)) return;
        try {
          await api.request(`/plugins/${tag}/flush`);
          toast(`${cacheName(tag)}已清空`);
          renderRoute(true, true);
        } catch (e) {
          toast('清空缓存失败', 'error', e.message);
        }
      };
    });
    if ($('#manage-alias')) $('#manage-alias').onclick = openAliasModal;
    if ($('#kpi-card-clients')) $('#kpi-card-clients').onclick = openAliasModal;
    if ($('#kpi-card-domains')) $('#kpi-card-domains').onclick = () => openDomainDetailModal(domains || []);
    if ($('#domain-detail-button')) {
      $('#domain-detail-button').onclick = () => {
        if ((state.overviewRankTab || 'client') === 'client') openAliasModal();
        else openDomainDetailModal(domains || []);
      };
    }
    if ($('#slow-detail-button')) $('#slow-detail-button').onclick = () => openSlowDetailModal(slowGroups);
    const bindSlowRows=()=>$$('[data-slow-record]',page).forEach(button=>button.onclick=()=>{
      const row=slowGroups[Number(button.dataset.slowRecord)];
      Object.assign(state.logs,{page:1,q:row.query_name,exact:true,type:'',set:'',code:'',client:row.client_ip});navigate('logs');
    });
    bindSlowRows();
    $('#overview-slow-limit').onchange=event=>{
      const limit=Number(event.target.value);if(![5,10,20].includes(limit))return;
      state.overviewSlowLimit=limit;storage.set('localdns-overview-slow-limit:'+(API_BASE||location.host),limit);
      setHTML($('#overview-slow-rows'), slowOverviewRowsHtml(slowGroups));
      $('#overview-slow-count').textContent=`显示 ${Math.min(limit,slowGroups.length)} / ${slowGroups.length} 组 · 点击域名查看对应查询日志`;
      bindSlowRows();
    };
    $('#outcome-detail-button').onclick=()=>openOutcomeDetail(allSets,outcomes.total);
    $$('[data-outcome-index]',page).forEach(button=>button.onclick=()=>{
      const row=ds[Number(button.dataset.outcomeIndex)];
      if(row.members)return openOutcomeDetail(row.members,outcomes.total,true);
      Object.assign(state.logs,{page:1,q:'',exact:false,type:'',set:row.key,code:'',client:''});navigate('logs');
    });
    workspaceService.topology(page,redraw,sets);
  }
export { renderOverview };
