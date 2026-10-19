(() => {
  'use strict';
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  function record(series, sample, now = Date.now()) {
    if (!finite(sample.total) || sample.total < 0) return false;
    const previous = series.at(-1);
    if (previous && (previous.start !== sample.start || sample.total < previous.total)) series.length = 0;
    const last = series.at(-1), elapsed = last ? (now - last.time) / 1000 : 0;
    if (last && elapsed < 1.5) return false;
    const valid = !!last && elapsed > 0 && elapsed <= 90;
    series.push({...sample, time: now, elapsed: valid ? elapsed : 0,
      delta: valid ? sample.total - last.total : null,
      qps: valid ? (sample.total - last.total) / elapsed : null});
    while (series.length > 1440 || series[0]?.time < now - 7200000) series.shift();
    return true;
  }
  function summary(series, minutes = 30, now = Date.now()) {
    const cutoff = now - minutes * 60000;
    // Only intervals wholly inside the selected window contribute to its totals.
    const points = series.filter(p => p.time >= cutoff).map(p =>
      p.time - p.elapsed * 1000 < cutoff ? {...p, qps: null, delta: null, elapsed: 0} : p);
    const valid = points.filter(p => finite(p.qps) && p.elapsed > 0);
    const firstIndex = points.findIndex(p => finite(p.qps));
    const visible = firstIndex < 0 ? [] : points.slice(firstIndex);
    const requests = valid.reduce((n, p) => n + p.delta, 0);
    const seconds = valid.reduce((n, p) => n + p.elapsed, 0);
    const latest = series.at(-1);
    return {points: visible, samples: valid.length, requests, seconds,
      average: seconds ? requests / seconds : null,
      peak: valid.length ? Math.max(...valid.map(p => finite(p.peak)?Math.max(p.peak,p.qps):p.qps)) : null,
      current: latest && now - latest.time <= 90000 && finite(latest.qps) ? latest.qps : null,
      stale: !!latest && now - latest.time > 90000,
      interval: latest?.elapsed || 0};
  }
  const rate = n => finite(n) ? n.toLocaleString('zh-CN', {maximumFractionDigits: 2}) : '—';
  const time = (n,withDate=false) => withDate ? new Date(n).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : new Date(n).toLocaleTimeString('zh-CN', {hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'});
  function chart(points, width = 660) {
    const w = Math.max(280, Math.round(width)), h = 204, left = 42, right = 15, top = 16, bottom = 30;
    const first = points[0].time, last = points.at(-1).time, span = last - first || 1;
    const peak = Math.max(0, ...points.filter(p => finite(p.qps)).map(p => p.qps));
    const magnitude = 10 ** Math.floor(Math.log10(peak || 1));
    const max = Math.max(1, Math.ceil(peak / magnitude) * magnitude);
    const x = p => left + (p.time - first) / span * (w - left - right);
    const y = p => top + (1 - p.qps / max) * (h - top - bottom);
    const groups = []; let group = [];
    for (const p of points) {
      if (!finite(p.qps)) {if (group.length) groups.push(group); group = []; continue;}
      group.push(p);
    }
    if (group.length) groups.push(group);
    const paths = groups.map(ps => {
      const d = ps.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(2)},${y(p).toFixed(2)}`).join(' ');
      const area = ps.length > 1 ? `<path class="traffic-area" d="${d} L${x(ps.at(-1))},${h-bottom} L${x(ps[0])},${h-bottom} Z"/>` : '';
      return area + `<path class="traffic-line" d="${d}"/>` + ps.map(p => `<circle class="traffic-point" cx="${x(p)}" cy="${y(p)}" r="${ps.length===1?3:2}"><title>${time(p.time,true)} · ${rate(p.qps)} QPS · ${p.delta} 次 / ${rate(p.elapsed)} 秒</title></circle>`).join('');
    }).join('');
    const grids = [0, max / 2, max].map(v => {
      const cy = top + (1-v/max)*(h-top-bottom);
      return `<line class="traffic-grid" x1="${left}" x2="${w-right}" y1="${cy}" y2="${cy}"/><text x="${left-8}" y="${cy+4}" text-anchor="end">${rate(v)}</text>`;
    }).join('');
    const ticks = first === last ? [first] : [first, ...(w >= 480 ? [(first+last)/2] : []), last];
    return `<svg class="console-chart traffic-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="DNS 查询吞吐量，${time(first,true)} 至 ${time(last,true)}，单位 QPS"><title>每秒 DNS 请求数；断采区间不连线</title>${grids}${paths}${ticks.map((t,i)=>`<text x="${left+(t-first)/span*(w-left-right)}" y="${h-7}" text-anchor="${i===0?'start':i===ticks.length-1?'end':'middle'}">${time(t,span>=43200000)}</text>`).join('')}</svg>`;
  }
  function render(container, series, minutes, now = Date.now(), state = {}) {
    const s=summary(series,minutes,now);
    const metric = (label, value, unit) => `<div><dt>${label}</dt><dd>${value}<small>${unit}</small></dd></div>`;
    container.innerHTML = `<dl class="traffic-summary">${metric('最近采样',rate(Object.hasOwn(state,'current')?state.current:s.current),'QPS')}${metric('区间均值',rate(s.average),'QPS')}${metric('区间峰值',rate(s.peak),'QPS')}${metric('区间请求',s.samples?s.requests.toLocaleString('zh-CN'):'—','次')}</dl>` +
      (s.samples ? chart(s.points, container.clientWidth) : `<div class="console-chart-empty">正在建立当前会话采样基线，约 5 秒后显示吞吐量<br>尚未采集的时段不补零</div>`) +
      `<div class="traffic-caption"><span>${s.stale?'采样暂时中断，正在自动重试':s.samples?`已采样 ${rate(s.seconds)} 秒 · 最近间隔 ${rate(s.interval)} 秒`:'当前页面每 5 秒采样 · 至少需要两次采样'}</span><span>仅当前会话 · 最多 2 小时 · 当前 ${({15:'15 分钟',30:'30 分钟',60:'1 小时',120:'2 小时'})[minutes]||minutes+' 分钟'}</span></div>`;
    if(state.error){const error=document.createElement('div');error.className='traffic-read-error';error.setAttribute('role','status');const message=document.createElement('span');message.textContent=state.error;const retry=document.createElement('button');retry.type='button';retry.className='button small';retry.dataset.trafficRetry='';retry.textContent='重新读取';error.append(message,retry);container.append(error);}
  }
  window.LocalDNSTraffic = {record, summary, chart, render};
})();
