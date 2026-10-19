import { currentScope } from '../../core/router/route-lifetime';
import { clientAliases } from '../logs/aliases.js';
import { overviewInsightsService } from './insights.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { empty } from '../../shared/components/templates.js';
import { esc, num, ms } from '../../shared/format/number.js';
import { state, $, $$ } from '../../core/context.js';
import { openDrawer } from '../../shared/components/drawer.js';
import { closeDrawer } from '../../shared/components/drawer.js';
import { modalOpen } from '../../shared/components/dialog.js';
import { navigate } from '../../core/router/router.js';

  function rankRows(items,formatter=(x)=>x.key,limit=10){
    if(!items?.length)return empty();
    // Keep compact rankings at their historical limit, but allow the domain ranking
    // to render every row returned by the API. The viewport remains bounded and scrollable.
    const list=Number.isFinite(limit)?items.slice(0,Math.max(0,limit)):items.slice();
    const max=Math.max(1,...list.map(x=>+x.count||0));
    return `<div class="rank-list">${list.map((x,i)=>{const width=Math.max(4,Math.min(100,(+x.count||0)/max*100));return `<div class="rank-row" style="--rank:${width.toFixed(2)}%"><span class="rank-meter"></span><span class="rank-index">${i+1}</span><span class="rank-name" title="${esc(formatter(x))}">${esc(formatter(x))}</span><span class="rank-value">${num(x.count)}</span></div>`}).join('')}</div>`;
  }

  function slowTypeLabel(v){
    const raw=String(v??'—').trim().toUpperCase();
    if(raw==='65')return 'HTTPS';
    if(raw==='64')return 'SVCB';
    return raw||'—';
  }

  function slowTypeSort(a,b){
    const order={A:0,AAAA:1,HTTPS:2,SVCB:3};
    const aa=order[a]??50,bb=order[b]??50;
    return aa-bb||a.localeCompare(b);
  }

  function aggregateSlowest(items,limit=10){
    const groups=new Map();
    for(const x of items||[]){
      const domain=String(x?.query_name||'—');
      const client=String(x?.client_ip||'—');
      const key=`${domain.toLowerCase()}\u0000${client}`;
      const duration=Number.isFinite(+x?.duration_ms)?+x.duration_ms:0;
      const type=slowTypeLabel(x?.query_type);
      let g=groups.get(key);
      if(!g){g={query_name:domain,client_ip:client,duration_ms:duration,types:new Map()};groups.set(key,g)}
      if(duration>g.duration_ms){g.duration_ms=duration;g.query_name=domain}
      const prev=g.types.get(type);
      if(!prev||duration>prev.duration_ms)g.types.set(type,{type,duration_ms:duration});
    }
    return [...groups.values()].sort((a,b)=>b.duration_ms-a.duration_ms||a.query_name.localeCompare(b.query_name)).slice(0,limit);
  }

  function slowTypeSummaryHtml(g,index){
    const types=[...g.types.keys()].sort(slowTypeSort),shown=types.slice(0,2);
    // Keep the Type column compact: display at most two QTYPEs.
    // Any additional types remain available in the click-through detail popover.
    const label=shown.map(esc).join(' · ');
    if(types.length<=1)return `<span class="slow-type-single">${label}</span>`;
    return `<button type="button" class="slow-type-detail-trigger" data-slow-group="${index}" aria-haspopup="dialog" title="点击查看全部类型耗时">${label}</button>`;
  }

  function slowTypeDetailRows(g){
    return [...g.types.values()].sort((a,b)=>b.duration_ms-a.duration_ms||slowTypeSort(a.type,b.type));
  }

  const OVERVIEW_SLOW_PAGE_SIZE=10;

  const OVERVIEW_DOMAIN_PAGE_SIZE=10;

  function slowPageRowsHtml(groups,page){
    const totalPages=Math.max(1,Math.ceil((groups?.length||0)/OVERVIEW_SLOW_PAGE_SIZE));
    const safe=Math.max(0,Math.min(totalPages-1,page||0));
    const start=safe*OVERVIEW_SLOW_PAGE_SIZE;
    return (groups||[]).slice(start,start+OVERVIEW_SLOW_PAGE_SIZE).map((g,local)=>{
      const i=start+local;
      return `<tr class="slow-main-row" data-slow-group="${i}"><td>${esc(g.query_name)}</td><td>${slowTypeSummaryHtml(g,i)}</td><td>${esc(clientAliases[g.client_ip]||g.client_ip)}</td><td><span class="latency-chip ${+g.duration_ms>500?'bad':''}">${ms(g.duration_ms)}</span></td></tr>`;
    }).join('');
  }

  function domainPageRowsHtml(items,page,formatter=(x)=>x.key){
    if(!items?.length)return '';
    const totalPages=Math.max(1,Math.ceil(items.length/OVERVIEW_DOMAIN_PAGE_SIZE));
    const safe=Math.max(0,Math.min(totalPages-1,page||0));
    const start=safe*OVERVIEW_DOMAIN_PAGE_SIZE;
    const max=Math.max(1,...items.map(x=>+x.count||0));
    return items.slice(start,start+OVERVIEW_DOMAIN_PAGE_SIZE).map((x,local)=>{
      const width=Math.max(4,Math.min(100,(+x.count||0)/max*100));
      return `<div class="rank-row" style="--rank:${width.toFixed(2)}%"><span class="rank-meter"></span><span class="rank-index">${start+local+1}</span><span class="rank-name" title="${esc(formatter(x))}">${esc(formatter(x))}</span><span class="rank-value">${num(x.count)}</span></div>`;
    }).join('');
  }

  function closeSlowTypePopover(){
    const pop=$('#slow-type-popover');if(pop)pop.remove();
    document.removeEventListener('click',slowTypeOutsideClick,true);
    document.removeEventListener('keydown',slowTypeKeydown,true);
  }

  function slowTypeOutsideClick(e){const pop=$('#slow-type-popover');if(pop&&!pop.contains(e.target)&&!e.target.closest('.slow-type-detail-trigger'))closeSlowTypePopover()}

  function slowTypeKeydown(e){if(e.key==='Escape')closeSlowTypePopover()}

  function openSlowTypePopover(trigger,g){
    closeSlowTypePopover();
    const rows=slowTypeDetailRows(g);
    const pop=document.createElement('div');pop.id='slow-type-popover';pop.className='slow-type-popover';pop.setAttribute('role','dialog');pop.setAttribute('aria-label',`${g.query_name} 查询类型耗时`);
    setHTML(pop, `<div class="slow-type-popover-head"><strong>类型耗时</strong><button type="button" class="slow-type-popover-close" aria-label="关闭">×</button></div><div class="slow-type-popover-list">${rows.map(x=>`<div class="slow-type-popover-row"><span>${esc(x.type)}</span><strong>${ms(x.duration_ms)}</strong></div>`).join('')}</div>`);
    document.body.appendChild(pop);pop.querySelector('.slow-type-popover-close').onclick=closeSlowTypePopover;
    const r=trigger.getBoundingClientRect(),gap=7,pad=12,w=Math.min(220,window.innerWidth-pad*2);pop.style.width=`${w}px`;
    const ph=pop.offsetHeight;let left=Math.min(Math.max(pad,r.left+r.width/2-w/2),window.innerWidth-w-pad),top=r.bottom+gap;
    if(top+ph>window.innerHeight-pad)top=Math.max(pad,r.top-gap-ph);
    pop.style.left=`${Math.round(left)}px`;pop.style.top=`${Math.round(top)}px`;
    const scope=currentScope();
    scope.listen($('#modal'),'close',closeSlowTypePopover);
    scope.timeout(()=>{scope.listen(document,'click',slowTypeOutsideClick,{capture:true});scope.listen(document,'keydown',slowTypeKeydown,{capture:true})},0);
  }

  const OVERVIEW_DETAIL_PAGE_SIZE=20;

  function detailPagerHtml(page,totalItems,pageSize=OVERVIEW_DETAIL_PAGE_SIZE){
    const totalPages=Math.max(1,Math.ceil((totalItems||0)/pageSize));
    const cur=Math.max(0,Math.min(totalPages-1,page||0));
    const pages=[];
    const start=Math.max(0,Math.min(totalPages-5,cur-2));
    for(let i=start;i<Math.min(totalPages,start+5);i++)pages.push(i);
    return `<div class="overview-detail-footer"><span class="overview-detail-count">第 ${cur+1} / ${totalPages} 页 · 共 ${num(totalItems||0)} 条</span><div class="overview-detail-pagination"><button type="button" data-detail-page="${cur-1}" ${cur<=0?'disabled':''}>‹</button>${pages.map(i=>`<button type="button" data-detail-page="${i}" class="${i===cur?'active':''}">${i+1}</button>`).join('')}<button type="button" data-detail-page="${cur+1}" ${cur>=totalPages-1?'disabled':''}>›</button></div></div>`;
  }

  function slowDetailRowsHtml(groups,page,pageSize=OVERVIEW_DETAIL_PAGE_SIZE){
    const totalPages=Math.max(1,Math.ceil((groups?.length||0)/pageSize));
    const safe=Math.max(0,Math.min(totalPages-1,page||0));
    const start=safe*pageSize;
    return (groups||[]).slice(start,start+pageSize).map((g,local)=>{
      const i=start+local;
      const types=[...g.types.keys()].sort(slowTypeSort).map(esc).join(' · ')||'—';
      return `<tr><td class="overview-detail-rank">${i+1}</td><td class="overview-detail-domain" title="${esc(g.query_name)}">${esc(g.query_name)}</td><td class="overview-detail-types" title="${types}">${types}</td><td class="overview-detail-client" title="${esc(clientAliases[g.client_ip]||g.client_ip)}">${esc(clientAliases[g.client_ip]||g.client_ip)}</td><td class="overview-detail-latency"><span class="latency-chip ${+g.duration_ms>500?'bad':''}">${ms(g.duration_ms)}</span></td></tr>`;
    }).join('');
  }

  function slowOverviewRowsHtml(groups,limit=state.overviewSlowLimit){
    const shown=(groups||[]).slice(0,limit);
    const maxDur=Math.max(1,...shown.map(g=>+g.duration_ms||0));
    return shown.map((g,index)=>{
      const typeList=[...g.types.keys()].sort(slowTypeSort);
      const types=typeList.join(' · ')||'—';
      const typePills=typeList.length?typeList.map(t=>`<span class="slow-qtype-pill mono" data-qtype="${esc(t)}">${esc(t)}</span>`).join(''):'<span class="slow-qtype-pill mono">—</span>';
      const alias=clientAliases[g.client_ip];
      const client=alias||g.client_ip||'—';
      const dur=+g.duration_ms||0;
      const ratio=Math.max(4,Math.min(100,dur/maxDur*100)).toFixed(1);
      const tier=overviewInsightsService?.latencyTier?overviewInsightsService.latencyTier(dur):(dur>500?'critical':'fast');
      const rankCls=index<3?`is-top is-top-${index+1}`:'';
      return `<tr style="--slow-ratio:${ratio}%" data-latency-tier="${tier}"><td class="overview-slow-index"><span class="slow-rank-badge ${rankCls}">${index+1}</span></td><td class="overview-slow-domain"><div class="slow-domain-main"><button type="button" class="workspace-text-button mono" data-slow-record="${index}" title="查看 ${esc(g.query_name)} 的查询日志">${esc(g.query_name)}</button></div><span class="overview-slow-mobile-meta">${esc(types)} · ${esc(client)}${alias&&g.client_ip&&alias!==g.client_ip?` (${esc(g.client_ip)})`:''}</span></td><td class="overview-slow-type"><div class="slow-qtype-group">${typePills}</div></td><td class="overview-slow-client" title="${esc(g.client_ip)}"><div class="slow-client-stack"><span class="slow-client-name">${esc(client)}</span>${alias&&g.client_ip&&alias!==g.client_ip?`<small class="slow-client-ip mono">${esc(g.client_ip)}</small>`:''}</div></td><td class="overview-slow-duration"><div class="slow-duration-cell"><div class="slow-duration-bar" aria-hidden="true"><span class="slow-duration-fill tier-${tier}" style="width:${ratio}%"></span></div><span class="latency-chip tier-${tier} ${dur>500?'bad':''}">${ms(dur)}</span></div></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="table-empty">暂无查询记录，记录查询后将在这里显示耗时排行。</td></tr>';
  }

  function openOutcomeDetail(rows,total,otherOnly=false){
    const content=`<p class="overview-outcome-note">当前审计保留日志的最终处理结果。主缓存命中不会展开原本的国内或国外去向；占比以本次返回分类的查询总数为基准。</p><div class="overview-outcome-detail-list">${rows.map(row=>`<button type="button" class="overview-outcome-detail-row" data-outcome-filter="${esc(row.key)}"><span><strong>${esc(row.label)}</strong><small class="mono">${esc(row.key||'未分类')}</small></span><span>${num(row.count)} 次<small>${total ? (row.count/total*100).toFixed(1) : '0.0'}%</small></span></button>`).join('')||'<p>暂无分类统计。</p>'}</div>`;
    openDrawer(otherOnly?'其他处理结果':'全部处理结果',`当前保留日志 · ${rows.length} 类 · ${num(rows.reduce((n,row)=>n+row.count,0))} 次查询`,content);
    $$('#drawer [data-outcome-filter]').forEach(button=>button.onclick=()=>{
      Object.assign(state.logs,{page:1,q:'',exact:false,type:'',set:button.dataset.outcomeFilter,code:'',client:''});
      closeDrawer();navigate('logs');
    });
  }

  function domainDetailRowsHtml(items,page,pageSize=OVERVIEW_DETAIL_PAGE_SIZE){
    const totalPages=Math.max(1,Math.ceil((items?.length||0)/pageSize));
    const safe=Math.max(0,Math.min(totalPages-1,page||0));
    const start=safe*pageSize;
    const max=Math.max(1,...(items||[]).map(x=>+x.count||0));
    return (items||[]).slice(start,start+pageSize).map((x,local)=>{
      const rank=start+local+1,count=+x.count||0,width=Math.max(3,Math.min(100,count/max*100));
      return `<tr><td class="overview-detail-rank">${rank}</td><td class="overview-detail-domain" title="${esc(x.key||'—')}">${esc(x.key||'—')}</td><td class="overview-detail-count-cell"><span>${num(count)}</span><i style="--detail-rank:${width.toFixed(2)}%"></i></td></tr>`;
    }).join('');
  }

  function openSlowDetailModal(groups){
    let current=0;
    const render=()=>{
      const body=groups?.length?`<div class="overview-detail-table-wrap"><table class="overview-detail-table overview-detail-slow-table"><thead><tr><th>#</th><th>域名</th><th>类型</th><th>客户端</th><th>耗时</th></tr></thead><tbody>${slowDetailRowsHtml(groups,current)}</tbody></table></div>${detailPagerHtml(current,groups.length)}`:empty('暂无最慢查询数据');
      setHTML($('#modal-content'), body);
      $$('#modal-content [data-detail-page]').forEach(btn=>btn.onclick=()=>{const next=+btn.dataset.detailPage;if(Number.isFinite(next)&&next!==current){current=next;render();$('#modal-content').scrollTop=0}});
    };
    modalOpen('最慢查询详情',`每页 ${OVERVIEW_DETAIL_PAGE_SIZE} 条，整页翻页`, '',null,false);
    $('#modal').classList.add('overview-detail-modal');
    render();
  }

  function openDomainDetailModal(items){
    let current=0;
    const render=()=>{
      const body=items?.length?`<div class="overview-detail-table-wrap"><table class="overview-detail-table overview-detail-domain-table"><thead><tr><th>#</th><th>域名</th><th>查询次数</th></tr></thead><tbody>${domainDetailRowsHtml(items,current)}</tbody></table></div>${detailPagerHtml(current,items.length)}`:empty('暂无域名排行数据');
      setHTML($('#modal-content'), body);
      $$('#modal-content [data-detail-page]').forEach(btn=>btn.onclick=()=>{const next=+btn.dataset.detailPage;if(Number.isFinite(next)&&next!==current){current=next;render();$('#modal-content').scrollTop=0}});
    };
    modalOpen('域名排行详情',`每页 ${OVERVIEW_DETAIL_PAGE_SIZE} 条，整页翻页`, '',null,false);
    $('#modal').classList.add('overview-detail-modal');
    render();
  }
export { rankRows, slowTypeLabel, slowTypeSort, aggregateSlowest, slowTypeSummaryHtml, slowTypeDetailRows, OVERVIEW_SLOW_PAGE_SIZE, OVERVIEW_DOMAIN_PAGE_SIZE, slowPageRowsHtml, domainPageRowsHtml, closeSlowTypePopover, slowTypeOutsideClick, slowTypeKeydown, openSlowTypePopover, OVERVIEW_DETAIL_PAGE_SIZE, detailPagerHtml, slowDetailRowsHtml, slowOverviewRowsHtml, openOutcomeDetail, domainDetailRowsHtml, openSlowDetailModal, openDomainDetailModal };
