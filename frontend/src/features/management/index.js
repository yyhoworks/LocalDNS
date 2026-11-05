import { taskBody, groupedFeatures, featureSummary, cacheTable } from './layout.js';
import { currentScope } from '../../core/router/route-lifetime';
import { identityService } from '../identity/index.js';
import { proxyPanelService } from '../proxy-panel/index.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { empty, card } from '../../shared/components/templates.js';
import { num, fmtDate, esc } from '../../shared/format/number.js';
import { modalOpen, confirmDialog } from '../../shared/components/dialog.js';
import { toast } from '../../shared/components/toast.js';
import { openCacheDrawer } from './cache-drawer.js';
import { switchProfiles } from './feature-profiles.js';
import { modalClose } from '../../shared/components/dialog.js';
import { $, state, page, $$ } from '../../core/context.js';
import { api } from '../../core/api/api.js';
import { renderRoute } from '../../core/router/router.js';
import { safe, safeResult } from '../../shared/async.js';
import { parseProm } from '../../shared/metrics/prometheus.ts';
import { parseCaches } from '../overview/model.js';
import { icon } from '../../shared/components/icons.js';
import { requestProxyPane } from '../proxy/selection.js';
import { cacheLimitInputSelector, cacheLimitsForm, readCacheLimits, readCacheSettings, readCacheMemory, saveCacheSettings } from './cache-settings';
import { preferences } from '../../core/persistence/preferences';
import { assetHttp } from '../../core/api/network.ts';
import { clearGithubToken, maskToken, RATE_LIMIT_ENDPOINT, readGithubToken, RELEASE_RETRY_KEY, saveGithubToken, tokenProblem } from '../version/github-token';

  const cacheName=t=>({cache_main:'全部缓存',cache_domestic:'国内缓存',cache_foreign:'国外缓存',cache_foreign_ecs:'国外 ECS 缓存'})[t]||t;

  const refreshCats = [
    ['to_proxy', '直连 → 代理', '两次查询都显示应走代理，已改为代理'],
    ['to_direct', '代理 → 直连', '两次查询都显示应走直连，已改为直连'],
    ['other', '其他变化', '涉及「无记录」的改变'],
    ['new', '新学到', '原来没有结论，这次学到了'],
    ['disputed', '有分歧', '两次结果不一致，保持原结论'],
    ['unchanged', '没有变化', '结论和原来一样'],
  ];
  const refreshClass = code => ({ realip: '直连', fakeip: '代理', nodata: '无记录' })[code] || '没有结果';

  // FJMOS 起内核会记录最近一次分流刷新的变化报告（/api/v1/route-refresh/changes）。
  // 旧内核没有这个端点，按 404 处理并提示，不影响刷新任务本身。
  function openRefreshChanges() {
    api.request('/plugins/requery/changes').then(result => {
      const summary = result && result.summary;
      if (!summary) {
        modalOpen('上次刷新的变化', '分流缓存刷新的结果', empty('还没有运行记录'), null, false);
        return;
      }
      const items = result.items || {};
      const when = result.start_time ? `${fmtDate(result.start_time)} — ${fmtDate(result.end_time)}` : '—';
      const stopped = result.stopped ? '<p class="form-note">这次任务中途停止：还没复核的域名保持原来的结论（列在「有分歧」里）。</p>' : '';
      const noEvidence = +summary.no_evidence ? `<p class="form-note">另有 ${num(summary.no_evidence)} 次查询没有可学的结果（名单已决定或上游没回答）。</p>` : '';
      const cats = refreshCats.map(([key, label]) => {
        const count = +summary[key] || 0;
        return `<button type="button" class="rq-cat" data-rq-cat="${key}" ${count > 0 ? '' : 'disabled'}><span>${label}</span><strong>${num(count)}</strong></button>`;
      }).join('');
      const html = `<div class="stack"><p class="form-note">运行时间：${esc(when)}，处理域名 ${num(result.names || 0)} 个。结论要改时约 ${num(result.confirm_wait_seconds || 120)} 秒后复核一次，两次一致才改。</p>${stopped}${noEvidence}<div class="rq-cats">${cats}</div><div id="rq-cat-list"></div></div>`;
      modalOpen('上次刷新的变化', '点一个分类查看具体域名', html, null, false);
      const list = $('#rq-cat-list');
      const paint = key => {
        $$('.rq-cat').forEach(button => button.classList.toggle('active', button.dataset.rqCat === key));
        const rows = items[key] || [];
        if (!rows.length) {
          setHTML(list, empty('这一类没有域名'));
          return;
        }
        const head = key === 'disputed' ? '<th>域名</th><th>类型</th><th>原来</th><th>第一次</th><th>第二次</th>'
          : key === 'new' ? '<th>域名</th><th>类型</th><th>学到</th>'
          : '<th>域名</th><th>类型</th><th>原来</th><th>现在</th>';
        const body = rows.map(row => {
          if (key === 'disputed') {
            const second = row.second === null || row.second === undefined ? (result.stopped ? '未复核' : '没有结果') : refreshClass(row.second);
            return `<tr><td>${esc(row.name)}</td><td>${esc(row.type)}</td><td>${refreshClass(row.old)}</td><td>${refreshClass(row.first)}</td><td>${second}</td></tr>`;
          }
          if (key === 'new') return `<tr><td>${esc(row.name)}</td><td>${esc(row.type)}</td><td>${refreshClass(row.new)}</td></tr>`;
          return `<tr><td>${esc(row.name)}</td><td>${esc(row.type)}</td><td>${refreshClass(row.old)}</td><td>${refreshClass(row.new)}</td></tr>`;
        }).join('');
        const more = (+summary[key] || 0) > rows.length ? `<p class="form-note">共 ${num(summary[key])} 条，只列出前 ${num(rows.length)} 条。</p>` : '';
        setHTML(list, `<div class="table-wrap"><table class="overview-detail-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${more}`);
      };
      $$('.rq-cat').forEach(button => {
        button.onclick = () => { if (!button.disabled) paint(button.dataset.rqCat); };
      });
      const first = refreshCats.find(([key]) => (+summary[key] || 0) > 0 && key !== 'unchanged');
      paint(first ? first[0] : 'unchanged');
    }).catch(error => {
      if (error && (error.status === 404 || error.status === 405)) {
        toast('当前内核没有变化报告（需要 FJMOS 及以上）', 'error');
        return;
      }
      toast('读取变化报告失败', 'error', error && error.message);
    });
  }

  function requeryHtml(s,c){
    if(!s)return {actions:'',body:empty('Requery 插件不可用')};
    const taskState=String(s.task_state||s.status||'idle').toLowerCase();
    const running=s.running===true||['running','processing','cancelling'].includes(taskState);
    const actions=`<button class="button small quiet-action" id="requery-changes" title="查看上次刷新的变化"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h10M4 12h7M4 18h13"/><circle cx="18" cy="7" r="2"/></svg>变化报告</button><button class="button small quiet-action" id="requery-scheduler" title="定时任务设置"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h9M18 8h2M4 16h4M13 16h7"/><circle cx="15.5" cy="8" r="2"/><circle cx="10.5" cy="16" r="2"/></svg>定时设置</button>${running?'<button class="button small danger" id="requery-cancel">取消任务</button>':'<button class="button small primary" id="requery-trigger" title="开始全新任务"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 4.5 19 12 7 19.5Z"/></svg>开始刷新</button>'}`;
    const body=taskBody(s,c);
    return {actions:c?actions:actions.replace('id="requery-scheduler"','id="requery-scheduler" disabled aria-label="定时设置读取失败，请刷新重试"'),body};
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
      const memoryInput=$('#cache-memory-mb');
      const memory=memoryInput?readCacheMemory(memoryInput.value):undefined;
      const result=await saveCacheSettings({read:()=>readCacheSettings(path=>api.request(path)),write:(path,body)=>api.json(path,'POST',body)},payload,memory);
      return ()=>{toast(!result.changed?'缓存参数没有变化':result.settings.restart_needed?'已保存；部分各池参数待重启，内存预算已生效':'缓存参数已保存并核对');renderRoute(true)};
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

  // GitHub 访问：只影响「检查更新」这一条浏览器请求。匿名按出口 IP 每小时 60 次，
  // 填入用户自己的令牌后按该账号额度计算。令牌只存本浏览器，不写服务器配置。
  let githubQuota = null, githubMessage = '';

  function githubAccessHtml() {
    const token = readGithubToken(), has = Boolean(token);
    const actions = `${has ? '<span class="badge success">已设置</span>' : '<span class="badge">未设置</span>'}${has ? '<button class="button small danger" id="github-token-clear">清除令牌</button>' : ''}`;
    const quota = has && githubQuota && githubQuota.limit
      ? ` 最近一次校验：剩余 ${num(githubQuota.remaining)} / ${num(githubQuota.limit)} 次每小时。` : '';
    const status = githubMessage || (has
      ? `已设置令牌 ${maskToken(token)}：检查更新时按你的账号额度请求。${quota}`
      : '未设置令牌：匿名请求按出口 IP 每小时 60 次，多台设备共用同一出口时更容易触发限流。');
    const body = `<div class="github-access">
      <div class="settings-refresh-row github-access-row">
        <input type="password" id="github-token-input" autocomplete="off" spellcheck="false" placeholder="${has ? '已保存令牌，粘贴新令牌可替换' : '粘贴 GitHub 令牌'}" aria-label="GitHub 访问令牌">
        <button type="button" class="button primary" id="github-token-save">保存并校验</button>
        <a class="button" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">创建令牌</a>
      </div>
      <p class="form-note github-access-status${githubMessage ? ' is-error' : ''}" id="github-token-status" role="status">${esc(status)}</p>
      <p class="form-note">令牌只保存在本浏览器，只发送给 api.github.com；不会写入服务器配置，也不随升级包分发。建议创建不授予任何权限的 fine-grained token：公开仓库的发行信息不需要任何权限。</p>
    </div>`;
    return card('GitHub 访问', body, {iconName:'system',subtitle:'检查更新时读取 GitHub 正式发行版，可填入自己的令牌避免匿名限流',actions,className:'github-access-card'});
  }

  function paintGithubSlot() {
    const slot = $('#management-github-slot');
    if (!slot) return;
    const has = Boolean(readGithubToken());
    setHTML(slot, `<section class="card management-github"><div class="management-github-title"><h2>GitHub 访问</h2><span class="badge ${has?'success':''}">${has?'已设置':'未设置'}</span></div><p>${has?'检查更新使用账号额度':'检查更新使用匿名额度'}</p><button class="button small" id="github-access-configure">配置令牌</button></section>`);
    $('#github-access-configure').onclick = openGithubAccess;
    if ($('#management-github-editor')) paintGithubEditor();
  }

  function paintGithubEditor() {
    const editor = $('#management-github-editor');
    if (!editor) return;
    setHTML(editor, githubAccessHtml());
    $('#github-token-save')?.addEventListener('click', saveGithubAccess);
    $('#github-token-clear')?.addEventListener('click', clearGithubAccess);
    $('#github-token-input')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); saveGithubAccess(); }
    });
  }

  function openGithubAccess() {
    modalOpen('GitHub 访问', '配置检查更新使用的访问令牌', '<div id="management-github-editor"></div>', null, false);
    paintGithubEditor();
    $('#github-token-input')?.focus();
  }

  async function saveGithubAccess() {
    const input = $('#github-token-input'), button = $('#github-token-save');
    if (!input || !button || button.disabled) return;
    const value = input.value, problem = tokenProblem(value);
    if (problem) { githubMessage = problem; paintGithubSlot(); return; }
    button.disabled = true; button.textContent = '校验中…';
    try {
      const response = await assetHttp.fetch(RATE_LIMIT_ENDPOINT, {cache:'no-store',credentials:'omit',headers:{Accept:'application/json',Authorization:'Bearer '+value.trim()}});
      if (response.status === 401) { githubMessage = 'GitHub 判定令牌无效或已过期（401），未保存。'; return; }
      if (!response.ok) { githubMessage = `校验令牌失败（HTTP ${response.status}），未保存。`; return; }
      const body = await response.json().catch(() => null);
      try { saveGithubToken(value.trim()); }
      catch { githubMessage = '浏览器未能保存令牌，本次修改不会在刷新后保留。'; return; }
      githubMessage = '';
      githubQuota = {limit:Number(body?.resources?.core?.limit)||0,remaining:Number(body?.resources?.core?.remaining)||0};
      // 令牌自带额度：匿名请求留下的等待时间不再适用，清掉让「检查更新」立刻能重试。
      try { preferences.removeItem(RELEASE_RETRY_KEY); } catch {}
      toast('GitHub 访问令牌已保存');
    } catch { githubMessage = '无法连接 GitHub 或校验超时，请检查网络后重试。'; }
    finally { paintGithubSlot(); }
  }

  function clearGithubAccess() {
    clearGithubToken();
    githubMessage = ''; githubQuota = null;
    paintGithubSlot();
    toast('GitHub 访问令牌已清除');
  }

  async function renderManagement(container, context){
 const renderScope = context.scope, page = container;

    const renderSeq=state.renderSeq;
    const isCurrent=()=>state.route==='management'&&state.renderSeq===renderSeq;
    const tags=switchProfiles.map(x=>x.tag);
    const skeletonBlock=(height=150)=>`<div class="skeleton" style="height:${height}px;border-radius:12px"></div>`;

    setHTML(page, `
    <div class="view-title-row">
      <div style="display:flex;align-items:baseline;gap:12px"><h1>系统</h1><span class="gc-sub">服务、缓存与自动分流维护</span></div>
    </div>
    <div class="management-stack management-balanced">
      <div class="management-top-pair">

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
        <section class="proxy-panel-management" aria-label="代理面板设置">
          <div><h2 data-proxy-panel-name>代理面板</h2><code data-proxy-panel-address></code></div>
          <a class="button small" data-proxy-panel-link target="_blank" rel="noopener noreferrer">打开面板</a>
          <button type="button" class="button small" data-proxy-panel-settings>面板设置</button>
          <button type="button" class="button small" data-route="proxy-config">编辑配置</button>
        </section>
      </div>
      <div class="management-columns">
        <div class="management-main">
          <div id="management-cache-slot" class="management-slot">${card('缓存管理',skeletonBlock(300),{iconName:'data',className:'data-cache-panel'})}</div>
          <section class="card data-requery-card"><div class="card-header"><div class="card-title"><span class="icon">${icon('refresh')}</span><div><h2>自动分流维护</h2><p>定时刷新与域名列表维护</p></div></div><div class="card-actions" id="management-requery-actions"></div></div><div class="card-body">
            <div id="management-requery-slot" class="management-task-data">${skeletonBlock(230)}</div>
            <section class="management-domain-data"><div class="domain-heading"><h3>域名列表统计</h3><span>自动分流数据</span></div><div class="domain-line"><div id="management-counts-slot">${skeletonBlock(40)}</div><div class="domain-actions"><button class="button small" id="save-shunt" title="保存分流规则">保存</button><button class="button small danger quiet-danger" id="clear-shunt" title="清空分流规则">清空</button></div></div></section>
          </div></section>
        </div>
        <div class="management-right">
          <div id="management-feature-slot" class="management-slot">${card('功能设置',skeletonBlock(600),{iconName:'features',subtitle:'按用途分组管理',className:'management-feature-panel'})}</div>
          <div id="management-github-slot" class="management-slot"></div>
        </div>
      </div>
    </div>`);

    $('#management-restart-button')?.addEventListener('click', restartService);
    page.querySelector('[data-route="proxy-config"]')?.addEventListener('click',()=>requestProxyPane('config'));
    proxyPanelService?.sync();
    paintGithubSlot();
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
      const featureHtml=groupedFeatures(switchProfiles,status);
      const featureSlot=$('#management-feature-slot');
      if(featureSlot)setHTML(featureSlot, card('功能设置',featureHtml,{iconName:'features',subtitle:'按用途分组管理',actions:featureSummary(switchProfiles,status),className:'management-feature-panel'}));
      $$('[data-switch]').forEach(x=>x.onchange=async()=>{const tag=x.dataset.switch,val=x.checked?'A':'B';let rollbackNeeded=false;$$('[data-switch]',page).forEach(input=>input.disabled=true);try{await api.json(`/plugins/${tag}/post`,'POST',{value:val});if(x.checked&&(tag==='switch2'||tag==='switch12')){rollbackNeeded=true;const other=tag==='switch2'?'switch12':'switch2';await api.json(`/plugins/${other}/post`,'POST',{value:'B'});}toast('功能状态已保存');renderRoute(true)}catch(e){if(rollbackNeeded){try{await api.json(`/plugins/${tag}/post`,'POST',{value:val==='A'?'B':'A'});}catch{/* 回滚失败时仍用下面的重渲染回读服务端真实状态 */}}toast('切换失败','error',e.message);renderRoute(true)}});
    });

    Promise.all([switchPromise,metricsPromise,cacheSettingsPromise]).then(([status,metricsRaw,cacheSettingsResult])=>{
      if(!isCurrent())return;
      const cacheLimits=cacheSettingsResult.ok?cacheSettingsResult.data:null;
      const metrics=parseProm(metricsRaw),caches=parseCaches(metrics);
      const cacheState=String(status.switch13||'').trim().toUpperCase();
      const visibleCaches=['cache_main','cache_domestic','cache_foreign','cache_foreign_ecs'].map(tag=>caches.find(c=>c.tag===tag)).filter(Boolean);
      const cachePending=cacheLimits&&cacheLimits.restart_needed?'<span class="badge pink" title="缓存参数已保存，重启内核后生效">参数待重启</span>':'';
      const cacheSettingsButton=cacheLimits?'<button class="button small" id="cache-settings">缓存参数</button>':cacheSettingsResult.ok?'':'<span class="cache-settings-error" title="请刷新页面重试">参数读取失败</span>';
      const cacheHeaderActions=`<div class="cache-header-actions">${cachePending}${cacheSettingsButton}<details class="management-more"><summary class="button small quiet-action">更多</summary><div class="management-more-menu"><button class="button small danger" id="cache-clear-all">清空全部缓存</button></div></details></div>`;
      const slot=$('#management-cache-slot');if(!slot)return;
      const cacheStateText=cacheState==='A'?'已开启':cacheState==='B'?'已关闭':'状态未知';
      setHTML(slot, `<section class="card data-cache-panel"><div class="card-header"><div class="card-title"><span class="icon">${icon('data')}</span><div><h2>缓存管理</h2><p>${visibleCaches.length} 个缓存池 · 请求量与命中表现</p></div></div>${cacheHeaderActions}</div><div class="card-body">${cacheTable(visibleCaches,cacheName)}<div class="cache-footnote"><span class="management-status-dot ${cacheState!=='A'?'is-muted':''}"></span><span>核心缓存${cacheStateText}</span><span class="cache-footnote-secondary">${cacheState==='A'?'当前使用全部缓存':'当前模式：全部缓存'}</span></div></div></section>`);
      $('#cache-clear-all')?.addEventListener('click',async()=>{if(!await confirmDialog({message:'确定清空全部 DNS 缓存？后续请求将重新查询上游并建立缓存。',danger:true}))return;const ct=caches.map(c=>c.tag);const result=await Promise.allSettled(ct.map(tag=>api.request(`/plugins/${tag}/flush`)));const failed=result.filter(x=>x.status==='rejected').length;failed?toast(`已清空 ${result.length-failed} 个缓存，${failed} 个失败`,'error'):toast(`全部 ${result.length} 个缓存已清空`);renderRoute(true)});
      $$('.cache-clear').forEach(x=>x.onclick=async()=>{if(!await confirmDialog({message:`确定清空 ${cacheName(x.dataset.tag)}？`,danger:true}))return;try{await api.request(`/plugins/${x.dataset.tag}/flush`);toast('缓存已清空');renderRoute(true)}catch(e){toast('清空缓存失败','error',e.message);renderRoute(true)}});
      $$('.cache-view').forEach(x=>x.onclick=async()=>{try{const text=await api.request(`/plugins/${x.dataset.tag}/show`);openCacheDrawer(cacheName(x.dataset.tag),text)}catch(e){toast('查看缓存内容失败','error',e.message)}});
      $('#cache-settings')?.addEventListener('click',()=>openCacheSettings(cacheLimits));
    }).catch(e=>{if(isCurrent()&&$('#management-cache-slot'))setHTML($('#management-cache-slot'), card('缓存管理',`<div class="error-panel">加载失败：${esc(e.message)}</div>`,{iconName:'data',className:'data-cache-panel'}));});

    function paintTask(reqStatus,reqCfg) {
      if(!isCurrent())return;
      const slot=$('#management-requery-slot');if(!slot)return;
      const rq=requeryHtml(reqStatus,reqCfg);
      setHTML(slot,rq.body);setHTML($('#management-requery-actions'),rq.actions);
      $('#requery-trigger')?.addEventListener('click',async event=>{event.currentTarget.disabled=true;try{await api.request('/plugins/requery/trigger',{method:'POST'});toast('刷新任务已开始');renderRoute(true)}catch(e){toast('刷新任务开始失败','error',e.message);renderRoute(true)}});
      $('#requery-cancel')?.addEventListener('click',async event=>{event.currentTarget.disabled=true;try{await api.request('/plugins/requery/cancel',{method:'POST'});toast('已请求取消');renderRoute(true)}catch(e){toast('取消刷新任务失败','error',e.message);renderRoute(true)}});
      $('#requery-changes')?.addEventListener('click',()=>openRefreshChanges());
      $('#requery-scheduler')?.addEventListener('click',()=>openRequeryScheduler(reqCfg));
    }
    Promise.all([reqStatusPromise,reqCfgPromise]).then(([reqStatus,reqCfg])=>{
      paintTask(reqStatus,reqCfg);
      let latest=reqStatus,pending=false;
      renderScope.interval(async()=>{
        if(!isCurrent()||document.hidden||pending||!(latest?.running||['running','processing','cancelling'].includes(latest?.task_state)))return;
        pending=true;
        try { const result=await api.request('/plugins/requery/status');latest=result;paintTask(result,reqCfg); }
        catch { if(isCurrent()){const label=$('.task-idle');if(label)label.textContent='状态更新失败，等待重试';} }
        finally { pending=false; }
      },3000);
    });

    countsPromise.then(counts=>{
      if(!isCurrent())return;
      const slot=$('#management-counts-slot');if(!slot)return;
      setHTML(slot,countsHtml(counts));
    });
    $('#save-shunt')?.addEventListener('click',()=>multiPluginAction(['domain_stats/save','realip/save','fakeip/save','nodata/save'],'分流规则已保存'));
    $('#clear-shunt')?.addEventListener('click',()=>clearShuntData());
    const closeMenus=event=>{
      page.querySelectorAll('.management-more[open]').forEach(menu=>{if(event.type==='keydown'||!menu.contains(event.target))menu.removeAttribute('open');});
    };
    const onEscape=event=>{if(event.key==='Escape')closeMenus(event);};
    document.addEventListener('click',closeMenus);
    document.addEventListener('keydown',onEscape);
    renderScope.add(()=>{document.removeEventListener('click',closeMenus);document.removeEventListener('keydown',onEscape);});
  }

  async function restartService(){if(!await confirmDialog({message:`确定重启 ${identityService?.getName()||'LocalDNS'}？短时间内 DNS 服务会中断。`,danger:true}))return;const scope=currentScope();try{await api.json('/api/v1/system/restart','POST',{delay_ms:500});}catch(e){if(scope.signal.aborted)return;toast('重启服务失败','error',e.message);renderRoute(true);return;}if(scope.signal.aborted)return;toast((identityService?.getName()||'LocalDNS')+' 正在重启');scope.timeout(()=>renderRoute(true),4000);}

export { cacheName, requeryHtml, openRequeryScheduler, countsHtml, multiPluginAction, clearShuntData, switchProfiles, renderManagement, restartService, githubAccessHtml };
