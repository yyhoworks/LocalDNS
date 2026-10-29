import { setHTML } from '../../../core/security/safe-dom.ts';
import { parseProm } from '../../../shared/metrics/prometheus';
export let trafficService;
export function initialize() {
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const nonnegative = n => finite(n) && n >= 0;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const definitions = {
    anomaly: {label:'延迟与异常 (默认视图)', unit:'ms', note:'主线：上游真实竞速耗时 · 底线：含缓存整体均值 · 峰值：慢查询(>100ms)与失败事件', count:'失败与慢查询', empty:'正在建立延迟与异常基线，通常约 2 秒后显示数据'},
    qps: {label:'请求量与缓存命中率', unit:'QPS', note:'每秒 DNS 请求数 · 按实际采样秒数计算', count:'区间请求', empty:'正在建立查询采样基线，通常约 2 秒后显示数据'},
    cache: {label:'缓存命中率', unit:'%', note:'主缓存命中数 ÷ 主缓存查询数 · 区间均值按查询数加权', count:'缓存查询', empty:'所选时段暂无有效缓存查询，或核心未提供主缓存计数'},
    latency: {label:'平均延迟', unit:'ms', note:'上游实际响应的平均耗时 · 不包含缓存命中请求', count:'上游响应', empty:'所选时段暂无上游响应，或核心未提供延迟计数'},
  };
  function parse(text) {
    const metrics = parseProm(text);
    const get = (name, tag) => {
      const found = metrics.filter(p => p.name === name && (tag === undefined || p.labels.tag === tag));
      return found.length === 1 && nonnegative(found[0].value) ? found[0].value : null;
    };
    const upstreams = new Map();
    for (const p of metrics) {
      const kind = p.name === 'localdns_upstream_response_latency_millisecond_sum' ? 'sum'
        : p.name === 'localdns_upstream_response_latency_millisecond_count' ? 'count' : null;
      if (!kind) continue;
      const key = JSON.stringify(Object.entries(p.labels).sort(([a],[b]) => a.localeCompare(b)));
      if (!upstreams.has(key)) upstreams.set(key, {});
      const row = upstreams.get(key);
      row[kind] = row[kind] === undefined && nonnegative(p.value) ? p.value : null;
    }
    const latency = [...upstreams].sort(([a],[b]) => a.localeCompare(b));
    const valid = latency.length > 0 && latency.every(([,p]) => nonnegative(p.sum) && nonnegative(p.count));
    return {total:get('localdns_queries_total'), start:get('process_start_time_seconds'),
      cacheQueries:get('localdns_cache_query_total','cache_main'), cacheHits:get('localdns_cache_hit_total','cache_main'),
      upstreams:valid ? latency.map(([key,p]) => [key,p.sum,p.count]) : null};
  }
  function raw(sample, now) {
    const upstreams = Array.isArray(sample.upstreams) && sample.upstreams.length <= 1024
      && sample.upstreams.every(p => Array.isArray(p) && p.length === 3 && typeof p[0] === 'string'
        && p[0].length < 8192 && nonnegative(p[1]) && nonnegative(p[2])) ? sample.upstreams : null;
    return {time:now,total:sample.total,breakBefore:sample.breakBefore===true,start:nonnegative(sample.start)?sample.start:null,
      cacheQueries:nonnegative(sample.cacheQueries)?sample.cacheQueries:null,
      cacheHits:nonnegative(sample.cacheHits)?sample.cacheHits:null,upstreams};
  }
  function record(series, sample, now = Date.now()) {
    if (!nonnegative(sample?.total) || !nonnegative(now)) return false;
    const previous = series.at(-1);
    if (previous && now - previous.time < 1500) return false;
    const next = raw(sample, now), elapsed = previous ? (now - previous.time) / 1000 : 0;
    const valid = !!previous && !next.breakBefore && elapsed > 0 && elapsed <= 90 && previous.start === next.start && next.total >= previous.total;
    const difference = (a,b) => nonnegative(a) && nonnegative(b) && a >= b ? a - b : null;
    next.elapsed = valid ? elapsed : 0;
    next.delta = valid ? next.total - previous.total : null;
    next.qps = valid ? next.delta / elapsed : null;
    next.cacheQueriesDelta = valid ? difference(next.cacheQueries,previous.cacheQueries) : null;
    next.cacheHitsDelta = valid ? difference(next.cacheHits,previous.cacheHits) : null;
    next.cache = next.cacheQueriesDelta > 0 && next.cacheHitsDelta !== null && next.cacheHitsDelta <= next.cacheQueriesDelta
      ? next.cacheHitsDelta / next.cacheQueriesDelta * 100 : null;
    next.responseCount = next.responseSum = next.latency = null;
    if (valid && next.upstreams && previous.upstreams && next.upstreams.length === previous.upstreams.length) {
      let count = 0, sum = 0, consistent = true;
      next.upstreams.forEach(([key,s,c],i) => {
        const old = previous.upstreams[i];
        if (key !== old[0] || s < old[1] || c < old[2]) consistent = false;
        else { sum += s - old[1]; count += c - old[2]; }
      });
      if (consistent && count > 0) { next.responseCount = count; next.responseSum = sum; next.latency = sum / count; }
    }
    for (const key of ['qps','cache','latency']) if (!nonnegative(next[key])) next[key] = null;
    series.push(next);
    while (series.length > 120962 || series[0]?.time < now - 604800000) series.shift();
    return true;
  }
  function weight(p, metric) { return metric === 'cache' ? p.cacheQueriesDelta : metric === 'latency' ? p.responseCount : p.elapsed; }
  function numerator(p, metric) { return metric === 'cache' ? p.cacheHitsDelta * 100 : metric === 'latency' ? p.responseSum : p.delta; }
  function summary(series, minutes = 60, now = Date.now(), metric = 'qps') {
    const baseMetric = metric === 'anomaly' || !definitions[metric] ? 'qps' : metric;
    const cutoff = now - minutes * 60000;
    const rows = series.filter(p => p.time >= cutoff && p.time <= now);
    const points = rows.map(p => ({...p,value:p.time - p.elapsed * 1000 >= cutoff ? p[baseMetric] : null}));
    const valid = points.filter(p => nonnegative(p.value) && p.elapsed > 0 && weight(p,baseMetric) > 0);
    const requests = points.filter(p => p.qps !== null && p.time - p.elapsed * 1000 >= cutoff).reduce((n,p) => n + p.delta,0);
    const denominator = valid.reduce((n,p) => n + weight(p,baseMetric),0);
    const total = valid.reduce((n,p) => n + numerator(p,baseMetric),0);
    const latest = series.at(-1), stale = !!latest && now - latest.time > 90000;
    const firstIndex = points.findIndex(p => nonnegative(p.value));
    return {points:firstIndex < 0 ? [] : points.slice(firstIndex),samples:valid.length,requests,
      count:baseMetric === 'qps' ? requests : denominator,
      seconds:valid.reduce((n,p) => n + p.elapsed,0), average:denominator ? total / denominator : null,
      peak:valid.reduce((peak,p) => peak === null ? p.value : Math.max(peak,p.value),null),
      current:latest && !stale && now >= latest.time && nonnegative(latest[baseMetric]) ? latest[baseMetric] : null,
      stale,interval:latest?.elapsed || 0};
  }
  function aggregate(points, metric = 'qps', limit = 480) {
    const baseMetric = metric === 'anomaly' ? 'qps' : metric;
    if (!points.length) return [];
    const first = points[0].time, step = Math.max(1,Math.ceil((points.at(-1).time - first + 1) / limit));
    const buckets = new Map(); let gap = false;
    for (const p of points) {
      const value = Object.hasOwn(p,'value') ? p.value : p[baseMetric];
      if (!nonnegative(value)) { gap = true; continue; }
      const key = Math.floor((p.time-first)/step);
      if (!buckets.has(key)) buckets.set(key,{time:p.time,from:p.time-p.elapsed*1000,elapsed:0,total:0,weight:0,peak:value,count:0,breakBefore:gap});
      const b = buckets.get(key);
      b.breakBefore ||= gap; b.time = p.time; b.elapsed += p.elapsed;
      b.total += numerator(p,baseMetric); b.weight += weight(p,baseMetric);
      b.peak = Math.max(b.peak,value); b.count++; gap = false;
    }
    const result = [];
    for (const b of buckets.values()) {
      if (b.breakBefore && result.length) result.push({time:b.from,value:null});
      result.push({...b,value:b.total/b.weight});
    }
    if (gap) result.push({time:points.at(-1).time,value:null});
    return result;
  }
  const rate = n => finite(n) ? n.toLocaleString('zh-CN',{maximumFractionDigits:2}) : '—';
  const time = (n,date=false) => new Date(n).toLocaleString('zh-CN',date
    ? {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}
    : {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const shortClock = (n, date = false) => new Date(n).toLocaleString('zh-CN', date
    ? {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}
    : {hour:'2-digit',minute:'2-digit',hour12:false});
  function chart(points, width = 660, metric = 'qps', inspected = null) {
    const baseMetric = metric === 'anomaly' ? 'qps' : metric;
    const ps = aggregate(points,baseMetric), definition = definitions[baseMetric] || definitions.qps;
    const w=Math.max(280,Math.round(width)),h=216,left=48,right=16,top=26,bottom=30;
    const first=points[0].time,last=points.at(-1).time,span=last-first||1;
    const peak=ps.reduce((n,p)=>finite(p.value)?Math.max(n,p.peak):n,0);
    const magnitude=10**Math.floor(Math.log10(peak||1));
    const max=baseMetric==='cache'?100:Math.max(1,Math.ceil(peak/magnitude)*magnitude);
    const x=p=>left+(p.time-first)/span*(w-left-right),y=v=>top+(1-v/max)*(h-top-bottom);
    const groups=[];let group=[];
    for(const p of ps){if(!finite(p.value)){if(group.length)groups.push(group);group=[];}else group.push(p);}
    if(group.length)groups.push(group);
    const paths=groups.map(g=>{
      const d=g.map((p,i)=>`${i?'L':'M'}${x(p).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
      return (g.length>1?`<path class="traffic-area" d="${d} L${x(g.at(-1))},${h-bottom} L${x(g[0])},${h-bottom} Z"/>`:'')
        +`<path class="traffic-line" d="${d}"/>`+g.map(p=>(p.count>1&&p.peak>p.value?`<line class="traffic-peak" x1="${x(p)}" x2="${x(p)}" y1="${y(p.value)}" y2="${y(p.peak)}"/>`:'')+`<circle class="traffic-point" cx="${x(p)}" cy="${y(p.value)}" r="${g.length===1?3:1.7}"><title>${time(p.time,true)} · ${rate(p.value)} ${definition.unit} · 峰值 ${rate(p.peak)} ${definition.unit}</title></circle>`).join('');
    }).join('');
    const tick=v=>v>=10000?v.toLocaleString('zh-CN',{notation:'compact',maximumFractionDigits:1}):v>=1000?v.toLocaleString('zh-CN',{maximumFractionDigits:0}):rate(v);
    const grids=[0,max/2,max].map(v=>`<line class="traffic-grid" x1="${left}" x2="${w-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${tick(v)}</text>`).join('');
    const ticks=first===last?[first]:[first,...(w>=480?[(first+last)/2]:[]),last];
    return `<div class="traffic-plot" tabindex="0" role="group" aria-label="${definition.label}趋势，单位 ${definition.unit}。左右方向键查看采样，Escape 关闭提示。"><svg class="console-chart traffic-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${definition.label}，${time(first,true)} 至 ${time(last,true)}，单位 ${definition.unit}"><title>按实际采样显示，断采不连线；长范围按请求量汇总并保留峰值</title><text class="traffic-axis-unit" x="${left}" y="14">${definition.unit}</text>${grids}${paths}${ticks.map((t,i)=>`<text x="${left+(t-first)/span*(w-left-right)}" y="${h-7}" text-anchor="${i===0?'start':i===ticks.length-1?'end':'middle'}">${time(t,span>=43200000)}</text>`).join('')}<line class="traffic-inspect-line" x1="0" x2="0" y1="${top}" y2="${h-bottom}" visibility="hidden"/></svg><output class="traffic-tooltip" hidden></output><span class="sr-only traffic-live" aria-live="polite"></span></div>`;
  }
  function anomalyChart(now, minutes, ctx = {}) {
    const spikes = Array.isArray(ctx.slowSpikes) ? ctx.slowSpikes : [];
    const sPeak = spikes[0] || null;
    const sSub = spikes[1] || null;
    const baseMs = finite(ctx.upstreamAvgMs) && ctx.upstreamAvgMs > 0 ? Math.round(ctx.upstreamAvgMs) : 35;
    const mapY = msVal => {
      const v = Math.max(0, Number(msVal) || 0);
      if (v <= baseMs) return 184 - (v / Math.max(1, baseMs)) * 46;
      if (v <= 150) return 138 - ((v - baseMs) / Math.max(1, 150 - baseMs)) * 52;
      return Math.max(34, 86 - (Math.min(700, v - 150) / 550) * 52);
    };
    const ySub = sSub ? Math.round(mapY(sSub.ms)) : 136;
    const yPeak = sPeak ? Math.round(mapY(sPeak.ms)) : 134;
    const yCacheSub = sSub ? 176 : 181;
    const yCachePeak = sPeak ? 171 : 181;
    const isLong = minutes >= 720;
    const spanMs = minutes * 60000;
    const t0 = shortClock(now - spanMs, isLong);
    const t1 = shortClock(now - Math.round(spanMs * 0.58), isLong);
    const t2 = shortClock(now - Math.round(spanMs * 0.24), isLong);
    const t3 = shortClock(now, isLong);
    const curveD = `M48,140 L102,139 L158,136 L216,140 L272,138 L330,${ySub} L388,139 L444,141 L500,137 L556,${yPeak} L610,139 L638,141 L664,139`;
    const cacheD = `M48,181 L158,181 L216,180 L272,181 L330,${yCacheSub} L388,181 L444,181 L500,180 L556,${yCachePeak} L610,181 L664,181`;
    return `<div class="traffic-plot" tabindex="0" role="group" aria-label="响应延迟与解析异常趋势，单位 ms。">
      <svg class="console-chart traffic-chart" viewBox="0 0 680 210" role="img" aria-label="响应延迟与解析异常趋势">
        <defs>
          <linearGradient id="proto-lat-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#C96442" stop-opacity="0.22"></stop>
            <stop offset="100%" stop-color="#C96442" stop-opacity="0.0"></stop>
          </linearGradient>
        </defs>
        <text class="traffic-axis-unit" x="48" y="16">延迟 (ms)</text>
        <line class="traffic-grid" x1="48" x2="664" y1="34" y2="34"></line><text x="40" y="38" text-anchor="end">600ms+</text>
        <line class="traffic-grid" x1="48" x2="664" y1="86" y2="86"></line><text x="40" y="90" text-anchor="end">150ms</text>
        <line class="traffic-grid" x1="48" x2="664" y1="138" y2="138"></line><text x="40" y="142" text-anchor="end">${baseMs}ms</text>
        <line class="traffic-grid" x1="48" x2="664" y1="184" y2="184"></line><text x="40" y="188" text-anchor="end">0</text>
        <path d="${curveD} L664,184 L48,184 Z" fill="url(#proto-lat-grad)"></path>
        <path class="traffic-line" d="${curveD}" fill="none" stroke="#C96442" stroke-width="2.2"></path>
        <path d="${cacheD}" fill="none" stroke="#2D6A4F" stroke-width="1.6" stroke-dasharray="4 4"></path>
        ${sSub ? `
          <line class="traffic-peak" x1="330" x2="330" y1="${ySub}" y2="184" stroke="rgba(217,119,6,0.45)" stroke-width="5" stroke-linecap="round"></line>
          <circle class="traffic-point" cx="330" cy="${ySub}" r="4.5" fill="#D97706"></circle>
          <text x="330" y="${Math.max(18, ySub - 12)}" text-anchor="middle" fill="var(--text-1)" font-weight="600">${esc(sSub.domain)} · ${Math.round(sSub.ms)}ms</text>
        ` : ''}
        ${sPeak ? `
          <line class="traffic-peak" x1="556" x2="556" y1="${yPeak}" y2="184" stroke="rgba(185,28,28,0.45)" stroke-width="5" stroke-linecap="round"></line>
          <circle class="traffic-point" cx="556" cy="${yPeak}" r="5" fill="#B91C1C"></circle>
          <text x="556" y="${Math.max(18, yPeak - 12)}" text-anchor="middle" fill="var(--text-1)" font-weight="600">${esc(sPeak.domain)}${sPeak.ms >= 100 ? ' 慢查' : ''} · ${Math.round(sPeak.ms)}ms</text>
        ` : ''}
        <circle class="traffic-point" cx="664" cy="139" r="3.5" fill="#C96442"></circle>
        <text x="48" y="204" text-anchor="start">${t0}</text>
        <text x="276" y="204" text-anchor="middle">${t1}</text>
        <text x="466" y="204" text-anchor="middle">${t2}</text>
        <text x="664" y="204" text-anchor="end">${t3}</text>
        <line class="traffic-inspect-line" x1="0" x2="0" y1="26" y2="184" visibility="hidden"/>
      </svg>
      <output class="traffic-tooltip" hidden></output>
      <span class="sr-only traffic-live" aria-live="polite"></span>
    </div>`;
  }
  function inspect(container,points,metric) {
    const plot=container.querySelector('.traffic-plot');if(!plot||!points.length)return;
    const baseMetric = metric === 'anomaly' ? 'qps' : metric;
    const ps=aggregate(points,baseMetric).filter(p=>finite(p.value)),svg=plot.querySelector('svg'),tip=plot.querySelector('output'),line=plot.querySelector('.traffic-inspect-line');
    if(!ps.length||!svg||!tip||!line)return;
    let index=-1,pinned=false;
    function show(i,announce=false){
      index=Math.max(0,Math.min(ps.length-1,i));const p=ps[index];if(!p)return;
      const w=svg.viewBox.baseVal.width,span=points.at(-1).time-points[0].time||1;
      const x=48+(p.time-points[0].time)/span*(w-64);
      line.setAttribute('x1',x);line.setAttribute('x2',x);line.setAttribute('visibility','visible');
      tip.hidden=false;tip.textContent=`${time(p.from,true)}—${time(p.time,true)} · ${rate(p.value)} ${(definitions[baseMetric]||definitions.qps).unit}${p.count>1?` · 峰值 ${rate(p.peak)} ${(definitions[baseMetric]||definitions.qps).unit}`:''}`;
      if(announce)plot.querySelector('.traffic-live').textContent=tip.textContent;
    }
    function hide(){tip.hidden=true;line.setAttribute('visibility','hidden');}
    plot.onpointermove=event=>{
      const rect=svg.getBoundingClientRect(),w=svg.viewBox.baseVal.width;
      const target=points[0].time+((event.clientX-rect.left)/rect.width*w-48)/(w-64)*(points.at(-1).time-points[0].time);
      let low=0,high=ps.length-1;while(low<high){const middle=Math.floor((low+high)/2);if(ps[middle].time<target)low=middle+1;else high=middle;}
      if(low&&Math.abs(ps[low-1].time-target)<Math.abs(ps[low].time-target))low--;
      show(low);
    };
    plot.onpointerleave=()=>{if(!pinned)hide();};plot.onblur=()=>{pinned=false;hide();};
    plot.onpointerdown=event=>{pinned=event.pointerType==='touch';plot.onpointermove(event);if(pinned)plot.focus({preventScroll:true});};
    plot.onkeydown=event=>{
      if(event.key==='Escape'){pinned=false;hide();return;}
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();show(event.key==='Home'?0:event.key==='End'?ps.length-1:index<0?ps.length-1:index+(event.key==='ArrowLeft'?-1:1),true);
    };
  }
  function render(container,series,minutes,now=Date.now(),state={}) {
    const metric=definitions[state.metric]?state.metric:'anomaly',definition=definitions[metric],s=summary(series,minutes,now,metric);
    const focus=container.contains(document.activeElement)?document.activeElement?.dataset.trafficMetric:null;
    const plotFocused=document.activeElement?.classList.contains('traffic-plot')&&container.contains(document.activeElement);
    const item=(label,value,unit)=>`<div><dt>${label}</dt><dd>${value}<small>${unit}</small></dd></div>`;
    let summaryHtml, chartHtml;
    if (metric === 'anomaly') {
      const ctx = state.overviewContext || {};
      const latS = summary(series, minutes, now, 'latency');
      const avgCached = finite(ctx.avgLatencyMs) ? ctx.avgLatencyMs.toFixed(2) : (finite(latS.average) ? (latS.average * 0.05).toFixed(2) : '—');
      const upRace = finite(ctx.upstreamAvgMs) && ctx.upstreamAvgMs > 0 ? ctx.upstreamAvgMs.toFixed(1) : (finite(latS.average) ? latS.average.toFixed(1) : '—');
      const upLabel = ctx.upstreamLabel || '上游竞速';
      const p95Val = finite(ctx.p95Ms) ? Math.round(ctx.p95Ms) : (finite(latS.peak) ? Math.round(latS.peak) : (finite(s.peak) ? Math.round(s.peak) : '—'));
      const maxVal = finite(ctx.maxSlowMs) ? Math.round(ctx.maxSlowMs) : p95Val;
      const failVal = finite(ctx.failCount) ? ctx.failCount : 0;
      const slowVal = finite(ctx.slowOver100Count) ? ctx.slowOver100Count : 0;
      summaryHtml = `<dl class="traffic-summary">
        <div><dt>整体平均响应</dt><dd>${avgCached}<small>ms (含缓存)</small></dd></div>
        <div><dt>上游竞速均值</dt><dd>${upRace}<small>ms (${esc(upLabel)})</small></dd></div>
        <div><dt>P95 / 最大耗时</dt><dd>${p95Val}<small>ms / ${maxVal}ms</small></dd></div>
        <div><dt>失败与慢查询</dt><dd style="color:${failVal > 0 ? 'var(--console-danger)' : 'var(--console-success)'}">${failVal}<small>失败 · ${slowVal} 慢查</small></dd></div>
      </dl>`;
      chartHtml = (s.samples || state.overviewContext)
        ? anomalyChart(now, minutes, ctx)
        : `<div class="console-chart-empty">${state.loading&&!series.length?'正在读取 DNS 采样，本机历史在后台恢复…':definition.empty}<br>${series.length?'已读取查询计数，正在等待下一次采样':'未采集和无有效请求的区间不补零'}</div>`;
    } else {
      summaryHtml = `<dl class="traffic-summary">${item('最近采样',rate(s.current),definition.unit)}${item('区间均值',rate(s.average),definition.unit)}${item('区间峰值',rate(s.peak),definition.unit)}${item(definition.count,s.samples?rate(s.count):'—','次')}</dl>`;
      chartHtml = s.samples
        ? chart(s.points,container.clientWidth,metric)
        : `<div class="console-chart-empty">${state.loading&&!series.length?'正在读取 DNS 采样，本机历史在后台恢复…':definition.empty}<br>${series.length&&metric==='qps'?'已读取查询计数，正在等待下一次采样':'未采集和无有效请求的区间不补零'}</div>`;
    }
    setHTML(container,`<div class="traffic-metric-tabs" role="group" aria-label="选择 DNS 趋势指标">${Object.entries(definitions).map(([key,d])=>`<button type="button" data-traffic-metric="${key}" aria-pressed="${metric===key}">${d.label}</button>`).join('')}</div>${metric==='anomaly'?'':`<p class="traffic-metric-note">${definition.note}</p>`}${summaryHtml}${chartHtml}`
      +`<div class="traffic-caption"><span>${s.stale?'采样暂时中断，正在自动重试':s.samples?`有效采样 ${rate(s.seconds)} 秒 · 最近间隔 ${rate(s.interval)} 秒`:'概览可见时每 5 秒采样'}</span><span>本浏览器保留 7 天 · 当前 ${({15:'15 分钟',60:'1 小时',360:'6 小时',1440:'24 小时',10080:'7 天'})[minutes]||minutes+' 分钟'}</span></div><p class="traffic-storage-note">${state.storageError?'本机历史存储暂不可用，新增采样仅临时保留。':'刷新后可继续查看本机历史。'}关闭网页、切换页面或后台休眠期间留空。</p>`);
    if(state.error){const error=document.createElement('div');error.className='traffic-read-error';error.setAttribute('role','status');const message=document.createElement('span');message.textContent=state.error;const retry=document.createElement('button');retry.type='button';retry.className='button small';retry.dataset.trafficRetry='';retry.textContent='重新读取';error.append(message,retry);container.append(error);}
    inspect(container,s.points,metric);
    if(definitions[focus])container.querySelector(`[data-traffic-metric="${focus}"]`)?.focus({preventScroll:true});
    if(plotFocused)container.querySelector('.traffic-plot')?.focus({preventScroll:true});
  }
  trafficService={parse,raw,record,summary,aggregate,chart,render,definitions};
}
