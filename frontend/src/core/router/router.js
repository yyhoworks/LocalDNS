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
import { destroyCharts, takeCharts, restoreCharts } from '../../shared/charts/chart-adapter.js';
import { loadingPage } from '../../shared/components/templates.js';
import { overviewRoute } from '../../features/overview/route';
import { logsRoute } from '../../features/logs/route';
import { upstreamsRoute } from '../../features/upstreams/route';
import { rulesRoute } from '../../features/rules/route';
import { managementRoute } from '../../features/management/route';
import { playViewEnter, animateCountUps, syncAllSegThumbs } from '../../shared/components/motion.js';
import { setApiStatus } from '../../features/shell/connection.js';
import { esc } from '../../shared/format/number.js';
import { icon } from '../../shared/components/icons.js';

  let navigationSeq=0;
  function routeModule(id){return {overview:overviewRoute,logs:logsRoute,upstreams:upstreamsRoute,rules:rulesRoute,management:managementRoute}[id];}
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

  function updateNav(){ const r=routeDefs.find(x=>x.id===state.route); $('#page-title').textContent=r.label;$('#page-subtitle').textContent=r.subtitle;$$('[data-route]').forEach(x=>x.classList.toggle('active',x.dataset.route===state.route)); }

  function trackRouteCleanup(fn){ return currentScope().add(fn); }

  function cleanupRouteUi(){ currentScope().dispose(); }

  // 自动刷新（silent）：不清空页面、不显示“加载中”，新数据取回后原地替换，并保留滚动位置与未提交的输入。
  function viewSnapshot(){
    const scrollers=[...page.querySelectorAll('.rank-list,.table-wrap,.overview-donut-legend,textarea')];
    const fields=[...page.querySelectorAll('input[id],select[id],textarea[id]')];
    return {
      y:window.scrollY,
      inner:scrollers.map(el=>[el.scrollTop,el.scrollLeft]),
      fields:fields.map(el=>[el.id,el.type==='checkbox'?el.checked:el.value])
    };
  }

  function viewRestore(snap){
    if(!snap)return;
    const el=document.documentElement,prev=el.style.scrollBehavior;
    el.style.scrollBehavior='auto';
    window.scrollTo(0,snap.y);
    el.style.scrollBehavior=prev;
    const scrollers=[...page.querySelectorAll('.rank-list,.table-wrap,.overview-donut-legend,textarea')];
    if(scrollers.length===snap.inner.length)scrollers.forEach((n,i)=>{n.scrollTop=snap.inner[i][0];n.scrollLeft=snap.inner[i][1]});
    snap.fields.forEach(([id,v])=>{const n=document.getElementById(id);if(!n||!page.contains(n))return;if(n.type==='checkbox')n.checked=v;else if(n.value!==v)n.value=v});
  }

  let pendingScroll=null;

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
    if(!approved&&routeModule(activeRoute).canLeave&&!await routeModule(activeRoute).canLeave())return;
    if(state.route!==activeRoute)return;
    shellInterfaceService?.rememberDraft();
    const scope = beginRoute();
    scope.add(() => { topologyFlowService?.stop(); closeUpstreamErrorPopover(); closeSlowTypePopover(); closeDrawer(); modalClose(); });
    topologyFlowService?.stop();
    closeUpstreamErrorPopover();
    const seq=(state.renderSeq||0)+1;state.renderSeq=seq;

    const snap=silent?viewSnapshot():null;
    const oldCharts=silent?takeCharts():null;
    scope.add(()=>{if(oldCharts){oldCharts.forEach(chart=>{try{chart.destroy()}catch{}});oldCharts.length=0}});
    state.silent=silent;
    if(silent){page.style.minHeight=page.offsetHeight+'px'}
    else{destroyCharts();page.style.minHeight=''}
    updateNav();
    if(!silent)setHTML(page, loadingPage());
    try {
      const route=routeModule(state.route);
      const cleanup = await route.mount(page, { signal: scope.signal, scope, navigate, notify: toast });
      if(typeof cleanup==='function')scope.add(cleanup);
      if(seq!==state.renderSeq)return;
      shellInterfaceService?.apply();
      workspaceService.finish(page);
      if(!silent){playViewEnter();animateCountUps(page)}
      syncAllSegThumbs();
      state.silent=false;
      viewRestore(snap);
      setApiStatus(true);
    } catch(e){
      if(seq!==state.renderSeq||e?.name==='AbortError')return;
      console.error(e); setApiStatus(false,e.message);
      if(silent){ // 自动刷新失败：保留旧内容，旧图表也留着，只更新连接状态
        if(oldCharts){restoreCharts(oldCharts);oldCharts.length=0}
      } else { setHTML(page, `<div class="error-panel"><strong>无法加载当前页面</strong><p>${esc(e.message)}</p><button class="button" id="retry-page">${icon('refresh')}重新加载</button></div>`); $('#retry-page').onclick=()=>renderRoute(true);
      }
    }
    if(oldCharts)oldCharts.forEach(c=>{try{c.destroy()}catch{}});
    if(seq!==state.renderSeq)return;
    state.silent=false;
    if(silent)scope.timeout(()=>{if(seq===state.renderSeq)page.style.minHeight=''},1500);
    if(!silent)restoreScroll();
    if(['logs','overview'].includes(state.route)){scope.interval(()=>{if(document.visibilityState==='visible'&&!busyViewing()&&!(state.route==='logs'&&state.logsPaused))renderRoute(true,true)},CONFIG.refreshInterval*1000)}
  }

  // 正在输入、弹窗或抽屉打开时不自动刷新
  function busyViewing(){
    const a=document.activeElement;
    if(a&&a.closest?.('main')&&['INPUT','TEXTAREA','SELECT'].includes(a.tagName))return true;
    return !!document.querySelector('dialog[open], .drawer.open');
  }
export { navigate, updateNav, trackRouteCleanup, cleanupRouteUi, viewSnapshot, viewRestore, pendingScroll, scrollSaveTimer, userScrolled, saveScroll, restoreScroll, renderRoute, busyViewing };
export function initialize() {
try{history.scrollRestoration='manual'}catch{}
try{const v=JSON.parse(sessionPreferences.getItem('localdnsScroll')||'null');if(v&&typeof v.route==='string'&&v.y>0)pendingScroll=v}catch{}
window.addEventListener('scroll',()=>{clearTimeout(scrollSaveTimer);scrollSaveTimer=setTimeout(saveScroll,120)},{passive:true});
window.addEventListener('pagehide',()=>{saveScroll();currentScope().dispose();destroyCharts();});
window.addEventListener('pageshow',event=>{if(event.persisted)renderRoute(true)});
for(const ev of ['wheel','touchstart','keydown','mousedown'])window.addEventListener(ev,()=>{userScrolled=true;pendingScroll=null},{passive:true,capture:true});
}
