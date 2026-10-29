import { setHTML } from '../../../core/security/safe-dom.ts';
import { parseProm } from '../../../shared/metrics/prometheus';
export let trafficService;
export function initialize() {
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const nonnegative = n => finite(n) && n >= 0;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const definitions = {
    anomaly: {label:'延迟与异常', unit:'ms', note:'上游真实竞速耗时 · 慢查询(>100ms)单独标注', count:'失败与慢查询', empty:'正在建立延迟与异常基线，通常约 2 秒后显示数据'},
    qps: {label:'请求量与缓存命中率', unit:'QPS', note:'左轴每秒请求数 · 右轴主缓存命中率', count:'区间请求', empty:'正在建立查询采样基线，通常约 2 秒后显示数据'},
    // Hidden from the tab row but still used for series and summaries: the cache
    // rate is drawn on the request tab's right axis, and latency is the very
    // series the anomaly view plots.
    cache: {label:'缓存命中率', unit:'%', note:'主缓存命中数 ÷ 主缓存查询数 · 区间均值按查询数加权', count:'缓存查询', empty:'所选时段暂无有效缓存查询，或核心未提供主缓存计数', hidden:true},
    latency: {label:'平均延迟', unit:'ms', note:'上游实际响应的平均耗时 · 不包含缓存命中请求', count:'上游响应', empty:'所选时段暂无上游响应，或核心未提供延迟计数', hidden:true},
  };
  const visibleMetrics = () => Object.entries(definitions).filter(([, item]) => !item.hidden);
  /** Axis ceiling on a 1/1.2/1.5/2/2.5/3/4/5/6/8/10 ladder so the curve fills the frame. */
  const axisCeiling = value => {
    if (!finite(value) || value <= 0) return 10;
    const scale = 10 ** Math.floor(Math.log10(value)), ratio = value / scale;
    const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(item => item >= ratio - 1e-9) || 10;
    return step * scale;
  };
  /** Cubic through the points; control points stay inside the segment's own
   *  y-range, so sparse runs never overshoot into a false dip. */
  const smoothPath = (pts, top = 0, bottom = Infinity) => {
    if (!pts.length) return '';
    const between = (a, b, v) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      return Math.min(bottom, Math.max(top, Math.min(hi, Math.max(lo, v))));
    };
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) * 0.16, c1y = between(p1[1], p2[1], p1[1] + (p2[1] - p0[1]) * 0.16);
      const c2x = p2[0] - (p3[0] - p1[0]) * 0.16, c2y = between(p1[1], p2[1], p2[1] - (p3[1] - p1[1]) * 0.16);
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  };
  /** Split a series into runs of finite values so gaps are never bridged. */
  const runs = points => {
    const groups = []; let group = [];
    for (const p of points) {
      if (!finite(p.value)) { if (group.length) groups.push(group); group = []; } else group.push(p);
    }
    if (group.length) groups.push(group);
    return groups;
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
    if (valid && next.upstreams && previous.upstreams) {
      // Match upstreams by key, not by position: the kernel may add or drop a
      // series between samples (an upstream that just served its first query),
      // and a length/order mismatch used to discard the whole latency point.
      const before = new Map(previous.upstreams.map(([key, s, c]) => [key, [s, c]]));
      let count = 0, sum = 0, consistent = true;
      for (const [key, s, c] of next.upstreams) {
        const old = before.get(key);
        if (!old) continue;
        if (s < old[0] || c < old[1]) { consistent = false; break; }
        sum += s - old[0]; count += c - old[1];
      }
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
  function chart(points, width = 660, metric = 'qps', inspected = null, secondary = null) {
    const baseMetric = metric === 'anomaly' ? 'qps' : metric;
    const ps = aggregate(points,baseMetric), definition = definitions[baseMetric] || definitions.qps;
    const w=Math.max(280,Math.round(width)),h=216,left=48,right=secondary?58:16,top=26,bottom=30;
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
    // Request volume reads better as bars; the cache hit rate rides the right axis.
    const showBars = metric === 'qps';
    const slot = (w - left - right) / Math.max(1, ps.length);
    const barW = Math.max(1.6, Math.min(16, slot * 0.62));
    const bars = showBars ? ps.filter(p=>finite(p.value)).map(p=>{
      const bx = x(p) - barW / 2, by = y(p.value);
      return `<rect class="traffic-bar" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0.6,(h-bottom)-by).toFixed(1)}" rx="${Math.min(3,barW/2).toFixed(1)}"><title>${time(p.time,true)} · ${rate(p.value)} ${definition.unit}</title></rect>`;
    }).join('') : '';
    const secondaryPath = (secondary && secondary.length > 1)
      ? runs(secondary).map(g=>`<path class="traffic-line-alt" d="${smoothPath(g.map(p=>[left+(p.time-first)/span*(w-left-right), top+(1-Math.min(100,Math.max(0,p.value))/100)*(h-top-bottom)]),top,h-bottom)}"/>`).join('')
      : '';
    const rightAxis = secondary ? [0,50,100].map(v=>`<text class="traffic-axis-alt" x="${w-right+8}" y="${(top+(1-v/100)*(h-top-bottom)+4).toFixed(1)}" text-anchor="start">${v}%</text>`).join('') : '';
    return `<div class="traffic-plot" tabindex="0" role="group" aria-label="${definition.label}趋势，单位 ${definition.unit}。左右方向键查看采样，Escape 关闭提示。"><svg class="console-chart traffic-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${definition.label}，${time(first,true)} 至 ${time(last,true)}，单位 ${definition.unit}"><title>按实际采样显示，断采不连线；长范围按请求量汇总并保留峰值</title>${grids}${bars}${secondaryPath}${rightAxis}${showBars?'':paths}${ticks.map((t,i)=>`<text x="${left+(t-first)/span*(w-left-right)}" y="${h-7}" text-anchor="${i===0?'start':i===ticks.length-1?'end':'middle'}">${time(t,span>=43200000)}</text>`).join('')}<line class="traffic-inspect-line" x1="0" x2="0" y1="${top}" y2="${h-bottom}" visibility="hidden"/></svg><output class="traffic-tooltip" hidden></output><span class="sr-only traffic-live" aria-live="polite"></span></div>`;
  }
  /**
   * Latency chart drawn from the recorded samples: linear adaptive Y axis, a
   * 100 ms slow-query line only once the axis actually reaches it, and one
   * callout on the highest sample.
   */
  function latencyChart(points, width) {
    const w = Math.max(280, Math.round(width)), h = 216, left = 52, right = 62, top = 30, bottom = 30;
    const valid = points.filter(p => finite(p.value));
    if (!valid.length) return '';
    const first = points[0].time, last = points.at(-1).time, span = Math.max(1, last - first);
    const peakValue = valid.reduce((n, p) => Math.max(n, p.value), 0);
    const max = axisCeiling(Math.max(peakValue * 1.15, 10));
    const x = p => left + (p.time - first) / span * (w - left - right);
    const y = v => top + (1 - Math.min(v, max) / max) * (h - top - bottom);
    const baseline = h - bottom;

    const groups = runs(points);
    const area = groups.filter(g => g.length > 1)
      .map(g => smoothPath(g.map(p => [x(p), y(p.value)]), top, baseline)
        + ` L${x(g.at(-1)).toFixed(1)},${baseline} L${x(g[0]).toFixed(1)},${baseline} Z`).join('');
    const lines = groups.map(g => smoothPath(g.map(p => [x(p), y(p.value)]), top, baseline)).join('');

    const grid = [0, 0.5, 1].map(f => {
      const v = max * f;
      return `<line class="traffic-grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/>`
        + `<text x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
    }).join('');

    // The 100 ms slow-query line only means something once the axis reaches it.
    const threshold = max >= 110
      ? `<line class="traffic-threshold" x1="${left}" x2="${w - right}" y1="${y(100)}" y2="${y(100)}"/>`
        + `<text class="traffic-threshold-label" x="${w - right + 8}" y="${y(100) + 4}" text-anchor="start">100ms</text>`
      : '';

    const peak = valid.reduce((best, p) => p.value > best.value ? p : best, valid[0]);
    const slow = peak.value >= 100;
    const cx = x(peak), cy = y(peak.value), label = `${rate(peak.value)}ms · ${time(peak.time)}`;
    const boxW = label.length * 6.4 + 16;
    const boxX = Math.min(w - right - boxW, Math.max(left, cx - boxW / 2));
    const boxY = Math.max(top, cy - 46);
    const callout = `<line class="traffic-peak" x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${(cy - 8).toFixed(1)}" y2="${Math.min(cy - 22, boxY + 22).toFixed(1)}"/>`
      + `<circle class="traffic-peak-dot${slow ? ' is-slow' : ''}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4"/>`
      + `<rect class="traffic-callout-box${slow ? ' is-slow' : ''}" x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="${boxW.toFixed(1)}" height="20" rx="6"/>`
      + `<text class="traffic-callout-text" x="${(boxX + boxW / 2).toFixed(1)}" y="${(boxY + 14).toFixed(1)}" text-anchor="middle">${esc(label)}</text>`;

    const lastPoint = valid.at(-1);
    const ticks = first === last ? [first] : [first, (first + last) / 2, last];
    return `<div class="traffic-plot" tabindex="0" role="group" aria-label="延迟与异常趋势，单位 ms。左右方向键查看采样，Escape 关闭提示。">`
      + `<svg class="console-chart traffic-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="延迟与异常，${time(first, true)} 至 ${time(last, true)}">`
      + `<title>按实际采样显示，断采不连线</title>`
      + `<defs><linearGradient id="traffic-lat-grad" x1="0" y1="0" x2="0" y2="1"><stop class="traffic-grad-top" offset="0%"/><stop class="traffic-grad-bottom" offset="100%"/></linearGradient></defs>`
      + `<text class="traffic-axis-unit" x="${left}" y="16">延迟 (ms)</text>`
      + grid + threshold
      + `<path class="traffic-area" d="${area}" fill="url(#traffic-lat-grad)"/>`
      + `<path class="traffic-line" d="${lines}"/>`
      + callout
      + `<circle class="traffic-point" cx="${x(lastPoint).toFixed(1)}" cy="${y(lastPoint.value).toFixed(1)}" r="3.4"/>`
      + `<text class="traffic-last-value" x="${w - right + 8}" y="${(y(lastPoint.value) + 4).toFixed(1)}" text-anchor="start">${rate(lastPoint.value)}ms</text>`
      + ticks.map((t, i) => `<text x="${left + (t - first) / span * (w - left - right)}" y="${h - 8}" text-anchor="${i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}">${shortClock(t, span >= 43200000)}</text>`).join('')
      + `<line class="traffic-inspect-line" x1="0" x2="0" y1="${top}" y2="${baseline}" visibility="hidden"/></svg>`
      + `<output class="traffic-tooltip" hidden></output><span class="sr-only traffic-live" aria-live="polite"></span></div>`;
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
    const metric=definitions[state.metric]&&!definitions[state.metric].hidden?state.metric:'anomaly';
    const definition=definitions[metric],s=summary(series,minutes,now,metric);
    const focus=container.contains(document.activeElement)?document.activeElement?.dataset.trafficMetric:null;
    const plotFocused=document.activeElement?.classList.contains('traffic-plot')&&container.contains(document.activeElement);
    const empty=(hint)=>state.loading&&!series.length
      ? '<div class="traffic-skeleton" role="status" aria-label="正在读取 DNS 采样"></div>'
      : `<div class="console-chart-empty">${definition.empty}<br>${hint}</div>`;
    let summaryHtml='', chartHtml, legendHtml='', alarm=false;
    if (metric === 'anomaly') {
      const ctx = state.overviewContext || {};
      const latS = summary(series, minutes, now, 'latency');
      const failVal = finite(ctx.failCount) ? ctx.failCount : 0;
      const slowVal = finite(ctx.slowOver100Count) ? ctx.slowOver100Count : 0;
      const bad = failVal > 0 || slowVal > 0;
      alarm = bad;
      summaryHtml = `<span class="traffic-health-pill${bad?' is-bad':''}"${failVal>0?' data-traffic-health="1" data-route="logs" role="button" tabindex="0" title="点击查看查询日志"':''}><i class="traffic-health-dot${bad?' is-bad':''}"></i>解析健康 · ${bad?`${failVal} 失败 · ${slowVal} 慢查`:'正常'}</span>`;
      const latPoints = latS.points.length ? aggregate(latS.points,'latency') : [];
      chartHtml = latPoints.length
        ? latencyChart(latPoints, container.clientWidth)
        : empty(series.length?'已读取查询计数，正在等待下一次采样':'未采集和无有效请求的区间不补零');
    } else {
      const cacheS = summary(series, minutes, now, 'cache');
      const cachePoints = cacheS.points.length ? aggregate(cacheS.points,'cache') : [];
      legendHtml = `<div class="traffic-legend"><span><i class="is-bar"></i>请求量</span><span><i class="is-cache"></i>缓存命中率</span></div>`;
      chartHtml = s.samples
        ? chart(s.points,container.clientWidth,metric,null,cachePoints)
        : empty(series.length?'已读取查询计数，正在等待下一次采样':'未采集和无有效请求的区间不补零');
    }
    setHTML(container,`<div class="traffic-head"><div class="traffic-metric-tabs" role="group" aria-label="选择 DNS 趋势指标">${visibleMetrics().map(([key,d])=>`<button type="button" data-traffic-metric="${key}" aria-pressed="${metric===key}">${d.label}</button>`).join('')}</div>${summaryHtml}</div>${legendHtml}${chartHtml}`
      +`<div class="traffic-caption"><span>${s.stale?'采样暂时中断，正在自动重试':s.samples?`有效采样 ${rate(s.seconds)} 秒 · 最近间隔 ${rate(s.interval)} 秒`:'概览可见时每 5 秒采样'}</span><span>本浏览器保留 7 天 · 当前 ${({15:'15 分钟',60:'1 小时',360:'6 小时',1440:'24 小时',10080:'7 天'})[minutes]||minutes+' 分钟'}</span></div><p class="traffic-storage-note">${state.storageError?'本机历史存储暂不可用，新增采样仅临时保留。':'刷新后可继续查看本机历史。'}关闭网页、切换页面或后台休眠期间留空。</p>`);
    const card = container.closest('.glass-card');
    if (card) card.classList.toggle('traffic-alarm', alarm);
    if(state.error){const error=document.createElement('div');error.className='traffic-read-error';error.setAttribute('role','status');const message=document.createElement('span');message.textContent=state.error;const retry=document.createElement('button');retry.type='button';retry.className='button small';retry.dataset.trafficRetry='';retry.textContent='重新读取';error.append(message,retry);container.append(error);}
    inspect(container,s.points,metric);
    if(definitions[focus])container.querySelector(`[data-traffic-metric="${focus}"]`)?.focus({preventScroll:true});
    if(plotFocused)container.querySelector('.traffic-plot')?.focus({preventScroll:true});
  }
  trafficService={parse,raw,record,summary,aggregate,chart,render,definitions};
}
