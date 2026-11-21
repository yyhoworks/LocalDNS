import { setHTML } from '../../core/security/safe-dom.ts';
import { metricFind } from '../../shared/metrics/prometheus.ts';
import { $ } from '../../core/context.js';
import { esc, num } from '../../shared/format/number.js';
import { groupName } from './groups.js';
import { api } from '../../core/api/api.js';

  const upstreamErrorReasonLabels={
    timeout:'超时',upstream_timeout:'超时',deadline:'超时',
    tls:'TLS 握手失败',tls_handshake:'TLS 握手失败',certificate:'TLS 握手失败',
    socks5:'SOCKS5 出错',socks:'SOCKS5 出错',proxy:'SOCKS5 出错',
    eof_reset:'连接中断',eof:'连接中断',reset:'连接中断',broken_pipe:'连接中断',
    dial_connect:'连接失败',dial:'连接失败',connect:'连接失败',
    refused_unreachable:'拒绝或不可达',refused:'拒绝或不可达',unreachable:'拒绝或不可达',
    http:'HTTP 错误',protocol:'回答格式错误',unpack:'回答格式错误',other:'其他错误'
  };

  function upstreamErrorReasonName(reason) {
    const key = String(reason || 'other').toLowerCase();
    return Object.prototype.hasOwnProperty.call(upstreamErrorReasonLabels, key)
      ? upstreamErrorReasonLabels[key] : String(reason).replace(/_/g, ' ');
  }

  function readErrorReasons(metrics, name, group, tag) {
    const rows = metrics.filter(sample => sample.name === name && sample.labels.metrics_tag === group
      && sample.labels.tag === tag && sample.labels.reason && Number.isFinite(sample.value) && sample.value >= 0);
    const counts = new Map();
    for (const row of rows) {
      const reason = row.labels.reason.toLowerCase();
      counts.set(reason, (counts.get(reason) || 0) + row.value);
    }
    const reasons = [...counts].filter(([, value]) => value > 0)
      .map(([reason, value]) => ({ reason, label: upstreamErrorReasonName(reason), value }))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
    return { reasons, reasonSupported: rows.length > 0 };
  }

  function readErrorRound(metrics, group, tag, lastError) {
    const sample = name => metrics.find(item => item.name === name && item.labels.metrics_tag === group
      && item.labels.tag === tag)?.value;
    const errors = sample('localdns_upstream_round_errors');
    const successes = sample('localdns_upstream_round_successes');
    if (![errors, successes].every(value => Number.isFinite(value) && value >= 0)) return null;
    const now = metricFind(metrics, 'localdns_unixtime_seconds');
    const quiet = metricFind(metrics, 'localdns_upstream_error_round_quiet_seconds');
    if (Number.isFinite(now) && Number.isFinite(quiet) && quiet > 0 && lastError > 0 && now - lastError >= quiet) {
      return { err: 0, success: null, lastError: 0, reasons: [], reasonSupported: false };
    }
    return {
      err: errors, success: successes + errors > 0 ? successes / (successes + errors) * 100 : null, lastError,
      ...readErrorReasons(metrics, 'localdns_upstream_round_error_reason', group, tag),
    };
  }

  function upstreamMetrics(metrics,group,tag){
    const labels={metrics_tag:group,tag};
    const q=metricFind(metrics,'localdns_upstream_query_total',labels),err=metricFind(metrics,'localdns_upstream_error_total',labels),win=metricFind(metrics,'localdns_upstream_upstream_winner_total',labels),sum=metricFind(metrics,'localdns_upstream_response_latency_millisecond_sum',labels),count=metricFind(metrics,'localdns_upstream_response_latency_millisecond_count',labels);
    const lastError = metricFind(metrics, 'localdns_upstream_upstream_last_error_unixtime_seconds', labels);
    const ok=metricFind(metrics,'localdns_upstream_success_total',labels);
    return {
      q, err, win, latencySamples: count, latency: count ? sum / count : 0,
      success: ok + err ? ok / (ok + err) * 100 : null, adoption: q ? win / q * 100 : 0, lastError,
      ...readErrorReasons(metrics, 'localdns_upstream_upstream_error_reason_total', group, tag),
      round: readErrorRound(metrics, group, tag, lastError),
    };
  }

  function upstreamErrorTime(ts){
    if(!ts)return'';
    const d=new Date(Number(ts)*1000); if(Number.isNaN(d.getTime()))return'';
    return d.toLocaleString('zh-CN',{hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
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
    const {g,u}=row;
    const m = row.m.round ?? row.m;
    const countLabel = row.m.round ? '当前轮次' : '累计';
    const reasonTotal=(m.reasons||[]).reduce((n,x)=>n+(Number(x.value)||0),0);
    const detail=m.reasonSupported
      ?(m.reasons.length
        ?`<div class="up-error-reason-list">${m.reasons.map(x=>`<div class="up-error-reason-row"><span>${esc(x.label)}</span><strong>${num(x.value)}</strong></div>`).join('')}</div>`
        :`<div class="up-error-compat"><strong>分类计数异常</strong><span>当前错误总数大于 0，但分类计数均为 0。请检查当前二进制是否提供完整的错误分类指标。</span></div>`)
      :`<div class="up-error-compat"><strong>等待错误分类数据</strong><span>当前错误分类指标不可用；当二进制提供分类指标后，这里会自动显示超时、TLS 握手失败、SOCKS5 出错、连接中断等分类。</span></div>`;
    const totalMismatch=m.reasonSupported&&reasonTotal!==Number(m.err||0)?`<div class="up-error-warning">分类合计 ${num(reasonTotal)} 与错误总数 ${num(m.err)} 不一致，请检查后端统计口径。</div>`:'';
    const last=m.lastError?`<div class="up-error-meta-row"><span>最近错误</span><strong>${esc(upstreamErrorTime(m.lastError))}</strong></div>`:'';
    const pop=document.createElement('div'); pop.id='upstream-error-popover'; pop.className='up-error-popover'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label',`${u.tag} 错误详情`);
    setHTML(pop, `<div class="up-error-popover-head"><div><strong>${esc(u.tag)} · 错误详情</strong>
      <span>${esc(groupName(g))} · ${esc(u.protocol || '')}</span></div>
      <button type="button" class="up-error-popover-close" aria-label="关闭">×</button></div>
      ${detail}${totalMismatch}<div class="up-error-popover-meta">
      <div class="up-error-meta-row"><span>${countLabel}错误</span><strong>${num(m.err)}</strong></div>${last}</div>
      <div class="up-error-recent"></div>`);
    document.body.appendChild(pop); pop.querySelector('.up-error-popover-close').onclick=closeUpstreamErrorPopover;
    const recentBox=pop.querySelector('.up-error-recent');
    if(Number(m.err||0)>0) api.json('/api/v1/status').then(st=>{
      const s=(st.upstream_stats||[]).find(x=>x.group===g&&x.tag===u.tag);
      const list=(s&&s.recent_errors)||[];
      if (!pop.isConnected || !list.length) return;
      setHTML(recentBox, `<div class="up-error-recent-title">最近错误记录</div>${list.map(item =>
        `<div class="up-error-recent-row"><span>${esc(upstreamErrorTime(item.time))}</span>
          <em>${esc(item.error)}</em></div>`).join('')}`);
    }).catch(()=>{});
    const r=trigger.getBoundingClientRect(),gap=8,pad=12,w=Math.min(340,window.innerWidth-pad*2); pop.style.width=`${w}px`;
    const ph=pop.offsetHeight; let left=Math.min(Math.max(pad,r.left+r.width/2-w/2),window.innerWidth-w-pad); let top=r.bottom+gap;
    if(top+ph>window.innerHeight-pad)top=Math.max(pad,r.top-gap-ph);
    pop.style.left=`${Math.round(left)}px`; pop.style.top=`${Math.round(top)}px`;
    setTimeout(()=>{document.addEventListener('click',upstreamErrorOutsideClick,true);document.addEventListener('keydown',upstreamErrorKeydown,true)},0);
  }
export { upstreamErrorReasonLabels, upstreamErrorReasonName, upstreamMetrics, upstreamErrorTime, closeUpstreamErrorPopover, upstreamErrorOutsideClick, upstreamErrorKeydown, openUpstreamErrorPopover };
