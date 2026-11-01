import { setHTML } from '../../core/security/safe-dom.ts';
import { esc } from '../../shared/format/number.js';
import {
  parseDetail, byteTotal, sumBytes, formatBytes, serverDate, freshness, rankings, rangeRows, trafficCSV,
  monthKey, monthLabel, monthBounds, monthDays, monthRows, shiftMonth, hourlySeries, weekdayName,
} from './traffic-model.js';

// 设计C「时间流」：上面三个口径，左边采集日历，右边选中日期的分时与维度排行。
// 日历只让有记录的日子可点；未采集的日子留空，不折算成零流量。
const view={month:'',selected:'',dimension:'devices'};
const dimensions={devices:'设备',providers:'订阅',nodes:'节点'};
const weekdays=['一','二','三','四','五','六','日'];
const amount = value => {const parts=formatBytes(value).split(' ');return `${esc(parts[0])}<small>${esc(parts[1]||'')}</small>`;};
const compact = value => {const [number,unit='']=formatBytes(value).split(' ');return `${number}${unit.slice(0,1)}`;};
const dayLabel = date => `${date.slice(5,7)}/${date.slice(8,10)}`;
const empty = (title,message,action='') => `<div class="pt-empty"><strong>${esc(title)}</strong><p>${esc(message)}</p>${action}</div>`;

export async function mountTraffic(parent, context, onStatus=()=>{}) {
  let data=null,failure='',loading=true,busy=false,settled=false;
  const scope=context.scope;
  const pickDay = (month,today) => {
    const dates=[...data.days.keys()].filter(date=>date.startsWith(month)&&date<=today).sort();
    return dates.length?dates[dates.length-1]:'';
  };
  function kpis(today) {
    const current=data.days.get(today);
    const week=rangeRows(data,'week'),valid=week.filter(row=>!row.missing),sum=sumBytes(valid);
    const lifetime=data.lifetime;
    return `<div class="pt-kpis">
      <div class="pt-kpi"><span class="k">今日 · ${esc(dayLabel(today))}</span><strong class="v">${current?amount(byteTotal(current)):'—'}</strong><span class="s">${current?`↓ ${esc(formatBytes(current.down))} · ↑ ${esc(formatBytes(current.up))}`:'今天还没有采集记录'}</span></div>
      <div class="pt-kpi"><span class="k">近 7 天 · ${valid.length} 个采集日</span><strong class="v">${valid.length?amount(byteTotal(sum)):'—'}</strong><span class="s">${valid.length?`${esc(dayLabel(valid[0].date))} — ${esc(dayLabel(valid[valid.length-1].date))}`:'尚未满一个采集周期'}</span></div>
      <div class="pt-kpi"><span class="k">累计 · 自 ${esc(data.since?dayLabel(data.since):'—')}</span><strong class="v">${lifetime?amount(byteTotal(lifetime)):'—'}</strong><span class="s">每日保留 400 天 · 分类保留 90 天</span></div>
    </div>`;
  }
  function calendar(cells,today) {
    const grid=cells.map(cell=>{
      if(cell.blank)return '<span class="pt-cal-day blank" aria-hidden="true"></span>';
      if(cell.missing)return `<span class="pt-cal-day na${cell.today?' today':''}" aria-disabled="true"><span class="d">${cell.day}</span></span>`;
      const selected=cell.date===view.selected;
      return `<button type="button" class="pt-cal-day has${cell.today?' today':''}${selected?' sel':''}" id="pt-day-${cell.date}" data-day="${cell.date}" aria-pressed="${selected}" aria-label="${esc(`${dayLabel(cell.date)} ${weekdayName(cell.date)} · ${formatBytes(cell.total)}`)}"><span class="d">${cell.day}</span><span class="v">${esc(compact(cell.total))}</span></button>`;
    }).join('');
    const used=cells.filter(cell=>!cell.blank&&!cell.missing&&cell.date<=today);
    const sum=sumBytes(used),average=used.length?Math.round(byteTotal(sum)/used.length):0;
    // 当月摘要填在日历下方：数据少时左栏不会空出一截，也多一个「这个月用了多少」的口径。
    return `<div class="pt-cal-grid" role="group" aria-label="${esc(monthLabel(view.month))}每日代理用量">${weekdays.map(name=>`<span class="pt-cal-dw" aria-hidden="true">${name}</span>`).join('')}${grid}</div>
      <div class="pt-cal-summary">
        <div><span>当月合计</span><b>${used.length?amount(byteTotal(sum)):'—'}</b></div>
        <div><span>采集天数</span><b>${used.length} 天</b></div>
        <div><span>日均</span><b>${used.length?amount(average):'—'}</b></div>
      </div>`;
  }
  function detail(today) {
    const day=data.days.get(view.selected);
    if(!day)return empty('这一天没有采集记录','未采集的日期留空，不记为零流量。');
    const total=byteTotal(day),hours=hourlySeries(day),hasHours=hours.some(hour=>!hour.missing);
    const peak=Math.max(0,...hours.map(hour=>hour.total));
    const tag=day.date===today?'今日 · 未结束':day.coverage==='partial'?'部分采集':day.coverage==='unknown'?'覆盖未知':'已采集';
    const clock=value=>{const match=/(\d{2}:\d{2})/.exec(value||'');return match?match[1]:'—';};
    const coverage=day.coverage==='full'?'完整':day.coverage==='partial'?'部分采集':'未知';
    const bars=hasHours
      ?`<div class="pt-hour-bars" role="img" aria-label="每小时代理用量合计，包含上传与下载">${hours.map(hour=>`<i class="${hour.missing?'z':''}" style="height:${Math.max(hour.missing?2:3,Math.round(hour.total/Math.max(1,peak)*100))}%" title="${hour.hour}:00${hour.missing?' · 未采集':` · ↓ ${formatBytes(hour.down)} · ↑ ${formatBytes(hour.up)}`}"></i>`).join('')}</div><div class="pt-hour-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>`
      :'<p class="pt-note">这一天没有分时记录；用量仍保留在当日合计中。</p>';
    return `<div class="pt-day-date"><b>${esc(dayLabel(day.date))} ${esc(weekdayName(day.date))}</b><span class="pt-day-tag${day.date===today?'':' na'}">${esc(tag)}</span></div>
      <div class="pt-day-total">${amount(total)}</div>
      <div class="pt-day-split"><span>下载 <b>${esc(formatBytes(day.down))}</b></span><span>上传 <b>${esc(formatBytes(day.up))}</b></span></div>
      ${bars}
      <div class="pt-day-meta"><span>采集时段 <b>${esc(clock(day.first))} — ${esc(clock(day.last))}</b></span><span>覆盖 <b>${esc(coverage)}</b></span><span>断点 <b>${day.gaps}</b></span>${hasHours?`<span>峰值 <b>${esc(hours.reduce((a,b)=>b.total>a.total?b:a).hour)}:00 · ${esc(formatBytes(peak))}</b></span>`:''}</div>`;
  }
  // 排行单独整宽：条目数量只影响它自己的高度，不会再把左边的日历晾在半空。
  function rankPanel() {
    const head=`<div class="pt-rank-head"><h3 id="pt-rank-title">流量排行</h3><div class="pt-dim-tabs" role="group" aria-label="排行维度">${Object.entries(dimensions).map(([key,label])=>`<button type="button" id="pt-dimension-${key}" data-dimension="${key}" aria-pressed="${view.dimension===key}">${label}</button>`).join('')}</div><span>按合计从高到低</span></div>`;
    const day=data.days.get(view.selected);
    if(!day)return `<section class="pt-card pt-rank-panel" aria-labelledby="pt-rank-title">${head}${empty('没有可排行的记录','选择有采集的日期后再看排行。')}</section>`;
    const total=byteTotal(day),entries=rankings(data,[day],view.dimension,50);
    const body=entries.length
      ?`<div class="pt-mini-list">${entries.map((entry,index)=>{const percent=total?entry.total/total*100:0;return `<div class="pt-mini-row"><span class="pt-mini-index">${String(index+1).padStart(2,'0')}</span><div class="pt-mini-main"><div class="pt-mini-top"><span class="mn">${esc(entry.name)}</span><span class="mv">${esc(formatBytes(entry.total))}</span></div><div class="pt-mini-bar"><i style="width:${Math.max(2,percent).toFixed(1)}%"></i></div></div><span class="mp">${percent.toFixed(1)}%</span></div>`;}).join('')}</div>`
      :empty('这一天没有分类记录','旧用量可能尚未按设备、订阅或节点分类。');
    // 「历史未分类」不是坏数据：它是记进了当天合计、但没有设备/订阅/节点归属的那部分。
    const since=String(data.dimensionsSince||'').slice(0,16).replace('T',' ');
    const history=entries.some(entry=>entry.key==='__history__')
      ?`<p class="pt-rank-hint">历史未分类是已计入当天合计、但缺少当前维度明细的用量。${since?`分类采集始于 ${esc(since)}；`:''}可能来自升级前存量、超过 90 天已清理的明细，或明细缺失，无法还原到具体${dimensions[view.dimension]}。</p>`
      :'';
    return `<section class="pt-card pt-rank-panel" aria-labelledby="pt-rank-title">${head}${body}${history}<div class="pt-rank-foot"><span>${entries.length?`${entries.length} 项${entries.some(entry=>entry.key==='__remainder__')?' · 其余已合并为“其他”':''}`:'—'}</span><button type="button" class="pt-export" id="pt-export">导出当月每日用量 CSV</button></div></section>`;
  }
  function paint() {
    if(scope.signal.aborted)return;
    const focused=parent.contains(document.activeElement)?document.activeElement.id:null;
    const status=freshness(data);
    const statusText=failure?(data?'读取失败 · 保留最后记录':'统计暂不可用'):loading&&!data?'正在读取统计…':!data?'未接入明细采集':status==='ready'?`${data.source} · 采集中`:status==='expired'?'采集已过期':'采集中断 · 最后记录';
    onStatus(statusText);
    if(!data){setHTML(parent,`<section class="glass-card proxy-traffic-surface">${empty(loading?'正在读取代理用量':failure||'尚未接入明细采集',loading?'请稍候。':'采集服务提供数据后，这里会显示每日用量、分时分布和维度排行。','<button type="button" class="button small" id="pt-retry">重新读取</button>')}</section>`);return;}
    const today=serverDate(data),bounds=monthBounds(data,today);
    if(!view.month||view.month<bounds.min||view.month>bounds.max)view.month=monthKey(today)<bounds.min?bounds.min:monthKey(today);
    if(!view.selected||!view.selected.startsWith(view.month)||!data.days.has(view.selected)){
      view.selected=pickDay(view.month,today);
      // 跨月停采时当月还没有记录，首次进入落到最近一个采集日，避免打开就是空月。
      if(!settled&&!view.selected&&view.month===monthKey(today)){
        const latest=[...data.days.keys()].filter(date=>date<=today).sort().pop();
        if(latest){view.month=monthKey(latest);view.selected=latest;}
      }
    }
    settled=true;
    const warning=failure?'读取暂时失败，以下保留最后一次成功读取的记录。':status!=='ready'?`采集暂停更新，最后更新于 ${data.updated.replace('T',' ').slice(0,19)}。`:'';
    const cells=monthDays(data,view.month,today);
    setHTML(parent,`<section class="glass-card proxy-traffic-surface"><div class="pt-analytics" id="pt-analytics">
      ${kpis(today)}
      ${warning?`<p class="pt-alert" role="status">${esc(warning)}</p>`:''}
      <div class="pt-flow">
        <section class="pt-card pt-calendar" aria-labelledby="pt-cal-title">
          <div class="pt-card-head"><h3 id="pt-cal-title">采集日历</h3><span>点击查看当天</span></div>
          <div class="pt-cal-nav"><button type="button" id="pt-cal-prev" data-cal-nav="-1" aria-label="上一个月"${view.month<=bounds.min?' disabled':''}>‹</button><b>${esc(monthLabel(view.month))}</b><button type="button" id="pt-cal-next" data-cal-nav="1" aria-label="下一个月"${view.month>=bounds.max?' disabled':''}>›</button></div>
          ${calendar(cells,today)}
          <div class="pt-cal-legend"><span><i class="has"></i>有采集</span><span><i class="none"></i>无数据</span><span><i class="today"></i>今天</span></div>
          <div class="pt-cal-foot"><span>采样估算 · 更新于 ${esc(data.updated.slice(11,19))}</span><button type="button" class="pt-export" id="pt-refresh">刷新统计</button></div>
        </section>
        <section class="pt-card pt-day" aria-labelledby="pt-day-title">
          <div class="pt-card-head"><h3 id="pt-day-title">日期详情</h3><span>部分历史的采集覆盖未知</span></div>
          ${detail(today)}
        </section>
      </div>
      ${rankPanel()}
      <p class="pt-note">各维度使用同一份用量，不重复相加。未知设备显示 IP，不按 IPv6 网段合并；未采集的日期留空，不记为零流量。</p>
    </div></section><p class="proxy-traffic-note">${data.since?`自 ${esc(data.since)} 记录`:''}${data.lifetime?` · 累计 ${esc(formatBytes(byteTotal(data.lifetime)))}`:''} · 每日记录保留 400 天，分类记录保留 90 天。</p>`);
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
    if(button.id==='pt-retry'||button.id==='pt-refresh'){refresh();return;}
    if(button.dataset.calNav&&data){
      const today=serverDate(data),bounds=monthBounds(data,today),next=shiftMonth(view.month,Number(button.dataset.calNav));
      if(next<bounds.min||next>bounds.max)return;
      view.month=next;view.selected=pickDay(next,today);paint();return;
    }
    if(button.dataset.day){view.selected=button.dataset.day;paint();return;}
    if(button.dataset.dimension){view.dimension=button.dataset.dimension;paint();return;}
    if(button.id==='pt-export'&&data){
      const today=serverDate(data);
      const url=URL.createObjectURL(new Blob([trafficCSV(monthRows(data,view.month,today),today)],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
      link.href=url;link.download=`LocalDNS-代理流量-${view.month}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
    }
  });
  scope.interval(()=>{if(document.visibilityState==='visible')refresh();},30000);
  paint();await refresh();
}
