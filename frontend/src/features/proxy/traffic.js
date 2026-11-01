import { setHTML } from '../../core/security/safe-dom.ts';
import { esc } from '../../shared/format/number.js';
import { parseDetail, rangeRows, rankings, byteTotal, sumBytes, formatBytes, serverDate, freshness, trafficCSV } from './traffic-model.js';

const view={tab:'trend',range:'week',dimension:'devices'};
const ranges={today:'今日',yesterday:'昨日',week:'近 7 天','30days':'近 30 天',month:'本月'};
const tabs={trend:'用量趋势',ranking:'流量排行',daily:'每日明细'};
const dimensions={devices:'设备',providers:'订阅',nodes:'节点'};
const amount = value => {const parts=formatBytes(value).split(' ');return `${esc(parts[0])}<small>${esc(parts[1])}</small>`;};
const empty = (title,message) => `<div class="pt-empty"><strong>${esc(title)}</strong><p>${esc(message)}</p></div>`;

export async function mountTraffic(parent, context, onStatus=()=>{}) {
  let data=null,failure='',loading=true,busy=false;
  const scope=context.scope;
  function chart(rows,width) {
    let points=rows;
    const hourly=view.range==='today';
    if(hourly){const record=rows.find(row=>!row.missing);points=Array.from({length:24},(_,i)=>{const hour=String(i).padStart(2,'0');return record?.hourly[hour]?{...record.hourly[hour],date:hour+':00'}:{date:hour+':00',missing:true};});}
    const available=points.filter(row=>!row.missing);
    if(!available.length)return empty(hourly?'还没有分时记录':'这个时段还没有记录','未采集的时段留空，不记为零流量。');
    const W=Math.max(320,Math.round(width)),H=220,L=42,R=10,T=16,B=30,plotH=H-T-B;
    const max=Math.max(1,...available.map(byteTotal))*1.15,step=(W-L-R)/points.length,barW=Math.min(44,step*.55);
    const unit=formatBytes(max).split(' ')[1],scale=1024**['B','KB','MB','GB','TB'].indexOf(unit);
    let svg=`<svg class="pt-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(ranges[view.range])}代理上传与下载趋势；缺失记录留空"><text class="axis" x="${L-9}" y="8" text-anchor="end">${esc(unit)}</text>`;
    for(let i=0;i<4;i++){const y=T+plotH*i/3;svg+=`<path class="grid" d="M${L} ${y}H${W-R}"/><text class="axis" x="${L-9}" y="${y+3}" text-anchor="end">${(max*(1-i/3)/scale).toFixed(max/scale>=10?0:1)}</text>`;}
    points.forEach((row,i)=>{
      const x=L+i*step+(step-barW)/2,bottom=H-B,label=hourly?row.date:row.date.slice(5).replace('-','/');
      if(row.missing)svg+=`<path class="bar-missing" d="M${x} ${bottom}h${barW}"/>`;
      else {const down=row.down/max*plotH,up=row.up/max*plotH,description=`${label} · 下载 ${formatBytes(row.down)} · 上传 ${formatBytes(row.up)}`;
        svg+=`<g tabindex="0" data-chart-label="${esc(description)}"><title>${esc(description)}</title><rect class="bar-down" x="${x}" y="${bottom-down}" width="${barW}" height="${down}" rx="2"/><rect class="bar-up" x="${x}" y="${bottom-down-up}" width="${barW}" height="${up}" rx="2"/><rect class="bar-hit" x="${L+i*step}" y="${T}" width="${step}" height="${plotH}"/></g>`;}
      if(hourly?(i%6===0||i===23):(points.length<=7||i===0||i===points.length-1||i%7===0))svg+=`<text class="axis" x="${x+barW/2}" y="${H-7}" text-anchor="middle">${esc(hourly?label.slice(0,2):label)}</text>`;
    });
    svg+='</svg>';
    const best=available.reduce((a,b)=>byteTotal(b)>byteTotal(a)?b:a);
    const unallocated=hourly?Math.max(0,byteTotal(sumBytes(rows))-byteTotal(sumBytes(available))):0;
    return `<div class="pt-chart-heading"><h3>${hourly?'今日分时用量':'每日上传与下载'}</h3><span>${hourly?'按小时汇总':'按天汇总'}</span></div>${svg}<div class="pt-chart-readout" id="pt-chart-readout">悬停或聚焦柱条，查看用量</div><div class="pt-insight"><span>${hourly?'最高用量时段':'单日最高'}</span><b>${esc(hourly?best.date:best.date.slice(5).replace('-','/'))} · ${esc(formatBytes(byteTotal(best)))}</b></div><p class="pt-note">${unallocated?`有 ${esc(formatBytes(unallocated))} 历史用量未记录分时，保留在合计中。`:'上传与下载相加为合计。未采集的时段留空。'}</p>`;
  }
  function ranking(rows) {
    const entries=rankings(data,rows,view.dimension),total=byteTotal(sumBytes(rows));
    const control=`<div class="pt-rank-heading"><div class="pt-segment" role="group" aria-label="排行维度">${Object.entries(dimensions).map(([key,label])=>`<button type="button" id="pt-dimension-${key}" data-dimension="${key}" aria-pressed="${view.dimension===key}">${label}</button>`).join('')}</div><span>按合计从高到低</span></div>`;
    if(!entries.length)return control+empty('没有可用的排行记录','尚无已采集的代理流量。');
    const max=entries[0].total;
    return control+`<div class="pt-rank-list">${entries.map((entry,i)=>`<div class="pt-rank-row"><span class="pt-rank-index">${String(i+1).padStart(2,'0')}</span><div><div class="pt-rank-name">${esc(entry.name)}</div>${entry.meta?`<div class="pt-rank-meta">${esc(entry.meta)}</div>`:''}<div class="pt-rank-track"><i style="width:${entry.down/max*100}%"></i><i style="width:${entry.up/max*100}%"></i></div><div class="pt-rank-meta">↓ ${esc(formatBytes(entry.down))} · ↑ ${esc(formatBytes(entry.up))}</div></div><div class="pt-rank-amount">${esc(formatBytes(entry.total))}<small>${(entry.total/total*100).toFixed(1)}%</small></div></div>`).join('')}</div><div class="pt-rank-total"><span>${entries.length} 项 · 含其他 / 未分类</span><span>合计 ${esc(formatBytes(total))}</span></div><p class="pt-note">各维度使用同一份用量，不重复相加。历史未分类表示当时尚未记录此维度；未知设备显示 IP，不按 IPv6 网段合并。</p>`;
  }
  function daily(rows) {
    const valid=rows.filter(row=>!row.missing),sum=sumBytes(valid),today=serverDate(data);
    if(!valid.length)return empty('还没有每日记录','开始采集后，每日记录会保存在服务器。');
    return `<div class="pt-table-heading"><span>${valid.length} 个采集日${valid.length<rows.length?` · ${rows.length-valid.length} 天无数据`:''}</span><button type="button" class="pt-export" id="pt-export">↓ 导出 CSV</button></div><table class="pt-table"><caption>每日代理用量</caption><colgroup><col class="pt-date-col"><col><col><col></colgroup><thead><tr><th scope="col">日期</th><th scope="col">下载</th><th scope="col">上传</th><th scope="col">合计</th></tr></thead><tbody>${[...rows].reverse().map(row=>`<tr><td>${esc(row.date.slice(5).replace('-','/'))}<em>${row.missing?'未采集':row.date===today?'今日 · 未结束':row.coverage==='unknown'?'覆盖未知':row.coverage==='partial'?'部分采集':''}</em></td><td>${row.missing?'—':esc(formatBytes(row.down))}</td><td>${row.missing?'—':esc(formatBytes(row.up))}</td><td>${row.missing?'—':esc(formatBytes(byteTotal(row)))}</td></tr>`).join('')}</tbody><tfoot><tr><td>已采集合计</td><td>${esc(formatBytes(sum.down))}</td><td>${esc(formatBytes(sum.up))}</td><td>${esc(formatBytes(byteTotal(sum)))}</td></tr></tfoot></table><p class="pt-note">缺失记录不记为零。CSV 保留原始字节数、日期及采集状态。</p>`;
  }
  function paint() {
    if(scope.signal.aborted)return;
    const focused=parent.contains(document.activeElement)?document.activeElement.id:null;
    const width=parent.querySelector('.pt-panels')?.clientWidth||Math.max(320,parent.clientWidth-56);
    const status=freshness(data),statusText=failure?(data?'读取失败 · 保留最后记录':'统计暂不可用'):loading&&!data?'正在读取统计…':!data?'未接入明细采集':status==='ready'?`${data.source} · 采集中`:status==='expired'?'采集已过期':'采集中断 · 最后记录';
    onStatus(statusText);
    if(!data){setHTML(parent,`<section class="glass-card proxy-traffic-surface">${empty(loading?'正在读取代理用量':failure||'尚未接入明细采集',loading?'请稍候。':'采集服务提供数据后，这里会显示用量、排行和每日记录。')}<button type="button" class="button small" id="pt-retry">重新读取</button></section>`);return;}
    const rows=rangeRows(data,view.range),valid=rows.filter(row=>!row.missing),sum=sumBytes(valid);
    const currentDay=serverDate(data),today=data.days.get(currentDay),yesterday=rangeRows(data,'yesterday').find(row=>!row.missing);
    const week=rangeRows(data,'week'),month=rangeRows(data,'month');
    const warning=failure?'读取暂时失败，以下保留最后一次成功读取的记录。':status!=='ready'?`采集暂停更新，最后更新于 ${data.updated}。`:today?.coverage==='unknown'?'部分历史的采集覆盖未知；未分类的旧用量仍保留在合计中。':today?.coverage==='partial'?'今天从开始采集起记录，部分时段没有数据。':'';
    let body=view.tab==='trend'?chart(rows,width):view.tab==='ranking'?ranking(rows):daily(rows);
    if(!valid.length)body=empty('这个时段还没有记录','未采集的日期显示为空，不记为零流量。');
    const todayBytes=today?byteTotal(today):0;
    const heroSide=[['yesterday',yesterday,'昨日'],['week',week.some(row=>!row.missing)?sumBytes(week):null,'近 7 天'],['month',month.some(row=>!row.missing)?sumBytes(month):null,'本月']];
    setHTML(parent,`<section class="glass-card proxy-traffic-surface"><div class="pt-analytics" id="pt-analytics"><div class="pt-hero"><div class="pt-hero-main"><div><div class="pt-hero-label">今日 · ${esc(currentDay.slice(5).replace('-','/'))}</div><div class="pt-hero-amount">${today?amount(todayBytes):'—'}</div></div><div class="pt-hero-split"><div><div class="pt-hero-split-label"><i class="down"></i>下载</div><div class="pt-hero-split-value">${today?esc(formatBytes(today.down)):'—'}</div></div><div><div class="pt-hero-split-label"><i class="up"></i>上传</div><div class="pt-hero-split-value">${today?esc(formatBytes(today.up)):'—'}</div></div></div></div><div class="pt-hero-side">${heroSide.map(([key,value,label])=>value?`<button type="button" class="pt-hero-mini" id="pt-hero-${key}" data-range="${key}" aria-pressed="${view.range===key}"><span>${label}</span><strong>${amount(byteTotal(value))}</strong></button>`:`<div class="pt-hero-mini na" aria-disabled="true"><span>${label}</span><strong>暂无采集</strong></div>`).join('')}</div></div><div class="pt-navigation"><div class="pt-tabs" role="tablist" aria-label="代理流量详情">${Object.entries(tabs).map(([key,label])=>`<button type="button" class="pt-tab" id="pt-tab-${key}" data-tab="${key}" role="tab" aria-controls="pt-panel" aria-selected="${view.tab===key}" tabindex="${view.tab===key?0:-1}">${label}</button>`).join('')}</div><div class="pt-range-row"><span>统计范围</span><div class="pt-segment" role="group" aria-label="统计时间范围">${['today','yesterday','week','30days','month'].map(key=>`<button type="button" id="pt-range-${key}" data-range="${key}" aria-pressed="${view.range===key}">${ranges[key]}</button>`).join('')}</div></div></div>${warning?`<p class="pt-alert" role="status">${esc(warning)}</p>`:''}<div class="pt-period">${rows[0].date.replaceAll('-','/')} — ${rows[rows.length-1].date.replaceAll('-','/')} · ${valid.length} 个采集日</div><section class="pt-panels" id="pt-panel" role="tabpanel" aria-labelledby="pt-tab-${view.tab}" tabindex="0">${body}</section><div class="pt-page-foot"><span>采样估算 · 更新于 ${esc(data.updated.replace('T',' ').slice(0,19))}</span><button type="button" class="pt-export" id="pt-retry">刷新统计</button></div></div></section><p class="proxy-traffic-note">${data.since?`自 ${esc(data.since)} 记录`:''}${data.lifetime?` · 累计 ${esc(formatBytes(byteTotal(data.lifetime)))}`:''} · 每日记录保留 400 天，分类记录保留 90 天。</p>`);
    if(focused)parent.querySelector('#'+focused)?.focus({preventScroll:true});
  }
  async function refresh() {
    if(busy||scope.signal.aborted)return;
    busy=true;
    try {const response=await fetch(new URL('custom/traffic-detail.json',document.baseURI),{cache:'no-store',signal:scope.signal});
      if(!response.ok)throw new Error(response.status===404?'尚未接入明细采集':'暂时无法读取统计');
      const next=parseDetail(await response.json());if(!next)throw new Error('统计数据格式无效');data=next;failure='';
    } catch(error){if(scope.signal.aborted)return;failure=error.message||'暂时无法读取统计';}
    finally {busy=false;loading=false;if(!scope.signal.aborted)paint();}
  }
  scope.listen(parent,'click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.id==='pt-retry'){refresh();return;}
    if(button.dataset.tab)view.tab=button.dataset.tab;
    else if(button.dataset.range)view.range=button.dataset.range;
    else if(button.dataset.dimension)view.dimension=button.dataset.dimension;
    else if(button.id==='pt-export'&&data){
      const url=URL.createObjectURL(new Blob([trafficCSV(rangeRows(data,view.range),serverDate(data))],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
      link.href=url;link.download=`LocalDNS-代理流量-${serverDate(data)}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
    } else return;
    paint();
  });
  scope.listen(parent,'keydown',event=>{if(!event.target.matches('[data-tab]')||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=Object.keys(tabs),index=keys.indexOf(view.tab);view.tab=event.key==='Home'?keys[0]:event.key==='End'?keys[2]:keys[(index+(event.key==='ArrowRight'?1:2))%3];paint();parent.querySelector('#pt-tab-'+view.tab).focus();});
  const readout=event=>{const group=event.target.closest('[data-chart-label]');const target=parent.querySelector('#pt-chart-readout');if(group&&target)target.textContent=group.dataset.chartLabel;};
  scope.listen(parent,'mouseover',readout);scope.listen(parent,'focusin',readout);scope.listen(window,'resize',paint);
  scope.interval(()=>{if(document.visibilityState==='visible')refresh();},30000);
  paint();await refresh();
}
