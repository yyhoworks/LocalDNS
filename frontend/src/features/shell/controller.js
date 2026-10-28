import { sharedUIService } from '../../core/persistence/shared-ui.js';
import { appEvents } from '../../core/events/event-bus';
import { typographyService } from '../appearance/typography.js';
import { skinService } from '../appearance/skin.js';
import { shellInterfaceService } from './interface.js';
import { wallpaperService } from '../appearance/wallpaper.js';
import { topologyFlowService } from '../overview/topology/flow.js';
import { workspaceService } from '../../shared/workspace.js';
import { collectionsService } from '../../shared/components/collection-layouts.js';
import { proxyPanelService } from '../proxy-panel/index.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { $, CONFIG, $$, state, storage, API_BASE, reduceMotion } from '../../core/context.js';
import { icon } from '../../shared/components/icons.js';
import { toast } from '../../shared/components/toast.js';
import { closeDrawer } from '../../shared/components/drawer.js';
import { modalClose } from '../../shared/components/dialog.js';
import { modalOpen } from '../../shared/components/dialog.js';
import { openDrawer } from '../../shared/components/drawer.js';
import { navigate, renderRoute, trackRouteCleanup } from '../../core/router/router.js';
import { routeDefs } from '../../core/router/routes.js';
import { isPendingRestart } from './pending-restart.js';
import { restartService } from '../management/index.js';
import { closeSlowTypePopover } from '../overview/details.js';
import { syncAllSegThumbs, copyToClipboard } from '../../shared/components/motion.js';
import { api } from '../../core/api/api.js';
import { downloadText } from '../../shared/downloads.js';
import { ms, pct, fmtDate } from '../../shared/format/number.js';
import { groupName } from '../upstreams/groups.js';
import { closeUpstreamErrorPopover } from '../upstreams/errors.js';
import { loadAliases } from '../logs/aliases.js';

  // 侧栏按 routeDefs 分组渲染：分组名与菜单项只在 routes.js 里定义一处，
  // 这里不再硬编码分组，新增路由只要改 routeDefs 就会自动出现在侧栏。
  const navIcons = {
    overview: '<svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 14a4 4 0 1 1 4-4 4 4 0 0 1-4 4Z"/></svg>',
    logs: '<svg viewBox="0 0 24 24" fill="none" stroke="#14B8A6" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    upstreams: '<svg viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
    rules: '<svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
    management: '<svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0-4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
    'proxy-config': '<svg viewBox="0 0 24 24" fill="none" stroke="#C96442" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>'
  };
  function navHtml() {
    const groups = [];
    for (const def of routeDefs) {
      let g = groups.find(x => x.section === def.section);
      if (!g) { g = { section: def.section, items: [] }; groups.push(g); }
      g.items.push(def);
    }
    const chevron = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    return groups.map(g => `
      <div class="nav-group">
        <div class="nav-group-head"><span>${g.section}</span>${chevron}</div>
        <div class="nav-items">
          ${g.items.map(d => `<button type="button" class="nav-item" data-route="${d.id}">${navIcons[d.id] || ''}<span>${d.label}</span></button>`).join('')}
        </div>
      </div>`).join('');
  }

  // 顶栏重启与侧栏底 badge 只在“缓存参数待重启”时出现，平时隐藏；
  // 侧栏底与管理页的重启入口常驻不动。
  function refreshRestartUI() {
    const pending = isPendingRestart();
    const btn = $('#restart-button');
    if (btn) btn.hidden = !pending;
    const badge = $('#sidebar-restart-badge');
    if (badge) badge.hidden = !pending;
  }

  // 全局搜索的配置项映射：先按配置名/页面名命中，命中不了才落到日志关键字。
  // 上游名需要读一次上游配置，成功后缓存 tag 列表；读失败不阻塞搜索。
  let upstreamTagCache = null;
  async function handleGlobalSearch(q) {
    const lower = q.toLowerCase();
    if (['概览', 'overview'].includes(lower)) return navigate('overview');
    if (['上游', 'dns', 'upstreams'].includes(lower)) return navigate('upstreams');
    if (['规则', 'rules'].includes(lower)) return navigate('rules');
    if (['系统', '管理', 'management'].includes(lower)) return navigate('management');
    const switchNames = {
      '请求屏蔽': 'features', '类型屏蔽': 'features', '广告屏蔽': 'features', 'ipv6 屏蔽': 'features',
      '核心缓存': 'features', '过期缓存': 'features', '指定 client fakeip': 'features', '指定 client realip': 'features',
      '功能开关': 'features', '开关': 'features'
    };
    if (switchNames[lower]) return navigate(`management/${switchNames[lower]}`);
    if (['缓存', '缓存管理', '缓存参数', '缓存池', '多级缓存池'].includes(q)) return navigate('management/cache');
    if (q === '代理配置') return navigate('proxy-config');
    if (q === '代理面板') { document.querySelector('[data-proxy-panel-link]')?.click(); return; }
    const listTags = {
      '白名单': 'whitelist', '黑名单': 'blocklist', '灰名单': 'greylist', '强制 realip': 'force_realip',
      'ddns 域名': 'ddns_domains', 'pcdn 域名': 'pcdn_domains', 'pcdn ipv4 规则': 'pcdn_regex_v4',
      'pcdn ipv6 规则': 'pcdn_regex_v6', '客户端 ip': 'client_ip', '直连 ip': 'direct_ip', '重定向': 'rewrite'
    };
    if (listTags[lower]) { state.pendingRuleTag = listTags[lower]; return navigate('rules'); }
    if (['名单', '名单管理'].includes(q)) return navigate('rules');
    if (['广告拦截', 'adguard'].includes(lower)) return navigate('rules/adguard');
    if (['在线分流', 'srs'].includes(lower)) return navigate('rules/diversion');
    if (['自动分流', '分流', '域名列表', '域名列表统计', '刷新分流缓存', 'requery'].includes(lower)) return navigate('rules/auto');
    if (upstreamTagCache === null) {
      try {
        const cfg = await api.request('/api/v1/upstream/config');
        upstreamTagCache = Object.values(cfg || {}).flat().map(u => String(u?.tag || '').toLowerCase()).filter(Boolean);
      } catch { upstreamTagCache = []; }
    }
    if (upstreamTagCache.includes(lower)) return navigate('upstreams');
    state.logs.q = q;
    state.logs.page = 1;
    return navigate('logs');
  }

  function fitRuleLayoutHeight(){
    const layout=$('.rule-layout');
    if(!layout)return;
    if(window.innerWidth<=900){
      layout.style.removeProperty('height');
      layout.style.removeProperty('min-height');
      return;
    }
    const top=layout.getBoundingClientRect().top;
    const available=Math.max(500,Math.floor(window.innerHeight-top-28));
    layout.style.height=`${available}px`;
    layout.style.minHeight='0';
  }

  function initShell(){
    document.title=CONFIG.title; setHTML($('#side-nav'), navHtml());
    const mobile=[['overview','overview','概览'],['logs','logs','日志'],['upstreams','upstream','DNS'],['rules','rules','规则'],['management','management','管理']];
    setHTML($('#mobile-nav'), mobile.map(([r,i,l])=>`<button data-route="${r}">${icon(i)}<span>${l}</span></button>`).join('') + `<button type="button" id="mobile-more-btn" aria-haspopup="true" aria-expanded="false">${icon('more')}<span>更多</span></button>`);
    let moreMenu = document.getElementById('mobile-more-menu');
    if (!moreMenu) {
      moreMenu = document.createElement('div');
      moreMenu.id = 'mobile-more-menu';
      moreMenu.className = 'mobile-more-menu';
      moreMenu.hidden = true;
      setHTML(moreMenu, `<button type="button" data-route="proxy-config">${icon('globe')}<span>代理配置</span></button><button type="button" id="mobile-more-appearance">${icon('theme')}<span>外观</span></button><button type="button" id="mobile-more-version">${icon('info')}<span>版本</span></button>`);
      document.body.appendChild(moreMenu);
    }
    const closeMoreMenu = () => {
      if (!moreMenu) return;
      moreMenu.hidden = true;
      $('#mobile-more-btn')?.setAttribute('aria-expanded', 'false');
    };
    const moreBtn = $('#mobile-more-btn');
    if (moreBtn) {
      moreBtn.onclick = e => {
        e.stopPropagation();
        const open = moreMenu.hidden;
        moreMenu.hidden = !open;
        moreBtn.setAttribute('aria-expanded', String(open));
      };
    }
    moreMenu.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.id === 'mobile-more-appearance') { $('#btn-open-bg-customizer')?.click(); }
      else if (btn.id === 'mobile-more-version') { $('#version-button')?.click(); }
      closeMoreMenu();
    });
    document.addEventListener('click', e => {
      if (moreMenu.hidden) return;
      if (e.target.closest('#mobile-more-menu') || e.target.closest('#mobile-more-btn')) return;
      closeMoreMenu();
    });
    setHTML($('#theme-toggle'), icon('theme')); setHTML($('#refresh-button'), icon('refresh')); setHTML($('#restart-button'), icon('power')); setHTML($('#drawer-close'), icon('close')); $$('#modal .icon-button').forEach(x=>setHTML(x, icon('close')));

    // 主题对应的 LocalDNS 品牌图形。
    shellInterfaceService?.updateBrand();
    typographyService?.setup();
    proxyPanelService?.setup({notify:toast});

    // 2. 背景与毛玻璃调校器
    const wpLayer = $('#wallpaper-layer');
    const pop = $('#bg-customizer-popover');
    const openBtn = $('#btn-open-bg-customizer');
    if (wpLayer && pop && openBtn) {
      openBtn.onclick = e => {
        e.stopPropagation();
        const isOpen = pop.classList.toggle('open');
        openBtn.setAttribute('aria-expanded', String(isOpen));
      };
      if ($('#btn-close-bg-popover')) {
        $('#btn-close-bg-popover').onclick = () => {
          pop.classList.remove('open');
          openBtn.setAttribute('aria-expanded', 'false');
        };
      }
      document.addEventListener('click', e => {
        if (!pop.contains(e.target) && !e.target.closest('#btn-open-bg-customizer')) {
          pop.classList.remove('open');
          openBtn.setAttribute('aria-expanded', 'false');
        }
      });

      wallpaperService?.setup({notify:toast});
      if ($('#slider-blur')) {
        $('#slider-blur').oninput = e => {
          const v = e.target.value;
          document.documentElement.style.setProperty('--glass-blur', `${v}px`);
          $('#val-blur').textContent = `${v}px`;
        };
      }
      if ($('#slider-alpha')) {
        $('#slider-alpha').oninput = e => {
          const v = e.target.value;
          document.documentElement.style.setProperty('--glass-alpha', (v / 100).toFixed(2));
          $('#val-alpha').textContent = `${v}%`;
        };
      }
      if ($('#slider-dimmer')) {
        $('#slider-dimmer').oninput = e => {
          const v = e.target.value;
          document.documentElement.style.setProperty('--bg-dimmer', (v / 100).toFixed(2));
          $('#val-dimmer').textContent = `${v}%`;
        };
      }
    }

    // 3. Default to the system preference; a new explicit choice may override it.
    state.particles = (storage.get('localdns_particles') ?? storage.get('localdns_particles_v2')) !== 'false';
    state.particleMotionOverride = storage.get('localdns_particles_motion_override') === 'true';
    const partBtn = $('#btn-toggle-particles');
    if (partBtn) {
      const enabled = () => state.particles && (!reduceMotion.matches || state.particleMotionOverride);
      const syncParticles = () => {
        partBtn.classList.toggle('active', enabled());
        partBtn.setAttribute('aria-pressed', String(enabled()));
        const label = reduceMotion.matches && !state.particleMotionOverride
          ? '拓扑动画已跟随系统减少动态暂停，点击可单独启用'
          : enabled() ? '关闭拓扑动画' : '开启拓扑动画';
        partBtn.title = label; partBtn.setAttribute('aria-label', label);
        const wrap = $('#topo-stage-wrap');
        if (wrap) {
          wrap.classList.toggle('no-particles', !state.particles);
          wrap.classList.toggle('motion-override', state.particleMotionOverride);
          topologyFlowService?.sync();
        }
      };
      partBtn.onclick = () => {
        state.particles = !enabled();
        state.particleMotionOverride = state.particles && reduceMotion.matches;
        storage.set('localdns_particles', String(state.particles));
        storage.set('localdns_particles_motion_override', String(state.particleMotionOverride));
        syncParticles();
      };
      reduceMotion.addEventListener('change', () => {
        state.particleMotionOverride = false;
        storage.set('localdns_particles_motion_override', 'false');
        syncParticles();
      });
      syncParticles();
    }

    const searchInput = $('#global-search-input');
    if (searchInput) {
      searchInput.onkeydown = e => {
        if (e.key === 'Enter') handleGlobalSearch(searchInput.value.trim());
      };
    }

    document.addEventListener('click',e=>{const b=e.target.closest('[data-route]');if(!b)return;const sub=b.dataset.routeSub; navigate(sub?`${b.dataset.route}/${sub}`:b.dataset.route)});
    $('#refresh-button').onclick=()=>renderRoute(true);
    $('#restart-button').onclick=restartService;
    if ($('#sidebar-restart-button')) $('#sidebar-restart-button').onclick=restartService;
    const sidebarBadge = $('#sidebar-restart-badge');
    if (sidebarBadge) sidebarBadge.onclick = () => navigate('management/cache');
    refreshRestartUI();
    window.addEventListener('localdns:pending-restart', refreshRestartUI);
    if (!skinService?.toggleTheme) {
      $('#theme-toggle').onclick=()=>{
        const cur=document.documentElement.dataset.theme;
        const next=cur==='light-glass'?'cosmos-glass':'light-glass';
        document.documentElement.dataset.theme=next;
        storage.set('localdnsTheme',next);
        shellInterfaceService?.updateBrand?.();
      };
    }
    window.addEventListener('localdns:skinchange',()=>{if(state.route==='overview')renderRoute(true,true)});
    $('#drawer-close').onclick=closeDrawer; $('#drawer-backdrop').onclick=closeDrawer; $('#modal-close').onclick=modalClose;
    $('#modal').addEventListener('close',()=>{closeSlowTypePopover();$('#modal').classList.remove('overview-detail-modal')});
    // 现代弹窗交互：点击遮罩空白关闭（必须在遮罩上按下再抬起，避免框内拖选误触）
    {
      const modal=$('#modal');let backdropPress=false;
      modal.addEventListener('pointerdown',e=>{backdropPress=e.target===modal});
      modal.addEventListener('click',e=>{if(backdropPress&&e.target===modal)modalClose();backdropPress=false});
      // ESC：统一走 modalClose（含详情样式的清理）；浮层打开时先让浮层自己处理
      modal.addEventListener('cancel',e=>{e.preventDefault();if(!$('#slow-type-popover')&&!$('#upstream-error-popover'))modalClose()});
    }
    // ESC 关侧板；Ctrl/⌘+K 或 / 聚焦全局搜索
    // 滚动条宽度补偿：弹窗/侧板打开时 html 会 overflow:hidden，用 --sbw 顶住内容避免横跳
    {
      const updateSbw=()=>{
        if(document.querySelector('dialog[open]')||document.querySelector('#drawer.open'))return;
        document.documentElement.style.setProperty('--sbw',Math.max(0,window.innerWidth-document.documentElement.clientWidth)+'px');
      };
      updateSbw();window.addEventListener('resize',updateSbw);
    }
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&$('#drawer')&&$('#drawer').classList.contains('open')){closeDrawer();return}
      const ae=document.activeElement;
      const typing=!!ae&&(/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)||ae.isContentEditable);
      if((!typing&&e.key==='/')||((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k')){
        const s=$('#global-search-input');
        if(s){e.preventDefault();s.focus();s.select()}
      }
    });
    {
      const s=$('#global-search-input');
      if(s)s.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();if(s.value)s.value='';else s.blur()}});
    }
    document.addEventListener('keydown',e=>{
      if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-copy]')){e.preventDefault();e.target.click();}
    });
    // 动效与微交互：点击后同步分段控件滑块；点击带 data-copy 的内容复制并给行内反馈
    document.addEventListener('click',e=>{
      requestAnimationFrame(syncAllSegThumbs);
      const node=e.target.closest('[data-copy]');
      if(!node)return;
      const text=node.dataset.copy||node.textContent.trim();
      copyToClipboard(text).then(ok=>{
        if(!ok){toast('复制失败','error');return}
        node.classList.add('is-copied');
        setTimeout(()=>node.classList.remove('is-copied'),900);
        toast('已复制','success',text);
      });
    });
    syncAllSegThumbs();
    window.addEventListener('resize',()=>requestAnimationFrame(syncAllSegThumbs));
    window.addEventListener('hashchange',()=>navigate((location.hash.replace(/^#\/?/,'')||'overview'),false));
    window.addEventListener('resize',()=>{if(state.route==='rules')requestAnimationFrame(fitRuleLayoutHeight)});
    window.addEventListener('localdns:layoutchange',()=>{if(state.route==='rules')requestAnimationFrame(fitRuleLayoutHeight)});
    window.addEventListener('unhandledrejection',e=>{const msg=e?.reason?.message||String(e?.reason||'未知错误');toast('操作失败','error',msg);e.preventDefault()});
  }
export { navHtml, fitRuleLayoutHeight, initShell };
export function initialize() {
appEvents.on('preferences:error', ({message})=>toast('设置未保存','error',message));
workspaceService.setup({state,apiBase:API_BASE,loadLogs:options=>api.logs(options),navigate,renderRoute,modalOpen,openDrawer,closeDrawer,downloadText,toast,ms,pct,fmtDate,groupName,trackRouteCleanup});
collectionsService.setup({apiBase:API_BASE,toast});
window.addEventListener('localdns:collectionlayoutchange',closeUpstreamErrorPopover);
sharedUIService.ready.then(()=>{initShell(); CONFIG.refreshInterval=Math.min(300,Math.max(5,Number(CONFIG.refreshInterval)||30)); shellInterfaceService?.setup({apiBase:API_BASE,refreshInterval:CONFIG.refreshInterval}); navigate(location.hash.replace(/^#\/?/,'')||'overview',false);});
}
