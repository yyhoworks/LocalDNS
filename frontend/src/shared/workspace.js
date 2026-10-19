import { rankLatencyService } from '../features/overview/ranking/latency.js';
import { overviewInsightsService } from '../features/overview/insights.js';
import { setHTML } from '../core/security/safe-dom.ts';
import { preferences, sessionPreferences } from '../core/persistence/preferences.ts';
export let workspaceService;
export function initialize() {

  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => Number(value || 0).toLocaleString('zh-CN');
  const percent = (n,d) => Number(d) > 0 ? (Number(n || 0) / Number(d) * 100).toFixed(1) + '%' : '—';
  const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`;
  const keyFields = ['q','type','set','code','client','exact'];
  let ctx, ruleFilter = {q:'',group:'全部'}, modalController;
  const store = {
    get(key, fallback) { try {const v = JSON.parse(preferences.getItem('localdns-workspace:' + (ctx?.apiBase || location.host) + ':' + key)); return v ?? fallback;} catch {return fallback;} },
    set(key, value) { try {preferences.setItem('localdns-workspace:' + (ctx?.apiBase || location.host) + ':' + key, JSON.stringify(value)); return true;} catch {return false;} }
  };
  function cleanFilter(value = {}) { return Object.fromEntries(keyFields.map(key => [key, key === 'exact' ? value[key] === true : typeof value[key] === 'string' ? value[key].slice(0,2000) : ''])); }
  function views() {
    const saved = store.get('query-views', null);
    return Array.isArray(saved) ? saved.filter(v => v && typeof v.name === 'string' && v.filter && typeof v.filter === 'object').slice(0,12).map(v => ({name:v.name.slice(0,40),filter:cleanFilter(v.filter)})) : [{name:'SERVFAIL',filter:cleanFilter({code:'SERVFAIL'})},{name:'AAAA 请求',filter:cleanFilter({type:'AAAA'})}];
  }
  function columns() { const value = store.get('query-columns',{}); return Object.fromEntries(['type','set','client','code'].map(k=>[k,value?.[k] !== false])); }
  function applyColumns(root) {
    const cols = columns(), mapping = {type:2,set:3,client:5,code:6};
    root.querySelectorAll('.workspace-log-table tr').forEach(row => Object.entries(mapping).forEach(([key,index]) => {if(row.children[index] && row.children.length === 8)row.children[index].hidden = !cols[key];}));
  }
  function logTools(filter) {
    const labels = {q:'搜索',type:'类型',set:'分流',code:'响应码',client:'客户端包含',exact:'精确匹配'}, cols = columns();
    return `<details class="workspace-log-extras" ${matchMedia('(max-width:600px)').matches?'':'open'}><summary>常用筛选与显示设置</summary><div class="workspace-saved"><span>常用筛选</span>${views().map((v,i)=>`<button type="button" class="glass-btn" data-query-view="${i}">${esc(v.name)}</button>`).join('')}<button type="button" class="glass-btn" id="log-save-view">保存当前条件</button></div><div class="workspace-log-tools"><span id="log-live-state">${ctx.state.logsPaused ? '刷新已暂停' : '自动刷新已开启'}</span><div><details class="workspace-columns"><summary>显示列</summary><div>${Object.entries({type:'类型',set:'分流',client:'客户端',code:'响应码'}).map(([k,name])=>`<label><input type="checkbox" data-query-column="${k}" ${cols[k] ? 'checked' : ''}>${name}</label>`).join('')}</div></details><button type="button" class="glass-btn" id="log-export">导出当前页</button></div></div></details><div class="workspace-filter-chips">${keyFields.filter(k=>filter[k]).map(k=>`<button type="button" data-clear-query="${k}" aria-label="移除${labels[k]}筛选">${labels[k]}${k === 'exact' ? '' : '：' + esc(filter[k])}<span aria-hidden="true"> ×</span></button>`).join('')}</div>`;
  }
  function bindLogs(root, rows) {
    applyColumns(root);
    root.querySelectorAll('[data-query-view]').forEach(b=>b.onclick=()=>{Object.assign(ctx.state.logs,{page:1,...views()[Number(b.dataset.queryView)].filter});ctx.renderRoute(true);});
    root.querySelectorAll('[data-clear-query]').forEach(b=>b.onclick=()=>{ctx.state.logs[b.dataset.clearQuery]=b.dataset.clearQuery==='exact'?false:'';ctx.state.logs.page=1;ctx.renderRoute(true);});
    root.querySelectorAll('[data-query-column]').forEach(input=>input.onchange=()=>{const next=columns();next[input.dataset.queryColumn]=input.checked;if(!store.set('query-columns',next))ctx.toast('显示列偏好无法保存','error');applyColumns(root);});
    root.querySelector('#log-save-view').onclick=()=>ctx.modalOpen('保存筛选','仅保存在当前浏览器',`<div class="field"><label for="query-view-name">名称</label><input id="query-view-name" maxlength="40" placeholder="例如：工作电脑的失败查询"></div>`,async()=>{const name=document.querySelector('#query-view-name').value.trim();if(!name)throw new Error('请填写筛选名称');const saved=[{name,filter:cleanFilter(ctx.state.logs)},...views().filter(v=>v.name!==name)].slice(0,12);if(!store.set('query-views',saved))throw new Error('浏览器无法保存，请检查存储空间');ctx.toast('筛选已保存');ctx.renderRoute(true);});
    root.querySelector('#log-export').onclick=()=>ctx.downloadText('LocalDNS-query-page-'+ctx.state.logs.page+'.json',JSON.stringify(rows,null,2));
    root.querySelector('#log-pause').onclick=()=>{ctx.state.logsPaused=!ctx.state.logsPaused;root.querySelector('#log-pause').textContent=ctx.state.logsPaused?'继续刷新':'暂停刷新';root.querySelector('#log-pause').setAttribute('aria-pressed',String(ctx.state.logsPaused));root.querySelector('#log-live-state').textContent=ctx.state.logsPaused?'刷新已暂停':'自动刷新已开启';};
  }
  let rankLatency;
  const latency = row => row.average_duration_ms !== undefined && row.average_duration_ms !== null && row.average_duration_ms !== '' && Number.isFinite(Number(row.average_duration_ms)) ? ctx.ms(row.average_duration_ms) : null;
  function latencyCell(kind, item) {
    const provided = latency(item);
    return `<td data-rank-latency-kind="${kind}" data-rank-latency-key="${esc(item.key)}"${provided ? ' data-latency-ready="true" title="后端排行统计"' : ''}>${provided || '<button type="button" class="workspace-text-button" data-load-rank-latency>查看延时</button>'}</td>`;
  }
  function hydrateRankLatency(root) {
    const cells = [...root.querySelectorAll('[data-rank-latency-kind]:not([data-latency-ready])')];
    if (!cells.length) return;
    rankLatency ||= rankLatencyService.create(options => ctx.loadLogs(options));
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { observer.unobserve(entry.target); load(entry.target); }
    }), {rootMargin:'120px'});
    async function load(cell) {
      if (cell.dataset.latencyReady || cell.dataset.latencyLoading) return;
      cell.dataset.latencyLoading = 'true';
      cell.textContent = '统计中…';
      try {
        const result = await rankLatency.get(cell.dataset.rankLatencyKind, cell.dataset.rankLatencyKey, () => cell.isConnected);
        if (!cell.isConnected) return;
        cell.dataset.latencyReady = 'true';
        cell.textContent = result.average === null ? '暂无样本' : ctx.ms(result.average);
        cell.title = result.average === null ? '该分类暂无有效请求耗时，未用 0 代替缺失数据' : `${result.partial ? '近期' : '当前保留'} ${number(result.samples)} 条有效请求的平均耗时；含缓存与本地应答`;
        if (result.partial && result.samples) {
          const note = document.createElement('span');
          note.className = 'workspace-subline';
          note.textContent = `近 ${number(result.samples)} 条`;
          cell.append(note);
        }
      } catch (error) {
        if (cell.isConnected && error.name !== 'AbortError') {
          setHTML(cell, '<button type="button" class="workspace-text-button" data-load-rank-latency>重试</button>');
          cell.title = '请求耗时读取失败，点击重试';
        }
      } finally { delete cell.dataset.latencyLoading; }
    }
    cells.forEach(cell => { observer.observe(cell); cell.onclick = event => { if (event.target.closest('[data-load-rank-latency]')) load(cell); }; });
    ctx.trackRouteCleanup(() => observer.disconnect());
  }
  function rankTable(kind, items, aliases = {}, limit = 8) {
    const label = item => kind === 'client' ? aliases[item.key] || item.key
      : kind === 'set' ? overviewInsightsService.label(item.key) : item.key;
    return `<div class="table-wrap"><table class="workspace-rank-table"><thead><tr><th scope="col">${{domain:'域名',client:'客户端',set:'解析去向'}[kind]}</th><th scope="col">请求数</th><th scope="col">平均延时</th></tr></thead><tbody>${items.slice(0,limit).map(item=>`<tr><td><button type="button" class="workspace-text-button" data-rank-kind="${kind}" data-rank-key="${esc(item.key)}" title="${esc(item.key)}">${esc(label(item))}</button>${kind==='client'&&aliases[item.key]?`<span class="workspace-subline mono">${esc(item.key)}</span>`:''}</td><td>${number(item.count)}</td>${latencyCell(kind,item)}</tr>`).join('')||'<tr><td colspan="3" class="table-empty">暂无记录</td></tr>'}</tbody></table></div>`;
  }
  function rankings({domains,clients,sets,total,aliases}) {
    const limit = matchMedia('(max-width:600px)').matches ? 5 : 8;
    return `<div class="workspace-rank-period"><span>当前审计保留记录</span><span>总请求 ${number(total)}</span></div><div class="workspace-rank-grid">${[['domain','TOP 域名',domains],['client','TOP 客户端',clients],['set','解析去向',sets]].map(([kind,name,items])=>`<section class="glass-card workspace-rank-card"><header class="gc-head"><div><h2 class="gc-title">${name}</h2><p class="workspace-subline">显示前 ${Math.min(limit,items.length)} · ${percent(items.slice(0,limit).reduce((n,r)=>n+Number(r.count||0),0),total)}</p></div><button type="button" class="workspace-text-button" data-rank-all="${kind}">更多</button></header>${rankTable(kind,items,aliases,limit)}</section>`).join('')}</div><details class="workspace-note"><summary>统计口径</summary><p>请求数来自当前审计保留记录。平均延时优先使用后端统计；未提供时，按每项最近最多 1,000 条请求日志计算，超过范围时标注样本数，结果缓存 60 秒。含缓存命中与本地应答的真实请求耗时，不等同于上游响应时间；0.00 ms 表示请求日志记录为 0 毫秒。</p></details>`;
  }
  function rankNavigate(kind,key) {Object.assign(ctx.state.logs,{page:1,q:'',client:'',set:'',code:'',type:'',exact:false},kind==='client'?{client:key,q:key,exact:true}:kind==='set'?{set:key}:{q:key,exact:true});ctx.navigate('logs');}
  function bindRanks(root,data) {
    hydrateRankLatency(root);
    root.querySelectorAll('[data-rank-kind]').forEach(b=>b.onclick=()=>rankNavigate(b.dataset.rankKind,b.dataset.rankKey));
    root.querySelectorAll('[data-rank-all]').forEach(b=>b.onclick=()=>{const kind=b.dataset.rankAll,items=({domain:data.domains,client:data.clients,set:data.sets})[kind];ctx.openDrawer(({domain:'域名排行',client:'客户端排行',set:'解析去向'})[kind],'当前审计保留记录 · 最多 '+items.length+' 项',rankTable(kind,items,data.aliases,items.length));hydrateRankLatency(document.querySelector('#drawer'));document.querySelectorAll('#drawer [data-rank-kind]').forEach(button=>button.onclick=()=>{ctx.closeDrawer();rankNavigate(button.dataset.rankKind,button.dataset.rankKey);});});
  }
  function upstreams(rows,groups) {
    const total=rows.reduce((n,r)=>n+Number(r.m.q||0),0);
    return `<div class="workspace-upstream-groups">${groups.map(group=>{const items=rows.filter(r=>r.g===group),q=items.reduce((n,r)=>n+Number(r.m.q||0),0);return `<section class="glass-card workspace-upstream-group"><header class="gc-head"><div><h2 class="gc-title">${esc(ctx.groupName(group))}</h2><span class="workspace-subline">${items.filter(r=>r.u.enabled!==false).length} 个启用节点</span></div><span class="workspace-upstream-total">${number(q)} 次 · ${percent(q,total)}</span></header><div class="table-wrap"><table class="workspace-upstream-table"><thead><tr><th>启用</th><th>节点 / 协议 / 地址</th><th>请求数</th><th>平均响应</th><th>采纳率</th><th>错误</th><th>成功率</th><th>操作</th></tr></thead><tbody>${items.map(({g,u,i,m})=>`<tr data-group="${esc(g)}" data-index="${i}"><td><label class="switch"><input class="up-toggle" type="checkbox" aria-label="启用 ${esc(u.tag)}" ${u.enabled!==false?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span></label></td><td><strong>${esc(u.tag)}</strong> ${badge(u.protocol)}<span class="workspace-subline mono">${esc(u.addr||u.server_addr||'—')}</span></td><td>${number(m.q)}<span class="workspace-subline">${percent(m.q,total)}</span></td><td>${m.latencySamples>0?ctx.ms(m.latency):'—'}</td><td>${percent(m.win,m.q)}</td><td>${m.err?`<button type="button" class="up-error-detail-trigger" data-group="${esc(g)}" data-index="${i}" aria-label="查看 ${esc(u.tag)} 错误详情">${number(m.err)}</button>`:'0'}</td><td>${m.q>0&&m.success!==null?ctx.pct(m.success):'—'}</td><td><div class="workspace-actions"><button type="button" class="button small up-edit">编辑</button><button type="button" class="button small danger up-delete">删除</button></div></td></tr>`).join('')||'<tr><td colspan="8" class="table-empty">暂无上游节点</td></tr>'}</tbody></table></div></section>`;}).join('')}</div><details class="workspace-note"><summary>统计口径</summary><p>份额按节点请求总数计算，并发可能计入多个节点。采纳率 = 采纳数 / 节点请求数；成功率与采纳率分别统计。无样本时显示“—”。</p></details>`;
  }
  const purpose = r => ['custom_cn','geosite_cn','geoip_cn'].includes(r.tag) ? '国内解析' : '海外解析';
  function diversionList(rows, format) {
    return `<div class="table-wrap collection-diversion-wrap"><table class="collection-diversion-table"><thead><tr>${['启用','类型','名称','格式','订阅地址','规则数','自动更新','上次更新','操作'].map(name=>`<th scope="col">${name}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr class="collection-diversion-row" data-tag="${esc(r.tag)}" data-name="${esc(r.name)}" data-purpose="${purpose(r)}" data-search="${esc([r.name,r.group,r.url,r.files].join(' ').toLowerCase())}"><td><label class="switch"><input class="div-enable" type="checkbox" aria-label="启用 ${esc(r.name)}" ${r.enabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span></label></td><td>${esc(r.group)}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(format(r))}</td><td><div class="collection-source" title="${esc(r.url||r.files||'')}">${esc(r.url||r.files||'未配置来源')}</div></td><td>${r.rule_count!==undefined?number(r.rule_count):'—'}</td><td>${r.auto_update?'是':'否'}</td><td>${esc(ctx.fmtDate(r.last_updated||r.updated_at))}</td><td><div class="workspace-actions"><button type="button" class="button small div-detail">详情</button><button type="button" class="button small div-update">更新</button><button type="button" class="button small div-edit">编辑</button><button type="button" class="button small danger div-delete">删除</button></div></td></tr>`).join('')}</tbody></table></div>`;
  }
  function diversion(rows, errors, format) {
    return `${errors.length?`<div class="error-panel">${errors.map(x=>esc(x.def.label)+'：'+esc(x.error?.message||'读取失败')).join('；')}</div>`:''}<div class="workspace-rule-filter"><input id="div-search" aria-label="搜索在线规则" placeholder="搜索名称、类型或来源" value="${esc(ruleFilter.q)}"><div class="workspace-filter-buttons" role="group" aria-label="规则用途">${['全部','国内解析','海外解析'].map(g=>`<button type="button" class="glass-btn" data-div-purpose="${g}" aria-pressed="${ruleFilter.group===g}">${g}</button>`).join('')}</div></div><div data-collection-view="cards">${['国内解析','海外解析'].map(group=>`<section class="workspace-rule-group" data-purpose-group="${group}"><header><h3>${group}</h3><span>${rows.filter(r=>purpose(r)===group).length} 个来源</span></header><div class="workspace-rule-grid">${rows.filter(r=>purpose(r)===group).map(r=>`<article class="workspace-rule-card" data-tag="${esc(r.tag)}" data-name="${esc(r.name)}" data-purpose="${group}" data-search="${esc([r.name,r.group,r.url,r.files].join(' ').toLowerCase())}"><header><div><h3>${esc(r.name)}</h3><span class="workspace-subline">${esc(r.group)}</span></div><label class="switch"><input class="div-enable" type="checkbox" aria-label="启用 ${esc(r.name)}" ${r.enabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span></label></header><p class="workspace-rule-source" title="${esc(r.url||r.files||'')}">${esc(r.url||r.files||'未配置来源')}</p><div class="workspace-rule-facts">${badge(format(r))}<span>${r.rule_count!==undefined?number(r.rule_count)+' 条':'数量未记录'}</span>${badge(r.enabled?'已启用':'已关闭',r.enabled?'success':'')}</div><footer><span>${r.last_error?esc(r.last_error):esc(ctx.fmtDate(r.last_updated||r.updated_at))}</span><button type="button" class="button small div-detail">查看详情</button></footer><div class="workspace-rule-actions"><button type="button" class="button small div-update">更新</button><button type="button" class="button small div-edit">编辑</button><button type="button" class="button small danger div-delete">删除</button></div></article>`).join('')}</div></section>`).join('')}</div><div data-collection-view="list">${diversionList(rows,format)}</div><p id="div-empty" class="workspace-empty" hidden>没有匹配的规则，试试其他名称或用途。</p>`;
  }
  function bindDiversion(root) {
    const apply=()=>{let total=0;root.querySelectorAll('.workspace-rule-card,.collection-diversion-row').forEach(card=>{card.hidden=!!((ruleFilter.group!=='全部'&&card.dataset.purpose!==ruleFilter.group)||(ruleFilter.q&&!card.dataset.search.includes(ruleFilter.q.toLowerCase())));if(!card.hidden)total++;});root.querySelectorAll('[data-purpose-group]').forEach(group=>group.hidden=![...group.querySelectorAll('.workspace-rule-card')].some(c=>!c.hidden));root.querySelector('#div-empty').hidden=total>0;root.querySelector('.collection-diversion-wrap').hidden=total===0;root.querySelectorAll('[data-div-purpose]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.divPurpose===ruleFilter.group)));};
    root.querySelector('#div-search').oninput=e=>{ruleFilter.q=e.target.value.trim();apply();};root.querySelectorAll('[data-div-purpose]').forEach(b=>b.onclick=()=>{ruleFilter.group=b.dataset.divPurpose;apply();});apply();
  }
  function ruleDetails(rule, edit, format) {
    const draw=tab=>{const values=tab==='content'?[['格式',format(rule)],['规则数量',rule.rule_count===undefined?'未记录':number(rule.rule_count)],['源缓存文件',rule.files||rule.path||'未记录']]:tab==='source'?[['订阅地址',rule.url||'未配置'],['用途',purpose(rule)],['类型',rule.group]]:tab==='update'?[['上次更新',ctx.fmtDate(rule.last_updated||rule.updated_at)],['自动更新',rule.auto_update?'已开启':'已关闭'],['更新间隔',rule.update_interval_hours+' 小时'],['上次错误',rule.last_error||'未记录']]:[['名称',rule.name],['启用状态',rule.enabled?'已启用':'已关闭'],['数据集',rule.dataset||'自动识别']];ctx.openDrawer(rule.name,'在线分流规则',`<div class="workspace-detail-tabs" role="group" aria-label="规则详情">${[['content','内容'],['source','来源'],['update','更新'],['advanced','高级']].map(([id,name])=>`<button type="button" class="glass-btn" data-rule-detail-tab="${id}" aria-pressed="${tab===id}">${name}</button>`).join('')}</div><dl class="workspace-facts">${values.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${tab==='content'?'<p class="workspace-note-text">编译后的规则由订阅生成；修改内容请编辑订阅来源或本地名单。</p>':''}<button type="button" class="button primary" id="rule-detail-edit">编辑订阅</button>`);document.querySelectorAll('[data-rule-detail-tab]').forEach(b=>b.onclick=()=>draw(b.dataset.ruleDetailTab));document.querySelector('#rule-detail-edit').onclick=()=>{ctx.closeDrawer();edit();};document.querySelector('[data-rule-detail-tab="'+tab+'"]')?.focus({preventScroll:true});};draw('content');
  }
  const draftKey = rule => 'localdns-subscription-draft:'+(ctx?.apiBase||location.host)+':'+(rule?rule.tag+':'+rule.name:'new');
  function clearRuleDraft(rule) {try {sessionPreferences.removeItem(draftKey(rule));} catch {}}
  function trackRuleDraft(rule) {
    modalController?.abort();modalController=new AbortController();
    const root=document.querySelector('#modal-content'), fields=['name','type','url','files','enabled','auto','hours'];
    const snapshot=()=>Object.fromEntries(fields.map(k=>{const el=root.querySelector('#div-'+k);return[k,el.type==='checkbox'?el.checked:el.value];}));
    const baseline=JSON.stringify(snapshot()),key=draftKey(rule);
    try {const saved=JSON.parse(sessionPreferences.getItem(key));if(saved)fields.forEach(k=>{const el=root.querySelector('#div-'+k);if(typeof saved[k] === (el.type==='checkbox'?'boolean':'string')){if(el.type==='checkbox')el.checked=saved[k];else el.value=saved[k];}});} catch {}
    const status=document.createElement('p');status.className='workspace-draft-state';status.setAttribute('role','status');root.prepend(status);
    const save=()=>{if(!fields.every(k=>root.querySelector('#div-'+k))){modalController?.abort();return;}const next=snapshot(),dirty=JSON.stringify(next)!==baseline;try{if(dirty)sessionPreferences.setItem(key,JSON.stringify(next));else sessionPreferences.removeItem(key);status.textContent=dirty?'未保存草稿 · 本次浏览器会话中保留':'未修改';}catch{status.textContent=dirty?'未保存修改 · 浏览器无法保留草稿':'未修改';}};
    root.addEventListener('input',save,{signal:modalController.signal});root.addEventListener('change',save,{signal:modalController.signal});save();
  }
  function finish(root) {
    const title=root.querySelector('.view-title-row');if(title){title.classList.add('workspace-page-tools');title.hidden=ctx.state.route==='overview'||(!title.querySelector('h1')&&!title.querySelector('button'));}
    root.querySelectorAll('.workspace-upstream-table,.workspace-rank-table').forEach(t=>t.classList.remove('mobile-records'));
  }
  function topology(root, redraw, sets) {
    const wrap=root.querySelector('#topo-stage-wrap');if(!wrap)return;
    let toolbar=root.querySelector('.workspace-topology-tools');if(!toolbar){toolbar=document.createElement('div');toolbar.className='workspace-topology-tools';wrap.closest('.topology-glass-card').prepend(toolbar);}
    const choices=[['r1','国内解析'],['r3','海外解析'],['r4','FakeIP'],['r6','本地拦截']];
    const patterns={r1:/^(domestic|geosite_cn|custom_cn)$|国内/i,r2:/^(whitelist|custom_cn)$|白名单/i,r3:/foreign|non_cn|海外|国外/i,r4:/fakeip|grey|灰/i,r5:/adguard|广告/i,r6:/block|black|拦截/i,g1:/^domestic$|国内/i,g2:/^foreign$|海外|国外/i,g3:/foreign_ecs/i,g4:/proxy|fakeip/i,g5:/block|adguard|拦截/i};
    const update=()=>{const id=ctx.state.overviewTopoLock,keys=patterns[id]?(sets||[]).filter(x=>patterns[id].test(x.key)).map(x=>x.key):[];setHTML(toolbar, `<div class="workspace-filter-buttons" role="group" aria-label="锁定解析分支">${choices.map(([key,name])=>`<button type="button" class="glass-btn" data-topology-lock="${key}" aria-pressed="${id===key}">${name}</button>`).join('')}<button type="button" class="glass-btn" data-topology-clear>全部路径</button></div><div class="workspace-topology-status"><span>${id?'已锁定：'+esc(root.querySelector('[data-node-id="'+id+'"] .tn-name')?.textContent||id):'选择分支或节点锁定路径'}</span><div class="workspace-actions"><button type="button" class="glass-btn" data-topology-node ${id?'':'disabled'}>节点详情</button><button type="button" class="glass-btn" data-topology-queries ${keys.length?'':'disabled'} title="${keys.length?'查看对应分类':'当前没有可对应的日志分类'}">相关查询</button></div></div>`);toolbar.querySelectorAll('[data-topology-lock]').forEach(b=>b.onclick=()=>{ctx.state.overviewTopoLock=id===b.dataset.topologyLock?null:b.dataset.topologyLock;redraw();update();});toolbar.querySelector('[data-topology-clear]').onclick=()=>{ctx.state.overviewTopoLock=null;redraw();update();};toolbar.querySelector('[data-topology-node]').onclick=()=>{const node=root.querySelector('[data-node-id="'+id+'"]');if(!node)return;const handler=node.onclick;node.onclick=node._workspaceOriginalClick||null;node.click();node.onclick=handler;};toolbar.querySelector('[data-topology-queries]').onclick=()=>{if(keys.length===1)rankNavigate('set',keys[0]);else{ctx.openDrawer('相关查询','选择已记录的分流分类',keys.map(key=>`<button type="button" class="button" data-topology-set="${esc(key)}">${esc(key)}</button>`).join(''));document.querySelectorAll('[data-topology-set]').forEach(b=>b.onclick=()=>{ctx.closeDrawer();rankNavigate('set',b.dataset.topologySet);});}};};
    root.querySelectorAll('.t-node').forEach(node=>{node._workspaceOriginalClick=node.onclick;node.onclick=e=>{e.stopPropagation();ctx.state.overviewTopoLock=ctx.state.overviewTopoLock===node.dataset.nodeId?null:node.dataset.nodeId;redraw();update();};});
    const onKey=e=>{if(e.key==='Escape'&&!document.querySelector('.drawer.open,dialog[open]')){ctx.state.overviewTopoLock=null;redraw();update();}};root.addEventListener('keydown',onKey);ctx.trackRouteCleanup(()=>root.removeEventListener('keydown',onKey));update();
  }
  workspaceService ={setup:options=>{ctx=options;},logTools,bindLogs,rankings,bindRanks,upstreams,diversion,bindDiversion,ruleDetails,trackRuleDraft,clearRuleDraft,modalChanging:()=>modalController?.abort(),finish,topology};

}
