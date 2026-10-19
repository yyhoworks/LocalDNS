import { clientAliases } from '../logs/aliases.js';
import { currentScope } from '../../core/router/route-lifetime';
import { queryPathService } from '../overview/query-path.js';
import { overviewInsightsService } from '../overview/insights.js';
import { workspaceService } from '../../shared/workspace.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { esc, fmtDate, ms, num } from '../../shared/format/number.js';
import { state, page, $, $$ } from '../../core/context.js';
import { readLogs } from './api.js';
import { loadAliases } from './aliases.js';
import { card } from '../../shared/components/templates.js';
import { icon } from '../../shared/components/icons.js';
import { renderRoute } from '../../core/router/router.js';
import { openAuditModal } from '../management/index.js';
import { openAliasModal } from './aliases.js';
import { openDrawer } from '../../shared/components/drawer.js';

  function logBadge(set){const s=String(set||'未分类');let cls='primary';if(/黑|BAN|BLOCK|拒绝/i.test(s))cls='danger';else if(/白|直连|国内|REAL/i.test(s))cls='success';else if(/灰|代理|订阅/i.test(s))cls='pink';else if(/FAKE/i.test(s))cls='cyan';return `<span class="badge ${cls}" title="${esc(s)}">${esc(overviewInsightsService.label(s))}</span>`;}

  function logRow(view){return `<tr data-log='${esc(JSON.stringify(view.record))}'><td title="${esc(view.time)}"><span class="log-time-full">${view.time}</span><span class="log-time-mobile">${esc(view.mobileTime)}</span></td><td class="td-domain" data-qtype="${esc(view.type)}" data-qtype-short="${esc(view.shortType)}" data-blocked="${view.blocked?1:0}"><strong class="copyable" role="button" tabindex="0" data-copy="${esc(view.domain)}" title="点击复制域名">${esc(view.domain)}</strong><div style="color:var(--muted);font-size:11px;max-width:360px;overflow:hidden;text-overflow:ellipsis">${esc(view.answer)}</div></td><td>${esc(view.queryType)}</td><td>${logBadge(view.set)}</td><td>${ms(view.duration)}</td><td><span class="copyable value-chip" role="button" tabindex="0" data-copy="${esc(view.client)}" title="点击复制客户端 IP">${esc(view.clientLabel)}</span></td><td><span class="badge ${view.success?'success':'danger'}">${esc(view.code)}</span></td><td><button class="icon-button row-action log-detail" type="button" aria-label="查看查询详情" title="查看详情"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.6"/></svg></button></td></tr>`;}

  async function renderLogs(container, context){
 const renderScope = context.scope, page = container;

    const p=state.logs;
    await loadAliases(renderScope);
    const data=await readLogs(p,clientAliases,renderScope);
    const rows=data.rows,filters=data.filters;
    const topPager = `<div class="logs-top-pagination">${paginationHtml(data.pagination)}</div>`;
    const choices=(items,selected)=>[...new Set([...(items||[]),selected].filter(Boolean))].sort();
    const options=(items,value,label)=>`<option value="">${label}</option>${choices(items,value).map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v)}</option>`).join('')}`;
    setHTML(page, `<div class="view-title-row"><div><h1>查询日志</h1></div><div class="workspace-actions"><button type="button" class="glass-btn" id="log-pause" aria-pressed="${!!state.logsPaused}">${state.logsPaused?'继续刷新':'暂停刷新'}</button><button type="button" class="glass-btn" id="audit-control">审计控制</button><button type="button" class="glass-btn" id="alias-control">客户端管理</button></div></div>
    ${card('查询与过滤',`<div class="log-filter-bar"><div class="lf-search"><span class="search-icon">${icon('search')}</span><input id="log-q" value="${esc(p.q)}" placeholder="域名、IP、响应值" aria-label="搜索查询"></div><select id="log-type" aria-label="请求类型">${options(filters.query_types,p.type,'全部类型')}</select><select id="log-set" aria-label="分流结果">${options(filters.domain_sets,p.set,'全部分流')}</select><button type="button" class="lf-more" id="lf-more" aria-expanded="${!!(p.code||p.client||p.exact)}" aria-controls="log-filter-more">更多筛选</button><button type="button" class="lf-reset" id="lf-reset">重置</button><button type="button" class="button primary" id="log-search">查询</button></div><div class="log-filter-more" id="log-filter-more" ${p.code||p.client||p.exact?'':'hidden'}><div class="field"><label for="log-code">响应码</label><select id="log-code">${options(filters.response_codes,p.code,'全部响应码')}</select></div><div class="field"><label for="log-client">客户端</label><input id="log-client" value="${esc(p.client)}" placeholder="客户端 IP"></div><label class="switch"><input id="log-exact" type="checkbox" ${p.exact?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">精确匹配</span></label></div>${workspaceService.logTools(p)}`,{iconName:'logs'})}
    ${card('DNS 请求记录',`${topPager}<div class="table-wrap"><table class="workspace-log-table"><thead><tr><th>时间</th><th>域名 / 响应</th><th>类型</th><th>分流</th><th>耗时</th><th>客户端</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.length?rows.map(logRow).join(''):'<tr><td colspan="8" class="table-empty">没有符合条件的记录</td></tr>'}</tbody></table></div>${paginationHtml(data.pagination)}`,{iconName:'logs',subtitle:`共 ${num(data.pagination?.total_items||0)} 条 · 第 ${num(data.pagination?.current_page||1)} / ${num(data.pagination?.total_pages||1)} 页`})}`);
    $('#log-search').onclick=()=>{Object.assign(p,{page:1,q:$('#log-q').value.trim(),type:$('#log-type').value,set:$('#log-set').value,code:$('#log-code').value,client:$('#log-client').value.trim(),exact:$('#log-exact').checked});renderRoute(true);};
    $('#log-q').onkeydown=e=>{if(e.key==='Enter')$('#log-search').click();};
    $('#lf-more').onclick=()=>{const box=$('#log-filter-more');box.hidden=!box.hidden;$('#lf-more').setAttribute('aria-expanded',String(!box.hidden));};
    $('#lf-reset').onclick=()=>{Object.assign(p,{page:1,q:'',type:'',set:'',code:'',client:'',exact:false});renderRoute(true);};
    $$('.log-detail',page).forEach(b=>b.onclick=()=>openLogPath(JSON.parse(b.closest('tr').dataset.log)));
    $$('.pagination button[data-page]',page).forEach(b=>b.onclick=()=>{p.page=+b.dataset.page;renderRoute(true);});
    $('#audit-control').onclick=openAuditModal;$('#alias-control').onclick=openAliasModal;
    workspaceService.bindLogs(page,data.records);
  }

  function openLogPath(record){openDrawer('解析路径',record.query_name,logDetailHtml(record));queryPathService.bind($('#drawer-content'),record,clientAliases);}

  function paginationHtml(p){if(!p||p.total_pages<=1)return'';const cur=p.current_page,total=p.total_pages;let arr=[];for(let i=Math.max(1,cur-2);i<=Math.min(total,cur+2);i++)arr.push(i);return `<div class="pagination"><button data-page="${cur-1}" ${cur<=1?'disabled':''}>‹</button>${arr.map(i=>`<button data-page="${i}" class="${i===cur?'active':''}">${i}</button>`).join('')}<button data-page="${cur+1}" ${cur>=total?'disabled':''}>›</button></div>`;}

  function logDetailHtml(record){return queryPathService.html(record,clientAliases);}
export { logBadge, logRow, renderLogs, openLogPath, paginationHtml, logDetailHtml };
