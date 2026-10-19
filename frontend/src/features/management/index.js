import { currentScope } from '../../core/router/route-lifetime';
import { identityService } from '../identity/index.js';
import { proxyPanelService } from '../proxy-panel/index.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { empty, card } from '../../shared/components/templates.js';
import { num, fmtDate, esc, pct, compactPct } from '../../shared/format/number.js';
import { modalOpen } from '../../shared/components/dialog.js';
import { toast } from '../../shared/components/toast.js';
import { openDrawer } from '../../shared/components/drawer.js';
import { modalClose } from '../../shared/components/dialog.js';
import { $, state, page, $$ } from '../../core/context.js';
import { api } from '../../core/api/api.js';
import { renderRoute } from '../../core/router/router.js';
import { safe, safeResult } from '../../shared/async.js';
import { parseProm } from '../../shared/metrics/prometheus.ts';
import { parseCaches } from '../overview/model.js';
import { icon } from '../../shared/components/icons.js';

  const cacheName=t=>({cache_main:'全部缓存',cache_domestic:'国内缓存',cache_foreign:'国外缓存',cache_foreign_ecs:'国外 ECS 缓存'})[t]||t;

  function requeryHtml(s,c){
    if(!s)return {actions:'',body:empty('Requery 插件不可用')};
    const taskState=String(s.task_state||s.status||'idle').toLowerCase();
    const running=s.running===true||['running','processing','cancelling'].includes(taskState);
    const stateText={idle:'空闲',running:'运行中',processing:'运行中',cancelling:'正在取消',failed:'运行失败',error:'运行失败'}[taskState]||(running?'运行中':'空闲');
    const stateClass=['failed','error'].includes(taskState)?'danger':(running?'primary':'success');
    const pr=s.progress||{};
    const hasProgress=pr.processed!==undefined||pr.total!==undefined;
    const lastRun=s.last_run_end_time||s.last_run_start_time||s.last_run?.finished_at||s.last_run?.started_at;
    const lastCount=s.last_run_domain_count;
    const tile=(k,v)=>`<div class="mg-tile"><span>${k}</span><strong>${v}</strong></div>`;
    const statusRow=`<div class="rq-status"><span class="mg-chip"><span class="mg-lab">当前状态</span><span class="badge ${stateClass}">${stateText}</span></span><span class="mg-chip"><span class="mg-lab">定时任务</span><span class="badge ${c?.scheduler?.enabled?'success':''}">${c?.scheduler?.enabled?'已启用':'未启用'}</span></span></div>`;
    const actions=`<button class="button small" id="requery-scheduler" title="定时任务设置"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h9M18 8h2M4 16h4M13 16h7"/><circle cx="15.5" cy="8" r="2"/><circle cx="10.5" cy="16" r="2"/></svg>定时设置</button>${running?'<button class="button small danger" id="requery-cancel">取消任务</button>':'<button class="button small primary" id="requery-trigger" title="开始全新任务"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 4.5 19 12 7 19.5Z"/></svg>全新任务</button>'}`;
    const body=statusRow+`<div class="mg-tiles">${tile('进度',hasProgress?`${num(pr.processed??0)} / ${num(pr.total??0)}`:'—')}${tile('上次处理域名',lastCount===undefined||lastCount===null?'—':num(lastCount)+' 条')}${tile('上次运行',fmtDate(lastRun))}${tile('下次执行',fmtDate(s.next_run_time))}${tile('间隔',c?.scheduler?.interval_minutes?num(c.scheduler.interval_minutes)+' 分钟':'—')}</div>`;
    return {actions,body};
  }

  function openRequeryScheduler(c){
    c=c||{};
    const sc=c.scheduler||{};
    const dateDays=sc.date_range_days||c.execution_settings?.date_range_days||30;
    let local='';
    if(sc.start_datetime){const d=new Date(sc.start_datetime);if(!Number.isNaN(d.getTime())){const n=new Date(d.getTime()-d.getTimezoneOffset()*60000);local=n.toISOString().slice(0,16)}}
    modalOpen('分流刷新定时任务','定期扫描近期查询域名并刷新自动分流缓存',`<div class="stack"><label class="switch"><input id="rq-enabled" type="checkbox" ${sc.enabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用定时任务</span></label><div class="grid grid-2"><div class="field"><label>执行间隔（分钟）</label><input id="rq-interval" type="number" min="1" value="${esc(sc.interval_minutes||10080)}"></div><div class="field"><label>域名刷新天数</label><input id="rq-days" type="number" min="1" value="${esc(dateDays)}"></div></div><div class="field"><label>首次执行时间</label><input id="rq-start" type="datetime-local" value="${esc(local)}"></div><p class="form-note">10080 分钟等于 7 天。首次执行时间留空且启用时，后端会以保存时刻作为调度锚点并返回真实下次执行时间。</p></div>`,async()=>{
      const enabled=$('#rq-enabled').checked;
      const interval=+$('#rq-interval').value||0;
      const days=+$('#rq-days').value||0;
      if(enabled&&interval<=0)throw new Error('启用定时任务时，执行间隔必须大于 0');
      if(days<1)throw new Error('域名刷新天数必须大于 0');
      const raw=$('#rq-start').value;
      const payload={enabled,interval_minutes:interval,start_datetime:raw?new Date(raw).toISOString():'',date_range_days:days};
      await api.json('/plugins/requery/scheduler/config','POST',payload);
      toast('定时任务配置已更新');
      renderRoute(true);
    });
  }

  function countsHtml(c){
    if(c&&c.ok===false){
      const detail=c.error?.message?`<div class="muted" style="margin-top:8px">${esc(c.error.message)}</div>`:'';
      return empty('统计读取失败')+detail;
    }
    if(c&&c.ok===true)c=c.data;
    if(!c)return empty('暂无统计');
    let raw=c;
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.prototype.hasOwnProperty.call(raw,'data')) raw=raw.data;
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
      if(Array.isArray(raw.items)) raw=raw.items;
      else if(Array.isArray(raw.counts)) raw=raw.counts;
      else if(Array.isArray(raw.source_file_counts)) raw=raw.source_file_counts;
    }
    const entries=Array.isArray(raw)?raw:(raw&&typeof raw==='object'?Object.entries(raw).map(([name,value])=>value&&typeof value==='object'?{name,...value}:{name,count:value}):[]);
    if(!entries.length)return empty('暂无统计');
    return `<div class="table-wrap"><table><thead><tr><th>列表</th><th>条目数</th></tr></thead><tbody>${entries.map(x=>`<tr><td>${esc(x.alias||x.name||x.file||x.path||'未知')}</td><td>${num(x.count??x.rule_count??x.entries??x.value??0)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function multiPluginAction(paths,msg){await Promise.all(paths.map(p=>api.request(`/plugins/${p}`)));toast(msg);renderRoute(true)}

  async function clearShuntData(){
    const warning='确定完全清空自动分流数据？\n\n将清空：\n• 域名全集及 A/AAAA Activity\n• 自动生成的 FakeIP / RealIP / NODATA 分流记忆\n• 刷新分流缓存的历史进度与统计\n\n定时任务设置不会改变。\n清空后将从零重新收集域名并生成分流规则。';
    if(!confirm(warning))return;
    try{
      await api.request('/plugins/requery/reset',{method:'POST'});
      toast('自动分流数据已完全清空，将从零重新收集');
      renderRoute(true);
    }catch(e){
      toast('清空自动分流数据失败','error',e.message);
      renderRoute(true);
    }
  }

  const switchProfiles=[
    {tag:'switch1',name:'请求屏蔽',desc:'对无解析结果的请求进行屏蔽'}, {tag:'switch5',name:'类型屏蔽',desc:'屏蔽 SOA、PTR、HTTPS 等请求'},
    {tag:'switch7',name:'广告屏蔽',desc:'启用 AdGuard 在线规则'}, {tag:'switch6',name:'IPv6 屏蔽',desc:'屏蔽 AAAA 请求类型'},
    {tag:'switch13',name:'核心缓存',desc:'启用最终结果的全部缓存'}, {tag:'switch4',name:'过期缓存',desc:'启用国内及国外缓存的过期响应'},
    {tag:'switch2',name:'指定 Client FakeIP',desc:'只允许指定客户端科学'}, {tag:'switch12',name:'指定 Client RealIP',desc:'指定客户端不允许科学'}
  ];

  async function renderManagement(container, context){
 const renderScope = context.scope, page = container;

    const renderSeq=state.renderSeq;
    const isCurrent=()=>state.route==='management'&&state.renderSeq===renderSeq;
    const tags=switchProfiles.map(x=>x.tag);
    const skeletonBlock=(height=150)=>`<div class="skeleton" style="height:${height}px;border-radius:12px"></div>`;

    setHTML(page, `
    <div class="view-title-row">
      <div style="display:flex;align-items:baseline;gap:12px"><h1>系统管理</h1><span class="gc-sub">多级缓存池、核心功能开关与 Requery 自动分流刷新管理</span></div>
    </div>
    <div class="management-stack">
      <section class="proxy-panel-management" aria-label="代理面板设置">
        <div><h2 data-proxy-panel-name>代理面板</h2><code data-proxy-panel-address></code></div>
        <a class="button small" data-proxy-panel-link target="_blank" rel="noopener noreferrer">打开面板</a>
        <button type="button" class="button small" data-proxy-panel-settings>面板设置</button>
      </section>
      <div id="management-cache-slot" style="display:contents">${card('缓存管理',skeletonBlock(130),{iconName:'data',className:'data-cache-panel'})}</div>
      <div id="management-feature-slot" style="display:contents">${card('功能开关',skeletonBlock(300),{iconName:'features',subtitle:'常用运行功能集中管理',className:'management-feature-panel'})}</div>
      <div class="management-bottom">
        <div id="management-counts-slot" style="display:contents">${card('域名列表统计',skeletonBlock(150),{iconName:'rules',subtitle:'查看自动分流列表的当前条目数',className:'data-counts-card'})}</div>
        <div id="management-requery-slot" style="display:contents">${card('刷新分流缓存',skeletonBlock(270),{iconName:'refresh',subtitle:'重新扫描域名并更新自动生成的分流列表',className:'data-requery-card'})}</div>
      </div>
      <section class="management-service-actions" aria-label="DNS 服务操作"><div><h2>DNS 服务</h2><p>管理当前 DNS 核心进程</p></div><div id="management-service-controls"></div></section>
    </div>`);

    proxyPanelService?.sync();
    const switchPromise=Promise.all(tags.map(t=>safe(()=>api.request(`/plugins/${t}/show`),'error'))).then(results=>Object.fromEntries(tags.map((t,i)=>[t,String(results[i]).trim()])));
    const metricsPromise=api.metrics();
    const reqStatusPromise=safe(()=>api.request('/plugins/requery/status'),null);
    const reqCfgPromise=safe(()=>api.request('/plugins/requery/scheduler/config'),null);
    const countsPromise=safeResult(()=>api.request('/plugins/requery/stats/source_file_counts'));

    switchPromise.then(status=>{
      if(!isCurrent())return;
      const featureHtml=`<div class="feature-grid management-feature-grid">${switchProfiles.map(p=>`<div class="feature-card management-feature-card"><div><h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p></div><div class="feature-footer"><span class="badge ${status[p.tag]==='A'?'success':''}">${status[p.tag]==='A'?'已启用':'已关闭'}</span><label class="switch"><input data-switch="${p.tag}" type="checkbox" ${status[p.tag]==='A'?'checked':''} ${status[p.tag]==='error'?'disabled':''}><span class="switch-track"><span class="switch-thumb"></span></span></label></div></div>`).join('')}</div>`;
      const featureSlot=$('#management-feature-slot');
      if(featureSlot)setHTML(featureSlot, card('功能开关',featureHtml,{iconName:'features',subtitle:'常用运行功能集中管理',className:'management-feature-panel'}));
      $$('[data-switch]').forEach(x=>x.onchange=async()=>{try{const tag=x.dataset.switch,val=x.checked?'A':'B';await api.json(`/plugins/${tag}/post`,'POST',{value:val});if(x.checked&&(tag==='switch2'||tag==='switch12')){const other=tag==='switch2'?'switch12':'switch2';await api.json(`/plugins/${other}/post`,'POST',{value:'B'});}toast('功能状态已保存');renderRoute(true)}catch(e){x.checked=!x.checked;toast('切换失败','error',e.message)}});
    });

    Promise.all([switchPromise,metricsPromise]).then(([status,metricsRaw])=>{
      if(!isCurrent())return;
      const metrics=parseProm(metricsRaw),caches=parseCaches(metrics);
      const cacheEnabled=String(status.switch13||'').trim().toUpperCase()==='A';
      const activeCacheTag='cache_main';
      const activeCacheLabel=cacheName(activeCacheTag),activeForeignTag='cache_foreign_ecs';
      const visibleCacheTags=[activeCacheTag,'cache_domestic','cache_foreign',activeForeignTag];
      const visibleCaches=visibleCacheTags.map(tag=>caches.find(c=>c.tag===tag)).filter(Boolean);
      const cacheCards=visibleCaches.map(c=>`<div class="cache-card cache-card-compact"><div class="cache-card-head"><h3 title="${esc(cacheName(c.tag))}">${cacheName(c.tag)}</h3><div class="cache-card-actions"><button class="button small cache-view" data-tag="${c.tag}">查看</button><button class="button small danger cache-clear" data-tag="${c.tag}">清空</button></div></div><div class="cache-stats cache-stats-flat"><div class="cache-stat" title="完整数值：${num(c.q)}"><span>请求总数</span><strong>${num(c.q)}</strong></div><div class="cache-stat" title="完整数值：${num(c.size)}"><span>条目数</span><strong>${num(c.size)}</strong></div><div class="cache-stat" title="完整数值：${pct(c.hit)}"><span>命中率</span><strong>${compactPct(c.hit)}</strong></div><div class="cache-stat" title="完整数值：${pct(c.lazy)}"><span>过期命中</span><strong>${compactPct(c.lazy)}</strong></div></div></div>`);
      const cacheHeaderActions=`<div class="cache-header-actions"><span class="badge success cache-active-badge">${activeCacheLabel} · ${cacheEnabled?'当前使用':'当前模式'}</span><span class="badge ${cacheEnabled?'success':'danger'}">● 核心缓存${cacheEnabled?'已开启':'已关闭'}</span><button class="button small danger" id="cache-clear-all">全部清空</button></div>`;
      const slot=$('#management-cache-slot');if(!slot)return;
      setHTML(slot, `<section class="card data-cache-panel"><div class="card-header"><div class="card-title"><span class="icon">${icon('data')}</span><div><h2>缓存管理</h2><p>仅显示当前模式对应的全部缓存与国外缓存，界面更紧凑</p></div></div>${cacheHeaderActions}</div><div class="card-body"><div class="cache-grid data-cache-grid">${cacheCards.join('')}</div></div></section>`);
      $('#cache-clear-all')?.addEventListener('click',async()=>{if(!confirm('确定清空全部 DNS 缓存？将同时清空经典、智能、国内与国外缓存。'))return;const ct=caches.map(c=>c.tag);const result=await Promise.allSettled(ct.map(tag=>api.request(`/plugins/${tag}/flush`)));const failed=result.filter(x=>x.status==='rejected').length;failed?toast(`已清空 ${result.length-failed} 个缓存，${failed} 个失败`,'error'):toast(`全部 ${result.length} 个缓存已清空`);renderRoute(true)});
      $$('.cache-clear').forEach(x=>x.onclick=async()=>{if(!confirm(`确定清空 ${cacheName(x.dataset.tag)}？`))return;await api.request(`/plugins/${x.dataset.tag}/flush`);toast('缓存已清空');renderRoute(true)});
      $$('.cache-view').forEach(x=>x.onclick=async()=>{const text=await api.request(`/plugins/${x.dataset.tag}/show`);openDrawer(cacheName(x.dataset.tag),'缓存内容',`<pre>${esc(text)}</pre>`)});
    }).catch(e=>{if(isCurrent()&&$('#management-cache-slot'))setHTML($('#management-cache-slot'), card('缓存管理',`<div class="error-panel">加载失败：${esc(e.message)}</div>`,{iconName:'data',className:'data-cache-panel'}));});

    Promise.all([reqStatusPromise,reqCfgPromise]).then(([reqStatus,reqCfg])=>{
      if(!isCurrent())return;
      const slot=$('#management-requery-slot');if(!slot)return;
      const rq=requeryHtml(reqStatus,reqCfg);setHTML(slot, card('刷新分流缓存',rq.body,{iconName:'refresh',subtitle:'重新扫描域名并更新自动生成的分流列表',actions:rq.actions,className:'data-requery-card'}));
      $('#requery-trigger')?.addEventListener('click',async()=>{await api.request('/plugins/requery/trigger',{method:'POST'});toast('刷新任务已开始');renderRoute(true)});
      $('#requery-cancel')?.addEventListener('click',async()=>{await api.request('/plugins/requery/cancel',{method:'POST'});toast('已请求取消');renderRoute(true)});
      $('#requery-scheduler')?.addEventListener('click',()=>openRequeryScheduler(reqCfg));
    });

    countsPromise.then(counts=>{
      if(!isCurrent())return;
      const slot=$('#management-counts-slot');if(!slot)return;
      setHTML(slot, card('域名列表统计',countsHtml(counts),{iconName:'rules',subtitle:'查看自动分流列表的当前条目数',actions:'<button class="button small" id="save-shunt" title="保存分流规则">保存</button><button class="button small danger" id="clear-shunt" title="清空分流规则">清空</button>',className:'data-counts-card'}));
      const countsCard=$('#management-counts-slot .data-counts-card');
      if(countsCard){countsCard.style.height='';countsCard.style.minHeight='';}
      $('#save-shunt')?.addEventListener('click',()=>multiPluginAction(['domain_stats/save','realip/save','fakeip/save','nodata/save'],'分流规则已保存'));
      $('#clear-shunt')?.addEventListener('click',()=>clearShuntData());
    });
  }

  async function restartService(){if(!confirm(`确定重启 ${identityService?.getName()||'LocalDNS'}？短时间内 DNS 服务会中断。`))return;const scope=currentScope();await api.json('/api/v1/system/restart','POST',{delay_ms:500});if(scope.signal.aborted)return;toast((identityService?.getName()||'LocalDNS')+' 正在重启');scope.timeout(()=>renderRoute(true),4000);}

  async function openAuditModal(){
    const [s,c]=await Promise.all([api.status(),api.capacity()]);
    modalOpen('审计控制','控制 DNS 查询日志的记录状态与容量',`
      <div class="kv-list"><div class="kv-row"><span class="kv-key">当前状态</span><span class="kv-value"><span class="badge ${s.capturing?'success':'danger'}">${s.capturing?'运行中':'已停止'}</span></span></div></div>
      <div class="field" style="margin-top:16px"><label>日志容量 <span class="settings-compact-note">最大记录数，当前 ${num(c.capacity)} 条</span></label>
        <div class="settings-refresh-row"><input id="audit-cap" type="number" min="100" value="${c.capacity}"><button class="button primary" id="audit-cap-save">保存</button></div></div>
      <div class="grid grid-2" style="margin-top:16px"><button class="button ${s.capturing?'danger':'success'}" id="modal-audit-toggle">${s.capturing?'关闭审计':'开启审计'}</button><button class="button danger" id="modal-audit-clear">清空日志</button></div>`,null,false);
    $('#audit-cap-save').onclick=async()=>{const v=Math.floor(+$('#audit-cap').value);if(!Number.isFinite(v)||v<100){toast('日志容量不能小于 100');return}await api.json('/api/v1/audit/capacity','POST',{capacity:v});toast('日志容量已保存');modalClose();renderRoute(true)};
    $('#modal-audit-toggle').onclick=async()=>{await api.request(`/api/v1/audit/${s.capturing?'stop':'start'}`,{method:'POST'});toast('审计状态已更新');modalClose();renderRoute(true)};
    $('#modal-audit-clear').onclick=async()=>{if(!confirm('确定清空日志？'))return;await api.request('/api/v1/audit/clear',{method:'POST'});toast('日志已清空');modalClose();renderRoute(true)};
  }
export { cacheName, requeryHtml, openRequeryScheduler, countsHtml, multiPluginAction, clearShuntData, switchProfiles, renderManagement, restartService, openAuditModal };
