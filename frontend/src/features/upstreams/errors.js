import { setHTML } from '../../core/security/safe-dom.ts';
import { metricFind } from '../../shared/metrics/prometheus.ts';
import { $ } from '../../core/context.js';
import { esc, num } from '../../shared/format/number.js';
import { groupName } from './groups.js';
import { api } from '../../core/api/api.js';

  const upstreamErrorReasonLabels={
    timeout:'Timeout',upstream_timeout:'Timeout',deadline:'Timeout',
    tls:'TLS',tls_handshake:'TLS',certificate:'TLS',
    socks5:'SOCKS5',socks:'SOCKS5',proxy:'SOCKS5',
    eof_reset:'EOF / Reset',eof:'EOF / Reset',reset:'EOF / Reset',broken_pipe:'EOF / Reset',
    dial_connect:'Dial / Connect',dial:'Dial / Connect',connect:'Dial / Connect',
    refused_unreachable:'Refused / Unreachable',refused:'Refused / Unreachable',unreachable:'Refused / Unreachable',
    http:'HTTP',protocol:'Protocol',unpack:'Protocol',other:'Other'
  };

  function upstreamErrorReasonName(reason){return upstreamErrorReasonLabels[String(reason||'').toLowerCase()]||String(reason||'Other').replace(/_/g,' ')}

  function upstreamMetrics(metrics,group,tag){
    const labels={metrics_tag:group,tag};
    const q=metricFind(metrics,'localdns_upstream_query_total',labels),err=metricFind(metrics,'localdns_upstream_error_total',labels),win=metricFind(metrics,'localdns_upstream_upstream_winner_total',labels),sum=metricFind(metrics,'localdns_upstream_response_latency_millisecond_sum',labels),count=metricFind(metrics,'localdns_upstream_response_latency_millisecond_count',labels);
    const reasonMetricNames=new Set(['localdns_upstream_upstream_error_reason_total']);
    const reasonRows=metrics.filter(x=>reasonMetricNames.has(x.name)&&x.labels.metrics_tag===group&&x.labels.tag===tag&&x.labels.reason);
    const reasonMap={}; reasonRows.forEach(x=>{const key=String(x.labels.reason||'other').toLowerCase();reasonMap[key]=(reasonMap[key]||0)+(Number(x.value)||0)});
    const reasons=Object.entries(reasonMap).map(([reason,value])=>({reason,label:upstreamErrorReasonName(reason),value})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label));
    const lastErrorNames=['localdns_upstream_upstream_last_error_unixtime_seconds'];
    let lastError=0; for(const name of lastErrorNames){lastError=metricFind(metrics,name,labels);if(lastError)break;}
    const ok=metricFind(metrics,'localdns_upstream_success_total',labels);
    return {q,err,win,latencySamples:count,latency:count?sum/count:0,success:(ok+err)?ok/(ok+err)*100:null,adoption:q?win/q*100:0,reasons,lastError,reasonSupported:reasonRows.length>0};
  }

  function upstreamErrorTime(ts){
    if(!ts)return'';
    const d=new Date(Number(ts)*1000); if(Number.isNaN(d.getTime()))return'';
    return d.toLocaleString('zh-CN',{hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  function closeUpstreamErrorPopover(){
    const pop=$('#upstream-error-popover'); if(pop)pop.remove();
    document.removeEventListener('click',upstreamErrorOutsideClick,true);
    document.removeEventListener('keydown',upstreamErrorKeydown,true);
  }

  function upstreamErrorOutsideClick(e){const pop=$('#upstream-error-popover');if(pop&&!pop.contains(e.target)&&!e.target.closest('.up-error-detail-trigger'))closeUpstreamErrorPopover()}

  function upstreamErrorKeydown(e){if(e.key==='Escape')closeUpstreamErrorPopover()}

  function openUpstreamErrorPopover(trigger,row){
    closeUpstreamErrorPopover();
    const {g,u,m}=row;
    const reasonTotal=(m.reasons||[]).reduce((n,x)=>n+(Number(x.value)||0),0);
    const detail=m.reasonSupported
      ?(m.reasons.length
        ?`<div class="up-error-reason-list">${m.reasons.map(x=>`<div class="up-error-reason-row"><span>${esc(x.label)}</span><strong>${num(x.value)}</strong></div>`).join('')}</div>`
        :`<div class="up-error-compat"><strong>分类计数异常</strong><span>当前错误总数大于 0，但分类计数均为 0。请检查当前二进制是否提供完整的错误分类指标。</span></div>`)
      :`<div class="up-error-compat"><strong>等待错误分类数据</strong><span>当前错误分类指标不可用；当二进制提供分类指标后，这里会自动显示 Timeout、TLS、SOCKS5、EOF / Reset 等分类。</span></div>`;
    const totalMismatch=m.reasonSupported&&reasonTotal!==Number(m.err||0)?`<div class="up-error-warning">分类合计 ${num(reasonTotal)} 与错误总数 ${num(m.err)} 不一致，请检查后端统计口径。</div>`:'';
    const last=m.lastError?`<div class="up-error-meta-row"><span>最近错误</span><strong>${esc(upstreamErrorTime(m.lastError))}</strong></div>`:'';
    const pop=document.createElement('div'); pop.id='upstream-error-popover'; pop.className='up-error-popover'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label',`${u.tag} 错误详情`);
    setHTML(pop, `<div class="up-error-popover-head"><div><strong>${esc(u.tag)} · 错误详情</strong><span>${esc(groupName(g))} · ${esc(u.protocol||'')}</span></div><button type="button" class="up-error-popover-close" aria-label="关闭">×</button></div>${detail}${totalMismatch}<div class="up-error-popover-meta"><div class="up-error-meta-row"><span>总计</span><strong>${num(m.err)}</strong></div>${last}</div><div class="up-error-recent"></div>`);
    document.body.appendChild(pop); pop.querySelector('.up-error-popover-close').onclick=closeUpstreamErrorPopover;
    const recentBox=pop.querySelector('.up-error-recent');
    if(Number(m.err||0)>0) api.json('/api/v1/status').then(st=>{
      const s=(st.upstream_stats||[]).find(x=>x.group===g&&x.tag===u.tag);
      const list=(s&&s.recent_errors)||[];
      if(!list.length) return;
      setHTML(recentBox, `<div class="up-error-recent-title">最近错误原因</div>${list.map(x=>`<div class="up-error-recent-row"><span>${esc(upstreamErrorTime(x.time))}</span><em>${esc(x.error)}</em></div>`).join('')}`);
    }).catch(()=>{});
    const r=trigger.getBoundingClientRect(),gap=8,pad=12,w=Math.min(340,window.innerWidth-pad*2); pop.style.width=`${w}px`;
    const ph=pop.offsetHeight; let left=Math.min(Math.max(pad,r.left+r.width/2-w/2),window.innerWidth-w-pad); let top=r.bottom+gap;
    if(top+ph>window.innerHeight-pad)top=Math.max(pad,r.top-gap-ph);
    pop.style.left=`${Math.round(left)}px`; pop.style.top=`${Math.round(top)}px`;
    setTimeout(()=>{document.addEventListener('click',upstreamErrorOutsideClick,true);document.addEventListener('keydown',upstreamErrorKeydown,true)},0);
  }
export { upstreamErrorReasonLabels, upstreamErrorReasonName, upstreamMetrics, upstreamErrorTime, closeUpstreamErrorPopover, upstreamErrorOutsideClick, upstreamErrorKeydown, openUpstreamErrorPopover };
