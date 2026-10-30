import { currentScope } from '../../core/router/route-lifetime';
import { identityService } from '../identity/index.js';
import { proxyPanelService } from '../proxy-panel/index.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { empty, card } from '../../shared/components/templates.js';
import { num, fmtDate, esc, pct, compactPct } from '../../shared/format/number.js';
import { modalOpen, confirmDialog } from '../../shared/components/dialog.js';
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
import { cacheLimitInputSelector, cacheLimitsForm, cacheSettings, readCacheLimits, readCacheSettings } from './cache-settings';

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
    modalOpen('分流刷新定时任务','定期扫描近期查询域名并刷新自动分流缓存',`<div class="stack"><label class="switch"><input id="rq-enabled" type="checkbox" ${sc.enabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用定时任务</span></label><div class="grid grid-2"><div class="field"><label>执行间隔（分钟）</label><input id="rq-interval" type="number" min="1" value="${esc(sc.interval_minutes||1440)}"></div><div class="field"><label>域名刷新天数</label><input id="rq-days" type="number" min="1" value="${esc(dateDays)}"></div></div><div class="field"><label>首次执行时间</label><input id="rq-start" type="datetime-local" value="${esc(local)}"></div><p class="form-note">间隔按分钟填写：1440 分钟 = 1 天，10080 分钟 = 7 天。首次执行时间留空且启用时，后端会以保存时刻作为调度锚点并返回真实下次执行时间。</p></div>`,async()=>{
      const enabled=$('#rq-enabled').checked;
      const interval=+$('#rq-interval').value||0;
      const days=+$('#rq-days').value||0;
      if(enabled&&interval<=0)throw new Error('启用定时任务时，执行间隔必须大于 0');
      if(enabled&&days<1)throw new Error('域名刷新天数必须大于 0');
      const raw=$('#rq-start').value;
      const payload={enabled,interval_minutes:interval,start_datetime:raw?new Date(raw).toISOString():'',date_range_days:days};
      await api.json('/plugins/requery/scheduler/config','POST',payload);
      toast('定时任务配置已更新');
      renderRoute(true);
    });
  }

  function openCacheSettings(settings){
    modalOpen('缓存参数','调整各缓存池的记录上限、过期保留时间与写盘间隔',cacheLimitsForm(settings,{cacheName,esc,num}),async()=>{
      const payload=readCacheLimits(settings,(key,field)=>{
        const input=$('#modal-content')?.querySelector(cacheLimitInputSelector(key,field));
        if(!input)throw new Error('缓存参数表单缺失，请重新打开后再保存。');
        return input.value;
      });
      let result;
      try{result=await api.json('/api/v1/cache/limits','POST',payload);}
      catch(error){if(error&&error.status===400)throw new Error('内核拒绝了这组参数，请确认数值在允许范围内后重试。',{cause:error});throw error;}
      let next=null;try{next=cacheSettings(result)}catch{/* 保存已成功，仅按当前设置刷新页面 */}
      return ()=>{toast(next&&next.restart_needed?'缓存参数已保存，重启内核后生效':'缓存参数已保存');renderRoute(true)};
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

  async function multiPluginAction(paths,msg){const result=await Promise.allSettled(paths.map(p=>api.request(`/plugins/${p}`)));const failed=result.filter(x=>x.status==='rejected').length;failed?toast(`已保存 ${result.length-failed} 项，${failed} 项失败`,'error'):toast(msg);renderRoute(true)}

  async function clearShuntData(){
    const warning='确定完全清空自动分流数据？\n\n将清空：\n• 域名全集及 A/AAAA Activity\n• 自动生成的 FakeIP / RealIP / NODATA 分流记忆\n• 刷新分流缓存的历史进度与统计\n\n定时任务设置不会改变。\n清空后将从零重新收集域名并生成分流规则。';
    if(!await confirmDialog({message:warning,danger:true}))return;
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
      <div class="management-top-pair">
        <section class="proxy-panel-management" aria-label="代理面板设置">
          <div><h2 data-proxy-panel-name>代理面板</h2><code data-proxy-panel-address></code></div>
          <a class="button small" data-proxy-panel-link target="_blank" rel="noopener noreferrer">打开面板</a>
          <button type="button" class="button small" data-proxy-panel-settings>面板设置</button>
          <button type="button" class="button small" data-route="proxy-config">编辑配置</button>
        </section>
        <section class="management-service-actions" aria-label="DNS 服务操作">
          <div class="service-card-main">
            <span class="service-card-icon" aria-hidden="true">${icon('power')}</span>
            <div class="service-card-copy">
              <div class="service-card-title-row">
                <h2>DNS 核心服务</h2>
                <span class="badge service-card-badge">状态未知</span>
              </div>
              <p>平滑重启内核进程，重新加载所有配置与上游连接</p>
            </div>
          </div>
          <div id="management-service-controls">
            <button type="button" class="glass-btn console-restart" id="management-restart-button" title="重启 DNS 核心服务">${icon('power')}<span>重启内核</span></button>
          </div>
        </section>
      </div>
      <div id="management-cache-slot" style="display:contents">${card('缓存管理',skeletonBlock(130),{iconName:'data',className:'data-cache-panel'})}</div>
      <div id="management-feature-slot" style="display:contents">${card('功能开关',skeletonBlock(300),{iconName:'features',subtitle:'常用运行功能集中管理',className:'management-feature-panel'})}</div>
      <div class="management-bottom">
        <div id="management-counts-slot" style="display:contents">${card('域名列表统计',skeletonBlock(150),{iconName:'rules',subtitle:'查看自动分流列表的当前条目数',className:'data-counts-card'})}</div>
        <div id="management-requery-slot" style="display:contents">${card('刷新分流缓存',skeletonBlock(270),{iconName:'refresh',subtitle:'重新扫描域名并更新自动生成的分流列表',className:'data-requery-card'})}</div>
      </div>
    </div>`);

    $('#management-restart-button')?.addEventListener('click', restartService);
    proxyPanelService?.sync();
    // 服务徽标复用本页已有的 /metrics 健康检查：初始为“状态未知”，
    // 只有后端成功响应指标时才翻为“运行中”；失败则保持未知，不写死端口。
    const serviceBadge=page.querySelector('.service-card-badge');
    const switchPromise=Promise.all(tags.map(t=>safe(()=>api.request(`/plugins/${t}/show`),'error'))).then(results=>Object.fromEntries(tags.map((t,i)=>[t,String(results[i]).trim()])));
    const metricsPromise=api.metrics();
    const cacheSettingsPromise=safeResult(()=>readCacheSettings(path=>api.request(path)));
    metricsPromise.then(()=>{if(!isCurrent()||!serviceBadge)return;serviceBadge.classList.add('success');serviceBadge.textContent='● 运行中';},()=>{/* 查不到时保持“状态未知” */});
    const reqStatusPromise=safe(()=>api.request('/plugins/requery/status'),null);
    const reqCfgPromise=safe(()=>api.request('/plugins/requery/scheduler/config'),null);
    const countsPromise=safeResult(()=>api.request('/plugins/requery/stats/source_file_counts'));

    switchPromise.then(status=>{
      if(!isCurrent())return;
      const featureHtml=`<div class="feature-grid management-feature-grid">${switchProfiles.map(p=>`<div class="feature-card management-feature-card"><div><h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p></div><div class="feature-footer"><span class="badge ${status[p.tag]==='A'?'success':''}">${status[p.tag]==='A'?'已启用':(status[p.tag]==='error'?'读取失败':'已关闭')}</span><label class="switch"><input data-switch="${p.tag}" type="checkbox" ${status[p.tag]==='A'?'checked':''} ${status[p.tag]==='error'?'disabled':''}><span class="switch-track"><span class="switch-thumb"></span></span></label></div></div>`).join('')}</div>`;
      const featureSlot=$('#management-feature-slot');
      if(featureSlot)setHTML(featureSlot, card('功能开关',featureHtml,{iconName:'features',subtitle:'常用运行功能集中管理',className:'management-feature-panel'}));
      $$('[data-switch]').forEach(x=>x.onchange=async()=>{const tag=x.dataset.switch,val=x.checked?'A':'B';let rollbackNeeded=false;try{await api.json(`/plugins/${tag}/post`,'POST',{value:val});if(x.checked&&(tag==='switch2'||tag==='switch12')){rollbackNeeded=true;const other=tag==='switch2'?'switch12':'switch2';await api.json(`/plugins/${other}/post`,'POST',{value:'B'});}toast('功能状态已保存');renderRoute(true)}catch(e){if(rollbackNeeded){try{await api.json(`/plugins/${tag}/post`,'POST',{value:val==='A'?'B':'A'});}catch{/* 回滚失败时仍用下面的重渲染回读服务端真实状态 */}}toast('切换失败','error',e.message);renderRoute(true)}});
    });

    Promise.all([switchPromise,metricsPromise,cacheSettingsPromise]).then(([status,metricsRaw,cacheSettingsResult])=>{
      if(!isCurrent())return;
      const cacheLimits=cacheSettingsResult.ok?cacheSettingsResult.data:null;
      const metrics=parseProm(metricsRaw),caches=parseCaches(metrics);
      const cacheEnabled=String(status.switch13||'').trim().toUpperCase()==='A';
      const activeCacheTag='cache_main';
      const activeCacheLabel=cacheName(activeCacheTag),activeForeignTag='cache_foreign_ecs';
      const visibleCacheTags=[activeCacheTag,'cache_domestic','cache_foreign',activeForeignTag];
      const visibleCaches=visibleCacheTags.map(tag=>caches.find(c=>c.tag===tag)).filter(Boolean);
      const cacheCards=visibleCaches.map(c=>`<div class="cache-card cache-card-compact"><div class="cache-card-head"><h3 title="${esc(cacheName(c.tag))}">${cacheName(c.tag)}</h3><div class="cache-card-actions"><button class="button small cache-view" data-tag="${c.tag}">查看</button><button class="button small danger cache-clear" data-tag="${c.tag}">清空</button></div></div><div class="cache-stats cache-stats-flat"><div class="cache-stat" title="完整数值：${num(c.q)}"><span>请求总数</span><strong>${num(c.q)}</strong></div><div class="cache-stat" title="完整数值：${num(c.size)}"><span>条目数</span><strong>${num(c.size)}</strong></div><div class="cache-stat" title="完整数值：${pct(c.hit)}"><span>命中率</span><strong>${compactPct(c.hit)}</strong></div><div class="cache-stat" title="完整数值：${pct(c.lazy)}"><span>过期命中</span><strong>${compactPct(c.lazy)}</strong></div></div></div>`);
      const cachePending=cacheLimits&&cacheLimits.restart_needed?'<span class="badge pink" title="缓存参数已保存，重启内核后生效">● 参数待重启</span>':'';
      const cacheSettingsButton=cacheLimits?'<button class="button small" id="cache-settings">缓存参数</button>':'';
      const cacheHeaderActions=`<div class="cache-header-actions"><span class="badge success cache-active-badge">${activeCacheLabel} · ${cacheEnabled?'当前使用':'当前模式'}</span><span class="badge ${cacheEnabled?'success':'danger'}">● 核心缓存${cacheEnabled?'已开启':'已关闭'}</span>${cachePending}${cacheSettingsButton}<button class="button small danger" id="cache-clear-all">全部清空</button></div>`;
      const slot=$('#management-cache-slot');if(!slot)return;
      setHTML(slot, `<section class="card data-cache-panel"><div class="card-header"><div class="card-title"><span class="icon">${icon('data')}</span><div><h2>缓存管理</h2><p>仅显示当前模式对应的全部缓存与国外缓存，界面更紧凑</p></div></div>${cacheHeaderActions}</div><div class="card-body"><div class="cache-grid data-cache-grid">${cacheCards.join('')}</div></div></section>`);
      $('#cache-clear-all')?.addEventListener('click',async()=>{if(!await confirmDialog({message:'确定清空全部 DNS 缓存？将同时清空经典、智能、国内与国外缓存。',danger:true}))return;const ct=caches.map(c=>c.tag);const result=await Promise.allSettled(ct.map(tag=>api.request(`/plugins/${tag}/flush`)));const failed=result.filter(x=>x.status==='rejected').length;failed?toast(`已清空 ${result.length-failed} 个缓存，${failed} 个失败`,'error'):toast(`全部 ${result.length} 个缓存已清空`);renderRoute(true)});
      $$('.cache-clear').forEach(x=>x.onclick=async()=>{if(!await confirmDialog({message:`确定清空 ${cacheName(x.dataset.tag)}？`,danger:true}))return;try{await api.request(`/plugins/${x.dataset.tag}/flush`);toast('缓存已清空');renderRoute(true)}catch(e){toast('清空缓存失败','error',e.message);renderRoute(true)}});
      $$('.cache-view').forEach(x=>x.onclick=async()=>{try{const text=await api.request(`/plugins/${x.dataset.tag}/show`);openDrawer(cacheName(x.dataset.tag),'缓存内容',`<pre>${esc(text)}</pre>`)}catch(e){toast('查看缓存内容失败','error',e.message)}});
      $('#cache-settings')?.addEventListener('click',()=>openCacheSettings(cacheLimits));
    }).catch(e=>{if(isCurrent()&&$('#management-cache-slot'))setHTML($('#management-cache-slot'), card('缓存管理',`<div class="error-panel">加载失败：${esc(e.message)}</div>`,{iconName:'data',className:'data-cache-panel'}));});

    Promise.all([reqStatusPromise,reqCfgPromise]).then(([reqStatus,reqCfg])=>{
      if(!isCurrent())return;
      const slot=$('#management-requery-slot');if(!slot)return;
      const rq=requeryHtml(reqStatus,reqCfg);setHTML(slot, card('刷新分流缓存',rq.body,{iconName:'refresh',subtitle:'重新扫描域名并更新自动生成的分流列表',actions:rq.actions,className:'data-requery-card'}));
      $('#requery-trigger')?.addEventListener('click',async()=>{try{await api.request('/plugins/requery/trigger',{method:'POST'});toast('刷新任务已开始');renderRoute(true)}catch(e){toast('刷新任务开始失败','error',e.message);renderRoute(true)}});
      $('#requery-cancel')?.addEventListener('click',async()=>{try{await api.request('/plugins/requery/cancel',{method:'POST'});toast('已请求取消');renderRoute(true)}catch(e){toast('取消刷新任务失败','error',e.message);renderRoute(true)}});
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

  async function restartService(){if(!await confirmDialog({message:`确定重启 ${identityService?.getName()||'LocalDNS'}？短时间内 DNS 服务会中断。`,danger:true}))return;const scope=currentScope();try{await api.json('/api/v1/system/restart','POST',{delay_ms:500});}catch(e){if(scope.signal.aborted)return;toast('重启服务失败','error',e.message);renderRoute(true);return;}if(scope.signal.aborted)return;toast((identityService?.getName()||'LocalDNS')+' 正在重启');scope.timeout(()=>renderRoute(true),4000);}

export { cacheName, requeryHtml, openRequeryScheduler, countsHtml, multiPluginAction, clearShuntData, switchProfiles, renderManagement, restartService };
