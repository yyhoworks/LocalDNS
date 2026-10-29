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
import { restartService } from '../management/index.js';
import { closeSlowTypePopover } from '../overview/details.js';
import { syncAllSegThumbs, copyToClipboard } from '../../shared/components/motion.js';
import { api } from '../../core/api/api.js';
import { downloadText } from '../../shared/downloads.js';
import { ms, pct, fmtDate } from '../../shared/format/number.js';
import { groupName } from '../upstreams/groups.js';
import { closeUpstreamErrorPopover } from '../upstreams/errors.js';
import { routeDefs } from '../../core/router/routes.js';

  function navHtml() {
    return `<div class="nav-items">${routeDefs.map((r, i) => `
      <button type="button" class="nav-item${i === 0 ? ' active' : ''}" data-route="${r.id}" title="${r.label}" aria-label="${r.label}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${r.navSvg}</svg>
        <span>${r.label}</span>
        ${r.dot ? '<i class="nav-item-dot" aria-hidden="true"></i>' : ''}
      </button>`).join('')}</div>`;
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
    setHTML($('#mobile-nav'), routeDefs.map(r=>`<button data-route="${r.id}">${icon(r.icon)}<span>${r.label}</span></button>`).join(''));
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
        if (e.key === 'Enter') {
          const q = searchInput.value.trim();
          const qLower = q.toLowerCase();
          const matchedRoute = routeDefs.find(r => r.label === q || r.id === qLower || (Array.isArray(r.keywords) && r.keywords.includes(qLower)));
          if (matchedRoute) return navigate(matchedRoute.id);
          state.logs.q = q;
          state.logs.page = 1;
          navigate('logs');
        }
      };
    }

    document.addEventListener('click',e=>{const b=e.target.closest('[data-route]');if(!b)return;navigate(b.dataset.route)});
    $('#refresh-button').onclick=()=>renderRoute(true);
    $('#restart-button').onclick=restartService;
    if ($('#sidebar-restart-button')) $('#sidebar-restart-button').onclick=restartService;
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
