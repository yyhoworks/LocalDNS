// @ts-check
import { beginRoute, currentScope } from './route-lifetime';
import { resolveRoute } from './resolve-route';
import { toast } from '../../shared/components/toast.js';
import { closeDrawer } from '../../shared/components/drawer.js';
import { modalClose } from '../../shared/components/dialog.js';
import { closeSlowTypePopover } from '../../features/overview/details.js';
import { shellInterfaceService } from '../../features/shell/interface.js';
import { topologyFlowService } from '../../features/overview/topology/flow.js';
import { workspaceService } from '../../shared/workspace.js';
import { setHTML } from '../security/safe-dom.ts';
import { sessionPreferences } from '../persistence/preferences.ts';
import { routeDefs } from './routes.js';
import { state, $, $$, page, CONFIG } from '../context.js';
import { closeUpstreamErrorPopover } from '../../features/upstreams/errors.js';
import { loadingPage } from '../../shared/components/templates.js';
import { overviewRoute } from '../../features/overview/route';
import { logsRoute } from '../../features/logs/route';
import { upstreamsRoute } from '../../features/upstreams/route';
import { rulesRoute } from '../../features/rules/route';
import { managementRoute } from '../../features/management/route';
import { proxyConfigRoute } from '../../features/proxy-config/route';
import { playViewEnter, animateCountUps, syncAllSegThumbs } from '../../shared/components/motion.js';
import { setApiStatus } from '../../features/shell/connection.js';
import { esc } from '../../shared/format/number.js';
import { icon } from '../../shared/components/icons.js';
import { focusSelectors, restoreFocus } from './focus-restore.js';
import { setPageLabel, focusPageHeading, markPageHeading } from './page-title.js';

  let navigationSeq=0;
  const routeModules={overview:overviewRoute,logs:logsRoute,upstreams:upstreamsRoute,rules:rulesRoute,management:managementRoute,'proxy-config':proxyConfigRoute};
  /** @param {string} id */
  function routeModule(id){return routeModules[/** @type {keyof typeof routeModules} */ (id)];}
  /** @param {string} id @param {boolean} [write] */
  async function navigate(id,write=true){
    const sequence=++navigationSeq;
    id=resolveRoute(id);
    const active=routeModule(state.route);
    if(active.canLeave){
      const decision=active.canLeave();
      if(location.hash!==`#/${state.route}`){history.replaceState(null,'',`#/${state.route}`);write=true;}
      if(!await decision||sequence!==navigationSeq)return;
    }
    state.route=id;if(write&&location.hash!==`#/${id}`)history.pushState(null,'',`#/${id}`);return renderRoute(false,false,true);
  }

  function updateNav(){ const r=routeDefs.find(x=>x.id===state.route); if(!r)return; setPageLabel(r.label); /** @type {HTMLElement} */ ($('#page-title')).textContent=r.label; /** @type {HTMLElement} */ ($('#page-subtitle')).textContent=r.subtitle;$$('[data-route]').forEach(x=>x.classList.toggle('active',/** @type {HTMLElement} */ (x).dataset.route===state.route)); }

  /** @param {() => void} fn */
  function trackRouteCleanup(fn){ return currentScope().add(fn); }

  function cleanupRouteUi(){ currentScope().dispose(); }

  // 自动刷新（silent）：不清空页面、不显示“加载中”，新数据取回后原地替换，并保留滚动位置与未提交的输入。
  /** @typedef {{ y: number, inner: [number, number][], fields: [string, string | boolean][], dirty: Set<string>, focus: string[] }} ViewSnapshot */

  /** @returns {ViewSnapshot} */
  function viewSnapshot(){
    const scrollers=[...page.querySelectorAll('.rank-list,.table-wrap,.overview-donut-legend,textarea')];
    const fields=[...page.querySelectorAll('input[id],select[id],textarea[id]')];
    return {
      y:window.scrollY,
      inner:scrollers.map(el=>[el.scrollTop,el.scrollLeft]),
      fields:fields.map(el=>{const field=/** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */ (el);return /** @type {[string, string | boolean]} */ ([field.id,field.type==='checkbox'&&'checked' in field?field.checked:field.value]);}),
      dirty:new Set(),
      focus:focusSelectors(document.activeElement,page)
    };
  }

  /** @param {ViewSnapshot | null} snap */
  function viewRestore(snap){
    if(!snap)return;
    const el=document.documentElement,prev=el.style.scrollBehavior;
    el.style.scrollBehavior='auto';
    window.scrollTo(0,snap.y);
    el.style.scrollBehavior=prev;
    const scrollers=[...page.querySelectorAll('.rank-list,.table-wrap,.overview-donut-legend,textarea')];
    if(scrollers.length===snap.inner.length)scrollers.forEach((n,i)=>{n.scrollTop=snap.inner[i][0];n.scrollLeft=snap.inner[i][1]});
    snap.fields.forEach(([id,v])=>{if(snap.dirty?.has(id))return;const n=document.getElementById(id);if(!n||!page.contains(n))return;const field=/** @type {HTMLInputElement} */ (n);if(field.type==='checkbox')field.checked=/** @type {boolean} */ (v);else if(field.value!==v)field.value=/** @type {string} */ (v)});
    if(snap.focus?.length)restoreFocus(snap.focus,page);
  }

  /** @type {{ route: string, y: number } | null} */
  let pendingScroll=null;

  /** 上一次完成非静默渲染的路由；首屏加载不抢焦点，之后切换路由时聚焦新页面的 h1。 @type {string | null} */
  let lastRenderedRoute=null;

  /** @type {ReturnType<typeof setTimeout> | number} */
  let scrollSaveTimer=0,userScrolled=false;

  const saveScroll=()=>{if(pendingScroll)return;try{sessionPreferences.setItem('localdnsScroll',JSON.stringify({route:state.route,y:Math.round(window.scrollY)}))}catch{}};

  function restoreScroll(){
    const want=pendingScroll;
    if(!want)return;
    if(want.route!==state.route){pendingScroll=null;return}
    userScrolled=false;
    const scope=currentScope();
    const go=()=>{if(scope.signal.aborted||userScrolled||pendingScroll!==want)return;window.scrollTo({top:want.y,behavior:'instant'})};
    requestAnimationFrame(()=>requestAnimationFrame(go));
    for(const t of [150,400,900])scope.timeout(go,t);
    scope.timeout(()=>{if(pendingScroll===want)pendingScroll=null},1200);
  }

  async function renderRoute(force=false,silent=false,approved=false){
    const activeRoute=state.route;
    const activeModule=routeModule(activeRoute);
    if(!approved&&activeModule?.canLeave&&!await activeModule.canLeave())return;
    if(state.route!==activeRoute)return;
    shellInterfaceService?.rememberDraft();
    const scope = beginRoute();
    scope.add(() => { topologyFlowService?.stop(); closeUpstreamErrorPopover(); closeSlowTypePopover(); closeDrawer(); modalClose(); });
    topologyFlowService?.stop();
    closeUpstreamErrorPopover();
    const seq=(state.renderSeq||0)+1;state.renderSeq=seq;

    const snap=silent?viewSnapshot():null;
    // While the silent refresh is in flight, remember which fields the user
    // edits so viewRestore never overwrites fresh input with the snapshot.
    const markDirty=snap?/** @param {Event} event */ event=>{const id=/** @type {HTMLElement | null} */ (event.target)?.id;if(id)snap.dirty.add(id)}:null;
    if(markDirty){page.addEventListener('input',markDirty,true);page.addEventListener('change',markDirty,true)}
    const stopMarking=()=>{if(markDirty){page.removeEventListener('input',markDirty,true);page.removeEventListener('change',markDirty,true)}};
    state.silent=silent;
    if(silent){page.style.minHeight=page.offsetHeight+'px'}
    else{page.style.minHeight=''}
    updateNav();
    if(!silent)setHTML(page, loadingPage());
    try {
      const route=routeModule(state.route);
      const cleanup = await route.mount(page, { signal: scope.signal, scope, navigate, notify: toast });
      if(typeof cleanup==='function')scope.add(cleanup);
      if(seq!==state.renderSeq){stopMarking();return;}
      shellInterfaceService?.apply();
      workspaceService.finish(page);
      if(!silent){playViewEnter();animateCountUps(page)}
      if(!silent){if(lastRenderedRoute!==null&&lastRenderedRoute!==state.route)focusPageHeading(page);lastRenderedRoute=state.route}
      syncAllSegThumbs();
      state.silent=false;
      markPageHeading(page);
      viewRestore(snap);
      stopMarking();
      setApiStatus(true);
    } catch(e){
      stopMarking();
      const failure=/** @type {any} */ (e);
      if(seq!==state.renderSeq||failure?.name==='AbortError')return;
      console.error(e); setApiStatus(false,failure.message);
      // 自动刷新失败：保留旧内容，只更新连接状态
      if(!silent){ setHTML(page, `<div class="error-panel"><strong>无法加载当前页面</strong><p>${esc(failure.message)}</p><button class="button" id="retry-page">${icon('refresh')}重新加载</button></div>`); /** @type {HTMLElement} */ ($('#retry-page')).onclick=()=>renderRoute(true);
      }
    }
    if(seq!==state.renderSeq)return;
    state.silent=false;
    if(silent)scope.timeout(()=>{if(seq===state.renderSeq)page.style.minHeight=''},1500);
    if(!silent)restoreScroll();
    if(['logs','overview'].includes(state.route)){scope.interval(()=>{if(document.visibilityState==='visible'&&!busyViewing()&&!(state.route==='logs'&&state.logsPaused))renderRoute(true,true)},CONFIG.refreshInterval*1000)}
  }

  // 正在输入、键盘焦点停在页面控件上、悬停拓扑、弹窗或抽屉打开时不自动刷新
  function busyViewing(){
    const a=/** @type {HTMLElement | null} */ (document.activeElement);
    const main=a?.closest?.('main');
    if(a&&main&&['INPUT','TEXTAREA','SELECT'].includes(a.tagName))return true;
    // 路由切换后程序聚焦的 main / 页面标题（tabindex=-1）不算“正在操作”，否则自动刷新会一直暂停。
    if(a&&main&&a!==document.body&&a!==main&&!(a.tagName==='H1'&&a.tabIndex===-1)&&keyboardFocus(a))return true;
    if(document.querySelector('#topo-stage-wrap:hover'))return true;
    return !!document.querySelector('dialog[open], .drawer.open');
  }
  // 鼠标点击按钮后焦点也会停留在按钮上；只把键盘焦点（:focus-visible）视为正在浏览，
  // 避免点一次按钮后自动刷新就一直暂停。浏览器不支持该伪类时按保守处理（视为键盘焦点）。
  /** @param {Element} el */
  function keyboardFocus(el){try{return el.matches(':focus-visible')}catch{return true}}
export { navigate, updateNav, trackRouteCleanup, cleanupRouteUi, viewSnapshot, viewRestore, pendingScroll, scrollSaveTimer, userScrolled, saveScroll, restoreScroll, renderRoute, busyViewing };
export function initialize() {
try{history.scrollRestoration='manual'}catch{}
try{const v=JSON.parse(sessionPreferences.getItem('localdnsScroll')||'null');if(v&&typeof v.route==='string'&&v.y>0)pendingScroll=v}catch{}
window.addEventListener('scroll',()=>{clearTimeout(scrollSaveTimer);scrollSaveTimer=setTimeout(saveScroll,120)},{passive:true});
window.addEventListener('pagehide',()=>{saveScroll();currentScope().dispose();});
window.addEventListener('pageshow',event=>{if(event.persisted)renderRoute(true)});
for(const ev of ['wheel','touchstart','keydown','mousedown'])window.addEventListener(ev,()=>{userScrolled=true;pendingScroll=null},{passive:true,capture:true});
}
